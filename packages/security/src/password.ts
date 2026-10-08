import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

/**
 * Argon2id algorithm constant (value 2 in @node-rs/argon2 Algorithm enum).
 */
export const ARGON2ID_ALGORITHM: Algorithm = 2 as unknown as Algorithm;

/**
 * Standard OWASP-aligned configuration for Argon2id password hashing.
 * - memoryCost: 19456 KiB (~19 MiB)
 * - timeCost: 2 iterations
 * - parallelism: 1 thread
 * - algorithm: Argon2id
 */
export const ARGON2ID_OPTIONS = {
  algorithm: ARGON2ID_ALGORITHM,
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates minimum password policy requirements.
 * - Must be at least 8 characters
 * - Must not be empty or whitespace only
 * - Maximum length 128 characters (to mitigate DoS during hashing)
 */
export function validatePasswordStrength(
  password: unknown,
): PasswordValidationResult {
  if (typeof password !== 'string') {
    return { valid: false, reason: 'Password must be a string' };
  }
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return {
      valid: false,
      reason: 'Password must be at least 8 characters long',
    };
  }
  if (password.length > 128) {
    return {
      valid: false,
      reason: 'Password must not exceed 128 characters',
    };
  }
  return { valid: true };
}

/**
 * Hashes a plaintext password using Argon2id with a secure per-hash random salt.
 * Never logs or retains the plaintext password.
 */
export async function hashPassword(password: string): Promise<string> {
  const validation = validatePasswordStrength(password);
  if (!validation.valid) {
    throw new Error(validation.reason || 'Invalid password');
  }

  return hash(password, {
    algorithm: ARGON2ID_OPTIONS.algorithm,
    memoryCost: ARGON2ID_OPTIONS.memoryCost,
    timeCost: ARGON2ID_OPTIONS.timeCost,
    outputLen: ARGON2ID_OPTIONS.outputLen,
    parallelism: ARGON2ID_OPTIONS.parallelism,
  });
}

/**
 * Verifies a plaintext password against an Argon2id hash string in constant-time.
 * Safely handles invalid or malformed hashes by returning false rather than throwing.
 */
export async function verifyPassword(
  password: string,
  hashString: string,
): Promise<boolean> {
  if (
    typeof password !== 'string' ||
    typeof hashString !== 'string' ||
    hashString.length === 0
  ) {
    return false;
  }

  try {
    return await verify(hashString, password);
  } catch {
    // Malformed hash or invalid algorithm returns false safely
    return false;
  }
}
