// FIN receipts: service + HTTP route tests on a scripted fake pool (no real DB, no real Gemini).
// These prove FIN logic only. DB triggers, constraints and real transactions are NOT exercised here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FinanceService } from '../../dist/apps/api/src/finance/service.js';
import { ReceiptStore } from '../../dist/apps/api/src/finance/receipt-store.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { generateCsrfToken } from '../../dist/packages/security/src/csrf.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const auth = (role = 'owner') => ({
  sessionId: '44444444-4444-4444-8444-444444444444',
  sessionTokenHash: HASH,
  user: { id: OWNER },
  workspace: { id: WS, role },
});
const png = (n = 0) => {
  const b = new Uint8Array(60 + n);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b.set([0x49, 0x45, 0x4e, 0x44], b.length - 8);
  return b;
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function fakePool(state) {
  state.log = [];
  const rows = (r = []) => ({ rows: r, rowCount: r.length });
  const query = async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    state.log.push({ q, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return rows();
    if (q.includes('pg_advisory_xact_lock')) return rows([{}]);
    if (q.startsWith('SELECT id FROM users')) return rows([{ id: OWNER }]);
    if (q.includes('FROM user_workspace_bindings')) return rows([{ id: 'b' }]);
    if (q.includes('FROM workspace_memberships'))
      return state.revoked ? rows() : rows([{ role: 'owner' }]);
    if (q.includes('FROM auth_sessions')) return rows([{ id: 's' }]);
    if (q.startsWith('SELECT id FROM workspaces')) return rows([{ id: WS }]);
    if (q.startsWith('INSERT INTO fin_receipts'))
      return rows([{ expires_at: new Date('2026-10-12T00:00:00Z') }]);
    if (q.includes('FROM fin_entries e JOIN fin_receipts r'))
      return rows(state.dup ? [{ root_entry_id: state.dup }] : []);
    if (q.startsWith('INSERT INTO audit_events')) return rows([{ id: 'a1' }]);
    if (q.startsWith('SELECT id,storage_key,mime_type'))
      return state.receipt && params[3].includes(state.receipt.state)
        ? rows([state.receipt])
        : rows();
    if (q.startsWith('SELECT id,name,direction FROM fin_categories'))
      return rows(state.categories ?? []);
    if (q.startsWith("UPDATE fin_receipts SET state='discarded'"))
      return state.discardRow ? rows([state.discardRow]) : rows();
    if (q.startsWith('SELECT state FROM fin_receipts'))
      return state.anyState ? rows([{ state: state.anyState }]) : rows();
    if (q.startsWith('SELECT 1 FROM fin_receipts'))
      return state.shared ? rows([{}]) : rows();
    return rows();
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
  };
}
async function fixture(t, { ai, now, decode } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fin-rcpt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = {};
  const svc = new FinanceService(fakePool(state), {
    receipts: new ReceiptStore(dir),
    ai,
    decodeImage: decode ?? (async () => ({})),
    now: now ?? (() => new Date('2026-10-11T05:00:00Z')),
  });
  return { dir, state, svc };
}
const rejects = (p, code, status) =>
  assert.rejects(p, (e) => e.code === code && e.statusCode === status);

// ---------------- time resolution ----------------
test('FIN time: auto stamps the server clock once; Vietnam date can differ from UTC date', async (t) => {
  const f = await fixture(t, { now: () => new Date('2026-10-11T17:01:00Z') });
  const r = f.svc.createTime({ time_mode: 'auto' });
  assert.equal(r.source, 'auto');
  assert.equal(r.occurred_on, '2026-10-12'); // 00:01 on the 12th in Vietnam
  assert.equal(r.occurred_at.toISOString(), '2026-10-11T17:01:00.000Z');
});
test('FIN time: manual accepts the past, rejects the future, keeps the typed Vietnam date', async (t) => {
  const f = await fixture(t);
  const ok = f.svc.createTime({
    time_mode: 'manual',
    occurred_at: '2026-10-11T00:30:00+07:00',
  });
  assert.equal(ok.source, 'manual');
  assert.equal(ok.occurred_on, '2026-10-11');
  assert.equal(ok.occurred_at.toISOString(), '2026-10-10T17:30:00.000Z');
  assert.throws(
    () =>
      f.svc.createTime({
        time_mode: 'manual',
        occurred_at: '2026-10-11T12:01:00+07:00', // now is 12:00 VN
      }),
    (e) => e.code === 'FUTURE_TIME' && e.statusCode === 422,
  );
  assert.equal(
    f.svc.createTime({
      time_mode: 'manual',
      occurred_at: '2026-10-11T12:00:00+07:00',
    }).source,
    'manual',
  );
});
test('FIN time: legacy date-only requests stay date-only and never get a time', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.svc.createTime({ occurred_on: '2026-01-02' }), {
    occurred_at: null,
    occurred_on: '2026-01-02',
    source: 'legacy_date_only',
  });
});
test('FIN time: correction keeps the original time unless a manual time is sent', async (t) => {
  const f = await fixture(t);
  const at = new Date('2026-10-10T17:30:00Z');
  const old = {
    occurred_on: '2026-10-11',
    occurred_at: at,
    occurred_at_source: 'auto',
  };
  // no time fields at all, or the same date: unchanged
  for (const data of [{}, { occurred_on: '2026-10-11' }]) {
    const r = f.svc.correctionTime(old, data);
    assert.equal(r.occurred_at, at);
    assert.equal(r.source, 'auto');
    assert.equal(r.occurred_on, '2026-10-11');
  }
  // another date on a timed row would silently invent a time: refused
  assert.throws(
    () => f.svc.correctionTime(old, { occurred_on: '2026-10-09' }),
    (e) => e.code === 'TIME_REQUIRED' && e.statusCode === 422,
  );
  // explicit manual correction
  const m = f.svc.correctionTime(old, {
    time_mode: 'manual',
    occurred_at: '2026-10-09T08:00:00+07:00',
    occurred_on: '2026-10-09',
  });
  assert.equal(m.source, 'manual');
  assert.equal(m.occurred_on, '2026-10-09');
  // legacy row: date-only correction stays date-only
  const legacy = {
    occurred_on: '2026-10-01',
    occurred_at: null,
    occurred_at_source: 'legacy_date_only',
  };
  assert.deepEqual(
    f.svc.correctionTime(legacy, { occurred_on: '2026-10-02' }),
    {
      occurred_at: null,
      occurred_on: '2026-10-02',
      source: 'legacy_date_only',
    },
  );
});

