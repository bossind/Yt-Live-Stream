import { FirebaseError } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedAdminUser } from '../../shared/types/auth';
import { firebaseAuth, googleAuthProvider } from '../firebase/client';
import { ApiClientError } from '../services/apiClient';
import { authService } from '../services/authService';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedAdminUser | null;
  authError: string | null;
  clearAuthError: () => void;
  loginWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  loginWithGoogle: (rememberMe: boolean) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function mapFirebaseAuthError(err: unknown): string {
  if (err instanceof ApiClientError) {
    return err.message;
  }
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-email':
        return 'Invalid email or password.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait before trying again.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in popup was closed before completion.';
      case 'auth/popup-blocked':
        return 'Popup was blocked by the browser. Allow popups for this site and try again.';
      case 'auth/user-disabled':
        return 'This administrator account has been disabled.';
      case 'auth/operation-not-allowed':
        return 'This sign-in provider is not enabled in Firebase Authentication Console.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Authentication failed.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthenticatedAdminUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const explicitLoginInFlightRef = useRef(false);

  const verifyWithBackend = useCallback(async (firebaseUser: User): Promise<void> => {
    const idToken = await firebaseUser.getIdToken(true);
    const result = await authService.verifyAdminSession(idToken);
    if (!result.authenticated || !result.user) {
      throw new Error('Administrator authorization failed.');
    }
    setUser(result.user);
    setStatus('authenticated');
    setAuthError(null);
  }, []);

  useEffect(() => {
    if (!firebaseAuth) {
      setUser(null);
      setStatus('unauthenticated');
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (explicitLoginInFlightRef.current) {
        return;
      }

      if (!firebaseUser) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }

      try {
        await verifyWithBackend(firebaseUser);
      } catch (err) {
        const message = mapFirebaseAuthError(err);
        if (firebaseAuth) {
          await signOut(firebaseAuth).catch(() => {});
        }
        setUser(null);
        setStatus('unauthenticated');
        setAuthError(message);
      }
    });

    return () => unsubscribe();
  }, [verifyWithBackend]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const updatePersistence = useCallback(async (rememberMe: boolean) => {
    if (!firebaseAuth) return;
    await setPersistence(
      firebaseAuth,
      rememberMe ? browserLocalPersistence : browserSessionPersistence
    ).catch(() => {});
  }, []);

  const loginWithEmail = useCallback(
    async (email: string, password: string, rememberMe: boolean) => {
      if (!firebaseAuth) {
        throw new Error('Firebase Authentication client is not configured.');
      }
      setAuthError(null);
      explicitLoginInFlightRef.current = true;
      try {
        await setPersistence(
          firebaseAuth,
          rememberMe ? browserLocalPersistence : browserSessionPersistence
        );
        const credential = await signInWithEmailAndPassword(
          firebaseAuth,
          email.trim(),
          password
        );
        await verifyWithBackend(credential.user);
      } catch (err) {
        await signOut(firebaseAuth).catch(() => {});
        setUser(null);
        setStatus('unauthenticated');
        const message = mapFirebaseAuthError(err);
        setAuthError(message);
        throw new Error(message);
      } finally {
        explicitLoginInFlightRef.current = false;
      }
    },
    [verifyWithBackend]
  );

  const loginWithGoogle = useCallback(
    async (rememberMe: boolean) => {
      if (!firebaseAuth || !googleAuthProvider) {
        throw new Error('Firebase Google Authentication client is not configured.');
      }
      setAuthError(null);
      explicitLoginInFlightRef.current = true;
      try {
        // Sync persistence without awaiting prior to signInWithPopup so mobile browsers
        // and Safari preserve the synchronous user-click gesture for the OAuth popup.
        void updatePersistence(rememberMe);
        const credential = await signInWithPopup(firebaseAuth, googleAuthProvider);
        await verifyWithBackend(credential.user);
      } catch (err) {
        await signOut(firebaseAuth).catch(() => {});
        setUser(null);
        setStatus('unauthenticated');
        const message = mapFirebaseAuthError(err);
        setAuthError(message);
        throw new Error(message);
      } finally {
        explicitLoginInFlightRef.current = false;
      }
    },
    [updatePersistence, verifyWithBackend]
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!firebaseAuth) {
      throw new Error('Firebase Authentication client is not configured.');
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/user-not-found') {
        // Never leak whether an email is registered
        return;
      }
      throw new Error(mapFirebaseAuthError(err));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (firebaseAuth?.currentUser) {
        const token = await firebaseAuth.currentUser.getIdToken().catch(() => null);
        await authService.notifyLogout(token);
      }
    } finally {
      if (firebaseAuth) {
        await signOut(firebaseAuth).catch(() => {});
      }
      setUser(null);
      setStatus('unauthenticated');
      setAuthError(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        authError,
        clearAuthError,
        loginWithEmail,
        loginWithGoogle,
        sendPasswordReset,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
