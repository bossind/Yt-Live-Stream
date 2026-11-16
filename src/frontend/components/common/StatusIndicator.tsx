import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';

export type StatusTone = 'healthy' | 'warning' | 'error' | 'neutral';

interface StatusIndicatorProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

const toneStyles: Record<StatusTone, string> = {
  healthy: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-700 dark:text-red-400',
  neutral: 'text-slate-600 dark:text-slate-400',
};

export function StatusIndicator({ tone, label, className }: StatusIndicatorProps) {
  const Icon =
    tone === 'healthy'
      ? CheckCircle2
      : tone === 'warning'
        ? AlertTriangle
        : tone === 'error'
          ? XCircle
          : Clock;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0',
        toneStyles[tone],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