// ---------------- receipt upload ----------------
test('FIN receipt upload: stores a private JPEG/PNG, audits, no entry written', async (t) => {
  const f = await fixture(t);
  const bytes = png();
  const out = await f.svc.uploadReceipt(auth(), bytes, 'image/png', 'req-1');
  assert.equal(out.status, 201);
  assert.match(out.body.data.id, /^[0-9a-f-]{36}$/);
  assert.equal(out.body.data.mime_type, 'image/png');
  assert.equal(out.body.data.duplicate_of_entry_id, null);
  const dirOwner = join(f.dir, WS, OWNER);
  const files = await readdir(dirOwner);
  assert.deepEqual(files, [`${sha(bytes)}.png`]);
  assert.equal((await stat(join(dirOwner, files[0]))).mode & 0o777, 0o600);
  assert.ok(
    f.state.log.some((l) => l.q.startsWith('INSERT INTO fin_receipts')),
  );
  assert.ok(
    f.state.log.some((l) => l.q.startsWith('INSERT INTO audit_events')),
  );
  assert.equal(
    f.state.log.some((l) => l.q.startsWith('INSERT INTO fin_entries')),
    false,
  );
});
test('FIN receipt upload: WebP, mismatch, oversize and non-owner are refused before any write', async (t) => {
  const f = await fixture(t);
  const webp = new Uint8Array([
    ...Buffer.from('RIFF'),
    4,
    0,
    0,
    0,
    ...Buffer.from('WEBP'),
  ]);
  await rejects(
    f.svc.uploadReceipt(auth(), webp, 'image/webp', 'r'),
    'RECEIPT_UNSUPPORTED_TYPE',
    415,
  );
  await rejects(
    f.svc.uploadReceipt(auth(), png(), 'image/jpeg', 'r'),
    'RECEIPT_TYPE_MISMATCH',
    415,
  );
  await rejects(
    f.svc.uploadReceipt(auth(), png(4 * 1024 * 1024), 'image/png', 'r'),
    'RECEIPT_TOO_LARGE',
    413,
  );
  await assert.rejects(
    f.svc.uploadReceipt(auth('staff'), png(), 'image/png', 'r'),
    (e) => e.statusCode === 403,
  );
  assert.equal(f.state.log.length, 0, 'no DB access for refused uploads');
  await assert.rejects(readdir(join(f.dir, WS)), { code: 'ENOENT' });
});
test('FIN receipt upload: without a configured store it is unavailable (manual FIN unaffected)', async () => {
  const state = {};
  const svc = new FinanceService(fakePool(state), {});
  await rejects(
    svc.uploadReceipt(auth(), png(), 'image/png', 'r'),
    'RECEIPTS_UNAVAILABLE',
    503,
  );
});
test('FIN receipt upload: a digest already attached elsewhere is advisory only', async (t) => {
  const f = await fixture(t);
  f.state.dup = '55555555-5555-4555-8555-555555555555';
  const out = await f.svc.uploadReceipt(auth(), png(), 'image/png', 'r');
  assert.equal(out.status, 201);
  assert.equal(out.body.data.duplicate_of_entry_id, f.state.dup);
});

