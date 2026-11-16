import { Router } from 'express';
import { z } from 'zod';
import type { ApiResponse } from '../../../shared/types/api';
import {
  DRIVE_CHUNK_ALIGNMENT_BYTES,
  MAX_MULTIPART_PART_BYTES,
  type GoogleDriveOAuthStatus,
  type StartGoogleDriveOAuthResponse,
  type StorageAccount,
  type StorageFileRecord,
  type StorageHealthCheckResult,
  type StorageOverviewPayload,
  type UploadSessionRecord,
} from '../../../shared/types/storage';
import { requireFirebaseAdmin } from '../../middleware/authGuard';
import {
  storageMutationRateLimiter,
  storageUploadUrlsRateLimiter,
} from '../../middleware/rateLimiters';
import { DriveStreamPrepService } from '../../storage/driveStreamPrep';
import { GoogleDriveOAuthService } from '../../storage/providers/googleDriveOAuth';
import { StorageService } from '../../storage/storageService';
import { StorageStore } from '../../storage/storageStore';

export const storageRouter = Router();

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isLocalHostname(hostname: string): boolean {
  const hostOnly = hostname.split(':')[0].toLowerCase();
  return hostOnly === 'localhost' || hostOnly === '127.0.0.1' || hostOnly === '::1';
}

function getRequestOrigin(req: { headers: Record<string, unknown>; protocol?: string }): string | undefined {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader && /^https?:\/\//i.test(originHeader)) {
    try {
      const parsed = new URL(originHeader);
      if (!isLocalHostname(parsed.hostname) && parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
      }
      return parsed.origin;
    } catch {
      // Ignore malformed Origin header
    }
  }

  const forwardedHost =
    typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : typeof req.headers.host === 'string'
        ? req.headers.host.trim()
        : '';

  if (!forwardedHost || /[\s/\\@]/.test(forwardedHost)) {
    return undefined;
  }

  const forwardedProto =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
      : (req.protocol || 'https').toLowerCase();

  // Reverse proxies (Render, Cloud Run, AI Studio) terminate TLS at the edge
  // and may forward requests internally over HTTP. Non-localhost domains must use https.
  const effectiveProto = isLocalHostname(forwardedHost)
    ? forwardedProto === 'https'
      ? 'https'
      : 'http'
    : 'https';

  return `${effectiveProto}://${forwardedHost}`.replace(/\/+$/, '');
}

/**
 * Google OAuth 2.0 Callback Route (PUBLIC endpoint invoked directly by Google redirect in OAuth popup).
 * CSRF-protected via single-use server-stored `state` nonce and exchanges code strictly server-side.
 */
storageRouter.get(
  ['/google-drive/oauth/callback', '/google-drive/oauth/callback/'],
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const error = typeof req.query.error === 'string' ? req.query.error : undefined;
    const errorDescription =
      typeof req.query.error_description === 'string' ? req.query.error_description : undefined;

    const result = await GoogleDriveOAuthService.handleOAuthCallback({
      code,
      state,
      error,
      errorDescription,
    });

    const payload = result.ok
      ? {
          type: 'GOOGLE_DRIVE_OAUTH_RESULT',
          ok: true,
          accountId: result.account?.id ?? null,
          accountEmail: result.account?.accountEmail ?? null,
          accountName: result.account?.accountName ?? null,
        }
      : {
          type: 'GOOGLE_DRIVE_OAUTH_RESULT',
          ok: false,
          errorMessage: result.errorMessage || 'Google Drive connection failed.',
        };

    const safeHeading = result.ok
      ? 'Google Drive Connected'
      : 'Google Drive Authorization Failed';
    const safeSubtext = result.ok
      ? `Connected ${escapeHtml(result.account?.accountEmail || result.account?.accountName || 'Drive account')}. You can close this window.`
      : escapeHtml(result.errorMessage || 'Unable to complete Google Drive authorization.');

    const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');

    res.status(result.ok ? 200 : 400).type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeHeading}</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
    .card{max-width:420px;width:100%;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;text-align:center;}
    h1{font-size:18px;margin:0 0 8px 0;}
    p{font-size:14px;color:#cbd5e1;line-height:1.5;margin:0 0 16px 0;}
    button{background:#ef4444;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer;}
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeHeading}</h1>
    <p>${safeSubtext}</p>
    <button type="button" onclick="window.close()">Close Window</button>
  </div>
  <script>
    (function(){
      var data = ${serializedPayload};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(data, '*');
        }
      } catch (e) {}
      setTimeout(function(){ window.close(); }, ${result.ok ? 400 : 3500});
    })();
  </script>
