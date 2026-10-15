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

test('live PostgreSQL AUTH-01B backend authentication, sessions, CSRF, RBAC', async (t) => {
  // 1. Multi-factor isolation confirmation gate
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    const missing = [];
    if (!testUrl) missing.push('TEST_DATABASE_URL');
    if (!confirmed) missing.push('CONFIRM_ISOLATED_TEST_DB=true');

    t.skip(
      `[BLOCKED] Dedicated test database instance not confirmed (missing: ${missing.join(', ')}). Live database integration tests require an explicitly confirmed, isolated test instance. Tests will not connect or execute against unconfirmed databases. Automated tests never assume isolation based solely on hostname, db name, or NODE_ENV. To reproduce: start an isolated PostgreSQL 15+ container and run with TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true.`,
    );
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
  const { generateCsprngToken, hashToken } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );
  const { requireRole, assertWorkspaceResource } = await import(
    `file://${resolve(root, 'dist/apps/api/src/auth/guard.js')}`
  );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip(
        `[BLOCKED] Real PostgreSQL instance is not reachable (${health.error || 'unreachable'}). Live database integration tests are BLOCKED.`,
      );
      return;
    }

    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    await runMigrations(pool, migrationFiles);

    // 2. Repeatability: 2 consecutive execution runs
    for (let runIndex = 1; runIndex <= 2; runIndex++) {
      await executeAuthIntegrationRun(pool, runIndex, {
        hashPassword,
        generateCsprngToken,
        hashToken,
        createRequestHandler,
        requireRole,
        assertWorkspaceResource,
      });
    }
  } finally {
    await closeDatabasePool(pool);
  }
});

