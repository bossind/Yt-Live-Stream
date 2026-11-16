export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type FirestoreConnectionState = 'connected' | 'not_configured' | 'error';

export interface FirestoreHealthStatus {
  configured: boolean;
  state: FirestoreConnectionState;
  provider: 'firestore';
  projectId: string | null;
  databaseId: string;
  latencyMs: number | null;
  message: string;
  missingConfigKeys: string[];
}

export interface ApiHealthPayload {
  service: string;
  phase: string;
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  environment: string;
  timestamp: string;
  firestore: {
    configured: boolean;
    state: FirestoreConnectionState;
    projectId: string | null;
    databaseId: string;
  };
}
