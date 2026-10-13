// P1-01 (full decode before storing) and P1-02 (DB first, file removal only after COMMIT) for FIN
// receipts, on a scripted fake pool and a real filesystem. Real-DB concurrency is covered by
// tests/database/finance-receipt-race-qa.test.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { FinanceService } from '../../dist/apps/api/src/finance/service.js';
import { ReceiptStore } from '../../dist/apps/api/src/finance/receipt-store.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const auth = {
  sessionId: '44444444-4444-4444-8444-444444444444',
  sessionTokenHash: 'a'.repeat(64),
  user: { id: OWNER },
  workspace: { id: WS, role: 'owner' },
};
const rows = (r = []) => ({ rows: r, rowCount: r.length });

function fakePool(state) {
  state.log = [];
  state.released = [];
  const query = async (sql) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    state.log.push(q.split(' ').slice(0, 3).join(' '));
    if (state.failQuery?.test(q) && (state.failTimes ?? 1) > 0) {
      if (state.failTimes !== undefined) state.failTimes--;
      throw Object.assign(new Error('scripted query failure'), {
        code: state.failCode,
      });
    }
    if (q === 'COMMIT' && state.failCommit > 0) {
      state.failCommit--;
      throw new Error('scripted commit failure');
    }
    if (q === 'ROLLBACK' && state.failRollback)
      throw new Error('scripted rollback failure');
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return rows();
    if (q.includes('pg_advisory_xact_lock')) return rows([{}]);
    if (q.startsWith('SELECT id FROM users')) return rows([{ id: OWNER }]);
    if (q.includes('FROM user_workspace_bindings')) return rows([{ id: 'b' }]);
    if (q.includes('FROM workspace_memberships'))
      return rows([{ role: 'owner' }]);
    if (q.includes('FROM auth_sessions')) return rows([{ id: 's' }]);
    if (q.startsWith('SELECT id FROM workspaces')) return rows([{ id: WS }]);
    if (q.startsWith('INSERT INTO fin_receipts'))
      return rows([{ expires_at: new Date('2026-10-12T00:00:00Z') }]);
    if (q.includes('FROM fin_entries e JOIN fin_receipts r')) return rows();
    if (q.startsWith('INSERT INTO audit_events')) return rows([{ id: 'a1' }]);
    if (q.startsWith("UPDATE fin_receipts SET state='discarded'"))
      return state.discardRow ? rows([state.discardRow]) : rows();
    if (q.startsWith('SELECT 1 FROM fin_receipts'))
      return state.shared ? rows([{}]) : rows();
    return rows();
  };
  return {
    query,
    connect: async () => ({
      query,
      release: (destroy) => state.released.push(destroy ?? false),
    }),
  };
}

async function fixture(t, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fin-p1-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = { failCommit: 0 };
  const store = new ReceiptStore(dir);
  const events = [];
  const realDelete = store.delete.bind(store);
  state.deleteFails = false;
  store.delete = async (rel) => {
    state.log.push('FILE_DELETE');
    if (state.deleteFails)
      throw Object.assign(new Error(`/secret/${rel}`), { code: 'EACCES' });
    return realDelete(rel);
  };
  const warns = [];
  const svc = new FinanceService(fakePool(state), {
    receipts: store,
    logger: { warn: (m) => warns.push(m) },
    ...opts,
  });
  const files = async () => {
    const out = [];
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => []))
        if (e.isDirectory()) await walk(join(d, e.name));
        else out.push(join(d, e.name));
    };
    await walk(dir);
    return out;
  };
  return { dir, state, svc, store, files, warns, events };
}
const goodPng = () =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: '#fa0' } })
    .png()
    .toBuffer();
const goodJpeg = () =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: '#0af' } })
    .jpeg()
    .toBuffer();
const up = (svc, b, type = 'image/png') =>
  svc.uploadReceipt(auth, new Uint8Array(b), type, 'req-1');
const rejects = (p, code, status) =>
  assert.rejects(p, (e) => e.code === code && e.statusCode === status);

