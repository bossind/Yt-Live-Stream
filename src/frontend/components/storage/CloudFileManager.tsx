import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileVideo,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { RemoteObjectMetadata, StorageFileRecord } from '../../../shared/types/storage';
import { useLanguage } from '../../hooks/useLanguage';
import { storageApi } from '../../services/storageService';
import { formatBytes, formatDateTime, getProviderLabel } from '../../utils/formatBytes';

interface CloudFileManagerProps {
  files: StorageFileRecord[];
  onRefresh: () => Promise<void>;
}

type SortOrder = 'newest' | 'largest' | 'name';

export function CloudFileManager({ files, onRefresh }: CloudFileManagerProps) {
  const { t } = useLanguage();
  const st = t.storage;

  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [inspectedData, setInspectedData] = useState<{
    file: StorageFileRecord;
    remote: RemoteObjectMetadata;
  } | null>(null);

  const [confirmDeleteFile, setConfirmDeleteFile] = useState<StorageFileRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = files.filter((f) => {
      if (providerFilter !== 'ALL' && f.provider !== providerFilter) return false;
      if (q) {
        return (
          f.fileName.toLowerCase().includes(q) ||
          f.objectKey.toLowerCase().includes(q) ||
          f.accountName.toLowerCase().includes(q) ||
          (f.accountEmail && f.accountEmail.toLowerCase().includes(q)) ||
          (f.externalFileId && f.externalFileId.toLowerCase().includes(q))
        );
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortOrder === 'largest') return b.fileSizeBytes - a.fileSizeBytes;
      if (sortOrder === 'name') return a.fileName.localeCompare(b.fileName);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [files, providerFilter, search, sortOrder]);

  const handleInspect = async (fileId: string) => {
    setInspectingId(fileId);
    setError(null);
    try {
      const data = await storageApi.getFileMetadata(fileId);
      setInspectedData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inspect remote file.');
    } finally {
      setInspectingId(null);
    }
  };

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    setError(null);
    try {
      await storageApi.deleteFile(fileId);
      setConfirmDeleteFile(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file from remote storage.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {st.filesTitle}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {st.filesSubtitle}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={st.searchPlaceholder}
              className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 focus:border-red-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:w-64"
            />
          </div>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="ALL">{st.allProviders}</option>
            <option value="GOOGLE_DRIVE">Google Drive</option>
            <option value="CLOUDFLARE_R2">Cloudflare R2</option>
            <option value="AMAZON_S3">Amazon S3</option>
            <option value="GOOGLE_CLOUD_STORAGE">Google Cloud Storage</option>
            <option value="S3_COMPATIBLE">S3-Compatible</option>
          </select>

          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="newest">{st.sortNewest}</option>
            <option value="largest">{st.sortLargest}</option>
            <option value="name">{st.sortName}</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="mx-5 mt-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[740px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
            <tr>
              <th className="px-5 py-3">{st.colFile}</th>
              <th className="px-4 py-3">{st.colProvider}</th>
              <th className="px-4 py-3">{st.colSize}</th>
              <th className="px-4 py-3">{st.colStrategy}</th>
              <th className="px-4 py-3">{st.colDate}</th>
              <th className="px-4 py-3">{st.colStatus}</th>
              <th className="px-5 py-3 text-right">{st.colActions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredFiles.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <FileVideo className="h-7 w-7 text-slate-400 dark:text-slate-600" />
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      {st.noFilesTitle}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredFiles.map((file) => (
                <tr key={file.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/40">
                  <td className="max-w-[260px] px-5 py-3.5">
                    <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {file.fileName}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {file.externalFileId ? `Drive ID: ${file.externalFileId}` : file.objectKey}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {file.accountName}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {getProviderLabel(file.provider)} · {file.accountEmail || file.bucketName}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-xs tabular-nums text-slate-700 dark:text-slate-300">
                    {formatBytes(file.fileSizeBytes)}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    {file.uploadStrategy}
                  </td>
                  <td className="px-4 py-3.5 text-xs tabular-nums text-slate-600 dark:text-slate-400">
                    {formatDateTime(file.createdAt)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {file.uploadStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={inspectingId === file.id}
                        onClick={() => void handleInspect(file.id)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {inspectingId === file.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        {st.inspectMetadata}
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmDeleteFile(file)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {st.deleteFile}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Live Remote Metadata Inspection Modal */}
      {inspectedData ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Remote File Metadata (Live Verification)
              </h3>
              <button
                type="button"
                onClick={() => setInspectedData(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">File Name</dt>
                <dd className="font-medium text-slate-900 dark:text-slate-100">
                  {inspectedData.file.fileName}
                </dd>
              </div>
              {inspectedData.file.accountEmail ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Google Account</dt>
                  <dd className="font-mono text-slate-700 dark:text-slate-300">
                    {inspectedData.file.accountEmail}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">
                  {inspectedData.file.provider === 'GOOGLE_DRIVE' ? 'Drive File ID' : 'Object Key'}
                </dt>
                <dd className="break-all text-right font-mono text-slate-700 dark:text-slate-300">
                  {inspectedData.remote.externalFileId ||
                    inspectedData.file.externalFileId ||
                    inspectedData.file.objectKey}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Remote Verification</dt>
                <dd
                  className={
                    inspectedData.remote.exists && !inspectedData.remote.trashed
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'font-semibold text-red-600 dark:text-red-400'
                  }
                >
                  {inspectedData.remote.exists
                    ? inspectedData.remote.trashed
                      ? 'In Google Drive Trash'
                      : 'Verified Present'
                    : 'Missing in Remote Storage'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Verified Size</dt>
                <dd className="tabular-nums text-slate-800 dark:text-slate-200">
                  {formatBytes(inspectedData.remote.sizeBytes ?? inspectedData.file.fileSizeBytes)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Content-Type</dt>
                <dd className="font-mono text-slate-700 dark:text-slate-300">
                  {inspectedData.remote.contentType || inspectedData.file.contentType}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">
                  {inspectedData.file.provider === 'GOOGLE_DRIVE' ? 'MD5 Checksum' : 'ETag'}
                </dt>
                <dd className="break-all text-right font-mono text-slate-700 dark:text-slate-300">
                  {inspectedData.remote.md5Checksum ||
                    inspectedData.file.md5Checksum ||
                    inspectedData.remote.etag ||
                    inspectedData.file.etag ||
                    '--'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}

      {/* Confirmed Remote Deletion Modal */}
      {confirmDeleteFile ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Delete "{confirmDeleteFile.fileName}"?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {st.confirmDeleteFile}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => setConfirmDeleteFile(null)}
                className="min-h-[38px] rounded-lg border border-slate-300 px-3.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                {st.cancel}
              </button>
              <button
                type="button"
                disabled={deletingId === confirmDeleteFile.id}
                onClick={() => void handleDelete(confirmDeleteFile.id)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-red-600 px-3.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deletingId === confirmDeleteFile.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {st.deleteFile}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
