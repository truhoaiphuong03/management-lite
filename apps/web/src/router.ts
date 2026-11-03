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
  try {
    // Strip any query string (?...) or hash fragment (#...) before matching pathname segments
    const cleanPathname = (pathname || '/').split(/[?#]/, 1)[0] || '/';

    // Normalize pathname: ensure leading slash, remove trailing slash (except root)
    const normalized =
      cleanPathname.length > 1 && cleanPathname.endsWith('/')
        ? cleanPathname.slice(0, -1)
        : cleanPathname || '/';

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
          try {
            params[paramName] = decodeURIComponent(uSeg);
          } catch {
            matches = false;
            break;
          }
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
  } catch {
    // Catch-all: malformed URI or decoding error returns 404 safely instead of crashing
    return {
      route: null,
      params: {},
      isExact: false,
    };
  }
}
