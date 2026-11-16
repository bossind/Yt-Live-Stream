import { Film } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { PhasePlaceholderCard } from '../components/common/PhasePlaceholderCard';
import { useLanguage } from '../hooks/useLanguage';

export function VideoLibraryPage() {
  const { t } = useLanguage();
  const mod = t.modules.videoLibrary;

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={mod.breadcrumb} title={mod.title} subtitle={mod.subtitle} />
      <PhasePlaceholderCard
        icon={Film}
        title={mod.title}
        targetPhase="Phase 3"
        apiEndpointPath="/api/v1/videos"
        plannedCapabilities={[mod.scope1, mod.scope2, mod.scope3]}
      />
    </div>
  );
}
