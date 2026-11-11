#!/usr/bin/env node
/**
 * Management Lite — Offsite Backup Core (AES-256-GCM + scrypt + GitHub Releases)
 *
 * Provides:
 * - Passphrase file validation (rejects files inside any Git worktree/repo)
 * - AES-256-GCM + scrypt encryption & decryption with authenticated header (AAD)
 * - Chunk splitting & reassembly for large archives (> 1.9 GB)
 * - Retention policy calculation (keep latest 14 daily backups + 1 per month)
 * - GitHub Release upload, download, round-trip verification (`pg_restore --list`), and pruning
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAGIC_BYTES = Buffer.from('MLOFFSITE01\0', 'ascii'); // 12 bytes
export const HEADER_MAGIC = 'ML-OFFSITE-BACKUP';
export const HEADER_VERSION = 1;
export const DEFAULT_KDF = { N: 1 << 17, r: 8, p: 1 };
export const DEFAULT_MAX_CHUNK_BYTES = 1_900_000_000; // 1.9 GB
export const DEFAULT_REPO = 'truhoaiphuong03/management-lite-backups';

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function isInsideGitWorkTree(targetPath) {
  const resolved = path.resolve(targetPath);
  let dir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);

  // Walk upward checking for .git folder or file first (fast & offline-safe)
  let probe = dir;
  while (true) {
    if (fs.existsSync(path.join(probe, '.git'))) {
      return true;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  try {
    const out = execFileSync(
      'git',
      ['-C', dir, 'rev-parse', '--is-inside-work-tree'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString('utf8')
      .trim();
    return out === 'true';
  } catch {
    return false;
  }
}

export function readAndValidatePassphraseFile(passphraseFilePath) {
  if (!passphraseFilePath) {
    throw new Error('Passphrase file path is required.');
  }
  const resolved = path.resolve(passphraseFilePath);
  if (isInsideGitWorkTree(resolved)) {
    throw new Error(
      `REFUSED_PASSPHRASE_IN_GIT: Passphrase file "${resolved}" is inside a Git repository. Store it outside any Git worktree (e.g. C:\\HP-Offsite\\passphrase.txt).`,
    );
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Passphrase file not found: "${resolved}"`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Passphrase path is not a regular file: "${resolved}"`);
  }
  const passphrase = fs.readFileSync(resolved, 'utf8').trim();
  if (passphrase.length < 16) {
    throw new Error(
      'Passphrase must be at least 16 characters long (after trimming whitespace).',
    );
  }
  return passphrase;
}

export function deriveKeyScrypt(passphrase, salt, kdf = DEFAULT_KDF) {
  if (
    !kdf ||
    kdf.alg !== 'scrypt' ||
    !Number.isInteger(kdf.N) ||
    kdf.N < 1 << 14 ||
    kdf.N > 1 << 20 ||
    (kdf.N & (kdf.N - 1)) !== 0 ||
    !Number.isInteger(kdf.r) ||
    kdf.r < 1 ||
    kdf.r > 16 ||
    !Number.isInteger(kdf.p) ||
    kdf.p < 1 ||
    kdf.p > 4
  ) {
    throw new Error('Invalid or unsafe scrypt KDF parameters in header.');
  }
  return crypto.scryptSync(passphrase, salt, 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 512 * 1024 * 1024,
  });
}

export function encryptBuffer(
  plaintextBuf,
  passphrase,
  metadata = {},
  kdfParams = DEFAULT_KDF,
) {
  if (! passphrase || passphrase.length < 16) {
    throw new Error('Passphrase must be at least 16 characters.');
  }
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const plaintextSha256 = sha256Buffer(plaintextBuf);

  const headerObj = {
    magic: HEADER_MAGIC,
    v: HEADER_VERSION,
    cipher: 'aes-256-gcm',
    kdf: {
      alg: 'scrypt',
      N: kdfParams.N,
      r: kdfParams.r,
      p: kdfParams.p,
      salt_b64: salt.toString('base64'),
    },
    nonce_b64: nonce.toString('base64'),
    plaintext_sha256: plaintextSha256,
    plaintext_size: plaintextBuf.length,
    original_name: metadata.originalName || 'backup.dump',
    created_utc: metadata.createdUtc || new Date().toISOString(),
  };

  const headerBytes = Buffer.from(JSON.stringify(headerObj), 'utf8');
  const headerLenBuf = Buffer.alloc(4);
  headerLenBuf.writeUInt32BE(headerBytes.length, 0);

  const key = deriveKeyScrypt(passphrase, salt, headerObj.kdf);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(headerBytes);

  const ciphertext = Buffer.concat([
    cipher.update(plaintextBuf),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  return {
    encryptedBuffer: Buffer.concat([
      MAGIC_BYTES,
      headerLenBuf,
      headerBytes,
      authTag,
      ciphertext,
    ]),
    header: headerObj,
  };
}

export function decryptBuffer(encryptedBuf, passphrase) {
  if (!passphrase || passphrase.length < 16) {
    throw new Error('Decryption failed: invalid passphrase.');
  }
  const minLength = MAGIC_BYTES.length + 4 + 2 + 16;
  if (!Buffer.isBuffer(encryptedBuf) || encryptedBuf.length < minLength) {
    throw new Error('Encrypted payload is truncated or invalid.');
  }
  const magicSlice = encryptedBuf.subarray(0, MAGIC_BYTES.length);
  if (!magicSlice.equals(MAGIC_BYTES)) {
    throw new Error('Unrecognized file magic (not an ML-OFFSITE-BACKUP file).');
  }
  const headerLen = encryptedBuf.readUInt32BE(MAGIC_BYTES.length);
  const headerStart = MAGIC_BYTES.length + 4;
  const headerEnd = headerStart + headerLen;
  if (headerLen <= 0 || headerLen > 1024 * 1024 || headerEnd + 16 > encryptedBuf.length) {
    throw new Error('Corrupted encrypted header length.');
  }

  const headerBytes = encryptedBuf.subarray(headerStart, headerEnd);
  let header;
  try {
    header = JSON.parse(headerBytes.toString('utf8'));
  } catch {
    throw new Error('Corrupted encrypted header JSON.');
  }

  if (
    header?.magic !== HEADER_MAGIC ||
    header?.v !== HEADER_VERSION ||
    header?.cipher !== 'aes-256-gcm' ||
    typeof header?.nonce_b64 !== 'string' ||
    typeof header?.kdf?.salt_b64 !== 'string'
  ) {
    throw new Error('Unsupported or malformed encryption header.');
  }

  const authTag = encryptedBuf.subarray(headerEnd, headerEnd + 16);
  const ciphertext = encryptedBuf.subarray(headerEnd + 16);
  const salt = Buffer.from(header.kdf.salt_b64, 'base64');
  const nonce = Buffer.from(header.nonce_b64, 'base64');

  const key = deriveKeyScrypt(passphrase, salt, header.kdf);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(authTag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      'DECRYPTION_AUTH_FAILED: Wrong passphrase or ciphertext was tampered with.',
    );
  }

  const actualSha256 = sha256Buffer(plaintext);
  if (header.plaintext_sha256 && actualSha256 !== header.plaintext_sha256) {
    throw new Error(
      `Plaintext SHA-256 mismatch after decryption (expected ${header.plaintext_sha256}, got ${actualSha256}).`,
    );
  }

  return {
    plaintextBuffer: plaintext,
    header,
  };
}

export async function encryptFile({
  inputPath,
  outputPath,
  passphraseFile,
  maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES,
  kdfParams = DEFAULT_KDF,
}) {
  const passphrase = readAndValidatePassphraseFile(passphraseFile);
  const resolvedIn = path.resolve(inputPath);
  const resolvedOut = path.resolve(outputPath);

  if (isInsideGitWorkTree(resolvedOut)) {
    throw new Error(
      `REFUSED_OUTPUT_IN_GIT: Output path "${resolvedOut}" is inside a Git repository.`,
    );
  }

  const plaintextBuf = fs.readFileSync(resolvedIn);
  const { encryptedBuffer, header } = encryptBuffer(
    plaintextBuf,
    passphrase,
    { originalName: path.basename(resolvedIn) },
    kdfParams,
  );

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  const encryptedSha256 = sha256Buffer(encryptedBuffer);
  const parts = [];

  if (encryptedBuffer.length > maxChunkBytes) {
    let offset = 0;
    let index = 1;
    while (offset < encryptedBuffer.length) {
      const slice = encryptedBuffer.subarray(offset, offset + maxChunkBytes);
      const partSuffix = `.part${String(index).padStart(3, '0')}`;
      const partPath = `${resolvedOut}${partSuffix}`;
      fs.writeFileSync(partPath, slice);
      parts.push({
        name: path.basename(partPath),
        path: partPath,
        size: slice.length,
        sha256: sha256Buffer(slice),
      });
      offset += slice.length;
      index += 1;
    }
  } else {
    fs.writeFileSync(resolvedOut, encryptedBuffer);
    parts.push({
      name: path.basename(resolvedOut),
      path: resolvedOut,
      size: encryptedBuffer.length,
      sha256: encryptedSha256,
    });
  }

  const manifest = {
    schema: 'ml-offsite-manifest-v1',
    created_utc: header.created_utc,
    original_name: header.original_name,
    plaintext_size: header.plaintext_size,
    plaintext_sha256: header.plaintext_sha256,
    encrypted_name: path.basename(resolvedOut),
    encrypted_size: encryptedBuffer.length,
    encrypted_sha256: encryptedSha256,
    chunked: encryptedBuffer.length > maxChunkBytes,
    parts: parts.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
  };

  const manifestPath = `${resolvedOut}.sha256.json`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    manifest,
    manifestPath,
    partPaths: parts.map((p) => p.path),
  };
}

export async function decryptFile({
  inputPath,
  outputPath,
  passphraseFile,
  manifestPath,
}) {
  const passphrase = readAndValidatePassphraseFile(passphraseFile);
  const resolvedOut = path.resolve(outputPath);

  if (isInsideGitWorkTree(resolvedOut)) {
    throw new Error(
      `REFUSED_OUTPUT_IN_GIT: Decrypted output path "${resolvedOut}" is inside a Git repository.`,
    );
  }

  let encryptedBuffer;
  const resolvedIn = path.resolve(inputPath);
  const resolvedManifest = manifestPath
    ? path.resolve(manifestPath)
    : fs.existsSync(`${resolvedIn}.sha256.json`)
      ? `${resolvedIn}.sha256.json`
      : null;

  if (resolvedManifest && fs.existsSync(resolvedManifest)) {
    const manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
    if (manifest.chunked && Array.isArray(manifest.parts) && manifest.parts.length > 1) {
      const baseDir = path.dirname(resolvedIn);
      const chunks = [];
      for (const part of manifest.parts) {
        const partFile = path.join(baseDir, part.name);
        if (!fs.existsSync(partFile)) {
          throw new Error(`Missing chunk part file: ${partFile}`);
        }
        const buf = fs.readFileSync(partFile);
        const actualPartHash = sha256Buffer(buf);
        if (part.sha256 && actualPartHash !== part.sha256) {
          throw new Error(
            `Chunk SHA-256 mismatch for ${part.name} (expected ${part.sha256}, got ${actualPartHash}).`,
          );
        }
        chunks.push(buf);
      }
      encryptedBuffer = Buffer.concat(chunks);
    } else {
      encryptedBuffer = fs.readFileSync(resolvedIn);
    }
    if (manifest.encrypted_sha256) {
      const actualEncHash = sha256Buffer(encryptedBuffer);
      if (actualEncHash !== manifest.encrypted_sha256) {
        throw new Error(
          `Encrypted file SHA-256 mismatch (expected ${manifest.encrypted_sha256}, got ${actualEncHash}).`,
        );
      }
    }
  } else {
    encryptedBuffer = fs.readFileSync(resolvedIn);
  }

  const { plaintextBuffer, header } = decryptBuffer(encryptedBuffer, passphrase);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, plaintextBuffer);

  return {
    outputPath: resolvedOut,
    plaintextSha256: header.plaintext_sha256,
    plaintextSize: plaintextBuffer.length,
    header,
  };
}

/**
 * Retention policy:
 * Keep the 14 most recent daily backups (newest backup for each of the 14 latest distinct UTC days,
 * plus any backups within the latest 14 backups) AND keep 1 backup per calendar month (the latest
 * backup in each YYYY-MM month). Return releases that should be deleted.
 */
