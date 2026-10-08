import crypto from 'node:crypto';

/**
 * Generates a cryptographically secure pseudo-random token with at least 256 bits of entropy.
 * Default 32 bytes = 256 bits -> 64-character lowercase hexadecimal string.
 */
export function generateCsprngToken(byteLength = 32): string {
  if (byteLength < 32) {
    throw new Error(
      `CSPRNG token entropy must be at least 32 bytes (256 bits), received: ${byteLength}`,
    );
  }
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Computes deterministic SHA-256 hash of a sensitive token (activation token, session token).
 * Only the hash is stored in the database or logged in audit metadata.
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
 * Masks a secret string for safe logging/display (e.g., showing only prefix/suffix).
 * Returns '***' for very short secrets.
 */
export function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '***';
  }
  if (value.length <= 8) {
    return '***';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
