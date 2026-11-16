import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

interface AppletFirebaseConfig {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
}

function loadAppletFirebaseConfig(): AppletFirebaseConfig | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as AppletFirebaseConfig;
  } catch {
    return null;
  }
}

const appletConfig = loadAppletFirebaseConfig();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().trim().optional().default(''),
  APP_BASE_URL: z.string().trim().optional().default(''),
  CORS_ORIGINS: z
    .string()
    .trim()
    .optional()
    .default('http://localhost:3000,http://localhost:5173,https://yt-live-stream-x53v.onrender.com'),
  SERVE_STATIC: z
    .string()
    .trim()
    .optional()
    .default('true')
    .transform((val) => val.toLowerCase() !== 'false'),

  // Firebase Admin / Project configuration
  FIREBASE_PROJECT_ID: z.string().trim().optional().default(''),
  FIREBASE_DATABASE_ID: z.string().trim().optional().default(''),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().trim().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().trim().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().trim().optional().default(''),

  // Multiple authorized Gmail admin allowlist (server-side)
  ADMIN_EMAILS: z.string().trim().optional().default(''),
  FIREBASE_ADMIN_EMAIL: z.string().trim().optional().default(''),
  FIREBASE_ADMIN_UID: z.string().trim().optional().default(''),

  // Google Drive OAuth 2.0 & Server-only encryption keys
  GOOGLE_CLIENT_ID: z.string().trim().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional().default(''),
  GOOGLE_DRIVE_CALLBACK_URL: z.string().trim().optional().default(''),
  GOOGLE_OAUTH_ENCRYPTION_KEY: z.string().trim().optional().default(''),
  STORAGE_ENCRYPTION_KEY: z.string().trim().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid server environment configuration:', parsed.error.issues);
  throw new Error('Server environment configuration validation failed.');
}

const rawEnv = parsed.data;

const firebaseProjectId =
  rawEnv.FIREBASE_PROJECT_ID || appletConfig?.projectId?.trim() || '';

const firebaseDatabaseId =
  rawEnv.FIREBASE_DATABASE_ID || appletConfig?.firestoreDatabaseId?.trim() || '(default)';

const hasServiceAccountJson = rawEnv.FIREBASE_SERVICE_ACCOUNT_JSON.length > 0;
const hasExplicitKeyPair =
  rawEnv.FIREBASE_CLIENT_EMAIL.length > 0 && rawEnv.FIREBASE_PRIVATE_KEY.length > 0;

// Normalize ADMIN_EMAILS + FIREBASE_ADMIN_EMAIL into an explicit deduplicated allowlist
const emailValidator = z.string().email();
const adminEmailsSet = new Set<string>();
const mergedRawEmails = [rawEnv.ADMIN_EMAILS, rawEnv.FIREBASE_ADMIN_EMAIL].join(',');
for (const piece of mergedRawEmails.split(',')) {
  const normalized = piece.trim().toLowerCase();
  if (normalized && emailValidator.safeParse(normalized).success) {
    adminEmailsSet.add(normalized);
  }
}

const adminEmails = Array.from(adminEmailsSet);
const primaryAdminEmail = adminEmails[0] || '';
const isAdminEmailConfigured = adminEmails.length > 0;

const isProduction = rawEnv.NODE_ENV === 'production';

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '[::1]';
}

function normalizeConfiguredBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsedUrl = new URL(trimmed);
    if (!isLocalHostname(parsedUrl.hostname) && parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:';
    }
    return parsedUrl.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function normalizeOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

const explicitPublicBaseUrl = normalizeConfiguredBaseUrl(rawEnv.APP_BASE_URL || rawEnv.APP_URL);
const explicitDriveCallbackUrl = rawEnv.GOOGLE_DRIVE_CALLBACK_URL.trim();

const appBaseUrl = explicitPublicBaseUrl || (isProduction ? '' : `http://localhost:${rawEnv.PORT}`);

const corsOriginsSet = new Set<string>();
for (const rawOrigin of rawEnv.CORS_ORIGINS.split(',')) {
  const norm = normalizeOrigin(rawOrigin);
  if (norm) corsOriginsSet.add(norm);
}
if (appBaseUrl) {
  const normBase = normalizeOrigin(appBaseUrl);
  if (normBase) corsOriginsSet.add(normBase);
}
if (rawEnv.APP_URL.trim()) {
  const normApp = normalizeOrigin(normalizeConfiguredBaseUrl(rawEnv.APP_URL));
  if (normApp) corsOriginsSet.add(normApp);
}
const corsOriginsList = Array.from(corsOriginsSet);

const googleDriveCallbackUrl = explicitDriveCallbackUrl
  ? explicitDriveCallbackUrl
  : appBaseUrl
    ? `${appBaseUrl}/api/v1/storage/google-drive/oauth/callback`
    : '';

const effectiveEncryptionKey =
  rawEnv.GOOGLE_OAUTH_ENCRYPTION_KEY || rawEnv.STORAGE_ENCRYPTION_KEY;

export const env = {
  nodeEnv: rawEnv.NODE_ENV,
  isProduction,
  isDevelopment: rawEnv.NODE_ENV === 'development',
  port: rawEnv.PORT,
  appUrl: appBaseUrl,
  appBaseUrl,
  rawAppUrl: rawEnv.APP_URL.trim(),
  rawAppBaseUrl: rawEnv.APP_BASE_URL.trim(),
  hasExplicitPublicBaseUrl: explicitPublicBaseUrl.length > 0,
  corsOrigins: corsOriginsList,
  serveStatic: rawEnv.SERVE_STATIC,

  firebaseProjectId,
  firebaseDatabaseId,
  firebaseServiceAccountJson: rawEnv.FIREBASE_SERVICE_ACCOUNT_JSON,
  firebaseClientEmail: rawEnv.FIREBASE_CLIENT_EMAIL,
  firebasePrivateKey: rawEnv.FIREBASE_PRIVATE_KEY,
  hasExplicitAdminCredentials: hasServiceAccountJson || hasExplicitKeyPair,
  hasAppletFirebaseConfig: Boolean(appletConfig?.projectId),

  adminEmails,
  primaryAdminEmail,
  firebaseAdminEmail: primaryAdminEmail,
  isAdminEmailConfigured,
  firebaseAdminUid: rawEnv.FIREBASE_ADMIN_UID,

  googleClientId: rawEnv.GOOGLE_CLIENT_ID,
  googleClientSecret: rawEnv.GOOGLE_CLIENT_SECRET,
  rawGoogleDriveCallbackUrl: explicitDriveCallbackUrl,
  hasExplicitGoogleDriveCallbackUrl: explicitDriveCallbackUrl.length > 0,
  googleDriveCallbackUrl,
  hasGoogleOAuthCredentials:
    rawEnv.GOOGLE_CLIENT_ID.length > 0 && rawEnv.GOOGLE_CLIENT_SECRET.length > 0,

  googleOAuthEncryptionKey: rawEnv.GOOGLE_OAUTH_ENCRYPTION_KEY,
  storageEncryptionKey: effectiveEncryptionKey,
  hasExplicitStorageEncryptionKey: effectiveEncryptionKey.length >= 16,
} as const;
