import type { RemoteObjectMetadata } from '../../../shared/types/storage';
import { GoogleDriveApi, GoogleDriveApiHttpError } from './googleDriveApi';
import type {
  AbortMultipartParams,
  CompleteMultipartParams,
  CreatePartUrlsParams,
  InitiatedUploadResult,
  InitiateUploadSessionParams,
  ListedRemoteObject,
  StorageProviderAdapter,
  VerifyConnectionResult,
} from './types';

function extractAccessToken(credentials: { accessToken?: string }): string {
  if (!credentials.accessToken) {
    throw new Error('Google Drive access token is required for Drive API call.');
  }
  return credentials.accessToken;
}

export const googleDriveAdapter: StorageProviderAdapter = {
  async verifyConnection(_account, credentials): Promise<VerifyConnectionResult> {
    return this.getHealthAndUsage(_account, credentials);
  },

  async getHealthAndUsage(account, credentials): Promise<VerifyConnectionResult> {
    const startedAt = Date.now();
    try {
      const accessToken = extractAccessToken(credentials);
      const about = await GoogleDriveApi.fetchAboutAndQuota(accessToken);
      const folderId = await GoogleDriveApi.ensureStudioFolder(
        accessToken,
        account.accountIdExternal || undefined
      );
      const files = await GoogleDriveApi.listFilesInFolder(accessToken, folderId);

      const totalStudioBytes = files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
      const remainingText =
        about.quota.isUnlimited
          ? 'Unlimited quota'
          : `${((about.quota.remainingBytes ?? 0) / (1024 * 1024 * 1024)).toFixed(2)} GB remaining`;

      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        message: `Connected to Google Drive (${about.userEmail || account.bucketName}). ${remainingText}.`,
        measuredUsedBytes: about.quota.usageInDriveBytes ?? totalStudioBytes,
        measuredObjectCount: files.length,
        usageTruncated: false,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : 'Google Drive health check failed.',
        measuredUsedBytes: null,
        measuredObjectCount: null,
        usageTruncated: false,
      };
    }
  },

  async listObjects(_account, credentials): Promise<ListedRemoteObject[]> {
    const accessToken = extractAccessToken(credentials);
    const files = await GoogleDriveApi.listFilesInFolder(accessToken, null);
    return files.map((file) => ({
      objectKey: file.id,
      sizeBytes: file.sizeBytes ?? 0,
      etag: file.md5Checksum,
      lastModified: file.modifiedTime,
    }));
  },

  async headObject(_account, credentials, objectKey): Promise<RemoteObjectMetadata> {
    const accessToken = extractAccessToken(credentials);
    try {
      const meta = await GoogleDriveApi.getFileMetadata(accessToken, objectKey);
      return {
        objectKey: meta.id,
        externalFileId: meta.id,
        exists: !meta.trashed,
        trashed: meta.trashed,
        sizeBytes: meta.sizeBytes,
        contentType: meta.mimeType,
        etag: meta.md5Checksum,
        md5Checksum: meta.md5Checksum,
        lastModified: meta.modifiedTime,
      };
    } catch (err) {
      if (err instanceof GoogleDriveApiHttpError && err.status === 404) {
        return {
          objectKey,
          externalFileId: objectKey,
          exists: false,
          trashed: false,
          sizeBytes: null,
          contentType: null,
          etag: null,
          md5Checksum: null,
          lastModified: null,
        };
      }
      throw err;
    }
  },

  async createSinglePutUrl(): Promise<{ url: string; expiresAt: string }> {
    throw new Error('Google Drive always uses GOOGLE_DRIVE_RESUMABLE upload sessions.');
  },

  async initiateMultipartUpload(
    account,
    credentials,
    params: InitiateUploadSessionParams
  ): Promise<InitiatedUploadResult> {
    const accessToken = extractAccessToken(credentials);
    const resumableSessionUri = await GoogleDriveApi.initiateResumableUpload(accessToken, {
      fileName: params.objectKey.split('/').pop() || params.objectKey,
      contentType: params.contentType,
      fileSizeBytes: params.fileSizeBytes,
      folderId: account.accountIdExternal || null,
      sessionId: params.objectKey,
      objectKey: params.objectKey,
      origin: params.origin,
    });
    return {
      uploadStrategy: 'GOOGLE_DRIVE_RESUMABLE',
      uploadId: null,
      resumableSessionUri,
    };
  },

  async createPartUploadUrls(
    _account,
    _credentials,
    _params: CreatePartUrlsParams
  ) {
    return [];
  },

  async completeMultipartUpload(
    _account,
    _credentials,
    _params: CompleteMultipartParams
  ): Promise<{ etag: string | null }> {
    return { etag: null };
  },

  async abortMultipartUpload(
    _account,
    credentials,
    params: AbortMultipartParams
  ): Promise<void> {
    const accessToken = extractAccessToken(credentials);
    await GoogleDriveApi.abortResumableUpload(params.uploadId, accessToken);
  },

  async deleteObject(_account, credentials, objectKey): Promise<void> {
    const accessToken = extractAccessToken(credentials);
    await GoogleDriveApi.deleteFileAndVerify(accessToken, objectKey);
  },
};
