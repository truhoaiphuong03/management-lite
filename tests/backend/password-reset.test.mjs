import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import http from 'node:http';
import pg from 'pg';
import crypto from 'node:crypto';
import { resolve } from 'node:path';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { AuthService } from '../../dist/apps/api/src/auth/service.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';

const dbConfig = loadTestDatabaseConfig();
assertSafeTestDatabase(dbConfig);
const DATABASE_URL = dbConfig.connectionString;

let API_BASE = '';
let sharedPool = null;
let sharedServer = null;
let createdAdminId = null;
let isolatedUnverifiedEmail = '';
let createdWorkspaceId = null;

before(async () => {
  sharedPool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
  await runMigrations(
    sharedPool,
    loadMigrationFiles(resolve('packages/database/src/migrations')),
  );

  // Ensure an active workspace exists
  const wsCheck = await sharedPool.query(
    `SELECT id FROM workspaces WHERE status = 'active' LIMIT 1;`,
  );
  if (wsCheck.rows.length === 0) {
    createdWorkspaceId = crypto.randomUUID();
    await sharedPool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Password Reset Isolated QA', 'Asia/Ho_Chi_Minh', 'active');`,
      [createdWorkspaceId],
    );
  }

  // Create an isolated unverified admin user fixture (never touch DEV Owner accounts)
  const suffix = crypto.randomBytes(6).toString('hex');
  createdAdminId = crypto.randomUUID();
  isolatedUnverifiedEmail = `isolated-unverified-admin-${suffix}@example.invalid`;
  await sharedPool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status, email_verified, email_verified_at)
     VALUES ($1, $2, $3, 'active', false, NULL);`,
    [createdAdminId, `admin_pw_reset_qa_${suffix}`, isolatedUnverifiedEmail],
  );

  const csrfSecret = crypto.randomBytes(32).toString('hex');
  const authService = new AuthService(sharedPool, csrfSecret);
  sharedServer = http.createServer(
    createRequestHandler({
      pool: sharedPool,
      authService,
      csrfSecret,
      allowedOrigins: ['http://127.0.0.1:3001'],
      trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
      isProduction: false,
    }),
  );
  await new Promise((resolveListen) =>
    sharedServer.listen(0, '127.0.0.1', resolveListen),
  );
  API_BASE = `http://127.0.0.1:${sharedServer.address().port}`;
});

after(async () => {
  if (sharedServer) {
    await new Promise((resolveClose) => sharedServer.close(resolveClose));
  }
  if (sharedPool) {
    if (createdAdminId) {
      await sharedPool
        .query(`DELETE FROM password_reset_tokens WHERE user_id = $1;`, [
          createdAdminId,
        ])
        .catch(() => {});
      await sharedPool
        .query(`DELETE FROM users WHERE id = $1;`, [createdAdminId])
        .catch(() => {});
    }
    if (createdWorkspaceId) {
      await sharedPool
        .query(`DELETE FROM workspaces WHERE id = $1;`, [createdWorkspaceId])
        .catch(() => {});
    }
    await sharedPool.end();
  }
});

