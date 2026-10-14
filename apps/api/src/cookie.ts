export const DEFAULT_SESSION_MAX_AGE_SECONDS = 43200; // 12 hours standard session ceiling
export const DEFAULT_REMEMBER_ME_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days persistent session
export const MIN_REMEMBER_ME_MAX_AGE_SECONDS = 24 * 60 * 60; // 1 day minimum
export const MAX_REMEMBER_ME_MAX_AGE_SECONDS = 90 * 24 * 60 * 60; // 90 days maximum (never infinite)

export function getRememberMeMaxAgeSeconds(): number {
  const raw = process.env['SESSION_REMEMBER_MAX_AGE_SECONDS']?.trim();
  if (!raw) return DEFAULT_REMEMBER_ME_MAX_AGE_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_REMEMBER_ME_MAX_AGE_SECONDS) {
    return DEFAULT_REMEMBER_ME_MAX_AGE_SECONDS;
  }
  return Math.min(parsed, MAX_REMEMBER_ME_MAX_AGE_SECONDS);
}

export interface CookieOptions {
  isProduction?: boolean | undefined;
  maxAgeSeconds?: number | undefined;
  path?: string | undefined;
  sameSite?: ('Lax' | 'Strict' | 'None') | undefined;
  httpOnly?: boolean | undefined;
  secure?: boolean | undefined;
  cookieName?: string | undefined;
  rememberMe?: boolean | undefined;
  sessionOnly?: boolean | undefined;
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
  const rememberMe = options.rememberMe === true;
  const sessionOnly = options.sessionOnly === true && !rememberMe;
  const maxAge =
    options.maxAgeSeconds ??
    (rememberMe
      ? getRememberMeMaxAgeSeconds()
      : DEFAULT_SESSION_MAX_AGE_SECONDS);
  const path = options.path ?? '/';
  const sameSite = options.sameSite ?? 'Lax';
  const secure = options.secure ?? isProduction;

  const parts = [`${cookieName}=${encodeURIComponent(token)}`, `Path=${path}`];

  if (!sessionOnly) {
    parts.push(`Max-Age=${maxAge}`);
    if (rememberMe) {
      const expiresDate = new Date(Date.now() + maxAge * 1000);
      parts.push(`Expires=${expiresDate.toUTCString()}`);
    }
  }

  parts.push(`SameSite=${sameSite}`, 'HttpOnly');

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
