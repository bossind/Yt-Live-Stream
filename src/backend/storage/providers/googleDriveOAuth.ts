import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import type {
  GoogleDriveOAuthStatus,
  StartGoogleDriveOAuthInput,
  StartGoogleDriveOAuthResponse,
  StorageAccount,
} from '../../../shared/types/storage';
import { env } from '../../config/env';
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
} from '../../crypto/secretVault';
import { AppError } from '../../errors/AppError';
import { getFirebaseAdminState } from '../../firebase/admin';
import { StorageStore } from '../storageStore';
import { GoogleDriveApi, GoogleDriveApiHttpError } from './googleDriveApi';

export const GOOGLE_DRIVE_CALLBACK_PATH = '/api/v1/storage/google-drive/oauth/callback';

export const GOOGLE_DRIVE_MINIMAL_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface OAuthConfigEvaluationInput {
  isProduction?: boolean;
  port?: number;
  googleClientId?: string;
  googleClientSecret?: string;
  explicitCallbackUrl?: string;
  explicitPublicBaseUrl?: string;
  encryptionKeyConfigured?: boolean;
  requestOrigin?: string;
}

const PLACEHOLDER_URL_PATTERNS = [
  'your-backend',
  'your-domain',
  'your-render',
  'example.com',
  'example.org',
  'placeholder',
  '<your',
  'changeme',
];

const PLACEHOLDER_CREDENTIAL_PATTERN =
  /^(your[-_]|replace[-_]|placeholder|example|dummy|changeme|paste[-_]|<)/i;

function isLocalHost(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1';
}

function containsPlaceholderUrl(rawUrl: string): boolean {
  const lower = rawUrl.toLowerCase();
  return PLACEHOLDER_URL_PATTERNS.some((marker) => lower.includes(marker));
}

function validateGoogleClientId(clientId: string): { configured: boolean; valid: boolean; error?: string } {
  const trimmed = clientId.trim();
  if (!trimmed) {
    return { configured: false, valid: false };
  }
  if (/\s/.test(trimmed) || PLACEHOLDER_CREDENTIAL_PATTERN.test(trimmed)) {
    return {
      configured: true,
      valid: false,
      error:
        'GOOGLE_CLIENT_ID appears to be a placeholder or contains whitespace. Set your real OAuth 2.0 Web Client ID from Google Cloud Console.',
    };
  }
  if (!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/i.test(trimmed)) {
    return {
      configured: true,
      valid: false,
      error:
        'GOOGLE_CLIENT_ID format is invalid. Expected a Google Cloud OAuth 2.0 Web Client ID ending with ".apps.googleusercontent.com".',
    };
  }
  return { configured: true, valid: true };
}

function validateGoogleClientSecret(clientSecret: string): {
  configured: boolean;
  valid: boolean;
  error?: string;
} {
  const trimmed = clientSecret.trim();
  if (!trimmed) {
    return { configured: false, valid: false };
  }
  if (/\s/.test(trimmed) || PLACEHOLDER_CREDENTIAL_PATTERN.test(trimmed) || trimmed.length < 8) {
    return {
      configured: true,
      valid: false,
      error:
        'GOOGLE_CLIENT_SECRET appears to be a placeholder or malformed. Copy the real Client Secret from Google Cloud Console (backend env only).',
    };
  }
  return { configured: true, valid: true };
}