function makeRequest(url, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        Origin: 'http://127.0.0.1:3001',
        ...(options.ip ? { 'X-Forwarded-For': options.ip } : {}),
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

test('REGRESSION 1: Route HTTP /api/v1/qa/mock-reset-token must NOT exist (HTTP 404)', async () => {
  const getRes = await makeRequest(`${API_BASE}/api/v1/qa/mock-reset-token`);
  assert.equal(getRes.status, 404, 'GET /api/v1/qa/mock-reset-token must return 404');
  assert.equal(getRes.body.success, false);
  assert.equal(getRes.body.error.code, 'NOT_FOUND');

  const getWithQuery = await makeRequest(
    `${API_BASE}/api/v1/qa/mock-reset-token?email=${encodeURIComponent(isolatedUnverifiedEmail)}`,
  );
  assert.equal(getWithQuery.status, 404, 'Querying mock-reset-token with email must return 404');

  const postRes = await makeRequest(`${API_BASE}/api/v1/qa/mock-reset-token`, {
    method: 'POST',
    body: { email: isolatedUnverifiedEmail },
  });
  assert.equal(postRes.status, 404, 'POST to mock-reset-token must return 404');
});

test('REGRESSION 2: Anti-enumeration & zero token leakage across all email types', async () => {
  const randSubnet = Math.floor(Math.random() * 200) + 10;
  // Test unknown non-existent email
  const resUnknown = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    body: { email: 'nonexistent-victim-xyz123@example.com' },
    ip: `10.99.${randSubnet}.1`,
  });
  assert.equal(resUnknown.status, 200);
  assert.equal(resUnknown.body.success, true);
  assert.match(
    resUnknown.body.data.message,
    /Nếu email tồn tại trong hệ thống và hợp lệ/,
  );
  assert.equal(resUnknown.body.data.delivery_status, 'EMAIL_DELIVERY_BLOCKED');
  assert.equal(resUnknown.body.data.token, undefined);
  assert.equal(resUnknown.body.data.dev_token, undefined);

  // Test isolated unverified admin email
  const resAdmin = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    body: { email: isolatedUnverifiedEmail },
    ip: `10.99.${randSubnet}.2`,
  });
  assert.equal(resAdmin.status, 200);
  assert.equal(resAdmin.body.success, true);
  assert.equal(resAdmin.body.data.delivery_status, 'EMAIL_DELIVERY_BLOCKED');
  assert.equal(resAdmin.body.data.message, resUnknown.body.data.message);
  assert.equal(resAdmin.body.data.token, undefined);
  assert.equal(resAdmin.body.data.dev_token, undefined);
});

test('REGRESSION 3: Cannot reset password knowing only email & unverified admin blocked from token generation', async () => {
  const randSubnet = Math.floor(Math.random() * 200) + 10;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    // Verify isolated admin in DB is NOT email_verified
    const adminRes = await pool.query(
      `SELECT id, email_normalized, email_verified, email_verified_at, email_verification_proof
       FROM users WHERE email_normalized = $1;`,
      [isolatedUnverifiedEmail],
    );
    assert.ok(adminRes.rows.length > 0, 'Isolated admin user must exist in DB');
    const admin = adminRes.rows[0];
    assert.equal(
      admin.email_verified,
      false,
      'Admin email must NOT be automatically verified without proof',
    );
    assert.equal(admin.email_verified_at, null);

    // Count existing reset tokens for admin before request
    const countBefore = await pool.query(
      `SELECT count(*)::int AS count FROM password_reset_tokens WHERE user_id = $1;`,
      [admin.id],
    );

    // Call forgot-password for unverified admin
    const forgotRes = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
      method: 'POST',
      body: { email: isolatedUnverifiedEmail },
      ip: `10.99.${randSubnet}.3`,
    });
    assert.equal(forgotRes.status, 200);
    assert.equal(forgotRes.body.data.delivery_status, 'EMAIL_DELIVERY_BLOCKED');

    // Verify in DB that NO reset token was generated because email is unverified
    const countAfter = await pool.query(
      `SELECT count(*)::int AS count FROM password_reset_tokens WHERE user_id = $1;`,
      [admin.id],
    );
    assert.equal(
      countAfter.rows[0].count,
      countBefore.rows[0].count,
      'No reset token may be created for an unverified email',
    );

    // Attacker attempts reset with victim email and fake/empty tokens
    const emptyAttempt = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: { token: '', new_password: 'NewStrongPassword123!' },
      ip: `10.99.${randSubnet}.4`,
    });
    assert.equal(emptyAttempt.status, 400);

    const fakeAttempt = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: { token: 'attacker-guessed-token', new_password: 'NewStrongPassword123!' },
      ip: `10.99.${randSubnet}.5`,
    });
    assert.equal(fakeAttempt.status, 400);
  } finally {
    await pool.end();
  }
});

