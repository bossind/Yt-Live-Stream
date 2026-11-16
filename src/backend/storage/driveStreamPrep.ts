import type { Readable } from 'node:stream';
import { AppError } from '../errors/AppError';
import { GoogleDriveApi, GoogleDriveApiHttpError } from './providers/googleDriveApi';
import { GoogleDriveOAuthService } from './providers/googleDriveOAuth';
import { StorageStore } from './storageStore';

/**
 * Future Phase 4 Streaming Compatibility Interface (Storage Layer Preparation Only).
 *
 * IMPORTANT GOOGLE DRIVE STREAMING NOTES:
 * 1. Google Drive enforces per-user & per-project API rate limits and large-file download quotas.
 *    Future Phase 4 FFmpeg pipelines should buffer/cache segments locally on the streaming worker
 *    and throttle seek/range requests rather than repeatedly opening small range streams.
 * 2. OAuth access tokens expire roughly every 60 minutes; openMediaReadStream() automatically
 *    refreshes tokens via encrypted refresh_token before initiating a download, and detects
 *    revoked access (invalid_grant) or deleted/trashed files cleanly.
 */
export interface StreamableFileMetadata {
  fileId: string;
  externalFileId: string;
  accountId: string;
  accountEmail: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum: string | null;
  supportsByteRanges: boolean;
}

export interface MediaReadStreamHandle {
  metadata: StreamableFileMetadata;
  statusCode: number;
  contentLength: number | null;
  contentRange: string | null;
  stream: Readable;
}

export interface StudioMediaReader {
  getStreamableFileMetadata(fileId: string): Promise<StreamableFileMetadata>;
  openMediaReadStream(
    fileId: string,
    byteRange?: { start?: number; end?: number }
  ): Promise<MediaReadStreamHandle>;
}

export const DriveStreamPrepService: StudioMediaReader = {
  async getStreamableFileMetadata(fileId: string): Promise<StreamableFileMetadata> {
    const file = await StorageStore.getFile(fileId);
    if (!file) {
      throw new AppError('Media file record not found.', 404, 'FILE_NOT_FOUND');
    }
    if (file.provider !== 'GOOGLE_DRIVE' || !file.externalFileId) {
      throw new AppError(
        'This file does not belong to an active Google Drive storage account.',
        400,
        'UNSUPPORTED_STREAM_SOURCE'
      );
    }

    const { accessToken, account } = await GoogleDriveOAuthService.getValidAccessToken(
      file.accountId
    );

    try {
      const meta = await GoogleDriveApi.getFileMetadata(accessToken, file.externalFileId);
      if (meta.trashed) {
        throw new AppError(
          `Google Drive file "${file.fileName}" is in Trash and cannot be streamed.`,
          404,
          'DRIVE_FILE_TRASHED'
        );
      }

      return {
        fileId: file.id,
        externalFileId: meta.id,
        accountId: account.id,
        accountEmail: account.accountEmail,
        fileName: meta.name || file.fileName,
        mimeType: meta.mimeType || file.contentType,
        sizeBytes: meta.sizeBytes ?? file.fileSizeBytes,
        md5Checksum: meta.md5Checksum ?? file.md5Checksum,
        supportsByteRanges: true,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof GoogleDriveApiHttpError) {
        if (err.status === 404) {
          throw new AppError(
            `Google Drive file "${file.fileName}" no longer exists on Drive.`,
            404,
            'DRIVE_FILE_MISSING'
          );
        }
        if (err.status === 401 || err.status === 403) {
          await GoogleDriveOAuthService.markAccountRevoked(
            account,
            'Google Drive access denied during media stream check.'
          );
          throw new AppError(
            'Google Drive authorization was revoked or denied.',
            401,
            'DRIVE_AUTH_REVOKED'
          );
        }
      }
      throw new AppError(
        err instanceof Error ? err.message : 'Failed to verify Drive file for streaming.',
        502,
        'DRIVE_STREAM_PREP_FAILED'
      );
    }
  },

  async openMediaReadStream(
    fileId: string,
    byteRange?: { start?: number; end?: number }
  ): Promise<MediaReadStreamHandle> {
    const metadata = await this.getStreamableFileMetadata(fileId);
    const { accessToken, account } = await GoogleDriveOAuthService.getValidAccessToken(
      metadata.accountId
    );

    try {
      const dl = await GoogleDriveApi.openMediaDownloadResponse(
        accessToken,
        metadata.externalFileId,
        byteRange
      );
      if (!dl.body) {
        throw new AppError(
          'Google Drive returned an empty media stream body.',
          502,
          'DRIVE_EMPTY_STREAM'
        );
      }
      return {
        metadata,
        statusCode: dl.status,
        contentLength: dl.contentLength,
        contentRange: dl.contentRange,
        stream: dl.body,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof GoogleDriveApiHttpError) {
        if (err.status === 401) {
          await GoogleDriveOAuthService.markAccountRevoked(
            account,
            'Google Drive access token rejected while opening media stream.'
          );
          throw new AppError('Google Drive authorization revoked.', 401, 'DRIVE_AUTH_REVOKED');
        }
        if (err.status === 404) {
          throw new AppError(
            'Google Drive file was deleted or is no longer accessible.',
            404,
            'DRIVE_FILE_MISSING'
          );
        }
        if (err.status === 403) {
          throw new AppError(
            `Google Drive download quota or permission error: ${err.message}`,
            403,
            'DRIVE_DOWNLOAD_FORBIDDEN'
          );
        }
      }
      throw new AppError(
        err instanceof Error ? err.message : 'Failed to open Google Drive media stream.',
        502,
        'DRIVE_STREAM_OPEN_FAILED'
      );
    }
  },
};
