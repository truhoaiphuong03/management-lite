/**
 * Reports uncaught browser errors to the Owner log console
 * (POST /api/v1/system/client-errors). Silent, throttled and deduplicated;
 * it never throws and does nothing when the user is not signed in.
 */
const MAX_REPORTS_PER_PAGE = 10;
const DEDUPE_MS = 60_000;

let installed = false;
let sent = 0;
let csrf: string | null = null;
let csrfTried = false;
const recent = new Map<string, number>();

async function ensureCsrf(): Promise<string | null> {
  if (csrf || csrfTried) return csrf;
  csrfTried = true;
  try {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    const body = await res.json();
    csrf =
      typeof body?.data?.csrf_token === 'string' ? body.data.csrf_token : null;
  } catch {
    csrf = null;
  }
  return csrf;
}

async function report(message: string, stack: string | undefined) {
  try {
    if (sent >= MAX_REPORTS_PER_PAGE) return;
    const key = `${message}|${(stack ?? '').split('\n')[1] ?? ''}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(key, now);
    const token = await ensureCsrf();
    if (!token) return;
    sent += 1;
    await fetch('/api/v1/system/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        message: message.slice(0, 600),
        stack: stack?.slice(0, 4000),
        url: window.location.pathname,
      }),
    });
  } catch {
    /* reporting must never throw */
  }
}

export function installClientErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    if (!e.message || e.message === 'Script error.') return;
    void report(
      e.message,
      e.error instanceof Error ? e.error.stack : undefined,
    );
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    void report(
      r instanceof Error ? r.message : `Unhandled rejection: ${String(r)}`,
      r instanceof Error ? r.stack : undefined,
    );
  });
}
