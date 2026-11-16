import { Router } from 'express';
import type { ApiResponse } from '../../../shared/types/api';
import type { SystemOverviewPayload } from '../../../shared/types/system';
import { env } from '../../config/env';
import { getFirebaseAdminState } from '../../firebase/admin';
import { checkFirestoreHealth } from '../../firebase/health';
import { requireFirebaseAdmin } from '../../middleware/authGuard';
import { FirestoreModel } from '../../models/firestore.model';

export const systemRouter = Router();

systemRouter.get('/overview', requireFirebaseAdmin, async (_req, res, next) => {
  try {
    const firestoreHealth = await checkFirestoreHealth();
    const adminState = getFirebaseAdminState();
    const hasAdminInFirestore = adminState.hasFullAdminCredentials
      ? await FirestoreModel.hasAnyActiveAdmin().catch(() => false)
      : true;

    const payload: ApiResponse<SystemOverviewPayload> = {
      success: true,
      data: {
        application: {
          name: 'YouTube Live Automation Studio',
          phase: 'Phase 3: Google Drive Storage & Multi-Admin Access',
          accessModel: 'private_multi_admin_allowlist',
          authState: 'active_firebase_phase_2',
          publicRegistrationEnabled: false,
        },
        backend: {
          status: 'ok',
          apiVersion: 'v1',
          uptimeSeconds: Math.floor(process.uptime()),
          corsConfigured: env.corsOrigins.length > 0,
        },
        firestore: firestoreHealth,
        auth: {
          firebaseAdminReady: adminState.configured,
          adminConfigured: hasAdminInFirestore,
          googleSignInEnabled: adminState.configured,
          emailPasswordEnabled: adminState.configured,
        },
        modules: {
          liveEngine: 'pending_future_phase',
          channelIntegration: 'pending_future_phase',
          mediaStorage: 'operational',
          scheduler: 'pending_future_phase',
          notifications: 'pending_future_phase',
        },
        checkedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});
