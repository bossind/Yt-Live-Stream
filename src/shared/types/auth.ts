export interface AuthConfigStatus {
  firebaseClientConfigured: boolean;
  firebaseAdminConfigured: boolean;
  firestoreConfigured: boolean;
  firebaseProjectId?: string;
  adminEmailsConfigured?: boolean;
  adminSetupRequired: boolean;
  googleSignInEnabled: boolean;
  emailPasswordEnabled: boolean;
  publicRegistrationAllowed: false;
  missingFirebaseConfig: string[];
}

export interface AuthenticatedAdminUser {
  uid: string;
  email: string;
  displayName: string | null;
  role: 'ADMIN';
  isPrimaryOwner: boolean;
  emailVerified: boolean;
  authProvider: string;
}

export interface AuthSessionPayload {
  authenticated: boolean;
  user: AuthenticatedAdminUser | null;
}

export interface AdminAllowlistEntry {
  email: string;
  displayName: string | null;
  uid: string | null;
  source: 'env' | 'firestore' | 'both';
  isPrimaryOwner: boolean;
  active: boolean;
  addedByEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdminAllowlistResponse {
  entries: AdminAllowlistEntry[];
  currentAdminEmail: string;
  primaryOwnerEmail: string | null;
}