export function resolveGoogleDriveCallbackConfig(input?: {
  isProduction?: boolean;
  port?: number;
  explicitCallbackUrl?: string;
  explicitPublicBaseUrl?: string;
  requestOrigin?: string;
}): {
  callbackUrl: string | null;
  callbackSource: GoogleDriveOAuthStatus['callbackSource'];
  callbackUsesHttps: boolean;
  callbackValid: boolean;
  callbackConfigured: boolean;
  publicBackendUrlConfigured: boolean;
  errors: string[];
  missingKeys: string[];
} {
  const isProd = input?.isProduction ?? env.isProduction;
  const port = input?.port ?? env.port;
  const explicitCallback = (
    input?.explicitCallbackUrl ??
    (process.env.GOOGLE_DRIVE_CALLBACK_URL?.trim() || env.rawGoogleDriveCallbackUrl)
  ).trim();
  const explicitPublicUrl = (
    input?.explicitPublicBaseUrl ??
    (process.env.APP_BASE_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      (env.hasExplicitPublicBaseUrl ? env.appBaseUrl : ''))
  ).trim();
  const publicBackendUrlConfigured = explicitPublicUrl.length > 0;

  const errors: string[] = [];
  const missingKeys: string[] = [];

  // 1. Explicit GOOGLE_DRIVE_CALLBACK_URL always takes precedence
  if (explicitCallback) {
    if (containsPlaceholderUrl(explicitCallback)) {
      errors.push(
        'GOOGLE_DRIVE_CALLBACK_URL contains a placeholder domain. Replace it with your actual HTTPS backend callback URL.'
      );
      return {
        callbackUrl: explicitCallback,
        callbackSource: 'explicit_env',
        callbackUsesHttps: explicitCallback.toLowerCase().startsWith('https://'),
        callbackValid: false,
        callbackConfigured: true,
        publicBackendUrlConfigured,
        errors,
        missingKeys,
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(explicitCallback);
    } catch {
      errors.push('GOOGLE_DRIVE_CALLBACK_URL is not a valid URL.');
      return {
        callbackUrl: null,
        callbackSource: 'explicit_env',
        callbackUsesHttps: false,
        callbackValid: false,
        callbackConfigured: false,
        publicBackendUrlConfigured,
        errors,
        missingKeys,
      };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      errors.push('GOOGLE_DRIVE_CALLBACK_URL must use http:// or https:// protocol.');
      return {
        callbackUrl: parsed.toString(),
        callbackSource: 'explicit_env',
        callbackUsesHttps: false,
        callbackValid: false,
        callbackConfigured: true,
        publicBackendUrlConfigured,
        errors,
        missingKeys,
      };
    }

    const usesHttps = parsed.protocol === 'https:';
    const local = isLocalHost(parsed.hostname);

    if (isProd && !usesHttps) {
      errors.push(
        `Production Google Drive OAuth callback URL must use HTTPS (received "${parsed.toString()}").`
      );
    } else if (!local && !usesHttps) {
      errors.push(
        `Google Drive OAuth callback URL for non-localhost domain "${parsed.hostname}" must use HTTPS.`
      );
    }

    if (isProd && local) {
      errors.push('Production GOOGLE_DRIVE_CALLBACK_URL cannot point to localhost or 127.0.0.1.');
    }

    if (!parsed.pathname.endsWith(GOOGLE_DRIVE_CALLBACK_PATH)) {
      errors.push(
        `GOOGLE_DRIVE_CALLBACK_URL path should end with "${GOOGLE_DRIVE_CALLBACK_PATH}".`
      );
    }

    return {
      callbackUrl: parsed.toString(),
      callbackSource: 'explicit_env',
      callbackUsesHttps: usesHttps,
      callbackValid: errors.length === 0,
      callbackConfigured: true,
      publicBackendUrlConfigured,
      errors,
      missingKeys,
    };
  }

  // 2. Configured public backend URL (APP_BASE_URL / APP_URL) — enforce HTTPS for non-localhost hosts
  if (explicitPublicUrl) {
    if (containsPlaceholderUrl(explicitPublicUrl)) {
      errors.push(
        'APP_BASE_URL / APP_URL contains a placeholder domain. Configure your real HTTPS backend URL.'
      );
      return {
        callbackUrl: null,
        callbackSource: 'public_base_url',
        callbackUsesHttps: false,
        callbackValid: false,
        callbackConfigured: false,
        publicBackendUrlConfigured: false,
        errors,
        missingKeys: ['GOOGLE_DRIVE_CALLBACK_URL (or APP_BASE_URL)'],
      };
    }

    let parsedBase: URL;
    try {
      parsedBase = new URL(explicitPublicUrl);
    } catch {
      errors.push('APP_BASE_URL / APP_URL is not a valid URL.');
      return {
        callbackUrl: null,
        callbackSource: 'public_base_url',
        callbackUsesHttps: false,
        callbackValid: false,
        callbackConfigured: false,
        publicBackendUrlConfigured: false,
        errors,
        missingKeys: ['GOOGLE_DRIVE_CALLBACK_URL (or APP_BASE_URL)'],
      };
    }

    const local = isLocalHost(parsedBase.hostname);
    if (isProd && local) {
      errors.push('Production APP_BASE_URL cannot point to localhost or 127.0.0.1.');
    }

    // Never emit http:// for non-localhost public domains (Cloud Run / Render TLS proxies)
    if (!local && parsedBase.protocol === 'http:') {
      parsedBase.protocol = 'https:';
    }

    const baseClean = parsedBase.origin;
    const resolvedUrl = `${baseClean}${GOOGLE_DRIVE_CALLBACK_PATH}`;
    const usesHttps = resolvedUrl.startsWith('https://');

    if (isProd && !usesHttps) {
      errors.push('Production OAuth callback URL must use HTTPS.');
    }

    return {
      callbackUrl: resolvedUrl,
      callbackSource: 'public_base_url',
      callbackUsesHttps: usesHttps,
      callbackValid: errors.length === 0,
      callbackConfigured: true,
      publicBackendUrlConfigured: true,
      errors,
      missingKeys,
    };
  }

  // 3. In production without GOOGLE_DRIVE_CALLBACK_URL or APP_BASE_URL/APP_URL,
  // fail cleanly instead of trusting raw proxy headers or falling back to http://localhost.
  if (isProd) {
    missingKeys.push('GOOGLE_DRIVE_CALLBACK_URL (or APP_BASE_URL)');
    errors.push(
      'Public backend URL is not configured in production. Set APP_BASE_URL or GOOGLE_DRIVE_CALLBACK_URL to your HTTPS Render Web Service URL.'
    );
    return {
      callbackUrl: null,
      callbackSource: 'missing',
      callbackUsesHttps: false,
      callbackValid: false,
      callbackConfigured: false,
      publicBackendUrlConfigured: false,
      errors,
      missingKeys,
    };
  }

  // 4. Development / test fallback: upgrade any non-localhost requestOrigin to https://
  const cleanOrigin = (input?.requestOrigin || '').trim().replace(/\/+$/, '');
  if (cleanOrigin && /^https?:\/\//i.test(cleanOrigin)) {
    try {
      const parsedOrigin = new URL(cleanOrigin);
      if (!isLocalHost(parsedOrigin.hostname) && parsedOrigin.protocol === 'http:') {
        parsedOrigin.protocol = 'https:';
      }
      const normalized = `${parsedOrigin.origin}${GOOGLE_DRIVE_CALLBACK_PATH}`;
      return {
        callbackUrl: normalized,
        callbackSource: 'request_origin',
        callbackUsesHttps: normalized.startsWith('https://'),
        callbackValid: true,
        callbackConfigured: true,
        publicBackendUrlConfigured: false,
        errors,
        missingKeys,
      };
    } catch {
      // Fall through to local dev default below
    }
  }

  const localFallback = `http://localhost:${port}${GOOGLE_DRIVE_CALLBACK_PATH}`;
  return {
    callbackUrl: localFallback,
    callbackSource: 'request_origin',
    callbackUsesHttps: false,
    callbackValid: true,
    callbackConfigured: true,
    publicBackendUrlConfigured: false,
    errors,
    missingKeys,
  };
}

export function evaluateGoogleDriveOAuthStatus(
  overrides?: OAuthConfigEvaluationInput
): GoogleDriveOAuthStatus {
  const isProd = overrides?.isProduction ?? env.isProduction;
  const rawClientId = overrides?.googleClientId ?? env.googleClientId;
  const rawClientSecret = overrides?.googleClientSecret ?? env.googleClientSecret;
  const encryptionKeyConfigured =
    overrides?.encryptionKeyConfigured ?? (env.hasExplicitStorageEncryptionKey || !isProd);

  const clientIdCheck = validateGoogleClientId(rawClientId);
  const clientSecretCheck = validateGoogleClientSecret(rawClientSecret);
  const callbackCheck = resolveGoogleDriveCallbackConfig({
    isProduction: isProd,
    port: overrides?.port,
    explicitCallbackUrl: overrides?.explicitCallbackUrl,
    explicitPublicBaseUrl: overrides?.explicitPublicBaseUrl,
    requestOrigin: overrides?.requestOrigin,
  });

  const missingConfigKeys: string[] = [];
  const configErrors: string[] = [];

  if (!clientIdCheck.configured) missingConfigKeys.push('GOOGLE_CLIENT_ID');
  if (clientIdCheck.error) configErrors.push(clientIdCheck.error);

  if (!clientSecretCheck.configured) missingConfigKeys.push('GOOGLE_CLIENT_SECRET');
  if (clientSecretCheck.error) configErrors.push(clientSecretCheck.error);

  for (const key of callbackCheck.missingKeys) {
    if (!missingConfigKeys.includes(key)) {
      missingConfigKeys.push(key);
    }
  }
  configErrors.push(...callbackCheck.errors);

  if (isProd && !encryptionKeyConfigured) {
    missingConfigKeys.push('GOOGLE_OAUTH_ENCRYPTION_KEY');
    configErrors.push(
      'GOOGLE_OAUTH_ENCRYPTION_KEY must be configured in production (32-byte hex secret) to encrypt OAuth refresh tokens.'
    );
  }

  const configured =
    clientIdCheck.configured &&
    clientIdCheck.valid &&
    clientSecretCheck.configured &&
    clientSecretCheck.valid &&
    callbackCheck.callbackConfigured &&
    callbackCheck.callbackValid &&
    (!isProd || callbackCheck.callbackUsesHttps) &&
    (!isProd || encryptionKeyConfigured) &&
    configErrors.length === 0;

  const manualStepsRemaining: string[] = [];
  if (!clientIdCheck.configured || !clientIdCheck.valid || !clientSecretCheck.configured || !clientSecretCheck.valid) {
    manualStepsRemaining.push(
      'Create an OAuth 2.0 Web Application Client ID in Google Cloud Console (APIs & Services -> Credentials).'
    );
    manualStepsRemaining.push(
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your backend server environment variables (Render Web Service or local .env) and redeploy/restart.'
    );
  }
  if (!callbackCheck.callbackConfigured || !callbackCheck.callbackValid || (isProd && !callbackCheck.callbackUsesHttps)) {
    manualStepsRemaining.push(
      'Set APP_BASE_URL and GOOGLE_DRIVE_CALLBACK_URL to your HTTPS backend domain (ending in /api/v1/storage/google-drive/oauth/callback).'
    );
  }
  if (isProd && !encryptionKeyConfigured) {
    manualStepsRemaining.push(
      'Generate and set GOOGLE_OAUTH_ENCRYPTION_KEY (64-char hex via `openssl rand -hex 32`) on your backend server.'
    );
  }
  manualStepsRemaining.push(
    callbackCheck.callbackUrl
      ? `Add "${callbackCheck.callbackUrl}" to Google Cloud Console -> Authorized redirect URIs.`
      : 'Add your HTTPS callback URL to Google Cloud Console -> Authorized redirect URIs.'
  );
  manualStepsRemaining.push(
    'If your Google Auth Platform consent screen is in Testing mode, add every Gmail account you want to connect under Test Users.'
  );

  return {
    configured,
    clientIdConfigured: clientIdCheck.configured,
    clientIdValid: clientIdCheck.valid,
    clientSecretConfigured: clientSecretCheck.configured,
    clientSecretValid: clientSecretCheck.valid,
    callbackConfigured: callbackCheck.callbackConfigured,
    callbackUrl: callbackCheck.callbackUrl,
    callbackUsesHttps: callbackCheck.callbackUsesHttps,
    callbackValid: callbackCheck.callbackValid,
    callbackSource: callbackCheck.callbackSource,
    publicBackendUrlConfigured: callbackCheck.publicBackendUrlConfigured,
    isProduction: isProd,
    scopes: GOOGLE_DRIVE_MINIMAL_SCOPES,
    encryptionKeyConfigured,
    missingConfigKeys,
    configErrors,
    manualStepsRemaining,
  };
}

export function resolveGoogleDriveCallbackUrl(requestOrigin?: string): string | null {
  return resolveGoogleDriveCallbackConfig({ requestOrigin }).callbackUrl;
}

interface OAuthStateRecord {
  nonce: string;
  adminUid: string;
  redirectUri: string;
  accountLabel: string | null;
  priority: number | null;
  isDefault: boolean | null;
  reconnectAccountId: string | null;
  expiresAt: string;
  createdAt: string;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LOCAL_OAUTH_STATE_PATH = path.resolve(process.cwd(), '.oauth-states-dev.json');

function useFirestoreOAuthStates(): boolean {
  const state = getFirebaseAdminState();
  return Boolean(state.firestore && state.hasFullAdminCredentials);
}

function readLocalOAuthStates(): Record<string, OAuthStateRecord> {
  try {
    if (!fs.existsSync(LOCAL_OAUTH_STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_OAUTH_STATE_PATH, 'utf8')) as Record<
      string,
      OAuthStateRecord
    >;
  } catch {
    return {};
  }
}

function writeLocalOAuthStates(records: Record<string, OAuthStateRecord>): void {
  if (env.isProduction) {
    throw new Error('Firestore Admin credentials required in production for OAuth states.');
  }
  fs.writeFileSync(LOCAL_OAUTH_STATE_PATH, JSON.stringify(records, null, 2), { mode: 0o600 });
}

async function saveOAuthState(record: OAuthStateRecord): Promise<void> {
  if (useFirestoreOAuthStates()) {
    const db = getFirebaseAdminState().firestore!;
    await db.collection('oauth_states').doc(record.nonce).set(record);
    return;
  }
  const all = readLocalOAuthStates();
  const now = Date.now();
  for (const [key, item] of Object.entries(all)) {
    if (new Date(item.expiresAt).getTime() <= now) {
      delete all[key];
    }
  }
  all[record.nonce] = record;
  writeLocalOAuthStates(all);
}

async function consumeOAuthState(nonce: string): Promise<OAuthStateRecord | null> {
  if (!nonce || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) {
    return null;
  }

  let record: OAuthStateRecord | null = null;
  if (useFirestoreOAuthStates()) {
    const db = getFirebaseAdminState().firestore!;
    const ref = db.collection('oauth_states').doc(nonce);
    const snap = await ref.get();
    if (!snap.exists) return null;
    record = snap.data() as OAuthStateRecord;
    await ref.delete().catch(() => {});
  } else {
    const all = readLocalOAuthStates();
    record = all[nonce] ?? null;
    if (record) {
      delete all[nonce];
      writeLocalOAuthStates(all);
    }
  }

  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  return record;
}

function createOAuthClient(redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    ...(redirectUri ? { redirectUri } : {}),
  });
}

function isRevokedOAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('invalid_grant') ||
    msg.includes('token has been expired or revoked') ||
    msg.includes('invalid_token') ||
    (err instanceof GoogleDriveApiHttpError && err.status === 401)
  );
}

function sanitizeGoogleOAuthError(err: unknown, callbackUrl?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('invalid_client')) {
    return 'Google OAuth failed (invalid_client): Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your backend environment variables and redeploy.';
  }
  if (lower.includes('redirect_uri_mismatch')) {
    return `Google OAuth failed (redirect_uri_mismatch): Register this exact HTTPS Callback URL in Google Cloud Console -> Authorized redirect URIs: ${callbackUrl || ''}`;
  }
  if (lower.includes('invalid_grant')) {
    return 'Google OAuth authorization code expired or was already used. Please retry connecting Google Drive.';
  }
  if (lower.includes('access_denied')) {
    return 'Google Drive authorization was cancelled before granting permission.';
  }
  // Never echo secret values even if upstream library ever included headers/body
  if (env.googleClientSecret && raw.includes(env.googleClientSecret)) {
    return 'Google OAuth token exchange failed due to server credential rejection. Check backend configuration.';
  }
  return raw || 'Google OAuth token exchange failed.';
}

export const GoogleDriveOAuthService = {
  getOAuthStatus(requestOrigin?: string): GoogleDriveOAuthStatus {
    return evaluateGoogleDriveOAuthStatus({ requestOrigin });
  },

  async startOAuthFlow(params: {
    adminUid: string;
    origin?: string;
    input: StartGoogleDriveOAuthInput;
  }): Promise<StartGoogleDriveOAuthResponse> {
    const status = evaluateGoogleDriveOAuthStatus({ requestOrigin: params.origin });

    if (!status.configured || !status.callbackUrl) {
      const errorCode =
        status.clientIdConfigured && status.clientSecretConfigured && !status.callbackValid
          ? 'GOOGLE_OAUTH_CALLBACK_INVALID'
          : 'GOOGLE_OAUTH_NOT_CONFIGURED';
      const primaryMessage =
        status.configErrors[0] ||
        `Google Drive OAuth 2.0 is not configured on this server. Missing: ${status.missingConfigKeys.join(', ')}.`;

      throw new AppError(primaryMessage, 503, errorCode, {
        missingConfigKeys: status.missingConfigKeys,
        configErrors: status.configErrors,
        callbackUrl: status.callbackUrl,
        callbackUsesHttps: status.callbackUsesHttps,
      });
    }

    const callbackUrl = status.callbackUrl;
    let loginHint: string | undefined;

    if (params.input.reconnectAccountId) {
      const existing = await StorageStore.getAccount(params.input.reconnectAccountId);
      if (!existing || existing.provider !== 'GOOGLE_DRIVE') {
        throw new AppError(
          'Google Drive account not found for reconnection.',
          404,
          'STORAGE_ACCOUNT_NOT_FOUND'
        );
      }
      if (existing.accountEmail) {
        loginHint = existing.accountEmail;
      }
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    const stateRecord: OAuthStateRecord = {
      nonce,
      adminUid: params.adminUid,
      redirectUri: callbackUrl,
      accountLabel: params.input.accountLabel?.trim() || null,
      priority: typeof params.input.priority === 'number' ? params.input.priority : null,
      isDefault: typeof params.input.isDefault === 'boolean' ? params.input.isDefault : null,
      reconnectAccountId: params.input.reconnectAccountId || null,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    };

    await saveOAuthState(stateRecord);

    const client = createOAuthClient(callbackUrl);
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_DRIVE_MINIMAL_SCOPES,
      state: nonce,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });

    return {
      authUrl,
      callbackUrl,
      scopes: GOOGLE_DRIVE_MINIMAL_SCOPES,
    };
  },

  async handleOAuthCallback(params: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<{ ok: boolean; account?: StorageAccount; errorMessage?: string }> {
    if (params.error) {
      const desc = params.errorDescription || params.error;
      if (params.state) {
        await consumeOAuthState(params.state).catch(() => null);
      }
      return {
        ok: false,
        errorMessage:
          params.error === 'access_denied'
            ? 'Google Drive authorization was cancelled before granting permission.'
            : `Google OAuth returned an error: ${desc}`,
      };
    }

    if (!params.state || !params.code) {
      return {
        ok: false,
        errorMessage: 'Missing OAuth authorization code or CSRF state token.',
      };
    }

    const stateRecord = await consumeOAuthState(params.state);
    if (!stateRecord) {
      return {
        ok: false,
        errorMessage:
          'Invalid, expired, or already used OAuth CSRF state. Please retry connecting Google Drive.',
      };
    }

    if (!env.hasGoogleOAuthCredentials) {
      return {
        ok: false,
        errorMessage: 'Google OAuth credentials are missing on the server.',
      };
    }

    if (env.isProduction && !stateRecord.redirectUri.startsWith('https://')) {
      return {
        ok: false,
        errorMessage: 'Production OAuth callback state must use HTTPS.',
      };
    }

    try {
      const client = createOAuthClient(stateRecord.redirectUri);
      const tokenResponse = await client.getToken({
        code: params.code,
        redirect_uri: stateRecord.redirectUri,
      });

      const tokens = tokenResponse.tokens;
      const accessToken = tokens.access_token;
      if (!accessToken) {
        return {
          ok: false,
          errorMessage: 'Google OAuth did not return an access token.',
        };
      }

      // Fetch real Google user identity & Drive storage quota
      const [userInfo, aboutInfo] = await Promise.all([
        GoogleDriveApi.fetchUserInfo(accessToken),
        GoogleDriveApi.fetchAboutAndQuota(accessToken),
      ]);

      const driveEmail = (aboutInfo.userEmail || userInfo.email).trim().toLowerCase();
      const driveDisplayName = aboutInfo.userDisplayName || userInfo.name || null;

      // Determine whether updating existing Drive account (reconnect or same Gmail) or adding new one
      const allAccounts = await StorageStore.listAccounts();
      let targetExisting: StorageAccount | undefined;

      if (stateRecord.reconnectAccountId) {
        targetExisting = allAccounts.find((a) => a.id === stateRecord.reconnectAccountId);
      }
      if (!targetExisting) {
        targetExisting = allAccounts.find(
          (a) => a.provider === 'GOOGLE_DRIVE' && a.accountEmail?.toLowerCase() === driveEmail
        );
      }

      const existingSecretBlob = targetExisting
        ? await StorageStore.getSecret(targetExisting.id)
        : null;
      const existingCreds = existingSecretBlob
        ? decryptProviderCredentials(existingSecretBlob)
        : null;

      const refreshToken = tokens.refresh_token || existingCreds?.refreshToken;
      if (!refreshToken) {
        return {
          ok: false,
          errorMessage:
            'Google did not return a refresh token. Remove app access in Google Account permissions and reconnect with consent.',
        };
      }

      const folderId = await GoogleDriveApi.ensureStudioFolder(
        accessToken,
        targetExisting?.driveFolderId ?? null
      );

      const now = new Date().toISOString();
      const accountId =
        targetExisting?.id ?? `drv_${crypto.randomUUID().replace(/-/g, '')}`;

      const hasDefaultDrive = allAccounts.some((a) => a.id !== accountId && a.isDefault);
      const shouldBeDefault =
        stateRecord.isDefault !== null
          ? stateRecord.isDefault
          : targetExisting
            ? targetExisting.isDefault
            : !hasDefaultDrive;

      if (shouldBeDefault) {
        for (const acc of allAccounts) {
          if (acc.id !== accountId && acc.isDefault) {
            await StorageStore.saveAccount({ ...acc, isDefault: false, updatedAt: now });
          }
        }
      }

      const nextPriority =
        stateRecord.priority !== null
          ? stateRecord.priority
          : targetExisting
            ? targetExisting.priority
            : allAccounts.length > 0
              ? Math.max(...allAccounts.map((a) => a.priority)) + 1
              : 1;

      const quotaLimit = aboutInfo.quota.limitBytes ?? 0;
      const usedBytes =
        aboutInfo.quota.totalAccountUsageBytes ?? aboutInfo.quota.usageInDriveBytes ?? 0;
      const grantedScopes = tokens.scope
        ? tokens.scope.split(/\s+/).filter(Boolean)
        : GOOGLE_DRIVE_MINIMAL_SCOPES;

      const studioFilesForAccount = (await StorageStore.listFiles()).filter(
        (f) => f.accountId === accountId
      );

      const accountRecord: StorageAccount = {
        id: accountId,
        ownerUid: targetExisting?.ownerUid || stateRecord.adminUid,
        provider: 'GOOGLE_DRIVE',
        accountName:
          stateRecord.accountLabel ||
          targetExisting?.accountName ||
          (driveDisplayName ? `${driveDisplayName} (${driveEmail})` : driveEmail),
        accountEmail: driveEmail,
        accountDisplayName: driveDisplayName,
        accountIdExternal: aboutInfo.permissionId || userInfo.id || driveEmail,
        driveFolderId: folderId,
        bucketName: 'My Drive / YouTube Live Automation Studio',
        region: 'google-drive',
        endpoint: 'https://www.googleapis.com/drive/v3',
        gcsAuthMode: null,
        oauthScopes: grantedScopes,
        tokenStatus: 'VALID',
        accessKeyPreview: driveEmail,
        quotaBytes: quotaLimit,
        usedBytes,
        reservedBytes: targetExisting?.reservedBytes ?? 0,
        measuredUsedBytes: aboutInfo.quota.usageInDriveBytes,
        measuredObjectCount: studioFilesForAccount.length,
        usageMeasured: true,
        driveStorageQuota: aboutInfo.quota,
        fileCount: targetExisting?.fileCount ?? studioFilesForAccount.length,
        isDefault: shouldBeDefault,
        priority: nextPriority,
        status: 'CONNECTED',
        lastConnectedAt: now,
        lastHealthCheckAt: now,
        lastHealthError: null,
        createdAt: targetExisting?.createdAt ?? now,
        updatedAt: now,
      };

      const encryptedSecret = encryptProviderCredentials({
        refreshToken,
        accessToken,
        expiryDateMs:
          typeof tokens.expiry_date === 'number'
            ? tokens.expiry_date
            : Date.now() + 3500 * 1000,
        tokenType: tokens.token_type || 'Bearer',
        scope: grantedScopes.join(' '),
      });

      await StorageStore.saveSecret(accountId, encryptedSecret);
      await StorageStore.saveAccount(accountRecord);

      await StorageStore.recordActivity({
        id: `act_${crypto.randomUUID().replace(/-/g, '')}`,
        ownerUid: stateRecord.adminUid,
        accountId,
        accountName: accountRecord.accountName,
        provider: 'GOOGLE_DRIVE',
        eventType: targetExisting ? 'DRIVE_RECONNECTED' : 'DRIVE_CONNECTED',
        status: 'SUCCESS',
        message: `${targetExisting ? 'Reconnected' : 'Connected'} Google Drive account ${driveEmail}.`,
        objectKey: null,
        bytesAffected: aboutInfo.quota.remainingBytes,
        createdAt: now,
      });

      return { ok: true, account: accountRecord };
    } catch (err) {
      const msg = sanitizeGoogleOAuthError(err, stateRecord.redirectUri);
      return { ok: false, errorMessage: msg };
    }
  },

  async getValidAccessToken(accountId: string): Promise<{
    accessToken: string;
    account: StorageAccount;
  }> {
    const account = await StorageStore.getAccount(accountId);
    if (!account) {
      throw new AppError('Google Drive account not found.', 404, 'STORAGE_ACCOUNT_NOT_FOUND');
    }
    if (account.provider !== 'GOOGLE_DRIVE') {
      throw new AppError('Account is not a Google Drive provider.', 400, 'INVALID_PROVIDER_TYPE');
    }
    if (account.status === 'DISCONNECTED') {
      throw new AppError(
        `Google Drive account "${account.accountName}" is disconnected. Reconnect it before proceeding.`,
        409,
        'STORAGE_NOT_CONNECTED'
      );
    }

    const secretBlob = await StorageStore.getSecret(accountId);
    if (!secretBlob) {
      await this.markAccountRevoked(
        account,
        'OAuth tokens are missing. Please reconnect Google Drive.'
      );
      throw new AppError(
        'Google Drive OAuth tokens are missing. Reconnect Google Drive.',
        401,
        'DRIVE_AUTH_REVOKED'
      );
    }

    const creds = decryptProviderCredentials(secretBlob);
    const nowMs = Date.now();

    // Use cached access token if it has > 90 seconds before expiry
    if (creds.accessToken && creds.expiryDateMs && creds.expiryDateMs - nowMs > 90_000) {
      return { accessToken: creds.accessToken, account };
    }

    if (!creds.refreshToken) {
      await this.markAccountRevoked(
        account,
        'Google Drive refresh token is missing. Please reconnect Google Drive.'
      );
      throw new AppError(
        'Google Drive authorization requires reconnection.',
        401,
        'DRIVE_AUTH_REVOKED'
      );
    }

    if (!env.hasGoogleOAuthCredentials) {
      throw new AppError(
        'Google OAuth credentials are not configured on the server to refresh tokens.',
        503,
        'GOOGLE_OAUTH_NOT_CONFIGURED'
      );
    }

    try {
      const client = createOAuthClient(resolveGoogleDriveCallbackUrl() ?? undefined);
      client.setCredentials({
        refresh_token: creds.refreshToken,
        access_token: creds.accessToken,
        expiry_date: creds.expiryDateMs,
      });

      const refreshed = await client.refreshAccessToken();
      const newTokens = refreshed.credentials;
      const newAccessToken = newTokens.access_token;
      if (!newAccessToken) {
        throw new Error('Refresh response did not include access_token');
      }

      const updatedEncrypted = encryptProviderCredentials({
        refreshToken: newTokens.refresh_token || creds.refreshToken,
        accessToken: newAccessToken,
        expiryDateMs:
          typeof newTokens.expiry_date === 'number'
            ? newTokens.expiry_date
            : Date.now() + 3500 * 1000,
        tokenType: newTokens.token_type || creds.tokenType || 'Bearer',
        scope: newTokens.scope || creds.scope,
      });

      await StorageStore.saveSecret(accountId, updatedEncrypted);

      if (account.tokenStatus !== 'VALID' || account.status === 'REVOKED') {
        const recovered: StorageAccount = {
          ...account,
          status: 'CONNECTED',
          tokenStatus: 'VALID',
          lastHealthError: null,
          updatedAt: new Date().toISOString(),
        };
        await StorageStore.saveAccount(recovered);
        return { accessToken: newAccessToken, account: recovered };
      }

      return { accessToken: newAccessToken, account };
    } catch (err) {
      if (isRevokedOAuthError(err)) {
        const message =
          'Google Drive access was revoked or expired (invalid_grant). Click Reconnect Google Drive to re-authorize.';
        await this.markAccountRevoked(account, message);
        throw new AppError(message, 401, 'DRIVE_AUTH_REVOKED');
      }
      const msg = sanitizeGoogleOAuthError(err);
      throw new AppError(msg, 502, 'DRIVE_TOKEN_REFRESH_FAILED');
    }
  },

  async markAccountRevoked(account: StorageAccount, reason: string): Promise<StorageAccount> {
    const now = new Date().toISOString();
    const updated: StorageAccount = {
      ...account,
      status: 'REVOKED',
      tokenStatus: 'REVOKED',
      lastHealthCheckAt: now,
      lastHealthError: reason,
      updatedAt: now,
    };
    await StorageStore.saveAccount(updated);
    await StorageStore.recordActivity({
      id: `act_${crypto.randomUUID().replace(/-/g, '')}`,
      ownerUid: account.ownerUid,
      accountId: account.id,
      accountName: account.accountName,
      provider: 'GOOGLE_DRIVE',
      eventType: 'DRIVE_TOKEN_REVOKED',
      status: 'ERROR',
      message: reason,
      objectKey: null,
      bytesAffected: null,
      createdAt: now,
    });
    return updated;
  },
};
