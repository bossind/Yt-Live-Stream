import {
  DRIVE_CHUNK_ALIGNMENT_BYTES,
  type CompletedUploadPart,
  type PresignedPartUrlItem,
  type StorageFileRecord,
  type StorageProviderType,
  type StorageSelectionMode,
  type UploadSessionRecord,
  type UploadStrategy,
  type UploadTuningMode,
} from '../../shared/types/storage';
import { storageApi } from './storageService';

export type ClientUploadStatus =
  | 'PREPARING'
  | 'UPLOADING'
  | 'PAUSED'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED';

export interface ActiveUploadTask {
  localId: string;
  sessionId: string | null;
  accountId: string | null;
  accountName: string | null;
  accountEmail: string | null;
  provider: StorageProviderType | null;
  uploadStrategy: UploadStrategy | null;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
  lastModified: number;
  tuningMode: UploadTuningMode;
  chunkSizeBytes: number;
  concurrency: number;
  totalParts: number;
  completedPartsCount: number;
  uploadedBytes: number;
  progressPercent: number;
  currentSpeedBps: number;
  averageSpeedBps: number;
  etaSeconds: number | null;
  retryCount: number;
  status: ClientUploadStatus;
  errorMessage: string | null;
  completedFile: StorageFileRecord | null;
}

export interface StartUploadOptions {
  file: File;
  selectionMode: StorageSelectionMode;
  accountId?: string;
  tuningMode: UploadTuningMode;
  manualChunkSizeMb?: number;
  manualConcurrency?: number;
  onUpdate: (task: ActiveUploadTask) => void;
  onComplete?: (file: StorageFileRecord) => void;
}

export interface ResumableLocalDescriptor {
  sessionId: string;
  fileName: string;
  fileSizeBytes: number;
  lastModified: number;
  accountName: string;
  provider: StorageProviderType;
  updatedAt: string;
}

const LOCAL_RESUMABLE_KEY = 'ylas_resumable_uploads_v1';
const MAX_PART_RETRIES = 3;

export function saveResumableDescriptor(session: UploadSessionRecord): void {
  try {
    const existing = loadResumableDescriptors().filter((d) => d.sessionId !== session.id);
    existing.unshift({
      sessionId: session.id,
      fileName: session.fileName,
      fileSizeBytes: session.fileSizeBytes,
      lastModified: session.lastModified,
      accountName: session.accountName,
      provider: session.provider,
      updatedAt: session.updatedAt,
    });
    window.localStorage.setItem(LOCAL_RESUMABLE_KEY, JSON.stringify(existing.slice(0, 20)));
  } catch {
    // Ignore localStorage quota issues
  }
}

export function removeResumableDescriptor(sessionId: string): void {
  try {
    const filtered = loadResumableDescriptors().filter((d) => d.sessionId !== sessionId);
    window.localStorage.setItem(LOCAL_RESUMABLE_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore
  }
}

export function loadResumableDescriptors(): ResumableLocalDescriptor[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_RESUMABLE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ResumableLocalDescriptor[]) : [];
  } catch {
    return [];
  }
}

