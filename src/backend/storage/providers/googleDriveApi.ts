import type { Readable } from 'node:stream';
import type { DriveQuotaSnapshot } from '../../../shared/types/storage';

export interface GoogleUserInfo {
  id: string | null;
  email: string;
  name: string | null;
}

export interface DriveAboutResponse {
  userEmail: string;
  userDisplayName: string | null;
  permissionId: string | null;
  quota: DriveQuotaSnapshot;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  sizeBytes: number | null;
  mimeType: string | null;
  md5Checksum: string | null;
  trashed: boolean;
  modifiedTime: string | null;
  parents: string[];
}

export interface ResumableStatusResult {
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  uploadedBytesConfirmed: number;
  file?: DriveFileMeta;
}

const STUDIO_FOLDER_NAME = 'YouTube Live Automation Studio';

function getDriveApiBase(): string {
  return (process.env.GOOGLE_DRIVE_API_BASE || 'https://www.googleapis.com/drive/v3').replace(
    /\/+$/,
    ''
  );
}

function getDriveUploadBase(): string {
  return (
    process.env.GOOGLE_DRIVE_UPLOAD_BASE || 'https://www.googleapis.com/upload/drive/v3'
  ).replace(/\/+$/, '');
}

function getUserInfoUrl(): string {
  return (
    process.env.GOOGLE_USERINFO_ENDPOINT || 'https://www.googleapis.com/oauth2/v2/userinfo'
  ).trim();
}

function parseOptionalInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
}

function parseDriveFileMeta(raw: Record<string, unknown>): DriveFileMeta {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    sizeBytes: parseOptionalInt(raw.size),
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : null,
    md5Checksum: typeof raw.md5Checksum === 'string' ? raw.md5Checksum : null,
    trashed: Boolean(raw.trashed),
    modifiedTime: typeof raw.modifiedTime === 'string' ? raw.modifiedTime : null,
    parents: Array.isArray(raw.parents) ? raw.parents.map(String) : [],
  };
}

async function parseGoogleError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> } | string;
      error_description?: string;
    };
    if (typeof json.error === 'object' && json.error?.message) {
      return json.error.message;
    }
    if (typeof json.error === 'string') {
      return json.error_description || json.error;
    }
  } catch {
    // Plain text fallback below
  }
  return text.slice(0, 300);
}

export class GoogleDriveApiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const GoogleDriveApi = {
  async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const res = await fetch(getUserInfoUrl(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new GoogleDriveApiHttpError(
        res.status,
        `Google userinfo request failed (${res.status}): ${await parseGoogleError(res)}`
      );
    }
    const data = (await res.json()) as { id?: string; email?: string; name?: string };
    const email = (data.email || '').trim().toLowerCase();
    if (!email) {
      throw new GoogleDriveApiHttpError(
        502,
        'Google OAuth response did not include a verified account email address.'
      );
    }
    return {
      id: data.id || null,
      email,
      name: data.name || null,
    };
  },

