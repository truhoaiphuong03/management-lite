#!/usr/bin/env node
/**
 * Management Lite - key escrow helper (OWNER-RUN ONLY).
 *
 * Seals selected variables from an env file into ONE passphrase-protected file (scrypt + AES-256-GCM).
 * It never prints secret values. It is meant to be run by the Owner, so that no AI session ever sees the keys.
 *
 *   node key-escrow.mjs seal    --env <api.env> --out <file.escrow> [--vars A,B,C]
 *   node key-escrow.mjs verify  --escrow <file.escrow> [--env <api.env>]
 *   node key-escrow.mjs restore --escrow <file.escrow> --out <new-env-file>
 *
 * Passphrase: environment variable ESCROW_PASSPHRASE (for automated tests) or a hidden prompt.
 * Fingerprints shown by `verify` are the first 8 hex chars of SHA-256("ml-escrow-fp:" + name + ":" + value).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VARS = [
  'ACCOUNT_SECRET_KEY',
  'STORAGE_DRIVE_ENCRYPTION_KEY_HEX',
  'HP_BRIDGE_SECRET',
  'CSRF_SECRET',
  'GOOGLE_CLIENT_SECRET',
];
const KDF = { N: 1 << 17, r: 8, p: 1 };
const MAGIC = 'ML-ESCROW';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m || raw.trim().startsWith('#')) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function fingerprint(name, value) {
  return crypto
    .createHash('sha256')
    .update(`ml-escrow-fp:${name}:${value}`)
    .digest('hex')
    .slice(0, 8);
}

async function readPassphrase(confirm) {
  const fromEnv = process.env['ESCROW_PASSPHRASE'];
  const read = fromEnv
    ? fromEnv
    : await new Promise((resolve) => {
        process.stdout.write('Passphrase (hidden): ');
        const stdin = process.stdin;
        if (!stdin.isTTY)
          fail('no TTY for hidden prompt; set ESCROW_PASSPHRASE');
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let buf = '';
        stdin.on('data', function onData(ch) {
          if (ch === '\r' || ch === '\n') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(buf);
          } else if (ch === '\u0003') {
            process.exit(130);
          } else if (ch === '\u007f' || ch === '\b') {
            buf = buf.slice(0, -1);
          } else {
            buf += ch;
          }
        });
      });
  if (read.length < 16) fail('passphrase must be at least 16 characters');
  if (confirm && !fromEnv) {
    const again = await readPassphrase(false);
    if (again !== read) fail('passphrases do not match');
  }
  return read;
}

function deriveKey(passphrase, salt, kdf) {
  return crypto.scryptSync(passphrase, salt, 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 512 * 1024 * 1024,
  });
}

function seal(payload, names, passphrase) {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const header = {
    magic: MAGIC,
    v: 1,
    kdf: { alg: 'scrypt', ...KDF, salt_b64: salt.toString('base64') },
    vars: names,
    created_utc: new Date().toISOString(),
  };
  const key = deriveKey(passphrase, salt, header.kdf);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    ...header,
    nonce_b64: nonce.toString('base64'),
    tag_b64: cipher.getAuthTag().toString('base64'),
    ct_b64: ct.toString('base64'),
  };
}

function unseal(file, passphrase) {
  const { nonce_b64, tag_b64, ct_b64, ...header } = file;
  if (header.magic !== MAGIC || header.v !== 1) fail('not an ML escrow file');
  const key = deriveKey(
    passphrase,
    Buffer.from(header.kdf.salt_b64, 'base64'),
    header.kdf,
  );
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonce_b64, 'base64'),
  );
  decipher.setAAD(Buffer.from(JSON.stringify(header)));
  decipher.setAuthTag(Buffer.from(tag_b64, 'base64'));
  try {
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ct_b64, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(pt.toString('utf8'));
  } catch {
    fail('decryption failed (wrong passphrase or file was modified)');
  }
  return undefined;
}

const cmd = process.argv[2];

if (cmd === 'seal') {
  const envPath = arg('env');
  const out = arg('out');
  if (!envPath || !out) fail('--env and --out are required');
  if (fs.existsSync(out)) fail(`refusing to overwrite ${out}`);
  const names = (arg('vars') ? arg('vars').split(',') : DEFAULT_VARS).map((s) =>
    s.trim(),
  );
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const payload = {};
  const missing = [];
  for (const n of names) {
    if (env[n]) payload[n] = env[n];
    else missing.push(n);
  }
  if (Object.keys(payload).length === 0)
    fail('none of the requested variables found');
  const pass = await readPassphrase(true);
  const file = seal(payload, Object.keys(payload), pass);
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n', { flag: 'wx' });
  console.log(
    `sealed ${Object.keys(payload).length} variable(s) -> ${path.resolve(out)}`,
  );
  if (missing.length)
    console.log(`not found in env (skipped): ${missing.join(', ')}`);
  for (const n of Object.keys(payload))
    console.log(`  ${n}  fingerprint=${fingerprint(n, payload[n])}`);
} else if (cmd === 'verify') {
  const escrow = arg('escrow');
  if (!escrow) fail('--escrow is required');
  const pass = await readPassphrase(false);
  const data = unseal(JSON.parse(fs.readFileSync(escrow, 'utf8')), pass);
  const envPath = arg('env');
  const env = envPath ? parseEnv(fs.readFileSync(envPath, 'utf8')) : null;
  console.log(`escrow OK: ${Object.keys(data).length} variable(s)`);
  for (const [n, v] of Object.entries(data)) {
    let status = '';
    if (env)
      status = !(n in env)
        ? '  [MISSING in env]'
        : env[n] === v
          ? '  [MATCH env]'
          : '  [DIFFERS from env]';
    console.log(`  ${n}  fingerprint=${fingerprint(n, v)}${status}`);
  }
} else if (cmd === 'restore') {
  const escrow = arg('escrow');
  const out = arg('out');
  if (!escrow || !out) fail('--escrow and --out are required');
  if (fs.existsSync(out)) fail(`refusing to overwrite ${out}`);
  const pass = await readPassphrase(false);
  const data = unseal(JSON.parse(fs.readFileSync(escrow, 'utf8')), pass);
  const text =
    Object.entries(data)
      .map(([n, v]) => `${n}=${v}`)
      .join('\n') + '\n';
  fs.writeFileSync(out, text, { flag: 'wx', mode: 0o600 });
  console.log(
    `restored ${Object.keys(data).length} variable(s) to ${path.resolve(out)} (plaintext - protect it!)`,
  );
} else {
  console.error(
    'usage: key-escrow.mjs seal|verify|restore (see header comment)',
  );
  process.exit(2);
}
