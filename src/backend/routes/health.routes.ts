import { Router } from 'express';
import type { ApiHealthPayload, ApiResponse, FirestoreHealthStatus } from '../../shared/types/api';
import { env } from '../config/env';
import { checkFirestoreHealth } from '../firebase/health';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res, next) => {
  try {
    const firestoreHealth = await checkFirestoreHealth();
    const status: ApiHealthPayload['status'] =
      firestoreHealth.state === 'error' ? 'degraded' : 'ok';

    const payload: ApiResponse<ApiHealthPayload> = {
      success: true,
      data: {
        service: 'youtube-live-automation-studio-api',
        phase: 'Phase 3 (Google Drive Storage)',
        status,
        uptimeSeconds: Math.floor(process.uptime()),
        environment: env.nodeEnv,
        timestamp: new Date().toISOString(),
        firestore: {
          configured: firestoreHealth.configured,
          state: firestoreHealth.state,
          projectId: firestoreHealth.projectId,
          databaseId: firestoreHealth.databaseId,
        },
      },
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

healthRouter.get('/db', async (_req, res, next) => {
  try {
    const firestoreHealth = await checkFirestoreHealth();
    const statusCode = firestoreHealth.state === 'connected' ? 200 : 503;

    const payload: ApiResponse<FirestoreHealthStatus> = {
      success: firestoreHealth.state === 'connected',
      data: firestoreHealth,
      timestamp: new Date().toISOString(),
    };

    res.status(statusCode).json(payload);
  } catch (err) {
    next(err);
  }
});
