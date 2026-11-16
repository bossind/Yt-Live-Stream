import type { ApiResponse } from '../../shared/types/api';
import { firebaseAuth } from '../firebase/client';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ApiRequestOptions extends RequestInit {
  idToken?: string | null;
  skipAuth?: boolean;
}

function extractSafeTextSummary(rawText: string): string {
  const titleMatch = rawText.match(/<title[^>]*>([^<]+)<\/title>/i);
  const headingMatch = rawText.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const candidate = (titleMatch?.[1] || headingMatch?.[1] || rawText)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return candidate.slice(0, 160);
}

function buildNonJsonErrorMessage(status: number): string {
  if (status === 403) {
    return 'Access was blocked before reaching the API server (HTTP 403). Verify Firebase authorized domains, CORS settings, and proxy configuration.';
  }
  if (status === 401) {
    return 'Authentication required by gateway or server (HTTP 401). Please sign in again.';
  }
  if (status >= 500) {
    return `Backend server temporarily unavailable (HTTP ${status}). Please try again.`;
  }
  return `Unexpected non-JSON server response (HTTP ${status}).`;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;
  const { idToken, skipAuth, headers, ...restOptions } = options;

  let resolvedToken = idToken ?? null;
  if (!resolvedToken && !skipAuth && firebaseAuth?.currentUser) {
    resolvedToken = await firebaseAuth.currentUser.getIdToken();
  }

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (resolvedToken) {
    // Use X-Firebase-Auth instead of Authorization: Bearer so Cloud Run / IAP / preview proxies
    // do not intercept Firebase ID tokens as GCP IAM credentials and return HTML 403 responses.
    requestHeaders['X-Firebase-Auth'] = resolvedToken;
  }

  const response = await fetch(url, {
    ...restOptions,
    headers: requestHeaders,
  });

  const contentType = response.headers.get('content-type') || 'unknown';
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    throw new ApiClientError(
      `Failed to read server response (HTTP ${response.status}).`,
      response.status,
      'RESPONSE_READ_ERROR'
    );
  }

  let parsed: ApiResponse<T> | null = null;
  if (rawText.trim().length > 0) {
    try {
      const candidate = JSON.parse(rawText) as unknown;
      if (typeof candidate === 'object' && candidate !== null) {
        parsed = candidate as ApiResponse<T>;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    const safeSummary = extractSafeTextSummary(rawText);
    console.error('[API Client] Non-JSON error response received', {
      path: normalizedPath,
      status: response.status,
      contentType,
      summary: safeSummary || '(empty body)',
    });
    throw new ApiClientError(
      buildNonJsonErrorMessage(response.status),
      response.status,
      'NON_JSON_ERROR_RESPONSE'
    );
  }

  if (!response.ok || !parsed.success) {
    const errorCode = parsed.error?.code || 'API_ERROR';
    const errorMessage =
      parsed.error?.message || `Request failed with status ${response.status}.`;
    if (response.status >= 500) {
      console.error('[API Client] Server error response', {
        path: normalizedPath,
        status: response.status,
        code: errorCode,
      });
    }
    throw new ApiClientError(errorMessage, response.status, errorCode);
  }

  return parsed;
}
