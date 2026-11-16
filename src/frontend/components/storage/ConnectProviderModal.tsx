import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import type {
  CreateStorageAccountInput,
  GcsAuthMode,
  GoogleDriveOAuthStatus,
  StorageAccount,
  StorageProviderType,
} from '../../../shared/types/storage';
import { useLanguage } from '../../hooks/useLanguage';
import { storageApi } from '../../services/storageService';
import { cn } from '../../utils/cn';

interface ConnectProviderModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: (account?: StorageAccount) => void;
  oauthStatus?: GoogleDriveOAuthStatus | null;
  reconnectAccount?: StorageAccount | null;
}

type ModalMode = 'GOOGLE_DRIVE' | 'OPTIONAL_OBJECT_STORAGE';
type OptionalProviderType = Exclude<StorageProviderType, 'GOOGLE_DRIVE'>;

const OPTIONAL_PROVIDERS: Array<{
  id: OptionalProviderType;
  label: string;
  badge: string;
}> = [
  { id: 'CLOUDFLARE_R2', label: 'Cloudflare R2', badge: 'Optional' },
  { id: 'AMAZON_S3', label: 'Amazon S3', badge: 'AWS' },
  { id: 'GOOGLE_CLOUD_STORAGE', label: 'Google Cloud Storage', badge: 'GCS' },
  { id: 'S3_COMPATIBLE', label: 'Other S3-Compatible', badge: 'Custom' },
];

