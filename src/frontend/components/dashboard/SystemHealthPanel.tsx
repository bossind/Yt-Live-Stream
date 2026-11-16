import { RefreshCw } from 'lucide-react';
import type { ApiHealthPayload } from '../../../shared/types/api';
import type { SystemOverviewPayload } from '../../../shared/types/system';
import { useLanguage } from '../../hooks/useLanguage';
import { StatusIndicator, type StatusTone } from '../common/StatusIndicator';

interface SystemHealthPanelProps {
  loading: boolean;
  error: string | null;
  health: ApiHealthPayload | null;
  overview: SystemOverviewPayload | null;
  onRefresh: () => void;
}

export function SystemHealthPanel({
  loading,
  error,
  health,
  overview,
  onRefresh,
}: SystemHealthPanelProps) {
  const { t } = useLanguage();

  const backendTone: StatusTone = error
    ? 'error'
    : loading && !health
      ? 'neutral'
      : health?.status === 'ok' || health?.status === 'degraded'
        ? 'healthy'
        : 'neutral';

  const backendLabel = error
    ? t.dashboard.apiOffline
    : loading && !health
      ? t.dashboard.apiChecking
      : t.dashboard.apiOnline;

  const dbState = overview?.firestore.state ?? health?.firestore.state;
  const dbTone: StatusTone =
    dbState === 'connected'
      ? 'healthy'
      : dbState === 'not_configured'
        ? 'warning'
        : dbState === 'error'
          ? 'error'
          : 'neutral';

  const dbLabel =
    dbState === 'connected'
      ? t.dashboard.dbConnected
      : dbState === 'not_configured'
        ? t.dashboard.dbNotConfigured
        : dbState === 'error'
          ? t.dashboard.dbError
          : t.dashboard.apiChecking;

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t.dashboard.systemStatusTitle}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t.dashboard.systemStatusSubtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t.controls.refreshStatus}
          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className="divide-y divide-slate-200 px-5 dark:divide-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t.dashboard.backendApiLabel}
          </span>
          <StatusIndicator tone={backendTone} label={backendLabel} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t.dashboard.databaseLabel}
          </span>
          <StatusIndicator tone={dbTone} label={dbLabel} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t.dashboard.uptimeLabel}
          </span>
          <span className="font-mono text-xs font-medium text-slate-900 tabular-nums dark:text-slate-100">
            {health ? `${health.uptimeSeconds}${t.dashboard.secondsUnit}` : '--'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t.dashboard.latencyLabel}
          </span>
          <span className="font-mono text-xs font-medium text-slate-900 tabular-nums dark:text-slate-100">
            {overview?.firestore.latencyMs !== null && overview?.firestore.latencyMs !== undefined
              ? `${overview.firestore.latencyMs}${t.dashboard.msUnit}`
              : '--'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 py-3.5">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t.dashboard.accessModelLabel}
          </span>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {t.common.privateSingleAdmin}
          </span>
        </div>
      </div>

      {error ? (
        <div className="border-t border-slate-200 bg-red-50/70 px-5 py-3.5 text-xs text-red-700 dark:border-slate-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {overview?.firestore && overview.firestore.state !== 'connected' ? (
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            {overview.firestore.message}
          </p>
          {overview.firestore.missingConfigKeys.length > 0 ? (
            <p className="mt-1 font-mono text-slate-600 dark:text-slate-400">
              {t.dashboard.missingEnvLabel}: {overview.firestore.missingConfigKeys.join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
