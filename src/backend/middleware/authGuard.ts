import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import { getFirebaseAdminState } from '../firebase/admin';
import { FirestoreModel } from '../models/firestore.model';

export interface AuthenticatedAdminContext {
  uid: string;
  email: string;
  displayName: string | null;
  isPrimaryOwner: boolean;
  emailVerified: boolean;
  authProvider: string;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdminContext;
    }
  }
}

function extractIdToken(req: Request): string | null {
  const proxySafeHeader = req.headers['x-firebase-auth'];
  if (typeof proxySafeHeader === 'string' && proxySafeHeader.trim().length > 0) {
    return proxySafeHeader.trim();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token || token.trim().length === 0) {
    return null;
  }
  return token.trim();
}

export async function requireFirebaseAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const adminState = getFirebaseAdminState();
    if (!adminState.configured || !adminState.auth) {
      return next(
        new AppError(
          `Firebase Admin SDK is not configured. Missing: ${adminState.missingConfigKeys.join(', ') || 'FIREBASE_PROJECT_ID'}.`,
          503,
          'FIREBASE_NOT_CONFIGURED'
        )
      );
    }

    const idToken = extractIdToken(req);
    if (!idToken) {
      return next(new AppError('Authentication token required.', 401, 'UNAUTHENTICATED'));
    }

    let decodedToken;
    try {
      decodedToken = await adminState.auth.verifyIdToken(
        idToken,
        adminState.hasFullAdminCredentials
      );
    } catch {
      return next(
        new AppError('Invalid or expired authentication token.', 401, 'INVALID_ID_TOKEN')
      );
    }

    const email = (decodedToken.email || '').trim().toLowerCase();
    const ipAddress = req.ip ?? null;
    const userAgent =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent'].slice(0, 255)
        : null;

    if (!email || decodedToken.email_verified !== true) {
      await FirestoreModel.recordSecurityEvent({
        eventType: 'AUTH_REJECTED',
        uid: decodedToken.uid,
        email: email || null,
        ipAddress,
        userAgent,
        reason: 'email_not_verified',
      });
      return next(
        new AppError('Verified email address is required.', 403, 'EMAIL_NOT_VERIFIED')
      );
    }

    // Strict server-side multi-admin email allowlist evaluation:
    // Arbitrary Google accounts are NEVER automatically promoted to admin.
    const isEnvAllowlisted = env.adminEmails.includes(email);
    const allowlistEntry = await FirestoreModel.getAllowlistEntry(email);
    const isFirestoreAllowlisted = Boolean(allowlistEntry && allowlistEntry.active);
    const isExplicitlyRevoked = Boolean(allowlistEntry && !allowlistEntry.active);

    if (isExplicitlyRevoked && !isEnvAllowlisted) {
      await FirestoreModel.recordSecurityEvent({
        eventType: 'AUTH_REJECTED',
        uid: decodedToken.uid,
        email,
        ipAddress,
        userAgent,
        reason: 'admin_allowlist_revoked',
      });
      return next(
        new AppError(
          'Access revoked. This administrator account is no longer authorized.',
          403,
          'UNAUTHORIZED_ADMIN'
        )
      );
    }

    // Optional legacy UID pin when set explicitly AND no multi-admin emails were added
    if (
      env.firebaseAdminUid &&
      decodedToken.uid !== env.firebaseAdminUid &&
      !isEnvAllowlisted &&
      !isFirestoreAllowlisted
    ) {
      await FirestoreModel.recordSecurityEvent({
        eventType: 'AUTH_REJECTED',
        uid: decodedToken.uid,
        email,
        ipAddress,
        userAgent,
        reason: 'uid_not_allowlisted',
      });
      return next(
        new AppError(
          'Access denied. This account is not authorized for this private studio.',
          403,
          'UNAUTHORIZED_ADMIN'
        )
      );
    }

    const hasAdminClaim = decodedToken.admin === true && decodedToken.role === 'ADMIN';
    const existingAdminRecord = await FirestoreModel.getAdminRecord(decodedToken.uid);
    const isLegacySeededAdmin = Boolean(
      existingAdminRecord &&
        existingAdminRecord.active &&
        existingAdminRecord.email === email &&
        hasAdminClaim &&
        !isExplicitlyRevoked
    );

    const isAuthorizedEmail = isEnvAllowlisted || isFirestoreAllowlisted || isLegacySeededAdmin;

    if (!isAuthorizedEmail) {
      await FirestoreModel.recordSecurityEvent({
        eventType: 'AUTH_REJECTED',
        uid: decodedToken.uid,
        email,
        ipAddress,
        userAgent,
        reason: 'email_not_allowlisted',
      });
      return next(
        new AppError(
          'Access denied. This Gmail/email account is not on the authorized administrator allowlist.',
          403,
          'UNAUTHORIZED_ADMIN'
        )
      );
    }

    const isPrimaryOwner =
      (Boolean(env.primaryAdminEmail) && email === env.primaryAdminEmail) ||
      Boolean(allowlistEntry?.isPrimaryOwner) ||
      Boolean(existingAdminRecord?.isPrimaryOwner);

    const displayName =
      typeof decodedToken.name === 'string' && decodedToken.name.trim()
        ? decodedToken.name.trim()
        : existingAdminRecord?.displayName ?? allowlistEntry?.displayName ?? null;

    // Ensure trusted server-side custom claim and Firestore admin profile are provisioned for allowlisted admins
    if (adminState.hasFullAdminCredentials) {
      if (!hasAdminClaim) {
        await adminState.auth
          .setCustomUserClaims(decodedToken.uid, {
            admin: true,
            role: 'ADMIN',
          })
          .catch(() => {});
      }

      if (
        !existingAdminRecord ||
        !existingAdminRecord.active ||
        existingAdminRecord.email !== email ||
        existingAdminRecord.isPrimaryOwner !== isPrimaryOwner
      ) {
        await FirestoreModel.upsertVerifiedAdminUser({
          uid: decodedToken.uid,
          email,
          displayName,
          isPrimaryOwner,
        }).catch(() => {});
      }

      if (!allowlistEntry && (isEnvAllowlisted || isLegacySeededAdmin)) {
        await FirestoreModel.upsertAllowlistEntry({
          email,
          displayName,
          isPrimaryOwner,
          active: true,
          addedByEmail: 'system',
        }).catch(() => {});
      }
    }

    req.admin = {
      uid: decodedToken.uid,
      email,
      displayName,
      isPrimaryOwner,
      emailVerified: true,
      authProvider: decodedToken.firebase?.sign_in_provider || 'unknown',
    };

    next();
  } catch (err) {
    next(err);
  }
}
