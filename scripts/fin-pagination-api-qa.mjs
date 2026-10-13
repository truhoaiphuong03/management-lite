import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// API-level pagination QA against the ISOLATED QA stack (API 3028). Never touches 3017/3018.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = loadQaEndpoint(process.env.QA_API_BASE) + '/api/v1';
const origin = loadQaEndpoint(process.env.QA_WEB_BASE);
const creds = readFileSync('.env.qa-credentials.local', 'utf8');
const pw = (k) =>
  new RegExp(`${k}=(.*)`)
    .exec(creds)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
const checks = [];
const ok = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => {
        checks.push(true);
        console.log('PASS:', name);
      },
      (e) => {
        checks.push(false);
        console.log('FAIL:', name, '-', e.message.split('\n')[0]);
      },
    );

async function login(identifier, password) {
  const r = await fetch(api + '/auth/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  assert.equal(r.status, 200, 'login ' + identifier);
  return r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
const get = async (cookie, path) => {
  const r = await fetch(api + path, { headers: { cookie, origin } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data };
};
async function walk(cookie, base, size) {
  const ids = [];
  const pages = [];
  let total = null;
  for (let off = 0; ; off += size) {
    const r = await get(
      cookie,
      `${base}${base.includes('?') ? '&' : '?'}limit=${size}&offset=${off}`,
    );
    assert.equal(r.status, 200, base + ' offset ' + off);
    assert.equal(r.data.limit, size);
    assert.equal(r.data.offset, off);
    if (total === null) total = r.data.total;
    assert.equal(r.data.total, total, 'total stable across pages');
    assert.ok(r.data.items.length <= size, 'page never exceeds limit');
    pages.push(r.data.items);
    ids.push(...r.data.items.map((i) => i.id));
    if (off + size >= total) break;
  }
  return { ids, pages, total };
}

const owner = await login('admin', qaAdminPassword);
const cats = [];
for (let off = 0; ; off += 100) {
  const r = await get(owner, `/fin/categories?limit=100&offset=${off}`);
  cats.push(...r.data.items);
  if (off + 100 >= r.data.total) break;
}
const qa = (n) => cats.find((c) => c.name === `QA-${n}`).id;

for (const n of [0, 1, 10, 11, 20, 21, 55]) {
  for (const size of [10, 20, 50]) {
    await ok(
      `entries QA-${n} (${n} bản ghi) @${size}/trang: đủ, không trùng, đúng tổng`,
      async () => {
        const w = await walk(owner, `/fin/entries?category_id=${qa(n)}`, size);
        assert.equal(w.total, n);
        assert.equal(w.ids.length, n);
        assert.equal(new Set(w.ids).size, n, 'no duplicates');
        assert.equal(w.pages.length, Math.max(1, Math.ceil(n / size)));
        const flat = w.pages.flat();
        for (let i = 1; i < flat.length; i++)
          assert.ok(
            flat[i - 1].occurred_on >= flat[i].occurred_on,
            'order by date desc',
          );
      },
    );
  }
}
await ok(
  'entries toàn bộ: 118 giao dịch, mặc định 20/trang = 6 trang, trùng khớp với 50/trang',
  async () => {
    const a = await walk(owner, '/fin/entries', 20);
    const b = await walk(owner, '/fin/entries', 50);
    assert.equal(a.total, 118);
    assert.equal(a.pages.length, 6);
    assert.equal(new Set(a.ids).size, 118);
    assert.deepEqual([...a.ids].sort(), [...b.ids].sort());
    assert.deepEqual(a.ids, b.ids, 'identical order regardless of page size');
  },
);
await ok('entries lọc ngày: total khớp bộ lọc', async () => {
  const all = await walk(owner, '/fin/entries', 50);
  const day = all.pages
    .flat()
    .filter((e) => e.occurred_on === '2026-09-05').length;
  const r = await get(
    owner,
    '/fin/entries?from=2026-09-05&to=2026-09-05&limit=10&offset=0',
  );
  assert.equal(r.data.total, day);
  assert.ok(day > 0);
});
await ok('entries lọc direction=income: 0 giao dịch', async () => {
  const r = await get(owner, '/fin/entries?direction=income&limit=20&offset=0');
  assert.equal(r.data.total, 0);
  assert.equal(r.data.items.length, 0);
});
await ok(
  'categories: 32 danh mục, 10/trang = 4 trang, không trùng, sắp xếp A→Z xuyên trang',
  async () => {
    const w = await walk(owner, '/fin/categories', 10);
    assert.equal(w.total, 32);
    assert.equal(w.pages.length, 4);
    assert.equal(new Set(w.ids).size, 32);
    const w20 = await walk(owner, '/fin/categories', 20);
    assert.deepEqual(w20.ids, w.ids, 'same order for 20/trang');
  },
);
await ok('categories theo loại: Thu = 4, Chi = 28', async () => {
  const i = await get(
    owner,
    '/fin/categories?direction=income&limit=10&offset=0',
  );
  const e = await get(
    owner,
    '/fin/categories?direction=expense&limit=10&offset=0',
  );
  assert.equal(i.data.total, 4);
  assert.equal(e.data.total, 28);
  assert.ok(i.data.items.every((c) => c.direction === 'income'));
});
await ok('offset vượt cuối: items rỗng nhưng total đúng', async () => {
  const r = await get(owner, '/fin/entries?limit=20&offset=1000');
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 0);
  assert.equal(r.data.total, 118);
});
for (const bad of [
  '/fin/entries?offset=-1',
  '/fin/entries?offset=abc',
  '/fin/entries?offset=1.5',
  '/fin/entries?offset=0&cursor=abc',
  '/fin/entries?limit=0&offset=0',
  '/fin/entries?limit=101&offset=0',
  '/fin/categories?offset=-5',
  '/fin/categories?offset=1&offset=2',
])
  await ok(`tham số sai bị từ chối 400: ${bad}`, async () => {
    assert.equal((await get(owner, bad)).status, 400);
  });
await ok('chế độ cursor cũ vẫn hoạt động (tương thích ngược)', async () => {
  const a = await get(owner, '/fin/entries?limit=50');
  assert.equal(a.status, 200);
  assert.ok(a.data.next_cursor);
  assert.equal(a.data.total, undefined);
  const b = await get(
    owner,
    '/fin/entries?limit=50&cursor=' + a.data.next_cursor,
  );
  assert.equal(b.status, 200);
  const seen = new Set(a.data.items.map((i) => i.id));
  assert.ok(b.data.items.every((i) => !seen.has(i.id)));
});
await ok('Staff: entries/categories offset => 403', async () => {
  const staff = await login('staff', pw('STAFF_PASSWORD'));
  assert.equal(
    (await get(staff, '/fin/entries?limit=20&offset=0')).status,
    403,
  );
  assert.equal(
    (await get(staff, '/fin/categories?limit=10&offset=0')).status,
    403,
  );
});
await ok('Chưa đăng nhập => 401', async () => {
  assert.equal((await get('', '/fin/entries?limit=20&offset=0')).status, 401);
});
const failed = checks.filter((x) => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} PASS`);
process.exit(failed ? 1 : 0);