// ---------------- discard ----------------
async function stage(f, bytes = png()) {
  const out = await f.svc.uploadReceipt(auth(), bytes, 'image/png', 'r');
  const key = `${WS}/${OWNER}/${sha(bytes)}.png`;
  f.state.receipt = {
    id: out.body.data.id,
    storage_key: key,
    mime_type: 'image/png',
    size_bytes: bytes.length,
    sha256: sha(bytes),
    state: 'staged',
  };
  return { id: out.body.data.id, key, bytes };
}
test('FIN receipt discard: removes an unreferenced staged file only', async (t) => {
  const f = await fixture(t);
  const r = await stage(f);
  f.state.discardRow = { storage_key: r.key };
  const out = await f.svc.discardReceipt(auth(), r.id, 'r');
  assert.equal(out.body.data.state, 'discarded');
  assert.deepEqual(await readdir(join(f.dir, WS, OWNER)), []);
});
test('FIN receipt discard: a file shared with another receipt is kept', async (t) => {
  const f = await fixture(t);
  const r = await stage(f);
  f.state.discardRow = { storage_key: r.key };
  f.state.shared = true;
  await f.svc.discardReceipt(auth(), r.id, 'r');
  assert.equal((await readdir(join(f.dir, WS, OWNER))).length, 1);
});
test('FIN receipt discard: an attached receipt is never deleted', async (t) => {
  const f = await fixture(t);
  const r = await stage(f);
  f.state.discardRow = null;
  f.state.anyState = 'attached';
  await rejects(
    f.svc.discardReceipt(auth(), r.id, 'r'),
    'RECEIPT_ATTACHED',
    409,
  );
  assert.equal((await readdir(join(f.dir, WS, OWNER))).length, 1);
  f.state.anyState = null;
  await rejects(f.svc.discardReceipt(auth(), r.id, 'r'), 'NOT_FOUND', 404);
});

