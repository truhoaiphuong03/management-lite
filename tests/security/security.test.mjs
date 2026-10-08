import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('hashPassword produces standard Argon2id hash with per-hash unique salt', async () => {
  const { hashPassword, verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  const plain = 'SecureP@ssw0rd2026';
  const hash1 = await hashPassword(plain);
  const hash2 = await hashPassword(plain);

  // Format check: standard Argon2id prefix with m=19456, t=2, p=1
  assert.ok(hash1.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'));
  assert.ok(hash2.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'));

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

test('generateCsprngToken produces >= 256 bits of entropy with unique values', async () => {
  const { generateCsprngToken } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  const token1 = generateCsprngToken();
  const token2 = generateCsprngToken();

  // 32 bytes = 256 bits = 64 hex characters
  assert.equal(token1.length, 64);
  assert.match(token1, /^[a-f0-9]{64}$/);
  assert.equal(token2.length, 64);
  assert.match(token2, /^[a-f0-9]{64}$/);

  // Distinct CSPRNG tokens
  assert.notEqual(token1, token2);

  // Throws if entropy requested is < 32 bytes
  assert.throws(() => generateCsprngToken(16), /at least 32 bytes/);
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

test('maskSecret redacts secret values to prevent plaintext leakage', async () => {
  const { maskSecret } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  assert.equal(maskSecret('secret-token-value-12345'), 'secr...2345');
  assert.equal(maskSecret('short'), '***');
  assert.equal(maskSecret(''), '***');
  assert.equal(maskSecret(null), '***');
});
