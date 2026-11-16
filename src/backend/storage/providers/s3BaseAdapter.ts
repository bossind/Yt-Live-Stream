import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignedPartUrlItem, RemoteObjectMetadata, StorageAccount } from '../../../shared/types/storage';
import type { ProviderCredentialsPayload } from '../../crypto/secretVault';
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

function resolveS3Endpoint(account: AccountConfigSlice): string | undefined {
  if (account.provider === 'CLOUDFLARE_R2') {
    if (account.endpoint) {
      return account.endpoint.replace(/\/+$/, '');
    }
    if (account.accountIdExternal) {
      return `https://${account.accountIdExternal}.r2.cloudflarestorage.com`;
    }
    throw new Error('Cloudflare R2 requires either Account ID or an explicit S3 Endpoint.');
  }

  if (account.provider === 'GOOGLE_CLOUD_STORAGE') {
    return (account.endpoint || 'https://storage.googleapis.com').replace(/\/+$/, '');
  }

  if (account.provider === 'S3_COMPATIBLE') {
    if (!account.endpoint) {
      throw new Error('S3-Compatible storage requires an explicit endpoint URL.');
    }
    return account.endpoint.replace(/\/+$/, '');
  }

  // Amazon S3 uses standard regional AWS endpoints unless custom endpoint is explicitly supplied
  return account.endpoint ? account.endpoint.replace(/\/+$/, '') : undefined;
}

function buildS3Client(
  account: AccountConfigSlice,
  credentials: ProviderCredentialsPayload
): S3Client {
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    throw new Error('Access Key ID and Secret Access Key are required.');
  }

  const endpoint = resolveS3Endpoint(account);
  const region =
    account.region ||
    (account.provider === 'CLOUDFLARE_R2' || account.provider === 'GOOGLE_CLOUD_STORAGE'
      ? 'auto'
      : 'us-east-1');

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: account.provider !== 'AMAZON_S3',
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    // Avoid adding unsigned/mismatched checksum query params to browser presigned PUTs on R2/S3-compatible
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function sanitizeSdkError(err: unknown): string {
  if (err && typeof err === 'object') {
    const rec = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = rec.$metadata?.httpStatusCode ? ` (HTTP ${rec.$metadata.httpStatusCode})` : '';
    const msg = rec.message || rec.name || 'Storage provider request failed.';
    return `${msg}${status}`;
  }
  return 'Storage provider request failed.';
}

async function scanBucketUsage(
  client: S3Client,
  bucketName: string,
  maxPages = 10
): Promise<{ usedBytes: number; objectCount: number; truncated: boolean }> {
  let usedBytes = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;
  let page = 0;
  let truncated = false;

  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );
    for (const item of resp.Contents || []) {
      usedBytes += item.Size ?? 0;
      objectCount += 1;
    }
    page += 1;
    if (resp.IsTruncated && resp.NextContinuationToken) {
      if (page >= maxPages) {
        truncated = true;
        break;
      }
      continuationToken = resp.NextContinuationToken;
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken);

  return { usedBytes, objectCount, truncated };
}