// ---------------- AI extraction (mock AI Core; never Gemini) ----------------
const draft = {
  fields: {
    amount: { value: '125000', evidence: '125.000' },
    currency: { value: 'VND', evidence: 'đ' },
    date: { value: '2026-10-10', evidence: '10/10' },
    time: { value: null, evidence: null },
    merchant: { value: 'Quán A', evidence: 'Quán A' },
    description: { value: null, evidence: null },
    direction: { value: 'expense', evidence: 'Tổng' },
    categoryId: { value: CAT, evidence: 'Ăn' },
  },
  uncertainties: [{ field: 'time', reason: 'missing' }],
};
class FakeAiCoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AiCoreError';
    this.code = code;
  }
}
function mockAi(behaviour) {
  const calls = [];
  return {
    calls,
    extractReceipt: async (ctx, input, signal) => {
      calls.push({ ctx, input, signal });
      return behaviour(ctx, input, signal);
    },
  };
}
test('FIN AI: only the Owner click sends the image; result is a suggestion and nothing is saved', async (t) => {
  const ai = mockAi(async () => ({ draft, reviewRequired: true }));
  const f = await fixture(t, { ai });
  f.state.categories = [{ id: CAT, name: 'Ăn uống', direction: 'expense' }];
  const r = await stage(f);
  assert.equal(ai.calls.length, 0, 'upload alone never calls AI');
  const out = await f.svc.extractReceipt(
    auth(),
    r.id,
    new AbortController().signal,
    'req',
  );
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].ctx.auth.user.id, OWNER);
  assert.equal(ai.calls[0].input.image.mimeType, 'image/png');
  assert.deepEqual([...ai.calls[0].input.image.bytes], [...r.bytes]);
  assert.deepEqual(ai.calls[0].input.context.categories, [
    { id: CAT, name: 'Ăn uống', direction: 'expense' },
  ]);
  assert.equal(out.status, 'ok');
  assert.equal(out.data.amount_vnd, '125000');
  assert.equal(out.data.occurred_on, '2026-10-10');
  assert.equal(
    out.data.occurred_at,
    null,
    'a date-only receipt never invents a time',
  );
  assert.equal(out.data.suggested_category_id, CAT);
  assert.equal('evidence' in out.data, false);
  assert.equal(
    f.state.log.some((l) =>
      /INSERT INTO fin_entries|UPDATE fin_receipts/.test(l.q),
    ),
    false,
    'extraction never creates an entry or changes the receipt state',
  );
  assert.ok(
    f.state.log.some(
      (l) =>
        l.q.startsWith('INSERT INTO audit_events') &&
        l.params.includes('FIN_RECEIPT_AI_READ'),
    ),
  );
});
test('FIN AI: no DB transaction is open while the provider call runs', async (t) => {
  let depth = 0;
  let during = null;
  const ai = mockAi(async () => {
    during = depth;
    return { draft, reviewRequired: true };
  });
  const f = await fixture(t, { ai });
  const inner = f.svc.pool;
  const origConnect = inner.connect;
  inner.connect = async () => {
    const c = await origConnect();
    const q = c.query;
    c.query = async (sql, p) => {
      if (/^BEGIN/.test(sql)) depth++;
      if (/^(COMMIT|ROLLBACK)/.test(sql)) depth--;
      return q(sql, p);
    };
    return c;
  };
  const r = await stage(f);
  depth = 0;
  await f.svc.extractReceipt(auth(), r.id, new AbortController().signal, 'req');
  assert.equal(during, 0);
});
test('FIN AI: absent AI Core is "unavailable" and the image is never read or sent', async (t) => {
  const f = await fixture(t, {});
  const r = await stage(f);
  const out = await f.svc.extractReceipt(
    auth(),
    r.id,
    new AbortController().signal,
    'req',
  );
  assert.deepEqual(out, { status: 'unavailable', reason: 'AI_NOT_CONFIGURED' });
});
test('FIN AI: error mapping follows the handoff and never leaks provider text', async (t) => {
  const secret = 'SECRET-PROVIDER-TEXT-sk-test';
  for (const [code, expect] of [
    ['AI_TIMEOUT', { reason: 'AI_TIMEOUT' }],
    ['AI_INVALID_OUTPUT', { reason: 'AI_INVALID_OUTPUT' }],
    ['AI_PROVIDER_REJECTED', { reason: 'AI_PROVIDER_REJECTED' }],
    ['AI_PROVIDER_UNAVAILABLE', { reason: 'AI_PROVIDER_UNAVAILABLE' }],
    ['AI_NOT_CONFIGURED', { reason: 'AI_NOT_CONFIGURED' }],
  ]) {
    const f = await fixture(t, {
      ai: mockAi(async () => {
        throw new FakeAiCoreError(code);
      }),
    });
    const r = await stage(f);
    const out = await f.svc.extractReceipt(
      auth(),
      r.id,
      new AbortController().signal,
      'q',
    );
    assert.deepEqual(out, { status: 'unavailable', ...expect });
  }
  const f = await fixture(t, {
    ai: mockAi(async () => {
      throw new Error(secret);
    }),
  });
  const r = await stage(f);
  const out = await f.svc.extractReceipt(
    auth(),
    r.id,
    new AbortController().signal,
    'q',
  );
  assert.deepEqual(out, {
    status: 'unavailable',
    reason: 'AI_PROVIDER_UNAVAILABLE',
  });
  assert.equal(JSON.stringify(f.state.log).includes(secret), false);
  for (const [code, c, s] of [
    ['AI_RATE_LIMITED', 'AI_RATE_LIMITED', 429],
    ['AI_BUSY', 'AI_RATE_LIMITED', 429],
    ['AI_UNAUTHORIZED', 'FORBIDDEN', 403],
    ['AI_INVALID_INPUT', 'VALIDATION_ERROR', 422],
    ['AI_CANCELLED', 'CANCELLED', 499],
  ]) {
    const g = await fixture(t, {
      ai: mockAi(async () => {
        throw new FakeAiCoreError(code);
      }),
    });
    const rr = await stage(g);
    await rejects(
      g.svc.extractReceipt(auth(), rr.id, new AbortController().signal, 'q'),
      c,
      s,
    );
  }
});
test('FIN AI: authorization lost during the provider call discards the result', async (t) => {
  let f;
  const ai = mockAi(async () => {
    f.state.revoked = true; // Owner membership revoked while the provider call ran
    return { draft, reviewRequired: true };
  });
  f = await fixture(t, { ai });
  const r = await stage(f);
  await assert.rejects(
    f.svc.extractReceipt(auth(), r.id, new AbortController().signal, 'q'),
    (e) => e.statusCode === 401,
  );
});
test('FIN AI: a tampered stored file is not sent to the provider', async (t) => {
  const ai = mockAi(async () => ({ draft, reviewRequired: true }));
  const f = await fixture(t, { ai });
  const r = await stage(f);
  f.state.receipt.sha256 = 'f'.repeat(64);
  await rejects(
    f.svc.extractReceipt(auth(), r.id, new AbortController().signal, 'q'),
    'NOT_FOUND',
    404,
  );
  assert.equal(ai.calls.length, 0);
});
test('FIN AI: another Owner or non-staged receipt is not found and never reaches the provider', async (t) => {
  const ai = mockAi(async () => ({ draft, reviewRequired: true }));
  const f = await fixture(t, { ai });
  await rejects(
    f.svc.extractReceipt(
      auth(),
      '66666666-6666-4666-8666-666666666666',
      new AbortController().signal,
      'q',
    ),
    'NOT_FOUND',
    404,
  );
  const r = await stage(f);
  f.state.receipt.state = 'attached';
  await rejects(
    f.svc.extractReceipt(auth(), r.id, new AbortController().signal, 'q'),
    'NOT_FOUND',
    404,
  );
  assert.equal(ai.calls.length, 0);
  await assert.rejects(
    f.svc.extractReceipt(
      auth('staff'),
      r.id,
      new AbortController().signal,
      'q',
    ),
    (e) => e.statusCode === 403,
  );
});
test('FIN AI authorizeOwner re-checks the CURRENT session and refuses aborted calls', async (t) => {
  const f = await fixture(t, {});
  const ctx = { auth: auth() };
  assert.deepEqual(
    await f.svc.aiAuthorizer(ctx, new AbortController().signal),
    {
      userId: OWNER,
      workspaceId: WS,
      role: 'owner',
    },
  );
  const ac = new AbortController();
  ac.abort();
  assert.equal(await f.svc.aiAuthorizer(ctx, ac.signal), null);
  f.state.revoked = true;
  assert.equal(
    await f.svc.aiAuthorizer(ctx, new AbortController().signal),
    null,
  );
  assert.equal(
    await f.svc.aiAuthorizer(
      { auth: auth('staff') },
      new AbortController().signal,
    ),
    null,
  );
});

