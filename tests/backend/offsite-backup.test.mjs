import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeReleasesToPrune,
  decryptBuffer,
  decryptFile,
  encryptBuffer,
  encryptFile,
  readAndValidatePassphraseFile,
  sha256Buffer,
} from '../../scripts/ops/offsite-backup-core.mjs';

const FAST_TEST_KDF = { N: 1 << 14, r: 8, p: 1 };

function makeTempDirOutsideGit(prefix = 'ml-offsite-test-') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return base;
}

test('Offsite Backup 1: encryptFile -> decryptFile round-trip matches fake .dump byte-for-byte (offline)', async () => {
  const tmpDir = makeTempDirOutsideGit();
  try {
    const passFile = path.join(tmpDir, 'passphrase.txt');
    fs.writeFileSync(
      passFile,
      'correct-horse-battery-staple-offsite-2026\n',
      'utf8',
    );

    // Create a synthetic PostgreSQL custom dump header + random payload (no real data, no network)
    const fakeDumpPath = path.join(tmpDir, 'postgres-synthetic-test.dump');
    const fakeDumpBytes = Buffer.concat([
      Buffer.from(
        'PGDMP\x01\x0e\x00\x04\x08\x01SYNTHETIC_DEV_DUMP_PAYLOAD',
        'binary',
      ),
      crypto.randomBytes(64 * 1024),
    ]);
    fs.writeFileSync(fakeDumpPath, fakeDumpBytes);

    const encPath = path.join(tmpDir, 'postgres-synthetic-test.dump.enc');
    const encRes = await encryptFile({
      inputPath: fakeDumpPath,
      outputPath: encPath,
      passphraseFile: passFile,
      kdfParams: FAST_TEST_KDF,
    });

    assert.equal(encRes.manifest.chunked, false);
    assert.equal(encRes.manifest.plaintext_size, fakeDumpBytes.length);
    assert.equal(encRes.manifest.plaintext_sha256, sha256Buffer(fakeDumpBytes));
    assert.ok(fs.existsSync(encPath));
    assert.ok(fs.existsSync(encRes.manifestPath));

    const decPath = path.join(tmpDir, 'restored-synthetic.dump');
    const decRes = await decryptFile({
      inputPath: encPath,
      outputPath: decPath,
      passphraseFile: passFile,
      manifestPath: encRes.manifestPath,
    });

    const restoredBytes = fs.readFileSync(decPath);
    assert.equal(decRes.plaintextSha256, sha256Buffer(fakeDumpBytes));
    assert.deepEqual(restoredBytes, fakeDumpBytes);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Offsite Backup 2: wrong passphrase or tampered ciphertext fails decryption', async () => {
  const tmpDir = makeTempDirOutsideGit();
  try {
    const rightPassFile = path.join(tmpDir, 'right-pass.txt');
    const wrongPassFile = path.join(tmpDir, 'wrong-pass.txt');
    fs.writeFileSync(
      rightPassFile,
      'right-passphrase-at-least-16-chars',
      'utf8',
    );
    fs.writeFileSync(
      wrongPassFile,
      'wrong-passphrase-at-least-16-chars',
      'utf8',
    );

    const fakeDumpPath = path.join(tmpDir, 'fake.dump');
    fs.writeFileSync(
      fakeDumpPath,
      'PGDMP-SYNTHETIC-CONTENT-1234567890',
      'utf8',
    );

    const encPath = path.join(tmpDir, 'fake.dump.enc');
    await encryptFile({
      inputPath: fakeDumpPath,
      outputPath: encPath,
      passphraseFile: rightPassFile,
      kdfParams: FAST_TEST_KDF,
    });

    const badOutPath = path.join(tmpDir, 'should-not-exist.dump');
    await assert.rejects(
      () =>
        decryptFile({
          inputPath: encPath,
          outputPath: badOutPath,
          passphraseFile: wrongPassFile,
        }),
      /DECRYPTION_AUTH_FAILED/,
    );
    assert.equal(fs.existsSync(badOutPath), false);

    // Tamper with 1 byte of ciphertext and verify GCM authentication rejects it
    const { encryptedBuffer } = encryptBuffer(
      Buffer.from('PGDMP-TAMPER-CHECK'),
      'right-passphrase-at-least-16-chars',
      { originalName: 'tamper.dump' },
      FAST_TEST_KDF,
    );
    const tampered = Buffer.from(encryptedBuffer);
    tampered[tampered.length - 1] ^= 0xff;
    assert.throws(
      () => decryptBuffer(tampered, 'right-passphrase-at-least-16-chars'),
      /DECRYPTION_AUTH_FAILED/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Offsite Backup 3: refuses passphrase file located inside a Git repository', () => {
  // Fake path inside the current Git worktree (does not even need to exist to be rejected by Git check)
  const inRepoPassPath = path.resolve(
    process.cwd(),
    'tmp-forbidden-passphrase-in-git.txt',
  );
  assert.throws(
    () => readAndValidatePassphraseFile(inRepoPassPath),
    /REFUSED_PASSPHRASE_IN_GIT/,
  );

  // Also test a temporary directory with a .git folder
  const fakeGitRepo = makeTempDirOutsideGit('ml-fake-git-');
  try {
    fs.mkdirSync(path.join(fakeGitRepo, '.git'));
    const nestedPass = path.join(fakeGitRepo, 'secrets', 'passphrase.txt');
    fs.mkdirSync(path.dirname(nestedPass), { recursive: true });
    fs.writeFileSync(nestedPass, 'some-long-passphrase-123456', 'utf8');

    assert.throws(
      () => readAndValidatePassphraseFile(nestedPass),
      /REFUSED_PASSPHRASE_IN_GIT/,
    );
  } finally {
    fs.rmSync(fakeGitRepo, { recursive: true, force: true });
  }
});

test('Offsite Backup 4: multi-part chunk splitting and reassembly for large archives', async () => {
  const tmpDir = makeTempDirOutsideGit();
  try {
    const passFile = path.join(tmpDir, 'passphrase.txt');
    fs.writeFileSync(passFile, 'chunk-test-passphrase-secure-2026', 'utf8');

    const payload = crypto.randomBytes(120 * 1024); // 120 KB
    const inPath = path.join(tmpDir, 'large-synthetic.dump');
    fs.writeFileSync(inPath, payload);

    const encPath = path.join(tmpDir, 'large-synthetic.dump.enc');
    const encRes = await encryptFile({
      inputPath: inPath,
      outputPath: encPath,
      passphraseFile: passFile,
      maxChunkBytes: 40 * 1024, // 40 KB chunks -> 4 parts
      kdfParams: FAST_TEST_KDF,
    });

    assert.equal(encRes.manifest.chunked, true);
    assert.ok(encRes.manifest.parts.length >= 3);

    const decPath = path.join(tmpDir, 'reassembled.dump');
    await decryptFile({
      inputPath: encPath,
      outputPath: decPath,
      passphraseFile: passFile,
      manifestPath: encRes.manifestPath,
    });

    assert.deepEqual(fs.readFileSync(decPath), payload);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Offsite Backup 5: retention policy keeps 14 daily backups + 1 backup per month', () => {
  const sampleReleases = [];
  // 18 daily backups in November 2026 (Nov 1 .. Nov 18)
  for (let day = 1; day <= 18; day += 1) {
    const dd = String(day).padStart(2, '0');
    sampleReleases.push({
      id: 100 + day,
      tag_name: `backup-202611${dd}T030000Z-aaaa${dd}`,
      created_at: `2026-11-${dd}T03:00:00Z`,
    });
  }
  // 2 older backups in October 2026 (Oct 10 and Oct 25 -> Oct 25 should be kept as monthly)
  sampleReleases.push(
    {
      id: 201,
      tag_name: 'backup-20261010T030000Z-oct10',
      created_at: '2026-10-10T03:00:00Z',
    },
    {
      id: 202,
      tag_name: 'backup-20261025T030000Z-oct25',
      created_at: '2026-10-25T03:00:00Z',
    },
  );
  // 2 older backups in September 2026 (Sep 05 and Sep 28 -> Sep 28 should be kept as monthly)
  sampleReleases.push(
    {
      id: 301,
      tag_name: 'backup-20260905T030000Z-sep05',
      created_at: '2026-09-05T03:00:00Z',
    },
    {
      id: 302,
      tag_name: 'backup-20260928T030000Z-sep28',
      created_at: '2026-09-28T03:00:00Z',
    },
  );

  const { toKeep, toDelete } = computeReleasesToPrune(sampleReleases, {
    dailyKeep: 14,
    tagPrefix: 'backup-',
  });

  const keptTags = new Set(toKeep.map((r) => r.tag_name));
  const deletedTags = new Set(toDelete.map((r) => r.tag_name));

  // Nov 05 .. Nov 18 (14 latest daily) are kept
  for (let day = 5; day <= 18; day += 1) {
    const dd = String(day).padStart(2, '0');
    assert.ok(keptTags.has(`backup-202611${dd}T030000Z-aaaa${dd}`));
  }
  // Nov 01 .. Nov 04 are pruned
  for (let day = 1; day <= 4; day += 1) {
    const dd = String(day).padStart(2, '0');
    assert.ok(deletedTags.has(`backup-202611${dd}T030000Z-aaaa${dd}`));
  }
  // Latest of Oct (Oct 25) and Sep (Sep 28) are kept; earlier ones (Oct 10, Sep 05) are pruned
  assert.ok(keptTags.has('backup-20261025T030000Z-oct25'));
  assert.ok(deletedTags.has('backup-20261010T030000Z-oct10'));
  assert.ok(keptTags.has('backup-20260928T030000Z-sep28'));
  assert.ok(deletedTags.has('backup-20260905T030000Z-sep05'));
});