test('REGRESSION 4: Rate limiter strictly enforces limits and blocks on 6th request', async () => {
  const randOctet = Math.floor(Math.random() * 200) + 10;
  const testIp = `10.88.${randOctet}.100`;

  // Make 5 consecutive requests from testIp (even with invalid/unknown emails)
  for (let i = 1; i <= 5; i++) {
    const res = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
      method: 'POST',
      body: { email: `spam_attempt_${i}_${Date.now()}@example.com` },
      ip: testIp,
    });
    assert.equal(
      res.status,
      200,
      `Request ${i} should be allowed within threshold`,
    );
  }

  // 6th consecutive request must return 429 RATE_LIMITED
  const res6 = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    body: { email: 'another_attempt@example.com' },
    ip: testIp,
  });
  assert.equal(res6.status, 429, '6th request must be rejected with 429');
  assert.equal(res6.body.success, false);
  assert.equal(res6.body.error.code, 'RATE_LIMITED');
  assert.match(res6.body.error.message, /Quá nhiều yêu cầu khôi phục mật khẩu/);

  // 7th consecutive request must also be rejected
  const res7 = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    body: { email: 'another_attempt_7@example.com' },
    ip: testIp,
  });
  assert.equal(res7.status, 429, '7th request must also be rejected with 429');
  assert.equal(res7.body.error.code, 'RATE_LIMITED');

  // Test resetPassword limiter independently
  const resetIp = `10.88.${randOctet}.200`;
  for (let i = 1; i <= 5; i++) {
    const res = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: { token: `fake-token-${i}`, new_password: 'ValidPassword123!' },
      ip: resetIp,
    });
    assert.equal(
      res.status,
      400,
      `Reset attempt ${i} fails validation/token check and counts against limiter`,
    );
  }

  const reset6 = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
    method: 'POST',
    body: { token: 'fake-token-6', new_password: 'ValidPassword123!' },
    ip: resetIp,
  });
  assert.equal(reset6.status, 429, '6th reset attempt must return 429');
  assert.equal(reset6.body.error.code, 'RATE_LIMITED');
});

test('REGRESSION 5: Rate limiter handles concurrent requests correctly', async () => {
  const burstIp = `10.89.${Math.floor(Math.random() * 200) + 10}.1`;
  const promises = Array.from({ length: 8 }, (_, i) =>
    makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
      method: 'POST',
      body: { email: `burst_${i}@example.com` },
      ip: burstIp,
    }),
  );

  const results = await Promise.all(promises);
  const allowed = results.filter((r) => r.status === 200);
  const rateLimited = results.filter((r) => r.status === 429);

  assert.equal(
    allowed.length,
    5,
    'Exactly 5 concurrent requests must be allowed',
  );
  assert.equal(
    rateLimited.length,
    3,
    'Remaining 3 concurrent requests must be rejected with 429',
  );
});

