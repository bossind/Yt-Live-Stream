import type {
  CompleteUploadInput,
  CreateStorageAccountInput,
  DriveQuotaSnapshot,
  GoogleDriveOAuthStatus,
  InitiateUploadInput,
  InitiateUploadResponse,
  PartUrlsResponse,
  RecordPartProgressInput,
  RemoteObjectMetadata,
  ResumeUploadResponse,
  StartGoogleDriveOAuthInput,
  StartGoogleDriveOAuthResponse,
  StorageAccount,
  StorageAccountStatus,
  StorageFileRecord,
  StorageHealthCheckResult,
  StorageOverviewPayload,
  StorageProviderType,
  UpdateStorageAccountInput,
  UploadSessionRecord,
} from '../../shared/types/storage';
import { apiRequest } from './apiClient';

export interface StorageUsageSummary {
  totalAccounts: number;
  connectedAccounts: number;
  revokedAccounts: number;
  errorAccounts: number;
  totalFilesCount: number;
  totalUploadedBytesTracked: number;
  accounts: Array<{
    id: string;
    provider: StorageProviderType;
    accountName: string;
    accountEmail: string | null;
    status: StorageAccountStatus;
    quotaBytes: number;
    usedBytes: number;
    driveStorageQuota: DriveQuotaSnapshot | null;
  }>;
}