  async fetchAboutAndQuota(accessToken: string): Promise<DriveAboutResponse> {
    const fields = encodeURIComponent(
      'user(displayName,emailAddress,permissionId),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)'
    );
    const res = await fetch(`${getDriveApiBase()}/about?fields=${fields}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new GoogleDriveApiHttpError(
        res.status,
        `Google Drive about.get failed (${res.status}): ${await parseGoogleError(res)}`
      );
    }
    const raw = (await res.json()) as {
      user?: { displayName?: string; emailAddress?: string; permissionId?: string };
      storageQuota?: {
        limit?: string | number;
        usage?: string | number;
        usageInDrive?: string | number;
        usageInDriveTrash?: string | number;
      };
    };

    const sq = raw.storageQuota || {};
    const limitBytes = parseOptionalInt(sq.limit);
    const totalAccountUsageBytes = parseOptionalInt(sq.usage);
    const usageInDriveBytes = parseOptionalInt(sq.usageInDrive);
    const usageInDriveTrashBytes = parseOptionalInt(sq.usageInDriveTrash);
    const isUnlimited = limitBytes === null;
    const remainingBytes =
      limitBytes !== null && totalAccountUsageBytes !== null
        ? Math.max(0, limitBytes - totalAccountUsageBytes)
        : limitBytes !== null && usageInDriveBytes !== null
          ? Math.max(0, limitBytes - usageInDriveBytes)
          : null;

    return {
      userEmail: (raw.user?.emailAddress || '').trim().toLowerCase(),
      userDisplayName: raw.user?.displayName || null,
      permissionId: raw.user?.permissionId || null,
      quota: {
        limitBytes,
        totalAccountUsageBytes,
        usageInDriveBytes,
        usageInDriveTrashBytes,
        remainingBytes,
        isUnlimited,
        quotaSharedAcrossGoogleServices: true,
      },
    };
  },

  async ensureStudioFolder(accessToken: string, existingFolderId?: string | null): Promise<string> {
    if (existingFolderId) {
      try {
        const meta = await this.getFileMetadata(accessToken, existingFolderId);
        if (!meta.trashed) {
          return meta.id;
        }
      } catch (err) {
        if (!(err instanceof GoogleDriveApiHttpError && err.status === 404)) {
          throw err;
        }
      }
    }

    const q = encodeURIComponent(
      `name = '${STUDIO_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const listRes = await fetch(
      `${getDriveApiBase()}/files?q=${q}&spaces=drive&fields=files(id,name)&pageSize=5`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!listRes.ok) {
      throw new GoogleDriveApiHttpError(
        listRes.status,
        `Google Drive folder lookup failed (${listRes.status}): ${await parseGoogleError(listRes)}`
      );
    }
    const listData = (await listRes.json()) as { files?: Array<{ id?: string; name?: string }> };
    const existing = listData.files?.[0]?.id;
    if (existing) {
      return existing;
    }

    const createRes = await fetch(`${getDriveApiBase()}/files?fields=id,name`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        name: STUDIO_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!createRes.ok) {
      throw new GoogleDriveApiHttpError(
        createRes.status,
        `Google Drive folder creation failed (${createRes.status}): ${await parseGoogleError(createRes)}`
      );
    }
    const created = (await createRes.json()) as { id?: string };
    if (!created.id) {
      throw new GoogleDriveApiHttpError(502, 'Google Drive did not return a folder ID.');
    }
    return created.id;
  },

