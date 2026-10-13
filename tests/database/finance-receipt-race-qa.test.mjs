// P1-02 on a REAL isolated PostgreSQL: DB commit first, file removal after, safe under concurrency.
// SKIPs unless an isolated QA database is provisioned (SKIP is never PASS).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';
import { FinanceService } from '../../dist/apps/api/src/finance/service.js';
import { ReceiptStore } from '../../dist/apps/api/src/finance/receipt-store.js';

const PROTECTED_PORTS = new Set(['3017', '3018', '55499', '55571', '55601']);

test('FIN receipt discard/purge DB-file safety on an isolated QA PostgreSQL', async (t) => {
  const url = process.env.FIN_QA_DATABASE_URL;
  if (!url || process.env.FIN_QA_CONFIRM_ISOLATED !== 'yes') {
    t.skip('HOLD: no isolated FIN QA database provisioned; nothing attempted');
    return;
  }
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(!PROTECTED_PORTS.has(target.port), 'protected port refused');
  assert.match(target.pathname.slice(1), /^fin_qa_[a-z0-9_]+$/);
  const pool = createDatabasePool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 3000,
  });
  const dir = await mkdtemp(join(tmpdir(), 'fin-qa-race-'));
  try {
    assert.equal(
      (await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'"))
        .rowCount,
      0,
      'QA database must start empty',
    );
    assert.equal(
      (
        await runMigrations(
          pool,
          loadMigrationFiles(resolve('packages/database/src/migrations')),
        )
      ).appliedCount,
      loadMigrationFiles(resolve('packages/database/src/migrations')).length,
    );
    const ws = randomUUID();
    const owner = randomUUID();
    const sessionId = randomUUID();
    const tokenHash = createHash('sha256').update('race-session').digest('hex');
    await pool.query(
      "INSERT INTO workspaces(id,name) VALUES ($1,'FIN RACE QA')",
      [ws],
    );
    await pool.query(
      "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES ($1::uuid,$1::text,$1::text || '@test.invalid','active')",
      [owner],
    );
    await pool.query(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES ($1,$2,'owner','active')",
      [ws, owner],
    );
    await pool.query(
      "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES ($1,$2,'active')",
      [ws, owner],
    );
    await pool.query(
      "INSERT INTO user_credentials(user_id,password_hash) VALUES ($1,'x')",
      [owner],
    );
    const cv = (
      await pool.query(
        'SELECT credential_version FROM user_credentials WHERE user_id=$1',
        [owner],
      )
    ).rows[0].credential_version;
    await pool.query(
      "INSERT INTO auth_sessions(id,workspace_id,user_id,session_token_hash,credential_version_at_issue,idle_expires_at,absolute_expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '1 hour',now()+interval '1 day')",
      [sessionId, ws, owner, tokenHash, cv],
    );
    const auth = {
      sessionId,
      sessionTokenHash: tokenHash,
      user: { id: owner },
      workspace: { id: ws, role: 'owner' },
    };
    const store = new ReceiptStore(dir);
    const svc = new FinanceService(pool, { receipts: store });
    const req = () => randomUUID();
    const image = (n) =>
      sharp({
        create: { width: 16 + n, height: 16, channels: 3, background: '#abc' },
      })
        .png()
        .toBuffer()
        .then((b) => new Uint8Array(b));
    const upload = async (b) =>
      (await svc.uploadReceipt(auth, b, 'image/png', req())).body.data;
    const files = async () => {
      const out = [];
      for (const d of await readdir(join(dir, ws, owner)).catch(() => []))
        out.push(d);
      return out;
    };
    const fileFor = (b) =>
      `${createHash('sha256').update(b).digest('hex')}.png`;
    const state = (id) =>
      pool
        .query('SELECT state FROM fin_receipts WHERE id=$1', [id])
        .then((r) => r.rows[0]?.state);

    await t.test(
      'discard then purge remove the file only when unreferenced',
      async () => {
        const b = await image(1);
        const a = await upload(b);
        const dup = await upload(b); // same content-addressed file, second receipt
        assert.deepEqual(await files(), [fileFor(b)]);
        await svc.discardReceipt(auth, a.id, req());
        assert.equal(await state(a.id), 'discarded');
        assert.deepEqual(
          await files(),
          [fileFor(b)],
          'still referenced by the second receipt',
        );
        await svc.discardReceipt(auth, dup.id, req());
        assert.deepEqual(
          await files(),
          [],
          'last reference gone: file removed after commit',
        );
      },
    );

    await t.test(
      'concurrent discard + identical upload never leaves a receipt without its file',
      async () => {
        for (let i = 0; i < 12; i++) {
          const b = await image(100 + i);
          const first = await upload(b);
          const [, second] = await Promise.all([
            svc.discardReceipt(auth, first.id, req()),
            svc.uploadReceipt(auth, b, 'image/png', req()),
          ]);
          const id = second.body.data.id;
          assert.equal(await state(id), 'staged');
          assert.deepEqual(
            (await svc.receiptFile(auth, id)).bytes.length,
            b.length,
            `iteration ${i}: file is still readable`,
          );
          await svc.discardReceipt(auth, id, req());
        }
        assert.deepEqual(await files(), []);
      },
    );

    await t.test(
      'COMMIT failure rolls back the discard and keeps the file',
      async () => {
        const b = await image(300);
        const r = await upload(b);
        let armed = true;
        const wrapped = {
          query: (...a) => pool.query(...a),
          connect: async () => {
            const c = await pool.connect();
            const q = c.query.bind(c);
            c.query = async (sql, ...rest) => {
              if (armed && sql === 'COMMIT') {
                armed = false;
                await q('ROLLBACK'); // the server-side transaction really is gone
                throw new Error('scripted commit failure');
              }
              return q(sql, ...rest);
            };
            return c;
          },
        };
        const flaky = new FinanceService(wrapped, { receipts: store });
        await assert.rejects(flaky.discardReceipt(auth, r.id, req()));
        assert.equal(await state(r.id), 'staged', 'row unchanged');
        assert.deepEqual(await files(), [fileFor(b)], 'file intact');
        await svc.discardReceipt(auth, r.id, req()); // normal retry succeeds
        assert.deepEqual(await files(), []);
      },
    );

    await t.test(
      'file deletion failure keeps the committed discard; the sweep retries',
      async () => {
        const b = await image(400);
        const r = await upload(b);
        const failing = new ReceiptStore(dir);
        failing.delete = async () => {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        };
        const warns = [];
        const s2 = new FinanceService(pool, {
          receipts: failing,
          logger: { warn: (m) => warns.push(m) },
        });
        assert.equal((await s2.discardReceipt(auth, r.id, req())).status, 200);
        assert.equal(await state(r.id), 'discarded');
        assert.deepEqual(await files(), [fileFor(b)]);
        assert.equal(warns.length, 1);
        assert.equal(await svc.sweepOrphanReceiptFiles(), 1);
        assert.deepEqual(await files(), []);
      },
    );

    await t.test(
      'purge: expired receipts are discarded first; a shared live file survives',
      async () => {
        const b = await image(500);
        const live = await upload(b);
        const expired = { id: randomUUID() };
        const key = `${ws}/${owner}/${fileFor(b)}`;
        await pool.query(
          "INSERT INTO fin_receipts(id,workspace_id,owner_user_id,storage_key,mime_type,size_bytes,sha256,expires_at) VALUES ($1,$2,$3,$4,'image/png',$5,$6,clock_timestamp()+interval '20 milliseconds')",
          [expired.id, ws, owner, key, b.length, fileFor(b).slice(0, 64)],
        );
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(await svc.purgeExpiredReceipts(), 1);
        assert.equal(await state(expired.id), 'discarded');
        assert.equal(await state(live.id), 'staged');
        assert.deepEqual(
          await files(),
          [fileFor(b)],
          'live receipt keeps its file',
        );
        await svc.discardReceipt(auth, live.id, req());
        assert.deepEqual(await files(), []);
      },
    );

    await t.test(
      'orphan sweep clears a stray file that has no live row',
      async () => {
        const b = await image(600);
        const r = await upload(b);
        await pool.query('DELETE FROM fin_receipts WHERE id=$1', [r.id]);
        const left = await files();
        // a stray file with no live row (e.g. crash between put and COMMIT) is swept
        if (left.length)
          assert.equal(await svc.sweepOrphanReceiptFiles(), left.length);
        assert.deepEqual(await files(), []);
      },
    );

    await t.test(
      'corrupt image is rejected by the real decoder: no row, no file',
      async () => {
        const good = await image(700);
        const bad = Buffer.from(good);
        bad[good.length >> 1] ^= 0xff;
        bad[(good.length >> 1) + 1] ^= 0xff;
        const before = Number(
          (await pool.query('SELECT count(*) n FROM fin_receipts')).rows[0].n,
        );
        await assert.rejects(
          svc.uploadReceipt(auth, new Uint8Array(bad), 'image/png', req()),
          (e) => e.code === 'RECEIPT_MALFORMED_IMAGE' && e.statusCode === 422,
        );
        assert.equal(
          Number(
            (await pool.query('SELECT count(*) n FROM fin_receipts')).rows[0].n,
          ),
          before,
        );
        assert.deepEqual(await files(), []);
      },
    );
  } finally {
    await pool.end().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
