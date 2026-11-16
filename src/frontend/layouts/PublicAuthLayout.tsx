import { Radio } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeLangControls } from '../components/common/ThemeLangControls';
import { useLanguage } from '../hooks/useLanguage';

export function PublicAuthLayout({ children }: { children: ReactNode }) {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-600 text-white">
            <Radio className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">
            {t.brand.name}
          </span>
        </div>

        <ThemeLangControls variant="compact" />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md space-y-6">{children}</div>
      </main>
    </div>
  );
}
