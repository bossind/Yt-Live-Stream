import fs from 'node:fs';
import path from 'node:path';
import type {
  CompletedUploadPart,
  StorageAccount,
  StorageActivityRecord,
  StorageFileRecord,
  UploadSessionRecord,
} from '../../shared/types/storage';
import { env } from '../config/env';
import type { EncryptedSecretBlob } from '../crypto/secretVault';
import { getFirebaseAdminState } from '../firebase/admin';

interface LocalDevVaultData {
  accounts: Record<string, StorageAccount>;
  secrets: Record<string, EncryptedSecretBlob>;
  sessions: Record<string, UploadSessionRecord>;
  files: Record<string, StorageFileRecord>;
  activity: StorageActivityRecord[];
}

const LOCAL_STORE_PATH = path.resolve(process.cwd(), '.storage-local-dev.json');

function useFirestorePersistence(): boolean {
  const state = getFirebaseAdminState();
  return Boolean(state.firestore && state.hasFullAdminCredentials);
}

function normalizeAccount(raw: Partial<StorageAccount>): StorageAccount {
  return {
    id: String(raw.id || ''),
    ownerUid: String(raw.ownerUid || ''),
    provider: raw.provider || 'GOOGLE_DRIVE',
    accountName: String(raw.accountName || raw.accountEmail || 'Storage Account'),
    accountEmail: raw.accountEmail ?? null,
    accountDisplayName: raw.accountDisplayName ?? null,
    accountIdExternal: raw.accountIdExternal ?? null,
    driveFolderId: raw.driveFolderId ?? null,
    bucketName: String(raw.bucketName || 'My Drive'),
    region: String(raw.region || 'google-drive'),
    endpoint: raw.endpoint ?? null,
    gcsAuthMode: raw.gcsAuthMode ?? null,
    oauthScopes: Array.isArray(raw.oauthScopes) ? raw.oauthScopes : [],
    tokenStatus:
      raw.tokenStatus || (raw.provider === 'GOOGLE_DRIVE' ? 'VALID' : 'NOT_APPLICABLE'),
    accessKeyPreview: String(raw.accessKeyPreview || raw.accountEmail || ''),
    quotaBytes: Number(raw.quotaBytes ?? 0),
    usedBytes: Number(raw.usedBytes ?? 0),
    reservedBytes: Number(raw.reservedBytes ?? 0),
    measuredUsedBytes: raw.measuredUsedBytes ?? null,
    measuredObjectCount: raw.measuredObjectCount ?? null,
    usageMeasured: Boolean(raw.usageMeasured),
    driveStorageQuota: raw.driveStorageQuota ?? null,
    fileCount: Number(raw.fileCount ?? 0),
    isDefault: Boolean(raw.isDefault),
    priority: Number(raw.priority ?? 1),
    status: raw.status || 'CONNECTED',
    lastConnectedAt: raw.lastConnectedAt ?? raw.createdAt ?? null,
    lastHealthCheckAt: raw.lastHealthCheckAt ?? null,
    lastHealthError: raw.lastHealthError ?? null,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  };
}

function normalizeSession(raw: Partial<UploadSessionRecord>): UploadSessionRecord {
  return {
    id: String(raw.id || ''),
    ownerUid: String(raw.ownerUid || ''),
    accountId: String(raw.accountId || ''),
    accountName: String(raw.accountName || ''),
    accountEmail: raw.accountEmail ?? null,
    provider: raw.provider || 'GOOGLE_DRIVE',
    bucketName: String(raw.bucketName || ''),
    objectKey: String(raw.objectKey || ''),
    uploadId: raw.uploadId ?? null,
    uploadStrategy: raw.uploadStrategy || 'GOOGLE_DRIVE_RESUMABLE',
    resumableSessionUri: raw.resumableSessionUri ?? null,
    fileName: String(raw.fileName || ''),
    fileSizeBytes: Number(raw.fileSizeBytes ?? 0),
    contentType: String(raw.contentType || 'application/octet-stream'),
    lastModified: Number(raw.lastModified ?? 0),
    chunkSizeBytes: Number(raw.chunkSizeBytes ?? 0),
    totalParts: Number(raw.totalParts ?? 1),
    uploadedBytesConfirmed: Number(raw.uploadedBytesConfirmed ?? 0),
    completedParts: Array.isArray(raw.completedParts) ? raw.completedParts : [],
    status: raw.status || 'INITIATED',
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  };
}

