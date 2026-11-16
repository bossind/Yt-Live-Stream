import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  StorageAccount,
  StorageSelectionMode,
  UploadSessionRecord,
  UploadTuningMode,
} from '../../../shared/types/storage';
import { useLanguage } from '../../hooks/useLanguage';
import {
  DirectUploadController,
  removeResumableDescriptor,
  type ActiveUploadTask,
} from '../../services/multipartUploader';
import { storageApi } from '../../services/storageService';
import { cn } from '../../utils/cn';
import {
  formatBytes,
  formatEtaSeconds,
  formatSpeedBps,
  getProviderLabel,
} from '../../utils/formatBytes';

interface DirectUploadWorkspaceProps {
  accounts: StorageAccount[];
  activeSessions: UploadSessionRecord[];
  onRefreshOverview: () => Promise<void>;
  onOpenConnectDrive?: () => void;
}

function getAccountFreeSummary(acc: StorageAccount): {
  label: string;
  isFull: boolean;
} {
  if (acc.provider === 'GOOGLE_DRIVE') {
    const dq = acc.driveStorageQuota;
    if (!dq) {
      return { label: 'quota pending', isFull: false };
    }
    if (dq.isUnlimited) {
      return { label: 'Unlimited free', isFull: false };
    }
    const free = Math.max(0, (dq.remainingBytes ?? 0) - acc.reservedBytes);
    return {
      label: `${formatBytes(free)} free`,
      isFull: free <= 1024 * 1024,
    };
  }

  const free = Math.max(0, acc.quotaBytes - acc.usedBytes - acc.reservedBytes);
  return {
    label: `${formatBytes(free)} free`,
    isFull: free <= 1024 * 1024,
  };
}

