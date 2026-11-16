export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId: string;
}

interface AppletJsonModule {
  default?: Partial<FirebaseClientConfig>;
}

const appletModules = import.meta.glob<AppletJsonModule>('/firebase-applet-config.json', {
  eager: true,
});
const appletConfig: Partial<FirebaseClientConfig> =
  Object.values(appletModules)[0]?.default ?? {};

const envApiKey = (import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
const envAuthDomain = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
const envProjectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
const envStorageBucket = (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
const envMessagingSenderId = (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
const envAppId = (import.meta.env.VITE_FIREBASE_APP_ID || '').trim();
const envDatabaseId = (import.meta.env.VITE_FIREBASE_DATABASE_ID || '').trim();

const appletProjectId = (appletConfig.projectId || '').trim();
const appletApiKey = (appletConfig.apiKey || '').trim();
const appletAppId = (appletConfig.appId || '').trim();

const hasCustomProjectOverride =
  (envProjectId.length > 0 && envProjectId !== appletProjectId) ||
  (envApiKey.length > 0 && envApiKey !== appletApiKey) ||
  (envAppId.length > 0 && envAppId !== appletAppId);

const resolvedConfig: FirebaseClientConfig = hasCustomProjectOverride
  ? {
      apiKey: envApiKey,
      authDomain:
        envAuthDomain || (envProjectId ? `${envProjectId}.firebaseapp.com` : ''),
      projectId: envProjectId,
      storageBucket: envStorageBucket,
      messagingSenderId: envMessagingSenderId,
      appId: envAppId,
      firestoreDatabaseId: envDatabaseId || '(default)',
    }
  : {
      apiKey: envApiKey || appletApiKey,
      authDomain: envAuthDomain || (appletConfig.authDomain || '').trim(),
      projectId: envProjectId || appletProjectId,
      storageBucket: envStorageBucket || (appletConfig.storageBucket || '').trim(),
      messagingSenderId:
        envMessagingSenderId || (appletConfig.messagingSenderId || '').trim(),
      appId: envAppId || appletAppId,
      firestoreDatabaseId:
        envDatabaseId || (appletConfig.firestoreDatabaseId || '(default)').trim(),
    };

const missingClientConfigKeys: string[] = [];
if (!resolvedConfig.apiKey) missingClientConfigKeys.push('VITE_FIREBASE_API_KEY');
if (!resolvedConfig.authDomain) missingClientConfigKeys.push('VITE_FIREBASE_AUTH_DOMAIN');
if (!resolvedConfig.projectId) missingClientConfigKeys.push('VITE_FIREBASE_PROJECT_ID');
if (!resolvedConfig.appId) missingClientConfigKeys.push('VITE_FIREBASE_APP_ID');

export const firebaseClientConfigState = {
  config: resolvedConfig,
  source: hasCustomProjectOverride ? ('env' as const) : ('applet' as const),
  isCustomOverride: hasCustomProjectOverride,
  isConfigured: missingClientConfigKeys.length === 0,
  missingClientConfigKeys,
} as const;
