import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeService } from '../../dist/apps/api/src/bridge/service.js';

const auth = (id = 'workspace-a', role = 'owner') => ({
  workspace: { id, role },
  user: { id: 'owner-a' },
});
const makeSummary = (scripts = []) => ({
  system: 'tiktok-ai-factory-v4',
  domain: 'https://hoaiphuong.click',
  connected_at: '2026-10-22T00:00:00Z',
  workspace: {
    connected: true,
    owner_uid: 'remote-owner',
    google_account_email: null,
    drive_root_folder_id: null,
    drive_folders: {},
    spreadsheet_id: null,
  },
  counts: {
    products: 0,
    channels: 0,
    scripts: scripts.length,
    prompts: 0,
    audio_deliverables: 0,
    video_deliverables: 0,
    active_members: 0,
    registered_accounts: 0,
    today_checkins: 0,
  },
  recent_scripts: scripts,
  channels: [],
  deliverables: [],
});
const script = (id, title = 'Kịch bản') => ({
  script_id: id,
  title,
  product_id: 'product',
  channel_id: 'channel',
  status: 'draft',
  created_at: '2026-10-22T00:00:00Z',
});

function setup(t) {
  const originalDir = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'management-bridge-'));
  const previousSecret = process.env.HP_BRIDGE_SECRET;
  const previousUrl = process.env.TIKTOK_V4_BRIDGE_URL;
  process.chdir(dir);
  process.env.HP_BRIDGE_SECRET = 'isolated-test-key';
  process.env.TIKTOK_V4_BRIDGE_URL = 'http://127.0.0.1:49999';
  t.after(() => {
    process.chdir(originalDir);
    for (const [key, value] of [
      ['HP_BRIDGE_SECRET', previousSecret],
      ['TIKTOK_V4_BRIDGE_URL', previousUrl],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const queries = [];
  const work = [];
  let failAudit = false;
  let employeeEmail = 'test@example.test';
  let released = 0;
  const query = async (sql, args = []) => {
    queries.push({ sql, args });
    // A successful sync must never insert/update/delete existing reports or revisions.
    assert.ok(!/\b(?:INSERT INTO|UPDATE|DELETE FROM) daily_report/i.test(sql));
    if (sql.trimStart().startsWith('SELECT\n         e.id'))
      return {
        rows: [
          {
            id: 'employee-a',
            employee_code: 'NV01',
            full_name: 'Test',
            email: employeeEmail,
            role: 'staff',
          },
        ],
      };
    if (sql.includes('SELECT name FROM workspaces'))
      return { rows: [{ name: 'Studio' }] };
    if (sql.includes('SELECT w.id, w.name'))
      return { rows: [{ id: 'workspace-a', name: 'Studio' }] };
    if (sql.includes('SELECT id FROM work_items')) {
      const row = work.find(
        (w) =>
          w.workspace === args[0] &&
          (w.description.split('\n')[0] === args[1] ||
            (w.title === args[2] &&
              !w.description.startsWith('TikTok V4 source:'))),
      );
      return { rows: row ? [{ id: 'existing-work' }] : [] };
    }
    if (sql.includes('INSERT INTO work_items')) {
      work.push({ workspace: args[0], title: args[1], description: args[2] });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO audit_events') && failAudit)
      throw new Error('simulated database failure');
    if (sql.includes('INSERT INTO audit_events'))
      return { rows: [{ id: 'audit-event' }] };
    if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '0' }] };
    return { rows: [] };
  };
  const pool = {
    query,
    connect: async () => ({
      query,
      release() {
        released++;
      },
    }),
  };
  let summary = makeSummary();
  let ack = {
    synced_members: 1,
    auto_approved_accounts: 0,
    total_employees_received: 1,
    workspace_connected: true,
  };
  let behavior = 'ok';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (behavior === 'offline') throw new Error('offline');
    if (behavior === 'http-error') return { ok: false };
    if (behavior === 'negative-envelope')
      return {
        ok: true,
        json: async () => ({ success: false, data: summary }),
      };
    if (url.endsWith('/summary'))
      return { ok: true, json: async () => ({ success: true, data: summary }) };
    if (behavior === 'push-offline') throw new Error('push offline');
    return { ok: true, json: async () => ({ success: true, data: ack }) };
  });
  return {
    dir,
    setEmail: (value) => {
      employeeEmail = value;
    },
    setFailAudit: () => {
      failAudit = true;
    },
    queries,
    requests,
    work,
    service: new BridgeService(pool),
    setSummary: (value) => {
      summary = value;
    },
    setAck: (value) => {
      ack = value;
    },
    setBehavior: (value) => {
      behavior = value;
    },
    released: () => released,
  };
}

