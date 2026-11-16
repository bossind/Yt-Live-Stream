import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Info, XCircle } from 'lucide-react';
import type {
  GoogleDriveOAuthStatus,
  StorageActivityRecord,
} from '../../../shared/types/storage';
import { useLanguage } from '../../hooks/useLanguage';
import { cn } from '../../utils/cn';
import { formatDateTime, getProviderLabel } from '../../utils/formatBytes';

interface StorageDiagnosticsSectionProps {
  recentActivity: StorageActivityRecord[];
  googleDriveOAuth?: GoogleDriveOAuthStatus;
}

export function StorageDiagnosticsSection({
  recentActivity,
  googleDriveOAuth,
}: StorageDiagnosticsSectionProps) {
  const { t } = useLanguage();
  const st = t.storage;

  const [tab, setTab] = useState<'activity' | 'oauth' | 'cors'>('activity');
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [copiedCors, setCopiedCors] = useState(false);

  const callbackUrlDisplay = useMemo(() => {
    if (googleDriveOAuth?.callbackUrl) {
      return googleDriveOAuth.callbackUrl;
    }
    if (googleDriveOAuth && !googleDriveOAuth.callbackValid) {
      return 'Unconfigured in production — set APP_BASE_URL or GOOGLE_DRIVE_CALLBACK_URL (HTTPS)';
    }
    if (typeof window !== 'undefined' && window.location.origin) {
      const url = new URL(window.location.origin);
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.protocol === 'http:') {
        url.protocol = 'https:';
      }
      return `${url.origin}/api/v1/storage/google-drive/oauth/callback`;
    }
    return 'https://your-backend-service.onrender.com/api/v1/storage/google-drive/oauth/callback';
  }, [googleDriveOAuth]);

  const authorizedOriginDisplay = useMemo(() => {
    if (googleDriveOAuth?.callbackUrl) {
      try {
        return new URL(googleDriveOAuth.callbackUrl).origin;
      } catch {
        // Fallback below
      }
    }
    if (typeof window !== 'undefined' && window.location.origin) {
      return window.location.origin;
    }
    return 'https://your-frontend-site.onrender.com';
  }, [googleDriveOAuth]);

  const corsPolicyJson = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'https://your-render-service.onrender.com';

    const origins = Array.from(
      new Set([origin, 'https://your-render-service.onrender.com'])
    );

    return JSON.stringify(
      [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['PUT', 'GET', 'HEAD', 'DELETE', 'POST'],
          AllowedHeaders: [
            'Content-Type',
            'Content-Length',
            'Content-Range',
            'x-amz-*',
          ],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
      null,
      2
    );
  }, []);

  const handleCopyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrlDisplay);
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  const handleCopyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(authorizedOriginDisplay);
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCopyCors = async () => {
    try {
      await navigator.clipboard.writeText(corsPolicyJson);
      setCopiedCors(true);
      setTimeout(() => setCopiedCors(false), 2000);
    } catch {
      // Clipboard blocked in some non-HTTPS contexts
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {st.diagnosticsTitle}
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('activity')}
            className={cn(
              'min-h-[36px] rounded-lg border px-3 text-xs font-medium transition-colors',
              tab === 'activity'
                ? 'border-red-600 bg-red-50/70 text-slate-900 dark:border-red-500 dark:bg-red-950/30 dark:text-slate-100'
                : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400'
            )}
          >
            {st.activityTab}
          </button>
          <button
            type="button"
            onClick={() => setTab('oauth')}
            className={cn(
              'min-h-[36px] rounded-lg border px-3 text-xs font-medium transition-colors',
              tab === 'oauth'
                ? 'border-red-600 bg-red-50/70 text-slate-900 dark:border-red-500 dark:bg-red-950/30 dark:text-slate-100'
                : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400'
            )}
          >
            {st.oauthTab}
          </button>
          <button
            type="button"
            onClick={() => setTab('cors')}
            className={cn(
              'min-h-[36px] rounded-lg border px-3 text-xs font-medium transition-colors',
              tab === 'cors'
                ? 'border-red-600 bg-red-50/70 text-slate-900 dark:border-red-500 dark:bg-red-950/30 dark:text-slate-100'
                : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400'
            )}
          >
            {st.corsTab}
          </button>
        </div>
      </div>

      <div className="p-5">
        {tab === 'activity' ? (
          recentActivity.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No storage activity or error logs recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {recentActivity.slice(0, 20).map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {entry.status === 'SUCCESS' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : entry.status === 'ERROR' ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    ) : entry.status === 'WARNING' ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {entry.message}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {entry.eventType}
                        {entry.provider ? ` · ${getProviderLabel(entry.provider)}` : ''}
                        {entry.accountName ? ` · ${entry.accountName}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )
        ) : tab === 'oauth' ? (
          <div className="space-y-5 text-xs text-slate-600 dark:text-slate-400">
            {/* Live Backend Configuration Diagnostics Grid */}
            {googleDriveOAuth ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Backend Google OAuth Diagnostics
                  </p>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold',
                      googleDriveOAuth.configured
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                    )}
                  >
                    {googleDriveOAuth.configured ? 'Ready for OAuth' : 'Action Required'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <span className="block font-mono text-[10px] text-slate-500">GOOGLE_CLIENT_ID</span>
                    <span
                      className={cn(
                        'font-semibold',
                        googleDriveOAuth.clientIdConfigured && googleDriveOAuth.clientIdValid
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {googleDriveOAuth.clientIdConfigured && googleDriveOAuth.clientIdValid
                        ? 'Valid'
                        : googleDriveOAuth.clientIdConfigured
                          ? 'Invalid Format'
                          : 'Missing'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <span className="block font-mono text-[10px] text-slate-500">
                      GOOGLE_CLIENT_SECRET
                    </span>
                    <span
                      className={cn(
                        'font-semibold',
                        googleDriveOAuth.clientSecretConfigured && googleDriveOAuth.clientSecretValid
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {googleDriveOAuth.clientSecretConfigured && googleDriveOAuth.clientSecretValid
                        ? 'Configured (Server)'
                        : googleDriveOAuth.clientSecretConfigured
                          ? 'Invalid'
                          : 'Missing'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <span className="block text-[10px] text-slate-500">Callback URL</span>
                    <span
                      className={cn(
                        'font-semibold',
                        googleDriveOAuth.callbackConfigured && googleDriveOAuth.callbackValid
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {googleDriveOAuth.callbackConfigured && googleDriveOAuth.callbackValid
                        ? 'Valid'
                        : 'Missing / Invalid'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <span className="block text-[10px] text-slate-500">HTTPS Enforcement</span>
                    <span
                      className={cn(
                        'font-semibold',
                        googleDriveOAuth.callbackUsesHttps
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : googleDriveOAuth.isProduction
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-700 dark:text-slate-300'
                      )}
                    >
                      {googleDriveOAuth.callbackUsesHttps
                        ? 'HTTPS Active'
                        : googleDriveOAuth.isProduction
                          ? 'HTTP Rejected'
                          : 'Local HTTP Dev'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <span className="block text-[10px] text-slate-500">Token Vault Key</span>
                    <span
                      className={cn(
                        'font-semibold',
                        googleDriveOAuth.encryptionKeyConfigured
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {googleDriveOAuth.encryptionKeyConfigured ? 'AES-256-GCM Ready' : 'Missing Key'}
                    </span>
                  </div>
                </div>

                {googleDriveOAuth.configErrors.length > 0 ? (
                  <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50/90 p-3 text-[11px] text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300">
                    {googleDriveOAuth.configErrors.map((errMsg) => (
                      <li key={errMsg}>• {errMsg}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {/* Copyable Callback URL & Origin */}
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Authorized Google OAuth Redirect URI
                  </p>
                  <p className="mt-0.5 leading-relaxed">
                    Copy this exact HTTPS callback URL into Google Cloud Console under{' '}
                    <span className="font-medium">
                      Google Auth Platform → Clients → Web Application → Authorized redirect URIs
                    </span>
                    .
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyCallback()}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {copiedCallback ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedCallback ? 'Copied' : 'Copy Callback URI'}
                </button>
              </div>

              <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs text-slate-100 dark:border-slate-800">
                {callbackUrlDisplay}
              </pre>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Authorized JavaScript Origin
                  </p>
                  <p className="mt-0.5 leading-relaxed">
                    Add your backend &amp; frontend HTTPS origins under{' '}
                    <span className="font-medium">Authorized JavaScript origins</span>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyOrigin()}
                  className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {copiedOrigin ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedOrigin ? 'Copied' : 'Copy Origin'}
                </button>
              </div>

              <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs text-slate-100 dark:border-slate-800">
                {authorizedOriginDisplay}
              </pre>
            </div>

            {/* Step-by-step Google Cloud & Render Guide */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-2 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Google Cloud Console Setup (11 Steps)
                </p>
                <ol className="list-decimal space-y-1.5 pl-4 leading-relaxed">
                  <li>Open Google Cloud Console and select your project.</li>
                  <li>
                    Go to <span className="font-medium">APIs &amp; Services → Library</span> and enable{' '}
                    <span className="font-medium">Google Drive API</span>.
                  </li>
                  <li>
                    Open <span className="font-medium">Google Auth Platform</span> (or{' '}
                    <span className="font-medium">OAuth consent screen</span>).
                  </li>
                  <li>Set App Name &amp; Support Email, select <span className="font-medium">External</span> Audience, and finish Branding.</li>
                  <li>
                    Under <span className="font-medium">Data Access / Scopes</span>, verify minimal scopes:{' '}
                    <code className="font-mono text-[11px]">drive.file</code> and{' '}
                    <code className="font-mono text-[11px]">userinfo.email</code>.
                  </li>
                  <li>
                    Go to <span className="font-medium">Clients → Create Client → Web application</span>.
                  </li>
                  <li>
                    Add your HTTPS origins to <span className="font-medium">Authorized JavaScript origins</span>.
                  </li>
                  <li>
                    Add the exact HTTPS Callback URL above to{' '}
                    <span className="font-medium">Authorized redirect URIs</span>.
                  </li>
                  <li>
                    In <span className="font-medium">Audience / Test Users</span>, add every Gmail address you plan to connect while in Testing mode (refresh tokens expire after 7 days until Published).
                  </li>
                  <li>
                    Copy the generated <span className="font-medium">Client ID</span> and{' '}
                    <span className="font-medium">Client Secret</span>.
                  </li>
                  <li>
                    Add them to your Backend Server environment variables (never frontend <code className="font-mono">VITE_*</code>) and restart/redeploy.
                  </li>
                </ol>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Render Backend Web Service Variables
                  </p>
                  <p className="mt-1 leading-relaxed">
                    Add these variables inside <span className="font-medium">Render Dashboard → Web Service (ylas-backend-api) → Environment</span>:
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
{`APP_BASE_URL=https://<your-backend>.onrender.com
GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_DRIVE_CALLBACK_URL=https://<your-backend>.onrender.com/api/v1/storage/google-drive/oauth/callback
GOOGLE_OAUTH_ENCRYPTION_KEY=<64-char-hex-secret>`}
                  </pre>
                </div>
                <p className="leading-relaxed">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Important:
                  </span>{' '}
                  Never place <code className="font-mono">GOOGLE_CLIENT_SECRET</code> in Render Static Site (<code className="font-mono">VITE_*</code>). After saving backend environment variables on Render, trigger a manual redeploy (or wait for auto-redeploy) before retrying Drive connection.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Only required if you connect optional Cloudflare R2 or Amazon S3 buckets. Direct browser uploads must
                allow your exact app origins and expose the <code className="font-mono">ETag</code> header.
              </p>
              <button
                type="button"
                onClick={() => void handleCopyCors()}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copiedCors ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedCors ? 'Copied' : 'Copy CORS JSON'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-slate-100 dark:border-slate-800">
              {corsPolicyJson}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
