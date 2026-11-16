import { Router } from 'express';
import { z } from 'zod';
import type { ApiResponse } from '../../../shared/types/api';
import type {
  AdminAllowlistEntry,
  AdminAllowlistResponse,
  AuthConfigStatus,
  AuthSessionPayload,
} from '../../../shared/types/auth';
import { env } from '../../config/env';
import { AppError } from '../../errors/AppError';
import { getFirebaseAdminState } from '../../firebase/admin';
import { requireFirebaseAdmin } from '../../middleware/authGuard';
import {
  authVerifyRateLimiter,
  storageMutationRateLimiter,
} from '../../middleware/rateLimiters';
import { FirestoreModel } from '../../models/firestore.model';

export const authRouter = Router();

const addAllowlistSchema = z.object({
  email: z.string().trim().email('Please provide a valid Gmail or email address.').max(254),
  displayName: z.string().trim().max(120).optional(),
});

authRouter.get('/status', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const adminState = getFirebaseAdminState();
    const hasAdminInFirestore = adminState.hasFullAdminCredentials
      ? await FirestoreModel.hasAnyActiveAdmin().catch(() => false)
      : env.isAdminEmailConfigured;

    const payload: ApiResponse<AuthConfigStatus> = {
      success: true,
      data: {
        firebaseClientConfigured: true,
        firebaseAdminConfigured: adminState.configured,
        firestoreConfigured: adminState.configured && adminState.hasFullAdminCredentials,
        firebaseProjectId: env.firebaseProjectId || undefined,
        adminEmailsConfigured: env.isAdminEmailConfigured,
        adminSetupRequired: adminState.hasFullAdminCredentials ? !hasAdminInFirestore : false,
        googleSignInEnabled: adminState.configured,
        emailPasswordEnabled: adminState.configured,
        publicRegistrationAllowed: false,
        missingFirebaseConfig: adminState.missingConfigKeys,
      },
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/verify', authVerifyRateLimiter, requireFirebaseAdmin, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const admin = req.admin!;
    const eventType =
      admin.authProvider === 'google.com' ? 'GOOGLE_LOGIN_SUCCESS' : 'LOGIN_SUCCESS';

    await FirestoreModel.recordSecurityEvent({
      eventType,
      uid: admin.uid,
      email: admin.email,
      ipAddress: req.ip ?? null,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 255)
          : null,
    });

    const payload: ApiResponse<AuthSessionPayload> = {
      success: true,
      data: {
        authenticated: true,
        user: {
          uid: admin.uid,
          email: admin.email,
          displayName: admin.displayName,
          role: 'ADMIN',
          isPrimaryOwner: admin.isPrimaryOwner,
          emailVerified: admin.emailVerified,
          authProvider: admin.authProvider,
        },
      },
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireFirebaseAdmin, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const admin = req.admin!;
    const adminState = getFirebaseAdminState();

    if (adminState.auth && adminState.hasFullAdminCredentials) {
      await adminState.auth.revokeRefreshTokens(admin.uid).catch(() => {});
    }

    await FirestoreModel.recordSecurityEvent({
      eventType: 'LOGOUT',
      uid: admin.uid,
      email: admin.email,
      ipAddress: req.ip ?? null,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 255)
          : null,
    });

    res.status(200).json({
      success: true,
      data: { loggedOut: true },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/allowlist', requireFirebaseAdmin, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const [firestoreEntries, adminDocs] = await Promise.all([
      FirestoreModel.listAllowlistEntries(),
      FirestoreModel.listAdmins(),
    ]);

    const adminByEmail = new Map(adminDocs.map((a) => [a.email.toLowerCase(), a]));
    const firestoreByEmail = new Map(firestoreEntries.map((e) => [e.email.toLowerCase(), e]));
    const envSet = new Set(env.adminEmails);

    const allEmails = new Set<string>([
      ...env.adminEmails,
      ...firestoreEntries.filter((e) => e.active).map((e) => e.email.toLowerCase()),
      ...adminDocs.filter((a) => a.active).map((a) => a.email.toLowerCase()),
    ]);

    const entries: AdminAllowlistEntry[] = [];
    for (const email of allEmails) {
      const fsEntry = firestoreByEmail.get(email);
      if (fsEntry && !fsEntry.active && !envSet.has(email)) {
        continue;
      }

      const adminDoc = adminByEmail.get(email);
      const inEnv = envSet.has(email);
      const inFs = Boolean(fsEntry && fsEntry.active);
      const isPrimaryOwner =
        email === env.primaryAdminEmail ||
        Boolean(fsEntry?.isPrimaryOwner) ||
        Boolean(adminDoc?.isPrimaryOwner);

      entries.push({
        email,
        displayName: adminDoc?.displayName ?? fsEntry?.displayName ?? null,
        uid: adminDoc?.uid ?? null,
        source: inEnv && inFs ? 'both' : inEnv ? 'env' : 'firestore',
        isPrimaryOwner,
        active: true,
        addedByEmail: fsEntry?.addedByEmail ?? (inEnv ? 'ADMIN_EMAILS' : null),
        createdAt: fsEntry?.createdAt ?? null,
        updatedAt: fsEntry?.updatedAt ?? null,
      });
    }

    entries.sort((a, b) => {
      if (a.isPrimaryOwner !== b.isPrimaryOwner) return a.isPrimaryOwner ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

    const primaryEntry = entries.find((e) => e.isPrimaryOwner);
    const payload: ApiResponse<AdminAllowlistResponse> = {
      success: true,
      data: {
        entries,
        currentAdminEmail: req.admin!.email,
        primaryOwnerEmail: primaryEntry?.email ?? (env.primaryAdminEmail || null),
      },
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  '/allowlist',
  requireFirebaseAdmin,
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const adminState = getFirebaseAdminState();
      if (env.isProduction && (!adminState.firestore || !adminState.hasFullAdminCredentials)) {
        throw new AppError(
          'Firebase Admin service account credentials (FIREBASE_SERVICE_ACCOUNT_JSON) are required in production to persist allowlist updates.',
          503,
          'FIREBASE_SERVICE_ACCOUNT_REQUIRED'
        );
      }

      const parsed = addAllowlistSchema.parse(req.body);
      const normalizedEmail = parsed.email.toLowerCase();
      const isPrimaryOwner = normalizedEmail === env.primaryAdminEmail;

      const entry = await FirestoreModel.upsertAllowlistEntry({
        email: normalizedEmail,
        displayName: parsed.displayName?.trim() || null,
        isPrimaryOwner,
        active: true,
        addedByEmail: req.admin!.email,
      });

      // If this Firebase user already exists, sync custom claims immediately
      let resolvedUid: string | null = null;
      if (adminState.auth && adminState.hasFullAdminCredentials) {
        try {
          const userRecord = await adminState.auth.getUserByEmail(normalizedEmail);
          resolvedUid = userRecord.uid;
          await adminState.auth.setCustomUserClaims(userRecord.uid, {
            admin: true,
            role: 'ADMIN',
          });
          await FirestoreModel.upsertVerifiedAdminUser({
            uid: userRecord.uid,
            email: normalizedEmail,
            displayName: userRecord.displayName || parsed.displayName?.trim() || null,
            isPrimaryOwner,
          });
        } catch {
          // User hasn't signed in with Google yet — they will be claimed on first allowlisted sign-in.
        }
      }

      await FirestoreModel.recordSecurityEvent({
        eventType: 'ADMIN_ALLOWLIST_ADDED',
        uid: req.admin!.uid,
        email: normalizedEmail,
        ipAddress: req.ip ?? null,
        reason: `added_by:${req.admin!.email}`,
      });

      const responseEntry: AdminAllowlistEntry = {
        email: entry.email,
        displayName: entry.displayName,
        uid: resolvedUid,
        source: env.adminEmails.includes(normalizedEmail) ? 'both' : 'firestore',
        isPrimaryOwner: entry.isPrimaryOwner,
        active: true,
        addedByEmail: entry.addedByEmail,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };

      res.status(201).json({
        success: true,
        data: responseEntry,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.delete(
  '/allowlist/:email',
  requireFirebaseAdmin,
  storageMutationRateLimiter,
  async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const targetEmail = decodeURIComponent(req.params.email).trim().toLowerCase();

      const existing = await FirestoreModel.getAllowlistEntry(targetEmail);
      const isPrimaryTarget =
        (Boolean(env.primaryAdminEmail) && targetEmail === env.primaryAdminEmail) ||
        Boolean(existing?.isPrimaryOwner);

      if (isPrimaryTarget) {
        throw new AppError(
          'Primary studio administrator cannot be removed from the allowlist.',
          403,
          'PRIMARY_ADMIN_PROTECTED'
        );
      }

      if (targetEmail === req.admin!.email) {
        throw new AppError(
          'You cannot revoke your own active administrator session.',
          400,
          'CANNOT_REMOVE_SELF'
        );
      }

      if (env.adminEmails.includes(targetEmail)) {
        throw new AppError(
          `"${targetEmail}" is configured in server ADMIN_EMAILS environment variable. Remove it from server environment settings to revoke access.`,
          409,
          'ENV_PINNED_ADMIN'
        );
      }

      const adminState = getFirebaseAdminState();
      if (env.isProduction && (!adminState.firestore || !adminState.hasFullAdminCredentials)) {
        throw new AppError(
          'Firebase Admin service account credentials (FIREBASE_SERVICE_ACCOUNT_JSON) are required in production to update the allowlist.',
          503,
          'FIREBASE_SERVICE_ACCOUNT_REQUIRED'
        );
      }

      await FirestoreModel.upsertAllowlistEntry({
        email: targetEmail,
        displayName: existing?.displayName ?? null,
        isPrimaryOwner: false,
        active: false,
        addedByEmail: req.admin!.email,
      });

      const revokedUids = await FirestoreModel.deactivateAdminsByEmail(targetEmail);
      if (adminState.auth && adminState.hasFullAdminCredentials) {
        const uidsToRevoke = new Set(revokedUids);
        try {
          const user = await adminState.auth.getUserByEmail(targetEmail);
          uidsToRevoke.add(user.uid);
        } catch {
          // User may not exist in Firebase Auth yet
        }

        for (const uid of uidsToRevoke) {
          await adminState.auth.setCustomUserClaims(uid, {}).catch(() => {});
          await adminState.auth.revokeRefreshTokens(uid).catch(() => {});
        }
      }

      await FirestoreModel.recordSecurityEvent({
        eventType: 'ADMIN_ALLOWLIST_REVOKED',
        uid: req.admin!.uid,
        email: targetEmail,
        ipAddress: req.ip ?? null,
        reason: `revoked_by:${req.admin!.email}`,
      });

      res.status(200).json({
        success: true,
        data: { revoked: true, email: targetEmail },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.all(['/register', '/signup'], (_req, _res, next) => {
  next(
    new AppError(
      'Public registration is permanently disabled. This is a private studio for authorized administrators only.',
      403,
      'PUBLIC_REGISTRATION_DISABLED'
    )
  );
});
