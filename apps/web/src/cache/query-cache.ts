import type { UserRole } from '../types.js';

export interface FrontendCacheScope {
  userId?: string | undefined;
  workspaceId?: string | undefined;
  role: UserRole;
}

export interface FrontendCacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  evictions: number;
  invalidations: number;
  size: number;
  maxEntries: number;
}

interface FrontendCacheEntry {
  serializedValue: string;
  expiresAt: number;
  userId: string;
  workspaceId: string;
  role: UserRole;
}

const MAX_FRONTEND_CACHE_ENTRIES = 200;
const DEFAULT_FRONTEND_TTL_MS = 15_000;

const cacheStore = new Map<string, FrontendCacheEntry>();
const inFlightRequests = new Map<
  string,
  Promise<{ ok: boolean; status: number; data: unknown }>
>();

let hits = 0;
let misses = 0;
let bypasses = 0;
let evictions = 0;
let invalidations = 0;

const FORBIDDEN_FRONTEND_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/health',
  '/api/v1/ready',
  '/api/v1/system/releases',
];

export function isCacheableFrontendUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  let pathname = rawUrl;
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    pathname = parsed.pathname;
  } catch {
    return false;
  }
  if (!pathname.startsWith('/api/v1/')) {
    return false;
  }
  for (const prefix of FORBIDDEN_FRONTEND_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return false;
    }
  }
  if (/^\/api\/v1\/accounts\/[^/]+\/secrets(?:\/|$)/i.test(pathname)) {
    return false;
  }
  if (/^\/api\/v1\/fin\/receipts\/[^/]+\/(?:file|extract)$/i.test(pathname)) {
    return false;
  }
  return true;
}

export function normalizeFrontendUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const entries = Array.from(parsed.searchParams.entries()).sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
    );
    const query =
      entries.length > 0
        ? `?${entries
            .map(
              ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
            )
            .join('&')}`
        : '';
    return `${parsed.pathname}${query}`;
  } catch {
    return rawUrl;
  }
}

export function buildFrontendCacheKey(
  scope: FrontendCacheScope,
  rawUrl: string,
): string | null {
  const userId = scope.userId?.trim();
  const workspaceId = scope.workspaceId?.trim();
  const role = scope.role;
  if (
    !userId ||
    !workspaceId ||
    (role !== 'owner' && role !== 'staff') ||
    !isCacheableFrontendUrl(rawUrl)
  ) {
    return null;
  }
  return `${userId}::${workspaceId}::${role}::${normalizeFrontendUrl(rawUrl)}`;
}

function evictExpiredOrOldest(nowMs: number): void {
  for (const [k, entry] of cacheStore.entries()) {
    if (nowMs >= entry.expiresAt) {
      cacheStore.delete(k);
      evictions++;
    }
  }
  while (cacheStore.size >= MAX_FRONTEND_CACHE_ENTRIES) {
    const oldestKey = cacheStore.keys().next().value;
    if (oldestKey === undefined) break;
    cacheStore.delete(oldestKey);
    evictions++;
  }
}

export function getFrontendCachedData<T = unknown>(
  scope: FrontendCacheScope,
  rawUrl: string,
  nowMs = Date.now(),
): T | undefined {
  const key = buildFrontendCacheKey(scope, rawUrl);
  if (!key) {
    bypasses++;
    return undefined;
  }

  const entry = cacheStore.get(key);
  if (!entry) {
    misses++;
    return undefined;
  }

  if (
    nowMs >= entry.expiresAt ||
    entry.userId !== scope.userId?.trim() ||
    entry.workspaceId !== scope.workspaceId?.trim() ||
    entry.role !== scope.role
  ) {
    cacheStore.delete(key);
    misses++;
    return undefined;
  }

  try {
    const parsed = JSON.parse(entry.serializedValue) as T;
    cacheStore.delete(key);
    cacheStore.set(key, entry);
    hits++;
    return parsed;
  } catch {
    cacheStore.delete(key);
    misses++;
    return undefined;
  }
}

