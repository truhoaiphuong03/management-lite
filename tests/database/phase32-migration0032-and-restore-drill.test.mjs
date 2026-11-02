import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const ML_TEST_ROOT = 'C:\\ML-Test';
const PG_BIN_DIR = path.join(ML_TEST_ROOT, 'pgsql', 'bin');
const PG_DATA_DIR = path.join(ML_TEST_ROOT, 'pgdata');
const ADMIN_PW_FILE = path.join(ML_TEST_ROOT, 'secrets', 'admin.pw');

async function ensureIsolatedPostgres55433() {
  const pgIsReady = path.join(PG_BIN_DIR, 'pg_isready.exe');
  const check = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', '55433'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (check.status === 0) {
    return { startedByTest: false };
  }
  const postgresExe = path.join(PG_BIN_DIR, 'postgres.exe');
  const child = spawn(postgresExe, ['-D', PG_DATA_DIR], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ready = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', '55433'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (ready.status === 0) {
      return { startedByTest: true };
    }
  }
  throw new Error('Failed to start isolated PostgreSQL on 127.0.0.1:55433');
}

function stopIsolatedPostgres55433() {
  const pgCtl = path.join(PG_BIN_DIR, 'pg_ctl.exe');
  if (fs.existsSync(pgCtl)) {
    spawnSync(pgCtl, ['-D', PG_DATA_DIR, 'stop', '-m', 'fast'], {
      encoding: 'utf8',
      timeout: 10000,
    });
  }
}

