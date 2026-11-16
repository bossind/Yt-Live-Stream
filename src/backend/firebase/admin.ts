import fs from 'node:fs';
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { env } from '../config/env';

interface FirebaseAdminInitState {
  app: App | null;
  auth: Auth | null;
  firestore: Firestore | null;
  configured: boolean;
  hasFullAdminCredentials: boolean;
  missingConfigKeys: string[];
  initError: string | null;
}

let cachedState: FirebaseAdminInitState | null = null;

function parseServiceAccount(): ServiceAccount | null {
  if (env.firebaseServiceAccountJson) {
    const parsed = JSON.parse(env.firebaseServiceAccountJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
      projectId?: string;
      clientEmail?: string;
      privateKey?: string;
    };
    const projectId = parsed.projectId || parsed.project_id || env.firebaseProjectId;
    const clientEmail = parsed.clientEmail || parsed.client_email;
    const privateKeyRaw = parsed.privateKey || parsed.private_key;

    if (!projectId || !clientEmail || !privateKeyRaw) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key.'
      );
    }

    return {
      projectId,
      clientEmail,
      privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
    };
  }

  if (env.firebaseClientEmail && env.firebasePrivateKey) {
    return {
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: env.firebasePrivateKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function hasAdcAvailable(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  return process.env.FIREBASE_USE_ADC === 'true';
}

export function getFirebaseAdminState(): FirebaseAdminInitState {
  if (cachedState) {
    return cachedState;
  }

  const missingConfigKeys: string[] = [];
  if (!env.firebaseProjectId) {
    missingConfigKeys.push('FIREBASE_PROJECT_ID');
  }

  if (missingConfigKeys.length > 0) {
    cachedState = {
      app: null,
      auth: null,
      firestore: null,
      configured: false,
      hasFullAdminCredentials: false,
      missingConfigKeys,
      initError: 'FIREBASE_PROJECT_ID is not configured.',
    };
    return cachedState;
  }

  try {
    let app: App;
    let hasFullAdminCredentials = false;

    if (getApps().length > 0) {
      app = getApp();
      hasFullAdminCredentials = env.hasExplicitAdminCredentials || hasAdcAvailable();
    } else {
      const serviceAccount = parseServiceAccount();
      if (serviceAccount) {
        app = initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.projectId || env.firebaseProjectId,
        });
        hasFullAdminCredentials = true;
      } else if (hasAdcAvailable()) {
        app = initializeApp({
          credential: applicationDefault(),
          projectId: env.firebaseProjectId,
        });
        hasFullAdminCredentials = true;
      } else {
        // Allows verifyIdToken() via public Google JWKS using projectId;
        // explicit service account credentials are required for Firestore Admin SDK writes outside GCP.
        app = initializeApp({
          projectId: env.firebaseProjectId,
        });
        hasFullAdminCredentials = false;
      }
    }

    const auth = getAuth(app);
    const firestore =
      env.firebaseDatabaseId && env.firebaseDatabaseId !== '(default)'
        ? getFirestore(app, env.firebaseDatabaseId)
        : getFirestore(app);

    cachedState = {
      app,
      auth,
      firestore,
      configured: true,
      hasFullAdminCredentials,
      missingConfigKeys: [],
      initError: null,
    };
    return cachedState;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to initialize Firebase Admin SDK.';
    cachedState = {
      app: null,
      auth: null,
      firestore: null,
      configured: false,
      hasFullAdminCredentials: false,
      missingConfigKeys: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
      initError: message,
    };
    return cachedState;
  }
}
