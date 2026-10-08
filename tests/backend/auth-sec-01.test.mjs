import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const appUrl = pathToFileURL(resolve('dist/apps/api/src/app.js')).href;
const securityUrl = pathToFileURL(
  resolve('dist/packages/security/src/csrf.js'),
).href;
const localOrigin = 'http://localhost:3000';
const secureOrigin = 'https://app.example.test:8443';

function request(port, headers, path = '/api/v1/auth/login', method = 'POST') {
  return new Promise((resolveResponse, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolveResponse({
            status: res.statusCode,
            headers: res.headers,
            body,
          }),
        );
      },
    );
    req.on('error', reject);
    if (method === 'POST') {
      req.write(
        JSON.stringify(
          path === '/api/v1/auth/password/change'
            ? {
                current_password: 'synthetic-test-only',
                new_password: 'synthetic-new-test-only',
              }
            : { identifier: 'synthetic-user', password: 'synthetic-test-only' },
        ),
      );
    }
    req.end();
  });
}

async function fixture(t, options = {}) {
  const { createRequestHandler } = await import(appUrl);
  const calls = [];
  const csrfSecret = crypto.randomBytes(32).toString('hex');
  const context = {
    sessionId: 'synthetic-session',
    sessionTokenHash: 'a'.repeat(64),
    user: { id: 'synthetic-user' },
    workspace: { id: 'synthetic-workspace', role: 'staff' },
  };
  const authService = {
    loginUser: async (params) => {
      calls.push(params);
      return {
        sessionToken: 'synthetic-token',
        responseData: { user: { id: 'synthetic-user' } },
      };
    },
    resolveSession: async () => context,
    logoutSession: async () => {},
    changePassword: async () => ({ message: 'unchanged guard' }),
  };
  const server = http.createServer(
    createRequestHandler({
      authService,
      csrfSecret,
      isProduction: false,
      allowedOrigins: [
        localOrigin,
        secureOrigin,
        'http://127.0.0.1:3000',
        'http://[::1]:3000',
      ],
      ...options,
    }),
  );
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  return { port: server.address().port, calls, csrfSecret, context };
}

