import { useEffect, useState } from 'react';
import { Film, HardDrive, History, Radio, Tv } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { OverviewMetricCard } from '../components/dashboard/OverviewMetricCard';
import { QuickActionsPanel } from '../components/dashboard/QuickActionsPanel';
import { SystemHealthPanel } from '../components/dashboard/SystemHealthPanel';
import { useApiHealth } from '../hooks/useApiHealth';
import { useLanguage } from '../hooks/useLanguage';
import { storageApi, type StorageUsageSummary } from '../services/storageService';
import { formatBytes } from '../utils/formatBytes';

export function DashboardPage() {
  const { t } = useLanguage();
  const { loading, error, health, overview, refresh } = useApiHealth();
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary | null>(null);

  useEffect(() => {
    storageApi
      .getUsageSummary()
      .then(setStorageUsage)
      .catch(() => {
        // Keep graceful fallback if not yet signed in or storage unavailable
      });
  }, []);

  const primaryDrive =
    storageUsage?.accounts.find((a) => a.status === 'CONNECTED' && a.provider === 'GOOGLE_DRIVE') ||
    storageUsage?.accounts.find((a) => a.status === 'CONNECTED') ||
    null;

  let storageDesc: string = t.dashboard.storageDesc;
  if (storageUsage) {
    if (primaryDrive?.provider === 'GOOGLE_DRIVE' && primaryDrive.driveStorageQuota) {
      const dq = primaryDrive.driveStorageQuota;
      const freeLabel = dq.isUnlimited
        ? 'Unlimited free'
        : `${formatBytes(dq.remainingBytes ?? 0)} free`;
      storageDesc = `${primaryDrive.accountEmail || primaryDrive.accountName}: ${freeLabel} · ${formatBytes(storageUsage.totalUploadedBytesTracked)} tracked`;
    } else if (storageUsage.totalAccounts === 0) {
      storageDesc = t.dashboard.storageDesc;
    } else {
      storageDesc = `${storageUsage.connectedAccounts} connected · ${formatBytes(storageUsage.totalUploadedBytesTracked)} tracked`;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={t.dashboard.breadcrumb}
        title={t.dashboard.title}
        subtitle={t.dashboard.subtitle}
      />

      {/* Welcome / Studio Foundation Banner */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t.common.phase1Foundation} · {t.common.privateSingleAdmin}
          </p>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t.dashboard.welcomeHeading}
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            {t.dashboard.welcomeBody}
          </p>
        </div>
      </section>

      {/* 4-Column Overview & Placeholder Cards */}
      <section
        aria-label="Studio Overview Cards"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <OverviewMetricCard
          metaLabel={`${t.common.idle} · Phase 4`}
          title={t.dashboard.liveStatusTitle}
          value={t.dashboard.liveStatusValue}
          description={t.dashboard.liveStatusDesc}
          icon={Radio}
          to="/live-studio"
          accentTone="standby"
        />

        <OverviewMetricCard
          metaLabel={t.common.placeholderNotice}
          title={t.dashboard.channelsTitle}
          value={t.dashboard.channelsValue}
          description={t.dashboard.channelsDesc}
          icon={Tv}
          to="/youtube-channels"
        />

        <OverviewMetricCard
          metaLabel={t.common.placeholderNotice}
          title={t.dashboard.libraryTitle}
          value={t.dashboard.libraryValue}
          description={t.dashboard.libraryDesc}
          icon={Film}
          to="/video-library"
        />

        <OverviewMetricCard
          metaLabel={
            storageUsage
              ? `${storageUsage.connectedAccounts} connected · ${storageUsage.totalFilesCount} files`
              : 'Phase 3 · Operational'
          }
          title={t.dashboard.storageTitle}
          value={
            storageUsage
              ? `${storageUsage.connectedAccounts} Drive${storageUsage.connectedAccounts === 1 ? '' : 's'}`
              : t.dashboard.storageValue
          }
          description={storageDesc}
          icon={HardDrive}
          to="/storage"
        />
      </section>

      {/* Main Workspace Grid: System Diagnostics + Quick Actions */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <SystemHealthPanel
            loading={loading}
            error={error}
            health={health}
            overview={overview}
            onRefresh={() => void refresh()}
          />
        </div>

        <div className="lg:col-span-5">
          <QuickActionsPanel
            onRefreshHealth={() => void refresh()}
            isRefreshing={loading}
          />
        </div>
      </section>

      {/* Recent Streaming History Placeholder */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t.dashboard.historyHeading}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t.dashboard.historySubtitle}
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t.common.comingFuturePhase}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3">{t.dashboard.historyColSession}</th>
                <th className="px-5 py-3">{t.dashboard.historyColChannel}</th>
                <th className="px-5 py-3">{t.dashboard.historyColStatus}</th>
                <th className="px-5 py-3 text-right">{t.dashboard.historyColStarted}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center">
                  <div className="mx-auto flex max-w-md flex-col items-center gap-2">
                    <History
                      className="h-7 w-7 text-slate-400 dark:text-slate-600"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {t.dashboard.historyEmptyTitle}
                    </p>
                    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {t.dashboard.historyEmptyBody}
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