export function computeReleasesToPrune(
  releases,
  { dailyKeep = 14, tagPrefix = 'backup-' } = {},
) {
  const matching = releases
    .filter((r) => typeof r.tag_name === 'string' && r.tag_name.startsWith(tagPrefix))
    .map((r) => {
      const tsMatch = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(
        r.tag_name,
      );
      const dateIso = tsMatch
        ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}T${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}Z`
        : r.published_at || r.created_at;
      const timeMs = Date.parse(dateIso);
      const dayKey = tsMatch
        ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}`
        : new Date(timeMs).toISOString().slice(0, 10);
      const monthKey = tsMatch
        ? `${tsMatch[1]}-${tsMatch[2]}`
        : new Date(timeMs).toISOString().slice(0, 7);
      return {
        ...r,
        _timeMs: Number.isFinite(timeMs) ? timeMs : 0,
        _dayKey: dayKey,
        _monthKey: monthKey,
      };
    })
    .sort((a, b) => b._timeMs - a._timeMs);

  const keepTags = new Set();
  const seenDays = new Set();
  const seenMonths = new Set();

  for (const rel of matching) {
    if (seenDays.size < dailyKeep && !seenDays.has(rel._dayKey)) {
      seenDays.add(rel._dayKey);
      keepTags.add(rel.tag_name);
    }
    if (!seenMonths.has(rel._monthKey)) {
      seenMonths.add(rel._monthKey);
      keepTags.add(rel.tag_name);
    }
  }

  // Also ensure if there are fewer than dailyKeep days, up to dailyKeep newest releases are kept
  for (let i = 0; i < Math.min(dailyKeep, matching.length); i += 1) {
    keepTags.add(matching[i].tag_name);
  }

  const toKeep = matching.filter((r) => keepTags.has(r.tag_name));
  const toDelete = matching.filter((r) => !keepTags.has(r.tag_name));

  return { toKeep, toDelete };
}