export function setFrontendCachedData<T = unknown>(
  scope: FrontendCacheScope,
  rawUrl: string,
  value: T,
  ttlMs = DEFAULT_FRONTEND_TTL_MS,
  nowMs = Date.now(),
): boolean {
  const key = buildFrontendCacheKey(scope, rawUrl);
  if (!key || ttlMs <= 0) {
    bypasses++;
    return false;
  }

  try {
    const serializedValue = JSON.stringify(value);
    if (cacheStore.has(key)) {
      cacheStore.delete(key);
    } else if (cacheStore.size >= MAX_FRONTEND_CACHE_ENTRIES) {
      evictExpiredOrOldest(nowMs);
    }
    cacheStore.set(key, {
      serializedValue,
      expiresAt: nowMs + ttlMs,
      userId: scope.userId!.trim(),
      workspaceId: scope.workspaceId!.trim(),
      role: scope.role,
    });
    return true;
  } catch {
    bypasses++;
    return false;
  }
}

export async function fetchWithFrontendCache<T = unknown>(
  scope: FrontendCacheScope,
  rawUrl: string,
  options: {
    fetchFn?: typeof fetch | undefined;
    signal?: AbortSignal | undefined;
    ttlMs?: number | undefined;
    bypassCache?: boolean | undefined;
  } = {},
): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  fromCache: boolean;
}> {
  const fetchFn =
    options.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchFn) {
    return { ok: false, status: 0, data: null, fromCache: false };
  }

  const key = options.bypassCache ? null : buildFrontendCacheKey(scope, rawUrl);

  if (key) {
    const cached = getFrontendCachedData<T>(scope, rawUrl);
    if (cached !== undefined) {
      return { ok: true, status: 200, data: cached, fromCache: true };
    }

    const existingInFlight = inFlightRequests.get(key);
    if (existingInFlight) {
      const shared = await existingInFlight;
      return {
        ok: shared.ok,
        status: shared.status,
        data: (shared.data as T | null) ?? null,
        fromCache: true,
      };
    }
  } else {
    bypasses++;
  }

  const executeNetworkFetch = async (): Promise<{
    ok: boolean;
    status: number;
    data: T | null;
  }> => {
    const init: RequestInit = {
      credentials: 'include',
    };
    if (options.signal) {
      init.signal = options.signal;
    }
    const res = await fetchFn(rawUrl, init);
    if (!res || !res.ok) {
      return { ok: false, status: res?.status ?? 0, data: null };
    }
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
    } | null;
    if (!body || body.data === undefined) {
      return { ok: false, status: res.status, data: null };
    }
    if (key) {
      setFrontendCachedData(
        scope,
        rawUrl,
        body.data,
        options.ttlMs ?? DEFAULT_FRONTEND_TTL_MS,
      );
    }
    return { ok: true, status: res.status, data: body.data };
  };

  if (!key) {
    const res = await executeNetworkFetch();
    return { ...res, fromCache: false };
  }

  const promise = executeNetworkFetch().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);

  const result = await promise;
  return { ...result, fromCache: false };
}

export function invalidateFrontendCacheForWorkspace(
  workspaceId?: string,
): number {
  const ws = workspaceId?.trim();
  if (!ws) return 0;
  let removed = 0;
  for (const [k, entry] of cacheStore.entries()) {
    if (entry.workspaceId === ws) {
      cacheStore.delete(k);
      removed++;
    }
  }
  for (const k of inFlightRequests.keys()) {
    if (k.includes(`::${ws}::`)) {
      inFlightRequests.delete(k);
    }
  }
  if (removed > 0) {
    invalidations += removed;
  }
  return removed;
}

export function invalidateFrontendCacheForUser(userId?: string): number {
  const uid = userId?.trim();
  if (!uid) return 0;
  let removed = 0;
  for (const [k, entry] of cacheStore.entries()) {
    if (entry.userId === uid) {
      cacheStore.delete(k);
      removed++;
    }
  }
  for (const k of inFlightRequests.keys()) {
    if (k.startsWith(`${uid}::`)) {
      inFlightRequests.delete(k);
    }
  }
  if (removed > 0) {
    invalidations += removed;
  }
  return removed;
}

export function clearFrontendQueryCache(): void {
  const count = cacheStore.size;
  cacheStore.clear();
  inFlightRequests.clear();
  if (count > 0) {
    invalidations += count;
  }
}

export function getFrontendCacheStats(): FrontendCacheStats {
  return {
    hits,
    misses,
    bypasses,
    evictions,
    invalidations,
    size: cacheStore.size,
    maxEntries: MAX_FRONTEND_CACHE_ENTRIES,
  };
}
