/**
 * Navigation Guard & Post-Login Redirect Sanitizer
 * Strictly validates redirect paths to eliminate Open Redirects,
 * scheme injection, protocol-relative bypasses, control characters, and navigation tampering.
 */

export function sanitizePostLoginRedirect(rawPath: unknown): string {
  if (typeof rawPath !== 'string') {
    return '/';
  }

  // Reject any backslashes, control characters, or NULL bytes anywhere in the input
  // Control characters: ASCII 0-31, 127
  if (/[\\<>'"\x00-\x1F\x7F]/.test(rawPath)) {
    return '/';
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return '/';
  }

  // 1. Must start with a single slash; reject protocol-relative (//) and backslash prefixes (/\\)
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\')
  ) {
    return '/';
  }

  // 3. Reject any schemes or colons (blocks javascript:, data:, http:, etc.)
  if (trimmed.includes(':')) {
    return '/';
  }

  // 4. Test URL decoding to prevent double-encoding bypasses (e.g., %2f%2fevil.com or %00)
  try {
    const decoded = decodeURIComponent(trimmed);
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.startsWith('/\\') ||
      decoded.includes(':') ||
      /[\\<>'"\x00-\x1F\x7F]/.test(decoded)
    ) {
      return '/';
    }
  } catch {
    // Malformed URI encoding (e.g. invalid % sequences)
    return '/';
  }

  // 5. Verify against standard URL parser with a dummy base to ensure it strictly remains on the same origin
  try {
    const parsed = new URL(trimmed, 'https://internal-origin.local');
    if (parsed.origin !== 'https://internal-origin.local') {
      return '/';
    }
    const pathname = parsed.pathname;

    // Do not redirect back to public auth screens
    if (
      pathname === '/login' ||
      pathname.startsWith('/activate') ||
      pathname === '/forgot-password' ||
      pathname.startsWith('/reset-password') ||
      pathname.startsWith('/verify-email')
    ) {
      return '/';
    }

    return pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

export function managementSsoContinuation(search: string): string | null {
  const state = new URLSearchParams(search).get('sso_state');
  return state && /^[a-f0-9]{64}$/.test(state)
    ? `/api/v1/bridge/sso/authorize?state=${state}`
    : null;
}
