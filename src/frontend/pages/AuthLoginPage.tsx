import { AlertCircle, Eye, EyeOff, Loader2, Lock, Radio } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { AuthConfigStatus } from '../../shared/types/auth';
import { isPopupFallbackSuggested, mapFirebaseAuthError } from '../firebase/authErrors';
import { firebaseClientConfigState } from '../firebase/config';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
import { PublicAuthLayout } from '../layouts/PublicAuthLayout';
import { authService } from '../services/authService';

export function AuthLoginPage() {
  const {
    status,
    authError,
    canUseRedirectFallback,
    clearAuthError,
    loginWithEmail,
    loginWithGoogle,
    loginWithGoogleRedirect,
  } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [showRedirectFallback, setShowRedirectFallback] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfigStatus | null>(null);

  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  useEffect(() => {
    let active = true;
    authService
      .getAuthStatus()
      .then((cfg) => {
        if (active) {
          setAuthConfig(cfg);
        }
      })
      .catch(() => {
        // Handled cleanly if backend is unreachable
      });
    return () => {
      active = false;
    };
  }, []);

  if (status === 'authenticated') {
    return <Navigate to={redirectTo} replace />;
  }

  const missingFirebaseKeys = Array.from(
    new Set([
      ...firebaseClientConfigState.missingClientConfigKeys,
      ...(authConfig?.missingFirebaseConfig ?? []),
    ])
  );

  const activeProjectId = firebaseClientConfigState.config.projectId;
  const projectMismatch =
    Boolean(authConfig?.firebaseProjectId) &&
    Boolean(activeProjectId) &&
    authConfig?.firebaseProjectId !== activeProjectId;

  const displayedError = localError || authError;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthError();
    setShowRedirectFallback(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setLocalError(t.auth.invalidEmailError);
      return;
    }
    if (!password) {
      setLocalError(t.auth.passwordRequiredError);
      return;
    }

    setSubmitting(true);
    try {
      await loginWithEmail(trimmedEmail, password, rememberMe);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setLocalError(mapFirebaseAuthError(err, { projectId: activeProjectId }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    clearAuthError();
    setShowRedirectFallback(false);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle(rememberMe);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (canUseRedirectFallback && isPopupFallbackSuggested(err)) {
        setShowRedirectFallback(true);
      }
      setLocalError(mapFirebaseAuthError(err, { projectId: activeProjectId }));
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleGoogleRedirectSignIn = async () => {
    setLocalError(null);
    clearAuthError();
    setGoogleSubmitting(true);
    try {
      await loginWithGoogleRedirect(rememberMe);
    } catch (err) {
      setLocalError(mapFirebaseAuthError(err, { projectId: activeProjectId }));
      setGoogleSubmitting(false);
    }
  };

  return (
    <PublicAuthLayout>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="mb-6 space-y-2 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-red-600 text-white">
            <Radio className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
            {t.auth.title}
          </h1>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {t.auth.subtitle}
          </p>
        </div>

        {missingFirebaseKeys.length > 0 ? (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-semibold">{t.auth.configWarningTitle}</p>
            <p className="mt-1 font-mono">
              {t.auth.configWarningMissing} {missingFirebaseKeys.join(', ')}
            </p>
          </div>
        ) : null}

        {projectMismatch ? (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-semibold">Firebase Project Mismatch Detected</p>
            <p className="mt-1 leading-relaxed">
              Frontend build is targeting project{' '}
              <span className="font-mono font-semibold">{activeProjectId}</span> while the backend
              is targeting{' '}
              <span className="font-mono font-semibold">{authConfig?.firebaseProjectId}</span>.
              Align <span className="font-mono">VITE_FIREBASE_*</span> and{' '}
              <span className="font-mono">FIREBASE_PROJECT_ID</span> and rebuild the frontend.
            </p>
          </div>
        ) : null}

        {displayedError ? (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{displayedError}</span>
          </div>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="login-email"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              {t.auth.emailLabel}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.emailPlaceholder}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              {t.auth.passwordLabel}
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.auth.passwordPlaceholder}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white py-2 pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-red-600"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-600 dark:border-slate-700 dark:bg-slate-950"
              />
              <span>{t.auth.rememberMe}</span>
            </label>

            <Link
              to="/auth/forgot-password"
              className="text-xs font-medium text-red-600 hover:underline dark:text-red-400 whitespace-nowrap"
            >
              {t.auth.forgotPasswordLink}
            </Link>
          </div>

          <button
            type="submit"
            disabled={submitting || googleSubmitting || !firebaseClientConfigState.isConfigured}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                <span>{t.auth.loggingIn}</span>
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t.auth.loginButton}</span>
              </>
            )}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span className="text-xs text-slate-500 dark:text-slate-400">{t.auth.orDivider}</span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={submitting || googleSubmitting || !firebaseClientConfigState.isConfigured}
          className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          {googleSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
              <span>{t.auth.connectingGoogle}</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>{t.auth.continueWithGoogle}</span>
            </>
          )}
        </button>

        {showRedirectFallback && canUseRedirectFallback ? (
          <button
            type="button"
            onClick={() => void handleGoogleRedirectSignIn()}
            disabled={submitting || googleSubmitting || !firebaseClientConfigState.isConfigured}
            className="mt-2.5 flex min-h-[44px] w-full items-center justify-center rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Continue with Google Redirect (Mobile / Strict Browser Fallback)
          </button>
        ) : null}

        <div className="mt-6 border-t border-slate-200 pt-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {t.common.privateSingleAdmin} · {t.common.noPublicSignup}
        </div>
      </section>
    </PublicAuthLayout>
  );
}
