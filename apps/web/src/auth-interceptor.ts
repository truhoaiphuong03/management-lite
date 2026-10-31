/**
 * Unified Authentication & Session Expiration Interceptor
 * Intercepts all client fetch calls to detect 401 Unauthorized responses
 * for authenticated endpoints and dispatches a single debounced session expired event.
 */

import { sanitizePostLoginRedirect } from './navigation-guard.js';
import { clearFrontendQueryCache } from './cache/query-cache.js';

type SessionExpiredListener = (info: {
  currentPath: string;
  url: string;
}) => void;

let listeners: SessionExpiredListener[] = [];
let isSessionExpiredActive = false;
let isInterceptorInstalled = false;

export function addSessionExpiredListener(
  listener: SessionExpiredListener,
): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function resetSessionExpiredState(): void {
  isSessionExpiredActive = false;
}


/**
 * Evaluates whether an intercepted request URL is an internal authenticated API endpoint.
 * - Must match same-origin or configured API origin (e.g. 127.0.0.1:3002).
 * - Pathname must be under /api/v1/.
 * - Pathname must NOT be one of the public unauthenticated auth routes:
 *   /api/v1/auth/login
 *   /api/v1/auth/forgot-password
 *   /api/v1/auth/reset-password
 * - Query parameters (e.g. ?search=login) are strictly ignored during pathname evaluation.
 * - External 3rd party service requests (e.g. https://api.external.com/...) are strictly ignored.
 */
export function isTargetAuthenticatedApiUrl(
  rawUrl: string,
  currentOrigin: string = typeof window !== 'undefined'
    ? window.location.origin
    : '',
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl, currentOrigin || 'http://127.0.0.1:3001');
  } catch {
    return false;
  }

  // Allowed origins: current window origin or standard local API origins
  const allowedOrigins = new Set([
    currentOrigin,
    'http://127.0.0.1:3001',
    'http://localhost:3001',
    'http://127.0.0.1:3002',
    'http://localhost:3002',
  ]);

  // Reject third-party / external service origins (never redirect on external 401s)
  if (!allowedOrigins.has(parsed.origin)) {
    return false;
  }

  const pathname = parsed.pathname;

  // Must be strictly within API scope
  if (!pathname.startsWith('/api/v1/')) {
    return false;
  }

  // Excluded public auth endpoints by exact pathname:
  // 1. /api/v1/auth/login (bad password login attempt must not trigger session expiry redirect)
  // 2. /api/v1/auth/refresh (silent session refresh endpoint)
  // 3. /api/v1/auth/forgot-password
  // 4. /api/v1/auth/reset-password
  if (
    pathname === '/api/v1/auth/login' ||
    pathname === '/api/v1/auth/refresh' ||
    pathname === '/api/v1/auth/activate' ||
    pathname === '/api/v1/auth/forgot-password' ||
    pathname === '/api/v1/auth/reset-password' ||
    pathname === '/api/v1/auth/verify-email' ||
    pathname.startsWith('/api/v1/auth/verify-email/')
  ) {
    return false;
  }

  return true;
}

let inFlightRefreshPromise: Promise<{
  ok: boolean;
  csrfToken?: string | undefined;
}> | null = null;

/**
 * Attempts a single deduplicated silent session refresh via POST /api/v1/auth/refresh.
 */