// ---------------- HTTP routes ----------------
async function server(t, { ai, role = 'owner' } = {}) {
  const f = await fixture(t, { ai });
  const secret = crypto.randomBytes(32).toString('hex');
  const handler = createRequestHandler({
    authService: { resolveSession: async () => auth(role) },
    financeService: f.svc,
    csrfSecret: secret,
    isProduction: false,
    allowedOrigins: ['http://localhost:3000'],
  });
  const srv = http.createServer(handler);
  await new Promise((d) => srv.listen(0, '127.0.0.1', d));
  t.after(() => new Promise((d) => srv.close(d)));
  const port = srv.address().port;
  const csrf = generateCsrfToken(HASH, secret);
  const call = (method, path, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            Cookie: 'mglite_session=tok',
            Origin: 'http://localhost:3000',
            'X-CSRF-Token': csrf,
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              raw: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  return { f, call, csrf };
}
const json = (r) => JSON.parse(r.raw.toString('utf8'));
test('FIN HTTP: upload then view returns the exact bytes privately; extract returns a suggestion', async (t) => {
  const ai = mockAi(async () => ({ draft, reviewRequired: true }));
  const s = await server(t, { ai });
  s.f.state.categories = [{ id: CAT, name: 'Ăn', direction: 'expense' }];
  const bytes = png();
  const up = await s.call('POST', '/api/v1/fin/receipts', Buffer.from(bytes), {
    'Content-Type': 'image/png',
  });
  assert.equal(up.status, 201);
  const id = json(up).data.id;
  s.f.state.receipt = {
    id,
    storage_key: `${WS}/${OWNER}/${sha(bytes)}.png`,
    mime_type: 'image/png',
    size_bytes: bytes.length,
    sha256: sha(bytes),
    state: 'staged',
  };
  const file = await s.call('GET', `/api/v1/fin/receipts/${id}/file`);
  assert.equal(file.status, 200);
  assert.deepEqual([...file.raw], [...bytes]);
  assert.equal(file.headers['cache-control'], 'private, no-store');
  assert.equal(file.headers['x-content-type-options'], 'nosniff');
  assert.equal(file.headers['content-type'], 'image/png');
  const ex = await s.call('POST', `/api/v1/fin/receipts/${id}/extract`);
  assert.equal(ex.status, 200);
  assert.equal(json(ex).data.status, 'ok');
  assert.equal(json(ex).data.data.amount_vnd, '125000');
});
test('FIN HTTP: staff, missing CSRF, bad type and oversize are refused', async (t) => {
  const staff = await server(t, { role: 'staff' });
  const r1 = await staff.call(
    'POST',
    '/api/v1/fin/receipts',
    Buffer.from(png()),
    { 'Content-Type': 'image/png' },
  );
  assert.equal(r1.status, 403);
  const owner = await server(t);
  const noCsrf = await owner.call(
    'POST',
    '/api/v1/fin/receipts',
    Buffer.from(png()),
    {
      'Content-Type': 'image/png',
      'X-CSRF-Token': 'bad',
    },
  );
  assert.equal(noCsrf.status, 403);
  const webp = Buffer.from([
    ...Buffer.from('RIFF'),
    4,
    0,
    0,
    0,
    ...Buffer.from('WEBP'),
  ]);
  const r2 = await owner.call('POST', '/api/v1/fin/receipts', webp, {
    'Content-Type': 'image/webp',
  });
  assert.equal(r2.status, 415);
  const big = await owner
    .call(
      'POST',
      '/api/v1/fin/receipts',
      Buffer.alloc(4 * 1024 * 1024 + 1, 1),
      {
        'Content-Type': 'image/png',
      },
    )
    .catch((e) => ({ status: 'socket-closed', err: e.code }));
  assert.ok(
    big.status === 413 || big.status === 'socket-closed',
    String(big.status),
  );
  assert.equal((await owner.call('GET', '/api/v1/fin/receipts')).status, 404);
  const files = await readdir(join(owner.f.dir)).catch(() => []);
  assert.deepEqual(files, [], 'nothing was stored for refused uploads');
});
test('FIN HTTP: extract with no AI configured answers unavailable, not an error', async (t) => {
  const s = await server(t);
  const bytes = png();
  const up = await s.call('POST', '/api/v1/fin/receipts', Buffer.from(bytes), {
    'Content-Type': 'image/png',
  });
  const id = json(up).data.id;
  s.f.state.receipt = {
    id,
    storage_key: `${WS}/${OWNER}/${sha(bytes)}.png`,
    mime_type: 'image/png',
    size_bytes: bytes.length,
    sha256: sha(bytes),
    state: 'staged',
  };
  const ex = await s.call('POST', `/api/v1/fin/receipts/${id}/extract`);
  assert.equal(ex.status, 200);
  assert.deepEqual(json(ex).data, {
    status: 'unavailable',
    reason: 'AI_NOT_CONFIGURED',
  });
});
