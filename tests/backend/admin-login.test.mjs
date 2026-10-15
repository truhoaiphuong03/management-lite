import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

function makeRequest(url, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        ...(parsedUrl.pathname === '/api/v1/auth/login'
          ? { Origin: 'http://localhost:3000' }
          : {}),
        ...options.headers,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolvePromise({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        } catch {
          resolvePromise({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      const payload =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }

    req.end();
  });
}

test('ADMIN login verification: authentication, session persistence, role Owner, and idempotency', async (t) => {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    t.skip('Live test database not configured');
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, checkDatabaseHealth, closeDatabasePool } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );
  const { addAdminAccount } = await import(
    `file://${resolve(root, 'scripts/add-admin.mjs')}`
  );
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );
  const adminPassword = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  const testWorkspaceId = crypto.randomUUID();
  const suffix = crypto.randomBytes(8).toString('hex');
  const adminUsername = `admin_${suffix}`;
  const adminEmail = `admin_${suffix}@example.test`;
  const ownerUsername = `owner_${suffix}`;

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip('Database instance unreachable');
      return;
    }

    await runMigrations(
      pool,
      loadMigrationFiles(resolve(root, 'packages/database/src/migrations')),
    );

    // Fresh per-run fixtures; never reset another test's fixed ADMIN/owner account.
    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status)
       VALUES ($1, 'Hoai Phuong Workspace', 'Asia/Ho_Chi_Minh', 'active')
       ON CONFLICT (id) DO UPDATE SET status = 'active';`,
      [testWorkspaceId],
    );
    const insertedOwner = await pool.query(
      `INSERT INTO users (username_normalized, email_normalized, status)
       VALUES ($1, $2, 'active') RETURNING id;`,
      [ownerUsername, `${ownerUsername}@example.test`],
    );
    const baselineOwnerId = insertedOwner.rows[0].id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner', status = 'active';`,
      [testWorkspaceId, baselineOwnerId],
    );

    // 1. Ensure ADMIN account is provisioned (idempotent)
    const adminResult = await addAdminAccount({
      pool,
      workspaceId: testWorkspaceId,
      username: adminUsername.toUpperCase(),
      password: adminPassword,
      email: adminEmail,
    });
    assert.ok(
      adminResult.created || adminResult.alreadyExists,
      'Admin account should be created or already exist',
    );
    assert.equal(adminResult.role, 'owner', 'Admin role must be Owner');

    // 2. Start HTTP API test server
    const csrfSecret = 'admin_auth_test_csrf_secret_min_32_bytes!';
    const allowedOrigin = 'http://localhost:3000';
    const handler = createRequestHandler({
      pool,
      csrfSecret,
      allowedOrigins: [allowedOrigin],
      isProduction: false,
    });
    const server = http.createServer(handler);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 3. Test ADMIN Login with uppercase identifier 'ADMIN'
      const loginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: {
          identifier: adminUsername.toUpperCase(),
          password: adminPassword,
        },
      });

      assert.equal(
        loginRes.status,
        200,
        `Expected 200, got ${loginRes.status}: ${JSON.stringify(loginRes.body)}`,
      );
      assert.equal(loginRes.body.success, true);
      assert.equal(loginRes.body.data.user.username, adminUsername);
      assert.equal(loginRes.body.data.active_workspace.role, 'owner');
      assert.ok(
        loginRes.body.data.active_workspace.id,
        'Active workspace ID present',
      );
      assert.ok(loginRes.body.data.csrf_token, 'CSRF token present');

      // Verify Set-Cookie header for session
      const rawCookies = loginRes.headers['set-cookie'];
      assert.ok(rawCookies, 'Set-Cookie header must be present');
      const cookieArray = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
      const sessionCookie = cookieArray.find((c) =>
        c.includes('mglite_session='),
      );
      assert.ok(sessionCookie, 'mglite_session cookie must be set');
      const sessionCookieVal = sessionCookie.split(';')[0];

      // 4. Test Session Persistence: GET /api/v1/auth/me
      const meRes = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Cookie: sessionCookieVal,
        },
      });

      assert.equal(
        meRes.status,
        200,
        `Session reload failed: ${JSON.stringify(meRes.body)}`,
      );
      assert.equal(meRes.body.success, true);
      assert.equal(meRes.body.data.user.username, adminUsername);
      assert.equal(meRes.body.data.active_workspace.role, 'owner');

      // 5. Verify Owner Permissions
      const permissions = meRes.body.data.permissions || [];
      const requiredOwnerPerms = [
        'employees:read',
        'employees:manage',
        'attendance:read',
        'attendance:review',
        'reports:read',
        'accounts:manage',
      ];
      for (const perm of requiredOwnerPerms) {
        assert.ok(
          permissions.includes(perm),
          `Owner must have permission: ${perm}`,
        );
      }

      // 6. Test Idempotent Re-execution of addAdminAccount
      const secondCallResult = await addAdminAccount({
        pool,
        workspaceId: testWorkspaceId,
        username: adminUsername.toUpperCase(),
        password: adminPassword,
        email: adminEmail,
      });
      assert.equal(
        secondCallResult.alreadyExists,
        true,
        'Second run should detect existing account',
      );
      assert.equal(
        secondCallResult.created,
        false,
        'Should not create duplicate account',
      );
      assert.equal(
        secondCallResult.role,
        'owner',
        'Role remains owner in existing workspace',
      );

      // 7. Verify existing Owner account still exists and is not overwritten
      const ownerCheck = await pool.query(
        `SELECT u.id, u.username_normalized, wm.role FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.id = $1 AND wm.workspace_id = $2;`,
        [baselineOwnerId, testWorkspaceId],
      );
      assert.ok(
        ownerCheck.rows.length > 0,
        'Existing owner must not be deleted or replaced',
      );
      assert.equal(
        ownerCheck.rows[0].role,
        'owner',
        'Existing owner keeps owner role',
      );
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
