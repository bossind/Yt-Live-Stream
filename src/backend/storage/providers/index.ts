import type { StorageProviderType } from '../../../shared/types/storage';
import { gcsAdapter } from './gcsAdapter';
import { googleDriveAdapter } from './googleDriveAdapter';
import { s3BaseAdapter } from './s3BaseAdapter';
import type { StorageProviderAdapter } from './types';

export function getProviderAdapter(provider: StorageProviderType): StorageProviderAdapter {
  switch (provider) {
    case 'GOOGLE_DRIVE':
      return googleDriveAdapter;
    case 'CLOUDFLARE_R2':
    case 'AMAZON_S3':
    case 'S3_COMPATIBLE':
      return s3BaseAdapter;
    case 'GOOGLE_CLOUD_STORAGE':
      return gcsAdapter;
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unsupported storage provider: ${String(exhaustiveCheck)}`);
    }
  }
}

export function resolveNormalizedEndpoint(params: {
  provider: StorageProviderType;
  endpoint?: string;
  accountIdExternal?: string;
}): string | null {
  if (params.provider === 'GOOGLE_DRIVE') {
    return 'https://www.googleapis.com/drive/v3';
  }
  const rawEndpoint = (params.endpoint || '').trim().replace(/\/+$/, '');
  if (rawEndpoint) {
    return rawEndpoint;
  }
  if (params.provider === 'CLOUDFLARE_R2' && params.accountIdExternal?.trim()) {
    return `https://${params.accountIdExternal.trim()}.r2.cloudflarestorage.com`;
  }
  if (params.provider === 'GOOGLE_CLOUD_STORAGE') {
    return 'https://storage.googleapis.com';
  }
  return null;
}

export function resolveNormalizedRegion(params: {
  provider: StorageProviderType;
  region?: string;
}): string {
  if (params.provider === 'GOOGLE_DRIVE') {
    return 'google-drive';
  }
  const trimmed = (params.region || '').trim();
  if (trimmed) return trimmed;
  if (params.provider === 'CLOUDFLARE_R2' || params.provider === 'GOOGLE_CLOUD_STORAGE') {
    return 'auto';
  }
  return 'us-east-1';
}