test('REGRESSION 6: Valid reset succeeds ONLY with legitimate token from verified owner channel', async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const verifiedEmail = `qa_verified_user_${Date.now()}@example.com`;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15m TTL
  const testIp = `10.77.${Math.floor(Math.random() * 200) + 10}.1`;

  let testUserId = null;

  try {
    // 1. Create a test user with verified email proof
    const insertUserRes = await pool.query(
      `INSERT INTO users (username_normalized, email_normalized, status, email_verified, email_verified_at, email_verification_proof)
       VALUES ($1, $2, 'active', true, now(), $3)
       RETURNING id;`,
      [
        `qa_user_${Date.now()}`,
        verifiedEmail,
        JSON.stringify({ proofType: 'manual_ownership_audit_proof', verifiedAt: new Date().toISOString() }),
      ],
    );
    testUserId = insertUserRes.rows[0].id;

    // Attach workspace membership
    const wsRes = await pool.query(`SELECT id FROM workspaces LIMIT 1;`);
    const workspaceId = wsRes.rows[0].id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'staff', 'active')
       ON CONFLICT DO NOTHING;`,
      [workspaceId, testUserId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT DO NOTHING;`,
      [workspaceId, testUserId],
    );

    // Initial password
    const initialHash = await import('../../dist/packages/security/src/password.js').then((m) =>
      m.hashPassword('InitialPass123!'),
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, $2, 1);`,
      [testUserId, initialHash],
    );

    // 2. Insert token directly via internal DB test fixture (representing secure delivery)
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, request_ip)
       VALUES ($1, $2, $3, $4);`,
      [testUserId, tokenHash, expiresAt, testIp],
    );

    // 3. Reset password using the valid token
    const newPassword = 'SecureVerifiedReset2026!';
    const resetRes = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: {
        token: rawToken,
        new_password: newPassword,
      },
      ip: testIp,
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);
    assert.match(resetRes.body.data.message, /Mật khẩu đã được đặt lại thành công/);

    // 4. Verify single-use enforcement: Token is now consumed
    const tokenDb = await pool.query(
      `SELECT consumed_at FROM password_reset_tokens WHERE token_hash = $1;`,
      [tokenHash],
    );
    assert.ok(tokenDb.rows[0].consumed_at !== null, 'Token must be marked consumed');

    // 5. Attempting to reuse the token must be rejected
    const reuseRes = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: {
        token: rawToken,
        new_password: 'AnotherPassword999!',
      },
      ip: testIp,
    });
    assert.equal(reuseRes.status, 400);
    assert.equal(reuseRes.body.error.code, 'INVALID_TOKEN');

    // 6. Login with new password succeeds
    const userRow = await pool.query(`SELECT username_normalized FROM users WHERE id = $1;`, [testUserId]);
    const loginRes = await makeRequest(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      body: {
        identifier: userRow.rows[0].username_normalized,
        password: newPassword,
      },
      ip: testIp,
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.success, true);
  } finally {
    if (testUserId) {
      await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM user_credentials WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM user_workspace_bindings WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM workspace_memberships WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1;`, [testUserId]).catch(() => {});
    }
    await pool.end();
  }
});

test('REGRESSION 7: Successful password reset invalidates ALL active recovery tokens for that user', async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let testUserId = null;
  const testSuffix = Math.floor(Math.random() * 900000) + 100000;
  const username = `test_inval_user_${testSuffix}`;
  const email = `inval_user_${testSuffix}@example.com`;
  const initialPasswordHash = '$argon2id$v=19$m=65536,t=3,p=4$fakehashfakehashfakehashfakehashfakehashfakehash$fakehashfakehashfakehashfakehashfakehashfakehash';
  const testIp = `10.88.${Math.floor(Math.random() * 200) + 10}.1`;

  try {
    const wsRes = await pool.query(`SELECT id FROM workspaces WHERE status = 'active' LIMIT 1;`);
    const workspaceId = wsRes.rows[0].id;

    const userRes = await pool.query(
      `INSERT INTO users (username_normalized, email_normalized, status, email_verified, email_verified_at)
       VALUES ($1, $2, 'active', true, now())
       RETURNING id;`,
      [username, email],
    );
    testUserId = userRes.rows[0].id;

    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, $2, 1);`,
      [testUserId, initialPasswordHash],
    );

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'staff', 'active');`,
      [workspaceId, testUserId],
    );

    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status)
       VALUES ($1, $2, 'active');`,
      [workspaceId, testUserId],
    );

    // Issue TWO distinct active tokens for this user
    const tokenA = crypto.randomBytes(32).toString('hex');
    const tokenHashA = crypto.createHash('sha256').update(tokenA).digest('hex');

    const tokenB = crypto.randomBytes(32).toString('hex');
    const tokenHashB = crypto.createHash('sha256').update(tokenB).digest('hex');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, request_ip)
       VALUES ($1, $2, $3, $4), ($1, $5, $3, $4);`,
      [testUserId, tokenHashA, expiresAt, testIp, tokenHashB],
    );

    // Reset password using Token A
    const resetResA = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: {
        token: tokenA,
        new_password: 'ValidPasswordResetA1!',
      },
      ip: testIp,
    });
    assert.equal(resetResA.status, 200, 'Reset with Token A must succeed');
    assert.equal(resetResA.body.success, true);

    // Verify in database: BOTH Token A and Token B are now consumed!
    const tokensInDb = await pool.query(
      `SELECT token_hash, consumed_at FROM password_reset_tokens WHERE user_id = $1;`,
      [testUserId],
    );
    assert.equal(tokensInDb.rows.length, 2);
    for (const row of tokensInDb.rows) {
      assert.ok(row.consumed_at !== null, 'Every token of the user must be invalidated');
    }

    // Attempt to use Token B must be rejected immediately
    const resetResB = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: {
        token: tokenB,
        new_password: 'ValidPasswordResetB2!',
      },
      ip: testIp,
    });
    assert.equal(resetResB.status, 400, 'Token B must be rejected as already consumed');
    assert.equal(resetResB.body.error.code, 'INVALID_TOKEN');
  } finally {
    if (testUserId) {
      await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM user_credentials WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM user_workspace_bindings WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM workspace_memberships WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1;`, [testUserId]).catch(() => {});
    }
    await pool.end();
  }
});

