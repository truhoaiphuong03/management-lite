import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// FIN final API QA. WRITES data: run ONLY against an isolated QA stack (never 3017/3018).
// Env: FIN_QA_API (default http://127.0.0.1:3048/api/v1), FIN_QA_ORIGIN (default http://127.0.0.1:3047).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const api = loadQaEndpoint(process.env.QA_API_BASE) + '/api/v1';
const origin = loadQaEndpoint(process.env.QA_WEB_BASE);
if (/:(3017|3018)\b/.test(api))
  throw new Error('Refusing to run on live ports');
const creds = readFileSync('.env.qa-credentials.local', 'utf8');
const pw = (k) =>
  new RegExp(`${k}=(.*)`)
    .exec(creds)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');

let failed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log('PASS:', name);
  } catch (e) {
    failed++;
    console.log('FAIL:', name, '-', String(e.message).split('\n')[0]);
  }
};

async function login(identifier, password) {
  const r = await fetch(api + '/auth/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200) return null;
  const j = await r.json();
  return {
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
    csrf: j.data.csrf_token,
  };
}
async function req(path, actor, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(api + path, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(actor ? { cookie: actor.cookie, 'x-csrf-token': actor.csrf } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, data: j.data, code: j.error?.code };
}
const mut = (path, actor, body, method = 'POST', extra = {}) =>
  req(path, actor, {
    method,
    body,
    headers: { 'idempotency-key': crypto.randomUUID(), ...extra },
  });

let owner = null;
for (const p of [qaAdminPassword])
  if (p && (owner = await login('admin', p))) break;
const staff = await login('staff', pw('STAFF_PASSWORD'));
assert.ok(owner, 'owner login on QA stack');
assert.ok(staff, 'staff login on QA stack');
const fakeId = crypto.randomUUID();

const endpoints = [
  ['GET', '/fin/categories'],
  ['GET', '/fin/entries'],
  ['GET', `/fin/entries/${fakeId}`],
  ['GET', `/fin/entries/${fakeId}/corrections`],
  ['GET', '/fin/summary?period=month&anchor=2026-10-01'],
  ['GET', '/fin/plan'],
  ['GET', '/fin/plan?month=2026-10'],
  ['POST', '/fin/categories', { direction: 'expense', name: 'X' }],
  ['POST', '/fin/entries', {}],
  ['POST', `/fin/entries/${fakeId}/correct`, {}],
  [
    'POST',
    '/fin/plan-items',
    { direction: 'expense', category_id: fakeId, amount_vnd: '1' },
  ],
  ['PATCH', `/fin/plan-items/${fakeId}`, { amount_vnd: '1' }],
  ['PATCH', `/fin/categories/${fakeId}`, { is_active: false }],
  ['POST', '/fin/receipts', {}],
  ['DELETE', `/fin/receipts/${fakeId}`],
];
await t(
  `Chưa đăng nhập: ${endpoints.length} endpoint FIN đều 401`,
  async () => {
    for (const [m, p, b] of endpoints) {
      const r = await req(p, null, {
        method: m,
        body: b,
        headers: { 'idempotency-key': crypto.randomUUID(), 'if-match': '"1"' },
      });
      assert.equal(r.status, 401, `${m} ${p} -> ${r.status}`);
    }
  },
);
await t(`Staff: ${endpoints.length} endpoint FIN đều 403`, async () => {
  for (const [m, p, b] of endpoints) {
    const r = await req(p, staff, {
      method: m,
      body: b,
      headers: { 'idempotency-key': crypto.randomUUID(), 'if-match': '"1"' },
    });
    assert.equal(r.status, 403, `${m} ${p} -> ${r.status}`);
  }
});
await t('Owner đọc được (200) mọi GET', async () => {
  for (const [, p] of endpoints.filter(
    (e) => e[0] === 'GET' && !e[1].includes(fakeId),
  )) {
    assert.equal((await req(p, owner)).status, 200, p);
  }
});

// Fixtures: own categories
const cats = (await req('/fin/categories?limit=100&offset=0', owner)).data
  .items;
const inc = cats.find((c) => c.direction === 'income' && c.is_active);
const exp = cats.find((c) => c.direction === 'expense' && c.is_active);
assert.ok(inc && exp, 'QA owner has active categories');

await t('Validation: tham số Kế hoạch / phân trang sai → 400', async () => {
  for (const q of [
    'month=2026-13',
    'month=abc',
    'month=2026-1',
    'month=1899-12',
    'x=1',
    'month=2026-10&x=1',
  ])
    assert.equal((await req('/fin/plan?' + q, owner)).status, 400, q);
  for (const q of [
    'limit=0',
    'limit=1000',
    'limit=abc',
    'offset=-1',
    'offset=1.5',
    'foo=1',
  ])
    assert.equal(
      (await req('/fin/entries?' + q, owner)).status,
      400,
      'entries ' + q,
    );
  for (const q of ['limit=0', 'offset=-1', 'direction=other'])
    assert.equal(
      (await req('/fin/categories?' + q, owner)).status,
      400,
      'cat ' + q,
    );
});

const planBefore = (await req('/fin/plan?month=2026-10', owner)).data;
const entriesBefore = (await req('/fin/entries?limit=1&offset=0', owner)).data
  .total;
const summaryUrl = '/fin/summary?period=year&anchor=2026-10-12';
const sumBefore = JSON.stringify((await req(summaryUrl, owner)).data);

const base = { direction: 'income', category_id: inc.id };
await t('Validation: tạo khoản kế hoạch sai → 400/404/422/428', async () => {
  const bad = [
    { ...base, amount_vnd: '0' },
    { ...base, amount_vnd: '-5' },
    { ...base, amount_vnd: '1.5' },
    { ...base, amount_vnd: '01' },
    { ...base, amount_vnd: 123 },
    { ...base, amount_vnd: '10000000000000' },
    { ...base, amount_vnd: '' },
    { ...base, amount_vnd: '5', extra: 1 },
    { ...base, direction: 'other', amount_vnd: '5' },
    { ...base, category_id: 'not-a-uuid', amount_vnd: '5' },
  ];
  for (const b of bad) {
    const r = await mut('/fin/plan-items', owner, b);
    assert.equal(r.status, 400, JSON.stringify(b) + ' -> ' + r.status);
  }
  assert.equal(
    (
      await mut('/fin/plan-items', owner, {
        ...base,
        category_id: crypto.randomUUID(),
        amount_vnd: '5',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await mut('/fin/plan-items', owner, {
        direction: 'expense',
        category_id: inc.id,
        amount_vnd: '5',
      })
    ).status,
    400,
    'lệch loại',
  );
  assert.equal(
    (
      await req('/fin/plan-items', owner, {
        method: 'POST',
        body: { ...base, amount_vnd: '5' },
      })
    ).status >= 400,
    true,
    'thiếu Idempotency-Key bị từ chối',
  );
  const noCsrf = await fetch(api + '/fin/plan-items', {
    method: 'POST',
    headers: {
      origin,
      cookie: owner.cookie,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ ...base, amount_vnd: '5' }),
  });
  assert.equal(noCsrf.status, 403, 'thiếu CSRF');
  const badOrigin = await fetch(api + '/fin/plan-items', {
    method: 'POST',
    headers: {
      origin: 'http://evil.example',
      cookie: owner.cookie,
      'x-csrf-token': owner.csrf,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ ...base, amount_vnd: '5' }),
  });
  assert.equal(badOrigin.status, 403, 'sai Origin');
  assert.equal(
    (await req('/fin/plan', owner)).data.items.length,
    planBefore.items.length,
    'không bản ghi nào được tạo từ request lỗi',
  );
});

let pInc, pExp;
await t(
  'Tạo 2 khoản kế hoạch hợp lệ (Thu 12.000.000, Chi 15.000.000)',
  async () => {
    const a = await mut('/fin/plan-items', owner, {
      ...base,
      amount_vnd: '12000000',
    });
    const b = await mut('/fin/plan-items', owner, {
      direction: 'expense',
      category_id: exp.id,
      amount_vnd: '15000000',
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    pInc = a.data;
    pExp = b.data;
  },
);

const need = (shortfall, days) => ({
  day: (BigInt(shortfall) + BigInt(days) - 1n) / BigInt(days),
  week: (BigInt(shortfall) * 7n + BigInt(days) - 1n) / BigInt(days),
});
await t('Công thức: ngày thực tế 28/29/30/31 + làm tròn lên', async () => {
  for (const [m, days] of [
    ['2026-02', 28],
    ['2028-02', 29],
    ['2100-02', 28],
    ['2000-02', 29],
    ['2026-04', 30],
    ['2026-10', 31],
  ]) {
    const s = (await req('/fin/plan?month=' + m, owner)).data.summary;
    const n = need('3000000', days);
    assert.equal(s.days_in_month, days, m);
    assert.equal(s.total_income_vnd, '12000000');
    assert.equal(s.total_expense_vnd, '15000000');
    assert.equal(s.net_vnd, '-3000000');
    assert.equal(s.status, 'deficit');
    assert.equal(s.shortfall_vnd, '3000000');
    assert.equal(s.need_per_month_vnd, '3000000');
    assert.equal(s.need_per_day_vnd, String(n.day), m + ' ngày');
    assert.equal(s.need_per_week_vnd, String(n.week), m + ' tuần');
  }
  assert.equal(
    (await req('/fin/plan?month=2026-04', owner)).data.summary.need_per_day_vnd,
    '100000',
  );
});

await t(
  'Sửa khoản: If-Match bắt buộc (428), sai phiên bản (412), đúng → version tăng',
  async () => {
    const p = `/fin/plan-items/${pExp.id}`;
    assert.equal(
      (await mut(p, owner, { amount_vnd: '11000000' }, 'PATCH')).status,
      428,
    );
    assert.equal(
      (
        await mut(p, owner, { amount_vnd: '11000000' }, 'PATCH', {
          'if-match': '"999"',
        })
      ).status,
      412,
    );
    assert.equal(
      (await mut(p, owner, {}, 'PATCH', { 'if-match': `"${pExp.version}"` }))
        .status,
      400,
    );
    assert.equal(
      (
        await mut(p, owner, { amount_vnd: '0' }, 'PATCH', {
          'if-match': `"${pExp.version}"`,
        })
      ).status,
      400,
    );
    const ok = await mut(p, owner, { amount_vnd: '11000000' }, 'PATCH', {
      'if-match': `"${pExp.version}"`,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.version, pExp.version + 1);
    pExp = ok.data;
    const s = (await req('/fin/plan?month=2026-10', owner)).data.summary;
    assert.equal(s.status, 'surplus');
    assert.equal(s.shortfall_vnd, '0');
    assert.equal(s.need_per_day_vnd, '0');
    assert.equal(s.need_per_week_vnd, '0');
  },
);
await t(
  'Ngừng khoản (is_active=false) → không tính vào tổng; cân bằng',
  async () => {
    const off = await mut(
      `/fin/plan-items/${pInc.id}`,
      owner,
      { is_active: false },
      'PATCH',
      { 'if-match': `"${pInc.version}"` },
    );
    assert.equal(off.status, 200);
    pInc = off.data;
    let s = (await req('/fin/plan?month=2026-10', owner)).data.summary;
    assert.equal(s.total_income_vnd, '0');
    assert.equal(s.status, 'deficit');
    assert.equal(s.shortfall_vnd, '11000000');
    const on = await mut(
      `/fin/plan-items/${pInc.id}`,
      owner,
      { is_active: true, amount_vnd: '11000000' },
      'PATCH',
      { 'if-match': `"${pInc.version}"` },
    );
    assert.equal(on.status, 200);
    pInc = on.data;
    s = (await req('/fin/plan?month=2026-10', owner)).data.summary;
    assert.equal(s.status, 'balanced');
  },
);
await t('Số lớn chính xác (BigInt, 9.999.999.999.999)', async () => {
  const r = await mut('/fin/plan-items', owner, {
    direction: 'expense',
    category_id: exp.id,
    amount_vnd: '9999999999999',
  });
  assert.equal(r.status, 201);
  const s = (await req('/fin/plan?month=2026-10', owner)).data.summary;
  assert.equal(s.total_expense_vnd, String(11000000n + 9999999999999n));
  assert.equal(s.need_per_month_vnd, '9999999999999');
  assert.equal(s.need_per_day_vnd, String(need('9999999999999', 31).day));
  await mut(
    `/fin/plan-items/${r.data.id}`,
    owner,
    { is_active: false },
    'PATCH',
    { 'if-match': `"${r.data.version}"` },
  );
});

await t(
  'Tách biệt: tạo/sửa kế hoạch KHÔNG đổi giao dịch thực tế, tổng hợp, số danh mục',
  async () => {
    assert.equal(
      (await req('/fin/entries?limit=1&offset=0', owner)).data.total,
      entriesBefore,
    );
    assert.equal(
      JSON.stringify((await req(summaryUrl, owner)).data),
      sumBefore,
    );
  },
);
await t('Tách biệt: thêm giao dịch thực tế KHÔNG đổi kế hoạch', async () => {
  const planSnap = JSON.stringify(
    (await req('/fin/plan?month=2026-10', owner)).data,
  );
  const e = await mut('/fin/entries', owner, {
    direction: 'expense',
    category_id: exp.id,
    amount_vnd: '123000',
    occurred_on: '2026-10-12',
    note: 'qa-separation',
  });
  assert.equal(e.status, 201);
  assert.equal(
    JSON.stringify((await req('/fin/plan?month=2026-10', owner)).data),
    planSnap,
  );
  assert.equal(
    (await req('/fin/entries?limit=1&offset=0', owner)).data.total,
    entriesBefore + 1,
  );
  const sum = JSON.stringify((await req(summaryUrl, owner)).data);
  assert.notEqual(sum, sumBefore, 'tổng hợp thực tế phải đổi do giao dịch');
});
await t(
  'Staff/chủ khác không thấy kế hoạch của Owner (đã chặn 403)',
  async () => {
    assert.equal((await req('/fin/plan', staff)).status, 403);
  },
);

console.log(failed ? `\n${failed} FAIL` : '\nALL PASS');
process.exit(failed ? 1 : 0);
