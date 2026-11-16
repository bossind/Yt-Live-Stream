import { Storage } from '@google-cloud/storage';
import type { PresignedPartUrlItem, RemoteObjectMetadata, StorageAccount } from '../../../shared/types/storage';
import type { ProviderCredentialsPayload } from '../../crypto/secretVault';
import { s3BaseAdapter } from './s3BaseAdapter';
import type {
  AbortMultipartParams,
  CompleteMultipartParams,
  CreatePartUrlsParams,
  CreateSinglePutParams,
  InitiatedUploadResult,
  InitiateUploadSessionParams,
  ListedRemoteObject,
  StorageProviderAdapter,
  VerifyConnectionResult,
} from './types';

type AccountConfigSlice = Pick<
  StorageAccount,
  'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
>;

function parseGcsServiceAccount(credentials: ProviderCredentialsPayload): {
  projectId?: string;
  clientEmail: string;
  privateKey: string;
} {
  if (!credentials.serviceAccountJson) {
    throw new Error('Google Cloud Storage Service Account JSON is required.');
  }
  const parsed = JSON.parse(credentials.serviceAccountJson) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service Account JSON must contain client_email and private_key.');
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, '\n'),
  };
}

function buildGcsClient(credentials: ProviderCredentialsPayload): Storage {
  const sa = parseGcsServiceAccount(credentials);
  return new Storage({
    projectId: sa.projectId,
    credentials: {
      client_email: sa.clientEmail,
      private_key: sa.privateKey,
    },
  });
}

function isHmacMode(account: AccountConfigSlice): boolean {
  return account.gcsAuthMode !== 'SERVICE_ACCOUNT';
}

export const gcsAdapter: StorageProviderAdapter = {
  async verifyConnection(account, credentials): Promise<VerifyConnectionResult> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.verifyConnection(account, credentials);
    }

    const start = Date.now();
    try {
      const storage = buildGcsClient(credentials);
      const bucket = storage.bucket(account.bucketName);
      const [exists] = await bucket.exists();
      if (!exists) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          message: `Google Cloud Storage bucket "${account.bucketName}" does not exist or is not accessible.`,
          measuredUsedBytes: null,
          measuredObjectCount: null,
          usageTruncated: false,
        };
      }

      const [files] = await bucket.getFiles({ maxResults: 1000, autoPaginate: false });
      let usedBytes = 0;
      for (const file of files) {
        const sizeVal = Number(file.metadata?.size || 0);
        if (Number.isFinite(sizeVal)) {
          usedBytes += sizeVal;
        }
      }

      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: `Connected and verified GCS bucket "${account.bucketName}".`,
        measuredUsedBytes: usedBytes,
        measuredObjectCount: files.length,
        usageTruncated: files.length >= 1000,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'GCS connection check failed.',
        measuredUsedBytes: null,
        measuredObjectCount: null,
        usageTruncated: false,
      };
    }
  },

  async getHealthAndUsage(account, credentials): Promise<VerifyConnectionResult> {
    return this.verifyConnection(account, credentials);
  },

  async listObjects(
    account,
    credentials,
    prefix = '',
    maxKeys = 100
  ): Promise<ListedRemoteObject[]> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.listObjects(account, credentials, prefix, maxKeys);
    }
    const storage = buildGcsClient(credentials);
    const [files] = await storage
      .bucket(account.bucketName)
      .getFiles({ prefix: prefix || undefined, maxResults: maxKeys, autoPaginate: false });

    return files.map((file) => ({
      objectKey: file.name,
      sizeBytes: Number(file.metadata?.size || 0),
      etag: typeof file.metadata?.etag === 'string' ? file.metadata.etag : null,
      lastModified: typeof file.metadata?.updated === 'string' ? file.metadata.updated : null,
    }));
  },

  async headObject(account, credentials, objectKey): Promise<RemoteObjectMetadata> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.headObject(account, credentials, objectKey);
    }
    const storage = buildGcsClient(credentials);
    const file = storage.bucket(account.bucketName).file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      return {
        objectKey,
        externalFileId: null,
        exists: false,
        sizeBytes: null,
        contentType: null,
        etag: null,
        lastModified: null,
      };
    }
    const [meta] = await file.getMetadata();
    return {
      objectKey,
      externalFileId: null,
      exists: true,
      sizeBytes: meta.size !== undefined ? Number(meta.size) : null,
      contentType: typeof meta.contentType === 'string' ? meta.contentType : null,
      etag: typeof meta.etag === 'string' ? meta.etag : null,
      lastModified: typeof meta.updated === 'string' ? meta.updated : null,
    };
  },

  async createSinglePutUrl(
    account,
    credentials,
    params: CreateSinglePutParams
  ): Promise<{ url: string; expiresAt: string }> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.createSinglePutUrl(account, credentials, params);
    }
    const storage = buildGcsClient(credentials);
    const expiresMs = Date.now() + params.expiresInSeconds * 1000;
    const [url] = await storage
      .bucket(account.bucketName)
      .file(params.objectKey)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresMs,
        contentType: params.contentType,
      });
    return {
      url,
      expiresAt: new Date(expiresMs).toISOString(),
    };
  },

  async initiateMultipartUpload(
    account,
    credentials,
    params: InitiateUploadSessionParams
  ): Promise<InitiatedUploadResult> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.initiateMultipartUpload(account, credentials, params);
    }
    const storage = buildGcsClient(credentials);
    const [uri] = await storage
      .bucket(account.bucketName)
      .file(params.objectKey)
      .createResumableUpload({
        origin: params.origin,
        metadata: {
          contentType: params.contentType,
        },
      });
    return {
      uploadStrategy: 'GCS_RESUMABLE',
      uploadId: uri,
      resumableSessionUri: uri,
    };
  },

  async createPartUploadUrls(
    account,
    credentials,
    params: CreatePartUrlsParams
  ): Promise<PresignedPartUrlItem[]> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.createPartUploadUrls(account, credentials, params);
    }
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000).toISOString();
    return params.partNumbers.map((partNumber) => ({
      partNumber,
      url: params.uploadId,
      expiresAt,
    }));
  },

  async completeMultipartUpload(
    account,
    credentials,
    params: CompleteMultipartParams
  ): Promise<{ etag: string | null }> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.completeMultipartUpload(account, credentials, params);
    }
    const meta = await this.headObject(account, credentials, params.objectKey);
    if (!meta.exists) {
      throw new Error('Uploaded object could not be verified in Google Cloud Storage.');
    }
    return { etag: meta.etag };
  },

  async abortMultipartUpload(
    account,
    credentials,
    params: AbortMultipartParams
  ): Promise<void> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.abortMultipartUpload(account, credentials, params);
    }
    // Cancel native GCS resumable session via HTTP DELETE on session URI
    if (params.uploadId.startsWith('https://')) {
      await fetch(params.uploadId, { method: 'DELETE' }).catch(() => {});
    }
  },

  async deleteObject(account, credentials, objectKey): Promise<void> {
    if (isHmacMode(account)) {
      return s3BaseAdapter.deleteObject(account, credentials, objectKey);
    }
    const storage = buildGcsClient(credentials);
    await storage.bucket(account.bucketName).file(objectKey).delete({ ignoreNotFound: false });
  },
};