async function executeAuthIntegrationRun(pool, runIndex, ops) {
  const {
    hashPassword,
    generateCsprngToken,
    hashToken,
    createRequestHandler,
    requireRole,
    assertWorkspaceResource,
  } = ops;

  const runToken = crypto.randomBytes(6).toString('hex');
  const allowedOrigin = 'http://localhost:3000';
  const csrfSecret = 'test_csrf_secret_min_32_characters_long_for_auth01b';

  // Spin up test HTTP server backed by real test pool
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
    // -------------------------------------------------------------
    // SETUP: Create Primary Workspace, Secondary Workspace, Users
    // -------------------------------------------------------------
    const ws1Id = crypto.randomUUID();
    const ws2Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
      [ws1Id, `Auth Test Workspace 1 ${runToken}`],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
      [ws2Id, `Auth Test Workspace 2 ${runToken}`],
    );

    // User A (Owner in ws1, exactly 1 active membership)
    const userAId = crypto.randomUUID();
    const userAUsername = `owner_${Date.now()}_r${runIndex}_${runToken}`;
    const userAEmail = `owner_${Date.now()}_r${runIndex}_${runToken}@test.local`;
    const passwordA = `OwnerPass_${runToken}_2026!`;
    const passwordAHash = await hashPassword(passwordA);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [userAId, userAUsername, userAEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [userAId, passwordAHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
      [ws1Id, userAId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
      [ws1Id, userAId],
    );

    // User B (Staff in ws1, exactly 1 active membership and active binding)
    const userBId = crypto.randomUUID();
    const userBUsername = `staff_${Date.now()}_r${runIndex}_${runToken}`;
    const userBEmail = `staff_${Date.now()}_r${runIndex}_${runToken}@test.local`;
    const passwordB = `StaffPass_${runToken}_2026!`;
    const passwordBHash = await hashPassword(passwordB);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [userBId, userBUsername, userBEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [userBId, passwordBHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
      [ws1Id, userBId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
      [ws1Id, userBId],
    );

    // User C (Zero active memberships)
    const userCId = crypto.randomUUID();
    const userCUsername = `nomb_${Date.now()}_r${runIndex}_${runToken}`;
    const userCEmail = `nomb_${Date.now()}_r${runIndex}_${runToken}@test.local`;
    const passwordC = `NombPass_${runToken}_2026!`;
    const passwordCHash = await hashPassword(passwordC);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [userCId, userCUsername, userCEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [userCId, passwordCHash],
    );

    // User D (Multiple active memberships: ws1 + ws2)
    const userDId = crypto.randomUUID();
    const userDUsername = `multi_${Date.now()}_r${runIndex}_${runToken}`;
    const userDEmail = `multi_${Date.now()}_r${runIndex}_${runToken}@test.local`;
    const passwordD = `MultiPass_${runToken}_2026!`;
    const passwordDHash = await hashPassword(passwordD);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [userDId, userDUsername, userDEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [userDId, passwordDHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
      [ws1Id, userDId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
      [ws2Id, userDId],
    );

    // User E (Suspended user status)
    const userEId = crypto.randomUUID();
    const userEUsername = `susp_${Date.now()}_r${runIndex}_${runToken}`;
    const userEEmail = `susp_${Date.now()}_r${runIndex}_${runToken}@test.local`;
    const passwordE = `SuspPass_${runToken}_2026!`;
    const passwordEHash = await hashPassword(passwordE);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'suspended');`,
      [userEId, userEUsername, userEEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [userEId, passwordEHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
      [ws1Id, userEId],
    );

    // -------------------------------------------------------------
    // TEST 1: POST /api/v1/auth/login
    // -------------------------------------------------------------
    // 1.1 Validation error: missing fields
    const resEmpty = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: {},
    });
    assert.equal(resEmpty.status, 400);
    assert.equal(resEmpty.body.success, false);
    assert.equal(resEmpty.body.error.code, 'VALIDATION_ERROR');

    // 1.1b Validation error: unknown request fields rejected per Doc 24
    const resUnknown = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: {
        identifier: userAUsername,
        password: passwordA,
        malicious_extra_field: 'injected',
      },
    });
    assert.equal(resUnknown.status, 400);
    assert.equal(resUnknown.body.success, false);
    assert.equal(resUnknown.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      resUnknown.body.error.message.includes('Unrecognized request field'),
    );

    // 1.2 Non-existent user -> 401 INVALID_CREDENTIALS (anti-enumeration)
    const resNonExistent = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: {
        identifier: 'non_existent_user_9999',
        password: 'SomePassword123!',
      },
    });
    assert.equal(resNonExistent.status, 401);
    assert.equal(resNonExistent.body.success, false);
    assert.equal(resNonExistent.body.error.code, 'INVALID_CREDENTIALS');

    // 1.3 Bad password -> 401 INVALID_CREDENTIALS
    const resBadPw = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userAUsername, password: 'WrongPassword_2026!' },
    });
    assert.equal(resBadPw.status, 401);
    assert.equal(resBadPw.body.success, false);
    assert.equal(resBadPw.body.error.code, 'INVALID_CREDENTIALS');

    // 1.4 Suspended user -> 401 INVALID_CREDENTIALS
    const resSuspended = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userEUsername, password: passwordE },
    });
    assert.equal(resSuspended.status, 401);
    assert.equal(resSuspended.body.success, false);
    assert.equal(resSuspended.body.error.code, 'INVALID_CREDENTIALS');

    // 1.5 C06 Fail-Closed: 0 eligible memberships -> 409 WORKSPACE_CONTEXT_UNRESOLVED, NO session
    const resC06Zero = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userCUsername, password: passwordC },
    });
    assert.equal(resC06Zero.status, 409);
    assert.equal(resC06Zero.body.success, false);
    assert.equal(resC06Zero.body.error.code, 'WORKSPACE_CONTEXT_UNRESOLVED');
    const dbSessionZero = await pool.query(
      `SELECT count(*) FROM auth_sessions WHERE user_id = $1;`,
      [userCId],
    );
    assert.equal(Number(dbSessionZero.rows[0].count), 0);

    // 1.6 C06 Fail-Closed: >1 eligible memberships -> 409 WORKSPACE_CONTEXT_UNRESOLVED, NO arbitrary selection, NO session
    const resC06Multi = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userDUsername, password: passwordD },
    });
    assert.equal(resC06Multi.status, 409);
    assert.equal(resC06Multi.body.success, false);
    assert.equal(resC06Multi.body.error.code, 'WORKSPACE_CONTEXT_UNRESOLVED');
    const dbSessionMulti = await pool.query(
      `SELECT count(*) FROM auth_sessions WHERE user_id = $1;`,
      [userDId],
    );
    assert.equal(Number(dbSessionMulti.rows[0].count), 0);

    // 1.7 Successful login: exactly 1 eligible membership -> 200, Session, CSRF, Cookie, Audit
    const resLoginOwner = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userAEmail, password: passwordA },
    });
    assert.equal(resLoginOwner.status, 200);
    assert.equal(resLoginOwner.body.success, true);
    assert.equal(resLoginOwner.body.data.user.id, userAId);
    assert.equal(resLoginOwner.body.data.user.email, userAEmail);
    assert.equal(resLoginOwner.body.data.active_workspace.id, ws1Id);
    assert.equal(resLoginOwner.body.data.active_workspace.role, 'owner');
    assert.ok(resLoginOwner.body.data.session_expires_at);
    assert.ok(resLoginOwner.body.data.csrf_token);

    // Verify Set-Cookie header
    const rawSetCookie = resLoginOwner.headers['set-cookie'];
    assert.ok(rawSetCookie);
    const cookieHeader = Array.isArray(rawSetCookie)
      ? rawSetCookie[0]
      : rawSetCookie;
    assert.ok(cookieHeader.includes('mglite_session='));
    assert.ok(cookieHeader.includes('HttpOnly'));
    assert.ok(cookieHeader.includes('SameSite=Lax'));

    const sessionCookieValue = cookieHeader.split(';')[0];
    const ownerCsrfToken = resLoginOwner.body.data.csrf_token;

    // Verify audit event recorded for login
    const auditLogin = await pool.query(
      `SELECT * FROM audit_events WHERE workspace_id = $1 AND actor_user_id = $2 AND action = 'auth.login';`,
      [ws1Id, userAId],
    );
    assert.ok(auditLogin.rows.length >= 1);

    // -------------------------------------------------------------
    // TEST 2: GET /api/v1/auth/me
    // -------------------------------------------------------------
    // 2.1 Unauthenticated request (no cookie) -> 401 UNAUTHENTICATED
    const resMeUnauth = await makeRequest(`${baseUrl}/api/v1/auth/me`);
    assert.equal(resMeUnauth.status, 401);
    assert.equal(resMeUnauth.body.error.code, 'UNAUTHENTICATED');

    // 2.2 Authenticated request with Owner cookie -> 200 with permissions & active workspace
    const resMeOwner = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Cookie: sessionCookieValue,
      },
    });
    assert.equal(resMeOwner.status, 200);
    assert.equal(resMeOwner.body.success, true);
    assert.equal(resMeOwner.body.data.user.id, userAId);
    assert.equal(resMeOwner.body.data.active_workspace.id, ws1Id);
    assert.equal(resMeOwner.body.data.active_workspace.role, 'owner');
    assert.ok(resMeOwner.body.data.permissions.includes('employees:manage'));
    assert.ok(resMeOwner.body.data.permissions.includes('payroll:manage'));
    assert.ok(resMeOwner.body.data.memberships.length >= 1);

    // 2.3 Verify sliding idle window in DB
    const dbSessionAfter = await pool.query(
      `SELECT last_seen_at, idle_expires_at, absolute_expires_at FROM auth_sessions WHERE user_id = $1;`,
      [userAId],
    );
    assert.ok(dbSessionAfter.rows[0].last_seen_at);
    assert.ok(dbSessionAfter.rows[0].idle_expires_at);

    // 2.4 Staff login and permissions check
    const resLoginStaff = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userBUsername, password: passwordB },
    });
    assert.equal(resLoginStaff.status, 200);
    const staffCookie = Array.isArray(resLoginStaff.headers['set-cookie'])
      ? resLoginStaff.headers['set-cookie'][0].split(';')[0]
      : resLoginStaff.headers['set-cookie'].split(';')[0];
    const staffCsrfToken = resLoginStaff.body.data.csrf_token;

    const resMeStaff = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Cookie: staffCookie,
      },
    });
    assert.equal(resMeStaff.status, 200);
    assert.equal(resMeStaff.body.data.active_workspace.role, 'staff');
    assert.ok(resMeStaff.body.data.permissions.includes('employees:read_self'));
    assert.ok(!resMeStaff.body.data.permissions.includes('employees:manage'));
    assert.ok(!resMeStaff.body.data.permissions.includes('payroll:manage'));

    // -------------------------------------------------------------
    // TEST 3: POST /api/v1/auth/logout
    // -------------------------------------------------------------
    // 3.1 Mutating request without CSRF -> 403 FORBIDDEN
    const resLogoutNoCsrf = await makeRequest(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: staffCookie,
        Origin: allowedOrigin,
      },
    });
    assert.equal(resLogoutNoCsrf.status, 403);
    assert.equal(resLogoutNoCsrf.body.error.code, 'FORBIDDEN');

    // 3.2 Mutating request with mismatched Origin -> 403 FORBIDDEN
    const resLogoutBadOrigin = await makeRequest(
      `${baseUrl}/api/v1/auth/logout`,
      {
        method: 'POST',
        headers: {
          Cookie: staffCookie,
          Origin: 'http://malicious-site.example',
          'X-CSRF-Token': staffCsrfToken,
        },
      },
    );
    assert.equal(resLogoutBadOrigin.status, 403);

    // 3.2b Mutating request with unknown fields -> 400 VALIDATION_ERROR
    const resLogoutUnknown = await makeRequest(
      `${baseUrl}/api/v1/auth/logout`,
      {
        method: 'POST',
        headers: {
          Cookie: staffCookie,
          Origin: allowedOrigin,
          'X-CSRF-Token': staffCsrfToken,
        },
        body: { unexpected_payload: 123 },
      },
    );
    assert.equal(resLogoutUnknown.status, 400);
    assert.equal(resLogoutUnknown.body.error.code, 'VALIDATION_ERROR');

    // 3.3 Valid logout -> 204 No Content, Set-Cookie clears cookie, session revoked
    const resLogoutValid = await makeRequest(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: staffCookie,
        Origin: allowedOrigin,
        'X-CSRF-Token': staffCsrfToken,
      },
    });
    assert.equal(resLogoutValid.status, 204);

    const logoutClearCookie = resLogoutValid.headers['set-cookie'];
    const logoutClearHeader = Array.isArray(logoutClearCookie)
      ? logoutClearCookie[0]
      : logoutClearCookie;
    assert.ok(logoutClearHeader.includes('Max-Age=0'));

    // 3.4 Subsequent request with revoked cookie fails with 401
    const resMeAfterLogout = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Cookie: staffCookie,
      },
    });
    assert.equal(resMeAfterLogout.status, 401);

    // 3.5 Repeat logout with already revoked session is repeat-safe (204)
    const resLogoutRepeat = await makeRequest(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: staffCookie,
        Origin: allowedOrigin,
        'X-CSRF-Token': staffCsrfToken,
      },
    });
    // Session is revoked so requireAuth throws 401 on unauthenticated session
    assert.equal(resLogoutRepeat.status, 401);

    // -------------------------------------------------------------
    // TEST 4: POST /api/v1/auth/password/change
    // -------------------------------------------------------------
    // 4.1 Missing CSRF -> 403 FORBIDDEN
    const resPwNoCsrf = await makeRequest(
      `${baseUrl}/api/v1/auth/password/change`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
        },
        body: {
          current_password: passwordA,
          new_password: 'NewOwnerPass_2026!',
        },
      },
    );
    assert.equal(resPwNoCsrf.status, 403);

    // 4.1b Unknown fields in password change -> 400 VALIDATION_ERROR
    const resPwUnknown = await makeRequest(
      `${baseUrl}/api/v1/auth/password/change`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrfToken,
        },
        body: {
          current_password: passwordA,
          new_password: 'NewOwnerPass_2026!',
          unexpected_role: 'admin',
        },
      },
    );
    assert.equal(resPwUnknown.status, 400);
    assert.equal(resPwUnknown.body.error.code, 'VALIDATION_ERROR');

    // 4.2 Invalid current password -> 401 INVALID_CREDENTIALS
    const resPwWrongCurrent = await makeRequest(
      `${baseUrl}/api/v1/auth/password/change`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrfToken,
        },
        body: {
          current_password: 'WrongCurrentPassword_123',
          new_password: 'NewOwnerPass_2026!',
        },
      },
    );
    assert.equal(resPwWrongCurrent.status, 401);

    // 4.3 Weak new password (< 8 chars) -> 400 VALIDATION_ERROR
    const resPwWeak = await makeRequest(
      `${baseUrl}/api/v1/auth/password/change`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrfToken,
        },
        body: { current_password: passwordA, new_password: 'short' },
      },
    );
    assert.equal(resPwWeak.status, 400);
    assert.equal(resPwWeak.body.error.code, 'VALIDATION_ERROR');

    // Create a second active session for User A before password change to test invalidation of other sessions
    const secondToken = generateCsprngToken(32);
    const secondTokenHash = hashToken(secondToken);
    await pool.query(
      `INSERT INTO auth_sessions (workspace_id, user_id, session_token_hash, credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me)
       VALUES ($1, $2, $3, 1, now() + interval '30 minutes', now() + interval '12 hours', false);`,
      [ws1Id, userAId, secondTokenHash],
    );
    const secondCookie = `mglite_session=${secondToken}`;

    // Verify second session works before password change
    const resMeSecondBefore = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: secondCookie },
    });
    assert.equal(resMeSecondBefore.status, 200);

    // 4.4 Successful password change
    const newPasswordA = `BrandNewPass_${runToken}_2026!`;
    const resPwSuccess = await makeRequest(
      `${baseUrl}/api/v1/auth/password/change`,
      {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrfToken,
        },
        body: { current_password: passwordA, new_password: newPasswordA },
      },
    );
    assert.equal(resPwSuccess.status, 200);
    assert.equal(resPwSuccess.body.success, true);
    assert.equal(
      resPwSuccess.body.data.message,
      'Password changed successfully',
    );

    // Verify credential_version incremented to 2
    const credRow = await pool.query(
      `SELECT credential_version FROM user_credentials WHERE user_id = $1;`,
      [userAId],
    );
    assert.equal(credRow.rows[0].credential_version, 2);

    // Verify second session is now revoked/invalidated -> 401
    const resMeSecondAfter = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: secondCookie },
    });
    assert.equal(resMeSecondAfter.status, 401);

    // Verify current session still works (credential_version_at_issue rotated)
    const resMeCurrentAfter = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: sessionCookieValue },
    });
    assert.equal(resMeCurrentAfter.status, 200);

    // Verify can login with new password
    const resLoginNewPw = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userAUsername, password: newPasswordA },
    });
    assert.equal(resLoginNewPw.status, 200);

    // Verify cannot login with old password
    const resLoginOldPw = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: { identifier: userAUsername, password: passwordA },
    });
    assert.equal(resLoginOldPw.status, 401);

    // Verify audit event recorded for password change
    const auditPw = await pool.query(
      `SELECT * FROM audit_events WHERE workspace_id = $1 AND actor_user_id = $2 AND action = 'auth.password_change';`,
      [ws1Id, userAId],
    );
    assert.ok(auditPw.rows.length >= 1);

    // -------------------------------------------------------------
    // TEST 5: RBAC & Workspace Isolation Guards
    // -------------------------------------------------------------
    // 5.1 requireRole guard
    const ownerContext = {
      sessionId: crypto.randomUUID(),
      sessionTokenHash: 'hash',
      user: { id: userAId, username: userAUsername, email: userAEmail },
      workspace: {
        id: ws1Id,
        name: 'Workspace 1',
        timezone: 'Asia/Ho_Chi_Minh',
        role: 'owner',
      },
    };
    const staffContext = {
      sessionId: crypto.randomUUID(),
      sessionTokenHash: 'hash',
      user: { id: userBId, username: userBUsername, email: userBEmail },
      workspace: {
        id: ws1Id,
        name: 'Workspace 1',
        timezone: 'Asia/Ho_Chi_Minh',
        role: 'staff',
      },
    };

    // Owner role check
    assert.doesNotThrow(() => requireRole(['owner'], ownerContext));
    assert.throws(() => requireRole(['owner'], staffContext), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });

    // 5.2 assertWorkspaceResource isolation guard
    assert.doesNotThrow(() => assertWorkspaceResource(ws1Id, ownerContext));
    assert.throws(() => assertWorkspaceResource(ws2Id, ownerContext), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });

    // -------------------------------------------------------------
    // TEST 6: Session Expiration in DB (Idle & Absolute)
    // -------------------------------------------------------------
    // 6.1 Expired idle session
    const expiredIdleToken = generateCsprngToken(32);
    const expiredIdleHash = hashToken(expiredIdleToken);
    await pool.query(
      `INSERT INTO auth_sessions (workspace_id, user_id, session_token_hash, credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me)
       VALUES ($1, $2, $3, 2, now() - interval '1 minute', now() + interval '12 hours', false);`,
      [ws1Id, userAId, expiredIdleHash],
    );
    const resExpiredIdle = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mglite_session=${expiredIdleToken}` },
    });
    assert.equal(resExpiredIdle.status, 401);

    // 6.2 Expired absolute session
    const expiredAbsToken = generateCsprngToken(32);
    const expiredAbsHash = hashToken(expiredAbsToken);
    await pool.query(
      `INSERT INTO auth_sessions (workspace_id, user_id, session_token_hash, credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me)
       VALUES ($1, $2, $3, 2, now() + interval '30 minutes', now() - interval '1 minute', false);`,
      [ws1Id, userAId, expiredAbsHash],
    );
    const resExpiredAbs = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: `mglite_session=${expiredAbsToken}` },
    });
    assert.equal(resExpiredAbs.status, 401);

    // -------------------------------------------------------------
    // TEST 7: Rate Limiting & Proxy Spoofing Prevention
    // -------------------------------------------------------------
    // With trustedProxies empty by default, an attacker attempts to bypass rate limiting
    // by altering the X-Forwarded-For header on every request.
    const spoofLimiter = (
      await import(
        `file://${resolve(root, 'dist/apps/api/src/rate-limiter.js')}`
      )
    ).RateLimiter;
    const testLimiter = new spoofLimiter({ windowMs: 60000, maxAttempts: 3 });
    const { AuthService } = await import(
      `file://${resolve(root, 'dist/apps/api/src/auth/service.js')}`
    );
    const spoofService = new AuthService(pool, csrfSecret, {
      loginLimiter: testLimiter,
    });
    const spoofHandler = createRequestHandler({
      pool,
      authService: spoofService,
      csrfSecret,
      allowedOrigins: [allowedOrigin],
      trustedProxies: [], // NO proxies trusted
    });
    const spoofServer = http.createServer(spoofHandler);
    await new Promise((res) => spoofServer.listen(0, '127.0.0.1', res));
    const spoofPort = spoofServer.address().port;

    try {
      // 3 attempts with 3 different fake forwarded IPs
      for (let i = 1; i <= 3; i++) {
        const resFail = await makeRequest(
          `http://127.0.0.1:${spoofPort}/api/v1/auth/login`,
          {
            method: 'POST',
            headers: { 'X-Forwarded-For': `203.0.113.${i}` },
            body: { identifier: userAUsername, password: 'WrongPasswordSpoof' },
          },
        );
        assert.equal(resFail.status, 401);
      }
      // 4th attempt with yet another spoofed IP: MUST be blocked with 429 RATE_LIMITED
      const resBlocked = await makeRequest(
        `http://127.0.0.1:${spoofPort}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: { 'X-Forwarded-For': '203.0.113.99' },
          body: { identifier: userAUsername, password: 'WrongPasswordSpoof' },
        },
      );
      assert.equal(resBlocked.status, 429);
      assert.equal(resBlocked.body.error.code, 'RATE_LIMITED');
      assert.ok(
        resBlocked.body.error.message.includes('Too many login attempts'),
      );
    } finally {
      await new Promise((res) => spoofServer.close(res));
    }

    // -------------------------------------------------------------
    // TEST 8: Session Race Safety & Concurrency
    // -------------------------------------------------------------
    // 8.1 Concurrent resolveSession vs logout:
    // When a session is logged out concurrently, the atomic conditional update
    // ensures the session cannot be extended or authenticated.
    const raceSessionToken = generateCsprngToken(32);
    const raceSessionHash = hashToken(raceSessionToken);
    await pool.query(
      `INSERT INTO auth_sessions (workspace_id, user_id, session_token_hash, credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me)
       VALUES ($1, $2, $3, 2, now() + interval '30 minutes', now() + interval '12 hours', false);`,
      [ws1Id, userAId, raceSessionHash],
    );

    const raceCookie = `mglite_session=${raceSessionToken}`;
    const { generateCsrfToken } = await import(
      `file://${resolve(root, 'dist/packages/security/src/csrf.js')}`
    );
    const raceCsrf = generateCsrfToken(raceSessionHash, csrfSecret);

    // Launch concurrent /me queries and a logout
    const raceOps = [
      makeRequest(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: raceCookie },
      }),
      makeRequest(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: raceCookie,
          Origin: allowedOrigin,
          'X-CSRF-Token': raceCsrf,
        },
      }),
      makeRequest(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: raceCookie },
      }),
      makeRequest(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: raceCookie },
      }),
    ];

    const raceResults = await Promise.all(raceOps);
    // Logout must succeed with 204 (or 401 if already invalidated)
    assert.ok(raceResults.some((r) => r.status === 204));

    // After completion, session row MUST have revoked_at populated
    const checkDbRevoked = await pool.query(
      `SELECT revoked_at, idle_expires_at FROM auth_sessions WHERE session_token_hash = $1;`,
      [raceSessionHash],
    );
    assert.ok(
      checkDbRevoked.rows[0].revoked_at !== null,
      'Session must be permanently marked revoked',
    );

    // All subsequent attempts must fail with 401
    const resAfterAll = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: raceCookie },
    });
    assert.equal(resAfterAll.status, 401);

    // 8.2 Concurrent password change with row locking:
    // Sending concurrent password changes with the same original password
    const pwRaceA = `RaceNewPassA_${runToken}_2026!`;
    const pwRaceB = `RaceNewPassB_${runToken}_2026!`;

    const concurrentPwOps = [
      makeRequest(`${baseUrl}/api/v1/auth/password/change`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrfToken,
        },
        body: { current_password: newPasswordA, new_password: pwRaceA },
      }),
      makeRequest(`${baseUrl}/api/v1/auth/password/change`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookieValue,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrfToken,
        },
        body: { current_password: newPasswordA, new_password: pwRaceB },
      }),
    ];

    const pwRaceResults = await Promise.all(concurrentPwOps);
    // Because of SELECT ... FOR UPDATE, one of the transactions commits first,
    // causing the second transaction to see the updated hash and fail with 401 INVALID_CREDENTIALS
    const statuses = pwRaceResults.map((r) => r.status).sort();
    assert.deepEqual(
      statuses,
      [200, 401],
      'Row lock must serialize password changes',
    );
  } finally {
    await new Promise((res) => server.close(res));
  }
}
