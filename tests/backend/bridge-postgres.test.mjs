import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';
import { BridgeService } from '../../dist/apps/api/src/bridge/service.js';

test('bridge against migrated PostgreSQL: real email column, active Drive, unchanged reports, concurrent source deduplication', async (t) => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !process.env.VERIFY_QA_SYSTEM_IDENTIFIER
  ) {
    t.skip(
      'Requires explicitly owned isolated PostgreSQL QA cluster; no operational DB fallback',
    );
    return;
  }
  const cfg = loadTestDatabaseConfig();
  const target = new URL(cfg.connectionString);
  assert.equal(target.hostname, '127.0.0.1');
  const pool = createDatabasePool(cfg);
  t.after(() => pool.end());
  const proof = (
    await pool.query(
      'SELECT current_database() AS db, (SELECT system_identifier::text FROM pg_control_system()) AS id',
    )
  ).rows[0];
  assert.equal(proof.id, process.env.VERIFY_QA_SYSTEM_IDENTIFIER);
  assert.equal(proof.db, target.pathname.slice(1));
  await runMigrations(
    pool,
    loadMigrationFiles('packages/database/src/migrations'),
  );
  const workspace = crypto.randomUUID(),
    user = crypto.randomUUID(),
    employee = crypto.randomUUID();
  await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [
    workspace,
    'Bridge PostgreSQL QA',
  ]);
  await pool.query(
    "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES($1,$2,$3,'active')",
    [user, `qa-${user}`, `qa-${user}@example.test`],
  );
  await pool.query(
    "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,'owner','active')",
    [workspace, user],
  );
  await pool.query(
    "INSERT INTO employees(id,workspace_id,user_id,employee_code,full_name,employment_status) VALUES($1,$2,$3,'QA-BRIDGE','QA','active')",
    [employee, workspace, user],
  );
  await pool.query(
    "INSERT INTO storage_drive_connections(workspace_id,status,google_email,root_folder_id) VALUES($1,'active','drive@example.test','verified-drive-root')",
    [workspace],
  );
  const report = (
    await pool.query(
      "INSERT INTO daily_reports(workspace_id,employee_id,report_date,notes) VALUES($1,$2,(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'manual notes') RETURNING id",
      [workspace, employee],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO daily_report_entries(workspace_id,report_id,work_type,reported_count) VALUES($1,$2,'content',7)",
    [workspace, report],
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-pg-'));
  const previousDirectory = process.cwd();
  const previousSecret = process.env.HP_BRIDGE_SECRET,
    previousUrl = process.env.TIKTOK_V4_BRIDGE_URL;
  process.env.HP_BRIDGE_SECRET = 'isolated-bridge-test';
  process.env.TIKTOK_V4_BRIDGE_URL = 'http://127.0.0.1:49998';
  process.chdir(directory);
  t.after(() => {
    process.chdir(previousDirectory);
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of [
      ['HP_BRIDGE_SECRET', previousSecret],
      ['TIKTOK_V4_BRIDGE_URL', previousUrl],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let title = 'First title';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/sync-members')) {
      const body = JSON.parse(options.body);
      assert.equal(body.storage_root_folder_id, 'verified-drive-root');
      assert.equal(body.employees[0].email, `qa-${user}@example.test`);
      return Response.json({
        success: true,
        data: {
          synced_members: 1,
          total_employees_received: 1,
          auto_approved_accounts: 0,
          workspace_connected: true,
        },
      });
    }
    return Response.json({
      success: true,
      data: {
        system: 'tiktok-ai-factory-v4',
        workspace: {
          connected: true,
          google_account_email: null,
          drive_root_folder_id: null,
        },
        counts: {
          products: 0,
          channels: 0,
          scripts: 1,
          prompts: 0,
          audio_deliverables: 0,
          video_deliverables: 0,
          active_members: 0,
          registered_accounts: 0,
          today_checkins: 0,
        },
        recent_scripts: [
          {
            script_id: 'stable-source',
            title,
            product_id: 'product',
            channel_id: 'channel',
            status: 'draft',
          },
        ],
        channels: [],
        deliverables: [],
      },
    });
  });
  const service = new BridgeService(pool);
  const auth = {
    workspace: { id: workspace, role: 'owner' },
    user: { id: user },
  };
  const status = await service.getTikTokV4Status(auth);
  assert.equal(status.management_lite.storage_drive_connected, true);
  assert.equal(
    status.management_lite.storage_root_folder_id,
    'verified-drive-root',
  );
  assert.equal((await service.getPublicSummary()).storage_connected, true);
  const results = await Promise.all([
    service.syncWithTikTokV4(auth, 'first'),
    service.syncWithTikTokV4(auth, 'concurrent'),
  ]);
  assert.equal(
    results.reduce((n, r) => n + r.work_items_synced, 0),
    1,
  );
  title = 'Changed title';
  assert.equal(
    (await service.syncWithTikTokV4(auth, 'retry')).work_items_synced,
    0,
  );
  const rows = (
    await pool.query('SELECT notes,version FROM daily_reports WHERE id=$1', [
      report,
    ])
  ).rows;
  assert.equal(rows[0].notes, 'manual notes');
  assert.equal(rows[0].version, 1);
  assert.equal(
    (
      await pool.query(
        'SELECT reported_count FROM daily_report_entries WHERE report_id=$1',
        [report],
      )
    ).rows[0].reported_count,
    7,
  );
});