function getAdaptiveBaseConcurrency(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(2, Math.min(4, Math.floor(cores / 2)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanEtag(raw: string | null): string {
  if (!raw) return '';
  return raw.trim();
}

function parseConfirmedRangeEnd(rangeHeader: string | null): number | null {
  if (!rangeHeader) return null;
  const match = /bytes=0-(\d+)/i.exec(rangeHeader);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed + 1 : null;
}

export class DirectUploadController {
  private file: File;
  private task: ActiveUploadTask;
  private onUpdate: (task: ActiveUploadTask) => void;
  private onComplete?: (file: StorageFileRecord) => void;

  private activeXhrs = new Set<XMLHttpRequest>();
  private inFlightLoaded = new Map<number, number>();
  private completedParts = new Map<number, CompletedUploadPart>();
  private urlCache = new Map<number, PresignedPartUrlItem>();
  private singlePutUrl: string | null = null;
  private resumableSessionUri: string | null = null;
  private confirmedOffsetBytes = 0;
  private externalFileId: string | null = null;

  private paused = false;
  private aborted = false;
  private startedAtMs = 0;
  private speedSamples: Array<{ ts: number; bytes: number }> = [];
  private currentConcurrency: number;
  private singlePutEtag: string | null = null;

  constructor(options: StartUploadOptions, existingTask?: Partial<ActiveUploadTask>) {
    this.file = options.file;
    this.onUpdate = options.onUpdate;
    this.onComplete = options.onComplete;

    const initialConcurrency =
      options.tuningMode === 'ADVANCED'
        ? Math.max(1, Math.min(8, options.manualConcurrency ?? 3))
        : getAdaptiveBaseConcurrency();
    this.currentConcurrency = initialConcurrency;

    this.task = {
      localId:
        existingTask?.localId || `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: existingTask?.sessionId ?? null,
      accountId: existingTask?.accountId ?? null,
      accountName: existingTask?.accountName ?? null,
      accountEmail: existingTask?.accountEmail ?? null,
      provider: existingTask?.provider ?? null,
      uploadStrategy: existingTask?.uploadStrategy ?? null,
      fileName: options.file.name,
      fileSizeBytes: options.file.size,
      contentType: options.file.type || 'application/octet-stream',
      lastModified: options.file.lastModified,
      tuningMode: options.tuningMode,
      chunkSizeBytes:
        options.tuningMode === 'ADVANCED' && options.manualChunkSizeMb
          ? options.manualChunkSizeMb * 1024 * 1024
          : 0,
      concurrency: initialConcurrency,
      totalParts: existingTask?.totalParts ?? 1,
      completedPartsCount: existingTask?.completedPartsCount ?? 0,
      uploadedBytes: existingTask?.uploadedBytes ?? 0,
      progressPercent: existingTask?.progressPercent ?? 0,
      currentSpeedBps: 0,
      averageSpeedBps: 0,
      etaSeconds: null,
      retryCount: existingTask?.retryCount ?? 0,
      status: 'PREPARING',
      errorMessage: null,
      completedFile: null,
    };
  }

  public getSnapshot(): ActiveUploadTask {
    return { ...this.task };
  }

  private emitUpdate(patch?: Partial<ActiveUploadTask>): void {
    if (patch) {
      this.task = { ...this.task, ...patch };
    }
    this.onUpdate({ ...this.task });
  }

  private recalculateProgress(): void {
    let completedBytes = 0;
    if (this.task.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE') {
      completedBytes = this.confirmedOffsetBytes;
    } else {
      for (const part of this.completedParts.values()) {
        completedBytes += part.sizeBytes;
      }
    }

    let inFlightBytes = 0;
    for (const loaded of this.inFlightLoaded.values()) {
      inFlightBytes += loaded;
    }

    const totalLoaded = Math.min(this.file.size, completedBytes + inFlightBytes);
    const now = Date.now();
    this.speedSamples.push({ ts: now, bytes: totalLoaded });
    const cutoff = now - 2500;
    while (this.speedSamples.length > 2 && this.speedSamples[0].ts < cutoff) {
      this.speedSamples.shift();
    }

    let currentSpeedBps = 0;
    if (this.speedSamples.length >= 2) {
      const oldest = this.speedSamples[0];
      const dt = (now - oldest.ts) / 1000;
      const db = Math.max(0, totalLoaded - oldest.bytes);
      if (dt > 0.15) {
        currentSpeedBps = db / dt;
      }
    }

    const elapsedSec = Math.max(0.25, (now - this.startedAtMs) / 1000);
    const averageSpeedBps = totalLoaded / elapsedSec;
    const speedForEta = currentSpeedBps > 0 ? currentSpeedBps : averageSpeedBps;
    const remaining = Math.max(0, this.file.size - totalLoaded);
    const etaSeconds = speedForEta > 1024 ? remaining / speedForEta : null;
    const progressPercent =
      this.file.size > 0
        ? Math.min(100, Number(((totalLoaded / this.file.size) * 100).toFixed(1)))
        : 0;

    const computedCompletedParts =
      this.task.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE' && this.task.chunkSizeBytes > 0
        ? Math.min(
            this.task.totalParts,
            Math.floor(this.confirmedOffsetBytes / this.task.chunkSizeBytes) +
              (this.confirmedOffsetBytes >= this.file.size ? 1 : 0)
          )
        : this.completedParts.size;

    this.emitUpdate({
      uploadedBytes: totalLoaded,
      progressPercent,
      currentSpeedBps,
      averageSpeedBps,
      etaSeconds,
      completedPartsCount: computedCompletedParts,
      concurrency: this.currentConcurrency,
    });
  }

  public async startNew(selectionMode: StorageSelectionMode, accountId?: string): Promise<void> {
    this.paused = false;
    this.aborted = false;
    this.confirmedOffsetBytes = 0;
    this.externalFileId = null;
    this.startedAtMs = Date.now();
    this.speedSamples = [{ ts: this.startedAtMs, bytes: 0 }];
    this.emitUpdate({ status: 'PREPARING', errorMessage: null });

    try {
      const preferredAligned =
        this.task.tuningMode === 'ADVANCED' && this.task.chunkSizeBytes >= DRIVE_CHUNK_ALIGNMENT_BYTES
          ? Math.round(this.task.chunkSizeBytes / DRIVE_CHUNK_ALIGNMENT_BYTES) *
            DRIVE_CHUNK_ALIGNMENT_BYTES
          : undefined;

      const init = await storageApi.initiateUpload({
        selectionMode,
        accountId,
        fileName: this.file.name,
        fileSizeBytes: this.file.size,
        contentType: this.file.type || 'application/octet-stream',
        lastModified: this.file.lastModified,
        preferredChunkSizeBytes: preferredAligned,
      });

      const session = init.session;
      saveResumableDescriptor(session);

      this.singlePutUrl = init.presignedPutUrl ?? null;
      this.resumableSessionUri = init.resumableSessionUri || session.resumableSessionUri;
      for (const item of init.partUrls || []) {
        this.urlCache.set(item.partNumber, item);
      }

      this.emitUpdate({
        sessionId: session.id,
        accountId: init.selectedAccount.id,
        accountName: init.selectedAccount.accountName,
        accountEmail: init.selectedAccount.accountEmail,
        provider: init.selectedAccount.provider,
        uploadStrategy: session.uploadStrategy,
        chunkSizeBytes: session.chunkSizeBytes,
        totalParts: session.totalParts,
        status: 'UPLOADING',
      });

      await this.runUploadLoop(session);
    } catch (err) {
      if (this.paused || this.aborted) return;
      const msg = err instanceof Error ? err.message : 'Failed to initiate upload.';
      this.emitUpdate({
        status: 'FAILED',
        currentSpeedBps: 0,
        etaSeconds: null,
        errorMessage: msg,
      });
    }
  }

  public async resumeFromSession(sessionId: string): Promise<void> {
    this.paused = false;
    this.aborted = false;
    this.startedAtMs = Date.now();
    this.speedSamples = [{ ts: this.startedAtMs, bytes: 0 }];
    this.emitUpdate({ status: 'PREPARING', errorMessage: null, sessionId });

    try {
      const resumed = await storageApi.resumeUpload(sessionId);
      const session = resumed.session;

      if (
        session.fileSizeBytes !== this.file.size ||
        (session.lastModified > 0 &&
          this.file.lastModified > 0 &&
          session.lastModified !== this.file.lastModified &&
          session.fileName !== this.file.name)
      ) {
        throw new Error(
          `Selected file does not match original upload "${session.fileName}" (${session.fileSizeBytes} bytes).`
        );
      }

      saveResumableDescriptor(session);
      this.completedParts.clear();
      for (const part of session.completedParts) {
        this.completedParts.set(part.partNumber, part);
      }
      this.singlePutUrl = resumed.presignedPutUrl ?? null;
      this.resumableSessionUri =
        resumed.resumableSessionUri || session.resumableSessionUri;
      this.confirmedOffsetBytes =
        resumed.uploadedBytesConfirmed ?? session.uploadedBytesConfirmed ?? 0;

      for (const item of resumed.partUrls || []) {
        this.urlCache.set(item.partNumber, item);
      }

      this.emitUpdate({
        sessionId: session.id,
        accountId: resumed.account.id,
        accountName: resumed.account.accountName,
        accountEmail: resumed.account.accountEmail,
        provider: resumed.account.provider,
        uploadStrategy: session.uploadStrategy,
        chunkSizeBytes: session.chunkSizeBytes,
        totalParts: session.totalParts,
        completedPartsCount: this.completedParts.size,
        status: 'UPLOADING',
      });
      this.recalculateProgress();

      await this.runUploadLoop(session);
    } catch (err) {
      if (this.paused || this.aborted) return;
      const msg = err instanceof Error ? err.message : 'Failed to resume upload session.';
      this.emitUpdate({
        status: 'FAILED',
        currentSpeedBps: 0,
        etaSeconds: null,
        errorMessage: msg,
      });
    }
  }

  public async pause(): Promise<void> {
    if (this.task.status !== 'UPLOADING' && this.task.status !== 'PREPARING') return;
    this.paused = true;
    for (const xhr of this.activeXhrs) {
      xhr.abort();
    }
    this.activeXhrs.clear();
    this.inFlightLoaded.clear();

    if (this.task.sessionId) {
      await storageApi.setUploadPaused(this.task.sessionId, true).catch(() => {});
    }

    this.emitUpdate({
      status: 'PAUSED',
      currentSpeedBps: 0,
      etaSeconds: null,
    });
  }

  public async resume(): Promise<void> {
    if (this.task.status !== 'PAUSED' && this.task.status !== 'FAILED') return;
    if (!this.task.sessionId) {
      this.emitUpdate({ status: 'FAILED', errorMessage: 'Missing upload session ID.' });
      return;
    }
    await this.resumeFromSession(this.task.sessionId);
  }

  public async cancel(): Promise<void> {
    this.aborted = true;
    this.paused = false;
    for (const xhr of this.activeXhrs) {
      xhr.abort();
    }
    this.activeXhrs.clear();
    this.inFlightLoaded.clear();

    if (this.task.sessionId) {
      await storageApi.abortUpload(this.task.sessionId).catch(() => {});
      removeResumableDescriptor(this.task.sessionId);
    }

    this.emitUpdate({
      status: 'ABORTED',
      currentSpeedBps: 0,
      etaSeconds: null,
    });
  }

  private async ensurePartUrls(sessionId: string, neededParts: number[]): Promise<void> {
    const now = Date.now();
    const missing = neededParts.filter((partNo) => {
      const cached = this.urlCache.get(partNo);
      if (!cached) return true;
      const exp = new Date(cached.expiresAt).getTime();
      return Number.isNaN(exp) || exp - now < 60_000;
    });

    if (missing.length === 0) return;

    const batch = missing.slice(0, 20);
    const res = await storageApi.getPartUrls(sessionId, batch);
    for (const item of res.partUrls) {
      this.urlCache.set(item.partNumber, item);
    }
  }

  private async runUploadLoop(session: UploadSessionRecord): Promise<void> {
    if (session.uploadStrategy === 'GOOGLE_DRIVE_RESUMABLE') {
      await this.executeGoogleDriveResumable(session);
    } else if (session.uploadStrategy === 'SINGLE_PUT') {
      await this.executeSinglePut(session);
    } else if (session.uploadStrategy === 'GCS_RESUMABLE') {
      await this.executeGcsResumable(session);
    } else {
      await this.executeMultipart(session);
    }

    if (this.paused || this.aborted) return;

    this.emitUpdate({ status: 'FINALIZING', currentSpeedBps: 0, etaSeconds: 0 });
    const partsArray = Array.from(this.completedParts.values()).sort(
      (a, b) => a.partNumber - b.partNumber
    );
    const fileRecord = await storageApi.completeUpload(session.id, {
      parts: session.uploadStrategy === 'MULTIPART' ? partsArray : undefined,
      etag: this.singlePutEtag,
      externalFileId: this.externalFileId,
    });

    removeResumableDescriptor(session.id);
    this.emitUpdate({
      status: 'COMPLETED',
      uploadedBytes: fileRecord.fileSizeBytes,
      progressPercent: 100,
      currentSpeedBps: 0,
      etaSeconds: 0,
      completedFile: fileRecord,
    });
    this.onComplete?.(fileRecord);
  }

  private async executeGoogleDriveResumable(session: UploadSessionRecord): Promise<void> {
    if (!this.resumableSessionUri) {
      throw new Error('Missing Google Drive resumable upload session URI.');
    }

    let nextByte = this.confirmedOffsetBytes;
    const chunkSize = Math.max(
      DRIVE_CHUNK_ALIGNMENT_BYTES,
      Math.round((session.chunkSizeBytes || 8 * 1024 * 1024) / DRIVE_CHUNK_ALIGNMENT_BYTES) *
        DRIVE_CHUNK_ALIGNMENT_BYTES
    );

    let chunkIndex = Math.floor(nextByte / chunkSize) + 1;

    while (nextByte < this.file.size && !this.paused && !this.aborted) {
      const endByte = Math.min(this.file.size, nextByte + chunkSize);
      const blob = this.file.slice(nextByte, endByte);
      const chunkLen = endByte - nextByte;
      const contentRange = `bytes ${nextByte}-${endByte - 1}/${this.file.size}`;

      let attempt = 0;
      let chunkDone = false;

      while (attempt < MAX_PART_RETRIES && !this.paused && !this.aborted) {
        try {
          const res = await this.xhrPut({
            url: this.resumableSessionUri,
            blob,
            partNumber: chunkIndex,
            contentType: session.contentType || 'application/octet-stream',
            extraHeaders: { 'Content-Range': contentRange },
            allowStatus308: true,
          });

          if (res.status === 200 || res.status === 201) {
            if (res.responseText) {
              try {
                const json = JSON.parse(res.responseText) as { id?: string };
                if (json.id) {
                  this.externalFileId = json.id;
                }
              } catch {
                // Backend /complete probes Drive URI if JSON wasn't readable
              }
            }
            this.confirmedOffsetBytes = this.file.size;
            nextByte = this.file.size;
          } else {
            const rangeConfirmed = parseConfirmedRangeEnd(res.rangeHeader);
            this.confirmedOffsetBytes = rangeConfirmed ?? endByte;
            nextByte = this.confirmedOffsetBytes;
          }

          this.inFlightLoaded.delete(chunkIndex);
          await storageApi
            .recordPartProgress(session.id, {
              partNumber: chunkIndex,
              etag: `drive-offset-${nextByte}`,
              sizeBytes: chunkLen,
              uploadedBytesConfirmed: this.confirmedOffsetBytes,
            })
            .catch(() => {});

          this.recalculateProgress();
          chunkDone = true;
          break;
        } catch (err) {
          if (this.paused || this.aborted) return;
          const errMsg = err instanceof Error ? err.message : '';
          if (errMsg.includes('HTTP 404') || errMsg.includes('HTTP 410')) {
            throw new Error(
              'Google Drive resumable upload session expired. Please cancel and start a new upload.'
            );
          }

          attempt += 1;
          this.inFlightLoaded.delete(chunkIndex);
          this.emitUpdate({ retryCount: this.task.retryCount + 1 });
          if (attempt >= MAX_PART_RETRIES) throw err;

          // Re-query authoritative Drive byte offset on retry
          try {
            const probe = await storageApi.resumeUpload(session.id);
            this.confirmedOffsetBytes = probe.uploadedBytesConfirmed;
            nextByte = probe.uploadedBytesConfirmed;
          } catch {
            // Continue with backoff if probe also fails temporarily
          }
          await sleep(700 * Math.pow(2, attempt - 1));
        }
      }

      if (!chunkDone) return;
      chunkIndex += 1;
    }
  }

  private async executeSinglePut(session: UploadSessionRecord): Promise<void> {
    if (!this.singlePutUrl) {
      const resumed = await storageApi.resumeUpload(session.id);
      this.singlePutUrl = resumed.presignedPutUrl ?? null;
    }
    if (!this.singlePutUrl) {
      throw new Error('Missing presigned PUT URL for single-part upload.');
    }

    let attempt = 0;
    while (attempt < MAX_PART_RETRIES) {
      if (this.paused || this.aborted) return;
      try {
        const res = await this.xhrPut({
          url: this.singlePutUrl,
          blob: this.file,
          partNumber: 1,
          contentType: session.contentType,
        });
        this.singlePutEtag = res.etag;
        this.completedParts.set(1, {
          partNumber: 1,
          etag: res.etag || 'single-put',
          sizeBytes: this.file.size,
        });
        this.recalculateProgress();
        return;
      } catch (err) {
        if (this.paused || this.aborted) return;
        attempt += 1;
        this.emitUpdate({ retryCount: this.task.retryCount + 1 });
        if (attempt >= MAX_PART_RETRIES) throw err;
        await sleep(500 * Math.pow(2, attempt - 1));
      }
    }
  }

  private async executeMultipart(session: UploadSessionRecord): Promise<void> {
    const pendingQueue: number[] = [];
    for (let p = 1; p <= session.totalParts; p += 1) {
      if (!this.completedParts.has(p)) {
        pendingQueue.push(p);
      }
    }

    let queueCursor = 0;
    let fatalError: Error | null = null;
    let consecutiveFastParts = 0;

    const getNextPart = (): number | null => {
      if (queueCursor >= pendingQueue.length) return null;
      const next = pendingQueue[queueCursor];
      queueCursor += 1;
      return next;
    };

    const worker = async (): Promise<void> => {
      while (!this.paused && !this.aborted && !fatalError) {
        const partNumber = getNextPart();
        if (partNumber === null) return;

        const startByte = (partNumber - 1) * session.chunkSizeBytes;
        const endByte = Math.min(this.file.size, startByte + session.chunkSizeBytes);
        const blob = this.file.slice(startByte, endByte);
        const partSize = endByte - startByte;

        let attempt = 0;
        let uploaded = false;
        const partStartTime = Date.now();

        while (attempt < MAX_PART_RETRIES && !this.paused && !this.aborted) {
          try {
            await this.ensurePartUrls(session.id, [
              partNumber,
              ...pendingQueue.slice(queueCursor, queueCursor + 10),
            ]);
            const target = this.urlCache.get(partNumber);
            if (!target) {
              throw new Error(`Missing presigned URL for part ${partNumber}.`);
            }

            const putRes = await this.xhrPut({
              url: target.url,
              blob,
              partNumber,
            });

            const etag = cleanEtag(putRes.etag);
            if (!etag) {
              throw new Error(
                'Upload succeeded but browser could not read ETag header. Ensure bucket CORS exposes "ETag".'
              );
            }

            const completedPart: CompletedUploadPart = {
              partNumber,
              etag,
              sizeBytes: partSize,
            };
            this.completedParts.set(partNumber, completedPart);
            this.inFlightLoaded.delete(partNumber);

            await storageApi.recordPartProgress(session.id, completedPart).catch(() => {});
            this.recalculateProgress();

            if (this.task.tuningMode === 'AUTO') {
              const elapsedSec = (Date.now() - partStartTime) / 1000;
              const partThroughput = partSize / Math.max(0.1, elapsedSec);
              if (partThroughput > 4 * 1024 * 1024) {
                consecutiveFastParts += 1;
                if (consecutiveFastParts >= 3 && this.currentConcurrency < 6) {
                  this.currentConcurrency += 1;
                  consecutiveFastParts = 0;
                }
              }
            }

            uploaded = true;
            break;
          } catch (err) {
            if (this.paused || this.aborted) return;
            attempt += 1;
            this.inFlightLoaded.delete(partNumber);
            this.urlCache.delete(partNumber);
            this.emitUpdate({ retryCount: this.task.retryCount + 1 });

            if (this.task.tuningMode === 'AUTO' && this.currentConcurrency > 2) {
              this.currentConcurrency -= 1;
              consecutiveFastParts = 0;
            }

            if (attempt >= MAX_PART_RETRIES) {
              fatalError =
                err instanceof Error ? err : new Error(`Part ${partNumber} failed after retries.`);
              return;
            }
            await sleep(600 * Math.pow(2, attempt - 1));
          }
        }

        if (!uploaded && !this.paused && !this.aborted && !fatalError) {
          fatalError = new Error(`Part ${partNumber} did not complete.`);
          return;
        }
      }
    };

    const maxWorkers =
      this.task.tuningMode === 'ADVANCED'
        ? this.currentConcurrency
        : Math.max(this.currentConcurrency, 6);

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(maxWorkers, Math.max(1, pendingQueue.length)); i += 1) {
      workers.push(
        (async () => {
          while (i >= this.currentConcurrency && !this.paused && !this.aborted && !fatalError) {
            if (queueCursor >= pendingQueue.length) return;
            await sleep(250);
          }
          await worker();
        })()
      );
    }

    await Promise.all(workers);
    if (fatalError) {
      throw fatalError;
    }
  }

  private async executeGcsResumable(session: UploadSessionRecord): Promise<void> {
    if (!this.resumableSessionUri) {
      throw new Error('Missing Google Cloud Storage resumable session URI.');
    }

    let nextByte = 0;
    for (const part of this.completedParts.values()) {
      nextByte += part.sizeBytes;
    }

    let partIndex = this.completedParts.size + 1;
    while (nextByte < this.file.size && !this.paused && !this.aborted) {
      const endByte = Math.min(this.file.size, nextByte + session.chunkSizeBytes);
      const blob = this.file.slice(nextByte, endByte);
      const chunkLen = endByte - nextByte;
      const contentRange = `bytes ${nextByte}-${endByte - 1}/${this.file.size}`;

      let attempt = 0;
      let chunkDone = false;
      while (attempt < MAX_PART_RETRIES && !this.paused && !this.aborted) {
        try {
          const res = await this.xhrPut({
            url: this.resumableSessionUri,
            blob,
            partNumber: partIndex,
            contentType: session.contentType,
            extraHeaders: { 'Content-Range': contentRange },
            allowStatus308: true,
          });
          const completedPart: CompletedUploadPart = {
            partNumber: partIndex,
            etag: res.etag || `gcs-chunk-${partIndex}`,
            sizeBytes: chunkLen,
          };
          this.completedParts.set(partIndex, completedPart);
          this.inFlightLoaded.delete(partIndex);
          await storageApi.recordPartProgress(session.id, completedPart).catch(() => {});
          this.recalculateProgress();
          chunkDone = true;
          break;
        } catch (err) {
          if (this.paused || this.aborted) return;
          attempt += 1;
          this.inFlightLoaded.delete(partIndex);
          this.emitUpdate({ retryCount: this.task.retryCount + 1 });
          if (attempt >= MAX_PART_RETRIES) throw err;
          await sleep(600 * Math.pow(2, attempt - 1));
        }
      }

      if (!chunkDone) return;
      nextByte = endByte;
      partIndex += 1;
    }
  }

  private xhrPut(params: {
    url: string;
    blob: Blob;
    partNumber: number;
    contentType?: string;
    extraHeaders?: Record<string, string>;
    allowStatus308?: boolean;
  }): Promise<{
    etag: string | null;
    rangeHeader: string | null;
    responseText: string;
    status: number;
  }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.activeXhrs.add(xhr);

      xhr.open('PUT', params.url, true);
      if (params.contentType) {
        xhr.setRequestHeader('Content-Type', params.contentType);
      }
      if (params.extraHeaders) {
        for (const [k, v] of Object.entries(params.extraHeaders)) {
          xhr.setRequestHeader(k, v);
        }
      }

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          this.inFlightLoaded.set(params.partNumber, evt.loaded);
          this.recalculateProgress();
        }
      };

      xhr.onload = () => {
        this.activeXhrs.delete(xhr);
        this.inFlightLoaded.delete(params.partNumber);
        const ok =
          (xhr.status >= 200 && xhr.status < 300) ||
          (Boolean(params.allowStatus308) && xhr.status === 308);
        if (ok) {
          const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
          const rangeHeader = xhr.getResponseHeader('Range') || xhr.getResponseHeader('range');
          resolve({
            etag,
            rangeHeader,
            responseText: xhr.responseText || '',
            status: xhr.status,
          });
        } else {
          reject(new Error(`Storage provider returned HTTP ${xhr.status} during direct upload.`));
        }
      };

      xhr.onerror = () => {
        this.activeXhrs.delete(xhr);
        this.inFlightLoaded.delete(params.partNumber);
        reject(
          new Error(
            'Direct browser upload network/CORS error. Verify connection stability and allowed origin.'
          )
        );
      };

      xhr.onabort = () => {
        this.activeXhrs.delete(xhr);
        this.inFlightLoaded.delete(params.partNumber);
        reject(new Error('Upload aborted.'));
      };

      xhr.send(params.blob);
    });
  }
}
