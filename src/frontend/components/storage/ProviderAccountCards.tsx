import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Settings2,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { StorageAccount, StorageHealthCheckResult } from '../../../shared/types/storage';
import { useLanguage } from '../../hooks/useLanguage';
import { storageApi } from '../../services/storageService';
import { cn } from '../../utils/cn';
import { formatBytes, formatDateTime, getProviderLabel } from '../../utils/formatBytes';

interface ProviderAccountCardsProps {
  accounts: StorageAccount[];
  onRefresh: () => Promise<void>;
  onReconnectDrive?: (account: StorageAccount) => void;
  onHealthChecked?: (result: StorageHealthCheckResult) => void;
}

export function ProviderAccountCards({
  accounts,
  onRefresh,
  onReconnectDrive,
  onHealthChecked,
}: ProviderAccountCardsProps) {
  const { t } = useLanguage();
  const st = t.storage;

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [defaultingId, setDefaultingId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<StorageAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuotaGb, setEditQuotaGb] = useState('10');
  const [editPriority, setEditPriority] = useState('1');
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const startEdit = (acc: StorageAccount) => {
    setEditingAccount(acc);
    setEditName(acc.accountName);
    setEditQuotaGb((acc.quotaBytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, ''));
    setEditPriority(String(acc.priority));
    setActionError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    setSavingEdit(true);
    setActionError(null);
    try {
      await storageApi.updateProvider(editingAccount.id, {
        accountName: editName.trim() || undefined,
        quotaGb:
          editingAccount.provider !== 'GOOGLE_DRIVE' && Number(editQuotaGb) > 0
            ? Number(editQuotaGb)
            : undefined,
        priority: Number(editPriority) >= 1 ? Math.round(Number(editPriority)) : undefined,
      });
      setEditingAccount(null);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update storage account.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleHealthCheck = async (accountId: string) => {
    setCheckingId(accountId);
    setActionError(null);
    try {
      const res = await storageApi.checkProviderHealth(accountId);
      onHealthChecked?.(res);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Health check failed.');
    } finally {
      setCheckingId(null);
    }
  };

  const handleSetDefault = async (accountId: string) => {
    setDefaultingId(accountId);
    setActionError(null);
    try {
      await storageApi.setDefaultProvider(accountId);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not change default provider.');
    } finally {
      setDefaultingId(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    setDisconnectingId(accountId);
    setActionError(null);
    try {
      await storageApi.disconnectProvider(accountId);
      setConfirmDisconnectId(null);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to disconnect account.');
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {st.providersTitle}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {st.providersSubtitle}
        </p>
      </div>

      {actionError ? (
        <div className="mx-5 mt-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
          {actionError}
        </div>
      ) : null}

      <div className="p-5">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
            <Database className="mb-2.5 h-8 w-8 text-slate-400 dark:text-slate-500" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {st.noProvidersTitle}
            </p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {st.noProvidersBody}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {accounts.map((acc) => {
              const isDrive = acc.provider === 'GOOGLE_DRIVE';
              const dq = acc.driveStorageQuota;

              const isConnected = acc.status === 'CONNECTED';
              const isRevoked = acc.status === 'REVOKED';
              const isError = acc.status === 'ERROR';

              const effectiveUsed = acc.usedBytes + acc.reservedBytes;
              let pct = 0;
              let remainingBytes: number | null = null;
              let storageFullWarning = false;

              if (isDrive && dq) {
                if (!dq.isUnlimited && dq.limitBytes && dq.limitBytes > 0) {
                  const usedTotal = dq.totalAccountUsageBytes ?? 0;
                  pct = Math.min(100, Number(((usedTotal / dq.limitBytes) * 100).toFixed(1)));
                  remainingBytes = dq.remainingBytes ?? Math.max(0, dq.limitBytes - usedTotal);
                  storageFullWarning = remainingBytes < 50 * 1024 * 1024;
                } else {
                  pct = 0;
                  remainingBytes = null;
                }
              } else {
                pct =
                  acc.quotaBytes > 0
                    ? Math.min(100, Number(((effectiveUsed / acc.quotaBytes) * 100).toFixed(1)))
                    : 0;
                remainingBytes = Math.max(0, acc.quotaBytes - effectiveUsed);
                storageFullWarning = remainingBytes < 50 * 1024 * 1024;
              }

              return (
                <div
                  key={acc.id}
                  className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {getProviderLabel(acc.provider)}
                          </span>
                          <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {st.priorityLabel} #{acc.priority}
                          </span>
                          {acc.isDefault ? (
                            <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                              <Star className="h-3 w-3" />
                              {st.defaultBadge}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {acc.accountName}
                        </h3>
                        <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                          {isDrive
                            ? `${acc.accountEmail || acc.bucketName}${acc.accountDisplayName ? ` · ${acc.accountDisplayName}` : ''}`
                            : `${acc.bucketName} · ${acc.region} · ${acc.accessKeyPreview}`}
                        </p>
                      </div>

                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
                          isConnected
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : isRevoked || isError
                              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                              : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        )}
                      >
                        {isConnected ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : isRevoked || isError ? (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {isConnected
                          ? st.statusConnected
                          : isRevoked
                            ? st.statusRevoked
                            : isError
                              ? st.statusError
                              : st.statusDisconnected}
                      </span>
                    </div>

                    {/* Per-Account Quota Bar */}
                    {isDrive ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {st.quotaLabel}
                          </span>
                          <span className="tabular-nums text-slate-600 dark:text-slate-400">
                            {dq
                              ? dq.isUnlimited
                                ? `${formatBytes(dq.totalAccountUsageBytes ?? 0)} / Unlimited`
                                : `${formatBytes(dq.totalAccountUsageBytes ?? 0)} / ${formatBytes(dq.limitBytes)} (${pct}%)`
                              : st.kpiNotMeasured}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className={cn(
                              'h-full transition-all',
                              pct >= 90
                                ? 'bg-red-600'
                                : pct >= 70
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-600'
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                          <span>
                            {dq?.isUnlimited
                              ? 'Unlimited Drive quota'
                              : remainingBytes !== null
                                ? `${formatBytes(remainingBytes)} ${st.kpiQuotaRemainingSuffix}`
                                : 'Quota pending check'}
                            {acc.reservedBytes > 0
                              ? ` (${formatBytes(acc.reservedBytes)} uploading)`
                              : ''}
                          </span>
                          <span>
                            {st.measuredLabel}:{' '}
                            {dq?.usageInDriveBytes !== null && dq?.usageInDriveBytes !== undefined
                              ? `${formatBytes(dq.usageInDriveBytes)} (${acc.fileCount} studio files)`
                              : `${acc.fileCount} studio files`}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Folder: <span className="font-mono">{acc.driveFolderId || 'Pending'}</span> · Storage shared across Drive, Gmail & Photos
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {st.quotaLabel}
                          </span>
                          <span className="tabular-nums text-slate-600 dark:text-slate-400">
                            {formatBytes(effectiveUsed)} / {formatBytes(acc.quotaBytes)} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className={cn(
                              'h-full transition-all',
                              pct >= 90
                                ? 'bg-red-600'
                                : pct >= 70
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-600'
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                          <span>
                            {formatBytes(remainingBytes ?? 0)} {st.kpiQuotaRemainingSuffix}
                            {acc.reservedBytes > 0
                              ? ` (${formatBytes(acc.reservedBytes)} active)`
                              : ''}
                          </span>
                          <span>
                            {st.measuredLabel}:{' '}
                            {acc.usageMeasured && acc.measuredUsedBytes !== null
                              ? `${formatBytes(acc.measuredUsedBytes)} (${acc.measuredObjectCount ?? 0} objects)`
                              : st.kpiNotMeasured}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {st.lastCheckedLabel}:{' '}
                      {acc.lastHealthCheckAt ? formatDateTime(acc.lastHealthCheckAt) : st.neverChecked}
                    </div>

                    {storageFullWarning && isConnected ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                        Account free space is nearly full ({formatBytes(remainingBytes)} free). Delete unused files or connect another Google Drive account.
                      </div>
                    ) : null}

                    {acc.lastHealthError ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                        {acc.lastHealthError}
                      </div>
                    ) : null}
                  </div>

                  {/* Inline Edit Form or Action Buttons */}
                  {editingAccount?.id === acc.id ? (
                    <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                      <div
                        className={cn(
                          'grid grid-cols-1 gap-2',
                          isDrive ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
                        )}
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Account Label"
                          className="min-h-[38px] rounded-md border border-slate-300 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                        />
                        {!isDrive ? (
                          <input
                            type="number"
                            step="0.5"
                            min="0.1"
                            value={editQuotaGb}
                            onChange={(e) => setEditQuotaGb(e.target.value)}
                            placeholder="Quota GB"
                            className="min-h-[38px] rounded-md border border-slate-300 bg-white px-2.5 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                          />
                        ) : null}
                        <input
                          type="number"
                          min="1"
                          value={editPriority}
                          onChange={(e) => setEditPriority(e.target.value)}
                          placeholder="Priority"
                          className="min-h-[38px] rounded-md border border-slate-300 bg-white px-2.5 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingAccount(null)}
                          className="min-h-[36px] rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                        >
                          {st.cancel}
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => void handleSaveEdit()}
                          className="min-h-[36px] rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {savingEdit ? st.saving : st.save}
                        </button>
                      </div>
                    </div>
                  ) : confirmDisconnectId === acc.id ? (
                    <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        {st.confirmDisconnect}
                      </p>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDisconnectId(null)}
                          className="min-h-[36px] rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                        >
                          {st.cancel}
                        </button>
                        <button
                          type="button"
                          disabled={disconnectingId === acc.id}
                          onClick={() => void handleDisconnect(acc.id)}
                          className="min-h-[36px] rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {disconnectingId === acc.id ? '...' : st.disconnect}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                      {isDrive && isRevoked && onReconnectDrive ? (
                        <button
                          type="button"
                          onClick={() => onReconnectDrive(acc)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {st.reconnectDrive}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={checkingId === acc.id}
                        onClick={() => void handleHealthCheck(acc.id)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {checkingId === acc.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Activity className="h-3.5 w-3.5" />
                        )}
                        {checkingId === acc.id ? st.testingHealth : st.testHealth}
                      </button>

                      {!acc.isDefault && acc.status === 'CONNECTED' ? (
                        <button
                          type="button"
                          disabled={defaultingId === acc.id}
                          onClick={() => void handleSetDefault(acc.id)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Star className="h-3.5 w-3.5" />
                          {st.setDefault}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => startEdit(acc)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        {st.editSettings}
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmDisconnectId(acc.id)}
                        className="ml-auto inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {st.disconnect}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
