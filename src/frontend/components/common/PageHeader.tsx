import type { ReactNode } from 'react';

interface PageHeaderProps {
  breadcrumb: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}

export function PageHeader({ breadcrumb, title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{breadcrumb}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl text-balance">
          {title}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {subtitle}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