export async function attemptSilentSessionRefresh(
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; csrfToken?: string | undefined }> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const res = await fetchFn('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        return { ok: false };
      }
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { csrf_token?: unknown };
      } | null;
      if (!body?.success) {
        return { ok: false };
      }
      const csrfToken =
        typeof body.data?.csrf_token === 'string'
          ? body.data.csrf_token
          : undefined;
      return { ok: true, csrfToken };
    } catch {
      return { ok: false };
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

/**
 * Triggers session expiration with debouncing.
 * Prevents multiple simultaneous 401s from triggering multiple redirects or alerts.
 */
export function triggerSessionExpired(url: string = ''): void {
  clearFrontendQueryCache();
  if (typeof window === 'undefined') return;

  const currentPath = window.location.pathname;

  // Never trigger if already handling expiration or already on public auth pages
  if (
    isSessionExpiredActive ||
    currentPath === '/login' ||
    currentPath.startsWith('/activate') ||
    currentPath === '/forgot-password' ||
    currentPath.startsWith('/reset-password') ||
    currentPath.startsWith('/verify-email')
  ) {
    return;
  }

  isSessionExpiredActive = true;

  // Save current route for post-login return (strictly sanitized to prevent open redirect)
  try {
    const safePath = sanitizePostLoginRedirect(currentPath);
    sessionStorage.setItem('post_login_redirect', safePath);
  } catch {
    // Ignore storage quota / access errors
  }

  // Notify listeners (e.g. App component to show expiration banner and schedule redirect)
  for (const listener of listeners) {
    try {
      listener({ currentPath, url });
    } catch {
      // Prevent listener errors from breaking interceptor
    }
  }
}

/**
 * Installs the global fetch interceptor.
 * Safe to call multiple times (idempotent).
 */
export function installAuthInterceptor(): void {
  if (typeof window === 'undefined' || isInterceptorInstalled) return;
  isInterceptorInstalled = true;

  const originalFetch = window.fetch;

  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let urlStr = '';
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.toString();
    } else if (input && typeof (input as Request).url === 'string') {
      urlStr = (input as Request).url;
    }

    const reqMethod = (
      init?.method ||
      (typeof input === 'object' && input && 'method' in input
        ? (input as Request).method
        : 'GET') ||
      'GET'
    ).toUpperCase();

    // fetch consumes a Request body. Keep a separate copy before the first attempt.
    const replayInput =
      typeof Request !== 'undefined' &&
      input instanceof Request &&
      isTargetAuthenticatedApiUrl(urlStr)
        ? input.clone()
        : input;
    const response = await originalFetch.apply(this, [input, init]);

    if (
      reqMethod !== 'GET' &&
      reqMethod !== 'HEAD' &&
      reqMethod !== 'OPTIONS' &&
      response.ok &&
      isTargetAuthenticatedApiUrl(urlStr)
    ) {
      clearFrontendQueryCache();
    }

    // Check for 401 Unauthorized
    if (response.status === 401) {
      // Check URL with exact origin and pathname matching
      if (isTargetAuthenticatedApiUrl(urlStr)) {
        // Attempt silent session refresh before expiring session
        const refreshed = await attemptSilentSessionRefresh(
          originalFetch.bind(this),
        );
        if (refreshed.ok) {
          let retryInit = init;
          if (refreshed.csrfToken) {
            const nextHeaders = new Headers(
              init?.headers ??
                (typeof Request !== 'undefined' && input instanceof Request
                  ? input.headers
                  : undefined),
            );
            if (nextHeaders.has('X-CSRF-Token')) {
              nextHeaders.set('X-CSRF-Token', refreshed.csrfToken);
            }
            retryInit = { ...init, headers: nextHeaders };
          }
          const retryResponse = await originalFetch.apply(this, [
            replayInput,
            retryInit,
          ]);
          if (retryResponse.status !== 401) {
            if (
              reqMethod !== 'GET' &&
              reqMethod !== 'HEAD' &&
              reqMethod !== 'OPTIONS' &&
              retryResponse.ok
            ) {
              clearFrontendQueryCache();
            }
            return retryResponse;
          }
        }

        // Do not fire delayed session-expired banner for initial /api/v1/auth/me probe
        // (executeSessionVerification handles startup route transitions deterministically)
        let isAuthMeProbe = false;
        try {
          const parsedUrl = new URL(urlStr, window.location.origin);
          isAuthMeProbe = parsedUrl.pathname === '/api/v1/auth/me';
        } catch {
          isAuthMeProbe = urlStr === '/api/v1/auth/me';
        }

        if (!isAuthMeProbe) {
          triggerSessionExpired(urlStr);
        }
      }
    }

    return response;
  };
}
