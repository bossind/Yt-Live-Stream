import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { firebaseClientConfigState } from '../firebase/config';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
import { PublicAuthLayout } from '../layouts/PublicAuthLayout';

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSent(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMessage(t.auth.invalidEmailError);
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setSent(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to send password reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicAuthLayout>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="mb-6 space-y-2 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
            {t.auth.forgotTitle}
          </h1>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {t.auth.forgotSubtitle}
          </p>
        </div>

        {!firebaseClientConfigState.isConfigured ? (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <p className="font-semibold">{t.auth.configWarningTitle}</p>
            <p className="mt-1 font-mono">
              {t.auth.configWarningMissing}{' '}
              {firebaseClientConfigState.missingClientConfigKeys.join(', ')}
            </p>
          </div>
        ) : null}

        {errorMessage ? (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 p-3.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {sent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">{t.auth.forgotSuccessTitle}</p>
                <p>{t.auth.forgotSuccessBody}</p>
              </div>
            </div>

            <Link
              to="/auth/login"
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t.controls.backToLogin}</span>
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="forgot-email"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {t.auth.emailLabel}
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !firebaseClientConfigState.isConfigured}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                  <span>{t.auth.sendingResetLink}</span>
                </>
              ) : (
                <span>{t.auth.sendResetLink}</span>
              )}
            </button>

            <div className="pt-2 text-center">
              <Link
                to="/auth/login"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.controls.backToLogin}</span>
              </Link>
            </div>
          </form>
        )}
      </section>
    </PublicAuthLayout>
  );
}
