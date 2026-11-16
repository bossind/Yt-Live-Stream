import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Crown, Loader2, MailPlus, ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import type { AdminAllowlistResponse } from '../../../shared/types/auth';
import { useLanguage } from '../../hooks/useLanguage';
import { authService } from '../../services/authService';
import { formatDateTime } from '../../utils/formatBytes';

export function AdminAllowlistPanel() {
  const { t } = useLanguage();
  const st = t.settings;

  const [data, setData] = useState<AdminAllowlistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [revokingEmail, setRevokingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadAllowlist = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authService.listAllowlist();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load administrator allowlist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllowlist();
  }, [loadAllowlist]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid Gmail or email address.');
      return;
    }

    setSubmitting(true);
    try {
      await authService.addAllowlistAdmin({
        email: trimmed,
        displayName: nameInput.trim() || undefined,
      });
      setEmailInput('');
      setNameInput('');
      setSuccessMsg(`Authorized ${trimmed} for Google Sign-In studio access.`);
      await loadAllowlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize Gmail account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (targetEmail: string) => {
    setError(null);
    setSuccessMsg(null);
    setRevokingEmail(targetEmail);
    try {
      await authService.removeAllowlistAdmin(targetEmail);
      setSuccessMsg(`Revoked studio access for ${targetEmail}.`);
      await loadAllowlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke administrator access.');
    } finally {
      setRevokingEmail(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {st.allowlistTitle}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {st.allowlistDesc}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {error ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {successMsg ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMsg}
          </div>
        ) : null}

        <form onSubmit={(e) => void handleAdd(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <label htmlFor="allowlist-email" className="sr-only">
              Authorized Gmail Address
            </label>
            <input
              id="allowlist-email"
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={st.allowlistEmailPlaceholder}
              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="allowlist-name" className="sr-only">
              Display Label
            </label>
            <input
              id="allowlist-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={st.allowlistNamePlaceholder}
              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MailPlus className="h-4 w-4" />
              )}
              <span>{st.allowlistAddButton}</span>
            </button>
          </div>
        </form>

        {loading && !data ? (
          <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading authorized administrators...</span>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {(data?.entries ?? []).map((entry) => {
              const isCurrent = entry.email === data?.currentAdminEmail;
              const isEnvOnly = entry.source === 'env';
              const canRevoke =
                !entry.isPrimaryOwner && !isCurrent && entry.source !== 'env' && entry.source !== 'both';

              return (
                <div
                  key={entry.email}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {entry.email}
                      </span>
                      {entry.isPrimaryOwner ? (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                          <Crown className="h-3 w-3" />
                          {st.primaryOwnerBadge}
                        </span>
                      ) : null}
                      {isCurrent ? (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                          {st.currentSessionBadge}
                        </span>
                      ) : null}
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {entry.source === 'both'
                          ? 'ENV + Firestore'
                          : entry.source === 'env'
                            ? 'Server ENV'
                            : 'Firestore'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {entry.displayName ? `${entry.displayName} · ` : ''}
                      {entry.uid ? `UID: ${entry.uid}` : 'Awaiting first Google Sign-In'}
                      {entry.updatedAt ? ` · Updated ${formatDateTime(entry.updatedAt)}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {entry.isPrimaryOwner ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Protected
                      </span>
                    ) : isEnvOnly || entry.source === 'both' ? (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Managed via ADMIN_EMAILS
                      </span>
                    ) : isCurrent ? (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Active Session
                      </span>
                    ) : canRevoke ? (
                      <button
                        type="button"
                        disabled={revokingEmail === entry.email}
                        onClick={() => void handleRemove(entry.email)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        {revokingEmail === entry.email ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {st.revokeAccess}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