  async initiateResumableUpload(
    accessToken: string,
    params: {
      fileName: string;
      contentType: string;
      fileSizeBytes: number;
      folderId: string | null;
      sessionId: string;
      objectKey: string;
      origin?: string;
    }
  ): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': params.contentType,
      'X-Upload-Content-Length': String(params.fileSizeBytes),
    };
    if (params.origin && /^https?:\/\//i.test(params.origin)) {
      headers.Origin = params.origin;
    }

    const res = await fetch(
      `${getDriveUploadBase()}/files?uploadType=resumable&fields=id,name,size,mimeType,md5Checksum,parents`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: params.fileName,
          mimeType: params.contentType,
          parents: params.folderId ? [params.folderId] : undefined,
          appProperties: {
            studioSessionId: params.sessionId,
            studioObjectKey: params.objectKey,
          },
        }),
      }
    );

    if (!res.ok) {
      throw new GoogleDriveApiHttpError(
        res.status,
        `Google Drive resumable session initiation failed (${res.status}): ${await parseGoogleError(res)}`
      );
    }

    const location = res.headers.get('location');
    if (!location) {
      throw new GoogleDriveApiHttpError(
        502,
        'Google Drive resumable initiation did not return a session Location URI.'
      );
    }
    return location;
  },

  async queryResumableUploadOffset(
    resumableSessionUri: string,
    fileSizeBytes: number
  ): Promise<ResumableStatusResult> {
    const res = await fetch(resumableSessionUri, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${fileSizeBytes}`,
      },
    });

    if (res.status === 308) {
      const rangeHeader = res.headers.get('range');
      if (!rangeHeader) {
        return { status: 'ACTIVE', uploadedBytesConfirmed: 0 };
      }
      const match = /bytes=0-(\d+)/i.exec(rangeHeader);
      const lastByte = match ? Number(match[1]) : -1;
      const confirmed = Number.isFinite(lastByte) && lastByte >= 0 ? lastByte + 1 : 0;
      return { status: 'ACTIVE', uploadedBytesConfirmed: confirmed };
    }

    if (res.status === 200 || res.status === 201) {
      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        status: 'COMPLETED',
        uploadedBytesConfirmed: fileSizeBytes,
        file: raw.id ? parseDriveFileMeta(raw) : undefined,
      };
    }

    if (res.status === 404 || res.status === 410) {
      return { status: 'EXPIRED', uploadedBytesConfirmed: 0 };
    }

    throw new GoogleDriveApiHttpError(
      res.status,
      `Google Drive resumable status query failed (${res.status}): ${await parseGoogleError(res)}`
    );
  },

  async abortResumableUpload(resumableSessionUri: string, accessToken: string): Promise<void> {
    const res = await fetch(resumableSessionUri, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok || res.status === 404 || res.status === 410 || res.status === 499) {
      return;
    }
    throw new GoogleDriveApiHttpError(
      res.status,
      `Failed to cancel Google Drive resumable session (${res.status}).`
    );
  },

  async getFileMetadata(accessToken: string, externalFileId: string): Promise<DriveFileMeta> {
    const fields = encodeURIComponent('id,name,size,mimeType,md5Checksum,trashed,modifiedTime,parents');
    const res = await fetch(
      `${getDriveApiBase()}/files/${encodeURIComponent(externalFileId)}?fields=${fields}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      throw new GoogleDriveApiHttpError(
        res.status,
        `Google Drive files.get failed (${res.status}): ${await parseGoogleError(res)}`
      );
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return parseDriveFileMeta(raw);
  },

  async listFilesInFolder(accessToken: string, folderId: string | null): Promise<DriveFileMeta[]> {
    const query = folderId
      ? `'${folderId}' in parents and trashed = false`
      : `trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const fields = encodeURIComponent(
      'files(id,name,size,mimeType,md5Checksum,trashed,modifiedTime,parents)'
    );
    const res = await fetch(
      `${getDriveApiBase()}/files?q=${encodeURIComponent(query)}&fields=${fields}&pageSize=200`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      throw new GoogleDriveApiHttpError(
        res.status,
        `Google Drive files.list failed (${res.status}): ${await parseGoogleError(res)}`
      );
    }
    const raw = (await res.json()) as { files?: Array<Record<string, unknown>> };
    return (raw.files || []).map(parseDriveFileMeta);
  },

  async deleteFileAndVerify(accessToken: string, externalFileId: string): Promise<void> {
    const delRes = await fetch(
      `${getDriveApiBase()}/files/${encodeURIComponent(externalFileId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!delRes.ok && delRes.status !== 404) {
      throw new GoogleDriveApiHttpError(
        delRes.status,
        `Google Drive files.delete failed (${delRes.status}): ${await parseGoogleError(delRes)}`
      );
    }

    // Verify deletion with files.get
    try {
      const check = await this.getFileMetadata(accessToken, externalFileId);
      if (!check.trashed) {
        throw new GoogleDriveApiHttpError(
          502,
          'Google Drive deletion verification failed: file still exists and is active.'
        );
      }
    } catch (err) {
      if (err instanceof GoogleDriveApiHttpError && err.status === 404) {
        return; // Confirmed removed
      }
      throw err;
    }
  },

  async openMediaDownloadResponse(
    accessToken: string,
    externalFileId: string,
    range?: { start?: number; end?: number }
  ): Promise<{
    status: number;
    contentType: string | null;
    contentLength: number | null;
    contentRange: string | null;
    body: Readable | null;
  }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (range && (typeof range.start === 'number' || typeof range.end === 'number')) {
      const start = typeof range.start === 'number' ? Math.max(0, Math.floor(range.start)) : 0;
      const end = typeof range.end === 'number' ? Math.floor(range.end) : '';
      headers.Range = `bytes=${start}-${end}`;
    }

    const res = await fetch(
      `${getDriveApiBase()}/files/${encodeURIComponent(externalFileId)}?alt=media`,
      { headers }
    );

    if (!res.ok) {
      throw new GoogleDriveApiHttpError(
        res.status,
        `Google Drive media stream request failed (${res.status}): ${await parseGoogleError(res)}`
      );
    }

    const { Readable: NodeReadable } = await import('node:stream');
    const body = res.body ? NodeReadable.fromWeb(res.body as unknown as import('stream/web').ReadableStream) : null;
    const lenHeader = res.headers.get('content-length');

    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: lenHeader ? Number(lenHeader) : null,
      contentRange: res.headers.get('content-range'),
      body,
    };
  },
};
