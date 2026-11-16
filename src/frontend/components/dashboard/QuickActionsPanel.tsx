import { Activity, ArrowRight, Radio, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../hooks/useLanguage';

interface QuickActionsPanelProps {
  onRefreshHealth: () => void;
  isRefreshing: boolean;
}

export function QuickActionsPanel({
  onRefreshHealth,
  isRefreshing,
}: QuickActionsPanelProps) {
  const { t } = useLanguage();

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t.dashboard.quickActionsTitle}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {t.dashboard.quickActionsSubtitle}
        </p>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <button
            type="button"
            onClick={onRefreshHealth}
            disabled={isRefreshing}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <span className="inline-flex items-center gap-2">
              <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{isRefreshing ? t.controls.refreshing : t.controls.refreshStatus}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </div>

        <Link
          to="/settings"
          className="flex min-h-[48px] items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/50 dark:hover:text-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-600"
        >
          <span className="inline-flex items-center gap-2.5">
            <Settings className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span>{t.controls.openSettings}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        </Link>

        <Link
          to="/live-studio"
          className="flex min-h-[48px] items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/50 dark:hover:text-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-600"
        >
          <span className="inline-flex items-center gap-2.5">
            <Radio className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span>{t.controls.viewLiveStudio}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
