import { FirebaseError } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type ActionCodeSettings,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthenticatedAdminUser } from '../../shared/types/auth';
import { mapFirebaseAuthError } from '../firebase/authErrors';
import { firebaseAuth, googleAuthProvider } from '../firebase/client';
import { authService } from '../services/authService';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedAdminUser | null;
  authError: string | null;
  canUseRedirectFallback: boolean;
  clearAuthError: () => void;
  loginWithEmail: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  loginWithGoogle: (rememberMe: boolean) => Promise<void>;
  loginWithGoogleRedirect: (rememberMe: boolean) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function isTopLevelWindow(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthenticatedAdminUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const explicitLoginInFlightRef = useRef(false);
  const redirectCheckedRef = useRef(false);

  const canUseRedirectFallback = useMemo(() => isTopLevelWindow(), []);

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

    if (!redirectCheckedRef.current) {
      redirectCheckedRef.current = true;
      void (async () => {
        if (!firebaseAuth) return;
        try {
          const redirectResult = await getRedirectResult(firebaseAuth);
          if (redirectResult?.user && !explicitLoginInFlightRef.current) {
            explicitLoginInFlightRef.current = true;
            try {
              await verifyWithBackend(redirectResult.user);
            } catch (err) {
              const message = mapFirebaseAuthError(err);
              await signOut(firebaseAuth).catch(() => {});
              setUser(null);
              setStatus('unauthenticated');
              setAuthError(message);
            } finally {
              explicitLoginInFlightRef.current = false;
            }
          }
        } catch (err) {
          const message = mapFirebaseAuthError(err);
          await signOut(firebaseAuth).catch(() => {});
          setUser(null);
          setStatus('unauthenticated');
          setAuthError(message);
        }
      })();
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
        throw err;
      } finally {
        explicitLoginInFlightRef.current = false;
      }
    },
    [updatePersistence, verifyWithBackend]
  );

  const loginWithGoogleRedirect = useCallback(
    async (rememberMe: boolean) => {
      if (!firebaseAuth || !googleAuthProvider) {
        throw new Error('Firebase Google Authentication client is not configured.');
      }
      if (!isTopLevelWindow()) {
        throw new Error(
          'Redirect sign-in requires opening the application outside an embedded preview frame.'
        );
      }
      setAuthError(null);
      try {
        await setPersistence(
          firebaseAuth,
          rememberMe ? browserLocalPersistence : browserSessionPersistence
        );
        await signInWithRedirect(firebaseAuth, googleAuthProvider);
      } catch (err) {
        const message = mapFirebaseAuthError(err);
        setAuthError(message);
        throw new Error(message);
      }
    },
    []
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!firebaseAuth) {
      throw new Error('Firebase Authentication client is not configured.');
    }
    try {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : '';
      const actionCodeSettings: ActionCodeSettings | undefined =
        origin.startsWith('http://') || origin.startsWith('https://')
          ? {
              url: `${origin.replace(/\/+$/, '')}/auth/login`,
              handleCodeInApp: false,
            }
          : undefined;

      await sendPasswordResetEmail(firebaseAuth, email.trim(), actionCodeSettings);
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
        canUseRedirectFallback,
        clearAuthError,
        loginWithEmail,
        loginWithGoogle,
        loginWithGoogleRedirect,
        sendPasswordReset,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