test('REGRESSION 8: Concurrency protection — two different tokens for the same user cannot concurrently succeed', async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let testUserId = null;
  const testSuffix = Math.floor(Math.random() * 900000) + 100000;
  const username = `test_conc_user_${testSuffix}`;
  const email = `conc_user_${testSuffix}@example.com`;
  const initialPasswordHash = '$argon2id$v=19$m=65536,t=3,p=4$fakehashfakehashfakehashfakehashfakehashfakehash$fakehashfakehashfakehashfakehashfakehashfakehash';
  const testIp = `10.87.${Math.floor(Math.random() * 200) + 10}.1`;

  try {
    const wsRes = await pool.query(`SELECT id FROM workspaces WHERE status = 'active' LIMIT 1;`);
    const workspaceId = wsRes.rows[0].id;

    const userRes = await pool.query(
      `INSERT INTO users (username_normalized, email_normalized, status, email_verified, email_verified_at)
       VALUES ($1, $2, 'active', true, now())
       RETURNING id;`,
      [username, email],
    );
    testUserId = userRes.rows[0].id;

    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, $2, 1);`,
      [testUserId, initialPasswordHash],
    );

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'staff', 'active');`,
      [workspaceId, testUserId],
    );

    await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status)
       VALUES ($1, $2, 'active');`,
      [workspaceId, testUserId],
    );

    const token1 = crypto.randomBytes(32).toString('hex');
    const tokenHash1 = crypto.createHash('sha256').update(token1).digest('hex');

    const token2 = crypto.randomBytes(32).toString('hex');
    const tokenHash2 = crypto.createHash('sha256').update(token2).digest('hex');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, request_ip)
       VALUES ($1, $2, $3, $4), ($1, $5, $3, $4);`,
      [testUserId, tokenHash1, expiresAt, testIp, tokenHash2],
    );

    // Execute both resets concurrently
    const [res1, res2] = await Promise.all([
      makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
        method: 'POST',
        body: { token: token1, new_password: 'ConcurrentPass1!' },
        ip: `10.87.1.1`,
      }),
      makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
        method: 'POST',
        body: { token: token2, new_password: 'ConcurrentPass2!' },
        ip: `10.87.1.2`,
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 400],
      'Exactly one concurrent reset must succeed (200) and the other must fail (400)',
    );

    const successfulRes = res1.status === 200 ? res1 : res2;
    const failedRes = res1.status === 400 ? res1 : res2;
    assert.equal(successfulRes.body.success, true);
    assert.equal(failedRes.body.error.code, 'INVALID_TOKEN');
  } finally {
    if (testUserId) {
      await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM user_credentials WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM user_workspace_bindings WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM workspace_memberships WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1;`, [testUserId]).catch(() => {});
    }
    await pool.end();
  }
});

test('REGRESSION 9: Account-level rate limiting blocks distributed multi-IP attacks against the same email', async () => {
  const targetEmail = `distributed-target-${Date.now()}@example.com`;

  // Send 5 requests from 5 different IPs for the same email
  for (let i = 1; i <= 5; i++) {
    const ip = `10.77.${i}.1`;
    const res = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
      method: 'POST',
      body: { email: targetEmail },
      ip,
    });
    assert.equal(
      res.status,
      200,
      `Request ${i} from distinct IP ${ip} should succeed within account limit`,
    );
  }

  // 6th request from a completely fresh 6th IP targeting the SAME email must be blocked with HTTP 429
  const resBlocked = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
    method: 'POST',
    body: { email: targetEmail },
    ip: '10.77.6.1',
  });
  assert.equal(
    resBlocked.status,
    429,
    '6th request from fresh IP against same target email must be blocked with HTTP 429',
  );
  assert.equal(resBlocked.body.error.code, 'RATE_LIMITED');
  assert.match(resBlocked.body.error.message, /Quá nhiều yêu cầu khôi phục mật khẩu/);

  // Anti-enumeration verification: Ensure the error payload does not leak the target email
  assert.equal(
    JSON.stringify(resBlocked.body).includes(targetEmail),
    false,
    'Rate limit error response must NEVER echo or disclose the target email',
  );
});

test('REGRESSION 10: Expired token returns TOKEN_EXPIRED and EMAIL_DELIVERY_BLOCKED leaves no active token for verified users', async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let testUserId = null;
  const suffix = crypto.randomBytes(6).toString('hex');
  const email = `verified_blocked_${suffix}@example.com`;
  const testIp = `10.66.${Math.floor(Math.random() * 200) + 10}.1`;

  try {
    const userRes = await pool.query(
      `INSERT INTO users (username_normalized, email_normalized, status, email_verified, email_verified_at)
       VALUES ($1, $2, 'active', true, now())
       RETURNING id;`,
      [`user_blk_${suffix}`, email],
    );
    testUserId = userRes.rows[0].id;

    // 1. When mailer is not configured (EMAIL_DELIVERY_BLOCKED), requesting reset for verified user must not leave an unconsumed token
    const forgotRes = await makeRequest(`${API_BASE}/api/v1/auth/forgot-password`, {
      method: 'POST',
      body: { email },
      ip: testIp,
    });
    assert.equal(forgotRes.status, 200);
    assert.equal(forgotRes.body.data.delivery_status, 'EMAIL_DELIVERY_BLOCKED');

    const activeTokens = await pool.query(
      `SELECT count(*)::int AS count FROM password_reset_tokens WHERE user_id = $1 AND consumed_at IS NULL;`,
      [testUserId],
    );
    assert.equal(
      activeTokens.rows[0].count,
      0,
      'No active unconsumed reset token should exist when email delivery is blocked',
    );

    // 2. Expired token must be rejected with 400 TOKEN_EXPIRED and marked consumed
    const expiredRaw = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredRaw).digest('hex');
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, request_ip)
       VALUES ($1, $2, now() - interval '2 minutes', $3);`,
      [testUserId, expiredHash, testIp],
    );

    const expRes = await makeRequest(`${API_BASE}/api/v1/auth/reset-password`, {
      method: 'POST',
      body: {
        token: expiredRaw,
        new_password: 'NewStrongPassword2026!',
      },
      ip: testIp,
    });
    assert.equal(expRes.status, 400);
    assert.equal(expRes.body.error.code, 'TOKEN_EXPIRED');
  } finally {
    if (testUserId) {
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1;`, [testUserId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1;`, [testUserId]).catch(() => {});
    }
    await pool.end();
  }
});
