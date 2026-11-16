import { Radio } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { PhasePlaceholderCard } from '../components/common/PhasePlaceholderCard';
import { useLanguage } from '../hooks/useLanguage';

export function LiveStudioPage() {
  const { t } = useLanguage();
  const mod = t.modules.liveStudio;

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={mod.breadcrumb} title={mod.title} subtitle={mod.subtitle} />
      <PhasePlaceholderCard
        icon={Radio}
        title={mod.title}
        targetPhase="Phase 4"
        apiEndpointPath="/api/v1/streams"
        plannedCapabilities={[mod.scope1, mod.scope2, mod.scope3]}
      />
    </div>
  );
}
