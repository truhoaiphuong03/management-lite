import crypto from 'node:crypto';

export const MIN_CSPRNG_TOKEN_BYTES = 32;
export const MAX_CSPRNG_TOKEN_BYTES = 1024;

/**
 * Generates a cryptographically secure pseudo-random token with at least 256 bits of entropy.
 * Default byteLength is 32 bytes (256 bits), producing a 64-character hexadecimal string.
 * Validates that byteLength is a finite safe integer between 32 and 1024 bytes.
 */
export function generateCsprngToken(
  byteLength: number = MIN_CSPRNG_TOKEN_BYTES,
): string {
  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength)) {
    throw new TypeError(
      `byteLength must be a finite safe integer, received: ${String(byteLength)}`,
    );
  }
  if (
    byteLength < MIN_CSPRNG_TOKEN_BYTES ||
    byteLength > MAX_CSPRNG_TOKEN_BYTES
  ) {
    throw new RangeError(
      `byteLength must be between ${MIN_CSPRNG_TOKEN_BYTES} and ${MAX_CSPRNG_TOKEN_BYTES} bytes, received: ${byteLength}`,
    );
  }
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Computes deterministic SHA-256 hash of a sensitive token (activation token, session token).
 * Only the cryptographic hash is stored in the database for verification.
 * Raw tokens, hashes, and secret-derived values must never be logged or exported to telemetry.
 */
export function hashToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Token must be a non-empty string');
  }
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Performs timing-safe comparison of two hash strings to prevent side-channel timing attacks.
 */
export function timingSafeEqualTokens(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Redacts a secret or sensitive value entirely to prevent disclosure.
 * Returns a fixed sentinel string ('[REDACTED]') so that zero characters,
 * prefixes, suffixes, or length indicators of the secret are ever exposed.
 * Note: Raw secrets, tokens, and secret-derived values should never be logged.
 */
export function maskSecret(value?: unknown): string {
  void value;
  return '[REDACTED]';
}
