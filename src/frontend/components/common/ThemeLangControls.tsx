import { Languages, Moon, Sun } from 'lucide-react';
import { useLanguage } from '../../hooks/useLanguage';
import { useTheme } from '../../hooks/useTheme';
import { cn } from '../../utils/cn';

interface ThemeLangControlsProps {
  variant?: 'compact' | 'expanded';
}

export function ThemeLangControls({ variant = 'compact' }: ThemeLangControlsProps) {
  const { theme, setTheme, toggleTheme } = useTheme();
  const { language, setLanguage, toggleLanguage, t } = useLanguage();

  if (variant === 'expanded') {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t.controls.themeLabel}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.settings.persistenceNote}
            </p>
          </div>
          <div
            role="group"
            aria-label={t.controls.themeLabel}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950 self-start"
          >
            <button
              type="button"
              onClick={() => setTheme('dark')}
              aria-pressed={theme === 'dark'}
              className={cn(
                'inline-flex min-h-[40px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
                theme === 'dark'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              )}
            >
              <Moon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.controls.darkMode}</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('light')}
              aria-pressed={theme === 'light'}
              className={cn(
                'inline-flex min-h-[40px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
                theme === 'light'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              )}
            >
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.controls.lightMode}</span>
            </button>
          </div>
        </div>

        <div className="h-px bg-slate-200 dark:bg-slate-800" />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t.controls.languageLabel}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.settings.persistenceNote}
            </p>
          </div>
          <div
            role="group"
            aria-label={t.controls.languageLabel}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950 self-start"
          >
            <button
              type="button"
              onClick={() => setLanguage('en')}
              aria-pressed={language === 'en'}
              className={cn(
                'inline-flex min-h-[40px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
                language === 'en'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              )}
            >
              <span>{t.controls.english}</span>
            </button>
            <button
              type="button"
              onClick={() => setLanguage('hi')}
              aria-pressed={language === 'hi'}
              className={cn(
                'inline-flex min-h-[40px] items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
                language === 'hi'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              )}
            >
              <span>{t.controls.hindi}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={toggleLanguage}
        aria-label={`${t.controls.languageLabel}: ${language === 'en' ? t.controls.english : t.controls.hindi}`}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
      >
        <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono">{language === 'en' ? 'EN' : 'HI'}</span>
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? t.controls.switchToLight : t.controls.switchToDark}
        title={theme === 'dark' ? t.controls.switchToLight : t.controls.switchToDark}
        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
      >
        {theme === 'dark' ? (
          <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
