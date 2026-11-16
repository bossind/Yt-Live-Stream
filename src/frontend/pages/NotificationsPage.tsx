import { Bell } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { PhasePlaceholderCard } from '../components/common/PhasePlaceholderCard';
import { useLanguage } from '../hooks/useLanguage';

export function NotificationsPage() {
  const { t } = useLanguage();
  const mod = t.modules.notifications;

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={mod.breadcrumb} title={mod.title} subtitle={mod.subtitle} />
      <PhasePlaceholderCard
        icon={Bell}
        title={mod.title}
        targetPhase="Phase 5"
        apiEndpointPath="/api/v1/notifications"
        plannedCapabilities={[mod.scope1, mod.scope2, mod.scope3]}
      />
    </div>
  );
}
