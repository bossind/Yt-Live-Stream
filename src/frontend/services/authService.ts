import type {
  AdminAllowlistEntry,
  AdminAllowlistResponse,
  AuthConfigStatus,
  AuthSessionPayload,
} from '../../shared/types/auth';
import { apiRequest } from './apiClient';

export const authService = {
  async getAuthStatus(): Promise<AuthConfigStatus> {
    const res = await apiRequest<AuthConfigStatus>('/api/v1/auth/status', {
      skipAuth: true,
    });
    if (!res.data) {
      throw new Error('Missing auth status payload.');
    }
    return res.data;
  },

  async verifyAdminSession(idToken: string): Promise<AuthSessionPayload> {
    const res = await apiRequest<AuthSessionPayload>('/api/v1/auth/verify', {
      method: 'POST',
      idToken,
    });
    if (!res.data) {
      throw new Error('Missing admin verification payload.');
    }
    return res.data;
  },

  async notifyLogout(idToken: string | null): Promise<void> {
    if (!idToken) return;
    await apiRequest('/api/v1/auth/logout', {
      method: 'POST',
      idToken,
    }).catch(() => {});
  },

  async listAllowlist(): Promise<AdminAllowlistResponse> {
    const res = await apiRequest<AdminAllowlistResponse>('/api/v1/auth/allowlist');
    if (!res.data) {
      throw new Error('Missing admin allowlist payload.');
    }
    return res.data;
  },

  async addAllowlistAdmin(input: {
    email: string;
    displayName?: string;
  }): Promise<AdminAllowlistEntry> {
    const res = await apiRequest<AdminAllowlistEntry>('/api/v1/auth/allowlist', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.data) {
      throw new Error('Failed to add authorized Gmail administrator.');
    }
    return res.data;
  },

  async removeAllowlistAdmin(email: string): Promise<void> {
    await apiRequest<{ revoked: boolean }>(`/api/v1/auth/allowlist/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
  },
};
