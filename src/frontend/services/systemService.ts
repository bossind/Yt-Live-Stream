import type { ApiHealthPayload } from '../../shared/types/api';
import type { SystemOverviewPayload } from '../../shared/types/system';
import { apiRequest } from './apiClient';

export const systemService = {
  async getHealth(): Promise<ApiHealthPayload> {
    const res = await apiRequest<ApiHealthPayload>('/api/health');
    if (!res.data) {
      throw new Error('Missing health response payload.');
    }
    return res.data;
  },

  async getSystemOverview(): Promise<SystemOverviewPayload> {
    const res = await apiRequest<SystemOverviewPayload>('/api/v1/system/overview');
    if (!res.data) {
      throw new Error('Missing system overview response payload.');
    }
    return res.data;
  },
};
