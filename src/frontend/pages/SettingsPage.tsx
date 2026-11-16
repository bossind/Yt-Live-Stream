import { Lock, Shield } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { ThemeLangControls } from '../components/common/ThemeLangControls';
import { SystemHealthPanel } from '../components/dashboard/SystemHealthPanel';
import { AdminAllowlistPanel } from '../components/settings/AdminAllowlistPanel';
import { useApiHealth } from '../hooks/useApiHealth';
import { useLanguage } from '../hooks/useLanguage';

export function SettingsPage() {
  const { t } = useLanguage();
  const { loading, error, health, overview, refresh } = useApiHealth();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={t.settings.breadcrumb}
        title={t.settings.title}
        subtitle={t.settings.subtitle}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {/* Working Persistent Theme & Language Settings */}
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t.settings.appearanceTitle} · {t.settings.languageTitle}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t.settings.appearanceDesc}
              </p>
            </div>
            <div className="p-6">
              <ThemeLangControls variant="expanded" />
            </div>
          </section>

          {/* Multi-Gmail Authorized Administrator Allowlist */}
          <AdminAllowlistPanel />

          {/* Private Authorized-Admin Security Posture */}
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <Shield className="mt-0.5 h-5 w-5 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t.settings.securityTitle}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t.settings.securityDesc}
                </p>
              </div>
            </div>
            <ul className="divide-y divide-slate-200 px-6 dark:divide-slate-800">
              <li className="py-3.5 text-sm text-slate-700 dark:text-slate-300">
                {t.settings.securityItem1}
              </li>
              <li className="py-3.5 text-sm text-slate-700 dark:text-slate-300">
                {t.settings.securityItem2}
              </li>
              <li className="py-3.5 text-sm text-slate-700 dark:text-slate-300">
                {t.settings.securityItem3}
              </li>
            </ul>
          </section>

          {/* Future Phase Integrations Placeholder */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t.settings.futureConfigTitle}
                </h2>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {t.settings.futureConfigDesc}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-5">
          <SystemHealthPanel
            loading={loading}
            error={error}
            health={health}
            overview={overview}
            onRefresh={() => void refresh()}
          />
        </div>
      </div>
    </div>
  );
}
