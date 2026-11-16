import { CalendarClock } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { PhasePlaceholderCard } from '../components/common/PhasePlaceholderCard';
import { useLanguage } from '../hooks/useLanguage';

export function AutomationPage() {
  const { t } = useLanguage();
  const mod = t.modules.automation;

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={mod.breadcrumb} title={mod.title} subtitle={mod.subtitle} />
      <PhasePlaceholderCard
        icon={CalendarClock}
        title={mod.title}
        targetPhase="Phase 5"
        apiEndpointPath="/api/v1/automation"
        plannedCapabilities={[mod.scope1, mod.scope2, mod.scope3]}
      />
    </div>
  );
}
