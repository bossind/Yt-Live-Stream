export type StorageProviderType =
  | 'GOOGLE_DRIVE'
  | 'CLOUDFLARE_R2'
  | 'AMAZON_S3'
  | 'GOOGLE_CLOUD_STORAGE'
  | 'S3_COMPATIBLE';

export type GcsAuthMode = 'HMAC_S3' | 'SERVICE_ACCOUNT';

export type StorageAccountStatus = 'CONNECTED' | 'REVOKED' | 'ERROR' | 'DISCONNECTED';

export type StorageSelectionMode = 'AUTO' | 'MANUAL';

export type UploadTuningMode = 'AUTO' | 'ADVANCED';

export type UploadStrategy =
  | 'GOOGLE_DRIVE_RESUMABLE'
  | 'SINGLE_PUT'
  | 'MULTIPART'
  | 'GCS_RESUMABLE';

export type UploadSessionStatus =
  | 'INITIATED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ABORTED'
  | 'FAILED';

export interface DriveQuotaSnapshot {
  limitBytes: number | null;
  totalAccountUsageBytes: number | null;
  usageInDriveBytes: number | null;
  usageInDriveTrashBytes: number | null;
  remainingBytes: number | null;
  isUnlimited: boolean;
  quotaSharedAcrossGoogleServices: boolean;
}