export function DirectUploadWorkspace({
  accounts,
  activeSessions,
  onRefreshOverview,
  onOpenConnectDrive,
}: DirectUploadWorkspaceProps) {
  const { t } = useLanguage();
  const st = t.storage;

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'CONNECTED'),
    [accounts]
  );

  const [selectionMode, setSelectionMode] = useState<StorageSelectionMode>('AUTO');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [tuningMode, setTuningMode] = useState<UploadTuningMode>('AUTO');
  const [manualChunkSizeMb, setManualChunkSizeMb] = useState<number>(8);
  const [manualConcurrency, setManualConcurrency] = useState<number>(4);
  const [dragActive, setDragActive] = useState(false);

  const [tasks, setTasks] = useState<ActiveUploadTask[]>([]);
  const controllersRef = useRef<Map<string, DirectUploadController>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [resumeTargetSession, setResumeTargetSession] = useState<UploadSessionRecord | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const effectiveAccountId =
    selectedAccountId && connectedAccounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : connectedAccounts.find((a) => a.isDefault)?.id || connectedAccounts[0]?.id || '';

  const selectedAccount = connectedAccounts.find((a) => a.id === effectiveAccountId) || null;
  const anyAccountHasSpace = connectedAccounts.some((a) => !getAccountFreeSummary(a).isFull);
  const manualTargetFull =
    selectionMode === 'MANUAL' && selectedAccount
      ? getAccountFreeSummary(selectedAccount).isFull
      : false;
  const hasQuotaErrorInQueue = tasks.some(
    (task) =>
      task.status === 'FAILED' &&
      task.errorMessage &&
      /(quota|full|space|capacity|insufficient)/i.test(task.errorMessage)
  );

  const upsertTask = (snapshot: ActiveUploadTask) => {
    setTasks((prev) => {
      const idx = prev.findIndex((item) => item.localId === snapshot.localId);
      if (idx === -1) return [snapshot, ...prev];
      const next = [...prev];
      next[idx] = snapshot;
      return next;
    });
  };

  const enqueueFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setWorkspaceError(null);

    if (connectedAccounts.length === 0) {
      setWorkspaceError('Connect and verify at least one Google Drive account before uploading.');
      return;
    }

    if (selectionMode === 'MANUAL' && !effectiveAccountId) {
      setWorkspaceError('Select a connected target Google Drive account for Manual mode.');
      return;
    }

    Array.from(fileList).forEach((file) => {
      const controller = new DirectUploadController({
        file,
        selectionMode,
        accountId: selectionMode === 'MANUAL' ? effectiveAccountId : undefined,
        tuningMode,
        manualChunkSizeMb,
        manualConcurrency,
        onUpdate: upsertTask,
        onComplete: () => {
          void onRefreshOverview();
        },
      });
      const initial = controller.getSnapshot();
      controllersRef.current.set(initial.localId, controller);
      upsertTask(initial);
      void controller.startNew(
        selectionMode,
        selectionMode === 'MANUAL' ? effectiveAccountId : undefined
      );
    });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    enqueueFiles(e.dataTransfer.files);
  };

  const handleResumeWithFile = (session: UploadSessionRecord, file: File | undefined) => {
    setResumeTargetSession(null);
    if (!file) return;
    setWorkspaceError(null);

    const progressPct =
      session.fileSizeBytes > 0 && session.uploadedBytesConfirmed > 0
        ? Math.min(99, Number(((session.uploadedBytesConfirmed / session.fileSizeBytes) * 100).toFixed(1)))
        : 0;

    const controller = new DirectUploadController(
      {
        file,
        selectionMode: 'MANUAL',
        accountId: session.accountId,
        tuningMode,
        manualChunkSizeMb,
        manualConcurrency,
        onUpdate: upsertTask,
        onComplete: () => {
          void onRefreshOverview();
        },
      },
      {
        sessionId: session.id,
        accountId: session.accountId,
        accountName: session.accountName,
        accountEmail: session.accountEmail,
        provider: session.provider,
        uploadStrategy: session.uploadStrategy,
        chunkSizeBytes: session.chunkSizeBytes,
        totalParts: session.totalParts,
        uploadedBytes: session.uploadedBytesConfirmed || 0,
        progressPercent: progressPct,
        completedPartsCount: session.completedParts.length,
      }
    );

    const snap = controller.getSnapshot();
    controllersRef.current.set(snap.localId, controller);
    upsertTask(snap);
    void controller.resumeFromSession(session.id);
  };

  const handleAbortUnattachedSession = async (sessionId: string) => {
    try {
      await storageApi.abortUpload(sessionId);
      removeResumableDescriptor(sessionId);
      await onRefreshOverview();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to cancel upload session.');
    }
  };

  const attachedSessionIds = new Set(tasks.map((task) => task.sessionId).filter(Boolean));
  const orphanedSessions = activeSessions.filter(
    (s) =>
      !attachedSessionIds.has(s.id) &&
      (s.status === 'INITIATED' || s.status === 'IN_PROGRESS' || s.status === 'PAUSED')
  );

  const hasOptionalS3Accounts = connectedAccounts.some((a) => a.provider !== 'GOOGLE_DRIVE');

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {st.uploaderTitle}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {st.uploaderSubtitle}
        </p>
      </div>

      <div className="space-y-5 p-5">
        {workspaceError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
            {workspaceError}
          </div>
        ) : null}

        {(connectedAccounts.length > 0 && (!anyAccountHasSpace || manualTargetFull)) ||
        hasQuotaErrorInQueue ? (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50/70 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {manualTargetFull
                    ? 'Selected Google Drive account has insufficient free space'
                    : 'Storage space warning across connected destination'}
                </p>
                <p className="leading-relaxed">
                  {manualTargetFull
                    ? 'Manual mode will not fall back automatically. Select a different connected Google Drive account, delete old files below, or connect another Google account.'
                    : 'Delete unused files from the File Manager below, switch destination account, or connect another Google Drive account.'}
                </p>
              </div>
            </div>
            {onOpenConnectDrive ? (
              <button
                type="button"
                onClick={onOpenConnectDrive}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Connect Another Google Account
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Destination + Upload Tuning Controls */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-950/50">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              {st.destinationModeLabel}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSelectionMode('AUTO')}
                className={cn(
                  'min-h-[40px] rounded-lg border px-3 text-left text-xs font-medium transition-colors',
                  selectionMode === 'AUTO'
                    ? 'border-red-600 bg-white text-slate-900 dark:border-red-500 dark:bg-slate-900 dark:text-slate-100'
                    : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-800 dark:text-slate-400'
                )}
              >
                {st.modeAuto}
              </button>
              <button
                type="button"
                onClick={() => setSelectionMode('MANUAL')}
                className={cn(
                  'min-h-[40px] rounded-lg border px-3 text-left text-xs font-medium transition-colors',
                  selectionMode === 'MANUAL'
                    ? 'border-red-600 bg-white text-slate-900 dark:border-red-500 dark:bg-slate-900 dark:text-slate-100'
                    : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-800 dark:text-slate-400'
                )}
              >
                {st.modeManual}
              </button>
            </div>

            {selectionMode === 'MANUAL' ? (
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  {st.targetAccountLabel}
                </label>
                <select
                  value={effectiveAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {connectedAccounts.length === 0 ? (
                    <option value="">No connected Google Drive accounts</option>
                  ) : (
                    connectedAccounts.map((acc) => {
                      const free = getAccountFreeSummary(acc);
                      const identity = acc.accountEmail
                        ? `${acc.accountName} (${acc.accountEmail})`
                        : `${acc.accountName} (${getProviderLabel(acc.provider)})`;
                      return (
                        <option key={acc.id} value={acc.id}>
                          {identity} · {free.label}
                        </option>
                      );
                    })
                  )}
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {st.manualNoFallbackNote}
                </p>
              </div>
            ) : (
              <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Picks the highest-priority connected Google Drive (default first) with enough remaining space for each uploaded file.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-950/50">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              {st.uploadTuningLabel}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setTuningMode('AUTO')}
                className={cn(
                  'min-h-[40px] rounded-lg border px-3 text-left text-xs font-medium transition-colors',
                  tuningMode === 'AUTO'
                    ? 'border-red-600 bg-white text-slate-900 dark:border-red-500 dark:bg-slate-900 dark:text-slate-100'
                    : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-800 dark:text-slate-400'
                )}
              >
                {st.tuningAuto}
              </button>
              <button
                type="button"
                onClick={() => setTuningMode('ADVANCED')}
                className={cn(
                  'min-h-[40px] rounded-lg border px-3 text-left text-xs font-medium transition-colors',
                  tuningMode === 'ADVANCED'
                    ? 'border-red-600 bg-white text-slate-900 dark:border-red-500 dark:bg-slate-900 dark:text-slate-100'
                    : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-800 dark:text-slate-400'
                )}
              >
                {st.tuningAdvanced}
              </button>
            </div>

            {tuningMode === 'ADVANCED' ? (
              <div className={cn('grid gap-3 pt-1', hasOptionalS3Accounts ? 'grid-cols-2' : 'grid-cols-1')}>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    {st.chunkSizeLabel} (1–128, 256 KiB aligned for Drive)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={manualChunkSizeMb}
                    onChange={(e) =>
                      setManualChunkSizeMb(Math.max(1, Math.min(128, Number(e.target.value) || 8)))
                    }
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                {hasOptionalS3Accounts ? (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      {st.concurrencyLabel} (1–8)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={manualConcurrency}
                      onChange={(e) =>
                        setManualConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 4)))
                      }
                      className="w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Uses 256-KiB-aligned 8–32 MB resumable chunks directly to Google Drive so every pause/resume recovers exact byte offsets via HTTP 308.
              </p>
            )}
          </div>
        </div>

        {/* File Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
            dragActive
              ? 'border-red-500 bg-red-50/50 dark:border-red-500 dark:bg-red-950/20'
              : 'border-slate-300 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-950/30'
          )}
        >
          <UploadCloud className="mb-2.5 h-8 w-8 text-slate-400 dark:text-slate-500" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {st.dropzoneTitle}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{st.dropzoneHint}</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*,.mkv,.mp4,.mov,.webm,.ts"
            className="hidden"
            onChange={(e) => {
              enqueueFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-red-600 px-4 text-xs font-medium text-white hover:bg-red-700"
          >
            <FileUp className="h-4 w-4" />
            {st.chooseFiles}
          </button>
        </div>

        {/* Active Transfer Queue */}
        {tasks.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {st.activeQueueTitle}
            </h3>
            <div className="space-y-2.5">
              {tasks.map((task) => {
                const ctrl = controllersRef.current.get(task.localId);
                return (
                  <div
                    key={task.localId}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {task.fileName}
                        </p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                          {formatBytes(task.uploadedBytes)} / {formatBytes(task.fileSizeBytes)} ·{' '}
                          {task.accountEmail || task.accountName || 'Routing...'}
                          {task.provider ? ` (${getProviderLabel(task.provider)})` : ''} ·{' '}
                          {st.partsLabel}: {task.completedPartsCount}/{task.totalParts}
                          {task.retryCount > 0 ? ` · Retries: ${task.retryCount}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {task.status === 'UPLOADING' && ctrl ? (
                          <button
                            type="button"
                            onClick={() => void ctrl.pause()}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            {st.pause}
                          </button>
                        ) : null}

                        {task.status === 'PAUSED' && ctrl ? (
                          <button
                            type="button"
                            onClick={() => void ctrl.resume()}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            <Play className="h-3.5 w-3.5" />
                            {st.resume}
                          </button>
                        ) : null}

                        {task.status === 'FAILED' && ctrl ? (
                          <button
                            type="button"
                            onClick={() => void ctrl.resume()}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {st.retry}
                          </button>
                        ) : null}

                        {(task.status === 'PREPARING' ||
                          task.status === 'UPLOADING' ||
                          task.status === 'PAUSED' ||
                          task.status === 'FAILED') &&
                        ctrl ? (
                          <button
                            type="button"
                            onClick={() => void ctrl.cancel()}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-400"
                          >
                            <X className="h-3.5 w-3.5" />
                            {st.cancel}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={cn(
                          'h-full transition-all',
                          task.status === 'FAILED' || task.status === 'ABORTED'
                            ? 'bg-red-600'
                            : task.status === 'COMPLETED'
                              ? 'bg-emerald-600'
                              : task.status === 'PAUSED'
                                ? 'bg-amber-500'
                                : 'bg-red-600'
                        )}
                        style={{ width: `${task.progressPercent}%` }}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1 font-medium">
                        {task.status === 'COMPLETED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : task.status === 'FAILED' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                        ) : task.status === 'UPLOADING' || task.status === 'FINALIZING' ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-red-600 dark:text-red-400" />
                        ) : null}
                        {task.status} · {task.progressPercent}%
                      </span>
                      <span>
                        {st.speedLabel}: {formatSpeedBps(task.currentSpeedBps)} · {st.avgSpeedLabel}:{' '}
                        {formatSpeedBps(task.averageSpeedBps)} · {st.etaLabel}:{' '}
                        {formatEtaSeconds(task.etaSeconds)}
                      </span>
                    </div>

                    {task.errorMessage ? (
                      <p className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                        {task.errorMessage}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Interrupted Resumable Sessions (survives browser reload) */}
        {orphanedSessions.length > 0 ? (
          <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div>
              <h3 className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                {st.resumableTitle}
              </h3>
              <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                {st.resumableBody}
              </p>
            </div>

            <input
              ref={resumeInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                if (resumeTargetSession) {
                  handleResumeWithFile(resumeTargetSession, e.target.files?.[0]);
                }
                e.target.value = '';
              }}
            />

            <div className="space-y-2">
              {orphanedSessions.map((sess) => {
                const confirmedText =
                  sess.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE'
                    ? `${formatBytes(sess.uploadedBytesConfirmed)} / ${formatBytes(sess.fileSizeBytes)} confirmed`
                    : `${sess.completedParts.length}/${sess.totalParts} parts uploaded`;
                return (
                  <div
                    key={sess.id}
                    className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5 dark:border-amber-900/50 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                        {sess.fileName}
                      </p>
                      <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        {sess.accountEmail || sess.accountName} · {confirmedText} · {sess.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setResumeTargetSession(sess);
                          resumeInputRef.current?.click();
                        }}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {st.reselectToResume}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAbortUnattachedSession(sess.id)}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {st.abortSession}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