export function resolveGitHubToken() {
  if (process.env.GH_TOKEN && process.env.GH_TOKEN.trim()) {
    return process.env.GH_TOKEN.trim();
  }
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return process.env.GITHUB_TOKEN.trim();
  }
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString('utf8');
    const line = out
      .split(/\r?\n/)
      .find((l) => l.startsWith('password='));
    if (line) {
      const token = line.slice('password='.length).trim();
      if (token) return token;
    }
  } catch {
    // ignore
  }
  throw new Error(
    'Unable to resolve GitHub authentication token from GH_TOKEN, GITHUB_TOKEN, or git credential fill.',
  );
}

async function githubApiRequest(url, { method = 'GET', token, body, headers = {} } = {}) {
  const reqHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'management-lite-offsite-backup',
    'X-GitHub-Api-Version': '2022-11-28',
    ...headers,
  };
  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `GitHub API ${method} ${url} failed with status ${res.status}: ${errText.slice(0, 300)}`,
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function createReleaseAndUploadAssets({
  repo = DEFAULT_REPO,
  tagName,
  releaseName,
  bodyText,
  assetPaths,
  token,
}) {
  const authToken = token || resolveGitHubToken();
  const release = await githubApiRequest(
    `https://api.github.com/repos/${repo}/releases`,
    {
      method: 'POST',
      token: authToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tagName,
        name: releaseName || tagName,
        body: bodyText || '',
        draft: false,
        prerelease: tagName.startsWith('test-'),
      }),
    },
  );

  const uploadBaseUrl = release.upload_url.replace(/\{\?name,label\}$/, '');
  const uploadedAssets = [];

  for (const filePath of assetPaths) {
    const fileName = path.basename(filePath);
    const fileBytes = fs.readFileSync(filePath);
    const uploadUrl = `${uploadBaseUrl}?name=${encodeURIComponent(fileName)}`;
    const asset = await githubApiRequest(uploadUrl, {
      method: 'POST',
      token: authToken,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(fileBytes.length),
      },
      body: fileBytes,
    });
    uploadedAssets.push(asset);
  }

  return { release, uploadedAssets };
}

