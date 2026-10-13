// FIN over REAL HTTP + real AuthService sessions + real PostgreSQL (isolated QA) + real AI Core wiring
// (stub provider: no network/Gemini). SKIPs unless an isolated QA database is provisioned.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { AuthService } from '../../dist/apps/api/src/auth/service.js';
import { FinanceService } from '../../dist/apps/api/src/finance/service.js';
import { ReceiptStore } from '../../dist/apps/api/src/finance/receipt-store.js';
import { createFinanceAiCore } from '../../dist/apps/api/src/finance/ai-wiring.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';

const PROTECTED_PORTS = new Set(['3017', '3018', '55499', '55571', '55601']);

test('FIN HTTP + DB + AI Core wiring on an isolated QA PostgreSQL', async (t) => {
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
    max: 8,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  });
  const dir = await mkdtemp(join(tmpdir(), 'fin-qa-http-'));
  const servers = [];
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
    const ws = crypto.randomUUID();
    await pool.query(
      "INSERT INTO workspaces(id,name) VALUES ($1,'FIN HTTP QA')",
      [ws],
    );
    const secret = crypto.randomBytes(32).toString('hex');
    const origin = 'http://127.0.0.1:3917';
    const authService = new AuthService(pool, secret);

    const providerCalls = [];
    const providerDraft = (categoryId) => {
      const none = { value: null, evidence: null };
      return {
        fields: {
          amount: { value: '88000', evidence: '88.000' },
          currency: { value: 'VND', evidence: 'đ' },
          date: { value: '2026-10-10', evidence: '10/10' },
          time: { value: '12:30', evidence: '12:30' },
          merchant: { value: 'Quán B', evidence: 'Quán B' },
          description: none,
          direction: { value: 'expense', evidence: 'Tổng' },
          categoryId: { value: categoryId, evidence: 'Ăn' },
        },
        uncertainties: [{ field: 'description', reason: 'missing' }],
      };
    };
    let draftCategory = null;
    const finance = new FinanceService(pool, {
      receipts: new ReceiptStore(dir),
    });
    // Real wiring module with a stub provider (never a Gemini call).
    const warnings = [];
    const core = createFinanceAiCore(
      {},
      finance.aiAuthorizer,
      { warn: (m) => warnings.push(m) },
      {
        extractReceipt: async (input) => {
          providerCalls.push(input);
          return providerDraft(draftCategory);
        },
      },
    );
    assert.ok(core, 'AI Core is created from the wiring module');
    finance.options.ai = core;
    // Same service wiring without AI and without storage: manual FIN only.
    const manualOnly = new FinanceService(pool, {});
    const start = async (financeService) => {
      const server = http.createServer(
        createRequestHandler({
          pool,
          authService,
          financeService,
          csrfSecret: secret,
          allowedOrigins: [origin],
          isProduction: false,
        }),
      );
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      servers.push(server);
      return `http://127.0.0.1:${server.address().port}`;
    };
    const base = await start(finance);
    const baseManual = await start(manualOnly);
    const call = async (
      b,
      path,
      actor,
      { method, body, headers, raw } = {},
    ) => {
      const res = await fetch(b + path, {
        method: method ?? (body === undefined && !raw ? 'GET' : 'POST'),
        headers: {
          Origin: origin,
          ...(raw ? {} : { 'Content-Type': 'application/json' }),
          ...(actor
            ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf }
            : {}),
          ...headers,
        },
        ...(raw
          ? { body: raw }
          : body === undefined
            ? {}
            : { body: JSON.stringify(body) }),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      let json = null;
      if ((res.headers.get('content-type') ?? '').includes('json'))
        json = JSON.parse(buf.toString('utf8'));
      return {
        status: res.status,
        headers: res.headers,
        buf,
        json,
        cookie: res.headers.get('set-cookie'),
      };
    };
    async function actor(role) {
      const id = crypto.randomUUID();
      const name = 'fin_' + id.replaceAll('-', '');
      const password = crypto.randomBytes(30).toString('base64url');
      await pool.query(
        "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES ($1,$2,$3,'active')",
        [id, name, name + '@test.invalid'],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id,password_hash) VALUES ($1,$2)',
        [id, await hashPassword(password)],
      );
      await pool.query(
        "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES ($1,$2,$3,'active')",
        [ws, id, role],
      );
      await pool.query(
        "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES ($1,$2,'active')",
        [ws, id],
      );
      const login = await call(base, '/api/v1/auth/login', null, {
        body: { identifier: name, password },
      });
      assert.equal(login.status, 200);
      return {
        id,
        cookie: login.cookie.split(';')[0],
        csrf: login.json.data.csrf_token,
      };
    }
    const owner = await actor('owner');
    const staff = await actor('staff');
    const png = await sharp({
      create: { width: 24, height: 24, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
    const png2 = Buffer.from(png);

    const category = (
      await call(base, '/api/v1/fin/categories', owner, {
        body: { direction: 'expense', name: 'Ăn uống' },
        headers: idem(),
      })
    ).json.data;
    draftCategory = category.id;
    const entryBody = {
      direction: 'expense',
      category_id: category.id,
      amount_vnd: '88000',
      note: null,
    };

    await t.test(
      'manual FIN works on a server with no AI and no receipt storage',
      async () => {
        const r = await call(baseManual, '/api/v1/fin/entries', owner, {
          body: { ...entryBody, time_mode: 'auto' },
          headers: idem(),
        });
        assert.equal(r.status, 201);
        assert.equal(r.json.data.occurred_at_source, 'auto');
        const up = await call(baseManual, '/api/v1/fin/receipts', owner, {
          raw: png2,
          headers: { 'Content-Type': 'image/png' },
        });
        assert.equal(up.status, 503);
        assert.equal(up.json.error.code, 'RECEIPTS_UNAVAILABLE');
      },
    );
    let receiptId;
    await t.test(
      'upload -> view -> Read with AI (suggestion only) -> Owner saves with receipt',
      async () => {
        const up = await call(base, '/api/v1/fin/receipts', owner, {
          raw: png2,
          headers: { 'Content-Type': 'image/png' },
        });
        assert.equal(up.status, 201);
        receiptId = up.json.data.id;
        const file = await call(
          base,
          `/api/v1/fin/receipts/${receiptId}/file`,
          owner,
        );
        assert.equal(file.status, 200);
        assert.equal(file.headers.get('cache-control'), 'private, no-store');
        assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual([...file.buf], [...png2]);
        assert.equal(providerCalls.length, 0);
        const entriesBefore = Number(
          (await pool.query('SELECT count(*) n FROM fin_entries')).rows[0].n,
        );
        const ex = await call(
          base,
          `/api/v1/fin/receipts/${receiptId}/extract`,
          owner,
          { method: 'POST' },
        );
        assert.equal(ex.status, 200);
        assert.equal(ex.json.data.status, 'ok');
        assert.equal(ex.json.data.data.amount_vnd, '88000');
        assert.equal(
          ex.json.data.data.occurred_at,
          '2026-10-10T12:30:00+07:00',
        );
        assert.equal(ex.json.data.data.suggested_category_id, category.id);
        assert.equal(JSON.stringify(ex.json).includes('evidence'), false);
        assert.equal(providerCalls.length, 1);
        assert.equal(
          Number(
            (await pool.query('SELECT count(*) n FROM fin_entries')).rows[0].n,
          ),
          entriesBefore,
          'AI never saves',
        );
        const saved = await call(base, '/api/v1/fin/entries', owner, {
          body: {
            ...entryBody,
            time_mode: 'manual',
            occurred_at: ex.json.data.data.occurred_at,
            receipt_id: receiptId,
          },
          headers: idem(),
        });
        assert.equal(saved.status, 201);
        assert.equal(saved.json.data.receipt_id, receiptId);
        assert.equal(saved.json.data.occurred_at, '2026-10-10T12:30:00+07:00');
        const detail = await call(
          base,
          `/api/v1/fin/entries/${saved.json.data.id}`,
          owner,
        );
        assert.equal(detail.json.data.receipt_id, receiptId);
        const again = await call(
          base,
          `/api/v1/fin/receipts/${receiptId}/extract`,
          owner,
          { method: 'POST' },
        );
        assert.equal(
          again.status,
          404,
          'attached receipt is not re-read by AI',
        );
      },
    );
    await t.test(
      'Owner-only, CSRF and authentication on every receipt route',
      async () => {
        const others = [
          ['POST', '/api/v1/fin/receipts', png2],
          ['GET', `/api/v1/fin/receipts/${receiptId}/file`],
          ['POST', `/api/v1/fin/receipts/${receiptId}/extract`],
          ['DELETE', `/api/v1/fin/receipts/${receiptId}`],
        ];
        for (const [method, path, raw] of others) {
          const opts = {
            method,
            ...(raw ? { raw, headers: { 'Content-Type': 'image/png' } } : {}),
          };
          assert.equal(
            (await call(base, path, staff, opts)).status,
            403,
            `staff ${method} ${path}`,
          );
          assert.equal(
            (await call(base, path, null, opts)).status,
            401,
            `anon ${method} ${path}`,
          );
          if (method !== 'GET')
            assert.equal(
              (await call(base, path, { ...owner, csrf: 'bad' }, opts)).status,
              403,
              `csrf ${method} ${path}`,
            );
        }
        assert.equal(
          providerCalls.length,
          1,
          'no refused request reached the provider',
        );
      },
    );
    await t.test(
      'upload rules: WebP, wrong type and oversize are rejected over HTTP',
      async () => {
        const webp = Buffer.from([
          ...Buffer.from('RIFF'),
          4,
          0,
          0,
          0,
          ...Buffer.from('WEBP'),
        ]);
        assert.equal(
          (
            await call(base, '/api/v1/fin/receipts', owner, {
              raw: webp,
              headers: { 'Content-Type': 'image/webp' },
            })
          ).status,
          415,
        );
        assert.equal(
          (
            await call(base, '/api/v1/fin/receipts', owner, {
              raw: png2,
              headers: { 'Content-Type': 'image/jpeg' },
            })
          ).status,
          415,
        );
        const big = await call(base, '/api/v1/fin/receipts', owner, {
          raw: Buffer.alloc(4 * 1024 * 1024 + 1, 1),
          headers: { 'Content-Type': 'image/png' },
        }).catch((e) => ({ status: 'closed', e }));
        assert.ok(big.status === 413 || big.status === 'closed');
      },
    );
    await t.test(
      'discard works for staged only; attached is refused',
      async () => {
        const png3 = Buffer.from(
          await sharp({
            create: { width: 25, height: 25, channels: 3, background: '#ddd' },
          })
            .png()
            .toBuffer(),
        );
        const up = await call(base, '/api/v1/fin/receipts', owner, {
          raw: png3,
          headers: { 'Content-Type': 'image/png' },
        });
        const del = await call(
          base,
          `/api/v1/fin/receipts/${up.json.data.id}`,
          owner,
          { method: 'DELETE' },
        );
        assert.equal(del.status, 200);
        assert.equal(
          (
            await call(
              base,
              `/api/v1/fin/receipts/${up.json.data.id}/file`,
              owner,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(base, `/api/v1/fin/receipts/${receiptId}`, owner, {
              method: 'DELETE',
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'AI unconfigured: extract answers unavailable and manual save still works',
      async () => {
        const png4 = Buffer.from(
          await sharp({
            create: { width: 26, height: 26, channels: 3, background: '#bbb' },
          })
            .png()
            .toBuffer(),
        );
        const svcNoAi = new FinanceService(pool, {
          receipts: new ReceiptStore(dir),
        });
        const b = await start(svcNoAi);
        const up = await call(b, '/api/v1/fin/receipts', owner, {
          raw: png4,
          headers: { 'Content-Type': 'image/png' },
        });
        const ex = await call(
          b,
          `/api/v1/fin/receipts/${up.json.data.id}/extract`,
          owner,
          { method: 'POST' },
        );
        assert.equal(ex.status, 200);
        assert.deepEqual(ex.json.data, {
          status: 'unavailable',
          reason: 'AI_NOT_CONFIGURED',
        });
        const saved = await call(b, '/api/v1/fin/entries', owner, {
          body: {
            ...entryBody,
            time_mode: 'auto',
            receipt_id: up.json.data.id,
          },
          headers: idem(),
        });
        assert.equal(saved.status, 201);
      },
    );
    await t.test(
      'wiring: no config -> no AI Core; invalid config -> warning without secrets',
      async () => {
        assert.equal(
          createFinanceAiCore({}, finance.aiAuthorizer, { warn() {} }),
          undefined,
        );
        const w = [];
        const secretValue = 'SECRET-VALUE-0123456789abcdef-NOT-A-REAL-KEY';
        assert.equal(
          createFinanceAiCore(
            { GEMINI_API_KEY: secretValue, GEMINI_MODEL: 'not-gemini' },
            finance.aiAuthorizer,
            { warn: (m) => w.push(m) },
          ),
          undefined,
        );
        assert.equal(w.length, 1);
        assert.equal(w[0].includes(secretValue), false);
        assert.ok(
          createFinanceAiCore(
            { GEMINI_API_KEY: secretValue, GEMINI_MODEL: 'gemini-test-model' },
            finance.aiAuthorizer,
            { warn() {} },
          ),
          'valid-shaped config builds AI Core without any network call',
        );
      },
    );
  } finally {
    for (const s of servers) await new Promise((r) => s.close(r));
    await rm(dir, { recursive: true, force: true });
    await pool.end();
  }
});
