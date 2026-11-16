import crypto from 'node:crypto';
import {
  DRIVE_CHUNK_ALIGNMENT_BYTES,
  MAX_MULTIPART_PART_BYTES,
  MIN_MULTIPART_PART_BYTES,
  type CompletedUploadPart,
  type CompleteUploadInput,
  type CreateStorageAccountInput,
  type InitiateUploadInput,
  type InitiateUploadResponse,
  type PartUrlsResponse,
  type RemoteObjectMetadata,
  type ResumeUploadResponse,
  type StorageAccount,
  type StorageFileRecord,
  type StorageHealthCheckResult,
  type StorageOverviewPayload,
  type UpdateStorageAccountInput,
  type UploadSessionRecord,
} from '../../shared/types/storage';
import { env } from '../config/env';
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
  maskAccessKeyPreview,
  type ProviderCredentialsPayload,
} from '../crypto/secretVault';
import { AppError } from '../errors/AppError';
import {
  getProviderAdapter,
  resolveNormalizedEndpoint,
  resolveNormalizedRegion,
} from './providers';
import { GoogleDriveApi, GoogleDriveApiHttpError } from './providers/googleDriveApi';
import { GoogleDriveOAuthService } from './providers/googleDriveOAuth';
import { StorageStore } from './storageStore';

const SINGLE_PUT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;
const PRESIGNED_URL_TTL_SECONDS = 900;

const ALLOWED_MIME_PREFIXES = ['video/', 'audio/', 'image/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/octet-stream',
  'application/mp4',
  'application/x-matroska',
]);
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.html',
  '.htm',
  '.svg',
  '.js',
  '.mjs',
  '.cjs',
  '.php',
]);

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function sanitizeFilename(rawName: string): string {
  const base = rawName.split(/[/\\]/).pop() || 'upload.bin';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return cleaned || 'upload.bin';
}