export function ConnectProviderModal({
  open,
  onClose,
  onConnected,
  oauthStatus: initialOauthStatus,
  reconnectAccount,
}: ConnectProviderModalProps) {
  const { t } = useLanguage();
  const st = t.storage;

  const [modalMode, setModalMode] = useState<ModalMode>('GOOGLE_DRIVE');
  const [oauthStatus, setOauthStatus] = useState<GoogleDriveOAuthStatus | null>(
    initialOauthStatus ?? null
  );
  const [driveLabel, setDriveLabel] = useState('');
  const [drivePriority, setDrivePriority] = useState('1');
  const [driveIsDefault, setDriveIsDefault] = useState(true);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [copiedCallback, setCopiedCallback] = useState(false);

  // Optional S3 / R2 / GCS fields
  const [provider, setProvider] = useState<OptionalProviderType>('CLOUDFLARE_R2');
  const [accountName, setAccountName] = useState('');
  const [accountIdExternal, setAccountIdExternal] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [region, setRegion] = useState('auto');
  const [endpoint, setEndpoint] = useState('');
  const [gcsAuthMode, setGcsAuthMode] = useState<GcsAuthMode>('HMAC_S3');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [quotaGb, setQuotaGb] = useState('10');
  const [priority, setPriority] = useState('2');
  const [isDefault, setIsDefault] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const popupRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialOauthStatus) {
      setOauthStatus(initialOauthStatus);
    }
  }, [initialOauthStatus]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (reconnectAccount) {
      setModalMode('GOOGLE_DRIVE');
      setDriveLabel(reconnectAccount.accountName);
      setDrivePriority(String(reconnectAccount.priority));
      setDriveIsDefault(reconnectAccount.isDefault);
    } else {
      setDriveLabel('');
      setDrivePriority('1');
      setDriveIsDefault(false);
    }
    void storageApi
      .getGoogleDriveOAuthStatus()
      .then(setOauthStatus)
      .catch(() => {});
  }, [open, reconnectAccount]);

  useEffect(() => {
    if (!open) return;

    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as
        | {
            type?: string;
            ok?: boolean;
            errorMessage?: string;
          }
        | undefined;
      if (!payload || payload.type !== 'GOOGLE_DRIVE_OAUTH_RESULT') return;

      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setOauthWaiting(false);
      popupRef.current = null;

      if (payload.ok) {
        onConnected();
        onClose();
      } else {
        setError(payload.errorMessage || 'Google Drive OAuth authorization failed.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [open, onConnected, onClose]);

  if (!open) return null;

  const resetSensitiveFields = () => {
    setAccessKeyId('');
    setSecretAccessKey('');
    setServiceAccountJson('');
    setShowSecret(false);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setOauthWaiting(false);
    setCopiedCallback(false);
    resetSensitiveFields();
    onClose();
  };

  const handleCopyCallbackUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 2000);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleStartDriveOAuth = async () => {
    setError(null);
    setSubmitting(true);

    try {
      const parsedPriority = Number(drivePriority);
      const startRes = await storageApi.startGoogleDriveOAuth({
        accountLabel: driveLabel.trim() || undefined,
        priority: Number.isInteger(parsedPriority) && parsedPriority >= 1 ? parsedPriority : 1,
        isDefault: driveIsDefault,
        reconnectAccountId: reconnectAccount?.id,
      });

      const width = 540;
      const height = 680;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

      const popup = window.open(
        startRes.authUrl,
        'ylas_google_drive_oauth',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );

      if (!popup) {
        setError(
          'Popup window was blocked by your browser. Please allow popups for this site and try again.'
        );
        setSubmitting(false);
        return;
      }

      popupRef.current = popup;
      setOauthWaiting(true);
      setSubmitting(false);

      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
      }
      pollTimerRef.current = window.setInterval(() => {
        if (popupRef.current && popupRef.current.closed) {
          if (pollTimerRef.current) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          popupRef.current = null;
          setOauthWaiting(false);
        }
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Google Drive OAuth flow.');
      setSubmitting(false);
      setOauthWaiting(false);
    }
  };

  const handleProviderChange = (next: OptionalProviderType) => {
    setProvider(next);
    setError(null);
    if (next === 'CLOUDFLARE_R2') {
      setRegion('auto');
      setQuotaGb('10');
    } else if (next === 'AMAZON_S3') {
      setRegion('us-east-1');
    } else if (next === 'GOOGLE_CLOUD_STORAGE') {
      setRegion('auto');
    } else {
      setRegion('us-east-1');
    }
  };

  const handleJsonFileUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setServiceAccountJson(text);
      setError(null);
    } catch {
      setError('Could not read the selected JSON key file.');
    }
  };

  const handleSubmitOptionalProvider = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accountName.trim() || !bucketName.trim()) {
      setError('Account name and bucket name are required.');
      return;
    }

    const parsedQuota = Number(quotaGb);
    const parsedPriority = Number(priority);
    if (!Number.isFinite(parsedQuota) || parsedQuota < 0.1) {
      setError('Application quota must be at least 0.1 GB.');
      return;
    }

    const payload: CreateStorageAccountInput = {
      provider,
      accountName: accountName.trim(),
      bucketName: bucketName.trim(),
      region: region.trim() || undefined,
      endpoint: endpoint.trim() || undefined,
      accountIdExternal: accountIdExternal.trim() || undefined,
      gcsAuthMode: provider === 'GOOGLE_CLOUD_STORAGE' ? gcsAuthMode : undefined,
      accessKeyId:
        provider === 'GOOGLE_CLOUD_STORAGE' && gcsAuthMode === 'SERVICE_ACCOUNT'
          ? undefined
          : accessKeyId.trim(),
      secretAccessKey:
        provider === 'GOOGLE_CLOUD_STORAGE' && gcsAuthMode === 'SERVICE_ACCOUNT'
          ? undefined
          : secretAccessKey.trim(),
      serviceAccountJson:
        provider === 'GOOGLE_CLOUD_STORAGE' && gcsAuthMode === 'SERVICE_ACCOUNT'
          ? serviceAccountJson.trim()
          : undefined,
      quotaGb: parsedQuota,
      priority: Number.isInteger(parsedPriority) && parsedPriority >= 1 ? parsedPriority : 2,
      isDefault,
    };

    setSubmitting(true);
    try {
      const account = await storageApi.createProvider(payload);
      resetSensitiveFields();
      setAccountName('');
      setAccountIdExternal('');
      setBucketName('');
      setEndpoint('');
      onConnected(account);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bucket verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const usingServiceAccount =
    provider === 'GOOGLE_CLOUD_STORAGE' && gcsAuthMode === 'SERVICE_ACCOUNT';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-provider-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2
              id="connect-provider-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {reconnectAccount ? st.reconnectDrive : st.connectButton}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {modalMode === 'GOOGLE_DRIVE'
                ? 'Connect any Google account via OAuth 2.0 independently of your studio login. Tokens are encrypted with AES-256-GCM.'
                : 'Optional S3 / R2 / GCS bucket credentials are verified live and encrypted with AES-256-GCM.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={st.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Primary Google Drive vs Optional S3/R2 Selector */}
          {!reconnectAccount ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setModalMode('GOOGLE_DRIVE');
                  setError(null);
                }}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3.5 py-3 text-left transition-colors min-h-[44px]',
                  modalMode === 'GOOGLE_DRIVE'
                    ? 'border-red-600 bg-red-50/70 text-slate-900 dark:border-red-500 dark:bg-red-950/30 dark:text-slate-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                )}
              >
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                    Primary · Zero Paid Storage
                  </span>
                  <span className="text-xs font-semibold">Google Drive (OAuth 2.0)</span>
                </div>
                <HardDrive className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalMode('OPTIONAL_OBJECT_STORAGE');
                  setError(null);
                }}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3.5 py-3 text-left transition-colors min-h-[44px]',
                  modalMode === 'OPTIONAL_OBJECT_STORAGE'
                    ? 'border-red-600 bg-red-50/70 text-slate-900 dark:border-red-500 dark:bg-red-950/30 dark:text-slate-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                )}
              >
                <div>
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Optional Extension
                  </span>
                  <span className="text-xs font-semibold">S3 / Cloudflare R2 / GCS</span>
                </div>
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {modalMode === 'GOOGLE_DRIVE' ? (
            <div className="space-y-4">
              {oauthStatus ? (
                <div
                  className={cn(
                    'rounded-xl border p-4 text-xs space-y-3',
                    oauthStatus.configured
                      ? 'border-emerald-200 bg-emerald-50/60 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-200'
                      : 'border-amber-300 bg-amber-50/80 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      {oauthStatus.configured ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <div>
                        <p className="font-semibold">
                          {oauthStatus.configured
                            ? 'Google Drive OAuth 2.0 Backend Configuration Verified'
                            : 'Google OAuth environment configuration is required before connecting a Drive account'}
                        </p>
                        {!oauthStatus.configured && oauthStatus.missingConfigKeys.length > 0 ? (
                          <p className="mt-0.5 text-[11px]">
                            Missing keys:{' '}
                            <span className="font-mono font-semibold">
                              {oauthStatus.missingConfigKeys.join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Diagnostic Checklist */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/80">
                      <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        GOOGLE_CLIENT_ID
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                          oauthStatus.clientIdConfigured && oauthStatus.clientIdValid
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        )}
                      >
                        {oauthStatus.clientIdConfigured && oauthStatus.clientIdValid ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" /> Valid
                          </>
                        ) : oauthStatus.clientIdConfigured ? (
                          <>
                            <XCircle className="h-3 w-3" /> Invalid Format
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3" /> Missing
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/80">
                      <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        GOOGLE_CLIENT_SECRET
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                          oauthStatus.clientSecretConfigured && oauthStatus.clientSecretValid
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        )}
                      >
                        {oauthStatus.clientSecretConfigured && oauthStatus.clientSecretValid ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" /> Configured
                          </>
                        ) : oauthStatus.clientSecretConfigured ? (
                          <>
                            <XCircle className="h-3 w-3" /> Invalid
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3" /> Missing
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/80">
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        Callback URL Resolved
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                          oauthStatus.callbackConfigured && oauthStatus.callbackValid
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        )}
                      >
                        {oauthStatus.callbackConfigured && oauthStatus.callbackValid ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" /> Valid
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3" /> Invalid / Missing
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/80">
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        HTTPS Protocol Check
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                          oauthStatus.callbackUsesHttps
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : oauthStatus.isProduction
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                        )}
                      >
                        {oauthStatus.callbackUsesHttps
                          ? 'HTTPS Active'
                          : oauthStatus.isProduction
                            ? 'HTTPS Required'
                            : 'Local HTTP Dev'}
                      </span>
                    </div>
                  </div>

                  {/* Validation Errors */}
                  {oauthStatus.configErrors.length > 0 ? (
                    <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50/90 p-2.5 text-[11px] text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300">
                      {oauthStatus.configErrors.map((msg) => (
                        <li key={msg} className="leading-relaxed">
                          • {msg}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* Generated Callback URI + Copy Button */}
                  <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-950">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                        Authorized Redirect URI (Google Cloud Console)
                      </span>
                      {oauthStatus.callbackUrl ? (
                        <button
                          type="button"
                          onClick={() => void handleCopyCallbackUrl(oauthStatus.callbackUrl!)}
                          className="inline-flex min-h-[28px] items-center gap-1 rounded border border-slate-300 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {copiedCallback ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {copiedCallback ? 'Copied' : 'Copy Callback URI'}
                        </button>
                      ) : null}
                    </div>
                    <code className="block break-all rounded bg-slate-950 px-2.5 py-2 font-mono text-[11px] text-slate-100">
                      {oauthStatus.callbackUrl ||
                        'Unavailable — configure APP_BASE_URL or GOOGLE_DRIVE_CALLBACK_URL with an HTTPS URL.'}
                    </code>
                  </div>

                  {/* Concise Manual Steps Remaining when incomplete */}
                  {!oauthStatus.configured && oauthStatus.manualStepsRemaining.length > 0 ? (
                    <div className="space-y-1 text-[11px] leading-relaxed">
                      <p className="font-semibold">Remaining Setup Steps:</p>
                      <ol className="list-decimal space-y-0.5 pl-4">
                        {oauthStatus.manualStepsRemaining.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                      <p className="pt-1 opacity-90">
                        On Render, add <span className="font-mono">GOOGLE_CLIENT_ID</span>,{' '}
                        <span className="font-mono">GOOGLE_CLIENT_SECRET</span>, and{' '}
                        <span className="font-mono">GOOGLE_DRIVE_CALLBACK_URL</span> to your{' '}
                        <span className="font-semibold">Backend Web Service</span> (never in Static Site{' '}
                        <span className="font-mono">VITE_*</span> vars) and redeploy.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Drive Label (Optional)
                  </label>
                  <input
                    type="text"
                    value={driveLabel}
                    onChange={(e) => setDriveLabel(e.target.value)}
                    placeholder="e.g. Archive Drive #1"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Auto-Select Priority (1 = first)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={drivePriority}
                    onChange={(e) => setDrivePriority(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <label className="flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={driveIsDefault}
                  onChange={(e) => setDriveIsDefault(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                Set as Default Google Drive destination
              </label>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 space-y-1.5 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  Minimal Least-Privilege Google Scopes
                </p>
                <p className="font-mono text-[11px] break-all">
                  https://www.googleapis.com/auth/drive.file · https://www.googleapis.com/auth/userinfo.email
                </p>
                <p className="leading-relaxed">
                  Only grants access to files and the <span className="font-medium">YouTube Live Automation Studio</span> folder
                  created by this app. Your personal Google Drive files stay private. Quota is shared across Drive, Gmail, and Photos.
                </p>
              </div>

              {oauthWaiting ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                  <span>
                    Complete Google OAuth consent in the popup window. This dialog will update automatically once connected.
                  </span>
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Refresh & access tokens are encrypted server-side.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={submitting}
                    className="min-h-[42px] rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {st.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={submitting || oauthWaiting || (oauthStatus ? !oauthStatus.configured : false)}
                    onClick={() => void handleStartDriveOAuth()}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {submitting || oauthWaiting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Authorizing...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="h-4 w-4" />
                        {reconnectAccount ? st.reconnectDrive : 'Continue with Google Drive'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitOptionalProvider} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Optional Object Storage Provider
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {OPTIONAL_PROVIDERS.map((item) => {
                    const active = provider === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleProviderChange(item.id)}
                        className={cn(
                          'flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors min-h-[44px]',
                          active
                            ? 'border-red-600 bg-red-50/70 text-slate-900 dark:border-red-500 dark:bg-red-950/30 dark:text-slate-100'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700'
                        )}
                      >
                        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {item.badge}
                        </span>
                        <span className="text-xs font-semibold leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Account Label *
                  </label>
                  <input
                    type="text"
                    required
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Secondary Object Bucket"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Bucket Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    placeholder="yt-live-studio-media"
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                {provider === 'CLOUDFLARE_R2' ? (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Cloudflare Account ID *
                    </label>
                    <input
                      type="text"
                      value={accountIdExternal}
                      onChange={(e) => setAccountIdExternal(e.target.value)}
                      placeholder="32-char Cloudflare Account ID"
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Region
                  </label>
                  <input
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder={provider === 'AMAZON_S3' ? 'us-east-1' : 'auto'}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                {provider === 'CLOUDFLARE_R2' || provider === 'S3_COMPATIBLE' ? (
                  <div className={provider === 'S3_COMPATIBLE' ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      {provider === 'S3_COMPATIBLE'
                        ? 'S3-Compatible Endpoint URL *'
                        : 'Custom S3 Endpoint (Optional)'}
                    </label>
                    <input
                      type="url"
                      required={provider === 'S3_COMPATIBLE'}
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder={
                        provider === 'CLOUDFLARE_R2'
                          ? 'https://<account-id>.r2.cloudflarestorage.com'
                          : 'https://s3.us-west-004.backblazeb2.com'
                      }
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                ) : null}
              </div>

              {provider === 'GOOGLE_CLOUD_STORAGE' ? (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    GCS Authentication Method
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setGcsAuthMode('HMAC_S3')}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs font-medium',
                        gcsAuthMode === 'HMAC_S3'
                          ? 'border-red-600 bg-white text-slate-900 dark:border-red-500 dark:bg-slate-900 dark:text-slate-100'
                          : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-800 dark:text-slate-400'
                      )}
                    >
                      HMAC Keys (S3 Interop)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGcsAuthMode('SERVICE_ACCOUNT')}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs font-medium',
                        gcsAuthMode === 'SERVICE_ACCOUNT'
                          ? 'border-red-600 bg-white text-slate-900 dark:border-red-500 dark:bg-slate-900 dark:text-slate-100'
                          : 'border-slate-200 bg-transparent text-slate-600 dark:border-slate-800 dark:text-slate-400'
                      )}
                    >
                      Service Account JSON
                    </button>
                  </div>
                </div>
              ) : null}

              {usingServiceAccount ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      GCS Service Account JSON *
                    </label>
                    <label className="cursor-pointer text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                      Load .json file
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(e) => void handleJsonFileUpload(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <textarea
                    rows={4}
                    required
                    value={serviceAccountJson}
                    onChange={(e) => setServiceAccountJson(e.target.value)}
                    placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
                    className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Access Key ID *
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="off"
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder="Access Key ID"
                      className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Secret Access Key *
                    </label>
                    <div className="relative">
                      <input
                        type={showSecret ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                        placeholder="Secret Access Key"
                        className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white pl-3 pr-10 font-mono text-sm text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                        aria-label={showSecret ? 'Hide secret key' : 'Show secret key'}
                      >
                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    App Quota Limit (GB)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    value={quotaGb}
                    onChange={(e) => setQuotaGb(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Auto-Select Priority (1 = first)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full min-h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex min-h-[42px] w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={(e) => setIsDefault(e.target.checked)}
                      className="h-4 w-4 accent-red-600"
                    />
                    Set as Default Bucket
                  </label>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Secrets never return to the browser after saving.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={submitting}
                    className="min-h-[42px] rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {st.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {st.verifyingAndConnecting}
                      </>
                    ) : (
                      st.verifyAndConnect
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
