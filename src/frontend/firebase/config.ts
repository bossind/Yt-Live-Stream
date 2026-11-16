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

const resolvedConfig: FirebaseClientConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || appletConfig.apiKey || '').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain || '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId || '').trim(),
  storageBucket: (
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    appletConfig.storageBucket ||
    ''
  ).trim(),
  messagingSenderId: (
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    appletConfig.messagingSenderId ||
    ''
  ).trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || appletConfig.appId || '').trim(),
  firestoreDatabaseId: (
    import.meta.env.VITE_FIREBASE_DATABASE_ID ||
    appletConfig.firestoreDatabaseId ||
    '(default)'
  ).trim(),
};

const missingClientConfigKeys: string[] = [];
if (!resolvedConfig.apiKey) missingClientConfigKeys.push('VITE_FIREBASE_API_KEY');
if (!resolvedConfig.authDomain) missingClientConfigKeys.push('VITE_FIREBASE_AUTH_DOMAIN');
if (!resolvedConfig.projectId) missingClientConfigKeys.push('VITE_FIREBASE_PROJECT_ID');
if (!resolvedConfig.appId) missingClientConfigKeys.push('VITE_FIREBASE_APP_ID');

export const firebaseClientConfigState = {
  config: resolvedConfig,
  isConfigured: missingClientConfigKeys.length === 0,
  missingClientConfigKeys,
} as const;
