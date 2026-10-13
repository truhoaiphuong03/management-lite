export interface CookieOptions {
  isProduction?: boolean | undefined;
  maxAgeSeconds?: number | undefined;
  path?: string | undefined;
  sameSite?: ('Lax' | 'Strict' | 'None') | undefined;
  httpOnly?: boolean | undefined;
  secure?: boolean | undefined;
  cookieName?: string | undefined;
}

/**
 * Parses the raw Cookie header string into key-value pairs.
 */
export function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key.length > 0) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

/**
 * Returns the canonical session cookie name for the environment.
 * Supports configurable cookie names via customCookieName or SESSION_COOKIE_NAME env var.
 * Uses __Host- prefix in production with HTTPS.
 */
export function getSessionCookieName(
  isProduction: boolean,
  customCookieName?: string,
): string {
  const envName = (
    customCookieName ??
    process.env['SESSION_COOKIE_NAME'] ??
    ''
  ).trim();
  if (envName.length > 0) {
    if (isProduction && !envName.startsWith('__Host-')) {
      return `__Host-${envName}`;
    }
    return envName;
  }
  return isProduction ? '__Host-mglite_session' : 'mglite_session';
}

/**
 * Serializes a session token into an HttpOnly, SameSite=Lax cookie header string.
 */
export function serializeSessionCookie(
  token: string,
  options: CookieOptions = {},
): string {
  const isProduction = options.isProduction ?? false;
  const cookieName = options.cookieName ?? getSessionCookieName(isProduction);
  const maxAge = options.maxAgeSeconds ?? 43200; // 12 hours absolute timeout default
  const path = options.path ?? '/';
  const sameSite = options.sameSite ?? 'Lax';
  const secure = options.secure ?? isProduction;

  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
    'HttpOnly',
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Serializes an expired cookie header string to immediately clear the session on the client.
 */
export function serializeClearSessionCookie(
  options: CookieOptions = {},
): string {
  const isProduction = options.isProduction ?? false;
  const cookieName = options.cookieName ?? getSessionCookieName(isProduction);
  const path = options.path ?? '/';
  const sameSite = options.sameSite ?? 'Lax';
  const secure = options.secure ?? isProduction;

  const parts = [
    `${cookieName}=`,
    `Path=${path}`,
    'Max-Age=0',
    `SameSite=${sameSite}`,
    'HttpOnly',
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
