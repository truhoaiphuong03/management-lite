import { ROUTE_REGISTRY } from './types.js';
import type { RouteMeta } from './types.js';

export interface RouteMatchResult {
  route: RouteMeta | null;
  params: Record<string, string>;
  isExact: boolean;
}

/**
 * Matches a URL pathname against the ROUTE_REGISTRY.
 * Supports exact paths (e.g. '/clock') and dynamic patterns (e.g. '/reports/:id').
 */
export function matchRoute(pathname: string): RouteMatchResult {
  // Normalize pathname: ensure leading slash, remove trailing slash (except root)
  const normalized =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname || '/';

  // 1. Direct exact match
  if (ROUTE_REGISTRY[normalized]) {
    return {
      route: ROUTE_REGISTRY[normalized],
      params: {},
      isExact: true,
    };
  }

  // 2. Dynamic pattern matching (e.g., /reports/:id, /employees/:id, /payroll/:id, /accounts/:id)
  const pathSegments = normalized.split('/').filter(Boolean);

  for (const pattern of Object.keys(ROUTE_REGISTRY)) {
    if (!pattern.includes(':')) continue;

    const patternSegments = pattern.split('/').filter(Boolean);
    if (patternSegments.length !== pathSegments.length) continue;

    const params: Record<string, string> = {};
    let matches = true;

    for (let i = 0; i < patternSegments.length; i++) {
      const pSeg = patternSegments[i];
      const uSeg = pathSegments[i];

      if (!pSeg || !uSeg) {
        matches = false;
        break;
      }

      if (pSeg.startsWith(':')) {
        const paramName = pSeg.slice(1);
        params[paramName] = decodeURIComponent(uSeg);
      } else if (pSeg !== uSeg) {
        matches = false;
        break;
      }
    }

    if (matches) {
      const matchedRoute = ROUTE_REGISTRY[pattern];
      if (matchedRoute) {
        return {
          route: matchedRoute,
          params,
          isExact: false,
        };
      }
    }
  }

  // 3. No match found (404)
  return {
    route: null,
    params: {},
    isExact: false,
  };
}
