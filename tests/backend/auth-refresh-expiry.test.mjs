import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const compiled = (path) => pathToFileURL(resolve('dist', path)).href;
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test('AUTH-REMEMBER-01 refresh respects idle expiry and the absolute ceiling', async (t) => {
  if (!process.env.TEST_DATABASE_URL || !process.env.CONFIRM_ISOLATED_TEST_DB) {
    t.skip('Explicitly confirmed sandbox database required');
    return;
  }
  const { loadTestDatabaseConfig } = await import(
    compiled('packages/database/src/config.js')
  );
  const { createDatabasePool } = await import(
    compiled('packages/database/src/pool.js')
  );
  const { loadMigrationFiles, runMigrations } = await import(
    compiled('packages/database/src/migrator.js')
  );
  const { AuthService } = await import(
    compiled('apps/api/src/auth/service.js')
  );
  const { createRequestHandler } = await import(
    compiled('apps/api/src/app.js')
  );
  const { hashToken } = await import(
    compiled('packages/security/src/tokens.js')
  );
  const { DEFAULT_REMEMBER_ME_MAX_AGE_SECONDS } = await import(
    compiled('apps/api/src/cookie.js')
  );
  const config = loadTestDatabaseConfig();
  const pool = createDatabasePool(config);
  let client;
  try {
    await runMigrations(
      pool,
      loadMigrationFiles(resolve('packages/database/src/migrations')),
    );
    client = await pool.connect();
    await client.query('BEGIN');
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const suffix = crypto.randomBytes(8).toString('hex');
    await client.query(
      `INSERT INTO workspaces (id, name, timezone, status)
       VALUES ($1, $2, 'UTC', 'active')`,
      [workspaceId, `Refresh regression ${suffix}`],
    );
    await client.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, `refresh_${suffix}`, `refresh_${suffix}@example.test`],
    );
    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, 'unused-refresh-fixture', 1)`,
      [userId],
    );
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [workspaceId, userId],
    );
    await client.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
       VALUES ($1, $2, 'active', 1)`,
      [workspaceId, userId],
    );
    const now = Date.parse('2026-10-15T04:00:00.000Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    const service = new AuthService(
      client,
      crypto.randomBytes(32).toString('hex'),
    );
    const iso = (offset) => new Date(now + offset).toISOString();
    const snapshot = async (id) =>
      (
        await client.query(
          `SELECT last_seen_at, idle_expires_at, absolute_expires_at
           FROM auth_sessions WHERE id = $1`,
          [id],
        )
      ).rows[0];
    const seed = async ({
      created = -2 * hour,
      idle = 5 * minute,
      absolute = 10 * hour,
      revoked = false,
      version = 1,
    } = {}) => {
      const token = crypto.randomBytes(32).toString('hex');
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO auth_sessions
         (id, workspace_id, user_id, session_token_hash, credential_version_at_issue,
          created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)`,
        [
          id,
          workspaceId,
          userId,
          hashToken(token),
          version,
          iso(created),
          iso(idle),
          iso(absolute),
          revoked ? iso(-minute) : null,
        ],
      );
      return { id, token };
    };
    const refresh = (token) =>
      service.refreshSession({
        sessionToken: token,
        requestId: 'refresh-regression',
      });
    const assertRejectedWithoutMutation = async (session) => {
      const before = await snapshot(session.id);
      assert.equal(await refresh(session.token), null);
      assert.deepEqual(await snapshot(session.id), before);
    };

    await t.test(
      'standard session past idle cannot be revived by refresh',
      async () => {
        await assertRejectedWithoutMutation(await seed({ idle: -1 }));
      },
    );
    await t.test(
      'standard session exactly at idle expiry is rejected',
      async () => {
        await assertRejectedWithoutMutation(await seed({ idle: 0 }));
      },
    );
    await t.test(
      'active standard refresh slides idle by 30 minutes, not absolute',
      async () => {
        const session = await seed();
        const before = await snapshot(session.id);
        const result = await refresh(session.token);
        assert.equal(result.rememberMe, false);
        const after = await snapshot(session.id);
        assert.equal(after.idle_expires_at.toISOString(), iso(30 * minute));
        assert.equal(after.last_seen_at.toISOString(), iso(0));
        assert.deepEqual(after.absolute_expires_at, before.absolute_expires_at);
      },
    );
    await t.test(
      'standard sliding idle never exceeds the absolute ceiling',
      async () => {
        const session = await seed({ absolute: 10 * minute });
        assert.ok(await refresh(session.token));
        const after = await snapshot(session.id);
        assert.deepEqual(after.idle_expires_at, after.absolute_expires_at);
      },
    );
    await t.test('standard absolute expiry is terminal', async () => {
      await assertRejectedWithoutMutation(
        await seed({ created: -12 * hour, idle: -minute, absolute: 0 }),
      );
    });
    await t.test(
      'Remember Me refresh recovers idle but keeps the original 30-day ceiling',
      async () => {
        assert.equal(DEFAULT_REMEMBER_ME_MAX_AGE_SECONDS, (30 * day) / 1000);
        const session = await seed({
          created: -29 * day,
          idle: -minute,
          absolute: day,
        });
        const before = await snapshot(session.id);
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await refresh(session.token);
          assert.equal(result.rememberMe, true);
          assert.equal(result.maxAgeSeconds, day / 1000);
          assert.equal(result.responseData.session_expires_at, iso(day));
          const after = await snapshot(session.id);
          assert.deepEqual(
            after.absolute_expires_at,
            before.absolute_expires_at,
          );
          assert.deepEqual(after.idle_expires_at, before.absolute_expires_at);
        }
      },
    );
    await t.test(
      'Remember Me at or past absolute expiry cannot refresh',
      async () => {
        for (const absolute of [0, -1]) {
          await assertRejectedWithoutMutation(
            await seed({
              created: absolute - 30 * day,
              idle: -minute,
              absolute,
            }),
          );
        }
      },
    );
    await t.test(
      'revoked and stale-credential Remember Me sessions remain invalid',
      async () => {
        for (const invalid of [{ revoked: true }, { version: 2 }]) {
          await assertRejectedWithoutMutation(
            await seed({ created: -day, absolute: 29 * day, ...invalid }),
          );
        }
      },
    );
    await t.test(
      'HTTP refresh rejects expired standard cookie, clears it and leaves DB unchanged',
      async () => {
        const session = await seed({ idle: -minute });
        const before = await snapshot(session.id);
        let handler;
        const server = http.createServer((req, res) => handler(req, res));
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
        const origin = `http://127.0.0.1:${server.address().port}`;
        handler = createRequestHandler({
          authService: service,
          csrfSecret: crypto.randomBytes(32).toString('hex'),
          isProduction: false,
          allowedOrigins: [origin],
        });
        try {
          const res = await fetch(`${origin}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: {
              Origin: origin,
              Cookie: `mglite_session=${session.token}`,
            },
          });
          await res.arrayBuffer();
          assert.equal(res.status, 401);
          assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
          assert.deepEqual(await snapshot(session.id), before);
        } finally {
          await new Promise((done) => server.close(done));
        }
      },
    );
  } finally {
    t.mock.timers.reset();
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  }
});
