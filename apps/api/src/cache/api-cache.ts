import type { AuthenticatedContext } from '../auth/service.js';

export interface ApiCacheScope {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'staff' | 'admin';
  target: string;
}

export interface ApiCacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  evictions: number;
  invalidations: number;
  size: number;
  maxEntries: number;
}

interface CacheEntry {
  serializedValue: string;
  expiresAt: number;
  userId: string;
  workspaceId: string;
  role: 'owner' | 'staff' | 'admin';
}

const FORBIDDEN_CACHE_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/health',
  '/api/v1/ready',
  '/api/v1/system/releases',
];

/**
 * Evaluates whether an API pathname is eligible for scoped read caching.
 * Explicitly forbids authentication, session, health, receipt binary, and secret reveal routes.
 */
export function isCacheableApiPath(pathname: string): boolean {
  if (!pathname || !pathname.startsWith('/api/v1/')) {
    return false;
  }
  for (const prefix of FORBIDDEN_CACHE_PREFIXES) {
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

/**
 * Normalizes a request URL (`pathname + sorted searchParams`) for deterministic cache keys.
 */
export function normalizeCacheTarget(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl || '/', 'http://localhost');
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
    return rawUrl || '/';
  }
}

/**
 * Builds a strictly isolated cache key partitioned by userId, workspaceId, role, and target.
 * Returns null if any identity/workspace/role field is missing or if the path is forbidden.
 */
export function buildScopedApiCacheKey(scope: ApiCacheScope): string | null {
  const userId = scope.userId?.trim();
  const workspaceId = scope.workspaceId?.trim();
  const role = scope.role;
  if (
    !userId ||
    !workspaceId ||
    (role !== 'owner' && role !== 'staff' && role !== 'admin') ||
    !scope.target
  ) {
    return null;
  }
  const normalizedTarget = normalizeCacheTarget(scope.target);
  const pathname = normalizedTarget.split('?')[0] || '';
  if (!isCacheableApiPath(pathname)) {
    return null;
  }
  return `${userId}::${workspaceId}::${role}::${normalizedTarget}`;
}

/**
 * Bounded In-Memory LRU + TTL Cache with strict multi-tenant & role isolation.
 * Zero external infrastructure cost (no Redis required).
 */
export class ScopedApiCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private bypasses = 0;
  private evictions = 0;
  private invalidations = 0;

  constructor(options: { maxEntries?: number; defaultTtlMs?: number } = {}) {
    this.maxEntries = Math.max(10, options.maxEntries ?? 500);
    this.defaultTtlMs = Math.max(500, options.defaultTtlMs ?? 15_000);
  }

  get<T = unknown>(scope: ApiCacheScope, nowMs = Date.now()): T | undefined {
    const key = buildScopedApiCacheKey(scope);
    if (!key) {
      this.bypasses++;
      return undefined;
    }

    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (
      nowMs >= entry.expiresAt ||
      entry.userId !== scope.userId ||
      entry.workspaceId !== scope.workspaceId ||
      entry.role !== scope.role
    ) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    try {
      const parsed = JSON.parse(entry.serializedValue) as T;
      // Refresh LRU position
      this.store.delete(key);
      this.store.set(key, entry);
      this.hits++;
      return parsed;
    } catch {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
  }

  set<T = unknown>(
    scope: ApiCacheScope,
    value: T,
    ttlMs = this.defaultTtlMs,
    nowMs = Date.now(),
  ): boolean {
    const key = buildScopedApiCacheKey(scope);
    if (!key || ttlMs <= 0) {
      this.bypasses++;
      return false;
    }

    try {
      const serializedValue = JSON.stringify(value);
      if (this.store.has(key)) {
        this.store.delete(key);
      } else if (this.store.size >= this.maxEntries) {
        this.evictExpiredOrOldest(nowMs);
      }

      this.store.set(key, {
        serializedValue,
        expiresAt: nowMs + ttlMs,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        role: scope.role,
      });
      return true;
    } catch {
      this.bypasses++;
      return false;
    }
  }

  async getOrLoad<T>(
    context: AuthenticatedContext,
    target: string,
    loader: () => Promise<T>,
    options: {
      ttlMs?: number;
      bypassCache?: boolean;
    } = {},
  ): Promise<{ data: T; cacheStatus: 'HIT' | 'MISS' | 'BYPASS' }> {
    const scope: ApiCacheScope = {
      userId: context.user.id,
      workspaceId: context.workspace.id,
      role: context.workspace.role,
      target,
    };

    if (options.bypassCache || !buildScopedApiCacheKey(scope)) {
      this.bypasses++;
      const data = await loader();
      return { data, cacheStatus: 'BYPASS' };
    }

    const cached = this.get<T>(scope);
    if (cached !== undefined) {
      return { data: cached, cacheStatus: 'HIT' };
    }

    const fresh = await loader();
    this.set(scope, fresh, options.ttlMs ?? this.defaultTtlMs);
    return { data: fresh, cacheStatus: 'MISS' };
  }

  invalidateUser(userId: string): number {
    if (!userId) return 0;
    let removed = 0;
    for (const [k, entry] of this.store.entries()) {
      if (entry.userId === userId) {
        this.store.delete(k);
        removed++;
      }
    }
    if (removed > 0) {
      this.invalidations += removed;
    }
    return removed;
  }

  invalidateWorkspace(workspaceId: string): number {
    if (!workspaceId) return 0;
    let removed = 0;
    for (const [k, entry] of this.store.entries()) {
      if (entry.workspaceId === workspaceId) {
        this.store.delete(k);
        removed++;
      }
    }
    if (removed > 0) {
      this.invalidations += removed;
    }
    return removed;
  }

  clearAll(): void {
    const count = this.store.size;
    this.store.clear();
    if (count > 0) {
      this.invalidations += count;
    }
  }

  getStats(): ApiCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      bypasses: this.bypasses,
      evictions: this.evictions,
      invalidations: this.invalidations,
      size: this.store.size,
      maxEntries: this.maxEntries,
    };
  }

  private evictExpiredOrOldest(nowMs: number): void {
    for (const [k, entry] of this.store.entries()) {
      if (nowMs >= entry.expiresAt) {
        this.store.delete(k);
        this.evictions++;
      }
    }
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
      this.evictions++;
    }
  }
}