function httpRequest(baseUrl, reqPath, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(reqPath, baseUrl);
    const bodyStr = options.body ? JSON.stringify(options.body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: {
          Origin: 'http://localhost:3000',
          ...(bodyStr
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
              }
            : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            // ignore non-json
          }
          resolvePromise({
            status: res.statusCode,
            headers: res.headers,
            json,
            raw,
          });
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function extractCookies(setCookieHeader, existing = '') {
  const map = new Map();
  if (existing) {
    for (const part of existing.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0)
        map.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
    }
  }
  const arr = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const item of arr) {
    const first = item.split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0)
      map.set(first.slice(0, idx).trim(), first.slice(idx + 1).trim());
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

test('Phase 32 Task 2 & Task 4: Migration 0032 E2E verification, legacy data preservation, RBAC sub_permissions, pg_dump/pg_restore round-trip, and rollback recovery on isolated PostgreSQL :55433', async (t) => {
  if (process.platform !== 'win32' || !fs.existsSync(ADMIN_PW_FILE)) {
    t.diagnostic(
      'Requires Windows host C:\\ML-Test isolated PostgreSQL :55433',
    );
    return;
  }

  const pgState = await ensureIsolatedPostgres55433();
  const adminPw = fs.readFileSync(ADMIN_PW_FILE, 'utf8').trim();
  const baseConnUrl = `postgresql://ml_test_admin:${encodeURIComponent(adminPw)}@127.0.0.1:55433/postgres`;
  const adminPool = new pg.Pool({ connectionString: baseConnUrl });

  const suffix = crypto.randomBytes(4).toString('hex');
  const drillDbName = `ml_phase32_drill_test_${suffix}`;
  const restoreDbName = `ml_phase32_restore_test_${suffix}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-phase32-drill-'));

  await adminPool.query(`CREATE DATABASE ${drillDbName}`);
  await adminPool.query(`CREATE DATABASE ${restoreDbName}`);

  const drillUrl = new URL(baseConnUrl);
  drillUrl.pathname = `/${drillDbName}`;
  const restoreUrl = new URL(baseConnUrl);
  restoreUrl.pathname = `/${restoreDbName}`;

  const { loadMigrationFiles, runMigrations } = await import(
    pathToFileURL(path.join(rootDir, 'dist/packages/database/src/migrator.js'))
      .href
  );
  const { createDatabasePool, closeDatabasePool } = await import(
    pathToFileURL(path.join(rootDir, 'dist/packages/database/src/pool.js')).href
  );
  const { hashPassword } = await import(
    pathToFileURL(path.join(rootDir, 'dist/packages/security/src/password.js'))
      .href
  );
  const { createRequestHandler } = await import(
    pathToFileURL(path.join(rootDir, 'dist/apps/api/src/app.js')).href
  );

  const allMigrations = loadMigrationFiles(
    path.join(rootDir, 'packages/database/src/migrations'),
  );
  assert.equal(
    allMigrations.length,
    32,
    'Must have 32 total migrations (0001..0032)',
  );
  const pre0032Migrations = allMigrations.slice(0, 31);
  assert.equal(
    pre0032Migrations[30].id,
    '0031_accounts_ecosystem_hierarchy',
    '31st migration must be 0031_accounts_ecosystem_hierarchy',
  );
  assert.equal(
    allMigrations[31].id,
    '0032_employee_sub_permissions',
    '32nd migration must be 0032_employee_sub_permissions',
  );

  const expectedPre0032SchemaId = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        pre0032Migrations.map((m) => ({ id: m.id, checksum: m.checksum })),
      ),
      'utf8',
    )
    .digest('hex');

  const drillPool = createDatabasePool({
    connectionString: drillUrl.href,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  t.after(async () => {
    await new Promise((r) => setTimeout(r, 150));
    await closeDatabasePool(drillPool);
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${drillDbName} WITH (FORCE)`,
    );
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${restoreDbName} WITH (FORCE)`,
    );
    await adminPool.end();
    if (pgState.startedByTest) {
      stopIsolatedPostgres55433();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Apply 0001..0031 (mirroring current Production state)
  const preRes = await runMigrations(drillPool, pre0032Migrations);
  assert.equal(preRes.appliedCount, 31);

  // 2. Seed realistic pre-0032 workspace, 2 owners, and 2 staff (matching Production aggregate 2 owners + 2 staff)
  const wsRes = await drillPool.query(
    `INSERT INTO workspaces (name, status) VALUES ('Hoai Phuong Media Drill', 'active') RETURNING id`,
  );
  const wsId = wsRes.rows[0].id;
  const pwdHash = await hashPassword('DrillPass#2026!');

  const seedMember = async (
    code,
    name,
    email,
    role,
    phone,
    bankName,
    bankAcc,
  ) => {
    const uId = crypto.randomUUID();
    const empId = crypto.randomUUID();
    await drillPool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active')`,
      [uId, code.toLowerCase(), email.toLowerCase()],
    );
    await drillPool.query(
      `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`,
      [uId, pwdHash],
    );
    await drillPool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')`,
      [wsId, uId, role],
    );
    await drillPool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status)
       VALUES ($1, $2, 'active')`,
      [wsId, uId],
    );
    await drillPool.query(
      `INSERT INTO employees (
         id, workspace_id, user_id, employee_code, full_name, employment_status,
         is_payroll_eligible, phone, bank_name, bank_account_number, position_title
       ) VALUES ($1, $2, $3, $4, $5, 'active', true, $6, $7, $8, $9)`,
      [
        empId,
        wsId,
        uId,
        code,
        name,
        phone,
        bankName,
        bankAcc,
        role === 'owner' ? 'Ban Giám Đốc' : 'Chuyên viên Media',
      ],
    );
    return { userId: uId, employeeId: empId };
  };

  await seedMember(
    'ADM01',
    'Owner One',
    'adm1@drill.example.test',
    'owner',
    '0901000001',
    'Vietcombank',
    '1010000001',
  );
  const adm2 = await seedMember(
    'ADM02',
    'Owner Two',
    'adm2@drill.example.test',
    'owner',
    '0901000002',
    'Techcombank',
    '1010000002',
  );
  const nv1 = await seedMember(
    'NV001',
    'Staff One',
    'nv1@drill.example.test',
    'staff',
    '0902000001',
    'MBBank',
    '2020000001',
  );
  await seedMember(
    'NV002',
    'Staff Two',
    'nv2@drill.example.test',
    'staff',
    '0902000002',
    'ACB',
    '2020000002',
  );

  // 3. Boot API server BEFORE Migration 0032 and verify pre-migration API compatibility
  const prevSecret = process.env.ACCOUNT_SECRET_KEY;
  const fakeSecret = crypto.randomBytes(32).toString('hex');
  process.env.ACCOUNT_SECRET_KEY = fakeSecret;
  const server = http.createServer(
    createRequestHandler({
      pool: drillPool,
      csrfSecret: crypto.randomBytes(32).toString('hex'),
      allowedOrigins: ['http://localhost:3000'],
      isProduction: false,
      accountSecretKey: fakeSecret,
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const loginUser = async (identifier) => {
      const lRes = await httpRequest(baseUrl, '/api/v1/auth/login', {
        method: 'POST',
        body: { identifier, password: 'DrillPass#2026!' },
      });
      assert.equal(lRes.status, 200, lRes.raw);
      const cookies = extractCookies(lRes.headers['set-cookie']);
      const meRes = await httpRequest(baseUrl, '/api/v1/auth/me', {
        headers: { Cookie: cookies },
      });
      assert.equal(meRes.status, 200, meRes.raw);
      return {
        cookies: extractCookies(meRes.headers['set-cookie'], cookies),
        csrfToken: lRes.json.data.csrf_token || meRes.json.data.csrf_token,
        me: meRes.json.data,
      };
    };

    // Pre-migration (31 migrations) API verification
    const preOwnerSession = await loginUser('ADM01');
    assert.equal(preOwnerSession.me.active_workspace.role, 'owner');
    const preEmpList = await httpRequest(baseUrl, '/api/v1/employees', {
      headers: { Cookie: preOwnerSession.cookies },
    });
    assert.equal(preEmpList.status, 200);
    assert.equal(preEmpList.json.data.items.length, 4);

    // 4. Apply Migration 0032 on top of populated 0001..0031 database
    const mig32Res = await runMigrations(drillPool, allMigrations);
    assert.equal(mig32Res.appliedCount, 1);
    assert.deepEqual(mig32Res.appliedIds, ['0032_employee_sub_permissions']);

    // 5. Verify all legacy employee data is preserved and sub_role / sub_permissions defaults are intact
    const postRows = (
      await drillPool.query(
        `SELECT employee_code, full_name, phone, bank_name, bank_account_number, sub_role, sub_permissions
         FROM employees WHERE workspace_id = $1 ORDER BY employee_code`,
        [wsId],
      )
    ).rows;
    assert.equal(postRows.length, 4);
    assert.deepEqual(
      postRows.map((r) => ({
        code: r.employee_code,
        phone: r.phone,
        bank: r.bank_name,
        sub_role: r.sub_role,
        sub_permissions: r.sub_permissions,
      })),
      [
        {
          code: 'ADM01',
          phone: '0901000001',
          bank: 'Vietcombank',
          sub_role: null,
          sub_permissions: [],
        },
        {
          code: 'ADM02',
          phone: '0901000002',
          bank: 'Techcombank',
          sub_role: null,
          sub_permissions: [],
        },
        {
          code: 'NV001',
          phone: '0902000001',
          bank: 'MBBank',
          sub_role: null,
          sub_permissions: [],
        },
        {
          code: 'NV002',
          phone: '0902000002',
          bank: 'ACB',
          sub_role: null,
          sub_permissions: [],
        },
      ],
    );

    const ownerSession = await loginUser('ADM01');
    const detailBefore = await httpRequest(
      baseUrl,
      `/api/v1/employees/${nv1.employeeId}`,
      { headers: { Cookie: ownerSession.cookies } },
    );
    assert.equal(detailBefore.status, 200);

    // Promote NV001 to admin with all 6 sub-permissions
    const allSixPerms = [
      'attendance:review',
      'work:manage',
      'employees:manage',
      'accounts:manage',
      'payroll:manage',
      'finance:manage',
    ];
    const patchRes = await httpRequest(
      baseUrl,
      `/api/v1/employees/${nv1.employeeId}`,
      {
        method: 'PATCH',
        headers: {
          Cookie: ownerSession.cookies,
          'X-CSRF-Token': ownerSession.csrfToken,
          'If-Match': String(detailBefore.json.data.version),
        },
        body: {
          role: 'admin',
          sub_permissions: allSixPerms,
        },
      },
    );
    assert.equal(patchRes.status, 200, patchRes.raw);
    assert.equal(patchRes.json.data.role, 'admin');
    assert.deepEqual(
      patchRes.json.data.sub_permissions.sort(),
      [...allSixPerms].sort(),
    );

    // Log in as NV001 (admin) and verify delegated access + owner protection
    const adminSession = await loginUser('NV001');
    assert.equal(adminSession.me.active_workspace.sub_role, 'admin');
    assert.deepEqual(
      adminSession.me.active_workspace.sub_permissions.sort(),
      [...allSixPerms].sort(),
    );

    const empListAsAdmin = await httpRequest(baseUrl, '/api/v1/employees', {
      headers: { Cookie: adminSession.cookies },
    });
    assert.equal(empListAsAdmin.status, 200);

    // Admin cannot modify an Owner record
    const ownerDetail = await httpRequest(
      baseUrl,
      `/api/v1/employees/${adm2.employeeId}`,
      { headers: { Cookie: ownerSession.cookies } },
    );
    const attemptEditOwner = await httpRequest(
      baseUrl,
      `/api/v1/employees/${adm2.employeeId}`,
      {
        method: 'PATCH',
        headers: {
          Cookie: adminSession.cookies,
          'X-CSRF-Token': adminSession.csrfToken,
          'If-Match': String(ownerDetail.json.data.version),
        },
        body: {
          role: 'staff',
        },
      },
    );
    assert.equal(attemptEditOwner.status, 403);

    // Staff NV002 (no sub_permissions) is blocked from /api/v1/employees
    const staffSession = await loginUser('NV002');
    const empListAsStaff = await httpRequest(baseUrl, '/api/v1/employees', {
      headers: { Cookie: staffSession.cookies },
    });
    assert.equal(empListAsStaff.status, 403);
  } finally {
    await new Promise((r) => server.close(r));
    if (prevSecret === undefined) delete process.env.ACCOUNT_SECRET_KEY;
    else process.env.ACCOUNT_SECRET_KEY = prevSecret;
  }

  // 6. Task 4.2: Run pg_dump -Fc -> SHA-256 -> pg_restore round-trip into restoreDbName on :55433
  const pgDumpExe = path.join(PG_BIN_DIR, 'pg_dump.exe');
  const pgRestoreExe = path.join(PG_BIN_DIR, 'pg_restore.exe');
  const dumpFile = path.join(tmpDir, `${drillDbName}.dump`);
  const dumpEnv = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(drillUrl.password),
  };
  const dumpRun = spawnSync(
    pgDumpExe,
    [
      '-h',
      drillUrl.hostname,
      '-p',
      drillUrl.port,
      '-U',
      decodeURIComponent(drillUrl.username),
      '-d',
      drillDbName,
      '-Fc',
      '-f',
      dumpFile,
    ],
    { env: dumpEnv, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(dumpRun.status, 0, dumpRun.stderr || dumpRun.stdout);
  const dumpHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(dumpFile))
    .digest('hex');
  assert.match(dumpHash, /^[0-9a-f]{64}$/);

  const restoreRun = spawnSync(
    pgRestoreExe,
    [
      '-h',
      restoreUrl.hostname,
      '-p',
      restoreUrl.port,
      '-U',
      decodeURIComponent(restoreUrl.username),
      '-d',
      restoreDbName,
      '--no-owner',
      '--no-privileges',
      dumpFile,
    ],
    { env: dumpEnv, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(restoreRun.status, 0, restoreRun.stderr || restoreRun.stdout);

  const restorePool = new pg.Pool({ connectionString: restoreUrl.href });
  try {
    const restoredEmp = await restorePool.query(
      `SELECT employee_code, sub_role, sub_permissions FROM employees ORDER BY employee_code`,
    );
    assert.equal(restoredEmp.rows.length, 4);
    const restoredNv1 = restoredEmp.rows.find(
      (r) => r.employee_code === 'NV001',
    );
    assert.equal(restoredNv1.sub_role, 'admin');
    assert.equal(restoredNv1.sub_permissions.length, 6);
  } finally {
    await restorePool.end();
  }

  // 7. Task 2.7: Verify safe rollback / down-migration of 0032 if runtime cutover ever requires reverting schema to 31 migrations
  await drillPool.query('BEGIN');
  try {
    await drillPool.query(
      `DROP INDEX IF EXISTS idx_employees_workspace_sub_role`,
    );
    await drillPool.query(
      `ALTER TABLE employees DROP CONSTRAINT IF EXISTS ck_employees_sub_role`,
    );
    await drillPool.query(
      `ALTER TABLE employees DROP COLUMN IF EXISTS sub_permissions, DROP COLUMN IF EXISTS sub_role`,
    );
    await drillPool.query(
      `DELETE FROM schema_migrations WHERE id = '0032_employee_sub_permissions'`,
    );
    await drillPool.query('COMMIT');
  } catch (err) {
    await drillPool.query('ROLLBACK');
    throw err;
  }

  const revertedMigs = (
    await drillPool.query(
      `SELECT id, checksum FROM schema_migrations ORDER BY id`,
    )
  ).rows;
  assert.equal(revertedMigs.length, 31);
  const revertedSchemaId = crypto
    .createHash('sha256')
    .update(JSON.stringify(revertedMigs), 'utf8')
    .digest('hex');
  assert.equal(
    revertedSchemaId,
    expectedPre0032SchemaId,
    'Down-migration must restore exact 31-migration schemaIdentity',
  );

  // Verify legacy 4 employees are still 100% intact after down-migration
  const afterRollbackRows = (
    await drillPool.query(
      `SELECT employee_code, phone, bank_name FROM employees WHERE workspace_id = $1 ORDER BY employee_code`,
      [wsId],
    )
  ).rows;
  assert.equal(afterRollbackRows.length, 4);
});