export const s3BaseAdapter: StorageProviderAdapter = {
  async verifyConnection(account, credentials): Promise<VerifyConnectionResult> {
    const start = Date.now();
    try {
      const client = buildS3Client(account, credentials);
      await client.send(new HeadBucketCommand({ Bucket: account.bucketName }));
      const usage = await scanBucketUsage(client, account.bucketName, 5);
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: `Connected and verified bucket "${account.bucketName}".`,
        measuredUsedBytes: usage.usedBytes,
        measuredObjectCount: usage.objectCount,
        usageTruncated: usage.truncated,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: sanitizeSdkError(err),
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
    const client = buildS3Client(account, credentials);
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: account.bucketName,
        Prefix: prefix || undefined,
        MaxKeys: maxKeys,
      })
    );

    return (resp.Contents || [])
      .filter((item): item is typeof item & { Key: string } => Boolean(item.Key))
      .map((item) => ({
        objectKey: item.Key,
        sizeBytes: item.Size ?? 0,
        etag: item.ETag ? item.ETag.replaceAll('"', '') : null,
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
      }));
  },

  async headObject(account, credentials, objectKey): Promise<RemoteObjectMetadata> {
    const client = buildS3Client(account, credentials);
    try {
      const resp = await client.send(
        new HeadObjectCommand({
          Bucket: account.bucketName,
          Key: objectKey,
        })
      );
      return {
        objectKey,
        externalFileId: null,
        exists: true,
        sizeBytes: resp.ContentLength ?? null,
        contentType: resp.ContentType ?? null,
        etag: resp.ETag ? resp.ETag.replaceAll('"', '') : null,
        lastModified: resp.LastModified ? resp.LastModified.toISOString() : null,
      };
    } catch (err) {
      const rec = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (rec?.$metadata?.httpStatusCode === 404 || rec?.name === 'NotFound' || rec?.name === 'NoSuchKey') {
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
      throw new Error(sanitizeSdkError(err));
    }
  },

  async createSinglePutUrl(
    account,
    credentials,
    params: CreateSinglePutParams
  ): Promise<{ url: string; expiresAt: string }> {
    const client = buildS3Client(account, credentials);
    const command = new PutObjectCommand({
      Bucket: account.bucketName,
      Key: params.objectKey,
      ContentType: params.contentType,
    });
    const url = await getSignedUrl(client, command, { expiresIn: params.expiresInSeconds });
    return {
      url,
      expiresAt: new Date(Date.now() + params.expiresInSeconds * 1000).toISOString(),
    };
  },

  async initiateMultipartUpload(
    account,
    credentials,
    params: InitiateUploadSessionParams
  ): Promise<InitiatedUploadResult> {
    const client = buildS3Client(account, credentials);
    const resp = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: account.bucketName,
        Key: params.objectKey,
        ContentType: params.contentType,
      })
    );
    if (!resp.UploadId) {
      throw new Error('Storage provider did not return a multipart upload ID.');
    }
    return {
      uploadStrategy: 'MULTIPART',
      uploadId: resp.UploadId,
      resumableSessionUri: null,
    };
  },

  async createPartUploadUrls(
    account,
    credentials,
    params: CreatePartUrlsParams
  ): Promise<PresignedPartUrlItem[]> {
    const client = buildS3Client(account, credentials);
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000).toISOString();

    const urls = await Promise.all(
      params.partNumbers.map(async (partNumber) => {
        const command = new UploadPartCommand({
          Bucket: account.bucketName,
          Key: params.objectKey,
          UploadId: params.uploadId,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(client, command, { expiresIn: params.expiresInSeconds });
        return { partNumber, url, expiresAt };
      })
    );

    return urls;
  },

  async completeMultipartUpload(
    account,
    credentials,
    params: CompleteMultipartParams
  ): Promise<{ etag: string | null }> {
    const client = buildS3Client(account, credentials);
    const sortedParts = [...params.parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.etag.startsWith('"') ? part.etag : `"${part.etag}"`,
      }));

    const resp = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: account.bucketName,
        Key: params.objectKey,
        UploadId: params.uploadId,
        MultipartUpload: { Parts: sortedParts },
      })
    );

    return {
      etag: resp.ETag ? resp.ETag.replaceAll('"', '') : null,
    };
  },

  async abortMultipartUpload(
    account,
    credentials,
    params: AbortMultipartParams
  ): Promise<void> {
    const client = buildS3Client(account, credentials);
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: account.bucketName,
        Key: params.objectKey,
        UploadId: params.uploadId,
      })
    );
  },

  async deleteObject(account, credentials, objectKey): Promise<void> {
    const client = buildS3Client(account, credentials);
    await client.send(
      new DeleteObjectCommand({
        Bucket: account.bucketName,
        Key: objectKey,
      })
    );
  },
};