function validateFileCandidate(fileName: string, fileSizeBytes: number, contentType: string): void {
  const lowerName = fileName.toLowerCase();
  const dotIdx = lowerName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? lowerName.slice(dotIdx) : '';
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    throw new AppError(
      `File extension "${ext}" is blocked by storage security policy.`,
      400,
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  const normalizedType = contentType.trim().toLowerCase() || 'application/octet-stream';
  const isAllowedType =
    ALLOWED_MIME_PREFIXES.some((prefix) => normalizedType.startsWith(prefix)) ||
    ALLOWED_EXACT_MIMES.has(normalizedType);

  if (!isAllowedType) {
    throw new AppError(
      `File content type "${normalizedType}" is not permitted for studio media storage.`,
      400,
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new AppError('File size must be a positive integer.', 400, 'INVALID_FILE_SIZE');
  }

  if (fileSizeBytes > MAX_UPLOAD_BYTES) {
    throw new AppError(
      'File size exceeds the 50 GB maximum single-upload safeguard.',
      400,
      'FILE_TOO_LARGE'
    );
  }
}

function buildSafeObjectKey(sessionId: string, fileName: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeName = sanitizeFilename(fileName);
  return `studio/uploads/${yyyy}/${mm}/${sessionId}-${safeName}`;
}

function resolveDriveChunkSizeBytes(fileSizeBytes: number, preferredChunkSize?: number): number {
  let target = preferredChunkSize || 8 * 1024 * 1024;
  if (!preferredChunkSize) {
    if (fileSizeBytes < 100 * 1024 * 1024) {
      target = 4 * 1024 * 1024;
    } else if (fileSizeBytes < 1024 * 1024 * 1024) {
      target = 8 * 1024 * 1024;
    } else {
      target = 16 * 1024 * 1024;
    }
  }
  const bounded = Math.max(DRIVE_CHUNK_ALIGNMENT_BYTES, Math.min(64 * 1024 * 1024, target));
  return Math.max(
    DRIVE_CHUNK_ALIGNMENT_BYTES,
    Math.round(bounded / DRIVE_CHUNK_ALIGNMENT_BYTES) * DRIVE_CHUNK_ALIGNMENT_BYTES
  );
}

function resolveS3ChunkSizeBytes(fileSizeBytes: number, preferredChunkSize?: number): number {
  if (fileSizeBytes <= SINGLE_PUT_MAX_BYTES) {
    return fileSizeBytes;
  }

  let chunkSize = preferredChunkSize || 0;
  if (!chunkSize) {
    if (fileSizeBytes < 250 * 1024 * 1024) {
      chunkSize = 8 * 1024 * 1024;
    } else if (fileSizeBytes < 2 * 1024 * 1024 * 1024) {
      chunkSize = 16 * 1024 * 1024;
    } else if (fileSizeBytes < 10 * 1024 * 1024 * 1024) {
      chunkSize = 32 * 1024 * 1024;
    } else {
      chunkSize = 64 * 1024 * 1024;
    }
  }

  chunkSize = Math.max(MIN_MULTIPART_PART_BYTES, Math.min(MAX_MULTIPART_PART_BYTES, chunkSize));
  const minFor10kParts = Math.ceil(fileSizeBytes / 9500);
  if (chunkSize < minFor10kParts) {
    chunkSize = Math.min(
      MAX_MULTIPART_PART_BYTES,
      Math.ceil(minFor10kParts / (1024 * 1024)) * 1024 * 1024
    );
  }

  return chunkSize;
}

function computeRemainingSpaceBytes(account: StorageAccount): number {
  if (account.provider === 'GOOGLE_DRIVE' && account.driveStorageQuota) {
    if (account.driveStorageQuota.isUnlimited) {
      return Number.MAX_SAFE_INTEGER;
    }
    const baseRemaining = account.driveStorageQuota.remainingBytes ?? 0;
    return Math.max(0, baseRemaining - account.reservedBytes);
  }
  return Math.max(0, account.quotaBytes - (account.usedBytes + account.reservedBytes));
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function logActivity(params: {
  ownerUid: string;
  account?: Pick<StorageAccount, 'id' | 'accountName' | 'provider'> | null;
  eventType: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  objectKey?: string | null;
  bytesAffected?: number | null;
}): Promise<void> {
  await StorageStore.recordActivity({
    id: generateId('act'),
    ownerUid: params.ownerUid,
    accountId: params.account?.id ?? null,
    accountName: params.account?.accountName ?? null,
    provider: params.account?.provider ?? null,
    eventType: params.eventType,
    status: params.status,
    message: params.message.slice(0, 500),
    objectKey: params.objectKey ?? null,
    bytesAffected: params.bytesAffected ?? null,
    createdAt: new Date().toISOString(),
  });
}

async function loadAccountAndCredentials(
  accountId: string
): Promise<{ account: StorageAccount; credentials: ProviderCredentialsPayload }> {
  const account = await StorageStore.getAccount(accountId);
  if (!account) {
    throw new AppError('Storage account not found.', 404, 'STORAGE_ACCOUNT_NOT_FOUND');
  }

  if (account.provider === 'GOOGLE_DRIVE') {
    const { accessToken, account: refreshedAccount } =
      await GoogleDriveOAuthService.getValidAccessToken(accountId);
    return {
      account: {
        ...refreshedAccount,
        accountIdExternal: refreshedAccount.driveFolderId || refreshedAccount.accountIdExternal,
      },
      credentials: { accessToken },
    };
  }

  const secretBlob = await StorageStore.getSecret(accountId);
  if (!secretBlob) {
    throw new AppError(
      'Encrypted credentials for this storage account are missing.',
      500,
      'STORAGE_CREDENTIALS_MISSING'
    );
  }
  const credentials = decryptProviderCredentials(secretBlob);
  return { account, credentials };
}

export const StorageService = {
  async getOverview(requestOrigin?: string): Promise<StorageOverviewPayload> {
    const [accounts, files, activeSessions, recentActivity] = await Promise.all([
      StorageStore.listAccounts(),
      StorageStore.listFiles(),
      StorageStore.listActiveUploadSessions(),
      StorageStore.listActivity(40),
    ]);

    const connectedAccounts = accounts.filter((a) => a.status === 'CONNECTED').length;
    const revokedAccounts = accounts.filter((a) => a.status === 'REVOKED').length;
    const errorAccounts = accounts.filter((a) => a.status === 'ERROR').length;
    const defaultAccount = accounts.find((a) => a.isDefault) || null;
    const totalUploadedBytesTracked = files.reduce((sum, f) => sum + f.fileSizeBytes, 0);

    return {
      persistenceMode: StorageStore.getPersistenceMode(),
      encryptionKeyConfigured: env.hasExplicitStorageEncryptionKey || !env.isProduction,
      googleDriveOAuth: GoogleDriveOAuthService.getOAuthStatus(requestOrigin),
      totalAccounts: accounts.length,
      connectedAccounts,
      revokedAccounts,
      errorAccounts,
      defaultAccountId: defaultAccount?.id ?? null,
      totalFilesCount: files.length,
      totalUploadedBytesTracked,
      accounts,
      files,
      activeSessions,
      recentActivity,
    };
  },

  async createAndVerifyAccount(
    ownerUid: string,
    input: CreateStorageAccountInput
  ): Promise<StorageAccount> {
    const provider = input.provider;
    const endpoint = resolveNormalizedEndpoint({
      provider,
      endpoint: input.endpoint,
      accountIdExternal: input.accountIdExternal,
    });
    const region = resolveNormalizedRegion({ provider, region: input.region });

    const gcsAuthMode =
      provider === 'GOOGLE_CLOUD_STORAGE'
        ? input.gcsAuthMode || (input.serviceAccountJson ? 'SERVICE_ACCOUNT' : 'HMAC_S3')
        : null;

    const credentials: ProviderCredentialsPayload =
      provider === 'GOOGLE_CLOUD_STORAGE' && gcsAuthMode === 'SERVICE_ACCOUNT'
        ? { serviceAccountJson: input.serviceAccountJson?.trim() }
        : {
            accessKeyId: input.accessKeyId?.trim(),
            secretAccessKey: input.secretAccessKey?.trim(),
          };

    if (provider === 'CLOUDFLARE_R2' && !endpoint && !input.accountIdExternal?.trim()) {
      throw new AppError(
        'Cloudflare R2 requires Account ID or an explicit S3 endpoint.',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (provider === 'S3_COMPATIBLE' && !endpoint) {
      throw new AppError(
        'S3-Compatible providers require an explicit endpoint URL.',
        400,
        'VALIDATION_ERROR'
      );
    }

    const tempAccountSlice = {
      provider,
      bucketName: input.bucketName.trim(),
      region,
      endpoint,
      accountIdExternal: input.accountIdExternal?.trim() || null,
      gcsAuthMode,
    };

    const adapter = getProviderAdapter(provider);
    const verification = await adapter.verifyConnection(tempAccountSlice, credentials);

    if (!verification.ok) {
      await logActivity({
        ownerUid,
        eventType: 'PROVIDER_VERIFY_FAILED',
        status: 'ERROR',
        message: `Connection verification failed for "${input.accountName.trim()}" (${input.bucketName.trim()}): ${verification.message}`,
      });
      throw new AppError(
        `Storage verification failed: ${verification.message}`,
        400,
        'STORAGE_VERIFICATION_FAILED'
      );
    }

    const existingAccounts = await StorageStore.listAccounts();
    const shouldBeDefault = input.isDefault ?? existingAccounts.length === 0;
    const nextPriority =
      input.priority ??
      (existingAccounts.length > 0
        ? Math.max(...existingAccounts.map((a) => a.priority)) + 1
        : 1);

    const quotaGb =
      typeof input.quotaGb === 'number' && input.quotaGb > 0 ? input.quotaGb : 10;
    const quotaBytes = Math.round(quotaGb * 1024 * 1024 * 1024);

    if (shouldBeDefault) {
      for (const acc of existingAccounts) {
        if (acc.isDefault) {
          await StorageStore.saveAccount({
            ...acc,
            isDefault: false,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    const now = new Date().toISOString();
    const accountId = generateId('stg');
    const newAccount: StorageAccount = {
      id: accountId,
      ownerUid,
      provider,
      accountName: input.accountName.trim(),
      accountEmail: null,
      accountDisplayName: null,
      accountIdExternal: input.accountIdExternal?.trim() || null,
      driveFolderId: null,
      bucketName: input.bucketName.trim(),
      region,
      endpoint,
      gcsAuthMode,
      oauthScopes: [],
      tokenStatus: 'NOT_APPLICABLE',
      accessKeyPreview:
        gcsAuthMode === 'SERVICE_ACCOUNT'
          ? 'GCS Service Account'
          : maskAccessKeyPreview(credentials.accessKeyId),
      quotaBytes,
      usedBytes: verification.measuredUsedBytes ?? 0,
      reservedBytes: 0,
      measuredUsedBytes: verification.measuredUsedBytes,
      measuredObjectCount: verification.measuredObjectCount,
      usageMeasured: verification.measuredUsedBytes !== null,
      driveStorageQuota: null,
      fileCount: verification.measuredObjectCount ?? 0,
      isDefault: shouldBeDefault,
      priority: nextPriority,
      status: 'CONNECTED',
      lastConnectedAt: now,
      lastHealthCheckAt: now,
      lastHealthError: null,
      createdAt: now,
      updatedAt: now,
    };

    const encrypted = encryptProviderCredentials(credentials);
    await StorageStore.saveSecret(accountId, encrypted);
    await StorageStore.saveAccount(newAccount);

    await logActivity({
      ownerUid,
      account: newAccount,
      eventType: 'PROVIDER_CONNECTED',
      status: 'SUCCESS',
      message: verification.message,
      bytesAffected: verification.measuredUsedBytes,
    });

    return newAccount;
  },

  async updateAccount(
    accountId: string,
    ownerUid: string,
    input: UpdateStorageAccountInput
  ): Promise<StorageAccount> {
    const existing = await StorageStore.getAccount(accountId);
    if (!existing) {
      throw new AppError('Storage account not found.', 404, 'STORAGE_ACCOUNT_NOT_FOUND');
    }

    const now = new Date().toISOString();
    if (input.isDefault === true) {
      if (existing.status !== 'CONNECTED') {
        throw new AppError(
          'Only a connected storage account can be set as default.',
          400,
          'STORAGE_NOT_CONNECTED'
        );
      }
      const all = await StorageStore.listAccounts();
      for (const acc of all) {
        if (acc.id !== accountId && acc.isDefault) {
          await StorageStore.saveAccount({ ...acc, isDefault: false, updatedAt: now });
        }
      }
    }

    const updatedQuotaBytes =
      existing.provider !== 'GOOGLE_DRIVE' &&
      typeof input.quotaGb === 'number' &&
      input.quotaGb > 0
        ? Math.round(input.quotaGb * 1024 * 1024 * 1024)
        : existing.quotaBytes;

    const updated: StorageAccount = {
      ...existing,
      accountName: input.accountName?.trim() || existing.accountName,
      quotaBytes: updatedQuotaBytes,
      priority: typeof input.priority === 'number' ? input.priority : existing.priority,
      isDefault: input.isDefault ?? existing.isDefault,
      updatedAt: now,
    };

    await StorageStore.saveAccount(updated);
    await logActivity({
      ownerUid,
      account: updated,
      eventType: 'PROVIDER_UPDATED',
      status: 'INFO',
      message: `Updated settings for "${updated.accountName}" (Priority ${updated.priority}${updated.isDefault ? ', Default' : ''}).`,
    });

    return updated;
  },

  async disconnectAccount(accountId: string, ownerUid: string): Promise<void> {
    const existing = await StorageStore.getAccount(accountId);
    if (!existing) {
      throw new AppError('Storage account not found.', 404, 'STORAGE_ACCOUNT_NOT_FOUND');
    }

    await StorageStore.deleteAccountAndSecret(accountId);
    await logActivity({
      ownerUid,
      account: existing,
      eventType:
        existing.provider === 'GOOGLE_DRIVE' ? 'DRIVE_DISCONNECTED' : 'PROVIDER_DISCONNECTED',
      status: 'WARNING',
      message: `Disconnected "${existing.accountName}" (${existing.accountEmail || existing.bucketName}). Files inside Google Drive / cloud storage were preserved.`,
    });

    if (existing.isDefault) {
      const remaining = await StorageStore.listAccounts();
      const nextDefault =
        remaining.find((a) => a.provider === 'GOOGLE_DRIVE' && a.status === 'CONNECTED') ||
        remaining.find((a) => a.status === 'CONNECTED');
      if (nextDefault) {
        await StorageStore.saveAccount({
          ...nextDefault,
          isDefault: true,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  },

  async checkAccountHealth(accountId: string, ownerUid: string): Promise<StorageHealthCheckResult> {
    const startedAt = Date.now();
    const existing = await StorageStore.getAccount(accountId);
    if (!existing) {
      throw new AppError('Storage account not found.', 404, 'STORAGE_ACCOUNT_NOT_FOUND');
    }

    if (existing.provider === 'GOOGLE_DRIVE') {
      try {
        const { accessToken, account } =
          await GoogleDriveOAuthService.getValidAccessToken(accountId);
        const about = await GoogleDriveApi.fetchAboutAndQuota(accessToken);
        const folderId = await GoogleDriveApi.ensureStudioFolder(
          accessToken,
          account.driveFolderId
        );
        const driveFiles = await GoogleDriveApi.listFilesInFolder(accessToken, folderId);

        const now = new Date().toISOString();
        const usedBytes =
          about.quota.totalAccountUsageBytes ?? about.quota.usageInDriveBytes ?? account.usedBytes;
        const quotaBytes = about.quota.limitBytes ?? 0;

        const updated: StorageAccount = {
          ...account,
          accountEmail: about.userEmail || account.accountEmail,
          accountDisplayName: about.userDisplayName || account.accountDisplayName,
          driveFolderId: folderId,
          status: 'CONNECTED',
          tokenStatus: 'VALID',
          quotaBytes,
          usedBytes,
          driveStorageQuota: about.quota,
          measuredUsedBytes: about.quota.usageInDriveBytes ?? usedBytes,
          measuredObjectCount: driveFiles.length,
          usageMeasured: true,
          lastHealthCheckAt: now,
          lastHealthError: null,
          updatedAt: now,
        };

        await StorageStore.saveAccount(updated);

        const remainingStr = about.quota.isUnlimited
          ? 'Unlimited storage quota'
          : `${formatGigabytes(about.quota.remainingBytes ?? 0)} remaining`;
        const message = `Google Drive healthy (${updated.accountEmail || updated.accountName}). ${remainingStr}.`;

        await logActivity({
          ownerUid,
          account: updated,
          eventType: 'PROVIDER_HEALTH_CHECK',
          status: 'SUCCESS',
          message,
          bytesAffected: about.quota.remainingBytes,
        });

        return {
          account: updated,
          healthy: true,
          latencyMs: Date.now() - startedAt,
          message,
          measuredUsedBytes: updated.measuredUsedBytes,
          measuredObjectCount: driveFiles.length,
          usageTruncated: false,
        };
      } catch (err) {
        const current = (await StorageStore.getAccount(accountId)) || existing;
        const msg = err instanceof Error ? err.message : 'Google Drive health check failed.';
        const isRevoked =
          (err instanceof AppError && err.code === 'DRIVE_AUTH_REVOKED') ||
          (err instanceof GoogleDriveApiHttpError && err.status === 401);

        const now = new Date().toISOString();
        const failedAccount: StorageAccount = {
          ...current,
          status: isRevoked ? 'REVOKED' : 'ERROR',
          tokenStatus: isRevoked ? 'REVOKED' : current.tokenStatus,
          lastHealthCheckAt: now,
          lastHealthError: msg,
          updatedAt: now,
        };
        await StorageStore.saveAccount(failedAccount);
        await logActivity({
          ownerUid,
          account: failedAccount,
          eventType: 'PROVIDER_HEALTH_CHECK',
          status: 'ERROR',
          message: msg,
        });

        return {
          account: failedAccount,
          healthy: false,
          latencyMs: Date.now() - startedAt,
          message: msg,
          measuredUsedBytes: failedAccount.measuredUsedBytes,
          measuredObjectCount: failedAccount.measuredObjectCount,
          usageTruncated: false,
        };
      }
    }

    const { account, credentials } = await loadAccountAndCredentials(accountId);
    const adapter = getProviderAdapter(account.provider);
    const res = await adapter.getHealthAndUsage(account, credentials);
    const now = new Date().toISOString();

    const updated: StorageAccount = {
      ...account,
      status: res.ok ? 'CONNECTED' : 'ERROR',
      measuredUsedBytes: res.ok ? res.measuredUsedBytes : account.measuredUsedBytes,
      measuredObjectCount: res.ok ? res.measuredObjectCount : account.measuredObjectCount,
      usageMeasured: res.ok && res.measuredUsedBytes !== null ? true : account.usageMeasured,
      usedBytes: res.ok && res.measuredUsedBytes !== null ? res.measuredUsedBytes : account.usedBytes,
      lastHealthCheckAt: now,
      lastHealthError: res.ok ? null : res.message,
      updatedAt: now,
    };

    await StorageStore.saveAccount(updated);
    await logActivity({
      ownerUid,
      account: updated,
      eventType: 'PROVIDER_HEALTH_CHECK',
      status: res.ok ? 'SUCCESS' : 'ERROR',
      message: res.message,
      bytesAffected: res.measuredUsedBytes,
    });

    return {
      account: updated,
      healthy: res.ok,
      latencyMs: res.latencyMs,
      message: res.message,
      measuredUsedBytes: res.measuredUsedBytes,
      measuredObjectCount: res.measuredObjectCount,
      usageTruncated: res.usageTruncated,
    };
  },

  async refreshLiveAccountQuotaIfDrive(account: StorageAccount): Promise<StorageAccount> {
    if (account.provider !== 'GOOGLE_DRIVE') return account;
    const { accessToken, account: current } =
      await GoogleDriveOAuthService.getValidAccessToken(account.id);
    const about = await GoogleDriveApi.fetchAboutAndQuota(accessToken);
    const folderId = await GoogleDriveApi.ensureStudioFolder(
      accessToken,
      current.driveFolderId
    );
    const now = new Date().toISOString();
    const updated: StorageAccount = {
      ...current,
      driveFolderId: folderId,
      quotaBytes: about.quota.limitBytes ?? current.quotaBytes,
      usedBytes: about.quota.totalAccountUsageBytes ?? about.quota.usageInDriveBytes ?? current.usedBytes,
      measuredUsedBytes: about.quota.usageInDriveBytes ?? current.measuredUsedBytes,
      driveStorageQuota: about.quota,
      status: 'CONNECTED',
      tokenStatus: 'VALID',
      lastHealthError: null,
      updatedAt: now,
    };
    await StorageStore.saveAccount(updated);
    return updated;
  },

  async selectDestinationAccount(
    ownerUid: string,
    mode: 'AUTO' | 'MANUAL',
    requestedAccountId: string | undefined,
    fileSizeBytes: number
  ): Promise<StorageAccount> {
    const accounts = await StorageStore.listAccounts();

    if (mode === 'MANUAL') {
      if (!requestedAccountId) {
        throw new AppError(
          'Select a destination Google Drive or storage account in Manual mode.',
          400,
          'STORAGE_ACCOUNT_REQUIRED'
        );
      }
      const selectedRaw = accounts.find((a) => a.id === requestedAccountId);
      if (!selectedRaw) {
        throw new AppError(
          'Selected storage account was not found.',
          404,
          'STORAGE_ACCOUNT_NOT_FOUND'
        );
      }
      if (selectedRaw.status !== 'CONNECTED') {
        throw new AppError(
          `Selected account "${selectedRaw.accountName}" is ${selectedRaw.status}. Manual mode will not silently switch to another account.`,
          409,
          selectedRaw.status === 'REVOKED' ? 'DRIVE_AUTH_REVOKED' : 'STORAGE_NOT_CONNECTED'
        );
      }

      const selected = await this.refreshLiveAccountQuotaIfDrive(selectedRaw);
      const remaining = computeRemainingSpaceBytes(selected);

      if (remaining < fileSizeBytes) {
        const msg =
          `Storage full on "${selected.accountName}": only ${formatGigabytes(remaining)} remaining, need ${formatGigabytes(fileSizeBytes)}. ` +
          `Delete unused files, choose another Drive account, or connect a new Google account.`;
        await logActivity({
          ownerUid,
          account: selected,
          eventType: 'STORAGE_FULL_BLOCKED',
          status: 'WARNING',
          message: msg,
          bytesAffected: fileSizeBytes,
        });
        throw new AppError(msg, 409, 'STORAGE_QUOTA_EXCEEDED');
      }
      return selected;
    }

    // AUTOMATIC MODE: prefer connected accounts ordered by priority asc, GOOGLE_DRIVE preference, default tiebreaker, largest remaining space
    const connected = accounts
      .filter((a) => a.status === 'CONNECTED')
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        if (a.provider !== b.provider) {
          if (a.provider === 'GOOGLE_DRIVE') return -1;
          if (b.provider === 'GOOGLE_DRIVE') return 1;
        }
        return computeRemainingSpaceBytes(b) - computeRemainingSpaceBytes(a);
      });

    if (connected.length === 0) {
      throw new AppError(
        'No connected Google Drive or storage accounts are available. Connect a Google Drive account first.',
        409,
        'NO_CONNECTED_STORAGE'
      );
    }

    for (const rawCandidate of connected) {
      try {
        const candidate = await this.refreshLiveAccountQuotaIfDrive(rawCandidate);
        if (computeRemainingSpaceBytes(candidate) >= fileSizeBytes) {
          return candidate;
        }
      } catch {
        // Try next available healthy account in AUTO mode
      }
    }

    const msg =
      'All connected storage accounts lack sufficient free space for this file. Delete old files or connect another Google Drive account.';
    await logActivity({
      ownerUid,
      eventType: 'STORAGE_FULL_BLOCKED',
      status: 'WARNING',
      message: msg,
      bytesAffected: fileSizeBytes,
    });
    throw new AppError(msg, 409, 'STORAGE_QUOTA_EXCEEDED');
  },

  async initiateUpload(
    ownerUid: string,
    input: InitiateUploadInput
  ): Promise<InitiateUploadResponse> {
    validateFileCandidate(input.fileName, input.fileSizeBytes, input.contentType);

    const selected = await this.selectDestinationAccount(
      ownerUid,
      input.selectionMode,
      input.accountId,
      input.fileSizeBytes
    );

    const sessionId = generateId('upl');
    const objectKey = buildSafeObjectKey(sessionId, input.fileName);
    const cleanFileName = sanitizeFilename(input.fileName);
    const now = new Date().toISOString();
    const contentType = input.contentType.trim() || 'application/octet-stream';

    if (selected.provider === 'GOOGLE_DRIVE') {
      const { accessToken, account } =
        await GoogleDriveOAuthService.getValidAccessToken(selected.id);
      const folderId = await GoogleDriveApi.ensureStudioFolder(
        accessToken,
        account.driveFolderId
      );
      const chunkSizeBytes = resolveDriveChunkSizeBytes(
        input.fileSizeBytes,
        input.preferredChunkSizeBytes
      );
      const totalParts = Math.max(1, Math.ceil(input.fileSizeBytes / chunkSizeBytes));
      const resumableSessionUri = await GoogleDriveApi.initiateResumableUpload(accessToken, {
        fileName: cleanFileName,
        contentType,
        fileSizeBytes: input.fileSizeBytes,
        folderId,
        sessionId,
        objectKey,
        origin: input.origin,
      });

      const session: UploadSessionRecord = {
        id: sessionId,
        ownerUid,
        accountId: account.id,
        accountName: account.accountName,
        accountEmail: account.accountEmail,
        provider: 'GOOGLE_DRIVE',
        bucketName: account.bucketName,
        objectKey,
        uploadId: null,
        uploadStrategy: 'GOOGLE_DRIVE_RESUMABLE',
        resumableSessionUri,
        fileName: cleanFileName,
        fileSizeBytes: input.fileSizeBytes,
        contentType,
        lastModified: input.lastModified,
        chunkSizeBytes,
        totalParts,
        uploadedBytesConfirmed: 0,
        completedParts: [],
        status: 'INITIATED',
        createdAt: now,
        updatedAt: now,
      };

      await StorageStore.saveUploadSession(session);
      await StorageStore.saveAccount({
        ...account,
        driveFolderId: folderId,
        reservedBytes: account.reservedBytes + input.fileSizeBytes,
        updatedAt: now,
      });

      await logActivity({
        ownerUid,
        account,
        eventType: 'UPLOAD_INITIATED',
        status: 'INFO',
        message: `Initiated direct Google Drive resumable upload for "${cleanFileName}" (${totalParts} chunks) to ${account.accountEmail || account.accountName}.`,
        objectKey,
        bytesAffected: input.fileSizeBytes,
      });

      return {
        session,
        selectedAccount: account,
        resumableSessionUri,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    const { credentials } = await loadAccountAndCredentials(selected.id);
    const adapter = getProviderAdapter(selected.provider);

    const useSinglePut = input.fileSizeBytes <= SINGLE_PUT_MAX_BYTES;
    const chunkSizeBytes = resolveS3ChunkSizeBytes(
      input.fileSizeBytes,
      input.preferredChunkSizeBytes
    );
    const totalParts = useSinglePut ? 1 : Math.ceil(input.fileSizeBytes / chunkSizeBytes);

    let uploadStrategy: UploadSessionRecord['uploadStrategy'] = useSinglePut
      ? 'SINGLE_PUT'
      : 'MULTIPART';
    let uploadId: string | null = null;
    let resumableSessionUri: string | null = null;
    let presignedPutUrl: string | undefined;
    let partUrls: InitiateUploadResponse['partUrls'];
    let expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000).toISOString();

    if (useSinglePut) {
      const putRes = await adapter.createSinglePutUrl(selected, credentials, {
        objectKey,
        contentType,
        fileSizeBytes: input.fileSizeBytes,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      });
      presignedPutUrl = putRes.url;
      expiresAt = putRes.expiresAt;
    } else {
      const initRes = await adapter.initiateMultipartUpload(selected, credentials, {
        objectKey,
        contentType,
        fileSizeBytes: input.fileSizeBytes,
        origin: input.origin,
      });
      uploadStrategy = initRes.uploadStrategy;
      uploadId = initRes.uploadId;
      resumableSessionUri = initRes.resumableSessionUri;

      const initialBatchCount = Math.min(totalParts, 10);
      const partNumbers = Array.from({ length: initialBatchCount }, (_, idx) => idx + 1);
      if (uploadId && uploadStrategy === 'MULTIPART') {
        partUrls = await adapter.createPartUploadUrls(selected, credentials, {
          objectKey,
          uploadId,
          partNumbers,
          expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
        });
      }
    }

    const session: UploadSessionRecord = {
      id: sessionId,
      ownerUid,
      accountId: selected.id,
      accountName: selected.accountName,
      accountEmail: selected.accountEmail,
      provider: selected.provider,
      bucketName: selected.bucketName,
      objectKey,
      uploadId,
      uploadStrategy,
      resumableSessionUri,
      fileName: cleanFileName,
      fileSizeBytes: input.fileSizeBytes,
      contentType,
      lastModified: input.lastModified,
      chunkSizeBytes,
      totalParts,
      uploadedBytesConfirmed: 0,
      completedParts: [],
      status: 'INITIATED',
      createdAt: now,
      updatedAt: now,
    };

    await StorageStore.saveUploadSession(session);
    await StorageStore.saveAccount({
      ...selected,
      reservedBytes: selected.reservedBytes + input.fileSizeBytes,
      updatedAt: now,
    });

    await logActivity({
      ownerUid,
      account: selected,
      eventType: 'UPLOAD_INITIATED',
      status: 'INFO',
      message: `Initiated ${uploadStrategy} upload for "${session.fileName}" (${session.totalParts} parts).`,
      objectKey,
      bytesAffected: input.fileSizeBytes,
    });

    return {
      session,
      selectedAccount: selected,
      presignedPutUrl,
      resumableSessionUri: resumableSessionUri || undefined,
      partUrls,
      expiresAt,
    };
  },

  async getPartUploadUrls(
    sessionId: string,
    partNumbers: number[]
  ): Promise<PartUrlsResponse> {
    const session = await StorageStore.getUploadSession(sessionId);
    if (!session) {
      throw new AppError('Upload session not found.', 404, 'UPLOAD_SESSION_NOT_FOUND');
    }
    if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
      throw new AppError(
        `Upload session is already ${session.status}.`,
        409,
        'UPLOAD_SESSION_CLOSED'
      );
    }
    if (!session.uploadId || session.uploadStrategy !== 'MULTIPART') {
      throw new AppError(
        'Upload session does not use multipart part URLs.',
        400,
        'INVALID_UPLOAD_MODE'
      );
    }

    for (const partNo of partNumbers) {
      if (!Number.isInteger(partNo) || partNo < 1 || partNo > session.totalParts) {
        throw new AppError(`Invalid part number ${partNo}.`, 400, 'INVALID_PART_NUMBER');
      }
    }

    const { account, credentials } = await loadAccountAndCredentials(session.accountId);
    const adapter = getProviderAdapter(account.provider);
    const partUrls = await adapter.createPartUploadUrls(account, credentials, {
      objectKey: session.objectKey,
      uploadId: session.uploadId,
      partNumbers,
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
    });

    return { sessionId, partUrls };
  },

  async recordPartCompleted(
    sessionId: string,
    part: CompletedUploadPart,
    uploadedBytesConfirmed?: number
  ): Promise<UploadSessionRecord> {
    const updated = await StorageStore.appendCompletedPart(
      sessionId,
      part,
      uploadedBytesConfirmed
    );
    if (!updated) {
      throw new AppError('Upload session not found.', 404, 'UPLOAD_SESSION_NOT_FOUND');
    }
    return updated;
  },

  async setUploadPausedState(sessionId: string, paused: boolean): Promise<UploadSessionRecord> {
    const session = await StorageStore.getUploadSession(sessionId);
    if (!session) {
      throw new AppError('Upload session not found.', 404, 'UPLOAD_SESSION_NOT_FOUND');
    }
    if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
      return session;
    }
    const updated: UploadSessionRecord = {
      ...session,
      status: paused ? 'PAUSED' : 'IN_PROGRESS',
      updatedAt: new Date().toISOString(),
    };
    await StorageStore.saveUploadSession(updated);
    return updated;
  },

  async resumeUpload(sessionId: string, ownerUid: string): Promise<ResumeUploadResponse> {
    const session = await StorageStore.getUploadSession(sessionId);
    if (!session) {
      throw new AppError('Upload session not found.', 404, 'UPLOAD_SESSION_NOT_FOUND');
    }
    if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
      throw new AppError(
        `Cannot resume ${session.status} session.`,
        409,
        'UPLOAD_SESSION_CLOSED'
      );
    }

    if (session.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE') {
      if (!session.resumableSessionUri) {
        throw new AppError(
          'Google Drive resumable session URI is missing.',
          400,
          'INVALID_RESUMABLE_SESSION'
        );
      }

      const { account } = await GoogleDriveOAuthService.getValidAccessToken(session.accountId);
      const probe = await GoogleDriveApi.queryResumableUploadOffset(
        session.resumableSessionUri,
        session.fileSizeBytes
      );

      if (probe.status === 'EXPIRED') {
        const failedSession: UploadSessionRecord = {
          ...session,
          status: 'FAILED',
          updatedAt: new Date().toISOString(),
        };
        await StorageStore.saveUploadSession(failedSession);
        await StorageStore.saveAccount({
          ...account,
          reservedBytes: Math.max(0, account.reservedBytes - session.fileSizeBytes),
          updatedAt: new Date().toISOString(),
        });
        await logActivity({
          ownerUid,
          account,
          eventType: 'UPLOAD_SESSION_EXPIRED',
          status: 'ERROR',
          message: `Resumable Drive session for "${session.fileName}" expired. Please start a fresh upload.`,
          objectKey: session.objectKey,
        });
        throw new AppError(
          'Google Drive resumable upload session expired. Please restart the upload.',
          410,
          'UPLOAD_SESSION_EXPIRED'
        );
      }

      const updated: UploadSessionRecord = {
        ...session,
        uploadedBytesConfirmed: probe.uploadedBytesConfirmed,
        status: 'IN_PROGRESS',
        updatedAt: new Date().toISOString(),
      };
      await StorageStore.saveUploadSession(updated);

      return {
        session: updated,
        account,
        pendingPartNumbers: [],
        uploadedBytesConfirmed: probe.uploadedBytesConfirmed,
        resumableSessionUri: session.resumableSessionUri,
      };
    }

    const { account, credentials } = await loadAccountAndCredentials(session.accountId);
    const adapter = getProviderAdapter(account.provider);
    const completedSet = new Set(session.completedParts.map((p) => p.partNumber));
    const pendingPartNumbers: number[] = [];
    for (let i = 1; i <= session.totalParts; i += 1) {
      if (!completedSet.has(i)) {
        pendingPartNumbers.push(i);
      }
    }

    let presignedPutUrl: string | undefined;
    let partUrls: ResumeUploadResponse['partUrls'];

    if (session.uploadStrategy === 'SINGLE_PUT') {
      const putRes = await adapter.createSinglePutUrl(account, credentials, {
        objectKey: session.objectKey,
        contentType: session.contentType,
        fileSizeBytes: session.fileSizeBytes,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      });
      presignedPutUrl = putRes.url;
    } else if (session.uploadId && pendingPartNumbers.length > 0 && session.uploadStrategy === 'MULTIPART') {
      const batch = pendingPartNumbers.slice(0, 10);
      partUrls = await adapter.createPartUploadUrls(account, credentials, {
        objectKey: session.objectKey,
        uploadId: session.uploadId,
        partNumbers: batch,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      });
    }

    const updated: UploadSessionRecord = {
      ...session,
      status: 'IN_PROGRESS',
      updatedAt: new Date().toISOString(),
    };
    await StorageStore.saveUploadSession(updated);

    return {
      session: updated,
      account,
      pendingPartNumbers,
      uploadedBytesConfirmed: session.uploadedBytesConfirmed,
      resumableSessionUri: session.resumableSessionUri,
      presignedPutUrl,
      partUrls,
    };
  },

  async completeUpload(
    sessionId: string,
    ownerUid: string,
    input: CompleteUploadInput
  ): Promise<StorageFileRecord> {
    const session = await StorageStore.getUploadSession(sessionId);
    if (!session) {
      throw new AppError('Upload session not found.', 404, 'UPLOAD_SESSION_NOT_FOUND');
    }
    if (session.status === 'ABORTED') {
      throw new AppError(
        'Cannot complete an aborted upload session.',
        409,
        'UPLOAD_SESSION_ABORTED'
      );
    }

    const now = new Date().toISOString();

    if (session.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE') {
      const { accessToken, account } =
        await GoogleDriveOAuthService.getValidAccessToken(session.accountId);

      let driveFileId = input.externalFileId?.trim() || null;
      if (!driveFileId && session.resumableSessionUri) {
        const probe = await GoogleDriveApi.queryResumableUploadOffset(
          session.resumableSessionUri,
          session.fileSizeBytes
        );
        if (probe.status === 'COMPLETED' && probe.file?.id) {
          driveFileId = probe.file.id;
        }
      }

      if (!driveFileId) {
        throw new AppError(
          'Google Drive completion verification failed: missing Google Drive file ID.',
          400,
          'UPLOAD_VERIFICATION_FAILED'
        );
      }

      const driveMeta = await GoogleDriveApi.getFileMetadata(accessToken, driveFileId);
      if (driveMeta.trashed) {
        throw new AppError(
          'Google Drive completion verification failed: uploaded file is trashed.',
          502,
          'UPLOAD_VERIFICATION_FAILED'
        );
      }

      const verifiedSize = driveMeta.sizeBytes ?? session.fileSizeBytes;
      const fileRecord: StorageFileRecord = {
        id: generateId('fil'),
        ownerUid,
        accountId: account.id,
        accountName: account.accountName,
        accountEmail: account.accountEmail,
        provider: 'GOOGLE_DRIVE',
        bucketName: account.bucketName,
        objectKey: driveMeta.id,
        externalFileId: driveMeta.id,
        fileName: driveMeta.name || session.fileName,
        fileSizeBytes: verifiedSize,
        contentType: driveMeta.mimeType || session.contentType,
        etag: driveMeta.md5Checksum,
        md5Checksum: driveMeta.md5Checksum,
        uploadStatus: 'VERIFIED',
        uploadStrategy: 'GOOGLE_DRIVE_RESUMABLE',
        uploadSessionId: session.id,
        createdAt: now,
        updatedAt: now,
      };

      await StorageStore.saveFile(fileRecord);
      await StorageStore.saveUploadSession({
        ...session,
        uploadedBytesConfirmed: verifiedSize,
        status: 'COMPLETED',
        updatedAt: now,
      });

      // Refresh live quota from Google Drive after upload
      let refreshedQuota = account.driveStorageQuota;
      let nextUsed = account.usedBytes + verifiedSize;
      let nextLimit = account.quotaBytes;
      let nextMeasuredDrive = (account.measuredUsedBytes ?? 0) + verifiedSize;

      try {
        const about = await GoogleDriveApi.fetchAboutAndQuota(accessToken);
        refreshedQuota = about.quota;
        nextLimit = about.quota.limitBytes ?? account.quotaBytes;
        nextUsed = about.quota.totalAccountUsageBytes ?? nextUsed;
        nextMeasuredDrive = about.quota.usageInDriveBytes ?? nextMeasuredDrive;
      } catch {
        // Fallback increment handled cleanly
      }

      await StorageStore.saveAccount({
        ...account,
        quotaBytes: nextLimit,
        usedBytes: nextUsed,
        measuredUsedBytes: nextMeasuredDrive,
        driveStorageQuota: refreshedQuota,
        reservedBytes: Math.max(0, account.reservedBytes - session.fileSizeBytes),
        fileCount: account.fileCount + 1,
        updatedAt: now,
      });

      await logActivity({
        ownerUid,
        account,
        eventType: 'UPLOAD_COMPLETED',
        status: 'SUCCESS',
        message: `Verified Google Drive upload of "${fileRecord.fileName}" (${verifiedSize} bytes, File ID: ${driveMeta.id}).`,
        objectKey: driveMeta.id,
        bytesAffected: verifiedSize,
      });

      return fileRecord;
    }

    const { account, credentials } = await loadAccountAndCredentials(session.accountId);
    const adapter = getProviderAdapter(account.provider);
    let finalEtag: string | null = input.etag ?? null;

    if (session.uploadStrategy === 'MULTIPART') {
      const mergedMap = new Map<number, CompletedUploadPart>();
      for (const p of session.completedParts) mergedMap.set(p.partNumber, p);
      for (const p of input.parts || []) mergedMap.set(p.partNumber, p);
      const finalParts = Array.from(mergedMap.values()).sort(
        (a, b) => a.partNumber - b.partNumber
      );

      if (finalParts.length !== session.totalParts) {
        throw new AppError(
          `Cannot complete upload: ${finalParts.length} of ${session.totalParts} parts recorded.`,
          400,
          'INCOMPLETE_MULTIPART_PARTS'
        );
      }

      const comp = await adapter.completeMultipartUpload(account, credentials, {
        objectKey: session.objectKey,
        uploadId: session.uploadId!,
        parts: finalParts,
      });
      finalEtag = comp.etag;
    }

    const head = await adapter.headObject(account, credentials, session.objectKey);
    if (!head.exists) {
      throw new AppError(
        'Upload completion verification failed: object not found in bucket.',
        502,
        'UPLOAD_VERIFICATION_FAILED'
      );
    }

    const verifiedSize = head.sizeBytes ?? session.fileSizeBytes;
    const fileRecord: StorageFileRecord = {
      id: generateId('fil'),
      ownerUid,
      accountId: account.id,
      accountName: account.accountName,
      accountEmail: account.accountEmail,
      provider: account.provider,
      bucketName: account.bucketName,
      objectKey: session.objectKey,
      externalFileId: head.externalFileId ?? null,
      fileName: session.fileName,
      fileSizeBytes: verifiedSize,
      contentType: head.contentType || session.contentType,
      etag: head.etag || finalEtag,
      md5Checksum: head.md5Checksum ?? null,
      uploadStatus: 'VERIFIED',
      uploadStrategy: session.uploadStrategy,
      uploadSessionId: session.id,
      createdAt: now,
      updatedAt: now,
    };

    await StorageStore.saveFile(fileRecord);
    await StorageStore.saveUploadSession({
      ...session,
      completedParts: input.parts ?? session.completedParts,
      uploadedBytesConfirmed: verifiedSize,
      status: 'COMPLETED',
      updatedAt: now,
    });
    await StorageStore.saveAccount({
      ...account,
      usedBytes: account.usedBytes + verifiedSize,
      reservedBytes: Math.max(0, account.reservedBytes - session.fileSizeBytes),
      fileCount: account.fileCount + 1,
      updatedAt: now,
    });

    await logActivity({
      ownerUid,
      account,
      eventType: 'UPLOAD_COMPLETED',
      status: 'SUCCESS',
      message: `Verified upload of "${fileRecord.fileName}" (${verifiedSize} bytes) in "${account.bucketName}".`,
      objectKey: fileRecord.objectKey,
      bytesAffected: verifiedSize,
    });

    return fileRecord;
  },

  async abortUpload(sessionId: string, ownerUid: string): Promise<void> {
    const session = await StorageStore.getUploadSession(sessionId);
    if (!session) {
      throw new AppError('Upload session not found.', 404, 'UPLOAD_SESSION_NOT_FOUND');
    }
    if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
      return;
    }

    const account = await StorageStore.getAccount(session.accountId);
    if (session.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE' && session.resumableSessionUri) {
      try {
        const { accessToken } = await GoogleDriveOAuthService.getValidAccessToken(session.accountId);
        await GoogleDriveApi.abortResumableUpload(session.resumableSessionUri, accessToken);
      } catch {
        // Best-effort cleanup of remote resumable URI
      }
    } else if (session.uploadId && account) {
      const { credentials } = await loadAccountAndCredentials(account.id);
      const adapter = getProviderAdapter(account.provider);
      await adapter
        .abortMultipartUpload(account, credentials, {
          objectKey: session.objectKey,
          uploadId: session.uploadId,
        })
        .catch(() => {});
    }

    const now = new Date().toISOString();
    await StorageStore.saveUploadSession({
      ...session,
      status: 'ABORTED',
      updatedAt: now,
    });

    if (account) {
      await StorageStore.saveAccount({
        ...account,
        reservedBytes: Math.max(0, account.reservedBytes - session.fileSizeBytes),
        updatedAt: now,
      });
    }

    await logActivity({
      ownerUid,
      account,
      eventType: 'UPLOAD_ABORTED',
      status: 'WARNING',
      message: `Cancelled upload "${session.fileName}" and cleaned up remote resumable session.`,
      objectKey: session.objectKey,
      bytesAffected: session.fileSizeBytes,
    });
  },

  async getFileMetadata(fileId: string): Promise<{
    file: StorageFileRecord;
    remote: RemoteObjectMetadata;
  }> {
    const file = await StorageStore.getFile(fileId);
    if (!file) {
      throw new AppError('File metadata record not found.', 404, 'FILE_NOT_FOUND');
    }
    const { account, credentials } = await loadAccountAndCredentials(file.accountId);
    const adapter = getProviderAdapter(account.provider);
    const targetId = file.externalFileId || file.objectKey;
    const remote = await adapter.headObject(account, credentials, targetId);
    return { file, remote };
  },

  async deleteFile(fileId: string, ownerUid: string): Promise<void> {
    const file = await StorageStore.getFile(fileId);
    if (!file) {
      throw new AppError('File metadata record not found.', 404, 'FILE_NOT_FOUND');
    }

    const { account, credentials } = await loadAccountAndCredentials(file.accountId);
    const adapter = getProviderAdapter(account.provider);
    const targetId = file.externalFileId || file.objectKey;

    try {
      await adapter.deleteObject(account, credentials, targetId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cloud object deletion failed.';
      await logActivity({
        ownerUid,
        account,
        eventType: 'FILE_DELETE_FAILED',
        status: 'ERROR',
        message: `Deletion failed for "${file.fileName}": ${msg}`,
        objectKey: targetId,
      });
      throw new AppError(
        `Failed to delete file from ${account.provider === 'GOOGLE_DRIVE' ? 'Google Drive' : 'cloud storage'}: ${msg}`,
        502,
        'CLOUD_DELETE_FAILED'
      );
    }

    const check = await adapter.headObject(account, credentials, targetId);
    if (check.exists) {
      await logActivity({
        ownerUid,
        account,
        eventType: 'FILE_DELETE_FAILED',
        status: 'ERROR',
        message: `File "${targetId}" still exists remotely after deletion request.`,
        objectKey: targetId,
      });
      throw new AppError(
        'Deletion verification failed: file still exists in remote storage.',
        502,
        'CLOUD_DELETE_VERIFICATION_FAILED'
      );
    }

    await StorageStore.deleteFile(file.id);

    const now = new Date().toISOString();
    if (account.provider === 'GOOGLE_DRIVE') {
      let refreshedQuota = account.driveStorageQuota;
      let nextUsed = Math.max(0, account.usedBytes - file.fileSizeBytes);
      let nextMeasured = Math.max(0, (account.measuredUsedBytes ?? account.usedBytes) - file.fileSizeBytes);
      try {
        const about = await GoogleDriveApi.fetchAboutAndQuota(credentials.accessToken!);
        refreshedQuota = about.quota;
        nextUsed = about.quota.totalAccountUsageBytes ?? nextUsed;
        nextMeasured = about.quota.usageInDriveBytes ?? nextMeasured;
      } catch {
        // Fallback decrement handled cleanly
      }
      await StorageStore.saveAccount({
        ...account,
        usedBytes: nextUsed,
        measuredUsedBytes: nextMeasured,
        driveStorageQuota: refreshedQuota,
        fileCount: Math.max(0, account.fileCount - 1),
        updatedAt: now,
      });
    } else {
      await StorageStore.saveAccount({
        ...account,
        usedBytes: Math.max(0, account.usedBytes - file.fileSizeBytes),
        fileCount: Math.max(0, account.fileCount - 1),
        updatedAt: now,
      });
    }

    await logActivity({
      ownerUid,
      account,
      eventType: 'FILE_DELETED',
      status: 'SUCCESS',
      message: `Deleted "${file.fileName}" from ${account.accountEmail || account.bucketName} and verified removal.`,
      objectKey: targetId,
      bytesAffected: file.fileSizeBytes,
    });
  },
};
