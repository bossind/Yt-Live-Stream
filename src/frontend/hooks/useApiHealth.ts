import { useCallback, useEffect, useState } from 'react';
import type { ApiHealthPayload } from '../../shared/types/api';
import type { SystemOverviewPayload } from '../../shared/types/system';
import { systemService } from '../services/systemService';

interface ApiHealthState {
  loading: boolean;
  error: string | null;
  health: ApiHealthPayload | null;
  overview: SystemOverviewPayload | null;
  refresh: () => Promise<void>;
}

export function useApiHealth(): ApiHealthState {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ApiHealthPayload | null>(null);
  const [overview, setOverview] = useState<SystemOverviewPayload | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, overviewData] = await Promise.all([
        systemService.getHealth(),
        systemService.getSystemOverview(),
      ]);
      setHealth(healthData);
      setOverview(overviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach backend API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, error, health, overview, refresh };
}
