import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as argon2 from '@node-rs/argon2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('validatePasswordStrength enforces minimum length, non-empty, and max bounds', async () => {
  const { validatePasswordStrength } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  assert.equal(validatePasswordStrength(null).valid, false);
  assert.equal(validatePasswordStrength(undefined).valid, false);
  assert.equal(validatePasswordStrength(12345678).valid, false);
  assert.equal(validatePasswordStrength('').valid, false);
  assert.equal(validatePasswordStrength('short').valid, false);
  assert.equal(validatePasswordStrength('   ').valid, false);

  // Exactly 8 characters
  assert.equal(validatePasswordStrength('12345678').valid, true);
  // Valid strong password
  assert.equal(
    validatePasswordStrength('Correct-Horse-Battery-Staple-2026!').valid,
    true,
  );

  // Exceeds 128 characters
  const tooLong = 'a'.repeat(129);
  assert.equal(validatePasswordStrength(tooLong).valid, false);
});

test('ARGON2ID_ALGORITHM matches official @node-rs/argon2 enum and produces genuine Argon2id hash', async () => {
  const { ARGON2ID_ALGORITHM, hashPassword, verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  // Verify against official enum value without type-casts
  assert.equal(ARGON2ID_ALGORITHM, argon2.Algorithm.Argon2id);
  assert.equal(ARGON2ID_ALGORITHM, 2);

  const plain = 'SecureP@ssw0rd2026';
  const hash1 = await hashPassword(plain);
  const hash2 = await hashPassword(plain);

  // PHC format check: strictly argon2id identifier
  assert.match(
    hash1,
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
  );
  assert.match(
    hash2,
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
  );

  // Verify decoded hash options confirm genuine Argon2id algorithm
  const parsed = argon2.parseOptions(hash1);
  assert.equal(parsed.algorithm, argon2.Algorithm.Argon2id);
  assert.equal(parsed.memoryCost, 19456);
  assert.equal(parsed.timeCost, 2);
  assert.equal(parsed.parallelism, 1);

  // Per-hash random salt: hashes must be different even for identical passwords
  assert.notEqual(hash1, hash2);

  // Verification
  assert.equal(await verifyPassword(plain, hash1), true);
  assert.equal(await verifyPassword(plain, hash2), true);
  assert.equal(await verifyPassword('WrongPassword123', hash1), false);
  assert.equal(await verifyPassword('', hash1), false);
});

test('verifyPassword handles malformed hashes safely without throwing', async () => {
  const { verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  assert.equal(await verifyPassword('password', 'not-a-hash'), false);
  assert.equal(await verifyPassword('password', '$argon2id$invalid'), false);
  assert.equal(await verifyPassword('password', ''), false);
  assert.equal(await verifyPassword('password', null), false);
  assert.equal(await verifyPassword(null, 'valid_hash'), false);
});

test('generateCsprngToken produces >= 256 bits of entropy and enforces strict integer bounds', async () => {
  const {
    generateCsprngToken,
    MIN_CSPRNG_TOKEN_BYTES,
    MAX_CSPRNG_TOKEN_BYTES,
  } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  assert.equal(MIN_CSPRNG_TOKEN_BYTES, 32);
  assert.equal(MAX_CSPRNG_TOKEN_BYTES, 1024);

  // Default byteLength = 32 bytes (256 bits entropy) -> 64 hex characters
  const tokenDefault = generateCsprngToken();
  assert.equal(tokenDefault.length, 64);
  assert.match(tokenDefault, /^[a-f0-9]{64}$/);

  const token1 = generateCsprngToken(32);
  const token2 = generateCsprngToken(32);
  assert.equal(token1.length, 64);
  assert.match(token1, /^[a-f0-9]{64}$/);
  assert.notEqual(token1, token2);

  // Higher valid bounds (64 bytes = 128 hex chars, 1024 bytes = 2048 hex chars)
  const token64 = generateCsprngToken(64);
  assert.equal(token64.length, 128);
  assert.match(token64, /^[a-f0-9]{128}$/);

  const tokenMax = generateCsprngToken(1024);
  assert.equal(tokenMax.length, 2048);
  assert.match(tokenMax, /^[a-f0-9]{2048}$/);

  // RangeError: < 32 or > 1024 bytes
  assert.throws(() => generateCsprngToken(31), { name: 'RangeError' });
  assert.throws(() => generateCsprngToken(0), { name: 'RangeError' });
  assert.throws(() => generateCsprngToken(-32), { name: 'RangeError' });
  assert.throws(() => generateCsprngToken(1025), { name: 'RangeError' });

  // TypeError: non-safe integers (floats, NaN, Infinity, strings, null)
  assert.throws(() => generateCsprngToken(32.5), { name: 'TypeError' });
  assert.throws(() => generateCsprngToken(NaN), { name: 'TypeError' });
  assert.throws(() => generateCsprngToken(Infinity), { name: 'TypeError' });
  assert.throws(() => generateCsprngToken(-Infinity), { name: 'TypeError' });
  assert.throws(() => generateCsprngToken('32'), { name: 'TypeError' });
  assert.throws(() => generateCsprngToken(null), { name: 'TypeError' });
  assert.throws(() => generateCsprngToken({}), { name: 'TypeError' });
});

test('hashToken produces deterministic SHA-256 hash', async () => {
  const { hashToken } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  const token =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const hash1 = hashToken(token);
  const hash2 = hashToken(token);

  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[a-f0-9]{64}$/);
  assert.equal(hash1, hash2);

  assert.throws(() => hashToken(''), /non-empty string/);
  assert.throws(() => hashToken(null), /non-empty string/);
});

test('timingSafeEqualTokens compares strings safely and correctly', async () => {
  const { timingSafeEqualTokens } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  const h1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const h2 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const h3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab';
  const hShort = 'aaaaaaaa';

  assert.equal(timingSafeEqualTokens(h1, h2), true);
  assert.equal(timingSafeEqualTokens(h1, h3), false);
  assert.equal(timingSafeEqualTokens(h1, hShort), false);
  assert.equal(timingSafeEqualTokens(null, h1), false);
});

test('maskSecret entirely redacts secrets without leaking prefix, suffix, or characters', async () => {
  const { maskSecret } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  const sensitiveValues = [
    'secret_session_token_1234567890abcdef',
    'activation_token_xyz987654321',
    'super_secret_password_phrase',
    'short',
    'a',
    '12345678',
  ];

  for (const secret of sensitiveValues) {
    const masked = maskSecret(secret);
    // Sentinel string
    assert.equal(masked, '[REDACTED]');

    // Guarantee zero substring of the secret (from 1 character up to full length) appears in the masked output
    assert.equal(
      masked.includes(secret),
      false,
      'Masked value must not include secret',
    );
    assert.equal(
      masked.includes(secret.slice(0, 4)),
      false,
      'Masked value must not include secret prefix',
    );
    assert.equal(
      masked.includes(secret.slice(-4)),
      false,
      'Masked value must not include secret suffix',
    );
  }

  // Handles non-string or empty inputs safely
  assert.equal(maskSecret(''), '[REDACTED]');
  assert.equal(maskSecret(null), '[REDACTED]');
  assert.equal(maskSecret(undefined), '[REDACTED]');
  assert.equal(maskSecret(12345), '[REDACTED]');
  assert.equal(maskSecret({ secret: true }), '[REDACTED]');
});
