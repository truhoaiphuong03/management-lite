import { matchRoute } from './router.js';
import { clearFrontendQueryCache } from './cache/query-cache.js';
import {
  bindPrintQuoteDraftOwnerFromActiveTracker,
  clearPrintQuoteRamDraft,
  clearPrintQuoteSessionIdentity,
  getVerifiedActivePrintQuoteEditorPath,
  purgeUnattributedPrintQuoteDraft,
  reconcilePrintQuoteDraftWithVerifiedSession,
} from './printquote-draft-bridge.js';
import type { UserRole } from './types.js';

export interface ParsedSessionData {
  verified: boolean;
  isOwner: boolean;
  role: UserRole;
  userId?: string | undefined;
  userEmail?: string | undefined;
  emailVerified?: boolean | undefined;
  workspaceId?: string | undefined;
  workspaceName?: string | undefined;
  csrfToken?: string | undefined;
}

export function parseSessionPayload(body: unknown): ParsedSessionData | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as {
    success?: boolean;
    data?: {
      user?: { id?: unknown; email?: unknown; email_verified?: unknown };
      active_workspace?: { id?: unknown; name?: unknown; role?: unknown };
      csrf_token?: unknown;
    };
  };
  if (!b.success || !b.data) return null;

  const activeWs = b.data.active_workspace;
  const hasValidWs = Boolean(
    activeWs &&
    typeof activeWs.id === 'string' &&
    activeWs.id.length > 0 &&
    (activeWs.role === 'owner' || activeWs.role === 'staff'),
  );
  if (!hasValidWs || !activeWs) return null;

  const isOwner = activeWs.role === 'owner';
  const role = activeWs.role as UserRole;
  const csrfToken =
    typeof b.data.csrf_token === 'string' ? b.data.csrf_token : undefined;
  const userId =
    typeof b.data.user?.id === 'string' && b.data.user.id.length > 0
      ? b.data.user.id
      : undefined;
  const userEmail =
    typeof b.data.user?.email === 'string' &&
    b.data.user.email.trim().length > 0
      ? b.data.user.email.trim()
      : undefined;
  const emailVerified =
    typeof b.data.user?.email_verified === 'boolean'
      ? b.data.user.email_verified
      : undefined;
  const workspaceId =
    typeof activeWs.id === 'string' && activeWs.id.length > 0
      ? activeWs.id
      : undefined;
  const workspaceName =
    typeof activeWs.name === 'string' && activeWs.name.trim().length > 0
      ? activeWs.name.trim()
      : undefined;

  return {
    verified: true,
    isOwner,
    role,
    userId,
    userEmail,
    emailVerified,
    workspaceId,
    workspaceName,
    csrfToken,
  };
}

export interface SessionStateTracker {
  authEpoch: number;
  verifiedOwnerSession: boolean;
  isLoggedIn: boolean;
  role: UserRole;
  userId?: string | undefined;
  userEmail?: string | undefined;
  emailVerified?: boolean | undefined;
  workspaceId?: string | undefined;
  workspaceName?: string | undefined;
  csrfToken: string;
}

function resetSessionTrackerClosed(tracker: SessionStateTracker): void {
  tracker.verifiedOwnerSession = false;
  tracker.isLoggedIn = false;
  tracker.userId = undefined;
  tracker.userEmail = undefined;
  tracker.emailVerified = undefined;
  tracker.workspaceId = undefined;
  tracker.workspaceName = undefined;
}

function isDefinitiveAuthRejectionStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export async function executeSessionVerification(
  tracker: SessionStateTracker,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  bindPrintQuoteDraftOwnerFromActiveTracker(tracker);
  const epoch = ++tracker.authEpoch;
  try {
    let res = await fetchFn('/api/v1/auth/me', {
      credentials: 'include',
    });
    // Stale response guard: discard if logout or newer login started
    if (epoch !== tracker.authEpoch) return false;

    if (res.status === 401) {
      // Attempt silent refresh if short-term idle window expired while persistent/absolute session is still valid
      try {
        const refreshRes = await fetchFn('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        if (epoch !== tracker.authEpoch) return false;
        if (refreshRes.ok) {
          res = refreshRes;
        }
      } catch {
        // Ignore refresh network error and fail closed below
      }
    }

    if (!res.ok) {
      clearFrontendQueryCache();
      if (isDefinitiveAuthRejectionStatus(res.status)) {
        clearPrintQuoteSessionIdentity();
        clearPrintQuoteRamDraft();
      } else {
        // Transient server / gateway / rate-limit failure (5xx, 408, 429):
        // Fail closed on session access, preserve Owner-bound RAM draft, purge only unattributed drafts
        purgeUnattributedPrintQuoteDraft();
      }
      resetSessionTrackerClosed(tracker);
      return false;
    }

    const JSON_PARSE_ERROR = Symbol('json_parse_error');
    const rawBody: unknown = await res.json().catch(() => JSON_PARSE_ERROR);
    if (epoch !== tracker.authEpoch) return false;

    if (rawBody === JSON_PARSE_ERROR) {
      // Non-JSON proxy/gateway response on 2xx: fail closed on session, preserve Owner-bound RAM draft
      clearFrontendQueryCache();
      purgeUnattributedPrintQuoteDraft();
      resetSessionTrackerClosed(tracker);
      return false;
    }

    const parsed = parseSessionPayload(rawBody);
    if (parsed) {
      if (
        (tracker.userId && tracker.userId !== parsed.userId) ||
        (tracker.workspaceId && tracker.workspaceId !== parsed.workspaceId) ||
        (tracker.isLoggedIn && tracker.role !== parsed.role)
      ) {
        clearFrontendQueryCache();
        clearPrintQuoteRamDraft();
      }
      if (!reconcilePrintQuoteDraftWithVerifiedSession(parsed)) {
        clearFrontendQueryCache();
      }
      tracker.role = parsed.role;
      tracker.userId = parsed.userId;
      tracker.userEmail = parsed.userEmail;
      tracker.emailVerified = parsed.emailVerified;
      tracker.workspaceId = parsed.workspaceId;
      tracker.workspaceName = parsed.workspaceName;
      if (parsed.csrfToken) {
        tracker.csrfToken = parsed.csrfToken;
      }
      tracker.verifiedOwnerSession = parsed.isOwner;
      tracker.isLoggedIn = true;
      return true;
    } else {
      // Structured JSON rejection or non-owner/missing workspace => fail closed & purge RAM draft
      clearFrontendQueryCache();
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      resetSessionTrackerClosed(tracker);
      return false;
    }
  } catch {
    if (epoch === tracker.authEpoch) {
      clearFrontendQueryCache();
      purgeUnattributedPrintQuoteDraft();
      resetSessionTrackerClosed(tracker);
    }
    return false;
  }
}

export function executeLogout(tracker: SessionStateTracker) {
  // Invalidate any in-flight session verification and purge frontend query cache + RAM quote draft immediately
  clearFrontendQueryCache();
  clearPrintQuoteSessionIdentity();
  clearPrintQuoteRamDraft();
  tracker.authEpoch++;
  resetSessionTrackerClosed(tracker);
  tracker.csrfToken = '';
}

export function isPublicAuthRoute(pathname: string): boolean {
  const clean = pathname.split(/[?#]/, 1)[0] || '/';
  return (
    clean === '/login' ||
    clean === '/forgot-password' ||
    clean.startsWith('/activate') ||
    clean.startsWith('/reset-password') ||
    clean.startsWith('/verify-email')
  );
}

export function determinePostVerificationRoute(
  currentPath: string,
  verified: boolean,
): string | null {
  if (verified) {
    if (currentPath === '/login') {
      return getVerifiedActivePrintQuoteEditorPath() || '/';
    }
    return null; // Keep current path
  } else {
    if (!isPublicAuthRoute(currentPath)) {
      return '/login'; // Redirect to login
    }
    return null; // Stay at current public route, do not navigate away
  }
}

export function evaluateRouteAccess(
  currentPath: string,
  verifiedOwnerSession: boolean,
  role: UserRole,
) {
  const { route: routeMeta, params } = matchRoute(currentPath);
  const isIssuesRoute = Boolean(
    routeMeta?.category === 'issues' ||
    routeMeta?.path === '/issues' ||
    routeMeta?.path === '/issues/:id' ||
    currentPath.startsWith('/issues'),
  );
  const isPrintQuotesRoute = Boolean(
    routeMeta?.category === 'print-quotes' ||
    currentPath === '/print-quotes' ||
    currentPath.startsWith('/print-quotes/'),
  );

  const isForbidden = Boolean(
    (routeMeta?.category === 'finance' &&
      (!verifiedOwnerSession || role !== 'owner')) ||
    (isIssuesRoute && (!verifiedOwnerSession || role !== 'owner')) ||
    (isPrintQuotesRoute && (!verifiedOwnerSession || role !== 'owner')) ||
    (!isIssuesRoute &&
      !isPrintQuotesRoute &&
      routeMeta?.ownerOnly &&
      role === 'staff') ||
    (!isIssuesRoute &&
      !isPrintQuotesRoute &&
      routeMeta?.staffOnly &&
      role === 'owner'),
  );

  return {
    route: routeMeta,
    params,
    isIssuesRoute,
    isPrintQuotesRoute,
    isForbidden,
  };
}
