import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { AuthService } = await import(
  pathToFileURL(resolve('dist/apps/api/src/auth/service.js')).href
);
const { createRequestHandler } = await import(
  pathToFileURL(resolve('dist/apps/api/src/app.js')).href
);
const { hashPassword } = await import(
  pathToFileURL(resolve('dist/packages/security/src/password.js')).href
);
const password = 'SyntheticCollisionTestOnly!';
const hash = await hashPassword(password);
const row = (id) => ({
  id,
  username_normalized: id === 'user-a' ? 'shared@example.test' : id,
  email_normalized:
    id === 'user-b' ? 'shared@example.test' : `${id}@example.test`,
  user_status: 'active',
  password_hash: hash,
  credential_version: 1,
});

function fixture(rows) {
  const queries = [];
  let connections = 0;
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (
        sql.includes('FROM workspace_memberships wm') ||
        sql.includes('FROM user_workspace_bindings uwb')
      )
        return { rows: [] };
      assert.ok(sql.includes('FROM users u'));
      return { rows };
    },
    connect: async () => {
      connections++;
      throw new Error('Session issuance must not be reached');
    },
  };
  const service = new AuthService(pool, 'synthetic-csrf-key-for-test-only');
  return { service, queries, connections: () => connections };
}

test('SEC-05A username/email collision fails closed regardless of row order or password', async () => {
  for (const rows of [
    [row('user-a'), row('user-b')],
    [row('user-b'), row('user-a')],
  ]) {
    for (const suppliedPassword of [password, 'WrongSyntheticPassword!']) {
      const f = fixture(rows);
      await assert.rejects(
        f.service.loginUser({
          identifier: 'shared@example.test',
          password: suppliedPassword,
          clientIp: '127.0.0.1',
          requestId: 'synthetic-request',
        }),
        {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials',
          statusCode: 401,
        },
      );
      assert.equal(f.queries.length, 1);
      assert.equal(f.connections(), 0);
    }
  }
});

test('SEC-05A collision lookup normalizes whitespace and case before generic rejection', async () => {
  const f = fixture([row('user-a'), row('user-b')]);
  await assert.rejects(
    f.service.loginUser({
      identifier: '  SHARED@EXAMPLE.TEST  ',
      password,
      clientIp: '127.0.0.1',
      requestId: 'synthetic-request',
    }),
    { code: 'INVALID_CREDENTIALS', statusCode: 401 },
  );
  assert.deepEqual(f.queries[0].params, ['shared@example.test']);
  assert.equal(f.connections(), 0);
});

test('SEC-05A public collision error matches missing user and wrong password, without cookie or session', async (t) => {
  const outputs = [];
  for (const rows of [[row('user-a'), row('user-b')], [], [row('user-a')]]) {
    const f = fixture(rows);
    const server = http.createServer(
      createRequestHandler({ authService: f.service, isProduction: false }),
    );
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise((done) => server.close(done)));
    const response = await new Promise((done, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path: '/api/v1/auth/login',
          method: 'POST',
          headers: {
            Origin: 'http://localhost:3000',
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () =>
            done({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(body),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(
        JSON.stringify({
          identifier: 'shared@example.test',
          password: 'WrongSyntheticPassword!',
        }),
      );
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(f.connections(), 0);
    assert.equal(f.queries.length, 1);
    outputs.push(response.body.error);
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], outputs[2]);
  assert.deepEqual(outputs[0], {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid credentials',
    details: [],
  });
});

test('SEC-05A counts distinct IDs rather than duplicate rows for one identity', async () => {
  for (const rows of [[row('user-a')], [row('user-a'), row('user-a')]]) {
    const f = fixture(rows);
    await assert.rejects(
      f.service.loginUser({
        identifier: 'shared@example.test',
        password,
        clientIp: '127.0.0.1',
        requestId: 'synthetic-request',
      }),
      { code: 'WORKSPACE_CONTEXT_UNRESOLVED', statusCode: 409 },
    );
    assert.equal(f.connections(), 0);
  }
});
