import type http from 'node:http';
import type { AuthService, AuthenticatedContext } from '../auth/service.js';
import type { SchedulesService } from '../schedules/service.js';
import type { AccountsService } from '../accounts/service.js';
import type { StorageService } from '../storage/service.js';
import type { AuditService } from '../audit/service.js';
import type { IssuesService } from '../issues/service.js';

export interface RouteRequestContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  pathname: string;
  requestId: string;
  isProduction: boolean;
  csrfSecret: string;
  allowedOrigins: string[];
  requireAuth: (
    authService: AuthService,
    req: http.IncomingMessage,
    isProduction: boolean,
    customCookieName?: string | undefined,
  ) => Promise<AuthenticatedContext>;
  parseJsonBody: <T = unknown>(
    req: http.IncomingMessage,
    maxBytes?: number,
  ) => Promise<T>;
  assertAllowedFields: (body: unknown, allowedFields: string[]) => void;
  authService?: AuthService | undefined;
  schedulesService?: SchedulesService | undefined;
  accountsService?: AccountsService | undefined;
  storageService?: StorageService | undefined;
  auditService?: AuditService | undefined;
  issuesService?: IssuesService | undefined;
}

export type RouteHandler = (ctx: RouteRequestContext) => Promise<boolean | void>;

/**
 * Fast O(1) exact-route lookup table + prefix-scoped module dispatcher.
 * Eliminates linear regex scanning for unrelated route prefixes.
 */
export class RouteTable {
  private readonly exactRoutes = new Map<string, RouteHandler>();
  private readonly prefixHandlers: Array<{
    prefix: string;
    handler: RouteHandler;
  }> = [];

  registerExact(
    method: string,
    pathname: string,
    handler: RouteHandler,
  ): this {
    this.exactRoutes.set(`${method.toUpperCase()} ${pathname}`, handler);
    return this;
  }

  registerPrefix(prefix: string, handler: RouteHandler): this {
    this.prefixHandlers.push({ prefix, handler });
    return this;
  }

  hasExact(method: string, pathname: string): boolean {
    return this.exactRoutes.has(`${method.toUpperCase()} ${pathname}`);
  }

  getExactCount(): number {
    return this.exactRoutes.size;
  }

  getPrefixCount(): number {
    return this.prefixHandlers.length;
  }

  async dispatch(ctx: RouteRequestContext): Promise<boolean> {
    const exactKey = `${ctx.method} ${ctx.pathname}`;
    const exactHandler = this.exactRoutes.get(exactKey);
    if (exactHandler) {
      const handled = await exactHandler(ctx);
      if (handled !== false) return true;
    }

    for (const entry of this.prefixHandlers) {
      if (
        ctx.pathname === entry.prefix ||
        ctx.pathname.startsWith(`${entry.prefix}/`)
      ) {
        const handled = await entry.handler(ctx);
        if (handled !== false) return true;
      }
    }

    return false;
  }
}
