import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import { AuthService } from '../../dist/apps/api/src/auth/service.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { createBrevoResetMailer } from '../../dist/apps/api/src/auth/reset-email.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';
import { hashToken } from '../../dist/packages/security/src/tokens.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { resolve } from 'node:path';

test('Recovery HTTP + real PostgreSQL + simulated Brevo: verified recipients, login, revocation, replay, expiry, rate limits', async (t) => {
  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);
  t.after(() => pool.end());
  await runMigrations(
    pool,
    loadMigrationFiles(resolve('packages/database/src/migrations')),
  );
  const ws = crypto.randomUUID(),
    user = crypto.randomUUID();
  const email = `brevo-${user}@example.invalid`;
  const oldPassword = 'FixtureOldPass123!',
    newPassword = 'FixtureNewPass456!';
  await pool.query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Recovery isolated QA')",
    [ws],
  );
  await pool.query(
    "INSERT INTO users(id,username_normalized,email_normalized,status,email_verified,email_verified_at) VALUES($1,$2,$3,'active',true,now())",
    [user, user, email],
  );
  await pool.query(
    'INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)',
    [user, await hashPassword(oldPassword)],
  );
  await pool.query(
    "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,'owner','active')",
    [ws, user],
  );
  await pool.query(
    "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES($1,$2,'active')",
    [ws, user],
  );
  const messages = [];
  let rejectDelivery = false;
  const mailer = createBrevoResetMailer(
    { BREVO_API_KEY: 'simulated-transport-no-real-key' },
    async (url, options) => {
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      messages.push(JSON.parse(options.body));
      return new Response('{}', { status: rejectDelivery ? 401 : 201 });
    },
  );
  const origin = 'http://127.0.0.1:3149';
  const csrfSecret = crypto.randomBytes(32).toString('hex');
  const auth = new AuthService(pool, csrfSecret, { resetMailer: mailer });
  const server = http.createServer(
    createRequestHandler({
      pool,
      authService: auth,
      csrfSecret,
      allowedOrigins: [origin],
      isProduction: false,
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, cookie) {
    const res = await fetch(base + '/api/v1/auth/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
    };
  }
  const login = await post('login', {
    identifier: email,
    password: oldPassword,
  });
  assert.equal(login.status, 200);
  const knownStart = Date.now();
  const known = await post('forgot-password', { email });
  const knownDuration = Date.now() - knownStart;
  assert.equal(known.status, 200);
  assert.equal(known.body.data.delivery_status, 'EMAIL_DELIVERY_PENDING');
  assert.equal(messages.length, 1);
  const raw = messages[0].textContent.match(/#token=([a-f0-9]{64})/)[1];
  assert.deepEqual(messages[0].to, [{ email }]);
  assert.ok(!JSON.stringify(known.body).includes(raw));
  const stored = await pool.query(
    'SELECT token_hash,expires_at,consumed_at FROM password_reset_tokens WHERE user_id=$1',
    [user],
  );
  assert.equal(stored.rows[0].token_hash, hashToken(raw));
  assert.equal(stored.rows[0].consumed_at, null);
  assert.ok(
    new Date(stored.rows[0].expires_at).getTime() - Date.now() <=
      15 * 60 * 1000,
  );
  const unknownStart = Date.now();
  const unknown = await post('forgot-password', {
    email: 'unknown@example.invalid',
  });
  assert.deepEqual(unknown.body.data, known.body.data);
  assert.ok(
    Date.now() - unknownStart >= 10900 && knownDuration >= 10900,
    'Same response timing floor',
  );
  assert.equal(messages.length, 1);
  await pool.query('UPDATE users SET email_verified=false WHERE id=$1', [user]);
  const unverified = await post('forgot-password', { email });
  assert.deepEqual(unverified.body.data, known.body.data);
  assert.equal(messages.length, 1);
  await pool.query('UPDATE users SET email_verified=true WHERE id=$1', [user]);
  assert.equal(
    (await post('reset-password', { token: 'fake', new_password: newPassword }))
      .status,
    400,
  );
  const results = await Promise.all([
    post('reset-password', { token: raw, new_password: newPassword }),
    post('reset-password', { token: raw, new_password: newPassword }),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 400]);
  assert.equal(
    (await post('reset-password', { token: raw, new_password: newPassword }))
      .status,
    400,
  );
  const me = await fetch(base + '/api/v1/auth/me', {
    headers: { Cookie: login.cookie },
  });
  assert.equal(me.status, 401);
  assert.equal(
    (await post('login', { identifier: email, password: oldPassword })).status,
    401,
  );
  assert.equal(
    (await post('login', { identifier: email, password: newPassword })).status,
    200,
  );
  const expired = crypto.randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()-interval '1 minute')",
    [user, hashToken(expired)],
  );
  assert.equal(
    (
      await post('reset-password', {
        token: expired,
        new_password: newPassword,
      })
    ).body.error.code,
    'TOKEN_EXPIRED',
  );
  // Fresh limiter for independent provider failure assertions.
  auth.forgotPasswordLimiter.reset('127.0.0.1');
  rejectDelivery = true;
  const failed = await post('forgot-password', { email });
  assert.deepEqual(failed.body.data, known.body.data);
  const active = await pool.query(
    'SELECT count(*)::int AS count FROM password_reset_tokens WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>now()',
    [user],
  );
  assert.equal(active.rows[0].count, 0);
  const audit = await pool.query(
    'SELECT action,metadata_sanitized FROM audit_events WHERE entity_id=$1',
    [user],
  );
  assert.ok(
    audit.rows.some((x) => x.action === 'auth.password_reset_email_failed'),
  );
  assert.ok(!JSON.stringify(audit.rows).includes(raw));
  assert.ok(
    !JSON.stringify(audit.rows).includes('simulated-transport-no-real-key'),
  );
  for (let i = 0; i < 5; i++)
    await post('reset-password', { token: 'fake', new_password: newPassword });
  assert.equal(
    (await post('reset-password', { token: 'fake', new_password: newPassword }))
      .status,
    429,
  );
});
