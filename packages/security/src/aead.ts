import crypto from 'node:crypto';

export interface EncryptedSecretPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

/**
 * Validates and normalizes 256-bit encryption key (32 bytes).
 */
export function normalizeEncryptionKey(keyInput: string | Buffer): Buffer {
  if (Buffer.isBuffer(keyInput)) {
    if (keyInput.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
    }
    return keyInput;
  }
  if (typeof keyInput !== 'string') {
    throw new TypeError(
      'Encryption key must be a 32-byte Buffer or hex/utf8 string',
    );
  }

  const trimmed = keyInput.trim();
  // If hex string (64 chars)
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const buf = Buffer.from(trimmed, 'utf8');
  if (buf.length === 32) {
    return buf;
  }

  throw new Error('Encryption key must be 32 bytes or 64 hex characters');
}

/**
 * Encrypts sensitive secret value using AES-256-GCM with AAD binding.
 * Generates unique 12-byte CSPRNG nonce per encryption.
 */
export function encryptSecretAead(
  plaintext: string,
  key: Buffer,
  aad: string,
): EncryptedSecretPayload {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Plaintext secret cannot be empty');
  }
  if (!key || key.length !== 32) {
    throw new Error('Invalid encryption key');
  }
  if (typeof aad !== 'string' || aad.length === 0) {
    throw new Error('AAD binding string required');
  }

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    nonce,
    authTag,
  };
}

/**
 * Decrypts sensitive secret value using AES-256-GCM with AAD verification.
 * Fails closed if ciphertext, nonce, auth tag, or AAD is tampered with or mismatched.
 */
export function decryptSecretAead(
  payload: {
    ciphertext: Buffer;
    nonce: Buffer;
    authTag: Buffer;
  },
  key: Buffer,
  aad: string,
): string {
  if (!payload || !payload.ciphertext || !payload.nonce || !payload.authTag) {
    throw new Error('Invalid encrypted payload');
  }
  if (!key || key.length !== 32) {
    throw new Error('Invalid encryption key');
  }
  if (typeof aad !== 'string' || aad.length === 0) {
    throw new Error('AAD binding string required');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(payload.authTag);

  const decrypted = Buffer.concat([
    decipher.update(payload.ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