test('AUTH-SEC-01 login rejects unsafe origin and media type before session creation', async (t) => {
  const { port, calls } = await fixture(t);
  const cases = [
    ['cross-origin', { Origin: 'https://evil.example.test' }, 403],
    ['missing origin and referer', {}, 403],
    [
      'null origin does not fall back',
      { Origin: 'null', Referer: `${localOrigin}/login` },
      403,
    ],
    [
      'empty origin does not fall back',
      { Origin: '', Referer: `${localOrigin}/login` },
      403,
    ],
    [
      'bad origin does not fall back',
      { Origin: 'https://evil.example.test', Referer: `${localOrigin}/login` },
      403,
    ],
    ['malformed origin', { Origin: 'https://[' }, 403],
    ['origin with path', { Origin: `${localOrigin}/login` }, 403],
    ['origin with userinfo', { Origin: 'http://user@localhost:3000' }, 403],
    ['origin suffix', { Origin: 'https://app.example.test.evil:8443' }, 403],
    ['wrong port', { Origin: 'https://app.example.test:8444' }, 403],
    ['wrong scheme', { Origin: 'http://app.example.test:8443' }, 403],
    ['multiple origins', { Origin: `${localOrigin} ${secureOrigin}` }, 403],
    ['malformed referer', { Referer: 'https://[' }, 403],
    ['relative referer', { Referer: '/login' }, 403],
    [
      'referer missing authority',
      { Referer: 'http:///localhost:3000/login' },
      403,
    ],
    ['referer invalid escape', { Referer: `${localOrigin}/%ZZ` }, 403],
    [
      'referer with credentials',
      { Referer: 'http://user@localhost:3000/login' },
      403,
    ],
    [
      'referer with backslash',
      { Referer: 'http://localhost:3000\\login' },
      403,
    ],
    ['referer wrong port', { Referer: 'http://localhost:3001/login' }, 403],
    [
      'text/plain form',
      { Origin: localOrigin, 'Content-Type': 'text/plain' },
      415,
    ],
    [
      'urlencoded form',
      {
        Origin: localOrigin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      415,
    ],
    [
      'json prefix suffix',
      { Origin: localOrigin, 'Content-Type': 'application/json-evil' },
      415,
    ],
    [
      'no content type',
      { Origin: localOrigin, 'Content-Type': undefined },
      415,
    ],
    ...[
      ['parameter missing equals', 'application/json; charset'],
      ['parameter missing value', 'application/json; charset='],
      ['empty parameter', 'application/json;'],
      ['double separator', 'application/json;; charset=utf-8'],
      ['unterminated quote', 'application/json; charset="utf-8'],
      ['quoted value suffix', 'application/json; charset="utf-8"junk'],
      ['invalid charset', 'application/json; charset=invalid'],
      ['latin1 charset', 'application/json; charset=iso-8859-1'],
      ['utf16 charset', 'application/json; charset=utf-16'],
      ['empty quoted charset', 'application/json; charset=""'],
      [
        'conflicting charset',
        'application/json; charset=utf-8; charset=iso-8859-1',
      ],
      [
        'conflicting charset reversed',
        'application/json; charset=iso-8859-1; charset=utf-8',
      ],
      ['duplicate charset', 'application/json; charset=utf-8; charset=utf-8'],
      ['comma joined media types', 'application/json, text/plain'],
      ['unsupported parameter', 'application/json; boundary=abc'],
      ['malformed extra parameter', 'application/json; charset=utf-8; broken'],
    ].map(([name, contentType]) => [
      name,
      { Origin: localOrigin, 'Content-Type': contentType },
      415,
    ]),
  ];
  for (const [name, overrides, expected] of cases) {
    await t.test(name, async () => {
      const headers = { 'Content-Type': 'application/json', ...overrides };
      if (headers['Content-Type'] === undefined) delete headers['Content-Type'];
      const res = await request(port, headers);
      assert.equal(res.status, expected);
      assert.equal(res.headers['set-cookie'], undefined);
      assert.equal(JSON.parse(res.body).success, false);
      assert.equal(
        calls.length,
        0,
        'Rejected requests must not call session creation',
      );
    });
  }
});

test('AUTH-SEC-01 login allows exact approved origin and absent-origin Referer fallback', async (t) => {
  const { port, calls } = await fixture(t);
  const cases = [
    { Origin: localOrigin },
    { Origin: secureOrigin },
    { Origin: 'http://127.0.0.1:3000' },
    { Origin: 'http://[::1]:3000' },
    { Referer: `${localOrigin}/login?next=%2Fdashboard` },
    { Referer: `${secureOrigin}/login` },
    { Origin: localOrigin, 'Content-Type': 'application/json; charset=utf-8' },
    { Origin: localOrigin, 'Content-Type': 'Application/JSON; charset=UTF-8' },
    {
      Origin: localOrigin,
      'Content-Type': 'application/json; charset="UTF-8"',
    },
    {
      Origin: localOrigin,
      'Content-Type': 'application/json ; charset = utf-8',
    },
  ];
  for (const headers of cases) {
    const res = await request(port, {
      'Content-Type': 'application/json',
      ...headers,
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers['set-cookie']);
  }
  assert.equal(calls.length, cases.length);
});

test('AUTH-SEC-01 HTTP is only allowed for loopback development, production requires HTTPS', async (t) => {
  for (const isProduction of [false, true]) {
    const { port, calls } = await fixture(t, {
      isProduction,
      allowedOrigins: [
        localOrigin,
        secureOrigin,
        'http://app.example.test:8443',
      ],
    });
    for (const headers of [
      { Origin: 'http://app.example.test:8443' },
      ...(isProduction
        ? [{ Origin: localOrigin }, { Referer: `${localOrigin}/login` }]
        : []),
    ]) {
      const res = await request(port, {
        'Content-Type': 'application/json',
        ...headers,
      });
      assert.equal(res.status, 403);
      assert.equal(res.headers['set-cookie'], undefined);
    }
    assert.equal(calls.length, 0);
    const allowed = await request(port, {
      Origin: secureOrigin,
      'Content-Type': 'application/json',
    });
    assert.equal(allowed.status, 200);
    if (isProduction)
      assert.ok(allowed.headers['set-cookie'][0].includes('Secure'));
  }
});

test('AUTH-SEC-01 leaves authenticated endpoint CSRF policy unchanged', async (t) => {
  const { port, csrfSecret, context } = await fixture(t);
  const { generateCsrfToken } = await import(securityUrl);
  const headers = {
    Cookie: 'mglite_session=synthetic-token',
    Origin: localOrigin,
    'X-CSRF-Token': generateCsrfToken(context.sessionTokenHash, csrfSecret),
    'Content-Type': 'application/json',
  };
  // Password change still requires the existing session-bound CSRF token.
  assert.equal(
    (
      await request(
        port,
        { ...headers, 'X-CSRF-Token': '' },
        '/api/v1/auth/password/change',
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(port, headers, '/api/v1/auth/password/change')).status,
    200,
  );
  assert.equal(
    (
      await request(
        port,
        { ...headers, Origin: 'null' },
        '/api/v1/auth/password/change',
      )
    ).status,
    403,
  );
  // Existing authenticated-endpoint helper still permits its empty-Origin Referer fallback.
  assert.equal(
    (
      await request(
        port,
        { ...headers, Origin: '', Referer: `${localOrigin}/settings` },
        '/api/v1/auth/password/change',
      )
    ).status,
    200,
  );
});

function rawRequest(port, host, target) {
  return new Promise((done, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let response = '';
    socket.setTimeout(5000, () =>
      socket.destroy(new Error('HTTP regression timeout')),
    );
    socket.on('error', reject);
    socket.on('data', (chunk) => (response += chunk));
    socket.on('end', () => done(response));
    socket.on('connect', () =>
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      ),
    );
  });
}

test('AUTH-SEC-01 malformed Host/request targets cannot crash the Node process', async (t) => {
  const source = `
    import http from 'node:http';
    import { createRequestHandler } from ${JSON.stringify(appUrl)};
    const server = http.createServer(createRequestHandler({ isProduction: false }));
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `;
  const child = spawn(
    process.execPath,
    ['--unhandled-rejections=strict', '--input-type=module', '--eval', source],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const port = await new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Regression server startup timeout')),
      5000,
    );
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Regression server exited before ready'));
    });
    child.stdout.once('data', (chunk) => {
      clearTimeout(timer);
      done(Number(chunk.toString().trim()));
    });
  });
  const cases = [
    ['[', '/api/v1/health'],
    ['host:99999', '/api/v1/health'],
    ['user@localhost', '/api/v1/health'],
    ['localhost/path', '/api/v1/health'],
    ['localhost', '/%ZZ'],
    ['localhost', '/api/v1/health#fragment'],
    ['localhost', '//evil.example.test/api/v1/health'],
    ['localhost', '/bad\\target'],
    ['localhost', 'http://['],
  ];
  for (const [host, target] of cases) {
    const res = await rawRequest(port, host, target);
    assert.match(res, /^HTTP\/1\.1 400 /);
    assert.ok(!/set-cookie:/i.test(res));
    const health = await request(port, {}, '/api/v1/health', 'GET');
    assert.equal(health.status, 200);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
  }
});
