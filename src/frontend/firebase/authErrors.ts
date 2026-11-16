import { FirebaseError } from 'firebase/app';

interface HttpErrorLike {
  name?: string;
  message: string;
  statusCode: number;
}

function isApiClientErrorLike(err: unknown): err is HttpErrorLike {
  return (
    err instanceof Error &&
    err.name === 'ApiClientError' &&
    typeof (err as Partial<HttpErrorLike>).statusCode === 'number'
  );
}

function getCurrentHostname(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }
  return 'this domain';
}

export interface FirebaseErrorContext {
  projectId?: string;
  hostname?: string;
}

export function mapFirebaseAuthError(
  err: unknown,
  context?: FirebaseErrorContext
): string {
  if (isApiClientErrorLike(err)) {
    if (err.statusCode === 401) {
      return (
        err.message ||
        'Administrator authentication failed or session expired (HTTP 401). Please sign in again.'
      );
    }
    if (err.statusCode === 403) {
      return (
        err.message ||
        'Access denied (HTTP 403). Your account is not authorized for this studio or the request origin was blocked.'
      );
    }
    return err.message;
  }

  if (err instanceof FirebaseError) {
    const hostname = context?.hostname || getCurrentHostname();
    const projectHint = context?.projectId ? ` (Firebase project: "${context.projectId}")` : '';
    switch (err.code) {
      case 'auth/unauthorized-domain':
        return `Domain "${hostname}" is not listed in Firebase Authorized Domains${projectHint}. Add "${hostname}" (hostname only, without https://) in Firebase Console -> Authentication -> Settings -> Authorized domains.`;
      case 'auth/unauthorized-continue-uri':
      case 'auth/invalid-continue-uri':
        return `Redirect domain "${hostname}" is not authorized in Firebase Authentication${projectHint}. Add "${hostname}" (hostname only, without https://) in Firebase Console -> Authentication -> Settings -> Authorized domains.`;
      case 'auth/operation-not-allowed':
        return `This sign-in method is not enabled in Firebase Authentication${projectHint}. Enable Email/Password and Google providers in Firebase Console -> Authentication -> Sign-in method.`;
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-email':
        return 'Invalid email or password.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait a few minutes before trying again.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in popup was closed before completion.';
      case 'auth/cancelled-popup-request':
        return 'Sign-in popup request was cancelled. Please try again.';
      case 'auth/popup-blocked':
        return 'Sign-in popup was blocked by your browser. Allow popups for this site or use Google Redirect sign-in below.';
      case 'auth/operation-not-supported-in-this-environment':
        return 'Popup sign-in is not supported in this browser environment. Try opening this page directly in your browser or use Google Redirect sign-in.';
      case 'auth/account-exists-with-different-credential':
        return 'An account already exists with this email using a different sign-in provider.';
      case 'auth/network-request-failed':
        return 'Network request to Firebase Authentication failed. Check your connection and try again.';
      case 'auth/invalid-api-key':
      case 'auth/app-not-authorized':
        return 'Firebase client configuration is invalid or not authorized for this Firebase project.';
      case 'auth/user-disabled':
        return 'This administrator account has been disabled.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Authentication failed.';
}

export function isPopupFallbackSuggested(err: unknown): boolean {
  if (err instanceof FirebaseError) {
    return (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/operation-not-supported-in-this-environment'
    );
  }
  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    return lower.includes('popup was blocked') || lower.includes('not supported in this browser');
  }
  return false;
}
