import type { StorageProviderType } from '../../shared/types/storage';

export function formatBytes(bytes: number | null | undefined, decimals = 2): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  const precision = i === 0 ? 0 : decimals;
  return `${value.toFixed(precision)} ${units[i]}`;
}

export function formatSpeedBps(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 MB/s';
  }
  const mbps = bytesPerSecond / (1024 * 1024);
  if (mbps >= 1) {
    return `${mbps.toFixed(mbps >= 100 ? 0 : 1)} MB/s`;
  }
  const kbps = bytesPerSecond / 1024;
  return `${kbps.toFixed(0)} KB/s`;
}

export function formatEtaSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '--';
  }
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins < 60) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins.toString().padStart(2, '0')}m`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getProviderLabel(provider: StorageProviderType): string {
  switch (provider) {
    case 'GOOGLE_DRIVE':
      return 'Google Drive';
    case 'CLOUDFLARE_R2':
      return 'Cloudflare R2';
    case 'AMAZON_S3':
      return 'Amazon S3';
    case 'GOOGLE_CLOUD_STORAGE':
      return 'Google Cloud Storage';
    case 'S3_COMPATIBLE':
      return 'S3-Compatible';
    default:
      return provider;
  }
}
