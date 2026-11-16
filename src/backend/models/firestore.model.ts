import fs from 'node:fs';
import path from 'node:path';
import { FieldValue } from 'firebase-admin/firestore';
import { env } from '../config/env';
import { getFirebaseAdminState } from '../firebase/admin';

export interface FirestoreAdminRecord {
  uid: string;
  email: string;
  displayName?: string | null;
  role: 'ADMIN';
  isPrimaryOwner?: boolean;
  active: boolean;
}

export interface FirestoreAllowlistDoc {
  email: string;
  displayName: string | null;
  isPrimaryOwner: boolean;
  active: boolean;
  addedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'GOOGLE_LOGIN_SUCCESS'
  | 'AUTH_REJECTED'
  | 'LOGOUT'
  | 'ADMIN_INITIALIZED'
  | 'ADMIN_ALLOWLIST_ADDED'
  | 'ADMIN_ALLOWLIST_REVOKED';

interface LocalDevAuthData {
  allowlist: Record<string, FirestoreAllowlistDoc>;
  admins: Record<string, FirestoreAdminRecord>;
}

const LOCAL_AUTH_STORE_PATH = path.resolve(process.cwd(), '.auth-allowlist-dev.json');

export function toAllowlistDocId(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), 'utf8').toString('base64url');
}

