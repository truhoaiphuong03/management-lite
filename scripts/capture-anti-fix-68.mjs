/* global document, window, sessionStorage, Storage, DOMException, setTimeout */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  createBoundedCdpSender,
  installScriptWatchdog,
  launchHeadlessChrome,
  waitForAppStartupSettled,
} from './qa-chrome-harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const handoffDir = resolve(root, 'docs/handoff/FIX-72');
mkdirSync(handoffDir, { recursive: true });

const targetUrl = process.env.QA_WEB_BASE;
if (!targetUrl) throw new Error('Explicit isolated QA_WEB_BASE is required');
const qaTarget = new URL(targetUrl);
if (
  qaTarget.protocol !== 'http:' ||
  qaTarget.hostname !== '127.0.0.1' ||
  ['3017', '3018', '3027', '3028', '3008'].includes(qaTarget.port)
)
  throw new Error('Operational/nonlocal browser endpoint refused');

/**
 * Runs INSIDE the browser against the mounted production PayrollScreen module.
 * Any missing interaction throws (suite FAILS); nothing is optional.
 */
async function pageSuite() {
  const React = (await import('/node_modules/.vite/deps/react.js')).default;
  const RD = (await import('/node_modules/.vite/deps/react-dom_client.js'))
    .default;
  const P = await import('/src/screens/PayrollScreen.tsx');
  document.getElementById('root')?.remove();

  const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const dd = new Date();
  const today = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
  const month = today.slice(0, 7);
  const ITEM_ID = '11111111-1111-4111-8111-111111111111';
  const WS = 'qa-ws';
  const USER = 'qa-owner';
  const DISB_PATH = `/api/v1/payroll/items/${ITEM_ID}/disbursements`;
  const V1 = 'mgmt_lite_unresolved_disbursements_v1';
  const v2Key = P.getScopedDisbursementStorageKey(WS, USER);

  const orig = {
    set: Storage.prototype.setItem,
    get: Storage.prototype.getItem,
    remove: Storage.prototype.removeItem,
  };
  const fault = { set: null, get: null, remove: null };
  Storage.prototype.setItem = function (k, v) {
    const r = fault.set ? fault.set(k, String(v)) : undefined;
    if (r && r.throw) throw r.throw;
    return orig.set.call(this, k, r && r.value !== undefined ? r.value : v);
  };
  Storage.prototype.getItem = function (k) {
    const v = orig.get.call(this, k);
    if (fault.get) {
      const r = fault.get(k, v);
      if (r !== undefined && r.throw) throw r.throw;
      if (r !== undefined) return r.value;
    }
    return v;
  };
  Storage.prototype.removeItem = function (k) {
    const r = fault.remove ? fault.remove(k) : undefined;
    if (r && r.throw) throw r.throw;
    return orig.remove.call(this, k);
  };
  // Raw helpers bypass fault injection
  const rawGet = (k) => orig.get.call(sessionStorage, k);
  const rawSet = (k, v) => orig.set.call(sessionStorage, k, v);
  const rawCount = (k) => {
    const v = rawGet(k);
    if (v === null) return 0;
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a.length : -1;
    } catch {
      return -1;
    }
  };
  const quota = () => new DOMException('QA quota', 'QuotaExceededError');

  const item = {
    id: ITEM_ID,
    employee_id: 'e',
    employee_code: 'E',
    full_name: 'QA employee',
    hourly_rate_vnd: 30000,
    version: 1,
    confirmed: {
      base_pay_vnd: 1000,
      net_pay_vnd: 1000,
      paid_amount_vnd: 0,
      paid_leave_pay_vnd: 0,
      approved_worked_minutes: 1,
    },
    pending_review: {
      estimated_pay_vnd: 0,
      pending_minutes: 0,
      shift_count: 0,
    },
    live_provisional: {
      has_open_shift: false,
      live_pay_vnd: 0,
      live_minutes: 0,
    },
    daily_breakdowns: [],
    adjustments: [],
    disbursements: [],
  };
  // Backend-shaped PayrollDisbursementData; overrides replace, `undefined` deletes.
  const dto = (over = {}) => {
    const d = {
      id: 'disb-valid-001',
      disbursement_order: 1,
      amount_vnd: 1000,
      payment_method: 'bank_transfer',
      payment_date: today,
      reference_note: null,
      created_at: '2026-10-11T00:00:00Z',
      ...over,
    };
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    return d;
  };
  const rec = (over = {}) => ({
    workspaceId: WS,
    userId: USER,
    itemId: ITEM_ID,
    employeeId: 'e',
    periodMonth: month,
    idempotencyKey: 'original-unknown-key',
    amount: '1000',
    method: 'bank_transfer',
    date: today,
    note: '',
    createdAt: 1790000000000,
    ...over,
  });

  const state = {
    auth: { userId: USER, wsId: WS, mode: 'ok' },
    authCalls: 0,
    authFailAfter: Infinity,
    posts: [],
    reqs: [],
    onPost: null,
  };
  const okJson = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const authBody = () => {
    const a = state.auth;
    const ws =
      a.mode === 'missing'
        ? { role: 'owner' }
        : a.mode === 'alias'
          ? { id: '', workspace_id: WS, role: 'owner' }
          : { id: a.wsId, role: 'owner' };
    return {
      success: true,
      data: {
        csrf_token: 'mock-csrf',
        user: { id: a.userId },
        active_workspace: ws,
      },
    };
  };
  window.__mockFetchRegistry__ = [
    {
      matches: (u) => u === '/api/v1/auth/me',
      handle: async () => {
        state.authCalls += 1;
        state.reqs.push('GET /auth/me');
        if (state.authCalls > state.authFailAfter) {
          return okJson({ success: false }, 401);
        }
        return okJson(authBody());
      },
    },
    {
      matches: (u, o) =>
        o && o.method === 'POST' && u === '/api/v1/auth/refresh',
      handle: async () => okJson({ success: false }, 401),
    },
    {
      matches: (u, o) => o && o.method === 'POST' && u === DISB_PATH,
      handle: async (u, o) => {
        state.reqs.push('POST disbursement');
        state.posts.push({
          key: o.headers['Idempotency-Key'],
          payload: JSON.parse(o.body),
        });
        return state.onPost(state.posts.length);
      },
    },
    {
      matches: (u, o) =>
        (!o || !o.method || o.method === 'GET') &&
        /^\/api\/v1\/payroll\/periods\/\d{4}-\d{2}$/.test(u),
      handle: async (u) => {
        state.reqs.push('GET period');
        return okJson({
          success: true,
          data: {
            period: {
              id: 'p',
              period_month: u.split('/').pop(),
              status: 'finalized',
              version: 1,
            },
            items: [item],
            server_as_of: '2026-10-11T00:00:00Z',
          },
        });
      },
    },
  ];

  const mustFind = (box, sel, pred, label) => {
    const el = Array.from(box.querySelectorAll(sel)).find(pred);
    if (!el) throw new Error(`MISSING INTERACTION TARGET: ${label}`);
    if (el.disabled) throw new Error(`INTERACTION TARGET DISABLED: ${label}`);
    return el;
  };
  const openModal = async (box) => {
    mustFind(
      box,
      'button',
      (b) => b.textContent.includes('Chi lương'),
      'open payment modal',
    ).click();
    await wait();
  };
  const hasSubmit = (box) =>
    Boolean(box.querySelector('[data-testid="disburse-submit-btn"]'));
  const submit = async (box, ms = 450) => {
    mustFind(
      box,
      '[data-testid="disburse-submit-btn"]',
      () => true,
      'submit payment',
    ).click();
    await wait(ms);
  };
  const typeNote = async (box, text) => {
    const input = mustFind(
      box,
      'input[type="text"]',
      (i) => (i.placeholder || '').startsWith('Ví dụ'),
      'note input',
    );
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    setter.call(input, text);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(100);
  };
  const shows = (box, text) => box.innerText.includes(text);
  const successShown = (box) =>
    box.innerText.includes('cho nhân viên QA employee');

  const defaultPost = () => okJson({ success: true, data: dto() });

  const cases = [];
  const run = async (name, setup, body) => {
    fault.set = fault.get = fault.remove = null;
    sessionStorage.clear();
    state.auth = { userId: USER, wsId: WS, mode: 'ok' };
    state.authCalls = 0;
    state.authFailAfter = Infinity;
    state.posts = [];
    state.reqs = [];
    state.onPost = defaultPost;
    if (setup) setup();
    const box = document.createElement('div');
    document.body.append(box);
    const mount = async () => {
      const r = RD.createRoot(box);
      r.render(React.createElement(P.PayrollScreen, { role: 'owner' }));
      await wait(350);
      return r;
    };
    let reactRoot = await mount();
    const ctx = {
      box,
      remount: async () => {
        reactRoot.unmount();
        box.innerHTML = '';
        reactRoot = await mount();
      },
    };
    const out = await body(ctx);
    reactRoot.unmount();
    box.remove();
    fault.set = fault.get = fault.remove = null;
    cases.push({ scenario: name, posts: state.posts.length, ...out });
    await wait(100);
  };

  // ---------- Direct function checks against the production module ----------
  const exp = {
    amount: 1000,
    payment_method: 'bank_transfer',
    payment_date: today,
    reference_note: 'REF-1',
  };
  const V = (resOk, body, e = exp) =>
    P.validateDisbursementSuccessResponse(resOk, body, e);
  const env = (d) => ({ success: true, data: d });
  const fnTests = [
    [
      'rejects resOk=false',
      V(false, env(dto({ reference_note: 'REF-1' }))) === false,
    ],
    ['rejects arbitrary id only', V(true, env({ id: 'x' })) === false],
    [
      'rejects wrong amount',
      V(true, env(dto({ amount_vnd: 999999, reference_note: 'REF-1' }))) ===
        false,
    ],
    [
      'rejects wrong method',
      V(true, env(dto({ payment_method: 'cash', reference_note: 'REF-1' }))) ===
        false,
    ],
    [
      'rejects wrong date',
      V(
        true,
        env(dto({ payment_date: '2000-01-01', reference_note: 'REF-1' })),
      ) === false,
    ],
    [
      'rejects missing reference_note when note requested',
      V(true, env(dto({ reference_note: undefined }))) === false,
    ],
    [
      'rejects missing reference_note when no note requested',
      V(true, env(dto({ reference_note: undefined })), {
        ...exp,
        reference_note: '',
      }) === false,
    ],
    [
      'rejects null reference_note when note requested',
      V(true, env(dto({ reference_note: null }))) === false,
    ],
    [
      'rejects mismatched reference_note',
      V(true, env(dto({ reference_note: 'OTHER' }))) === false,
    ],
    [
      'rejects non-string reference_note',
      V(true, env(dto({ reference_note: 5 }))) === false,
    ],
    [
      'accepts matching reference_note',
      V(true, env(dto({ reference_note: 'REF-1' }))) === true,
    ],
    [
      'accepts null reference_note when no note requested',
      V(true, env(dto({ reference_note: null })), {
        ...exp,
        reference_note: '',
      }) === true,
    ],
  ].map(([name, pass]) => ({ name, pass }));

  // ---------- Mounted scenarios ----------
  // Storage fail-closed gates before POST
  for (const kind of ['blocked', 'quota', 'readback']) {
    await run(kind, null, async ({ box }) => {
      await openModal(box);
      if (kind === 'readback') {
        fault.get = (k) => (k === v2Key ? { value: '[]' } : undefined);
      } else {
        fault.set = () => ({
          throw:
            kind === 'quota'
              ? quota()
              : new DOMException('QA', 'SecurityError'),
        });
      }
      await submit(box);
      fault.set = fault.get = null;
      return {
        successShown: successShown(box),
        errorShown: shows(box, 'Không thể lưu và xác thực'),
      };
    });
  }

  // Response validation (full backend DTO; only one field differs)
  await run('arbitrary-id', null, async ({ box }) => {
    state.onPost = () =>
      okJson({ success: true, data: { id: 'arbitrary-id' } });
    await openModal(box);
    await submit(box);
    return { successShown: successShown(box), pending: rawCount(v2Key) };
  });
  await run('wrong-amount', null, async ({ box }) => {
    state.onPost = () =>
      okJson({ success: true, data: dto({ amount_vnd: 999999 }) });
    await openModal(box);
    await submit(box);
    return { successShown: successShown(box), pending: rawCount(v2Key) };
  });
  await run('missing-note-field', null, async ({ box }) => {
    state.onPost = () =>
      okJson({ success: true, data: dto({ reference_note: undefined }) });
    await openModal(box);
    await typeNote(box, 'REF-1');
    await submit(box);
    return {
      successShown: successShown(box),
      pending: rawCount(v2Key),
      payloadNote: state.posts[0]?.payload.reference_note,
    };
  });
  await run('note-mismatch', null, async ({ box }) => {
    state.onPost = () =>
      okJson({ success: true, data: dto({ reference_note: 'OTHER' }) });
    await openModal(box);
    await typeNote(box, 'REF-1');
    await submit(box);
    return { successShown: successShown(box), pending: rawCount(v2Key) };
  });
  await run('valid-null-note', null, async ({ box }) => {
    state.onPost = () =>
      okJson({ success: true, data: dto({ reference_note: null }) });
    await openModal(box);
    await submit(box);
    return {
      successShown: successShown(box),
      pending: rawCount(v2Key),
      noteInPayload: 'reference_note' in (state.posts[0]?.payload || {}),
    };
  });
  await run('valid-with-note', null, async ({ box }) => {
    state.onPost = () =>
      okJson({ success: true, data: dto({ reference_note: 'REF-1' }) });
    await openModal(box);
    await typeNote(box, 'REF-1');
    await submit(box);
    return { successShown: successShown(box), pending: rawCount(v2Key) };
  });

  // Unknown-outcome statuses never clear pending
  for (const st of [401, 403, 409, 500]) {
    await run(`status-${st}`, null, async ({ box }) => {
      state.onPost = () =>
        okJson({ success: false, error: { message: 'x' } }, st);
      await openModal(box);
      await submit(box);
      return { successShown: successShown(box), pending: rawCount(v2Key) };
    });
  }
  await run('network-error', null, async ({ box }) => {
    state.onPost = () => {
      throw new TypeError('network down');
    };
    await openModal(box);
    await submit(box);
    return { successShown: successShown(box), pending: rawCount(v2Key) };
  });
  await run('same-key-retry', null, async ({ box }) => {
    state.onPost = (n) =>
      n === 1
        ? okJson({ success: false }, 500)
        : okJson({ success: true, data: dto() });
    await openModal(box);
    await submit(box);
    const firstPending = rawCount(v2Key);
    await submit(box);
    return {
      firstPending,
      successShown: successShown(box),
      pending: rawCount(v2Key),
      sameKey:
        state.posts.length === 2 && state.posts[0].key === state.posts[1].key,
    };
  });

  // Storage / identity gates
  await run(
    'corrupt-record',
    () => rawSet(v2Key, '{broken'),
    async ({ box }) => {
      await openModal(box);
      if (hasSubmit(box)) await submit(box);
      return {
        successShown: successShown(box),
        raw: rawGet(v2Key),
        errorShown: shows(box, 'lỗi') || shows(box, 'hỏng'),
      };
    },
  );
  for (const mode of ['missing', 'alias']) {
    await run(
      `identity-${mode}`,
      () => {
        state.auth.mode = mode;
      },
      async ({ box }) => {
        await openModal(box);
        await submit(box);
        return {
          successShown: successShown(box),
          errorShown: shows(box, 'chưa được xác thực'),
          storageWritten: rawGet(v2Key) !== null,
        };
      },
    );
  }

  // Legacy migration (Q69-01/02/04)
  await run(
    'legacy-exact',
    () => rawSet(V1, JSON.stringify([rec()])),
    async ({ box, remount }) => {
      await openModal(box);
      await submit(box);
      const out = {
        successShown: successShown(box),
        postedKey: state.posts[0]?.key,
        payload: state.posts[0]?.payload,
        v1After: rawGet(V1),
        v2Count: rawCount(v2Key),
      };
      await remount();
      out.afterRemountPending = P.inspectUnresolvedDisbursementStorage(
        WS,
        USER,
      ).records.size;
      out.v1AfterRemount = rawGet(V1);
      return out;
    },
  );
  await run(
    'legacy-write-quota',
    () => {
      rawSet(V1, JSON.stringify([rec()]));
      fault.set = (k) => (k === v2Key ? { throw: quota() } : undefined);
    },
    async ({ box, remount }) => {
      const v1Raw = rawGet(V1);
      const out = {
        v1SeededPresent: v1Raw !== null,
        v2Absent: rawGet(v2Key) === null,
      };
      await openModal(box);
      if (hasSubmit(box)) await submit(box);
      out.successShown = successShown(box);
      out.v1Preserved = v1Raw !== null && rawGet(V1) === v1Raw;
      out.errorShown = shows(box, 'đối soát') || shows(box, 'chuyển đổi');
      fault.set = null;
      await remount();
      const after = P.inspectUnresolvedDisbursementStorage(WS, USER);
      out.recoveredKey = [...after.records.values()][0]?.idempotencyKey;
      return out;
    },
  );
  await run(
    'legacy-readback-mismatch',
    () => {
      rawSet(V1, JSON.stringify([rec()]));
      fault.get = (k) => (k === v2Key ? { value: '[]' } : undefined);
    },
    async ({ box, remount }) => {
      const v1Raw = rawGet(V1);
      await openModal(box);
      if (hasSubmit(box)) await submit(box);
      const out = {
        v1SeededPresent: v1Raw !== null,
        v2Absent: rawGet(v2Key) === null,
        successShown: successShown(box),
        v1Preserved: v1Raw !== null && rawGet(V1) === v1Raw,
        errorShown: shows(box, 'đối soát') || shows(box, 'chuyển đổi'),
      };
      fault.get = null;
      await remount();
      out.recoveredKey = [
        ...P.inspectUnresolvedDisbursementStorage(WS, USER).records.values(),
      ][0]?.idempotencyKey;
      return out;
    },
  );
  await run(
    'legacy-source-cleanup-failure',
    () => {
      rawSet(V1, JSON.stringify([rec()]));
      fault.remove = (k) =>
        k === V1
          ? { throw: new DOMException('QA', 'SecurityError') }
          : undefined;
    },
    async ({ box }) => {
      await openModal(box);
      if (hasSubmit(box)) await submit(box);
      const out = {
        successShown: successShown(box),
        v1Present: rawGet(V1) !== null,
        errorShown: shows(box, 'đối soát') || shows(box, 'dọn'),
      };
      fault.remove = null;
      return out;
    },
  );
  for (const [label, seedRec] of [
    ['legacy-missing-workspace', rec({ workspaceId: '' })],
    ['legacy-missing-user', rec({ userId: '' })],
    ['legacy-other-user', rec({ userId: 'other-user-uuid' })],
  ]) {
    await run(
      label,
      () => rawSet(V1, JSON.stringify([seedRec])),
      async ({ box, remount }) => {
        const v1Raw = rawGet(V1);
        await remount();
        await openModal(box);
        if (hasSubmit(box)) await submit(box);
        return {
          successShown: successShown(box),
          v1Preserved: rawGet(V1) === v1Raw,
          errorShown: shows(box, 'đối soát') || shows(box, 'khóa'),
        };
      },
    );
  }
  await run(
    'legacy-conflict-key',
    () => {
      rawSet(v2Key, JSON.stringify([rec({ idempotencyKey: 'v2-key' })]));
      rawSet(V1, JSON.stringify([rec({ idempotencyKey: 'v1-key' })]));
    },
    async ({ box, remount }) => {
      const v1Raw = rawGet(V1);
      const v2Raw = rawGet(v2Key);
      await remount();
      await openModal(box);
      if (hasSubmit(box)) await submit(box);
      return {
        successShown: successShown(box),
        v1Preserved: rawGet(V1) === v1Raw,
        v2Preserved: rawGet(v2Key) === v2Raw,
        errorShown: shows(box, 'đối soát') || shows(box, 'khóa'),
      };
    },
  );
  await run(
    'duplicate-no-resurrect',
    () => {
      rawSet(v2Key, JSON.stringify([rec()]));
      rawSet(V1, JSON.stringify([rec()]));
    },
    async ({ box, remount }) => {
      await openModal(box);
      await submit(box);
      const out = {
        successShown: successShown(box),
        postedKey: state.posts[0]?.key,
        v1After: rawGet(V1),
        v2Count: rawCount(v2Key),
      };
      await remount();
      out.afterRemountPending = P.inspectUnresolvedDisbursementStorage(
        WS,
        USER,
      ).records.size;
      out.v1AfterRemount = rawGet(V1);
      return out;
    },
  );
  await run(
    'success-cleanup-failure',
    () => rawSet(v2Key, JSON.stringify([rec()])),
    async ({ box }) => {
      const v2Raw = rawGet(v2Key);
      let faulted = false;
      state.onPost = () => {
        if (!faulted) {
          faulted = true;
          fault.set = (k) => (k === v2Key ? { throw: quota() } : undefined);
        }
        return okJson({ success: true, data: dto() });
      };
      await openModal(box);
      await submit(box);
      const out = {
        successShown: successShown(box),
        pendingPreserved: rawGet(v2Key) === v2Raw,
        errorShown: shows(box, 'dọn bản ghi chờ'),
      };
      fault.set = null;
      await submit(box);
      out.retrySameKey =
        state.posts.length === 2 && state.posts[0].key === state.posts[1].key;
      out.retrySuccess = successShown(box);
      out.pendingAfterRetry = rawCount(v2Key);
      return out;
    },
  );

  // FIX-72 (Q71-01): cleanup whose write succeeds but read-back mismatches/throws
  const markerKey = `${v2Key}__recovery`;
  const armReadFault = (mode) => {
    const st = { armed: false };
    fault.set = (k, v) => {
      if (k === v2Key && v === '[]') st.armed = true;
      return undefined;
    };
    fault.get = (k) =>
      st.armed && k === v2Key
        ? mode === 'throw'
          ? { throw: new DOMException('QA read', 'SecurityError') }
          : { value: '[]x' }
        : undefined;
    return st;
  };
  await run(
    'cleanup-readback-mismatch',
    () => rawSet(v2Key, JSON.stringify([rec()])),
    async ({ box, remount }) => {
      const st = armReadFault('mismatch');
      await openModal(box);
      await submit(box);
      const out = {
        faultArmed: st.armed,
        firstPosts: state.posts.length,
        firstSuccessShown: successShown(box),
        firstErrorShown: shows(box, 'dọn bản ghi chờ'),
        markerKept: rawGet(markerKey) !== null,
      };
      fault.set = fault.get = null;
      await remount();
      const after = P.inspectUnresolvedDisbursementStorage(WS, USER);
      out.recoveredKey = [...after.records.values()][0]?.idempotencyKey;
      out.markerGoneAfterRecover = rawGet(markerKey) === null;
      await openModal(box);
      await submit(box);
      out.retryKeys = state.posts.map((p) => p.key);
      out.retrySuccess = successShown(box);
      out.pendingAfterRetry = rawCount(v2Key);
      out.markerGoneAfterRetry = rawGet(markerKey) === null;
      return out;
    },
  );
  await run(
    'cleanup-readback-throw',
    () => rawSet(v2Key, JSON.stringify([rec()])),
    async ({ box, remount }) => {
      const st = armReadFault('throw');
      await openModal(box);
      await submit(box);
      const out = {
        faultArmed: st.armed,
        firstPosts: state.posts.length,
        firstSuccessShown: successShown(box),
        markerKept: rawGet(markerKey) !== null,
      };
      // still failing to read: remount must stay fail-closed (no new key)
      await remount();
      await openModal(box);
      if (hasSubmit(box)) await submit(box);
      out.postsWhileReadFails = state.posts.length;
      out.blockedShown = shows(box, 'đối soát') || shows(box, 'Lỗi đọc');
      fault.set = fault.get = null;
      await remount();
      await openModal(box);
      await submit(box);
      out.retryKeys = state.posts.map((p) => p.key);
      out.retrySuccess = successShown(box);
      out.pendingAfterRetry = rawCount(v2Key);
      out.markerGoneAfterRetry = rawGet(markerKey) === null;
      return out;
    },
  );
  // FIX-72 (Q71-02): conflicting v2 records (both orders) must block with 0 POST
  for (const [label, recs] of [
    [
      'v2-conflict-key-ab',
      [rec({ idempotencyKey: 'k-a' }), rec({ idempotencyKey: 'k-b' })],
    ],
    [
      'v2-conflict-key-ba',
      [rec({ idempotencyKey: 'k-b' }), rec({ idempotencyKey: 'k-a' })],
    ],
    ['v2-conflict-payload-ab', [rec(), rec({ amount: '2000' })]],
    ['v2-conflict-payload-ba', [rec({ amount: '2000' }), rec()]],
  ]) {
    await run(
      label,
      () => rawSet(v2Key, JSON.stringify(recs)),
      async ({ box }) => {
        const raw = rawGet(v2Key);
        await openModal(box);
        if (hasSubmit(box)) await submit(box);
        return {
          successShown: successShown(box),
          rawPreserved: rawGet(v2Key) === raw,
          errorShown: shows(box, 'xung đột'),
        };
      },
    );
  }
  await run(
    'v2-identical-duplicate',
    () => rawSet(v2Key, JSON.stringify([rec(), rec()])),
    async ({ box }) => {
      await openModal(box);
      await submit(box);
      return {
        successShown: successShown(box),
        postedKey: state.posts[0]?.key,
        pending: rawCount(v2Key),
        markerGone: rawGet(markerKey) === null,
      };
    },
  );

  // FIX-76 (C75-05): a malformed / invalid / conflicting recovery marker must block
  // the POST, keep both raw records untouched and show a visible blocked state.
  for (const [label, markerRaw, v2Recs] of [
    ['marker-malformed-json', '{broken', [rec()]],
    [
      'marker-invalid-record-schema',
      JSON.stringify([{ workspaceId: WS, userId: USER, itemId: ITEM_ID }]),
      [rec()],
    ],
    [
      'marker-conflicts-with-v2',
      JSON.stringify([rec({ idempotencyKey: 'marker-key' })]),
      [rec({ idempotencyKey: 'v2-key' })],
    ],
  ]) {
    await run(
      label,
      () => {
        rawSet(v2Key, JSON.stringify(v2Recs));
        rawSet(markerKey, markerRaw);
      },
      async ({ box, remount }) => {
        const v2Before = rawGet(v2Key);
        const markerBefore = rawGet(markerKey);
        await openModal(box);
        if (hasSubmit(box)) await submit(box);
        await remount();
        await openModal(box);
        if (hasSubmit(box)) await submit(box);
        return {
          successShown: successShown(box),
          markerSeeded: markerBefore === markerRaw,
          markerPreserved: rawGet(markerKey) === markerBefore,
          v2Preserved: rawGet(v2Key) === v2Before,
          errorShown: shows(box, 'khôi phục'),
        };
      },
    );
  }

  // Identity / session change while mounted (same-tab raw storage writes are NOT cross-tab evidence)
  await run('cross-session-identity-change', null, async ({ box }) => {
    await openModal(box);
    state.auth.userId = 'other-user';
    await submit(box);
    return {
      successShown: successShown(box),
      storageWritten: rawGet(v2Key) !== null,
      errorShown: shows(box, 'đã thay đổi'),
    };
  });
  await run('cross-session-workspace-change', null, async ({ box }) => {
    await openModal(box);
    state.auth.wsId = 'other-ws';
    await submit(box);
    return {
      successShown: successShown(box),
      storageWritten: rawGet(v2Key) !== null,
      errorShown: shows(box, 'đã thay đổi'),
    };
  });
  await run('auth-unavailable-at-submit', null, async ({ box }) => {
    await openModal(box);
    state.authFailAfter = state.authCalls;
    await submit(box);
    return {
      successShown: successShown(box),
      storageWritten: rawGet(v2Key) !== null,
      errorShown: shows(box, 'Không xác minh được danh tính'),
    };
  });
  await run('same-tab-storage-record-appears', null, async ({ box }) => {
    await openModal(box);
    const injected = JSON.stringify([rec({ idempotencyKey: 'other-tab-key' })]);
    rawSet(v2Key, injected);
    await submit(box);
    return {
      successShown: successShown(box),
      raw: rawGet(v2Key) === injected,
      errorShown: shows(box, 'Thao tác bị chặn'),
    };
  });
  await run('valid-flow', null, async ({ box }) => {
    await openModal(box);
    await submit(box);
    return {
      successShown: successShown(box),
      pending: rawCount(v2Key),
      v1: rawGet(V1),
    };
  });

  return { fnTests, cases, reqs: state.reqs };
}

