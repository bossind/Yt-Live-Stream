import type {
  CompletedUploadPart,
  PresignedPartUrlItem,
  RemoteObjectMetadata,
  StorageAccount,
  UploadStrategy,
} from '../../../shared/types/storage';
import type { ProviderCredentialsPayload } from '../../crypto/secretVault';

export interface VerifyConnectionResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  measuredUsedBytes: number | null;
  measuredObjectCount: number | null;
  usageTruncated: boolean;
}

export interface ListedRemoteObject {
  objectKey: string;
  sizeBytes: number;
  etag: string | null;
  lastModified: string | null;
}

export interface CreateSinglePutParams {
  objectKey: string;
  contentType: string;
  fileSizeBytes: number;
  expiresInSeconds: number;
}

export interface InitiateUploadSessionParams {
  objectKey: string;
  contentType: string;
  fileSizeBytes: number;
  origin?: string;
}

export interface InitiatedUploadResult {
  uploadStrategy: UploadStrategy;
  uploadId: string | null;
  resumableSessionUri: string | null;
}

export interface CreatePartUrlsParams {
  objectKey: string;
  uploadId: string;
  partNumbers: number[];
  expiresInSeconds: number;
}

export interface CompleteMultipartParams {
  objectKey: string;
  uploadId: string;
  parts: CompletedUploadPart[];
}

export interface AbortMultipartParams {
  objectKey: string;
  uploadId: string;
}

export interface StorageProviderAdapter {
  verifyConnection(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload
  ): Promise<VerifyConnectionResult>;

  getHealthAndUsage(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload
  ): Promise<VerifyConnectionResult>;

  listObjects(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    prefix?: string,
    maxKeys?: number
  ): Promise<ListedRemoteObject[]>;

  headObject(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    objectKey: string
  ): Promise<RemoteObjectMetadata>;

  createSinglePutUrl(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    params: CreateSinglePutParams
  ): Promise<{ url: string; expiresAt: string }>;

  initiateMultipartUpload(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    params: InitiateUploadSessionParams
  ): Promise<InitiatedUploadResult>;

  createPartUploadUrls(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    params: CreatePartUrlsParams
  ): Promise<PresignedPartUrlItem[]>;

  completeMultipartUpload(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    params: CompleteMultipartParams
  ): Promise<{ etag: string | null }>;

  abortMultipartUpload(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    params: AbortMultipartParams
  ): Promise<void>;

  deleteObject(
    account: Pick<
      StorageAccount,
      'provider' | 'bucketName' | 'region' | 'endpoint' | 'accountIdExternal' | 'gcsAuthMode'
    >,
    credentials: ProviderCredentialsPayload,
    objectKey: string
  ): Promise<void>;
}
