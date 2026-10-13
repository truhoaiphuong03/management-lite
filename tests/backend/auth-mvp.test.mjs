import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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

test('MVP Phase 1: Owner/Staff login, session reload, logout, RBAC and C06 binding lifecycle', async (t) => {
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
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip('Database instance unreachable');
      return;
    }

    // Ensure all 4 migrations are applied
    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    await runMigrations(pool, migrationFiles);

    const csrfSecret = 'mvp_auth_csrf_secret_min_32_chars_long_key!';
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
      const runToken = crypto.randomBytes(4).toString('hex');
      const wsId = crypto.randomUUID();
      const wsName = `MVP Store ${runToken}`;

      // 1. Create Workspace
      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [wsId, wsName],
      );

      // 2. Create Owner User + Active Binding
      const ownerId = crypto.randomUUID();
      const ownerUser = `mvp_owner_${runToken}`;
      const ownerEmail = `owner_${runToken}@mvp.test`;
      const ownerPw = `OwnerPass_${runToken}!`;
      const ownerHash = await hashPassword(ownerPw);

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [ownerId, ownerUser, ownerEmail],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
        [ownerId, ownerHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
        [wsId, ownerId],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
        [wsId, ownerId],
      );

      // 3. Create Staff User + Active Binding
      const staffId = crypto.randomUUID();
      const staffUser = `mvp_staff_${runToken}`;
      const staffEmail = `staff_${runToken}@mvp.test`;
      const staffPw = `StaffPass_${runToken}!`;
      const staffHash = await hashPassword(staffPw);

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [staffId, staffUser, staffEmail],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
        [staffId, staffHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
        [wsId, staffId],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
        [wsId, staffId],
      );

      // 4. Create User Without Binding (Unbound User)
      const unboundId = crypto.randomUUID();
      const unboundUser = `unbound_${runToken}`;
      const unboundPw = `UnboundPass_${runToken}!`;
      const unboundHash = await hashPassword(unboundPw);

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [unboundId, unboundUser, `${unboundUser}@mvp.test`],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
        [unboundId, unboundHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
        [wsId, unboundId],
      );
      // NOTE: No entry in user_workspace_bindings!

      // -------------------------------------------------------------------
      // TEST STEP A: Owner Login -> 200 OK, returns owner role, sets cookie
      // -------------------------------------------------------------------
      const ownerLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        body: { identifier: ownerUser, password: ownerPw },
      });
      assert.equal(ownerLoginRes.status, 200);
      assert.equal(ownerLoginRes.body.success, true);
      assert.equal(ownerLoginRes.body.data.active_workspace.role, 'owner');
      assert.equal(ownerLoginRes.body.data.active_workspace.id, wsId);
      assert.ok(ownerLoginRes.body.data.csrf_token);

      const ownerCookie = ownerLoginRes.headers['set-cookie'];
      assert.ok(ownerCookie);
      const ownerCookieStr = Array.isArray(ownerCookie)
        ? ownerCookie[0]
        : ownerCookie;

      // -------------------------------------------------------------------
      // TEST STEP B: Staff Login -> 200 OK, returns staff role, sets cookie
      // -------------------------------------------------------------------
      const staffLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        body: { identifier: staffUser, password: staffPw },
      });
      assert.equal(staffLoginRes.status, 200);
      assert.equal(staffLoginRes.body.success, true);
      assert.equal(staffLoginRes.body.data.active_workspace.role, 'staff');
      assert.equal(staffLoginRes.body.data.active_workspace.id, wsId);

      const staffCookie = staffLoginRes.headers['set-cookie'];
      assert.ok(staffCookie);
      const staffCookieStr = Array.isArray(staffCookie)
        ? staffCookie[0]
        : staffCookie;

      // -------------------------------------------------------------------
      // TEST STEP C: Unbound User Login -> 409 WORKSPACE_CONTEXT_UNRESOLVED
      // -------------------------------------------------------------------
      const unboundLoginRes = await makeRequest(
        `${baseUrl}/api/v1/auth/login`,
        {
          method: 'POST',
          body: { identifier: unboundUser, password: unboundPw },
        },
      );
      assert.equal(unboundLoginRes.status, 409);
      assert.equal(
        unboundLoginRes.body.error.code,
        'WORKSPACE_CONTEXT_UNRESOLVED',
      );

      // -------------------------------------------------------------------
      // TEST STEP D: Session Reload (GET /api/v1/auth/me) with Owner Cookie
      // -------------------------------------------------------------------
      const ownerMeRes = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: { Cookie: ownerCookieStr },
      });
      assert.equal(ownerMeRes.status, 200);
      assert.equal(ownerMeRes.body.success, true);
      assert.equal(ownerMeRes.body.data.user.id, ownerId);
      assert.equal(ownerMeRes.body.data.active_workspace.role, 'owner');
      assert.ok(ownerMeRes.body.data.permissions.includes('employees:manage'));

      // -------------------------------------------------------------------
      // TEST STEP E: Session Reload (GET /api/v1/auth/me) with Staff Cookie
      // -------------------------------------------------------------------
      const staffMeRes = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: { Cookie: staffCookieStr },
      });
      assert.equal(staffMeRes.status, 200);
      assert.equal(staffMeRes.body.success, true);
      assert.equal(staffMeRes.body.data.user.id, staffId);
      assert.equal(staffMeRes.body.data.active_workspace.role, 'staff');
      assert.equal(
        staffMeRes.body.data.permissions.includes('employees:manage'),
        false,
      );

      // -------------------------------------------------------------------
      // TEST STEP F: Logout with Staff Session -> 204, Cookie Cleared
      // -------------------------------------------------------------------
      const staffLogoutRes = await makeRequest(
        `${baseUrl}/api/v1/auth/logout`,
        {
          method: 'POST',
          headers: {
            Cookie: staffCookieStr,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffLoginRes.body.data.csrf_token,
          },
          body: {},
        },
      );
      assert.equal(staffLogoutRes.status, 204);

      // Subsequent request with revoked staff session fails with 401
      const staffAfterLogout = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: { Cookie: staffCookieStr },
      });
      assert.equal(staffAfterLogout.status, 401);

      // -------------------------------------------------------------------
      // TEST STEP G: Revoke Owner Binding -> Immediate Session Invalidation (401)
      // -------------------------------------------------------------------
      // While Owner session was active, revoke Owner binding
      await pool.query(
        `UPDATE user_workspace_bindings SET status = 'revoked', revoked_at = now(), revoked_by_user_id = $1 WHERE user_id = $1 AND workspace_id = $2;`,
        [ownerId, wsId],
      );

      // Next request with Owner cookie MUST fail with 401 because binding is no longer active!
      const ownerAfterBindingRevoked = await makeRequest(
        `${baseUrl}/api/v1/auth/me`,
        {
          method: 'GET',
          headers: { Cookie: ownerCookieStr },
        },
      );
      assert.equal(ownerAfterBindingRevoked.status, 401);
      assert.equal(ownerAfterBindingRevoked.body.error.code, 'UNAUTHENTICATED');
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