// ---------------------------------------------------------------- P1-01
test('P1-01 valid JPEG and PNG pass the real sandboxed decoder and are stored', async (t) => {
  const f = await fixture(t);
  assert.equal((await up(f.svc, await goodPng())).status, 201);
  assert.equal((await up(f.svc, await goodJpeg(), 'image/jpeg')).status, 201);
  assert.equal((await f.files()).length, 2);
});

test('P1-01 forged, truncated, pixel-corrupt and unsupported images are rejected and nothing is stored', async (t) => {
  const f = await fixture(t);
  const png = await goodPng();
  const jpg = await goodJpeg();
  // header + IHDR + IEND shell that passes the structural sniff but has no pixel data
  const forged = Buffer.alloc(60);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(forged);
  forged.writeUInt32BE(13, 8);
  forged.write('IHDR', 12, 'ascii');
  forged.write('IEND', forged.length - 8, 'ascii');
  // PNG with a corrupted IDAT payload (CRC no longer matches)
  const corruptPng = Buffer.from(png);
  corruptPng[Math.floor(png.length / 2)] ^= 0xff;
  corruptPng[Math.floor(png.length / 2) + 1] ^= 0xff;
  // JPEG with the entropy-coded middle cut out, keeping SOI and EOI
  const cutJpeg = Buffer.concat([
    jpg.subarray(0, 120),
    jpg.subarray(jpg.length - 2),
  ]);
  // JPEG whose scan data is replaced by noise but keeps valid markers
  const noiseJpeg = Buffer.from(jpg);
  for (let i = 160; i < noiseJpeg.length - 2; i++)
    noiseJpeg[i] = (i * 31) & 255;
  const cases = [
    ['forged PNG shell', forged, 'image/png'],
    ['PNG with corrupted pixel data', corruptPng, 'image/png'],
    ['truncated JPEG', cutJpeg, 'image/jpeg'],
    ['JPEG with garbage scan data', noiseJpeg, 'image/jpeg'],
  ];
  for (const [name, bytes, type] of cases)
    await rejects(up(f.svc, bytes, type), 'RECEIPT_MALFORMED_IMAGE', 422).catch(
      (e) => {
        throw new Error(`${name}: ${e.message}`);
      },
    );
  // unsupported format (WebP) and over-limit pixel dimensions
  const webp = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#fff' },
  })
    .webp()
    .toBuffer();
  await rejects(up(f.svc, webp, 'image/webp'), 'RECEIPT_UNSUPPORTED_TYPE', 415);
  const huge = await sharp({
    create: { width: 9000, height: 100, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  await rejects(up(f.svc, huge), 'RECEIPT_MALFORMED_IMAGE', 422);
  assert.deepEqual(await f.files(), [], 'no private file written');
  assert.ok(
    !f.state.log.some((l) => l.startsWith('INSERT INTO fin_receipts')),
    'no DB row',
  );
  assert.ok(!f.state.log.includes('BEGIN'), 'rejected before any transaction');
});

test('P1-01 oversize is rejected before the decoder runs', async (t) => {
  let calls = 0;
  const f = await fixture(t, { decodeImage: async () => void calls++ });
  const big = Buffer.concat([await goodPng(), Buffer.alloc(4 * 1024 * 1024)]);
  await rejects(up(f.svc, big), 'RECEIPT_TOO_LARGE', 413);
  assert.equal(calls, 0);
  assert.deepEqual(await f.files(), []);
});

test('P1-01 decoder failures fail closed and map to safe errors', async (t) => {
  for (const [code, status, err] of [
    ['AI_BUSY', 429, 'RECEIPT_VALIDATION_BUSY'],
    ['AI_TIMEOUT', 422, 'RECEIPT_MALFORMED_IMAGE'],
    ['AI_INVALID_INPUT', 422, 'RECEIPT_MALFORMED_IMAGE'],
    ['AI_NOT_CONFIGURED', 503, 'RECEIPT_VALIDATION_UNAVAILABLE'],
    [undefined, 503, 'RECEIPT_VALIDATION_UNAVAILABLE'],
  ]) {
    const f = await fixture(t, {
      decodeImage: async () => {
        throw Object.assign(new Error('internal /path/secret'), { code });
      },
    });
    await assert.rejects(up(f.svc, await goodPng()), (e) => {
      assert.equal(e.code, err);
      assert.equal(e.statusCode, status);
      assert.ok(!String(e.message).includes('secret'));
      return true;
    });
    assert.deepEqual(await f.files(), []);
    assert.ok(!f.state.log.includes('BEGIN'));
  }
});

test('P1-01 a non-Owner is refused before any decode work', async (t) => {
  let calls = 0;
  const f = await fixture(t, { decodeImage: async () => void calls++ });
  await assert.rejects(
    f.svc.uploadReceipt(
      { ...auth, workspace: { id: WS, role: 'staff' } },
      new Uint8Array(await goodPng()),
      'image/png',
      'r',
    ),
  );
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------- P1-02
async function stagedFile(f) {
  const png = await goodPng();
  await up(f.svc, png);
  const [file] = await f.files();
  const key = file.slice(f.dir.length + 1);
  f.state.discardRow = { storage_key: key };
  return { file, key };
}
const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );
const idx = (log, v, from = 0) => log.indexOf(v, from);

test('P1-02 discard: the file is removed only after COMMIT, under the Owner lock', async (t) => {
  const f = await fixture(t);
  const { file } = await stagedFile(f);
  f.state.log.length = 0;
  await f.svc.discardReceipt(auth, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'r');
  const commit = idx(f.state.log, 'COMMIT');
  const del = idx(f.state.log, 'FILE_DELETE');
  assert.ok(
    commit > 0 && del > commit,
    `COMMIT(${commit}) precedes delete(${del})`,
  );
  const lockAfterCommit = f.state.log.findIndex(
    (l, i) => i > commit && l.startsWith('SELECT pg_advisory_xact_lock'),
  );
  assert.ok(
    lockAfterCommit > commit && lockAfterCommit < del,
    'delete runs under the re-acquired lock',
  );
  assert.equal(await exists(file), false);
});

test('P1-02 discard: rollback keeps the file and the receipt', async (t) => {
  const f = await fixture(t);
  const { file } = await stagedFile(f);
  f.state.log.length = 0;
  f.state.failQuery = /^INSERT INTO audit_events/;
  await assert.rejects(
    f.svc.discardReceipt(auth, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'r'),
  );
  assert.ok(f.state.log.includes('ROLLBACK'));
  assert.ok(!f.state.log.includes('FILE_DELETE'));
  assert.equal(await exists(file), true);
});

test('P1-02 discard: COMMIT failure keeps the file, and a broken connection is destroyed', async (t) => {
  const f = await fixture(t);
  const { file } = await stagedFile(f);
  f.state.log.length = 0;
  f.state.failCommit = 1;
  f.state.failRollback = true;
  await assert.rejects(
    f.svc.discardReceipt(auth, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'r'),
  );
  assert.ok(
    !f.state.log.includes('FILE_DELETE'),
    'no deletion after a failed COMMIT',
  );
  assert.equal(await exists(file), true);
  assert.ok(
    f.state.released.includes(true),
    'connection with failed ROLLBACK is discarded, not reused',
  );
});

test('P1-02 purge: COMMIT failure keeps the file and purges nothing', async (t) => {
  const f = await fixture(t);
  const { file } = await stagedFile(f);
  f.state.pool_due = true;
  const realQuery = f.svc.pool.query;
  f.svc.pool.query = async (sql, p) =>
    /FROM fin_receipts WHERE state='staged'/.test(sql)
      ? rows([{ id: 'r1', workspace_id: WS, owner_user_id: OWNER }])
      : realQuery(sql, p);
  f.state.log.length = 0;
  f.state.failCommit = 1;
  // the orphan sweep must not remove a file the (rolled-back) DB still references
  f.state.shared = true;
  assert.equal(await f.svc.purgeExpiredReceipts(), 0);
  assert.equal(await exists(file), true);
  assert.ok(!f.state.log.includes('FILE_DELETE'));
});

test('P1-02 a file still referenced by another receipt is never deleted', async (t) => {
  const f = await fixture(t);
  const { file } = await stagedFile(f);
  f.state.shared = true;
  f.state.log.length = 0;
  await f.svc.discardReceipt(auth, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'r');
  assert.ok(!f.state.log.includes('FILE_DELETE'));
  assert.equal(await exists(file), true);
  // the orphan sweep honours references too
  assert.equal(await f.svc.sweepOrphanReceiptFiles(), 0);
  assert.equal(await exists(file), true);
});

test('P1-02 file deletion failure never breaks the committed discard; retry removes the file', async (t) => {
  const f = await fixture(t);
  const { file } = await stagedFile(f);
  f.state.deleteFails = true;
  const r = await f.svc.discardReceipt(
    auth,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'r',
  );
  assert.equal(r.status, 200, 'DB outcome is unaffected by the unlink error');
  assert.equal(await exists(file), true, 'file left in place for retry');
  assert.deepEqual(f.warns, ['FIN receipt file removal failed (EACCES)']);
  assert.ok(!f.warns.join().includes('secret'));
  // retry (same cleanup the hourly timer runs): now unreferenced and deletable
  f.state.deleteFails = false;
  f.state.discardRow = undefined;
  assert.equal(await f.svc.sweepOrphanReceiptFiles(), 1);
  assert.equal(await exists(file), false);
  assert.equal(await f.svc.sweepOrphanReceiptFiles(), 0, 'sweep is idempotent');
});

test('P1-02 upload whose DB insert fails does not leave an unreferenced file behind', async (t) => {
  const f = await fixture(t);
  f.state.failQuery = /^INSERT INTO fin_receipts/;
  await assert.rejects(up(f.svc, await goodPng()));
  assert.deepEqual(await f.files(), []);
  // but a file that a live receipt references survives a failed duplicate upload
  const g = await fixture(t);
  await up(g.svc, await goodPng());
  const before = await g.files();
  g.state.shared = true;
  g.state.failQuery = /^INSERT INTO fin_receipts/;
  await assert.rejects(up(g.svc, await goodPng()));
  assert.deepEqual(await g.files(), before);
});

test('P1-02 the orphan sweep only touches well-formed keys and ignores temp files', async (t) => {
  const f = await fixture(t);
  await up(f.svc, await goodPng());
  const [file] = await f.files();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(file, '..', '.partial.tmp'), 'x');
  await writeFile(join(file, '..', 'notes.txt'), 'x');
  const keys = await f.store.list(100);
  assert.equal(keys.length, 1);
  assert.equal(await f.svc.sweepOrphanReceiptFiles(), 1);
  assert.ok(await exists(join(file, '..', '.partial.tmp')));
  assert.ok(await exists(join(file, '..', 'notes.txt')));
});

test('release: read transactions retry a serialization failure (session touch race) instead of a 500', async (t) => {
  const f = await fixture(t);
  f.state.failQuery = /FROM auth_sessions s JOIN user_credentials/;
  f.state.failCode = '40001';
  f.state.failTimes = 2;
  assert.equal(await f.svc.read(auth, async () => 'ok'), 'ok');
  assert.equal(
    f.state.log.filter((l) => l.startsWith('BEGIN')).length,
    3,
    'two retries then success',
  );
  f.state.failTimes = 10;
  await assert.rejects(
    f.svc.read(auth, async () => 'ok'),
    (e) => e.code === 'CONFLICT' && e.statusCode === 409,
  );
  f.state.failCode = undefined;
  f.state.failTimes = 1;
  await assert.rejects(
    f.svc.read(auth, async () => 'ok'),
    /scripted query failure/,
  );
});
