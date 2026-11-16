import type { FirestoreHealthStatus } from '../../shared/types/api';
import { env } from '../config/env';
import { getFirebaseAdminState } from './admin';

export async function checkFirestoreHealth(): Promise<FirestoreHealthStatus> {
  const adminState = getFirebaseAdminState();

  if (!adminState.configured || !adminState.firestore) {
    return {
      configured: false,
      state: 'not_configured',
      provider: 'firestore',
      projectId: env.firebaseProjectId || null,
      databaseId: env.firebaseDatabaseId,
      latencyMs: null,
      message:
        adminState.initError ||
        'Firebase Admin SDK is not configured. Provide FIREBASE_PROJECT_ID and service account credentials.',
      missingConfigKeys: adminState.missingConfigKeys,
    };
  }

  if (!adminState.hasFullAdminCredentials) {
    return {
      configured: false,
      state: 'not_configured',
      provider: 'firestore',
      projectId: env.firebaseProjectId,
      databaseId: env.firebaseDatabaseId,
      latencyMs: null,
      message:
        'Firebase Admin service account credentials are not set in backend environment variables (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY). ID token verification is active via Project ID.',
      missingConfigKeys: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
    };
  }

  const start = Date.now();
  try {
    await Promise.race([
      adminState.firestore.collection('system_config').limit(1).get(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore health check timed out.')), 4000)
      ),
    ]);

    return {
      configured: true,
      state: 'connected',
      provider: 'firestore',
      projectId: env.firebaseProjectId,
      databaseId: env.firebaseDatabaseId,
      latencyMs: Date.now() - start,
      message: 'Cloud Firestore connection verified.',
      missingConfigKeys: [],
    };
  } catch (err) {
    const safeMessage = env.isProduction
      ? 'Cloud Firestore connectivity check failed. Verify service account permissions and database ID.'
      : err instanceof Error
        ? err.message
        : 'Unknown Firestore error.';

    return {
      configured: true,
      state: 'error',
      provider: 'firestore',
      projectId: env.firebaseProjectId,
      databaseId: env.firebaseDatabaseId,
      latencyMs: Date.now() - start,
      message: safeMessage,
      missingConfigKeys: [],
    };
  }
}