export const storageApi = {
  async getGoogleDriveOAuthStatus(): Promise<GoogleDriveOAuthStatus> {
    const res = await apiRequest<GoogleDriveOAuthStatus>('/api/v1/storage/google-drive/oauth/status');
    if (!res.data) throw new Error('Empty Google Drive OAuth status payload.');
    return res.data;
  },

  async startGoogleDriveOAuth(
    input: StartGoogleDriveOAuthInput
  ): Promise<StartGoogleDriveOAuthResponse> {
    const res = await apiRequest<StartGoogleDriveOAuthResponse>(
      '/api/v1/storage/google-drive/oauth/start',
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    if (!res.data) throw new Error('Failed to start Google Drive OAuth flow.');
    return res.data;
  },

  async getOverview(): Promise<StorageOverviewPayload> {
    const res = await apiRequest<StorageOverviewPayload>('/api/v1/storage/overview');
    if (!res.data) throw new Error('Empty storage overview response.');
    return res.data;
  },

  async getUsageSummary(): Promise<StorageUsageSummary> {
    const res = await apiRequest<StorageUsageSummary>('/api/v1/storage/usage');
    if (!res.data) throw new Error('Empty storage usage response.');
    return res.data;
  },

  async listProviders(): Promise<StorageAccount[]> {
    const res = await apiRequest<StorageAccount[]>('/api/v1/storage/providers');
    return res.data ?? [];
  },

  async createProvider(input: CreateStorageAccountInput): Promise<StorageAccount> {
    const res = await apiRequest<StorageAccount>('/api/v1/storage/providers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.data) throw new Error('Provider creation returned no account.');
    return res.data;
  },

  async updateProvider(
    accountId: string,
    input: UpdateStorageAccountInput
  ): Promise<StorageAccount> {
    const res = await apiRequest<StorageAccount>(
      `/api/v1/storage/providers/${encodeURIComponent(accountId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    );
    if (!res.data) throw new Error('Provider update returned no account.');
    return res.data;
  },

  async setDefaultProvider(accountId: string): Promise<StorageAccount> {
    const res = await apiRequest<StorageAccount>(
      `/api/v1/storage/providers/${encodeURIComponent(accountId)}/default`,
      { method: 'POST' }
    );
    if (!res.data) throw new Error('Setting default provider returned no account.');
    return res.data;
  },

  async checkProviderHealth(accountId: string): Promise<StorageHealthCheckResult> {
    const res = await apiRequest<StorageHealthCheckResult>(
      `/api/v1/storage/providers/${encodeURIComponent(accountId)}/health`,
      { method: 'POST' }
    );
    if (!res.data) throw new Error('Health check returned no result.');
    return res.data;
  },

  async disconnectProvider(accountId: string): Promise<void> {
    await apiRequest<{ disconnected: boolean }>(
      `/api/v1/storage/providers/${encodeURIComponent(accountId)}`,
      { method: 'DELETE' }
    );
  },

  async initiateUpload(input: InitiateUploadInput): Promise<InitiateUploadResponse> {
    const res = await apiRequest<InitiateUploadResponse>('/api/v1/storage/uploads/initiate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.data) throw new Error('Upload initiation returned empty payload.');
    return res.data;
  },

  async getPartUrls(sessionId: string, partNumbers: number[]): Promise<PartUrlsResponse> {
    const res = await apiRequest<PartUrlsResponse>(
      `/api/v1/storage/uploads/${encodeURIComponent(sessionId)}/part-urls`,
      {
        method: 'POST',
        body: JSON.stringify({ partNumbers }),
      }
    );
    if (!res.data) throw new Error('Part URL generation returned empty payload.');
    return res.data;
  },

  async recordPartProgress(
    sessionId: string,
    input: RecordPartProgressInput
  ): Promise<UploadSessionRecord> {
    const res = await apiRequest<UploadSessionRecord>(
      `/api/v1/storage/uploads/${encodeURIComponent(sessionId)}/part-progress`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    if (!res.data) throw new Error('Part progress update failed.');
    return res.data;
  },

  async setUploadPaused(sessionId: string, paused: boolean): Promise<UploadSessionRecord> {
    const res = await apiRequest<UploadSessionRecord>(
      `/api/v1/storage/uploads/${encodeURIComponent(sessionId)}/pause`,
      {
        method: 'POST',
        body: JSON.stringify({ paused }),
      }
    );
    if (!res.data) throw new Error('Pause state update failed.');
    return res.data;
  },

  async resumeUpload(sessionId: string): Promise<ResumeUploadResponse> {
    const res = await apiRequest<ResumeUploadResponse>(
      `/api/v1/storage/uploads/${encodeURIComponent(sessionId)}/resume`,
      { method: 'POST' }
    );
    if (!res.data) throw new Error('Resume upload returned empty payload.');
    return res.data;
  },

  async completeUpload(
    sessionId: string,
    input: CompleteUploadInput
  ): Promise<StorageFileRecord> {
    const res = await apiRequest<StorageFileRecord>(
      `/api/v1/storage/uploads/${encodeURIComponent(sessionId)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    if (!res.data) throw new Error('Complete upload returned no file record.');
    return res.data;
  },

  async abortUpload(sessionId: string): Promise<void> {
    await apiRequest<{ aborted: boolean }>(
      `/api/v1/storage/uploads/${encodeURIComponent(sessionId)}/abort`,
      { method: 'POST' }
    );
  },

  async listFiles(params?: {
    provider?: string;
    accountId?: string;
    search?: string;
  }): Promise<StorageFileRecord[]> {
    const qs = new URLSearchParams();
    if (params?.provider) qs.set('provider', params.provider);
    if (params?.accountId) qs.set('accountId', params.accountId);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiRequest<StorageFileRecord[]>(`/api/v1/storage/files${suffix}`);
    return res.data ?? [];
  },

  async getFileMetadata(fileId: string): Promise<{
    file: StorageFileRecord;
    remote: RemoteObjectMetadata;
  }> {
    const res = await apiRequest<{
      file: StorageFileRecord;
      remote: RemoteObjectMetadata;
    }>(`/api/v1/storage/files/${encodeURIComponent(fileId)}`);
    if (!res.data) throw new Error('File metadata returned empty payload.');
    return res.data;
  },

  async deleteFile(fileId: string): Promise<void> {
    await apiRequest<{ deleted: boolean }>(
      `/api/v1/storage/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' }
    );
  },
};
