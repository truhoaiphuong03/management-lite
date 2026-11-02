import { matchRoute } from './router.js';
import { clearFrontendQueryCache } from './cache/query-cache.js';
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

export async function executeSessionVerification(
  tracker: SessionStateTracker,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
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
      tracker.verifiedOwnerSession = false;
      tracker.isLoggedIn = false;
      tracker.userId = undefined;
      tracker.userEmail = undefined;
      tracker.emailVerified = undefined;
      tracker.workspaceId = undefined;
      tracker.workspaceName = undefined;
      return false;
    }

    const body = await res.json().catch(() => null);
    if (epoch !== tracker.authEpoch) return false;

    const parsed = parseSessionPayload(body);
    if (parsed) {
      if (
        (tracker.userId && tracker.userId !== parsed.userId) ||
        (tracker.workspaceId && tracker.workspaceId !== parsed.workspaceId) ||
        (tracker.isLoggedIn && tracker.role !== parsed.role)
      ) {
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
      // Malformed payload => fail closed
      clearFrontendQueryCache();
      tracker.verifiedOwnerSession = false;
      tracker.isLoggedIn = false;
      tracker.userId = undefined;
      tracker.userEmail = undefined;
      tracker.emailVerified = undefined;
      tracker.workspaceId = undefined;
      tracker.workspaceName = undefined;
      return false;
    }
  } catch {
    if (epoch === tracker.authEpoch) {
      clearFrontendQueryCache();
      tracker.verifiedOwnerSession = false;
      tracker.isLoggedIn = false;
      tracker.userId = undefined;
      tracker.userEmail = undefined;
      tracker.emailVerified = undefined;
      tracker.workspaceId = undefined;
      tracker.workspaceName = undefined;
    }
    return false;
  }
}

export function executeLogout(tracker: SessionStateTracker) {
  // Invalidate any in-flight session verification and purge frontend query cache immediately
  clearFrontendQueryCache();
  tracker.authEpoch++;
  tracker.verifiedOwnerSession = false;
  tracker.isLoggedIn = false;
  tracker.userId = undefined;
  tracker.userEmail = undefined;
  tracker.emailVerified = undefined;
  tracker.workspaceId = undefined;
  tracker.workspaceName = undefined;
  tracker.csrfToken = '';
}

export function determinePostVerificationRoute(
  currentPath: string,
  verified: boolean,
): string | null {
  if (verified) {
    if (currentPath === '/login') {
      return '/';
    }
    return null; // Keep current path
  } else {
    if (
      currentPath !== '/login' &&
      !currentPath.startsWith('/activate') &&
      currentPath !== '/forgot-password' &&
      !currentPath.startsWith('/reset-password') &&
      !currentPath.startsWith('/verify-email')
    ) {
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

  const isForbidden = Boolean(
    (routeMeta?.category === 'finance' &&
      (!verifiedOwnerSession || role !== 'owner')) ||
    (isIssuesRoute && (!verifiedOwnerSession || role !== 'owner')) ||
    (!isIssuesRoute && routeMeta?.ownerOnly && role === 'staff') ||
    (!isIssuesRoute && routeMeta?.staffOnly && role === 'owner'),
  );

  return { route: routeMeta, params, isIssuesRoute, isForbidden };
}