function normalizeFile(raw: Partial<StorageFileRecord>): StorageFileRecord {
  return {
    id: String(raw.id || ''),
    ownerUid: String(raw.ownerUid || ''),
    accountId: String(raw.accountId || ''),
    accountName: String(raw.accountName || ''),
    accountEmail: raw.accountEmail ?? null,
    provider: raw.provider || 'GOOGLE_DRIVE',
    bucketName: String(raw.bucketName || ''),
    objectKey: String(raw.objectKey || ''),
    externalFileId: raw.externalFileId ?? null,
    fileName: String(raw.fileName || ''),
    fileSizeBytes: Number(raw.fileSizeBytes ?? 0),
    contentType: String(raw.contentType || 'application/octet-stream'),
    etag: raw.etag ?? null,
    md5Checksum: raw.md5Checksum ?? null,
    uploadStatus: raw.uploadStatus || 'VERIFIED',
    uploadStrategy: raw.uploadStrategy || 'GOOGLE_DRIVE_RESUMABLE',
    uploadSessionId: String(raw.uploadSessionId || ''),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  };
}

function readLocalStore(): LocalDevVaultData {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) {
      return { accounts: {}, secrets: {}, sessions: {}, files: {}, activity: [] };
    }
    const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalDevVaultData>;
    return {
      accounts: parsed.accounts ?? {},
      secrets: parsed.secrets ?? {},
      sessions: parsed.sessions ?? {},
      files: parsed.files ?? {},
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    };
  } catch {
    return { accounts: {}, secrets: {}, sessions: {}, files: {}, activity: [] };
  }
}

