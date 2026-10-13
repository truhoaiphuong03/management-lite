// FIN 0015 (time + receipts) real-PostgreSQL tests. They SKIP unless an isolated QA database is
// explicitly provisioned. A skip is NOT a pass. Nothing here may run against live or shared clusters.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';

const PROTECTED_PORTS = new Set(['3017', '3018', '55499', '55571', '55601']);

test('FIN 0015 time/receipt guards on an isolated QA PostgreSQL', async (t) => {
  const url = process.env.FIN_QA_DATABASE_URL;
  if (!url || process.env.FIN_QA_CONFIRM_ISOLATED !== 'yes') {
    t.skip(
      'HOLD: no isolated FIN QA database provisioned (FIN_QA_DATABASE_URL + FIN_QA_CONFIRM_ISOLATED=yes); no connection attempted',
    );
    return;
  }
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(!PROTECTED_PORTS.has(target.port), 'protected port refused');
  assert.match(target.pathname.slice(1), /^fin_qa_[a-z0-9_]+$/);
  const pool = createDatabasePool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  });
  try {
    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    assert.equal(tables.rowCount, 0, 'QA database must start empty');
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    assert.equal(
      (await runMigrations(pool, migrations)).appliedCount,
      migrations.length,
    );
    assert.equal((await runMigrations(pool, migrations)).appliedCount, 0);

    const ws = randomUUID();
    const owner = randomUUID();
    const other = randomUUID();
    await pool.query("INSERT INTO workspaces(id,name) VALUES ($1,'FIN QA')", [
      ws,
    ]);
    for (const id of [owner, other]) {
      await pool.query(
        "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES ($1::uuid,$1::text,$1::text || '@test.invalid','active')",
        [id],
      );
      await pool.query(
        "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES ($1,$2,'owner','active')",
        [ws, id],
      );
    }
    const cat = randomUUID();
    await pool.query(
      "INSERT INTO fin_categories(id,workspace_id,owner_user_id,direction,name) VALUES ($1,$2,$3,'expense','Test')",
      [cat, ws, owner],
    );
    const entry = (c, o = {}) => {
      const id = o.id ?? randomUUID();
      const root = o.root ?? id;
      return c
        .query(
          `INSERT INTO fin_entries(id,root_entry_id,workspace_id,owner_user_id,revision_number,direction,category_id,category_name_snapshot,amount_vnd,occurred_on,note,operation_key,request_fingerprint,occurred_at,occurred_at_source,receipt_id) VALUES ($1,$2,$3,$4,$5,'expense',$6,'Test',$7,$8,$9,$10,repeat('a',64),$11,$12,$13)`,
          [
            id,
            root,
            ws,
            o.owner ?? owner,
            o.revision ?? 1,
            cat,
            o.amount ?? '1000',
            o.on ?? '2026-01-02',
            o.note ?? null,
            randomUUID(),
            o.at ?? null,
            o.source ?? 'legacy_date_only',
            o.receipt ?? null,
          ],
        )
        .then(() => id);
    };
    const receipt = async (who = owner, state = 'staged') => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO fin_receipts(id,workspace_id,owner_user_id,storage_key,mime_type,size_bytes,sha256,expires_at) VALUES ($1,$2,$3,$4,'image/png',10,$5,clock_timestamp()+interval '24 hours')",
        [id, ws, who, `${ws}/${who}/${'b'.repeat(64)}.png`, 'b'.repeat(64)],
      );
      if (state === 'attached')
        await pool.query(
          "UPDATE fin_receipts SET state='attached', attached_at=clock_timestamp() WHERE id=$1",
          [id],
        );
      return id;
    };
    const tx = async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    };
    const check = { code: '23514' };

    await t.test(
      'legacy rows stay NULL/legacy_date_only; time is never inferred',
      async () => {
        const id = await entry(pool);
        const r = await pool.query(
          'SELECT occurred_at, occurred_at_source FROM fin_entries WHERE id=$1',
          [id],
        );
        assert.equal(r.rows[0].occurred_at, null);
        assert.equal(r.rows[0].occurred_at_source, 'legacy_date_only');
      },
    );
    await t.test(
      'time/source pairing and Vietnam date consistency are enforced',
      async () => {
        await assert.rejects(
          entry(pool, { at: '2026-01-02T01:00:00Z' }),
          check,
        );
        await assert.rejects(entry(pool, { source: 'auto' }), check);
        // 2026-01-01T18:00Z is 2026-01-02 01:00 in Vietnam
        await entry(pool, {
          on: '2026-01-02',
          at: '2026-01-01T18:00:00Z',
          source: 'manual',
        });
        await assert.rejects(
          entry(pool, {
            on: '2026-01-01',
            at: '2026-01-01T18:00:00Z',
            source: 'manual',
          }),
          check,
        );
        await assert.rejects(
          entry(pool, { source: 'bogus', at: '2026-01-01T18:00:00Z' }),
          check,
        );
      },
    );
    await t.test('a future time is rejected by the database', async () => {
      const future = new Date(Date.now() + 3600e3);
      const on = new Date(future.getTime() + 7 * 3600e3)
        .toISOString()
        .slice(0, 10);
      await assert.rejects(
        entry(pool, { on, at: future.toISOString(), source: 'manual' }),
        check,
      );
    });
    await t.test(
      'time-only and receipt-only corrections are valid revisions; no-change is not',
      async () => {
        const root = await entry(pool, {
          on: '2026-01-02',
          at: '2026-01-01T18:00:00Z',
          source: 'manual',
        });
        const correct = (c, o) =>
          entry(c, { root, revision: o.revision, ...o }).then(async (rep) => {
            await c.query(
              'INSERT INTO fin_entry_corrections(workspace_id,owner_user_id,root_entry_id,original_revision_id,replacement_revision_id,reason,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$2)',
              [ws, owner, root, o.from, rep, 'sửa'],
            );
            return rep;
          });
        const r2 = await tx((c) =>
          correct(c, {
            revision: 2,
            from: root,
            on: '2026-01-02',
            at: '2026-01-01T18:30:00Z',
            source: 'manual',
          }),
        );
        const rc = await receipt(owner, 'attached');
        const r3 = await tx((c) =>
          correct(c, {
            revision: 3,
            from: r2,
            on: '2026-01-02',
            at: '2026-01-01T18:30:00Z',
            source: 'manual',
            receipt: rc,
          }),
        );
        await assert.rejects(
          tx((c) =>
            correct(c, {
              revision: 4,
              from: r3,
              on: '2026-01-02',
              at: '2026-01-01T18:30:00Z',
              source: 'manual',
              receipt: rc,
            }),
          ),
          check,
        );
      },
    );
    await t.test(
      'receipt lifecycle: staged -> attached once; immutable afterwards',
      async () => {
        const staged = await receipt();
        await assert.rejects(
          entry(pool, { receipt: staged }),
          check,
          'cannot attach a staged receipt directly',
        );
        await pool.query(
          "UPDATE fin_receipts SET state='attached', attached_at=clock_timestamp() WHERE id=$1",
          [staged],
        );
        const first = await entry(pool, { receipt: staged });
        await assert.rejects(
          entry(pool, { receipt: staged }),
          check,
          'one receipt, one transaction',
        );
        await assert.rejects(
          pool.query(
            "UPDATE fin_receipts SET state='staged', attached_at=NULL WHERE id=$1",
            [staged],
          ),
          check,
        );
        await assert.rejects(
          pool.query('DELETE FROM fin_receipts WHERE id=$1', [staged]),
          check,
        );
        // PostgreSQL refuses first: the table is referenced by a foreign key (0A000); the guard is a second fence.
        await assert.rejects(pool.query('TRUNCATE fin_receipts'), {
          code: '0A000',
        });
        assert.ok(first);
        const discarded = await receipt();
        await pool.query(
          "UPDATE fin_receipts SET state='discarded' WHERE id=$1",
          [discarded],
        );
        await assert.rejects(
          pool.query("UPDATE fin_receipts SET state='staged' WHERE id=$1", [
            discarded,
          ]),
          check,
        );
        await assert.rejects(entry(pool, { receipt: discarded }), check);
        const free = await receipt();
        await pool.query('DELETE FROM fin_receipts WHERE id=$1', [free]); // staged cleanup is allowed
      },
    );
    await t.test("another Owner's receipt cannot be referenced", async () => {
      const theirs = await receipt(other, 'attached');
      // the insert guard (Owner-scoped lookup) fires before the composite foreign key would
      await assert.rejects(entry(pool, { receipt: theirs }), check);
    });
    await t.test(
      'attach + entry are atomic: a failed entry rolls the receipt back to staged',
      async () => {
        const r = await receipt();
        await assert.rejects(
          tx(async (c) => {
            await c.query(
              "UPDATE fin_receipts SET state='attached', attached_at=clock_timestamp() WHERE id=$1",
              [r],
            );
            await c.query(
              "INSERT INTO fin_entries(id,root_entry_id,workspace_id,owner_user_id,revision_number,direction,category_id,category_name_snapshot,amount_vnd,occurred_on,operation_key,request_fingerprint,receipt_id) VALUES ($1,$1,$2,$3,1,'expense',$4,'WRONG NAME',1,'2026-01-02',$5,repeat('a',64),$6)",
              [randomUUID(), ws, owner, cat, randomUUID(), r],
            );
          }),
          check,
        );
        assert.equal(
          (await pool.query('SELECT state FROM fin_receipts WHERE id=$1', [r]))
            .rows[0].state,
          'staged',
        );
      },
    );
  } finally {
    await pool.end();
  }
});
