import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');
const { createGitFallbackReader, resolveReleaseState } = await import(
  `file://${resolve(root, 'dist/apps/api/src/release-info.js')}`
);
const { SYSTEM_COMMIT } = await import(
  `file://${resolve(root, 'dist/packages/contracts/src/version.js')}`
);

test('PH15-3: the git fallback runs at most once per process, even when it fails', () => {
  const calls = [];
  const reader = createGitFallbackReader((args) => {
    calls.push(args.join(' '));
    return args[0] === 'rev-parse' ? 'abc1234def' : '2026-10-31T10:00:00+07:00';
  });
  const a = reader();
  const b = reader();
  const c = reader();
  assert.equal(a, b);
  assert.equal(b, c);
  assert.deepEqual(calls, ['rev-parse HEAD', 'log -1 --format=%cI']);
  assert.equal(a.sha, 'abc1234def');

  let failing = 0;
  const broken = createGitFallbackReader(() => {
    failing += 1;
    throw new Error('git not installed');
  });
  assert.deepEqual(broken(), { sha: null, date: null });
  broken();
  broken();
  assert.equal(
    failing,
    1,
    'a failed lookup is remembered, never retried per request',
  );
});

test('PH15-3: resolveReleaseState only consults git when no release record exists', () => {
  const cwd = process.cwd();
  const savedReports = process.env.SERVER_REPORTS_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-rel-'));
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-rep-'));
  process.env.SERVER_REPORTS_DIR = reports; // never read the real server reports
  try {
    process.chdir(tmp);

    // 1) No release record: fall back to git, exactly one lookup per resolve.
    let reads = 0;
    const readGit = () => {
      reads += 1;
      return { sha: 'fedcba9876543210', date: '2026-10-31T09:00:00+07:00' };
    };
    const fallback = resolveReleaseState(false, { readGit });
    assert.equal(reads, 1);
    assert.equal(fallback.sha, 'fedcba9876543210');
    assert.equal(fallback.commit, 'fedcba9');
    assert.equal(fallback.environment, 'staging');

    // 2) A release record on disk wins and git is never touched.
    fs.mkdirSync(path.join(tmp, 'dist'));
    fs.writeFileSync(
      path.join(tmp, 'dist/release-version.json'),
      JSON.stringify({
        version: '9.9.9',
        sha: '0123456789abcdef0123456789abcdef01234567',
        releasedAt: '2026-10-31T01:00:00.000Z',
        environment: 'production',
      }),
    );
    reads = 0;
    const fromRecord = resolveReleaseState(true, { readGit });
    assert.equal(reads, 0, 'no git spawn when the release record is present');
    assert.equal(fromRecord.version, '9.9.9');
    assert.equal(fromRecord.commit, '0123456');
    assert.equal(fromRecord.environment, 'production');
    assert.match(fromRecord.productionStatus, /^Production/);

    // 3) The sentinel really is the "no record" marker the fallback keys on.
    assert.equal(typeof SYSTEM_COMMIT, 'string');
  } finally {
    process.chdir(cwd);
    if (savedReports === undefined) delete process.env.SERVER_REPORTS_DIR;
    else process.env.SERVER_REPORTS_DIR = savedReports;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(reports, { recursive: true, force: true });
  }
});