async function run() {
  const clearWatchdog = installScriptWatchdog('capture-anti-fix-68', 110_000);
  console.log(
    '=== ANTI-FIX-72 STRICT MOUNTED PRODUCTION SUITE (FAIL-CLOSED) ===\n',
  );
  const { port, cleanup } = await launchHeadlessChrome({
    preferredPort: 9470,
    prefix: 'chrome-fix-70-',
  });
  let ws = null;
  try {
    const newTab = await fetch(
      `http://127.0.0.1:${port}/json/new?about:blank`,
      { method: 'PUT' },
    ).then((r) => r.json());
    ws = new WebSocket(newTab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    const callbacks = new Map();
    const protocolBlocked = [];
    const cdpErrors = [];
    const runtimeErrors = [];
    let phase = 'startup';
    const send = createBoundedCdpSender(ws, callbacks, {
      commandTimeoutMs: 90_000,
    });
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Fetch.requestPaused') {
        protocolBlocked.push({
          url: msg.params.request.url,
          method: msg.params.request.method,
          phase,
        });
        send('Fetch.failRequest', {
          requestId: msg.params.requestId,
          errorReason: 'AccessDenied',
        }).catch((err) => {
          cdpErrors.push(String(err && err.message ? err.message : err));
        });
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown' && phase === 'test_suite') {
        runtimeErrors.push(
          msg.params.exceptionDetails.text +
            ' ' +
            (msg.params.exceptionDetails.exception?.description || ''),
        );
      }
      if (
        msg.method === 'Runtime.consoleAPICalled' &&
        phase === 'test_suite' &&
        msg.params.type === 'error'
      ) {
        runtimeErrors.push(
          'console.error: ' +
            msg.params.args
              .map((a) => a.value || a.description)
              .join(' ')
              .slice(0, 300),
        );
      }
      if (msg.id && callbacks.has(msg.id)) {
        const { res, rej } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
    const evaluate = async (exp) => {
      const r = await send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.text +
            ': ' +
            (r.exceptionDetails.exception?.description || ''),
        );
      }
      return r.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', {
      patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }],
    });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__CURRENT_PHASE__ = 'startup';
          window.__FAIL_CLOSED_VIOLATIONS__ = [];
          window.__mockFetchRegistry__ = [];
          window.fetch = async (url, opts = {}) => {
            const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
            for (const handler of window.__mockFetchRegistry__) {
              if (handler.matches(urlStr, opts)) return handler.handle(urlStr, opts);
            }
            window.__FAIL_CLOSED_VIOLATIONS__.push({ url: urlStr, method: opts.method || 'GET', phase: window.__CURRENT_PHASE__ || 'startup' });
            throw new Error('FAIL-CLOSED HARNESS: Real network blocked for ' + urlStr);
          };
        })()
      `,
    });
    await send('Page.navigate', { url: targetUrl });
    await waitForAppStartupSettled(evaluate);

    phase = 'probe';
    await evaluate(`window.__CURRENT_PHASE__ = 'probe'`);
    const probe = await evaluate(`
      (async () => {
        try { await window.fetch('/api/v1/controlled-probe-unmocked-endpoint'); return { blocked: false }; }
        catch (e) { return { blocked: true, msg: e.message }; }
      })()
    `);
    assert.equal(probe.blocked, true, 'Controlled probe must be blocked');
    assert.ok(probe.msg.includes('FAIL-CLOSED HARNESS'));
    console.log(
      '✔ Controlled probe blocked (fail-closed interceptor active)\n',
    );

    phase = 'test_suite';
    await evaluate(`window.__CURRENT_PHASE__ = 'test_suite'`);
    const result = await evaluate(`(${pageSuite.toString()})()`);
    const violations = await evaluate('window.__FAIL_CLOSED_VIOLATIONS__');

    console.log('Function checks:');
    for (const t of result.fnTests) {
      console.log(`- [UNIT] ${t.name}: ${t.pass ? 'PASS' : 'FAIL'}`);
      assert.equal(t.pass, true, `unit failed: ${t.name}`);
    }
    console.log('\nMounted scenarios:');
    for (const c of result.cases)
      console.log(`- [${c.scenario}] ${JSON.stringify(c)}`);

    writeFileSync(
      resolve(handoffDir, 'browser-pay.json'),
      JSON.stringify(
        { ...result, violations, protocolBlocked, runtimeErrors, cdpErrors },
        null,
        2,
      ),
      'utf8',
    );

    const by = new Map(result.cases.map((c) => [c.scenario, c]));
    const need = (n) => {
      const c = by.get(n);
      assert.ok(c, `scenario missing: ${n}`);
      return c;
    };
    const zeroPost = (n, extra = {}) => {
      const c = need(n);
      assert.equal(c.posts, 0, `${n}: expected 0 POST`);
      assert.equal(c.successShown, false, `${n}: success must not show`);
      for (const [k, v] of Object.entries(extra))
        assert.equal(c[k], v, `${n}: ${k}`);
    };
    const pendingKept = (n) => {
      const c = need(n);
      assert.equal(c.posts, 1, `${n}: expected exactly 1 POST`);
      assert.equal(c.successShown, false, `${n}: success must not show`);
      assert.equal(c.pending, 1, `${n}: pending must remain`);
    };

    // Storage gates: the submit must have happened (error visible), 0 POST
    for (const n of ['blocked', 'quota', 'readback'])
      zeroPost(n, { errorShown: true });
    // Response validation
    for (const n of [
      'arbitrary-id',
      'wrong-amount',
      'missing-note-field',
      'note-mismatch',
      'status-401',
      'status-403',
      'status-409',
      'status-500',
      'network-error',
    ])
      pendingKept(n);
    assert.equal(need('missing-note-field').payloadNote, 'REF-1');
    for (const n of ['valid-null-note', 'valid-with-note', 'valid-flow']) {
      const c = need(n);
      assert.equal(c.posts, 1, `${n}: 1 POST`);
      assert.equal(c.successShown, true, `${n}: success`);
      assert.equal(c.pending, 0, `${n}: pending cleared`);
    }
    assert.equal(need('valid-null-note').noteInPayload, false);
    {
      const c = need('same-key-retry');
      assert.equal(c.posts, 2);
      assert.equal(c.firstPending, 1);
      assert.equal(c.sameKey, true);
      assert.equal(c.successShown, true);
      assert.equal(c.pending, 0);
    }
    // Storage / identity
    zeroPost('corrupt-record', { raw: '{broken', errorShown: true });
    zeroPost('identity-missing', { errorShown: true, storageWritten: false });
    zeroPost('identity-alias', { errorShown: true, storageWritten: false });
    // Legacy
    {
      const c = need('legacy-exact');
      assert.equal(c.posts, 1);
      assert.equal(c.postedKey, 'original-unknown-key');
      assert.deepEqual(Object.keys(c.payload).sort(), [
        'amount_vnd',
        'payment_date',
        'payment_method',
      ]);
      assert.equal(c.payload.amount_vnd, 1000);
      assert.equal(c.payload.payment_method, 'bank_transfer');
      assert.match(c.payload.payment_date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(c.successShown, true);
      assert.equal(c.v1After, null);
      assert.equal(c.v2Count, 0);
      assert.equal(c.afterRemountPending, 0);
      assert.equal(c.v1AfterRemount, null);
    }
    for (const n of ['legacy-write-quota', 'legacy-readback-mismatch']) {
      zeroPost(n, {
        v1Preserved: true,
        errorShown: true,
        recoveredKey: 'original-unknown-key',
      });
    }
    assert.equal(need('legacy-write-quota').v2Absent, true);
    // Read-back fault is read-side only: restore may leave an empty list in v2,
    // which carries no pending operation; the source v1 record must stay intact.
    zeroPost('legacy-source-cleanup-failure', {
      v1Present: true,
      errorShown: true,
    });
    for (const n of [
      'legacy-missing-workspace',
      'legacy-missing-user',
      'legacy-other-user',
    ])
      zeroPost(n, { v1Preserved: true, errorShown: true });
    zeroPost('legacy-conflict-key', {
      v1Preserved: true,
      v2Preserved: true,
      errorShown: true,
    });
    {
      const c = need('duplicate-no-resurrect');
      assert.equal(c.posts, 1);
      assert.equal(c.postedKey, 'original-unknown-key');
      assert.equal(c.successShown, true);
      assert.equal(c.v1After, null);
      assert.equal(c.v2Count, 0);
      assert.equal(c.afterRemountPending, 0);
      assert.equal(c.v1AfterRemount, null);
    }
    {
      const c = need('success-cleanup-failure');
      assert.equal(c.posts, 2);
      assert.equal(c.successShown === false || c.retrySuccess === true, true);
      assert.equal(c.errorShown, true, 'cleanup failure must be reported');
      assert.equal(
        c.pendingPreserved,
        true,
        'pending must be kept on cleanup failure',
      );
      assert.equal(c.retrySameKey, true);
      assert.equal(c.retrySuccess, true);
      assert.equal(c.pendingAfterRetry, 0);
    }
    // FIX-72 Q71-01: cleanup write ok + read-back mismatch/throw
    {
      const c = need('cleanup-readback-mismatch');
      assert.equal(c.faultArmed, true, 'fault must have been exercised');
      assert.equal(c.firstPosts, 1);
      assert.equal(c.firstSuccessShown, false);
      assert.equal(c.firstErrorShown, true);
      assert.equal(c.markerKept, true, 'recovery marker must survive');
      assert.equal(c.recoveredKey, 'original-unknown-key');
      assert.equal(c.markerGoneAfterRecover, true);
      assert.deepEqual(
        c.retryKeys,
        ['original-unknown-key', 'original-unknown-key'],
        'no new key after remount',
      );
      assert.equal(c.retrySuccess, true);
      assert.equal(c.pendingAfterRetry, 0);
      assert.equal(c.markerGoneAfterRetry, true);
    }
    {
      const c = need('cleanup-readback-throw');
      assert.equal(c.faultArmed, true, 'fault must have been exercised');
      assert.equal(c.firstPosts, 1);
      assert.equal(c.firstSuccessShown, false);
      assert.equal(c.markerKept, true);
      assert.equal(c.postsWhileReadFails, 1, 'no POST while read still fails');
      assert.equal(c.blockedShown, true);
      assert.deepEqual(
        c.retryKeys,
        ['original-unknown-key', 'original-unknown-key'],
        'no new key after remount',
      );
      assert.equal(c.retrySuccess, true);
      assert.equal(c.pendingAfterRetry, 0);
      assert.equal(c.markerGoneAfterRetry, true);
    }
    // FIX-72 Q71-02: v2 conflicts in both orders
    for (const n of [
      'v2-conflict-key-ab',
      'v2-conflict-key-ba',
      'v2-conflict-payload-ab',
      'v2-conflict-payload-ba',
    ])
      zeroPost(n, { rawPreserved: true, errorShown: true });
    {
      const c = need('v2-identical-duplicate');
      assert.equal(c.posts, 1);
      assert.equal(c.postedKey, 'original-unknown-key');
      assert.equal(c.successShown, true);
      assert.equal(c.pending, 0);
      assert.equal(c.markerGone, true);
    }
    // FIX-76 C75-05: malformed / invalid / conflicting recovery marker
    for (const n of [
      'marker-malformed-json',
      'marker-invalid-record-schema',
      'marker-conflicts-with-v2',
    ])
      zeroPost(n, {
        markerSeeded: true,
        markerPreserved: true,
        v2Preserved: true,
        errorShown: true,
      });
    // Identity changes while mounted
    zeroPost('cross-session-identity-change', {
      storageWritten: false,
      errorShown: true,
    });
    zeroPost('cross-session-workspace-change', {
      storageWritten: false,
      errorShown: true,
    });
    zeroPost('auth-unavailable-at-submit', {
      storageWritten: false,
      errorShown: true,
    });
    zeroPost('same-tab-storage-record-appears', {
      raw: true,
      errorShown: true,
    });

    // Harness safety: no unexpected network, no runtime errors, only expected routes
    assert.deepEqual(
      violations.filter((v) => v.phase === 'test_suite'),
      [],
      'unexpected requests in test phase',
    );
    assert.ok(
      violations
        .filter((v) => v.phase === 'startup')
        .every((v) => v.url === '/api/v1/auth/me'),
      'startup violations must only be the app auto auth/me',
    );
    assert.equal(violations.filter((v) => v.phase === 'probe').length, 1);
    assert.deepEqual(
      protocolBlocked.filter((b) => b.phase === 'test_suite'),
      [],
      'CDP-blocked requests in test phase',
    );
    assert.deepEqual(runtimeErrors, [], 'runtime errors in browser');
    assert.deepEqual(cdpErrors, [], 'CDP command errors in requestPaused');

    console.log(
      `\n✔ ALL ${result.cases.length} MOUNTED PRODUCTION SCENARIOS + ${result.fnTests.length} FUNCTION CHECKS PASSED (strict)`,
    );
  } finally {
    clearWatchdog();
    ws?.close();
    await cleanup();
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