function writeLocalStore(data: LocalDevVaultData): void {
  if (env.isProduction) {
    throw new Error(
      'Firestore Admin credentials are required in production for storage persistence.'
    );
  }
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const StorageStore = {
  getPersistenceMode(): 'firestore' | 'local_dev_fallback' {
    return useFirestorePersistence() ? 'firestore' : 'local_dev_fallback';
  },

  async listAccounts(): Promise<StorageAccount[]> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_configs').get();
      return snap.docs
        .map((doc) => normalizeAccount(doc.data() as Partial<StorageAccount>))
        .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
    }

    const store = readLocalStore();
    return Object.values(store.accounts)
      .map(normalizeAccount)
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  },

  async getAccount(accountId: string): Promise<StorageAccount | null> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_configs').doc(accountId).get();
      if (!snap.exists) return null;
      return normalizeAccount(snap.data() as Partial<StorageAccount>);
    }

    const store = readLocalStore();
    const account = store.accounts[accountId];
    return account ? normalizeAccount(account) : null;
  },

  async saveAccount(account: StorageAccount): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await db.collection('storage_configs').doc(account.id).set(account);
      return;
    }

    const store = readLocalStore();
    store.accounts[account.id] = account;
    writeLocalStore(store);
  },

  async deleteAccountAndSecret(accountId: string): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await Promise.all([
        db.collection('storage_configs').doc(accountId).delete(),
        db.collection('storage_provider_secrets').doc(accountId).delete(),
      ]);
      return;
    }

    const store = readLocalStore();
    delete store.accounts[accountId];
    delete store.secrets[accountId];
    writeLocalStore(store);
  },

  async saveSecret(accountId: string, secret: EncryptedSecretBlob): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await db
        .collection('storage_provider_secrets')
        .doc(accountId)
        .set({
          accountId,
          ...secret,
          updatedAt: new Date().toISOString(),
        });
      return;
    }

    const store = readLocalStore();
    store.secrets[accountId] = secret;
    writeLocalStore(store);
  },

  async getSecret(accountId: string): Promise<EncryptedSecretBlob | null> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_provider_secrets').doc(accountId).get();
      if (!snap.exists) return null;
      const data = snap.data() as EncryptedSecretBlob & { accountId?: string };
      return {
        ciphertext: data.ciphertext,
        iv: data.iv,
        authTag: data.authTag,
        keyVersion: data.keyVersion,
      };
    }

    const store = readLocalStore();
    return store.secrets[accountId] ?? null;
  },

  async saveUploadSession(session: UploadSessionRecord): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await db.collection('storage_upload_sessions').doc(session.id).set(session);
      return;
    }

    const store = readLocalStore();
    store.sessions[session.id] = session;
    writeLocalStore(store);
  },

  async getUploadSession(sessionId: string): Promise<UploadSessionRecord | null> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_upload_sessions').doc(sessionId).get();
      if (!snap.exists) return null;
      return normalizeSession(snap.data() as Partial<UploadSessionRecord>);
    }

    const store = readLocalStore();
    const session = store.sessions[sessionId];
    return session ? normalizeSession(session) : null;
  },

  async listActiveUploadSessions(): Promise<UploadSessionRecord[]> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_upload_sessions').get();
      return snap.docs
        .map((doc) => normalizeSession(doc.data() as Partial<UploadSessionRecord>))
        .filter(
          (s) =>
            s.status === 'INITIATED' ||
            s.status === 'IN_PROGRESS' ||
            s.status === 'PAUSED' ||
            s.status === 'FAILED'
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20);
    }

    const store = readLocalStore();
    return Object.values(store.sessions)
      .map(normalizeSession)
      .filter(
        (s) =>
          s.status === 'INITIATED' ||
          s.status === 'IN_PROGRESS' ||
          s.status === 'PAUSED' ||
          s.status === 'FAILED'
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20);
  },

  async appendCompletedPart(
    sessionId: string,
    part: CompletedUploadPart,
    uploadedBytesConfirmed?: number
  ): Promise<UploadSessionRecord | null> {
    const existing = await this.getUploadSession(sessionId);
    if (!existing) return null;
    const filtered = existing.completedParts.filter((p) => p.partNumber !== part.partNumber);
    filtered.push(part);
    filtered.sort((a, b) => a.partNumber - b.partNumber);
    const totalFromParts = filtered.reduce((sum, item) => sum + item.sizeBytes, 0);
    const updated: UploadSessionRecord = {
      ...existing,
      completedParts: filtered,
      uploadedBytesConfirmed: Math.max(
        existing.uploadedBytesConfirmed,
        uploadedBytesConfirmed ?? totalFromParts
      ),
      status: existing.status === 'PAUSED' ? 'PAUSED' : 'IN_PROGRESS',
      updatedAt: new Date().toISOString(),
    };
    await this.saveUploadSession(updated);
    return updated;
  },

  async saveFile(file: StorageFileRecord): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await db.collection('storage_files').doc(file.id).set(file);
      return;
    }

    const store = readLocalStore();
    store.files[file.id] = file;
    writeLocalStore(store);
  },

  async getFile(fileId: string): Promise<StorageFileRecord | null> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_files').doc(fileId).get();
      if (!snap.exists) return null;
      return normalizeFile(snap.data() as Partial<StorageFileRecord>);
    }

    const store = readLocalStore();
    const file = store.files[fileId];
    return file ? normalizeFile(file) : null;
  },

  async listFiles(): Promise<StorageFileRecord[]> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_files').get();
      return snap.docs
        .map((doc) => normalizeFile(doc.data() as Partial<StorageFileRecord>))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const store = readLocalStore();
    return Object.values(store.files)
      .map(normalizeFile)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async deleteFile(fileId: string): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await db.collection('storage_files').doc(fileId).delete();
      return;
    }

    const store = readLocalStore();
    delete store.files[fileId];
    writeLocalStore(store);
  },

  async recordActivity(log: StorageActivityRecord): Promise<void> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      await db.collection('storage_activity_logs').doc(log.id).set(log);
      return;
    }

    const store = readLocalStore();
    store.activity.unshift(log);
    store.activity = store.activity.slice(0, 120);
    writeLocalStore(store);
  },

  async listActivity(limit = 40): Promise<StorageActivityRecord[]> {
    if (useFirestorePersistence()) {
      const db = getFirebaseAdminState().firestore!;
      const snap = await db.collection('storage_activity_logs').get();
      return snap.docs
        .map((doc) => doc.data() as StorageActivityRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    }

    const store = readLocalStore();
    return store.activity
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },
};