export interface StorageAccount {
  id: string;
  ownerUid: string;
  provider: StorageProviderType;
  accountName: string;
  accountEmail: string | null;
  accountDisplayName: string | null;
  accountIdExternal: string | null;
  driveFolderId: string | null;
  bucketName: string;
  region: string;
  endpoint: string | null;
  gcsAuthMode: GcsAuthMode | null;
  oauthScopes: string[];
  tokenStatus: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REVOKED' | 'NOT_APPLICABLE';
  accessKeyPreview: string;
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  measuredUsedBytes: number | null;
  measuredObjectCount: number | null;
  usageMeasured: boolean;
  driveStorageQuota: DriveQuotaSnapshot | null;
  fileCount: number;
  isDefault: boolean;
  priority: number;
  status: StorageAccountStatus;
  lastConnectedAt: string | null;
  lastHealthCheckAt: string | null;
  lastHealthError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompletedUploadPart {
  partNumber: number;
  etag: string;
  sizeBytes: number;
}

export interface UploadSessionRecord {
  id: string;
  ownerUid: string;
  accountId: string;
  accountName: string;
  accountEmail: string | null;
  provider: StorageProviderType;
  bucketName: string;
  objectKey: string;
  uploadId: string | null;
  uploadStrategy: UploadStrategy;
  resumableSessionUri: string | null;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
  lastModified: number;
  chunkSizeBytes: number;
  totalParts: number;
  uploadedBytesConfirmed: number;
  completedParts: CompletedUploadPart[];
  status: UploadSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StorageFileRecord {
  id: string;
  ownerUid: string;
  accountId: string;
  accountName: string;
  accountEmail: string | null;
  provider: StorageProviderType;
  bucketName: string;
  objectKey: string;
  externalFileId: string | null;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
  etag: string | null;
  md5Checksum: string | null;
  uploadStatus: 'VERIFIED' | 'FAILED';
  uploadStrategy: UploadStrategy;
  uploadSessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageActivityRecord {
  id: string;
  ownerUid: string;
  accountId: string | null;
  accountName: string | null;
  provider: StorageProviderType | null;
  eventType: string;
  status: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  objectKey: string | null;
  bytesAffected: number | null;
  createdAt: string;
}

export type OAuthCallbackSource =
  | 'explicit_env'
  | 'public_base_url'
  | 'request_origin'
  | 'missing';

export interface GoogleDriveOAuthStatus {
  configured: boolean;
  clientIdConfigured: boolean;
  clientIdValid: boolean;
  clientSecretConfigured: boolean;
  clientSecretValid: boolean;
  callbackConfigured: boolean;
  callbackUrl: string | null;
  callbackUsesHttps: boolean;
  callbackValid: boolean;
  callbackSource: OAuthCallbackSource;
  publicBackendUrlConfigured: boolean;
  isProduction: boolean;
  scopes: string[];
  encryptionKeyConfigured: boolean;
  missingConfigKeys: string[];
  configErrors: string[];
  manualStepsRemaining: string[];
}

export interface StorageOverviewPayload {
  persistenceMode: 'firestore' | 'local_dev_fallback';
  encryptionKeyConfigured: boolean;
  googleDriveOAuth: GoogleDriveOAuthStatus;
  totalAccounts: number;
  connectedAccounts: number;
  revokedAccounts: number;
  errorAccounts: number;
  defaultAccountId: string | null;
  totalFilesCount: number;
  totalUploadedBytesTracked: number;
  accounts: StorageAccount[];
  files: StorageFileRecord[];
  activeSessions: UploadSessionRecord[];
  recentActivity: StorageActivityRecord[];
}

export interface CreateStorageAccountInput {
  provider: Exclude<StorageProviderType, 'GOOGLE_DRIVE'>;
  accountName: string;
  bucketName: string;
  region?: string;
  endpoint?: string;
  accountIdExternal?: string;
  gcsAuthMode?: GcsAuthMode;
  accessKeyId?: string;
  secretAccessKey?: string;
  serviceAccountJson?: string;
  quotaGb?: number;
  priority?: number;
  isDefault?: boolean;
}

export interface UpdateStorageAccountInput {
  accountName?: string;
  quotaGb?: number;
  priority?: number;
  isDefault?: boolean;
}

export interface InitiateUploadInput {
  selectionMode: StorageSelectionMode;
  accountId?: string;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
  lastModified: number;
  preferredChunkSizeBytes?: number;
  origin?: string;
}

export interface PresignedPartUrlItem {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export interface InitiateUploadResponse {
  session: UploadSessionRecord;
  selectedAccount: StorageAccount;
  presignedPutUrl?: string;
  resumableSessionUri?: string;
  partUrls?: PresignedPartUrlItem[];
  expiresAt: string;
}

export interface PartUrlsInput {
  partNumbers: number[];
}

export interface PartUrlsResponse {
  sessionId: string;
  partUrls: PresignedPartUrlItem[];
}

export interface RecordPartProgressInput {
  partNumber: number;
  etag: string;
  sizeBytes: number;
  uploadedBytesConfirmed?: number;
}

export interface CompleteUploadInput {
  parts?: CompletedUploadPart[];
  etag?: string | null;
  externalFileId?: string | null;
}

export interface ResumeUploadResponse {
  session: UploadSessionRecord;
  account: StorageAccount;
  pendingPartNumbers: number[];
  uploadedBytesConfirmed: number;
  resumableSessionUri?: string | null;
  presignedPutUrl?: string;
  partUrls?: PresignedPartUrlItem[];
}

export interface StorageHealthCheckResult {
  account: StorageAccount;
  healthy: boolean;
  latencyMs: number;
  message: string;
  measuredUsedBytes: number | null;
  measuredObjectCount: number | null;
  usageTruncated: boolean;
}

export interface RemoteObjectMetadata {
  objectKey: string;
  externalFileId: string | null;
  exists: boolean;
  trashed?: boolean;
  sizeBytes: number | null;
  contentType: string | null;
  etag: string | null;
  md5Checksum?: string | null;
  lastModified: string | null;
}

export interface StartGoogleDriveOAuthInput {
  accountLabel?: string;
  priority?: number;
  isDefault?: boolean;
  reconnectAccountId?: string;
}

export interface StartGoogleDriveOAuthResponse {
  authUrl: string;
  callbackUrl: string;
  scopes: string[];
}

export const TEN_GB_BYTES = 10 * 1024 * 1024 * 1024;
export const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_PART_BYTES = 512 * 1024 * 1024;
export const DRIVE_CHUNK_ALIGNMENT_BYTES = 256 * 1024;
