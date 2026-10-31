import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const dist = (p) => `file://${resolve(root, 'dist', p)}`;

function fakeReq(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers };
}

function request(port, options = {}) {
  return new Promise((resolveReq, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method || 'GET',
        path: options.path || '/',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolveReq({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

// ---------------------------------------------------------------------------
// 14.1 Client IP resolution (rate-limit key)
// ---------------------------------------------------------------------------
test('PH14-1: getClientIp never trusts the client-controlled left-most X-Forwarded-For hop', async () => {
  const { getClientIp } = await import(dist('apps/api/src/app.js'));
  const trusted = ['127.0.0.1', '::1'];

  // Attacker pre-fills XFF; edge appends the real IP; our web proxy appends its peer.
  const spoofed = fakeReq('127.0.0.1', {
    'x-forwarded-for': '9.9.9.9, 203.0.113.7, 127.0.0.1',
  });
  assert.equal(getClientIp(spoofed, trusted), '203.0.113.7');

  // Rotating the forged prefix must not change the resolved key.
  const other = fakeReq('127.0.0.1', {
    'x-forwarded-for': '8.8.4.4, 203.0.113.7, 127.0.0.1',
  });
  assert.equal(getClientIp(other, trusted), getClientIp(spoofed, trusted));
});

test('PH14-1: getClientIp prefers a valid CF-Connecting-IP and ignores invalid ones', async () => {
  const { getClientIp } = await import(dist('apps/api/src/app.js'));
  const trusted = ['127.0.0.1'];

  assert.equal(
    getClientIp(
      fakeReq('127.0.0.1', {
        'cf-connecting-ip': '198.51.100.20',
        'x-forwarded-for': '9.9.9.9, 127.0.0.1',
      }),
      trusted,
    ),
    '198.51.100.20',
  );
  assert.equal(
    getClientIp(
      fakeReq('127.0.0.1', {
        'cf-connecting-ip': 'not-an-ip',
        'x-forwarded-for': '203.0.113.9, 127.0.0.1',
      }),
      trusted,
    ),
    '203.0.113.9',
  );
});

test('PH14-1: getClientIp falls back to the socket peer for untrusted peers, garbage hops and IPv4-mapped peers', async () => {
  const { getClientIp } = await import(dist('apps/api/src/app.js'));

  // Untrusted peer: every forwarded header is ignored, including CF-Connecting-IP.
  assert.equal(
    getClientIp(
      fakeReq('203.0.113.195', {
        'cf-connecting-ip': '1.1.1.1',
        'x-forwarded-for': '2.2.2.2',
      }),
      ['127.0.0.1'],
    ),
    '203.0.113.195',
  );
  // Garbage right-most hop cannot be trusted -> peer address.
  assert.equal(
    getClientIp(
      fakeReq('127.0.0.1', { 'x-forwarded-for': '203.0.113.7, <script>' }),
      ['127.0.0.1'],
    ),
    '127.0.0.1',
  );
  // IPv4-mapped IPv6 peer matches a configured IPv4 proxy.
  assert.equal(
    getClientIp(
      fakeReq('::ffff:127.0.0.1', {
        'x-forwarded-for': '203.0.113.7',
      }),
      ['127.0.0.1'],
    ),
    '203.0.113.7',
  );
});

test('PH14-1: failed logins are capped per account even when every request comes from a new IP', async () => {
  const { AuthService } = await import(dist('apps/api/src/auth/service.js'));
  const { RateLimiter } = await import(dist('apps/api/src/rate-limiter.js'));
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => {
      throw new Error('unexpected connect');
    },
  };
  const svc = new AuthService(pool, 'x'.repeat(48), {
    loginLimiter: new RateLimiter({ windowMs: 60_000, maxAttempts: 1000 }),
    loginAccountLimiter: new RateLimiter({ windowMs: 60_000, maxAttempts: 3 }),
  });
  const attempt = (identifier, ip) =>
    svc
      .loginUser({
        identifier,
        password: 'wrong-password-1',
        clientIp: ip,
        requestId: 'req-test',
      })
      .then(
        () => 'ok',
        (err) => err.code,
      );

  for (let i = 1; i <= 3; i++) {
    assert.equal(
      await attempt('Owner@Example.com', `198.51.100.${i}`),
      'INVALID_CREDENTIALS',
    );
  }
  // Fourth guess from yet another IP is refused, case-insensitively.
  assert.equal(
    await attempt('owner@example.com', '198.51.100.99'),
    'RATE_LIMITED',
  );
  // Other accounts are unaffected.
  assert.equal(
    await attempt('someone-else', '198.51.100.99'),
    'INVALID_CREDENTIALS',
  );
});

// ---------------------------------------------------------------------------
// 14.3 Request id, cookie-name binding, process safety nets
// ---------------------------------------------------------------------------
test('PH14-3: only log-safe client X-Request-Id values are echoed; others are replaced', async () => {
  const { createRequestHandler } = await import(dist('apps/api/src/app.js'));
  const server = http.createServer(createRequestHandler({}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const good = await request(port, {
      path: '/api/v1/health',
      headers: { 'x-request-id': 'trace-abc_123.9' },
    });
    assert.equal(good.headers['x-request-id'], 'trace-abc_123.9');

    const tooLong = await request(port, {
      path: '/api/v1/health',
      headers: { 'x-request-id': 'a'.repeat(200) },
    });
    assert.notEqual(tooLong.headers['x-request-id'], 'a'.repeat(200));
    assert.match(tooLong.headers['x-request-id'], /^[0-9a-f-]{36}$/);

    const weird = await request(port, {
      path: '/api/v1/health',
      headers: { 'x-request-id': 'id with spaces;drop' },
    });
    assert.match(weird.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  } finally {
    server.close();
  }
});

test('PH14-2: API JSON responses carry anti-framing and no-sniff headers', async () => {
  const { createRequestHandler } = await import(dist('apps/api/src/app.js'));
  const server = http.createServer(createRequestHandler({}));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await request(port, { path: '/api/v1/health' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
  } finally {
    server.close();
  }
});

test('PH14-3: a custom SESSION_COOKIE_NAME authenticates routes that previously ignored it', async () => {
  const { createRequestHandler } = await import(dist('apps/api/src/app.js'));
  const context = {
    user: { id: 'u1' },
    workspace: { id: 'w1', role: 'staff' },
    sessionTokenHash: 'h',
  };
  const authService = {
    resolveSession: async (token) => (token === 'tok-1' ? context : null),
  };
  const employeeService = {
    getEmployeeMe: async () => ({ id: 'e1', employee_code: 'NV001' }),
  };
  const server = http.createServer(
    createRequestHandler({
      authService,
      employeeService,
      sessionCookieName: 'custom_sess',
      csrfSecret: 'x'.repeat(48),
      isProduction: false,
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const ok = await request(port, {
      path: '/api/v1/employees/me',
      headers: { cookie: 'custom_sess=tok-1' },
    });
    assert.equal(ok.status, 200);
    const wrongName = await request(port, {
      path: '/api/v1/employees/me',
      headers: { cookie: 'mglite_session=tok-1' },
    });
    assert.equal(wrongName.status, 401);
  } finally {
    server.close();
  }
});

test('PH14-3: process safety nets log rejections and exit non-zero on uncaught exceptions', async () => {
  const { setupProcessSafetyNets } = await import(
    dist('apps/api/src/server.js')
  );
  const handlers = {};
  const exits = [];
  const logs = [];
  const proc = {
    on: (event, fn) => {
      handlers[event] = fn;
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  let closed = 0;
  setupProcessSafetyNets(
    {
      close: async () => {
        closed += 1;
      },
    },
    {
      proc,
      logger: { error: (...a) => logs.push(a.join(' ')) },
      forceExitMs: 60_000,
    },
  );

  handlers.unhandledRejection(new Error('boom'));
  assert.equal(exits.length, 0, 'a rejection must not kill the process');
  assert.equal(logs.length, 1);

  handlers.uncaughtException(new Error('fatal'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, 1);
  assert.deepEqual(exits, [1]);

  // A second fatal error must not trigger a second shutdown.
  handlers.uncaughtException(new Error('again'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, 1);
});

// ---------------------------------------------------------------------------
// 14.4 Housekeeping + DB limits
// ---------------------------------------------------------------------------
test('PH14-4: purgeExpiredAuthRecords clears proofs first, protects referenced sessions, sums counts', async () => {
  const { purgeExpiredAuthRecords } = await import(
    dist('apps/api/src/auth/purge.js')
  );
  const seen = [];
  const counts = [2, 5, 7];
  const db = {
    query: async (sql) => {
      seen.push(sql.replace(/\s+/g, ' ').trim());
      return { rowCount: counts[seen.length - 1] };
    },
  };
  const total = await purgeExpiredAuthRecords(db);
  assert.equal(total, 14);
  assert.equal(seen.length, 3);
  assert.match(seen[0], /^DELETE FROM account_reauth_proofs/);
  assert.match(seen[1], /^DELETE FROM auth_sessions s/);
  assert.match(
    seen[1],
    /NOT EXISTS \( SELECT 1 FROM account_reauth_proofs p WHERE p\.session_id = s\.id \)/,
  );
  assert.match(seen[1], /interval '7 days'/);
  assert.match(seen[2], /^DELETE FROM idempotency_records/);
});

test('PH14-4: loadDatabaseConfig applies a statement timeout and application name, overridable by env', async () => {
  const { loadDatabaseConfig } = await import(
    dist('packages/database/src/config.js')
  );
  const def = loadDatabaseConfig({});
  assert.equal(def.statementTimeoutMillis, 30000);
  assert.equal(def.applicationName, 'management-lite-api');

  const custom = loadDatabaseConfig({
    DB_STATEMENT_TIMEOUT_MS: '5000',
    DB_APPLICATION_NAME: 'ml-test',
  });
  assert.equal(custom.statementTimeoutMillis, 5000);
  assert.equal(custom.applicationName, 'ml-test');

  assert.equal(
    loadDatabaseConfig({ DB_STATEMENT_TIMEOUT_MS: '0' }).statementTimeoutMillis,
    0,
    '0 disables the cap',
  );
  assert.equal(
    loadDatabaseConfig({ DB_STATEMENT_TIMEOUT_MS: 'abc' })
      .statementTimeoutMillis,
    30000,
  );
});

// ---------------------------------------------------------------------------
// 14.2 Web server: security headers + proxy chain
// ---------------------------------------------------------------------------
test('PH14-2: web server sends CSP (hash of inline script), anti-framing and HSTS-over-TLS; proxies with a verifiable forward chain', async () => {
  const { createWebServer, buildCsp } = require(
    resolve(root, 'scripts/runtime/serve-web.cjs'),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
  const inline =
    "\r\n  document.documentElement.setAttribute('data-theme','dark');\r\n";
  fs.writeFileSync(
    path.join(tmp, 'index.html'),
    `<!doctype html><html><head><script>${inline}</script></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`,
  );
  fs.mkdirSync(path.join(tmp, 'assets'));
  fs.writeFileSync(path.join(tmp, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(
    path.join(path.dirname(tmp), 'ml-outside-secret.txt'),
    'secret',
  );

  let upstreamHeaders = null;
  const upstream = http.createServer((req, res) => {
    upstreamHeaders = req.headers;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const web = createWebServer({
    root: tmp,
    apiHost: '127.0.0.1',
    apiPort: upstream.address().port,
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const port = web.address().port;

  try {
    const expectedHash = crypto
      .createHash('sha256')
      .update(inline.replace(/\r\n/g, '\n'), 'utf8')
      .digest('base64');

    const page = await request(port, { path: '/some/spa/route' });
    assert.equal(page.status, 200);
    const csp = page.headers['content-security-policy'];
    assert.ok(
      csp.includes(`'sha256-${expectedHash}'`),
      'inline theme script is allow-listed by hash',
    );
    assert.ok(
      !/script-src[^;]*'unsafe-inline'/.test(csp),
      'scripts never get unsafe-inline',
    );
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes('https://img.vietqr.io'));
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.ok(page.headers['permissions-policy'].includes('camera=()'));
    assert.equal(page.headers['strict-transport-security'], undefined);

    const tls = await request(port, {
      path: '/',
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.match(tls.headers['strict-transport-security'], /max-age=31536000/);

    const asset = await request(port, { path: '/assets/app.js' });
    assert.equal(asset.status, 200);
    assert.equal(
      asset.headers['content-security-policy'],
      undefined,
      'CSP only on the HTML document',
    );
    assert.equal(asset.headers['x-content-type-options'], 'nosniff');

    // Path traversal and verbs
    const traversal = await request(port, {
      path: '/%2e%2e%2fml-outside-secret.txt',
    });
    assert.equal(traversal.status, 403);
    const nul = await request(port, { path: '/a%00b' });
    assert.equal(nul.status, 400);
    const post = await request(port, { method: 'POST', path: '/' });
    assert.equal(post.status, 405);

    // Proxy: forged XFF is kept but our own peer is appended on the right.
    const proxied = await request(port, {
      path: '/api/v1/ping?x=1',
      headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' },
    });
    assert.equal(proxied.status, 200);
    assert.equal(
      upstreamHeaders['x-forwarded-for'],
      '9.9.9.9, 203.0.113.7, 127.0.0.1',
    );
    assert.equal(upstreamHeaders.host, `127.0.0.1:${upstream.address().port}`);

    const noXff = await request(port, { path: '/api/v1/ping' });
    assert.equal(noXff.status, 200);
    assert.equal(upstreamHeaders['x-forwarded-for'], '127.0.0.1');
  } finally {
    web.close();
    upstream.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(tmp), 'ml-outside-secret.txt'), {
      force: true,
    });
  }

  assert.ok(buildCsp('<html></html>').includes("script-src 'self'"));
});

test('PH14-2: web server returns 502 when the API is down', async () => {
  const { createWebServer } = require(
    resolve(root, 'scripts/runtime/serve-web.cjs'),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html></html>');
  const web = createWebServer({ root: tmp, apiHost: '127.0.0.1', apiPort: 1 });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  try {
    const res = await request(web.address().port, { path: '/api/v1/health' });
    assert.equal(res.status, 502);
    assert.equal(res.headers['x-frame-options'], 'DENY');
  } finally {
    web.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
