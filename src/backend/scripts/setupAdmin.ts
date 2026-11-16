import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { env } from '../config/env';
import { getFirebaseAdminState } from '../firebase/admin';
import { toAllowlistDocId } from '../models/firestore.model';

const emailSchema = z.string().trim().email();
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters long.')
  .max(128, 'Password must not exceed 128 characters.')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

function getArgValue(flag: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : undefined;
}

async function main(): Promise<void> {
  const adminState = getFirebaseAdminState();
  if (!adminState.configured || !adminState.auth || !adminState.firestore) {
    console.error('Error: Firebase Admin SDK is not configured.', adminState.initError);
    process.exit(1);
  }
  if (!adminState.hasFullAdminCredentials) {
    console.error(
      'Error: Full Firebase Admin service account credentials are required (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).'
    );
    process.exit(1);
  }

  const rawEmail = getArgValue('--email') || env.primaryAdminEmail || env.firebaseAdminEmail;
  const parsedEmail = emailSchema.safeParse(rawEmail);
  if (!parsedEmail.success) {
    console.error(
      'Error: Provide a valid administrator email via --email=<email> or ADMIN_EMAILS.'
    );
    process.exit(1);
  }
  const adminEmail = parsedEmail.data.toLowerCase();

  const rawPassword = getArgValue('--password') || process.env.ADMIN_INITIAL_PASSWORD || '';
  const replaceExisting = process.argv.includes('--replace');
  const addMode = process.argv.includes('--add');

  const auth = adminState.auth;
  const db = adminState.firestore;

  const existingAdmins = await db.collection('admins').where('active', '==', true).get();

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(adminEmail);
    if (rawPassword) {
      const parsedPwd = passwordSchema.safeParse(rawPassword);
      if (!parsedPwd.success) {
        console.error(
          'Error: Invalid password:',
          parsedPwd.error.issues.map((i) => i.message).join(' ')
        );
        process.exit(1);
      }
      userRecord = await auth.updateUser(userRecord.uid, {
        password: parsedPwd.data,
        emailVerified: true,
        disabled: false,
      });
    } else if (!userRecord.emailVerified) {
      userRecord = await auth.updateUser(userRecord.uid, { emailVerified: true });
    }
  } catch {
    if (rawPassword) {
      const parsedPwd = passwordSchema.safeParse(rawPassword);
      if (!parsedPwd.success) {
        console.error(
          'Error: Provide a valid initial password:',
          parsedPwd.error.issues.map((i) => i.message).join(' ')
        );
        process.exit(1);
      }
      userRecord = await auth.createUser({
        email: adminEmail,
        password: parsedPwd.data,
        emailVerified: true,
        disabled: false,
      });
    } else {
      userRecord = await auth.createUser({
        email: adminEmail,
        emailVerified: true,
        disabled: false,
      });
    }
  }

  const otherActiveAdmins = existingAdmins.docs.filter((doc) => doc.id !== userRecord.uid);
  const isPrimaryOwner =
    !addMode || otherActiveAdmins.length === 0 || adminEmail === env.primaryAdminEmail;

  if (otherActiveAdmins.length > 0 && replaceExisting) {
    for (const docSnap of otherActiveAdmins) {
      await auth.setCustomUserClaims(docSnap.id, {});
      await docSnap.ref.update({
        active: false,
        isPrimaryOwner: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // Establish trusted server-side custom claims & Firestore allowlist
  await auth.setCustomUserClaims(userRecord.uid, {
    admin: true,
    role: 'ADMIN',
  });

  await db
    .collection('admins')
    .doc(userRecord.uid)
    .set(
      {
        uid: userRecord.uid,
        email: adminEmail,
        displayName: userRecord.displayName || null,
        role: 'ADMIN',
        isPrimaryOwner,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  const now = new Date().toISOString();
  await db
    .collection('admin_allowlist')
    .doc(toAllowlistDocId(adminEmail))
    .set(
      {
        email: adminEmail,
        displayName: userRecord.displayName || null,
        isPrimaryOwner,
        active: true,
        addedByEmail: 'cli_setup',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

  if (!addMode || otherActiveAdmins.length === 0) {
    await db
      .collection('system_config')
      .doc('admin_policy')
      .set({
        key: 'admin_policy',
        ownerUid: userRecord.uid,
        description: 'Private authorized multi-Gmail admin allowlist policy',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  await db.collection('auth_security_events').add({
    eventType: 'ADMIN_INITIALIZED',
    uid: userRecord.uid,
    email: adminEmail,
    reason: addMode ? 'trusted_cli_add_admin' : 'trusted_cli_setup',
    createdAt: FieldValue.serverTimestamp(),
  });

  console.info(
    `[AdminSetup] Authorized administrator established: ${adminEmail} (UID: ${userRecord.uid}, Primary: ${isPrimaryOwner}).`
  );
}

main().catch((err) => {
  console.error('[AdminSetup] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
