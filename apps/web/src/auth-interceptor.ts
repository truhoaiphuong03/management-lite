/**
 * Unified Authentication & Session Expiration Interceptor
 * Intercepts all client fetch calls to detect 401 Unauthorized responses
 * for authenticated endpoints and dispatches a single debounced session expired event.
 */

import { sanitizePostLoginRedirect } from './navigation-guard.js';

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

export function isSessionExpiredHandlingActive(): boolean {
  return isSessionExpiredActive;
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
  currentOrigin: string = typeof window !== 'undefined' ? window.location.origin : '',
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
  // 2. /api/v1/auth/forgot-password
  // 3. /api/v1/auth/reset-password
  if (
    pathname === '/api/v1/auth/login' ||
    pathname === '/api/v1/auth/forgot-password' ||
    pathname === '/api/v1/auth/reset-password'
  ) {
    return false;
  }

  return true;
}

/**
 * Triggers session expiration with debouncing.
 * Prevents multiple simultaneous 401s from triggering multiple redirects or alerts.
 */
export function triggerSessionExpired(url: string = ''): void {
  if (typeof window === 'undefined') return;

  const currentPath = window.location.pathname;

  // Never trigger if already handling expiration or already on public auth pages
  if (
    isSessionExpiredActive ||
    currentPath === '/login' ||
    currentPath === '/forgot-password' ||
    currentPath.startsWith('/reset-password')
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
    const response = await originalFetch.apply(this, [input, init]);

    // Check for 401 Unauthorized
    if (response.status === 401) {
      let urlStr = '';
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (input && typeof (input as Request).url === 'string') {
        urlStr = (input as Request).url;
      }

      // Check URL with exact origin and pathname matching
      if (isTargetAuthenticatedApiUrl(urlStr)) {
        triggerSessionExpired(urlStr);
      }
    }

    return response;
  };
}
