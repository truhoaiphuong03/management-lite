import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('PASSWORD-CHANGE: Comprehensive Verification for Owner, Staff, Aliases & Safety Guards', async (t) => {
  // 1. Resolve isolated test database configuration
  let testUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!testUrl && fs.existsSync('C:/HoaiPhuong-Server/config/test-secrets/api.env')) {
    try {
      const secretEnv = fs.readFileSync('C:/HoaiPhuong-Server/config/test-secrets/api.env', 'utf8');
      for (const line of secretEnv.split('\n')) {
        if (line.startsWith('DATABASE_URL=')) {
          testUrl = line.substring('DATABASE_URL='.length).trim();
        }
      }
    } catch {}
  }

  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1' ||
    Boolean(testUrl && testUrl.includes('management_lite_test'));

  if (!testUrl || !confirmed) {
    t.skip('Isolated test database not configured - skipping live database tests');
    return;
  }

  const pool = new pg.Pool({ connectionString: testUrl, max: 10 });
  t.after(async () => {
    await pool.end();
  });

  const { hashPassword, verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );
  const { generateCsprngToken, hashToken } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  const csrfSecret = 'test_csrf_secret_min_32_chars_super_safe_p0!';
  const allowedOrigin = 'https://ql.hoaiphuong.click';

  const handler = createRequestHandler({
    pool,
    csrfSecret,
    allowedOrigins: [allowedOrigin, 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
    isProduction: false,
  });

  const server = http.createServer(handler);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((res) => server.close(res)));

  function makeRequest(path, options = {}) {
    return new Promise((resolvePromise, reject) => {
      const parsed = new URL(`${baseUrl}${path}`);
      const headers = { ...options.headers };
      let bodyData = null;
      if (options.body) {
        bodyData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          headers,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(raw);
            } catch {}
            resolvePromise({
              status: res.statusCode || 0,
              headers: res.headers,
              raw,
              json,
            });
          });
        },
      );
      req.on('error', reject);
      if (bodyData) req.write(bodyData);
      req.end();
    });
  }

  function getCookie(headers) {
    const sc = headers['set-cookie'];
    if (!sc) return '';
    return (Array.isArray(sc) ? sc[0] : sc).split(';')[0];
  }

  // Create isolated test workspace
  const wsId = crypto.randomUUID();
  const wsName = `TestWS_${Date.now()}`;
  await pool.query(
    `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
    [wsId, wsName],
  );

  // =========================================================================
  // SUITE 1: OWNER PASSWORD CHANGE COMPLETE LIFECYCLE
  // =========================================================================
  await t.test('1. Owner Password Change: Complete Flow, Rejections, DB Verification & Session Invalidation', async () => {
    const ownerUserId = crypto.randomUUID();
    const ownerUsername = `test_owner_${Date.now()}`;
    const ownerEmail = `test_owner_${Date.now()}@hoaiphuong.local`;
    const initialOwnerPass = 'OldOwnerPass123!';
    const initialHash = await hashPassword(initialOwnerPass);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [ownerUserId, ownerUsername, ownerEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [ownerUserId, initialHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
      [wsId, ownerUserId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
      [wsId, ownerUserId],
    );

    // 1.1 Login with old password
    const loginRes = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: ownerUsername, password: initialOwnerPass },
    });
    assert.equal(loginRes.status, 200, 'Owner login must succeed');
    assert.equal(loginRes.json?.success, true);
    const ownerCookie = getCookie(loginRes.headers);
    let ownerCsrf = loginRes.json?.data?.csrf_token;
    assert.ok(ownerCookie, 'Must return session cookie');
    assert.ok(ownerCsrf, 'Must return CSRF token');

    // 1.2 Create secondary concurrent active session to test invalidation of other sessions
    const secondaryToken = generateCsprngToken(32);
    const secondaryTokenHash = hashToken(secondaryToken);
    await pool.query(
      `INSERT INTO auth_sessions (workspace_id, user_id, session_token_hash, credential_version_at_issue, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, 1, now() + interval '30 minutes', now() + interval '12 hours');`,
      [wsId, ownerUserId, secondaryTokenHash],
    );
    const secondaryCookie = `mglite_session=${secondaryToken}`;

    // Verify secondary session works before password change
    const secBeforeRes = await makeRequest('/api/v1/auth/me', {
      headers: { Cookie: secondaryCookie },
    });
    assert.equal(secBeforeRes.status, 200, 'Secondary session must be valid initially');

    // 1.3 NEGATIVE TESTS
    // 1.3a Missing CSRF -> 403
    const noCsrfRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin },
      body: { current_password: initialOwnerPass, new_password: 'ValidNewPass123!' },
    });
    assert.equal(noCsrfRes.status, 403, 'Missing CSRF must be rejected with 403');

    // 1.3b Invalid CSRF -> 403
    const badCsrfRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': 'bogus_csrf_token' },
      body: { current_password: initialOwnerPass, new_password: 'ValidNewPass123!' },
    });
    assert.equal(badCsrfRes.status, 403, 'Invalid CSRF must be rejected with 403');

    // 1.3c Invalid Origin -> 403
    const badOriginRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: 'https://evil-attacker.example', 'X-CSRF-Token': ownerCsrf },
      body: { current_password: initialOwnerPass, new_password: 'ValidNewPass123!' },
    });
    assert.equal(badOriginRes.status, 403, 'Untrusted origin must be rejected with 403');

    // 1.3d Wrong current password -> 401 INVALID_CREDENTIALS
    const wrongCurRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': ownerCsrf },
      body: { current_password: 'CompletelyWrongPassword123!', new_password: 'ValidNewPass123!' },
    });
    assert.equal(wrongCurRes.status, 401, 'Wrong current password must be rejected with 401');
    assert.equal(wrongCurRes.json?.error?.code, 'INVALID_CREDENTIALS');

    // 1.3e Weak new password (< 8 chars) -> 400 VALIDATION_ERROR
    const weakRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': ownerCsrf },
      body: { current_password: initialOwnerPass, new_password: 'short' },
    });
    assert.equal(weakRes.status, 400, 'Weak new password must be rejected with 400');
    assert.equal(weakRes.json?.error?.code, 'VALIDATION_ERROR');

    // 1.3f New password identical to old password -> 400 VALIDATION_ERROR
    const identicalRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': ownerCsrf },
      body: { current_password: initialOwnerPass, new_password: initialOwnerPass },
    });
    assert.equal(identicalRes.status, 400, 'Identical password must be rejected with 400');
    assert.equal(identicalRes.json?.error?.code, 'VALIDATION_ERROR');

    // 1.3g Confirm password mismatch -> 400 VALIDATION_ERROR
    const mismatchRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': ownerCsrf },
      body: { current_password: initialOwnerPass, new_password: 'ValidNewPass123!', confirm_password: 'MismatchPass123!' },
    });
    assert.equal(mismatchRes.status, 400, 'Mismatched confirm password must be rejected with 400');
    assert.equal(mismatchRes.json?.error?.code, 'VALIDATION_ERROR');

    // 1.3h Unknown field -> 400 VALIDATION_ERROR
    const unknownFieldRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': ownerCsrf },
      body: { current_password: initialOwnerPass, new_password: 'ValidNewPass123!', unexpected_payload: 'hacked' },
    });
    assert.equal(unknownFieldRes.status, 400, 'Unknown field must be rejected with 400');
    assert.equal(unknownFieldRes.json?.error?.code, 'VALIDATION_ERROR');

    // 1.4 POSITIVE TEST: SUCCESSFUL PASSWORD CHANGE
    const targetNewPass = 'BrandNewOwnerPass2026!Strong';
    const changeRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': ownerCsrf },
      body: {
        current_password: initialOwnerPass,
        new_password: targetNewPass,
        confirm_password: targetNewPass,
      },
    });
    assert.equal(changeRes.status, 200, 'Password change must succeed with 200');
    assert.equal(changeRes.json?.success, true);
    assert.ok(changeRes.json?.data?.message, 'Must return success message');
    assert.ok(changeRes.json?.data?.csrf_token, 'Must return refreshed csrf_token in data');

    // 1.5 Database Verification: user_credentials
    const credRow = (
      await pool.query(
        `SELECT credential_version, password_hash, password_changed_at FROM user_credentials WHERE user_id = $1;`,
        [ownerUserId],
      )
    ).rows[0];
    assert.equal(credRow.credential_version, 2, 'credential_version must be incremented to 2');
    assert.ok(credRow.password_changed_at, 'password_changed_at must be populated');
    const hashMatchesNew = await verifyPassword(targetNewPass, credRow.password_hash);
    assert.equal(hashMatchesNew, true, 'password_hash must match target new password');
    const hashMatchesOld = await verifyPassword(initialOwnerPass, credRow.password_hash);
    assert.equal(hashMatchesOld, false, 'password_hash must NOT match old password');

    // 1.6 Audit Event Verification: auth.password_change
    const auditRes = await pool.query(
      `SELECT action, actor_user_id, entity_id FROM audit_events WHERE workspace_id = $1 AND actor_user_id = $2 AND action = 'auth.password_change';`,
      [wsId, ownerUserId],
    );
    assert.ok(auditRes.rows.length >= 1, 'Audit event auth.password_change must be recorded');

    // 1.7 Session Invalidation Verification:
    // Secondary session MUST BE REVOKED -> 401
    const secAfterRes = await makeRequest('/api/v1/auth/me', {
      headers: { Cookie: secondaryCookie },
    });
    assert.equal(secAfterRes.status, 401, 'Secondary session must be revoked and rejected with 401');

    // Current session MUST REMAIN ACTIVE (credential_version_at_issue rotated)
    const curAfterRes = await makeRequest('/api/v1/auth/me', {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(curAfterRes.status, 200, 'Current session must remain active after rotation');

    // 1.8 Logout current session
    const logoutRes = await makeRequest('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: ownerCookie, Origin: allowedOrigin, 'X-CSRF-Token': changeRes.json.data.csrf_token },
    });
    assert.equal(logoutRes.status, 204, 'Logout must succeed with 204');

    // 1.9 Verify OLD password CANNOT login
    const oldLoginAttempt = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: ownerUsername, password: initialOwnerPass },
    });
    assert.equal(oldLoginAttempt.status, 401, 'Old password must be rejected with 401');
    assert.equal(oldLoginAttempt.json?.error?.code, 'INVALID_CREDENTIALS');

    // 1.10 Verify NEW password CAN login
    const newLoginAttempt = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: ownerUsername, password: targetNewPass },
    });
    assert.equal(newLoginAttempt.status, 200, 'New password must login successfully with 200');
    assert.equal(newLoginAttempt.json?.success, true);
  });

  // =========================================================================
  // SUITE 2: STAFF PASSWORD CHANGE COMPLETE LIFECYCLE
  // =========================================================================
  await t.test('2. Staff Password Change: Complete Flow for Staff Role', async () => {
    const staffUserId = crypto.randomUUID();
    const staffUsername = `test_staff_${Date.now()}`;
    const staffEmail = `test_staff_${Date.now()}@hoaiphuong.local`;
    const initialStaffPass = 'OldStaffPass123!';
    const initialStaffHash = await hashPassword(initialStaffPass);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [staffUserId, staffUsername, staffEmail],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [staffUserId, initialStaffHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
      [wsId, staffUserId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
      [wsId, staffUserId],
    );

    // 2.1 Login as Staff
    const loginRes = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: staffUsername, password: initialStaffPass },
    });
    assert.equal(loginRes.status, 200, 'Staff login must succeed');
    const staffCookie = getCookie(loginRes.headers);
    const staffCsrf = loginRes.json?.data?.csrf_token;

    // 2.2 Change password for Staff
    const targetStaffPass = 'BrandNewStaffPass2026!Safe';
    const changeRes = await makeRequest('/api/v1/auth/password/change', {
      method: 'POST',
      headers: { Cookie: staffCookie, Origin: allowedOrigin, 'X-CSRF-Token': staffCsrf },
      body: {
        current_password: initialStaffPass,
        new_password: targetStaffPass,
        confirm_password: targetStaffPass,
      },
    });
    assert.equal(changeRes.status, 200, 'Staff password change must succeed');
    assert.equal(changeRes.json?.success, true);

    // 2.3 Verify database
    const credRow = (
      await pool.query(
        `SELECT credential_version, password_hash FROM user_credentials WHERE user_id = $1;`,
        [staffUserId],
      )
    ).rows[0];
    assert.equal(credRow.credential_version, 2);
    assert.equal(await verifyPassword(targetStaffPass, credRow.password_hash), true);

    // 2.4 Verify old password rejected
    const oldLoginAttempt = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: staffUsername, password: initialStaffPass },
    });
    assert.equal(oldLoginAttempt.status, 401);

    // 2.5 Verify new password logs in
    const newLoginAttempt = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: staffUsername, password: targetStaffPass },
    });
    assert.equal(newLoginAttempt.status, 200);
    assert.equal(newLoginAttempt.json?.data?.active_workspace?.role, 'staff');
  });

  // =========================================================================
  // SUITE 3: ROUTE ALIASES & CAMELCASE FIELD SUPPORT
  // =========================================================================
  await t.test('3. Route Aliases & Body Format Compatibility', async () => {
    const aliasUserId = crypto.randomUUID();
    const aliasUsername = `test_alias_${Date.now()}`;
    const initialPass = 'InitialPass123!';
    const initialHash = await hashPassword(initialPass);

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
      [aliasUserId, aliasUsername, `${aliasUsername}@test.local`],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
      [aliasUserId, initialHash],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
      [wsId, aliasUserId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
      [wsId, aliasUserId],
    );

    const loginRes = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: aliasUsername, password: initialPass },
    });
    const cookie = getCookie(loginRes.headers);
    let csrf = loginRes.json?.data?.csrf_token;

    // 3.1 Test alias: POST /api/v1/auth/password
    const pass2 = 'SecondPass1234567!';
    const alias1Res = await makeRequest('/api/v1/auth/password', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: allowedOrigin, 'X-CSRF-Token': csrf },
      body: { current_password: initialPass, new_password: pass2 },
    });
    assert.equal(alias1Res.status, 200, 'Alias POST /api/v1/auth/password must return 200');
    csrf = alias1Res.json?.data?.csrf_token || csrf;

    // 3.2 Test alias: POST /api/v1/auth/change-password with camelCase fields
    const pass3 = 'ThirdPass1234567!';
    const alias2Res = await makeRequest('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: allowedOrigin, 'X-CSRF-Token': csrf },
      body: {
        currentPassword: pass2,
        newPassword: pass3,
        confirmPassword: pass3,
      },
    });
    assert.equal(alias2Res.status, 200, 'Alias POST /api/v1/auth/change-password with camelCase must return 200');

    // Verify final login works with pass3
    const finalLogin = await makeRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: allowedOrigin },
      body: { identifier: aliasUsername, password: pass3 },
    });
    assert.equal(finalLogin.status, 200, 'Login with final password must succeed');
  });
});
