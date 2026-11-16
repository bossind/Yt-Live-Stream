import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Files,
  HardDrive,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { StorageAccount, StorageOverviewPayload } from '../../shared/types/storage';
import { PageHeader } from '../components/common/PageHeader';
import { OverviewMetricCard } from '../components/dashboard/OverviewMetricCard';
import { CloudFileManager } from '../components/storage/CloudFileManager';
import { ConnectProviderModal } from '../components/storage/ConnectProviderModal';
import { DirectUploadWorkspace } from '../components/storage/DirectUploadWorkspace';
import { ProviderAccountCards } from '../components/storage/ProviderAccountCards';
import { StorageDiagnosticsSection } from '../components/storage/StorageDiagnosticsSection';
import { useLanguage } from '../hooks/useLanguage';
import { storageApi } from '../services/storageService';
import { formatBytes } from '../utils/formatBytes';

export function StoragePage() {
  const { t } = useLanguage();
  const st = t.storage;

  const [overview, setOverview] = useState<StorageOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [reconnectAccount, setReconnectAccount] = useState<StorageAccount | null>(null);

  const loadOverview = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await storageApi.getOverview();
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage overview.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview(true);
  }, [loadOverview]);

  const issuesCount = (overview?.revokedAccounts ?? 0) + (overview?.errorAccounts ?? 0);
  const defaultAccount =
    overview?.accounts.find((a) => a.id === overview.defaultAccountId) ??
    overview?.accounts.find((a) => a.isDefault) ??
    overview?.accounts[0] ??
    null;

  let defaultDestinationValue = '--';
  let defaultDestinationDesc = 'Connect a Google Drive account to set your default upload target.';
  if (defaultAccount) {
    defaultDestinationValue = defaultAccount.accountName;
    if (defaultAccount.provider === 'GOOGLE_DRIVE') {
      const dq = defaultAccount.driveStorageQuota;
      const freeLabel = dq
        ? dq.isUnlimited
          ? 'Unlimited free'
          : `${formatBytes(dq.remainingBytes ?? 0)} ${st.kpiQuotaRemainingSuffix}`
        : st.kpiNotMeasured;
      defaultDestinationDesc = `${defaultAccount.accountEmail || 'Google Drive'} · ${freeLabel}`;
    } else {
      const rem = Math.max(
        0,
        defaultAccount.quotaBytes - defaultAccount.usedBytes - defaultAccount.reservedBytes
      );
      defaultDestinationDesc = `${defaultAccount.bucketName} · ${formatBytes(rem)} ${st.kpiQuotaRemainingSuffix}`;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={st.breadcrumb}
        title={st.title}
        subtitle={st.subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshing || loading}
              onClick={() => void loadOverview(false)}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {st.refreshButton}
            </button>
            <button
              type="button"
              onClick={() => {
                setReconnectAccount(null);
                setConnectModalOpen(true);
              }}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-red-600 px-4 text-xs font-medium text-white hover:bg-red-700"
            >
              <Plus className="h-4 w-4" />
              {st.connectButton}
            </button>
          </div>
        }
      />

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading && !overview ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin text-red-600" />
            <span>Loading Google Drive & cloud storage workspace...</span>
          </div>
        </div>
      ) : overview ? (
        <>
          {/* KPI Summary Grid — Strictly separates per-account Google Drive quotas */}
          <section
            aria-label="Google Drive Storage Summary"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <OverviewMetricCard
              metaLabel={st.kpiAccounts}
              title={st.providersTitle}
              value={`${overview.connectedAccounts} / ${overview.totalAccounts}`}
              description={`${overview.connectedAccounts} ${st.kpiConnectedSuffix} · ${issuesCount} ${st.kpiErrorsCount}`}
              icon={Database}
            />

            <OverviewMetricCard
              metaLabel={st.kpiAppQuotaUsed}
              title={defaultAccount?.isDefault ? st.defaultBadge : 'Destination'}
              value={defaultDestinationValue}
              description={defaultDestinationDesc}
              icon={HardDrive}
            />

            <OverviewMetricCard
              metaLabel={st.kpiMeasuredUsage}
              title={st.kpiStoredFiles}
              value={String(overview.totalFilesCount)}
              description={`${formatBytes(overview.totalUploadedBytesTracked)} verified across Studio Drive folders`}
              icon={Files}
            />

            <OverviewMetricCard
              metaLabel="OAuth & Encryption"
              title="Security Vault"
              value={
                overview.googleDriveOAuth.configured
                  ? 'OAuth Ready'
                  : !overview.googleDriveOAuth.callbackValid
                    ? 'Invalid Callback'
                    : 'Setup Needed'
              }
              description={
                !overview.googleDriveOAuth.configured
                  ? overview.googleDriveOAuth.missingConfigKeys.length > 0
                    ? `Missing: ${overview.googleDriveOAuth.missingConfigKeys.join(', ')}`
                    : overview.googleDriveOAuth.configErrors[0] || 'Google OAuth requires valid HTTPS configuration'
                  : overview.encryptionKeyConfigured
                    ? 'HTTPS OAuth & AES-256-GCM vault verified'
                    : 'Using dev fallback key (set key for production)'
              }
              icon={ShieldCheck}
            />
          </section>

          {/* Per-Account Quota Separation Notice */}
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p className="leading-relaxed">{st.quotaDisclaimer}</p>
          </div>

          <ProviderAccountCards
            accounts={overview.accounts}
            onRefresh={() => loadOverview(false)}
            onReconnectDrive={(acc) => {
              setReconnectAccount(acc);
              setConnectModalOpen(true);
            }}
          />

          <DirectUploadWorkspace
            accounts={overview.accounts}
            activeSessions={overview.activeSessions}
            onRefreshOverview={() => loadOverview(false)}
            onOpenConnectDrive={() => {
              setReconnectAccount(null);
              setConnectModalOpen(true);
            }}
          />

          <CloudFileManager
            files={overview.files}
            onRefresh={() => loadOverview(false)}
          />

          <StorageDiagnosticsSection
            recentActivity={overview.recentActivity}
            googleDriveOAuth={overview.googleDriveOAuth}
          />
        </>
      ) : null}

      <ConnectProviderModal
        open={connectModalOpen}
        onClose={() => {
          setConnectModalOpen(false);
          setReconnectAccount(null);
        }}
        onConnected={() => {
          void loadOverview(false);
        }}
        oauthStatus={overview?.googleDriveOAuth}
        reconnectAccount={reconnectAccount}
      />
    </div>
  );
}
