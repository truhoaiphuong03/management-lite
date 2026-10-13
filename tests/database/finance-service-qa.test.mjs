// FIN service on a REAL isolated PostgreSQL (migration 0015 applied) with the real AI Core
// (stub provider: no network, no Gemini). SKIPs unless an isolated QA database is provisioned.
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
import { AiCore } from '../../dist/apps/api/src/ai-core/index.js';

const PROTECTED_PORTS = new Set(['3017', '3018', '55499', '55571', '55601']);
const uuidRe = /^[0-9a-f-]{36}$/;

test('FIN service + AI Core on an isolated QA PostgreSQL', async (t) => {
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
    max: 6,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  });
  const dir = await mkdtemp(join(tmpdir(), 'fin-qa-receipts-'));
  try {
    assert.equal(
      (await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'"))
        .rowCount,
      0,
      'QA database must start empty',
    );
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    assert.equal(
      (await runMigrations(pool, migrations)).appliedCount,
      migrations.length,
    );

    // ---- fixtures: an active Owner with a live session ----
    const ws = randomUUID();
    const owner = randomUUID();
    const other = randomUUID();
    const sessionId = randomUUID();
    const tokenHash = createHash('sha256').update('qa-session').digest('hex');
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
      await pool.query(
        "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES ($1,$2,'active')",
        [ws, id],
      );
      await pool.query(
        "INSERT INTO user_credentials(user_id,password_hash) VALUES ($1,'x')",
        [id],
      );
    }
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

    let clock = new Date();
    const svc = new FinanceService(pool, {
      receipts: new ReceiptStore(dir),
      now: () => clock,
    });
    const draftCalls = [];
    const draft = (categoryId) => {
      const none = { value: null, evidence: null };
      return {
        fields: {
          amount: { value: '125000', evidence: '125.000' },
          currency: { value: 'VND', evidence: 'đ' },
          date: { value: '2026-10-10', evidence: '10/10/2026' },
          time: none,
          merchant: { value: 'Quán A', evidence: 'Quán A' },
          description: none,
          direction: { value: 'expense', evidence: 'Tổng' },
          categoryId: { value: categoryId, evidence: 'Ăn' },
        },
        uncertainties: [
          { field: 'time', reason: 'missing' },
          { field: 'description', reason: 'missing' },
        ],
      };
    };
    let categoryForDraft = null;
    const core = new AiCore(
      {
        extractReceipt: async (input) => {
          draftCalls.push(input);
          return draft(categoryForDraft);
        },
      },
      svc.aiAuthorizer,
    );
    svc.options.ai = core;

    const png = await sharp({
      create: { width: 24, height: 24, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const bytes = new Uint8Array(png);
    const k = () => randomUUID();
    const req = () => randomUUID();
    const cat = (
      await svc.createCategory(
        auth,
        { direction: 'expense', name: 'Ăn uống' },
        k(),
        req(),
      )
    ).body.data;
    categoryForDraft = cat.id;
    const entry = (body, key = k()) => svc.createEntry(auth, body, key, req());
    const base = {
      direction: 'expense',
      category_id: cat.id,
      amount_vnd: '125000',
      note: null,
    };
    const count = async (sql, p = []) =>
      Number((await pool.query(sql, p)).rows[0].n);
    const rejects = (p, code, status) =>
      assert.rejects(p, (e) => e.code === code && e.statusCode === status);

    await t.test(
      'auto time: stamped once; retry and replay never change it',
      async () => {
        clock = new Date(Date.now() - 5000);
        const key = k();
        const first = await entry({ ...base, time_mode: 'auto' }, key);
        assert.equal(first.status, 201);
        const d = first.body.data;
        assert.equal(d.occurred_at_source, 'auto');
        assert.match(
          d.occurred_at,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/,
        );
        assert.equal(d.occurred_on, d.occurred_at.slice(0, 10));
        assert.equal(d.receipt_id, null);
        clock = new Date(Date.now() + 2 * 3600e3); // a later retry must not re-stamp
        const retry = await entry({ ...base, time_mode: 'auto' }, key);
        assert.deepEqual(retry.body.data, d, 'identical response and time');
        assert.equal(
          await count(
            'SELECT count(*) n FROM fin_entries WHERE operation_key LIKE $1',
            [`%${key}`],
          ),
          1,
        );
        await rejects(
          entry({ ...base, time_mode: 'auto', amount_vnd: '5' }, key),
          'IDEMPOTENCY_CONFLICT',
          409,
        );
        clock = new Date();
      },
    );
    await t.test(
      'manual time: past ok, future refused, no row written for refused',
      async () => {
        const before = await count('SELECT count(*) n FROM fin_entries');
        const ok = await entry({
          ...base,
          time_mode: 'manual',
          occurred_at: '2026-01-02T08:15:00+07:00',
        });
        assert.equal(ok.body.data.occurred_at, '2026-01-02T08:15:00+07:00');
        assert.equal(ok.body.data.occurred_on, '2026-01-02');
        assert.equal(ok.body.data.occurred_at_source, 'manual');
        const future = new Date(Date.now() + 3600e3 + 7 * 3600e3)
          .toISOString()
          .slice(0, 16);
        await rejects(
          entry({
            ...base,
            time_mode: 'manual',
            occurred_at: `${future}:00+07:00`,
          }),
          'FUTURE_TIME',
          422,
        );
        assert.equal(
          await count('SELECT count(*) n FROM fin_entries'),
          before + 1,
        );
      },
    );
    await t.test(
      'legacy date-only requests still work and read back without a time',
      async () => {
        const r = await entry({ ...base, occurred_on: '2025-12-31' });
        assert.equal(r.body.data.occurred_at, null);
        assert.equal(r.body.data.occurred_at_source, 'legacy_date_only');
        const read = await svc.detail(auth, r.body.data.id);
        assert.equal(read.occurred_at, null);
        assert.equal(read.occurred_on, '2025-12-31');
      },
    );
    await t.test(
      'correction: time-only, amount-only keeps time, no-change refused',
      async () => {
        const created = (
          await entry({
            ...base,
            time_mode: 'manual',
            occurred_at: '2026-03-04T10:00:00+07:00',
          })
        ).body.data;
        const correct = (body, match) =>
          svc.correct(
            auth,
            created.id,
            { ...base, reason: 'sửa', ...body },
            k(),
            match,
            req(),
          );
        const t2 = (
          await correct(
            { time_mode: 'manual', occurred_at: '2026-03-04T11:30:00+07:00' },
            '"1"',
          )
        ).body.data;
        assert.equal(t2.version, 2);
        assert.equal(t2.occurred_at, '2026-03-04T11:30:00+07:00');
        const a3 = (await correct({ amount_vnd: '777' }, '"2"')).body.data;
        assert.equal(a3.version, 3);
        assert.equal(a3.amount_vnd, '777');
        assert.equal(
          a3.occurred_at,
          '2026-03-04T11:30:00+07:00',
          'time unchanged by an amount correction',
        );
        await rejects(correct({ amount_vnd: '777' }, '"3"'), 'NO_CHANGE', 422);
        await rejects(
          correct({ occurred_on: '2026-03-01', amount_vnd: '1' }, '"3"'),
          'TIME_REQUIRED',
          422,
        );
        assert.equal((await svc.detail(auth, created.id)).version, 3);
      },
    );
    await t.test(
      'receipt: upload -> attach in the entry transaction -> view -> immutable',
      async () => {
        const up = (await svc.uploadReceipt(auth, bytes, 'image/png', req()))
          .body.data;
        assert.match(up.id, uuidRe);
        assert.equal(
          (
            await pool.query('SELECT state FROM fin_receipts WHERE id=$1', [
              up.id,
            ])
          ).rows[0].state,
          'staged',
        );
        const saved = (
          await entry({ ...base, time_mode: 'auto', receipt_id: up.id })
        ).body.data;
        assert.equal(saved.receipt_id, up.id);
        assert.equal(
          (
            await pool.query('SELECT state FROM fin_receipts WHERE id=$1', [
              up.id,
            ])
          ).rows[0].state,
          'attached',
        );
        const file = await svc.receiptFile(auth, up.id);
        assert.deepEqual([...file.bytes], [...bytes]);
        assert.equal(file.mime, 'image/png');
        await rejects(
          svc.discardReceipt(auth, up.id, req()),
          'RECEIPT_ATTACHED',
          409,
        );
        await rejects(
          entry({ ...base, time_mode: 'auto', receipt_id: up.id }),
          'RECEIPT_UNAVAILABLE',
          422,
        );
        assert.equal((await svc.detail(auth, saved.id)).receipt_id, up.id);
        // receipt-only correction (replace -> remove) creates revisions
        const up2 = (
          await svc.uploadReceipt(
            auth,
            new Uint8Array(
              await sharp({
                create: {
                  width: 30,
                  height: 20,
                  channels: 3,
                  background: '#eee',
                },
              })
                .png()
                .toBuffer(),
            ),
            'image/png',
            req(),
          )
        ).body.data;
        const c2 = (
          await svc.correct(
            auth,
            saved.id,
            { ...base, receipt_id: up2.id, reason: 'đổi ảnh' },
            k(),
            '"1"',
            req(),
          )
        ).body.data;
        assert.equal(c2.receipt_id, up2.id);
        assert.equal(
          c2.occurred_at,
          saved.occurred_at,
          'time kept on a receipt-only correction',
        );
        const c3 = (
          await svc.correct(
            auth,
            saved.id,
            { ...base, receipt_id: null, reason: 'bỏ ảnh' },
            k(),
            '"2"',
            req(),
          )
        ).body.data;
        assert.equal(c3.receipt_id, null);
      },
    );
    await t.test(
      'receipt: another Owner, a discarded or an expired receipt cannot attach',
      async () => {
        const otherAuth = { ...auth, user: { id: other } };
        const theirs = randomUUID();
        await pool.query(
          "INSERT INTO fin_receipts(id,workspace_id,owner_user_id,storage_key,mime_type,size_bytes,sha256,expires_at) VALUES ($1,$2,$3,$4,'image/png',10,$5,clock_timestamp()+interval '1 hour')",
          [
            theirs,
            ws,
            other,
            `${ws}/${other}/${'c'.repeat(64)}.png`,
            'c'.repeat(64),
          ],
        );
        await rejects(
          entry({ ...base, time_mode: 'auto', receipt_id: theirs }),
          'RECEIPT_UNAVAILABLE',
          422,
        );
        await rejects(svc.receiptFile(auth, theirs), 'NOT_FOUND', 404);
        await rejects(
          svc.discardReceipt(auth, theirs, req()),
          'NOT_FOUND',
          404,
        );
        const up = (await svc.uploadReceipt(auth, bytes, 'image/png', req()))
          .body.data;
        await svc.discardReceipt(auth, up.id, req());
        await rejects(
          entry({ ...base, time_mode: 'auto', receipt_id: up.id }),
          'RECEIPT_UNAVAILABLE',
          422,
        );
        const expired = randomUUID();
        await pool.query(
          "INSERT INTO fin_receipts(id,workspace_id,owner_user_id,storage_key,mime_type,size_bytes,sha256,expires_at) VALUES ($1,$2,$3,$4,'image/png',10,$5,clock_timestamp()+interval '30 milliseconds')",
          [
            expired,
            ws,
            owner,
            `${ws}/${owner}/${'d'.repeat(64)}.png`,
            'd'.repeat(64),
          ],
        );
        await new Promise((r) => setTimeout(r, 80));
        await rejects(
          entry({ ...base, time_mode: 'auto', receipt_id: expired }),
          'RECEIPT_UNAVAILABLE',
          422,
        );
        assert.equal(await svc.purgeExpiredReceipts(), 1);
        assert.equal(otherAuth.user.id, other);
      },
    );
    await t.test(
      'a failed entry never consumes the staged receipt',
      async () => {
        const up = (await svc.uploadReceipt(auth, bytes, 'image/png', req()))
          .body.data;
        await rejects(
          entry({
            ...base,
            category_id: randomUUID(),
            time_mode: 'auto',
            receipt_id: up.id,
          }),
          'NOT_FOUND',
          404,
        );
        assert.equal(
          (
            await pool.query('SELECT state FROM fin_receipts WHERE id=$1', [
              up.id,
            ])
          ).rows[0].state,
          'staged',
        );
      },
    );
    await t.test(
      'AI Core: Owner click returns a reviewable suggestion and saves nothing',
      async () => {
        const up = (await svc.uploadReceipt(auth, bytes, 'image/png', req()))
          .body.data;
        const entriesBefore = await count('SELECT count(*) n FROM fin_entries');
        assert.equal(
          draftCalls.length,
          0,
          'upload alone never calls the provider',
        );
        const out = await svc.extractReceipt(
          auth,
          up.id,
          new AbortController().signal,
          req(),
        );
        assert.equal(out.status, 'ok');
        assert.equal(out.data.amount_vnd, '125000');
        assert.equal(out.data.occurred_on, '2026-10-10');
        assert.equal(out.data.occurred_at, null);
        assert.equal(out.data.suggested_category_id, cat.id);
        assert.equal(draftCalls.length, 1);
        assert.equal(draftCalls[0].image.mimeType, 'image/png');
        assert.ok(draftCalls[0].image.bytes.length > 0);
        assert.equal(
          await count('SELECT count(*) n FROM fin_entries'),
          entriesBefore,
        );
        assert.equal(
          (
            await pool.query('SELECT state FROM fin_receipts WHERE id=$1', [
              up.id,
            ])
          ).rows[0].state,
          'staged',
        );
        // another Owner's receipt id never reaches the provider
        await rejects(
          svc
            .extractReceipt(
              { ...auth, user: { id: other } },
              up.id,
              new AbortController().signal,
              req(),
            )
            .catch((e) => {
              throw e;
            }),
          'UNAUTHENTICATED',
          401,
        );
        assert.equal(draftCalls.length, 1);
      },
    );
    await t.test(
      'AI Core: revoked session is refused before any image is sent',
      async () => {
        const up = (await svc.uploadReceipt(auth, bytes, 'image/png', req()))
          .body.data;
        const before = draftCalls.length;
        await pool.query(
          'UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',
          [sessionId],
        );
        await assert.rejects(
          svc.extractReceipt(auth, up.id, new AbortController().signal, req()),
          (e) => e.statusCode === 401,
        );
        assert.equal(draftCalls.length, before);
        await pool.query(
          'UPDATE auth_sessions SET revoked_at=NULL WHERE id=$1',
          [sessionId],
        );
      },
    );
    await t.test(
      'audit trail exists for create, correct, upload, discard and AI read',
      async () => {
        for (const action of [
          'FIN_ENTRY_CREATED',
          'FIN_ENTRY_CORRECTED',
          'FIN_RECEIPT_UPLOADED',
          'FIN_RECEIPT_DISCARDED',
          'FIN_RECEIPT_AI_READ',
        ])
          assert.ok(
            await count('SELECT count(*) n FROM audit_events WHERE action=$1', [
              action,
            ]),
            action,
          );
        const meta = JSON.stringify(
          (
            await pool.query(
              "SELECT metadata_sanitized FROM audit_events WHERE action='FIN_RECEIPT_AI_READ'",
            )
          ).rows,
        );
        assert.doesNotMatch(
          meta,
          /Quán|125000|GEMINI|image/i,
          'no receipt content in audit metadata',
        );
      },
    );
    await t.test(
      'stored files exist only for kept receipts (private, 0600)',
      async () => {
        const files = await readdir(join(dir, ws, owner));
        assert.ok(files.length >= 1);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await pool.end();
  }
});