function readLocalAuthStore(): LocalDevAuthData {
  try {
    if (!fs.existsSync(LOCAL_AUTH_STORE_PATH)) {
      return { allowlist: {}, admins: {} };
    }
    const raw = fs.readFileSync(LOCAL_AUTH_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalDevAuthData>;
    return {
      allowlist: parsed.allowlist ?? {},
      admins: parsed.admins ?? {},
    };
  } catch {
    return { allowlist: {}, admins: {} };
  }
}

function writeLocalAuthStore(data: LocalDevAuthData): void {
  if (env.isProduction) {
    throw new Error('Firestore Admin credentials are required in production for allowlist persistence.');
  }
  fs.writeFileSync(LOCAL_AUTH_STORE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const FirestoreModel = {
  async getAdminRecord(uid: string): Promise<FirestoreAdminRecord | null> {
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      const local = readLocalAuthStore();
      return local.admins[uid] ?? null;
    }

    const snap = await state.firestore.collection('admins').doc(uid).get();
    if (!snap.exists) {
      return null;
    }
    const data = snap.data() as Partial<FirestoreAdminRecord> | undefined;
    if (!data || !data.email || data.role !== 'ADMIN') {
      return null;
    }
    return {
      uid: snap.id,
      email: data.email.toLowerCase(),
      displayName: data.displayName ?? null,
      role: 'ADMIN',
      isPrimaryOwner: Boolean(data.isPrimaryOwner),
      active: Boolean(data.active),
    };
  },

  async listAdmins(): Promise<FirestoreAdminRecord[]> {
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      const local = readLocalAuthStore();
      return Object.values(local.admins);
    }

    const snap = await state.firestore.collection('admins').get();
    const results: FirestoreAdminRecord[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as Partial<FirestoreAdminRecord>;
      if (!data.email || data.role !== 'ADMIN') continue;
      results.push({
        uid: doc.id,
        email: data.email.toLowerCase(),
        displayName: data.displayName ?? null,
        role: 'ADMIN',
        isPrimaryOwner: Boolean(data.isPrimaryOwner),
        active: Boolean(data.active),
      });
    }
    return results;
  },

  async upsertVerifiedAdminUser(params: {
    uid: string;
    email: string;
    displayName?: string | null;
    isPrimaryOwner: boolean;
  }): Promise<void> {
    const normalizedEmail = params.email.trim().toLowerCase();
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      if (!env.isProduction) {
        const local = readLocalAuthStore();
        local.admins[params.uid] = {
          uid: params.uid,
          email: normalizedEmail,
          displayName: params.displayName ?? null,
          role: 'ADMIN',
          isPrimaryOwner: params.isPrimaryOwner,
          active: true,
        };
        writeLocalAuthStore(local);
      }
      return;
    }

    await state.firestore
      .collection('admins')
      .doc(params.uid)
      .set(
        {
          uid: params.uid,
          email: normalizedEmail,
          displayName: params.displayName ?? null,
          role: 'ADMIN',
          isPrimaryOwner: params.isPrimaryOwner,
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  },

  async deactivateAdminsByEmail(email: string): Promise<string[]> {
    const normalizedEmail = email.trim().toLowerCase();
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      if (!env.isProduction) {
        const local = readLocalAuthStore();
        const revokedUids: string[] = [];
        for (const [uid, rec] of Object.entries(local.admins)) {
          if (rec.email.toLowerCase() === normalizedEmail) {
            local.admins[uid] = { ...rec, active: false };
            revokedUids.push(uid);
          }
        }
        writeLocalAuthStore(local);
        return revokedUids;
      }
      return [];
    }

    const snap = await state.firestore
      .collection('admins')
      .where('email', '==', normalizedEmail)
      .get();
    const uids: string[] = [];
    for (const docSnap of snap.docs) {
      uids.push(docSnap.id);
      await docSnap.ref.set(
        { active: false, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    return uids;
  },

  async hasAnyActiveAdmin(): Promise<boolean> {
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      return env.isAdminEmailConfigured;
    }
    const snap = await state.firestore
      .collection('admins')
      .where('active', '==', true)
      .limit(1)
      .get();
    if (!snap.empty) return true;
    return env.isAdminEmailConfigured;
  },

  async getAllowlistEntry(email: string): Promise<FirestoreAllowlistDoc | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const docId = toAllowlistDocId(normalizedEmail);
    const state = getFirebaseAdminState();

    if (!state.firestore || !state.hasFullAdminCredentials) {
      const local = readLocalAuthStore();
      return local.allowlist[docId] ?? null;
    }

    const snap = await state.firestore.collection('admin_allowlist').doc(docId).get();
    if (!snap.exists) {
      return null;
    }
    const data = snap.data() as Partial<FirestoreAllowlistDoc> | undefined;
    if (!data || !data.email) {
      return null;
    }
    return {
      email: data.email.trim().toLowerCase(),
      displayName: data.displayName ?? null,
      isPrimaryOwner: Boolean(data.isPrimaryOwner),
      active: data.active !== false,
      addedByEmail: data.addedByEmail ?? null,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    };
  },

  async listAllowlistEntries(): Promise<FirestoreAllowlistDoc[]> {
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      const local = readLocalAuthStore();
      return Object.values(local.allowlist);
    }

    const snap = await state.firestore.collection('admin_allowlist').get();
    return snap.docs
      .map((doc) => {
        const data = doc.data() as Partial<FirestoreAllowlistDoc>;
        if (!data.email) return null;
        return {
          email: data.email.trim().toLowerCase(),
          displayName: data.displayName ?? null,
          isPrimaryOwner: Boolean(data.isPrimaryOwner),
          active: data.active !== false,
          addedByEmail: data.addedByEmail ?? null,
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is FirestoreAllowlistDoc => item !== null);
  },

  async upsertAllowlistEntry(params: {
    email: string;
    displayName?: string | null;
    isPrimaryOwner?: boolean;
    active: boolean;
    addedByEmail?: string | null;
  }): Promise<FirestoreAllowlistDoc> {
    const normalizedEmail = params.email.trim().toLowerCase();
    const docId = toAllowlistDocId(normalizedEmail);
    const now = new Date().toISOString();
    const existing = await this.getAllowlistEntry(normalizedEmail);

    const record: FirestoreAllowlistDoc = {
      email: normalizedEmail,
      displayName: params.displayName ?? existing?.displayName ?? null,
      isPrimaryOwner: params.isPrimaryOwner ?? existing?.isPrimaryOwner ?? false,
      active: params.active,
      addedByEmail: params.addedByEmail ?? existing?.addedByEmail ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      const local = readLocalAuthStore();
      local.allowlist[docId] = record;
      writeLocalAuthStore(local);
      return record;
    }

    await state.firestore.collection('admin_allowlist').doc(docId).set(record);
    return record;
  },

  async recordSecurityEvent(params: {
    eventType: SecurityEventType;
    uid?: string | null;
    email?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    reason?: string | null;
  }): Promise<void> {
    const state = getFirebaseAdminState();
    if (!state.firestore || !state.hasFullAdminCredentials) {
      return;
    }
    try {
      await state.firestore.collection('auth_security_events').add({
        eventType: params.eventType,
        uid: params.uid ?? null,
        email: params.email ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        reason: params.reason ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(
        '[FirestoreAudit] Failed to record security event:',
        err instanceof Error ? err.message : err
      );
    }
  },
};
