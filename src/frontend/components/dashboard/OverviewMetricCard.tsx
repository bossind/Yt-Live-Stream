import type { ElementType } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

interface OverviewMetricCardProps {
  title: string;
  value: string;
  description: string;
  metaLabel: string;
  icon: ElementType;
  to?: string;
  accentTone?: 'neutral' | 'standby';
}

export function OverviewMetricCard({
  title,
  value,
  description,
  metaLabel,
  icon: Icon,
  to,
  accentTone = 'neutral',
}: OverviewMetricCardProps) {
  const content = (
    <div className="flex h-full flex-col justify-between gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
            {metaLabel}
          </p>
          <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</h3>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>

      <div className="space-y-1.5">
        <p
          className={cn(
            'text-2xl font-semibold tracking-tight tabular-nums',
            accentTone === 'standby'
              ? 'text-slate-900 dark:text-slate-100'
              : 'text-slate-900 dark:text-slate-50'
          )}
        >
          {value}
        </p>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          {description}
        </p>
      </div>
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="block h-full rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="h-full rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {content}
    </div>
  );
}