export async function downloadReleaseAssetsByTag({
  repo = DEFAULT_REPO,
  tagName,
  destDir,
  token,
}) {
  const authToken = token || resolveGitHubToken();
  const release = await githubApiRequest(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tagName)}`,
    { token: authToken },
  );

  fs.mkdirSync(destDir, { recursive: true });
  const downloadedFiles = [];

  for (const asset of release.assets || []) {
    const res = await fetch(asset.url, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: 'application/octet-stream',
        'User-Agent': 'management-lite-offsite-backup',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to download release asset ${asset.name} (HTTP ${res.status}).`,
      );
    }
    const arrayBuf = await res.arrayBuffer();
    const outPath = path.join(destDir, asset.name);
    fs.writeFileSync(outPath, Buffer.from(arrayBuf));
    downloadedFiles.push(outPath);
  }

  return { release, downloadedFiles };
}

export async function listReleases({ repo = DEFAULT_REPO, token } = {}) {
  const authToken = token || resolveGitHubToken();
  return githubApiRequest(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
    { token: authToken },
  );
}

export async function deleteReleaseAndTag({
  repo = DEFAULT_REPO,
  releaseId,
  tagName,
  token,
}) {
  const authToken = token || resolveGitHubToken();
  await githubApiRequest(
    `https://api.github.com/repos/${repo}/releases/${releaseId}`,
    { method: 'DELETE', token: authToken },
  );
  if (tagName) {
    try {
      await githubApiRequest(
        `https://api.github.com/repos/${repo}/git/refs/tags/${encodeURIComponent(tagName)}`,
        { method: 'DELETE', token: authToken },
      );
    } catch {
      // ignore if tag ref was already removed
    }
  }
}

function parseCliArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = parseCliArgs(process.argv.slice(2));
  const cmd = args._[0];

  try {
    if (cmd === 'encrypt') {
      const res = await encryptFile({
        inputPath: args.in,
        outputPath: args.out,
        passphraseFile: args['passphrase-file'],
        maxChunkBytes: args['max-chunk-bytes']
          ? Number(args['max-chunk-bytes'])
          : DEFAULT_MAX_CHUNK_BYTES,
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === 'decrypt') {
      const res = await decryptFile({
        inputPath: args.in,
        outputPath: args.out,
        passphraseFile: args['passphrase-file'],
        manifestPath: args.manifest,
      });
      console.log(JSON.stringify(res, null, 2));
    } else if (cmd === 'push-release') {
      const assetList = String(args.assets || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await createReleaseAndUploadAssets({
        repo: args.repo || DEFAULT_REPO,
        tagName: args.tag,
        releaseName: args.title || args.tag,
        bodyText: args.notes || '',
        assetPaths: assetList,
      });
      console.log(
        JSON.stringify(
          {
            releaseId: res.release.id,
            tagName: res.release.tag_name,
            htmlUrl: res.release.html_url,
            uploadedAssets: res.uploadedAssets.map((a) => ({
              name: a.name,
              size: a.size,
            })),
          },
          null,
          2,
        ),
      );
    } else if (cmd === 'download-release') {
      const res = await downloadReleaseAssetsByTag({
        repo: args.repo || DEFAULT_REPO,
        tagName: args.tag,
        destDir: args['dest-dir'],
      });
      console.log(
        JSON.stringify(
          {
            releaseId: res.release.id,
            tagName: res.release.tag_name,
            downloadedFiles: res.downloadedFiles,
          },
          null,
          2,
        ),
      );
    } else if (cmd === 'prune-releases') {
      const repo = args.repo || DEFAULT_REPO;
      const tagPrefix = args['tag-prefix'] || 'backup-';
      const dailyKeep = args['daily-keep'] ? Number(args['daily-keep']) : 14;
      const releases = await listReleases({ repo });
      const { toKeep, toDelete } = computeReleasesToPrune(releases, {
        dailyKeep,
        tagPrefix,
      });
      const deleted = [];
      if (!args['dry-run']) {
        for (const rel of toDelete) {
          await deleteReleaseAndTag({
            repo,
            releaseId: rel.id,
            tagName: rel.tag_name,
          });
          deleted.push(rel.tag_name);
        }
      }
      console.log(
        JSON.stringify(
          {
            keptCount: toKeep.length,
            keptTags: toKeep.map((r) => r.tag_name),
            deletedCount: deleted.length,
            deletedTags: deleted,
          },
          null,
          2,
        ),
      );
    } else if (cmd === 'delete-release') {
      const repo = args.repo || DEFAULT_REPO;
      const tag = args.tag;
      const releases = await listReleases({ repo });
      const found = releases.find((r) => r.tag_name === tag);
      if (found) {
        await deleteReleaseAndTag({
          repo,
          releaseId: found.id,
          tagName: found.tag_name,
        });
        console.log(JSON.stringify({ deleted: true, tag }, null, 2));
      } else {
        console.log(JSON.stringify({ deleted: false, tag }, null, 2));
      }
    } else {
      throw new Error(
        `Unknown command "${cmd}". Supported: encrypt | decrypt | push-release | download-release | prune-releases | delete-release`,
      );
    }
  } catch (err) {
    console.error(`ERROR: ${err?.message || err}`);
    process.exit(1);
  }
}
