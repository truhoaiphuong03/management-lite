import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { AuthService } from '../../dist/apps/api/src/auth/service.js';
import { EmployeeService } from '../../dist/apps/api/src/employees/service.js';
import { AccountsService } from '../../dist/apps/api/src/accounts/service.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { createBrevoResetMailer } from '../../dist/apps/api/src/auth/reset-email.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';

test('Email Verification Official Flow & Password Recovery Integration (Isolated)', async (t) => {
  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);
  await runMigrations(
    pool,
    loadMigrationFiles(resolve('packages/database/src/migrations')),
  );

  // Record snapshot of existing DEV Owner accounts before tests to prove zero mutation
  const snapBefore = await pool.query(
    `SELECT id, username_normalized, email_normalized, status, email_verified, email_verified_at
     FROM users
     WHERE email_normalized IN ('admin@management-lite.local', 'truhoaiphuong02@gmail.com')
     ORDER BY email_normalized`,
  );

  const createdUserIds = [];
  const wsId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const suffix = crypto.randomBytes(5).toString('hex');
  const ownerEmail = `owner-ev-${suffix}@example.invalid`;
  const ownerPass = 'OwnerIsoPass123!';

  createdUserIds.push(ownerId);

  t.after(async () => {
    try {
      await pool.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    } catch {}
    if (createdUserIds.length > 0) {
      try {
        await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          createdUserIds,
        ]);
      } catch {}
    }
    await pool.end();
  });

  await pool.query(
    `INSERT INTO workspaces (id, name, status) VALUES ($1, $2, 'active')`,
    [wsId, `EV Isolated Workspace ${suffix}`],
  );
  await pool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'active', true, now())`,
    [ownerId, `owner_ev_${suffix}`, ownerEmail],
  );
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`,
    [ownerId, await hashPassword(ownerPass)],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')`,
    [wsId, ownerId],
  );
  await pool.query(
    `INSERT INTO user_workspace_bindings (workspace_id, user_id, status)
     VALUES ($1, $2, 'active')`,
    [wsId, ownerId],
  );

  const brevoVerificationCalls = [];
  const brevoResetCalls = [];

  const mailer = createBrevoResetMailer(
    { BREVO_API_KEY: 'simulated-brevo-key-for-ev-test' },
    async (url, options) => {
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      const payload = JSON.parse(options.body);
      const content = String(
        payload?.textContent || payload?.htmlContent || '',
      );
      const verifyMatch = content.match(/\/verify-email#token=([A-Za-z0-9_-]+)/);
      const resetMatch = content.match(/\/reset-password#token=([A-Za-z0-9_-]+)/);

      if (verifyMatch) {
        brevoVerificationCalls.push({
          payload,
          extractedToken: verifyMatch[1],
        });
      } else if (resetMatch) {
        brevoResetCalls.push({
          payload,
          extractedToken: resetMatch[1],
        });
      }
      return new Response('{"messageId":"<sim-ev@brevo>"}', { status: 201 });
    },
  );

  const origin = 'http://127.0.0.1:3101';
  const csrfSecret = crypto.randomBytes(32).toString('hex');
  const authService = new AuthService(pool, csrfSecret, {
    resetMailer: mailer,
  });
  const employeeService = new EmployeeService(pool);
  const accountsService = new AccountsService(pool);

  const server = http.createServer(
    createRequestHandler({
      pool,
      authService,
      employeeService,
      accountsService,
      csrfSecret,
      allowedOrigins: [origin],
      trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
      isProduction: false,
    }),
  );
  await new Promise((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function requestJson(
    path,
    { method = 'POST', body, cookie, csrfToken, clientIp } = {},
  ) {
    const headers = {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
    };
    const res = await fetch(base + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      body: await res.json().catch(() => null),
      cookie: res.headers.get('set-cookie')?.split(';')[0] || '',
    };
  }

  // 1. Login as isolated workspace owner
  const ownerLogin = await requestJson('/api/v1/auth/login', {
    body: { identifier: ownerEmail, password: ownerPass },
    clientIp: '203.0.113.10',
  });
  assert.equal(ownerLogin.status, 200);
  assert.equal(ownerLogin.body.data.user.email_verified, true);
  const ownerCookie = ownerLogin.cookie;
  const ownerCsrf = ownerLogin.body.data.csrf_token;

  // 2. Register a new isolated staff account via official onboarding (POST /api/v1/employees + POST /api/v1/auth/activate)
  const staffEmail = `staff-ev-${suffix}@example.invalid`;
  const createEmp = await requestJson('/api/v1/employees', {
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    clientIp: '203.0.113.10',
    body: {
      full_name: 'Staff Email Verify QA',
      email: staffEmail,
      role: 'staff',
    },
  });
  assert.equal(createEmp.status, 201);
  const inviteToken = createEmp.body.data.invite_token;
  const staffUserId = createEmp.body.data.user_id;
  assert.ok(inviteToken, 'Must receive onboarding invite token');
  if (staffUserId) createdUserIds.push(staffUserId);

  const initialStaffPass = 'StaffInitialPass123!';
  const activateRes = await requestJson('/api/v1/auth/activate', {
    clientIp: '203.0.113.11',
    body: {
      token: inviteToken,
      new_password: initialStaffPass,
    },
  });
  assert.equal(activateRes.status, 200);

  const staffDbRow = await pool.query(
    `SELECT id, status, email_verified FROM users WHERE email_normalized = $1`,
    [staffEmail],
  );
  assert.equal(staffDbRow.rowCount, 1);
  const resolvedStaffId = staffDbRow.rows[0].id;
  if (!createdUserIds.includes(resolvedStaffId)) {
    createdUserIds.push(resolvedStaffId);
  }
  assert.equal(staffDbRow.rows[0].status, 'active');
  assert.equal(
    staffDbRow.rows[0].email_verified,
    false,
    'Newly activated account must start with email_verified = false',
  );

  // 3. Forgot password must NOT send reset email while email_verified = false
  const resetCountBefore = brevoResetCalls.length;
  const forgotUnverified = await requestJson('/api/v1/auth/forgot-password', {
    clientIp: '203.0.113.12',
    body: { email: staffEmail },
  });
  assert.equal(forgotUnverified.status, 200);
  assert.equal(
    brevoResetCalls.length,
    resetCountBefore,
    'Unverified account must not trigger Brevo password reset delivery',
  );

  // 4. Request email verification via POST /api/v1/auth/verify-email/request
  const verifyCountBefore = brevoVerificationCalls.length;
  const reqVerify = await requestJson('/api/v1/auth/verify-email/request', {
    clientIp: '203.0.113.13',
    body: { email: staffEmail },
  });
  assert.equal(reqVerify.status, 200);
  assert.equal(reqVerify.body.data.delivery_status, 'EMAIL_DELIVERY_PENDING');
  assert.equal(brevoVerificationCalls.length, verifyCountBefore + 1);

  const verifyCall = brevoVerificationCalls[brevoVerificationCalls.length - 1];
  assert.equal(verifyCall.payload.sender.email, 'no-reply@hoaiphuong.click');
  assert.equal(verifyCall.payload.to[0].email, staffEmail);
  const verifyToken = verifyCall.extractedToken;
  assert.ok(verifyToken && verifyToken.length >= 20);

  // 5. Confirm email verification via POST /api/v1/auth/verify-email/confirm
  const confirmRes = await requestJson('/api/v1/auth/verify-email/confirm', {
    clientIp: '203.0.113.14',
    body: { token: verifyToken },
  });
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.data.email_verified, true);

  const verifiedRow = await pool.query(
    `SELECT email_verified, email_verified_at FROM users WHERE id = $1`,
    [resolvedStaffId],
  );
  assert.equal(verifiedRow.rows[0].email_verified, true);
  assert.ok(verifiedRow.rows[0].email_verified_at);

  const proofRows = await pool.query(
    `SELECT proof_type, verified_at FROM email_verifications WHERE user_id = $1`,
    [resolvedStaffId],
  );
  assert.equal(proofRows.rowCount, 1);
  assert.equal(proofRows.rows[0].proof_type, 'token_confirmation');
  assert.ok(proofRows.rows[0].verified_at);

  // 6. Replay protection: reusing the same verification token must fail with 400 INVALID_TOKEN
  const replayConfirm = await requestJson('/api/v1/auth/verify-email/confirm', {
    clientIp: '203.0.113.15',
    body: { token: verifyToken },
  });
  assert.equal(replayConfirm.status, 400);
  assert.equal(replayConfirm.body.error.code, 'INVALID_TOKEN');

  // 7. Login as verified staff and verify session reports email_verified: true
  const staffLogin = await requestJson('/api/v1/auth/login', {
    clientIp: '203.0.113.16',
    body: { identifier: staffEmail, password: initialStaffPass },
  });
  assert.equal(staffLogin.status, 200);
  assert.equal(staffLogin.body.data.user.email_verified, true);
  const oldStaffCookie = staffLogin.cookie;

  // 8. Now request password reset -> must send reset email via Brevo
  const forgotVerified = await requestJson('/api/v1/auth/forgot-password', {
    clientIp: '203.0.113.17',
    body: { email: staffEmail },
  });
  assert.equal(forgotVerified.status, 200);
  assert.equal(brevoResetCalls.length, resetCountBefore + 1);
  const resetToken = brevoResetCalls[brevoResetCalls.length - 1].extractedToken;
  assert.ok(resetToken);

  // 9. Complete password reset -> revokes old session and enables login with new password
  const newStaffPass = 'StaffResetPass456!';
  const resetRes = await requestJson('/api/v1/auth/reset-password', {
    clientIp: '203.0.113.18',
    body: { token: resetToken, new_password: newStaffPass },
  });
  assert.equal(resetRes.status, 200);

  const oldSessionCheck = await requestJson('/api/v1/auth/me', {
    method: 'GET',
    cookie: oldStaffCookie,
  });
  assert.equal(oldSessionCheck.status, 401);

  const newLogin = await requestJson('/api/v1/auth/login', {
    clientIp: '203.0.113.19',
    body: { identifier: staffEmail, password: newStaffPass },
  });
  assert.equal(newLogin.status, 200);

  // 10. Edge cases: token expiry (15m TTL), email change revocation, concurrent race, and rate limits
  const edgeUserId = crypto.randomUUID();
  const edgeEmail = `edge-ev-${suffix}@example.invalid`;
  createdUserIds.push(edgeUserId);
  await pool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status, email_verified)
     VALUES ($1, $2, $3, 'active', false)`,
    [edgeUserId, `edge_ev_${suffix}`, edgeEmail],
  );

  // 10a. Expired token
  const reqExp = await requestJson('/api/v1/auth/verify-email/request', {
    clientIp: '198.51.100.11',
    body: { email: edgeEmail },
  });
  assert.equal(reqExp.status, 200);
  const expToken =
    brevoVerificationCalls[brevoVerificationCalls.length - 1].extractedToken;

  await pool.query(
    `UPDATE email_verifications
     SET proof_metadata = jsonb_set(proof_metadata, '{expires_at}', to_jsonb((now() - interval '5 minutes')::text), true)
     WHERE user_id = $1 AND verified_at IS NULL`,
    [edgeUserId],
  );

  const expConfirm = await requestJson('/api/v1/auth/verify-email/confirm', {
    clientIp: '198.51.100.12',
    body: { token: expToken },
  });
  assert.equal(expConfirm.status, 400);
  assert.equal(expConfirm.body.error.code, 'TOKEN_EXPIRED');

  // 10b. Revoke old token when email changes
  const reqBeforeChange = await requestJson(
    '/api/v1/auth/verify-email/resend',
    {
      clientIp: '198.51.100.13',
      body: { email: edgeEmail },
    },
  );
  assert.equal(reqBeforeChange.status, 200);
  const tokenBeforeEmailChange =
    brevoVerificationCalls[brevoVerificationCalls.length - 1].extractedToken;

  const changedEmail = `edge-changed-${suffix}@example.invalid`;
  await authService.changeUserEmail({
    userId: edgeUserId,
    newEmail: changedEmail,
    requestId: 'test-change-email',
  });

  const confirmStaleEmail = await requestJson(
    '/api/v1/auth/verify-email/confirm',
    {
      clientIp: '198.51.100.14',
      body: { token: tokenBeforeEmailChange },
    },
  );
  assert.equal(confirmStaleEmail.status, 400);
  assert.equal(confirmStaleEmail.body.error.code, 'INVALID_TOKEN');

  // 10c. Concurrent confirmation race on new email
  const reqRace = await requestJson('/api/v1/auth/verify-email/request', {
    clientIp: '198.51.100.15',
    body: { email: changedEmail },
  });
  assert.equal(reqRace.status, 200);
  const raceToken =
    brevoVerificationCalls[brevoVerificationCalls.length - 1].extractedToken;

  const [race1, race2] = await Promise.all([
    requestJson('/api/v1/auth/verify-email/confirm', {
      clientIp: '198.51.100.16',
      body: { token: raceToken },
    }),
    requestJson('/api/v1/auth/verify-email/confirm', {
      clientIp: '198.51.100.17',
      body: { token: raceToken },
    }),
  ]);
  assert.deepEqual(
    [race1.status, race2.status].sort((a, b) => a - b),
    [200, 400],
  );

  // 10d. Account rate limit (>5 requests per 15m window)
  const rateEmail = `rate-ev-${suffix}@example.invalid`;
  for (let i = 0; i < 5; i++) {
    const r = await requestJson('/api/v1/auth/verify-email/request', {
      clientIp: `198.51.100.${40 + i}`,
      body: { email: rateEmail },
    });
    assert.equal(r.status, 200);
  }
  const rateLimited = await requestJson('/api/v1/auth/verify-email/request', {
    clientIp: '198.51.100.99',
    body: { email: rateEmail },
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error.code, 'RATE_LIMITED');

  // 11. Verify DEV Owner accounts remain 100% unchanged
  const snapAfter = await pool.query(
    `SELECT id, username_normalized, email_normalized, status, email_verified, email_verified_at
     FROM users
     WHERE email_normalized IN ('admin@management-lite.local', 'truhoaiphuong02@gmail.com')
     ORDER BY email_normalized`,
  );
  assert.deepEqual(snapAfter.rows, snapBefore.rows);
});