const assertNoTransaction = (fixture) =>
  assert.ok(!fixture.queries.some(({ sql }) => sql === 'BEGIN'));

test('bridge fails closed without configured key and never sends a request', async (t) => {
  const f = setup(t);
  delete process.env.HP_BRIDGE_SECRET;
  await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
    code: 'BRIDGE_NOT_CONFIGURED',
  });
  assert.equal(f.requests.length, 0);
  assertNoTransaction(f);
});

test('bridge refuses insecure remote URL before transmitting members or credentials', async (t) => {
  const f = setup(t);
  process.env.TIKTOK_V4_BRIDGE_URL = 'http://remote.example.test';
  await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
    code: 'BRIDGE_NOT_CONFIGURED',
  });
  assert.equal(f.requests.length, 0);
});

for (const behavior of [
  'offline',
  'http-error',
  'negative-envelope',
  'push-offline',
]) {
  test(`bridge ${behavior} never commits business data or records successful sync`, async (t) => {
    const f = setup(t);
    f.setBehavior(behavior);
    await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
      code: 'BRIDGE_UNAVAILABLE',
    });
    assertNoTransaction(f);
    assert.ok(
      !fs.existsSync(path.join(f.dir, '.data')) ||
        !fs
          .readFileSync(
            path.join(
              f.dir,
              '.data',
              fs.readdirSync(path.join(f.dir, '.data'))[0],
            ),
            'utf8',
          )
          .includes('"last_synced_at": "'),
    );
    assert.ok(
      f.requests.every(
        ({ url, options }) =>
          url.startsWith('http://127.0.0.1:49999/') &&
          options.redirect === 'error',
      ),
    );
  });
}

test('bridge rejects malformed source metrics before sending employees', async (t) => {
  const f = setup(t);
  const summary = makeSummary();
  summary.counts.scripts = -1;
  f.setSummary(summary);
  await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
    code: 'BRIDGE_UNAVAILABLE',
  });
  assert.equal(f.requests.length, 1);
  assertNoTransaction(f);
});

for (const ack of [
  {
    synced_members: 1,
    auto_approved_accounts: 0,
    total_employees_received: 1,
    workspace_connected: false,
  },
  {
    synced_members: 1,
    auto_approved_accounts: 0,
    total_employees_received: 0,
    workspace_connected: true,
  },
  {},
  { synced_members: '1', auto_approved_accounts: 0 },
  { synced_members: 0, auto_approved_accounts: 0 },
  { synced_members: 1, auto_approved_accounts: -1 },
]) {
  test(`bridge requires explicit complete acknowledgement: ${JSON.stringify(ack)}`, async (t) => {
    const f = setup(t);
    f.setAck(ack);
    await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
      code: 'BRIDGE_UNCONFIRMED',
    });
    assertNoTransaction(f);
  });
}

test('bridge zero totals preserve manual reports, do not invent production or work, and explain attribution hold', async (t) => {
  const f = setup(t);
  const result = await f.service.syncWithTikTokV4(auth(), 'request');
  assert.equal(result.employees_synced, 1);
  assert.equal(result.reports_synced, 0);
  assert.equal(result.work_items_synced, 0);
  assert.equal(result.drive_connected, false);
  assert.match(result.warnings.join(' '), /ánh xạ nhân viên/);
  assert.ok(f.queries.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(f.released(), 1);
});

test('bridge total counts never become employee daily reports; source IDs deduplicate repeated/renamed scripts', async (t) => {
  const f = setup(t);
  const first = makeSummary([script('id-1'), script('id-1'), script('id-2')]);
  first.counts.prompts = 200;
  f.setSummary(first);
  const result = await f.service.syncWithTikTokV4(auth(), 'request');
  assert.equal(result.reports_synced, 0);
  assert.equal(result.work_items_synced, 2); // distinct IDs even when titles match
  f.setSummary(makeSummary([script('id-1', 'Đổi tên'), script('id-2')]));
  const retry = await f.service.syncWithTikTokV4(auth(), 'retry');
  assert.equal(retry.work_items_synced, 0);
  assert.equal(f.work.length, 2);
  assert.ok(f.queries.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));
});

