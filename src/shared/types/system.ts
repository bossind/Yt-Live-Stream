import type { FirestoreHealthStatus } from './api';

export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'en' | 'hi';

export interface SystemOverviewPayload {
  application: {
    name: string;
    phase: string;
    accessModel: 'private_single_admin' | 'private_multi_admin_allowlist';
    authState: 'active_firebase_phase_2';
    publicRegistrationEnabled: false;
  };
  backend: {
    status: 'ok';
    apiVersion: 'v1';
    uptimeSeconds: number;
    corsConfigured: boolean;
  };
  firestore: FirestoreHealthStatus;
  auth: {
    firebaseAdminReady: boolean;
    adminConfigured: boolean;
    googleSignInEnabled: boolean;
    emailPasswordEnabled: boolean;
  };
  modules: {
    liveEngine: 'pending_future_phase';
    channelIntegration: 'pending_future_phase';
    mediaStorage: 'operational' | 'pending_future_phase';
    scheduler: 'pending_future_phase';
    notifications: 'pending_future_phase';
  };
  checkedAt: string;
}
