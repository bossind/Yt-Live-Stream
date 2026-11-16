import { ArrowLeft, Lock } from 'lucide-react';
import type { ElementType } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../hooks/useLanguage';
import { StatusIndicator } from './StatusIndicator';

interface PhasePlaceholderCardProps {
  icon: ElementType;
  title: string;
  targetPhase: string;
  apiEndpointPath: string;
  plannedCapabilities: string[];
}

export function PhasePlaceholderCard({
  icon: Icon,
  title,
  targetPhase,
  apiEndpointPath,
  plannedCapabilities,
}: PhasePlaceholderCardProps) {
  const { t } = useLanguage();

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 border-b border-slate-200 p-6 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{t.common.plannedPhase}: {targetPhase}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{apiEndpointPath}</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          </div>
        </div>
        <StatusIndicator tone="warning" label={t.common.pending} />
      </div>

      <div className="space-y-6 p-6">
        <div className="space-y-2">
          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
            {t.common.comingFuturePhase}
          </p>
          <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span>{t.common.lockedUntilPhase2}</span>
          </p>
        </div>

        <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {plannedCapabilities.map((item, idx) => (
              <li
                key={item}
                className="flex items-baseline gap-3 py-3 text-sm text-slate-700 first:pt-0 last:pb-0 dark:text-slate-300"
              >
                <span className="font-mono text-xs text-slate-400 tabular-nums dark:text-slate-500">
                  0{idx + 1}.
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-2">
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t.controls.backToDashboard}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