</body>
</html>`);
  }
);

// All remaining storage management & upload endpoints strictly require verified Admin Firebase token
storageRouter.use(requireFirebaseAdmin);

const startDriveOAuthSchema = z.object({
  accountLabel: z.string().trim().max(120).optional(),
  priority: z.coerce.number().int().min(1).max(999).optional(),
  isDefault: z.boolean().optional(),
  reconnectAccountId: z.string().trim().max(128).optional(),
});

const createAccountSchema = z.object({
  provider: z.enum(['CLOUDFLARE_R2', 'AMAZON_S3', 'GOOGLE_CLOUD_STORAGE', 'S3_COMPATIBLE']),
  accountName: z.string().trim().min(1).max(120),
  bucketName: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]{1,126}[a-z0-9]$/i, 'Invalid bucket name format.'),
  region: z.string().trim().max(64).optional(),
  endpoint: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\//i.test(v), 'Endpoint must start with http:// or https://')
    .optional(),
  accountIdExternal: z.string().trim().max(128).optional(),
  gcsAuthMode: z.enum(['HMAC_S3', 'SERVICE_ACCOUNT']).optional(),
  accessKeyId: z.string().trim().max(256).optional(),
  secretAccessKey: z.string().trim().max(512).optional(),
  serviceAccountJson: z.string().trim().max(16384).optional(),
  quotaGb: z.coerce.number().min(0.1).max(100000).optional(),
  priority: z.coerce.number().int().min(1).max(999).optional(),
  isDefault: z.boolean().optional(),
});

const updateAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(120).optional(),
  quotaGb: z.coerce.number().min(0.1).max(100000).optional(),
  priority: z.coerce.number().int().min(1).max(999).optional(),
  isDefault: z.boolean().optional(),
});

const initiateUploadSchema = z.object({
  selectionMode: z.enum(['AUTO', 'MANUAL']),
  accountId: z.string().trim().max(128).optional(),
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.coerce.number().int().positive(),
  contentType: z.string().trim().max(128).default('application/octet-stream'),
  lastModified: z.coerce.number().nonnegative().default(0),
  preferredChunkSizeBytes: z.coerce
    .number()
    .int()
    .min(DRIVE_CHUNK_ALIGNMENT_BYTES)
    .max(MAX_MULTIPART_PART_BYTES)
    .optional(),
});

const partUrlsSchema = z.object({
  partNumbers: z.array(z.coerce.number().int().min(1).max(10000)).min(1).max(50),
});

const partProgressSchema = z.object({
  partNumber: z.coerce.number().int().min(1).max(50000),
  etag: z.string().trim().min(1).max(256),
  sizeBytes: z.coerce.number().int().positive(),
  uploadedBytesConfirmed: z.coerce.number().int().nonnegative().optional(),
});

const completeUploadSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.coerce.number().int().min(1).max(50000),
        etag: z.string().trim().min(1).max(256),
        sizeBytes: z.coerce.number().int().positive(),
      })
    )
    .optional(),
  etag: z.string().trim().max(256).nullable().optional(),
  externalFileId: z.string().trim().max(256).nullable().optional(),
});

const pauseUploadSchema = z.object({
  paused: z.boolean(),
});

storageRouter.get('/google-drive/oauth/status', (req, res, next) => {
  try {
    const status = GoogleDriveOAuthService.getOAuthStatus(getRequestOrigin(req));
    const payload: ApiResponse<GoogleDriveOAuthStatus> = {
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

storageRouter.post(
  '/google-drive/oauth/start',
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      const input = startDriveOAuthSchema.parse(req.body || {});
      const data = await GoogleDriveOAuthService.startOAuthFlow({
        adminUid: req.admin!.uid,
        origin: getRequestOrigin(req),
        input,
      });
      const payload: ApiResponse<StartGoogleDriveOAuthResponse> = {
        success: true,
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.get('/overview', async (req, res, next) => {
  try {
    const data = await StorageService.getOverview(getRequestOrigin(req));
    const payload: ApiResponse<StorageOverviewPayload> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

storageRouter.get('/usage', async (req, res, next) => {
  try {
    const overview = await StorageService.getOverview(getRequestOrigin(req));
    res.status(200).json({
      success: true,
      data: {
        totalAccounts: overview.totalAccounts,
        connectedAccounts: overview.connectedAccounts,
        revokedAccounts: overview.revokedAccounts,
        errorAccounts: overview.errorAccounts,
        totalFilesCount: overview.totalFilesCount,
        totalUploadedBytesTracked: overview.totalUploadedBytesTracked,
        accounts: overview.accounts.map((a) => ({
          id: a.id,
          provider: a.provider,
          accountName: a.accountName,
          accountEmail: a.accountEmail,
          status: a.status,
          quotaBytes: a.quotaBytes,
          usedBytes: a.usedBytes,
          driveStorageQuota: a.driveStorageQuota,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

storageRouter.get('/providers', async (_req, res, next) => {
  try {
    const accounts = await StorageStore.listAccounts();
    const payload: ApiResponse<StorageAccount[]> = {
      success: true,
      data: accounts,
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

storageRouter.post('/providers', storageMutationRateLimiter, async (req, res, next) => {
  try {
    const input = createAccountSchema.parse(req.body);
    const account = await StorageService.createAndVerifyAccount(req.admin!.uid, input);
    const payload: ApiResponse<StorageAccount> = {
      success: true,
      data: account,
      timestamp: new Date().toISOString(),
    };
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

storageRouter.patch('/providers/:accountId', storageMutationRateLimiter, async (req, res, next) => {
  try {
    const input = updateAccountSchema.parse(req.body);
    const account = await StorageService.updateAccount(
      req.params.accountId,
      req.admin!.uid,
      input
    );
    const payload: ApiResponse<StorageAccount> = {
      success: true,
      data: account,
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

storageRouter.post(
  '/providers/:accountId/default',
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      const account = await StorageService.updateAccount(req.params.accountId, req.admin!.uid, {
        isDefault: true,
      });
      res.status(200).json({
        success: true,
        data: account,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/providers/:accountId/health',
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      const result = await StorageService.checkAccountHealth(
        req.params.accountId,
        req.admin!.uid
      );
      const payload: ApiResponse<StorageHealthCheckResult> = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.delete(
  '/providers/:accountId',
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      await StorageService.disconnectAccount(req.params.accountId, req.admin!.uid);
      res.status(200).json({
        success: true,
        data: { disconnected: true, accountId: req.params.accountId },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/initiate',
  storageUploadUrlsRateLimiter,
  async (req, res, next) => {
    try {
      const input = initiateUploadSchema.parse(req.body);
      const origin = getRequestOrigin(req);
      const result = await StorageService.initiateUpload(req.admin!.uid, {
        ...input,
        origin,
      });
      res.status(201).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/:sessionId/part-urls',
  storageUploadUrlsRateLimiter,
  async (req, res, next) => {
    try {
      const input = partUrlsSchema.parse(req.body);
      const result = await StorageService.getPartUploadUrls(
        req.params.sessionId,
        input.partNumbers
      );
      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/:sessionId/part-progress',
  storageUploadUrlsRateLimiter,
  async (req, res, next) => {
    try {
      const input = partProgressSchema.parse(req.body);
      const session = await StorageService.recordPartCompleted(
        req.params.sessionId,
        {
          partNumber: input.partNumber,
          etag: input.etag,
          sizeBytes: input.sizeBytes,
        },
        input.uploadedBytesConfirmed
      );
      const payload: ApiResponse<UploadSessionRecord> = {
        success: true,
        data: session,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/:sessionId/pause',
  storageUploadUrlsRateLimiter,
  async (req, res, next) => {
    try {
      const input = pauseUploadSchema.parse(req.body);
      const session = await StorageService.setUploadPausedState(
        req.params.sessionId,
        input.paused
      );
      res.status(200).json({
        success: true,
        data: session,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/:sessionId/resume',
  storageUploadUrlsRateLimiter,
  async (req, res, next) => {
    try {
      const result = await StorageService.resumeUpload(req.params.sessionId, req.admin!.uid);
      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/:sessionId/complete',
  storageUploadUrlsRateLimiter,
  async (req, res, next) => {
    try {
      const input = completeUploadSchema.parse(req.body || {});
      const file = await StorageService.completeUpload(
        req.params.sessionId,
        req.admin!.uid,
        input
      );
      const payload: ApiResponse<StorageFileRecord> = {
        success: true,
        data: file,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.post(
  '/uploads/:sessionId/abort',
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      await StorageService.abortUpload(req.params.sessionId, req.admin!.uid);
      res.status(200).json({
        success: true,
        data: { aborted: true, sessionId: req.params.sessionId },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

storageRouter.get('/files', async (req, res, next) => {
  try {
    let files = await StorageStore.listFiles();
    const providerFilter =
      typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
    const accountFilter =
      typeof req.query.accountId === 'string' ? req.query.accountId.trim() : '';
    const searchQuery =
      typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    if (providerFilter) {
      files = files.filter((f) => f.provider === providerFilter);
    }
    if (accountFilter) {
      files = files.filter((f) => f.accountId === accountFilter);
    }
    if (searchQuery) {
      files = files.filter(
        (f) =>
          f.fileName.toLowerCase().includes(searchQuery) ||
          f.objectKey.toLowerCase().includes(searchQuery) ||
          (f.externalFileId || '').toLowerCase().includes(searchQuery) ||
          (f.accountEmail || '').toLowerCase().includes(searchQuery)
      );
    }

    res.status(200).json({
      success: true,
      data: files,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

storageRouter.get('/files/:fileId', async (req, res, next) => {
  try {
    const metadata = await StorageService.getFileMetadata(req.params.fileId);
    res.status(200).json({
      success: true,
      data: metadata,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

storageRouter.get('/files/:fileId/stream-prep', async (req, res, next) => {
  try {
    const streamMeta = await DriveStreamPrepService.getStreamableFileMetadata(req.params.fileId);
    res.status(200).json({
      success: true,
      data: streamMeta,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

storageRouter.delete('/files/:fileId', storageMutationRateLimiter, async (req, res, next) => {
  try {
    await StorageService.deleteFile(req.params.fileId, req.admin!.uid);
    res.status(200).json({
      success: true,
      data: { deleted: true, fileId: req.params.fileId },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