test('cached data stays offline and cannot be used to write fresh business data; cache is workspace-scoped', async (t) => {
  const f = setup(t);
  f.setSummary(makeSummary([script('workspace-a-only')]));
  await f.service.syncWithTikTokV4(auth(), 'request');
  f.setBehavior('offline');
  const cached = await f.service.getTikTokV4Status(auth());
  assert.equal(cached.connected, false);
  assert.ok(cached.last_synced_at);
  assert.equal(cached.tiktok_v4.recent_scripts.length, 1);
  const other = await f.service.getTikTokV4Status(auth('workspace-b'));
  assert.equal(other.connected, false);
  assert.equal(other.last_synced_at, null);
  assert.equal(other.tiktok_v4.recent_scripts.length, 0);
  assert.equal(other.management_lite.storage_google_email, null);
  const previousBegins = f.queries.filter(({ sql }) => sql === 'BEGIN').length;
  await assert.rejects(f.service.syncWithTikTokV4(auth(), 'retry'), {
    code: 'BRIDGE_UNAVAILABLE',
  });
  assert.equal(
    f.queries.filter(({ sql }) => sql === 'BEGIN').length,
    previousBegins,
  );
});

test('staff cannot sync and public today_reports query uses workspace business date', async (t) => {
  const f = setup(t);
  await assert.rejects(
    f.service.syncWithTikTokV4(auth('workspace-a', 'staff'), 'request'),
    { code: 'FORBIDDEN' },
  );
  assert.equal(f.requests.length, 0);
  await f.service.getPublicSummary();
  const query = f.queries.find(
    ({ sql }) => sql.includes('COUNT(*)') && sql.includes('daily_reports'),
  );
  assert.match(query.sql, /report_date = \(NOW\(\) AT TIME ZONE COALESCE/);
  assert.match(query.sql, /SELECT timezone FROM workspaces WHERE id = \$1/);
  assert.match(query.sql, /Asia\/Ho_Chi_Minh/);
  assert.deepEqual(query.args, ['workspace-a']);
});

test('bridge timeout also bounds a stalled response body', async (t) => {
  const f = setup(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => ({
    ok: true,
    json: () =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      }),
  }));
  await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
    code: 'BRIDGE_UNAVAILABLE',
  });
  assertNoTransaction(f);
});

test('missing employee email is skipped with a warning, never replaced with a synthetic identity', async (t) => {
  const f = setup(t);
  f.setEmail(null);
  f.setAck({
    synced_members: 0,
    auto_approved_accounts: 0,
    total_employees_received: 0,
    workspace_connected: true,
  });
  const result = await f.service.syncWithTikTokV4(auth(), 'request');
  const outgoing = f.requests.find(({ url }) => url.endsWith('/sync-members'));
  assert.deepEqual(JSON.parse(outgoing.options.body).employees, []);
  assert.equal(result.employees_synced, 0);
  assert.match(result.warnings.join(' '), /1 nhân sự chưa đồng bộ/);
});

test('local transaction failure rolls back, releases client, and reports confirmed remote side effects', async (t) => {
  const f = setup(t);
  f.setFailAudit();
  await assert.rejects(f.service.syncWithTikTokV4(auth(), 'request'), {
    code: 'BRIDGE_LOCAL_SYNC_FAILED',
  });
  assert.ok(f.queries.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!f.queries.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(f.released(), 1);
  const status = await f.service.getTikTokV4Status(auth());
  assert.equal(status.last_synced_at, null);
});

test('public summary cannot turn a database error into successful zero business data', async () => {
  const service = new BridgeService({
    query: async () => {
      throw new Error('simulated DB unavailable');
    },
  });
  await assert.rejects(service.getPublicSummary(), {
    code: 'DATABASE_UNAVAILABLE',
  });
});
