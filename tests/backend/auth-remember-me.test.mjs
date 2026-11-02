import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
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
        ...(parsedUrl.pathname === '/api/v1/auth/login' ||
        parsedUrl.pathname === '/api/v1/auth/refresh' ||
        parsedUrl.pathname === '/api/v1/auth/logout'
          ? { Origin: `http://127.0.0.1:${parsedUrl.port}` }
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

    if (options.body !== undefined) {
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

function parseSetCookieHeader(setCookieRaw) {
  const raw = Array.isArray(setCookieRaw) ? setCookieRaw[0] : setCookieRaw;
  assert.ok(raw, 'Set-Cookie header must be present');
  const parts = raw.split(';').map((p) => p.trim());
  const [nameValue, ...attrs] = parts;
  const eqIdx = nameValue.indexOf('=');
  const name = nameValue.slice(0, eqIdx);
  const value = nameValue.slice(eqIdx + 1);
  const attrMap = {};
  for (const attr of attrs) {
    const [k, v] = attr.split('=');
    attrMap[k.toLowerCase()] = v === undefined ? true : v;
  }
  return { raw, name, value, cookiePair: `${name}=${value}`, attrs: attrMap };
}

async function runIsolatedHeadlessBrowserCycle(
  browserBin,
  baseUrl,
  credentials,
  rememberMe,
) {
  const tmpProfileDir = fs.mkdtempSync(
    join(os.tmpdir(), 'mgl-auth-remember-cdp-'),
  );

  const launchAndRunInBrowser = async (fn) => {
    const debugPort = 19200 + Math.floor(Math.random() * 4000);
    const proc = spawn(
      browserBin,
      [
        '--headless=new',
        `--remote-debugging-port=${debugPort}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${tmpProfileDir}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    try {
      let versionInfo = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
          if (r.ok) {
            versionInfo = await r.json();
            break;
          }
        } catch {
          // wait for CDP port
        }
      }
      assert.ok(
        versionInfo?.webSocketDebuggerUrl,
        `Browser CDP failed to start for ${browserBin}`,
      );

      let targets = [];
      for (let i = 0; i < 20; i++) {
        const listRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        targets = await listRes.json();
        if (targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      const pageTarget = targets.find(
        (t) => t.type === 'page' && t.webSocketDebuggerUrl,
      );
      assert.ok(pageTarget, 'Page target must exist');

      const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
      });

      let idCounter = 1;
      const pending = new Map();
      let onPageLoaded;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.method === 'Page.loadEventFired') onPageLoaded?.();
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      };

      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = idCounter++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });

      const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails) {
          throw new Error(
            r.exceptionDetails.text || 'Runtime.evaluate exception',
          );
        }
        return r.result?.value;
      };

      await send('Page.enable');
      await send('Runtime.enable');
      await send('Network.enable');

      // Navigate through CDP, not an evaluate promise in a context being destroyed.
      let loadTimeout;
      const pageLoaded = new Promise((res, rej) => {
        onPageLoaded = res;
        loadTimeout = setTimeout(
          () => rej(new Error('Page load timed out')),
          6000,
        );
      });
      try {
        const navigation = await send('Page.navigate', {
          url: `${baseUrl}/api/v1/health`,
        });
        assert.equal(navigation.errorText, undefined);
        await pageLoaded;
      } finally {
        clearTimeout(loadTimeout);
        onPageLoaded = undefined;
      }
      assert.equal(await evaluate('location.origin'), baseUrl);

      const result = await fn({ send, evaluate });

      // Gracefully close browser via CDP Browser.close so Chromium flushes Network/Cookies SQLite DB to disk on Windows
      const exitPromise = new Promise((r) => proc.once('exit', r));
      try {
        await send('Browser.close');
      } catch {
        // Browser may close socket immediately upon Browser.close
      }
      ws.close();
      await Promise.race([
        exitPromise,
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      return result;
    } finally {
      try {
        if (proc.exitCode === null) proc.kill();
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  try {
    // Phase 1: Login inside Browser Process #1
    const loginResult = await launchAndRunInBrowser(
      async ({ send, evaluate }) => {
        const res = await evaluate(`
        (async () => {
          const r = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              identifier: ${JSON.stringify(credentials.identifier)},
              password: ${JSON.stringify(credentials.password)},
              remember_me: ${JSON.stringify(rememberMe)}
            })
          });
          const body = await r.json();
          const meR = await fetch('/api/v1/auth/me', { credentials: 'include' });
          const meBody = await meR.json();
          return {
            loginStatus: r.status,
            rememberMeEcho: body?.data?.remember_me,
            meStatus: meR.status,
            docCookie: document.cookie
          };
        })()
      `);
        const { cookies } = await send('Network.getAllCookies');
        return { ...res, cookies };
      },
    );

    // Phase 2: Re-open a brand new Browser Process #2 with the same profile directory
    //Wait: Chromium headless only persists persistent cookies (with Expires/Max-Age) across restarts;
    // session cookies (without Expires/Max-Age) are discarded when Browser Process #1 exits!
    const reopenResult = await launchAndRunInBrowser(
      async ({ send, evaluate }) => {
        const { cookies } = await send('Network.getAllCookies');
        const meRes = await evaluate(`
        (async () => {
          const r = await fetch('/api/v1/auth/me', { credentials: 'include' });
          const body = await r.json().catch(() => null);
          return { status: r.status, success: Boolean(body?.success) };
        })()
      `);
        return { ...meRes, cookies };
      },
    );

    return { loginResult, reopenResult };
  } finally {
    try {
      fs.rmSync(tmpProfileDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error on Windows file lock delay
    }
  }
}

test('HOTFIX AUTH-REMEMBER-01: Complete TEST-01 through TEST-10 verification suite', async (t) => {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    t.skip('Live isolated test database not configured');
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
  const { executeSessionVerification, determinePostVerificationRoute } =
    await import(
      `file://${resolve(root, 'dist/apps/web/src/session-manager.js')}`
    );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    assert.equal(health.connected, true, 'Isolated test DB must be reachable');

    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    await runMigrations(pool, migrationFiles);

    const csrfSecret = 'auth_remember_01_csrf_secret_min_32_chars_long!';
    let baseUrl = '';

    const handler = createRequestHandler({
      pool,
      csrfSecret,
      allowedOrigins: [], // dynamically populated once port is bound
      isProduction: false,
    });

    // Wrap handler so allowedOrigins includes the dynamic ephemeral port
    let dynamicHandler = handler;
    const server = http.createServer((req, res) => dynamicHandler(req, res));
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    dynamicHandler = createRequestHandler({
      pool,
      csrfSecret,
      allowedOrigins: [baseUrl, 'http://localhost:3000'],
      isProduction: false,
    });

    try {
      const runToken = crypto.randomBytes(4).toString('hex');
      const wsId = crypto.randomUUID();
      const wsName = `RememberMe Store ${runToken}`;

      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [wsId, wsName],
      );

      const ownerId = crypto.randomUUID();
      const ownerUser = `rem_owner_${runToken}`;
      const ownerEmail = `rem_owner_${runToken}@test.local`;
      const ownerPw = `RemOwnerPass_${runToken}!`;
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

      // Helper fetch bound to a specific cookie jar
      const createCookieBoundFetch =
        (cookieState) =>
        async (path, init = {}) => {
          const res = await makeRequest(`${baseUrl}${path}`, {
            method: init.method || 'GET',
            headers: {
              ...(cookieState.cookie ? { Cookie: cookieState.cookie } : {}),
              ...(init.headers || {}),
            },
            body: init.body,
          });
          if (res.headers['set-cookie']) {
            const parsed = parseSetCookieHeader(res.headers['set-cookie']);
            cookieState.lastSetCookie = parsed;
            if (parsed.attrs['max-age'] === '0' || !parsed.value) {
              cookieState.cookie = '';
            } else {
              cookieState.cookie = parsed.cookiePair;
            }
          }
          return {
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            json: async () => res.body,
          };
        };

      // =========================================================================
      // TEST-01: Đăng nhập có chọn “Ghi nhớ đăng nhập” -> F5 giữ phiên
      // =========================================================================
      let rememberedCookie = null;
      let rememberedSessionId = null;

      await t.test(
        'TEST-01: Đăng nhập có chọn “Ghi nhớ đăng nhập” -> F5 giữ phiên',
        async () => {
          const loginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
            method: 'POST',
            body: {
              identifier: ownerUser,
              password: ownerPw,
              remember_me: true,
            },
          });

          assert.equal(
            loginRes.status,
            200,
            'Login with remember_me=true must return 200',
          );
          assert.equal(loginRes.body.success, true);
          assert.equal(loginRes.body.data.remember_me, true);
          assert.ok(
            loginRes.body.data.session_expires_at,
            'Must return session_expires_at',
          );

          rememberedCookie = parseSetCookieHeader(
            loginRes.headers['set-cookie'],
          );
          assert.equal(rememberedCookie.name, 'mglite_session');
          assert.equal(
            rememberedCookie.attrs['httponly'],
            true,
            'Cookie must be HttpOnly',
          );
          assert.equal(
            rememberedCookie.attrs['path'],
            '/',
            'Cookie must have Path=/',
          );
          assert.equal(
            rememberedCookie.attrs['samesite'],
            'Lax',
            'Cookie must have SameSite=Lax',
          );
          assert.equal(
            rememberedCookie.attrs['max-age'],
            '2592000',
            'Remembered cookie must have 30-day Max-Age=2592000',
          );
          assert.ok(
            rememberedCookie.attrs['expires'],
            'Remembered cookie must include explicit Expires attribute for persistent browser storage',
          );

          // Verify DB session lifetime is ~30 days
          const dbSession = await pool.query(
            `SELECT id, EXTRACT(EPOCH FROM (idle_expires_at - created_at)) AS idle_sec,
                    EXTRACT(EPOCH FROM (absolute_expires_at - created_at)) AS abs_sec
             FROM auth_sessions
             WHERE user_id = $1 AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [ownerId],
          );
          assert.equal(dbSession.rowCount, 1);
          rememberedSessionId = dbSession.rows[0].id;
          assert.ok(
            Number(dbSession.rows[0].idle_sec) >= 2591900,
            'DB idle_expires_at must be 30 days for remember_me=true',
          );
          assert.ok(
            Number(dbSession.rows[0].abs_sec) >= 2591900,
            'DB absolute_expires_at must be 30 days for remember_me=true',
          );

          // Simulate F5 page reload on "/"
          const tracker = {
            authEpoch: 0,
            verifiedOwnerSession: false,
            isLoggedIn: false,
            role: 'staff',
            csrfToken: '',
          };
          const jar = { cookie: rememberedCookie.cookiePair };
          const verified = await executeSessionVerification(
            tracker,
            createCookieBoundFetch(jar),
          );
          assert.equal(verified, true, 'F5 session verification must succeed');
          assert.equal(tracker.isLoggedIn, true);
          assert.equal(tracker.verifiedOwnerSession, true);
          assert.equal(
            determinePostVerificationRoute('/', verified),
            null,
            'F5 on "/" must keep user on "/" without redirecting to /login',
          );
        },
      );

      // =========================================================================
      // TEST-02: Đăng nhập có chọn “Ghi nhớ đăng nhập” -> mở tab mới giữ phiên
      // =========================================================================
      await t.test(
        'TEST-02: Đăng nhập có chọn “Ghi nhớ đăng nhập” -> mở tab mới giữ phiên',
        async () => {
          const newTabTracker = {
            authEpoch: 0,
            verifiedOwnerSession: false,
            isLoggedIn: false,
            role: 'staff',
            csrfToken: '',
          };
          const jar = { cookie: rememberedCookie.cookiePair };
          const verified = await executeSessionVerification(
            newTabTracker,
            createCookieBoundFetch(jar),
          );
          assert.equal(
            verified,
            true,
            'New tab must restore remembered session',
          );
          assert.equal(newTabTracker.role, 'owner');
          assert.equal(
            determinePostVerificationRoute('/employees', verified),
            null,
            'New tab opening /employees must stay on /employees',
          );
          assert.equal(
            determinePostVerificationRoute('/login', verified),
            '/',
            'New tab opening /login while remembered session is active must redirect to /',
          );
        },
      );

      // =========================================================================
      // TEST-03: Đăng nhập có chọn “Ghi nhớ đăng nhập” -> đóng và mở lại trình duyệt giữ phiên
      // =========================================================================
      await t.test(
        'TEST-03: Đăng nhập có chọn “Ghi nhớ đăng nhập” -> đóng và mở lại trình duyệt (persistent context) giữ phiên',
        async () => {
          // Simulate browser closed for 2 hours (>30m standard idle window) and reopened
          await pool.query(
            `UPDATE auth_sessions
             SET last_seen_at = now() - interval '2 hours'
             WHERE id = $1`,
            [rememberedSessionId],
          );

          const reopenTracker = {
            authEpoch: 0,
            verifiedOwnerSession: false,
            isLoggedIn: false,
            role: 'staff',
            csrfToken: '',
          };
          const jar = { cookie: rememberedCookie.cookiePair };
          const verified = await executeSessionVerification(
            reopenTracker,
            createCookieBoundFetch(jar),
          );
          assert.equal(
            verified,
            true,
            'Reopening browser after 2 hours must keep remembered session active',
          );
          assert.equal(reopenTracker.isLoggedIn, true);
        },
      );

      // =========================================================================
      // TEST-04: Đăng nhập KHÔNG chọn “Ghi nhớ đăng nhập” -> F5 giữ phiên ngắn hạn, không thành phiên dài hạn
      // =========================================================================
      await t.test(
        'TEST-04: Đăng nhập KHÔNG chọn “Ghi nhớ đăng nhập” -> F5 giữ phiên ngắn hạn, không thành phiên dài hạn',
        async () => {
          const stdLoginRes = await makeRequest(
            `${baseUrl}/api/v1/auth/login`,
            {
              method: 'POST',
              body: {
                identifier: ownerUser,
                password: ownerPw,
                remember_me: false,
              },
            },
          );

          assert.equal(stdLoginRes.status, 200);
          assert.equal(stdLoginRes.body.data.remember_me, false);

          const stdCookie = parseSetCookieHeader(
            stdLoginRes.headers['set-cookie'],
          );
          assert.equal(stdCookie.attrs['httponly'], true);
          assert.equal(
            stdCookie.attrs['max-age'],
            undefined,
            'Non-remembered login cookie must omit Max-Age (session-only cookie)',
          );
          assert.equal(
            stdCookie.attrs['expires'],
            undefined,
            'Non-remembered login cookie must omit Expires (session-only cookie)',
          );

          // Verify DB session is short-lived (30m idle, 12h absolute), NOT 30 days
          const dbStd = await pool.query(
            `SELECT id, EXTRACT(EPOCH FROM (idle_expires_at - created_at)) AS idle_sec,
                    EXTRACT(EPOCH FROM (absolute_expires_at - created_at)) AS abs_sec
             FROM auth_sessions
             WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [ownerId, rememberedSessionId],
          );
          assert.equal(dbStd.rowCount, 1);
          assert.ok(
            Number(dbStd.rows[0].idle_sec) <= 1805,
            'Non-remembered DB idle_expires_at must be 30 minutes (<=1800s)',
          );
          assert.ok(
            Number(dbStd.rows[0].abs_sec) <= 43205,
            'Non-remembered DB absolute_expires_at must be 12 hours (<=43200s)',
          );

          // F5 in active browser keeps short-term session
          const stdTracker = {
            authEpoch: 0,
            verifiedOwnerSession: false,
            isLoggedIn: false,
            role: 'staff',
            csrfToken: '',
          };
          const jar = { cookie: stdCookie.cookiePair };
          const verified = await executeSessionVerification(
            stdTracker,
            createCookieBoundFetch(jar),
          );
          assert.equal(
            verified,
            true,
            'F5 during active browser session must succeed',
          );
        },
      );

      // =========================================================================
      // TEST-05: Access token / short-term idle hết hạn nhưng phiên ghi nhớ còn hạn -> tự làm mới phiên thành công
      // =========================================================================
      await t.test(
        'TEST-05: Phiên ngắn hạn (idle_expires_at) hết hạn nhưng phiên ghi nhớ (absolute_expires_at) còn hạn -> tự làm mới phiên thành công',
        async () => {
          // Force idle_expires_at into the past while absolute_expires_at remains +29 days in the future
          await pool.query(
            `UPDATE auth_sessions
             SET idle_expires_at = now() - interval '10 minutes'
             WHERE id = $1`,
            [rememberedSessionId],
          );

          // Direct GET /api/v1/auth/me returns 401 before refresh
          const meBeforeRefresh = await makeRequest(
            `${baseUrl}/api/v1/auth/me`,
            {
              headers: { Cookie: rememberedCookie.cookiePair },
            },
          );
          assert.equal(
            meBeforeRefresh.status,
            401,
            'Direct /api/v1/auth/me must return 401 when idle_expires_at is in the past',
          );

          // executeSessionVerification automatically invokes POST /api/v1/auth/refresh and recovers the session!
          const refreshTracker = {
            authEpoch: 0,
            verifiedOwnerSession: false,
            isLoggedIn: false,
            role: 'staff',
            csrfToken: '',
          };
          const jar = { cookie: rememberedCookie.cookiePair };
          const verified = await executeSessionVerification(
            refreshTracker,
            createCookieBoundFetch(jar),
          );
          assert.equal(
            verified,
            true,
            'executeSessionVerification must transparently refresh and restore the session',
          );
          assert.equal(refreshTracker.isLoggedIn, true);
          assert.ok(
            refreshTracker.csrfToken.length > 10,
            'Refreshed session must provide valid CSRF token',
          );
          assert.ok(
            Number(jar.lastSetCookie?.attrs['max-age']) >= 2591900,
            'Refreshed remembered session must preserve 30-day persistent cookie window',
          );

          // Subsequent GET /api/v1/auth/me now returns 200 OK
          const meAfterRefresh = await makeRequest(
            `${baseUrl}/api/v1/auth/me`,
            {
              headers: { Cookie: rememberedCookie.cookiePair },
            },
          );
          assert.equal(
            meAfterRefresh.status,
            200,
            'GET /api/v1/auth/me must return 200 after refresh',
          );
        },
      );

      // =========================================================================
      // TEST-06: Phiên ghi nhớ hết hạn hoặc bị thu hồi -> chuyển về màn hình đăng nhập sạch sẽ
      // =========================================================================
      await t.test(
        'TEST-06: Phiên ghi nhớ hết hạn hoặc bị thu hồi -> chuyển về màn hình đăng nhập sạch sẽ',
        async () => {
          // Create a separate remembered session and expire its absolute_expires_at
          const expLogin = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
            method: 'POST',
            body: {
              identifier: ownerUser,
              password: ownerPw,
              remember_me: true,
            },
          });
          const expCookie = parseSetCookieHeader(
            expLogin.headers['set-cookie'],
          );

          await pool.query(
            `UPDATE auth_sessions
             SET idle_expires_at = now() - interval '1 hour',
                 absolute_expires_at = now() - interval '1 minute'
             WHERE id = (
               SELECT id FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
             )`,
            [ownerId],
          );

          const expiredTracker = {
            authEpoch: 0,
            verifiedOwnerSession: true,
            isLoggedIn: true,
            role: 'owner',
            csrfToken: 'old',
          };
          const jar = { cookie: expCookie.cookiePair };
          const verified = await executeSessionVerification(
            expiredTracker,
            createCookieBoundFetch(jar),
          );
          assert.equal(
            verified,
            false,
            'Expired absolute session must fail verification',
          );
          assert.equal(expiredTracker.isLoggedIn, false);
          assert.equal(expiredTracker.verifiedOwnerSession, false);
          assert.equal(
            jar.lastSetCookie?.attrs['max-age'],
            '0',
            'Server must clear expired cookie with Max-Age=0',
          );
          assert.equal(
            determinePostVerificationRoute('/payroll', verified),
            '/login',
            'Expired session on protected route must redirect cleanly to /login',
          );
        },
      );

      // =========================================================================
      // TEST-07: Đăng xuất -> xóa sạch phiên ghi nhớ, F5 hoặc mở lại trình duyệt không tự đăng nhập lại
      // =========================================================================
      await t.test(
        'TEST-07: Đăng xuất -> xóa sạch phiên ghi nhớ, F5 hoặc mở lại trình duyệt không tự đăng nhập lại',
        async () => {
          const meRes = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
            headers: { Cookie: rememberedCookie.cookiePair },
          });
          assert.equal(meRes.status, 200);
          const csrfToken = meRes.body.data.csrf_token;

          const logoutRes = await makeRequest(`${baseUrl}/api/v1/auth/logout`, {
            method: 'POST',
            headers: {
              Cookie: rememberedCookie.cookiePair,
              'X-CSRF-Token': csrfToken,
            },
            body: {},
          });
          assert.equal(
            logoutRes.status,
            204,
            'Logout must succeed with 204 No Content',
          );
          const clearedCookie = parseSetCookieHeader(
            logoutRes.headers['set-cookie'],
          );
          assert.equal(
            clearedCookie.attrs['max-age'],
            '0',
            'Logout must set Max-Age=0',
          );

          // Even if an attacker or stale browser replays the old rememberedCookie:
          const replayMe = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
            headers: { Cookie: rememberedCookie.cookiePair },
          });
          assert.equal(
            replayMe.status,
            401,
            'Replayed cookie after logout must return 401 on /auth/me',
          );

          const replayRefresh = await makeRequest(
            `${baseUrl}/api/v1/auth/refresh`,
            {
              method: 'POST',
              headers: { Cookie: rememberedCookie.cookiePair },
              body: {},
            },
          );
          assert.equal(
            replayRefresh.status,
            401,
            'Replayed cookie after logout must return 401 on /auth/refresh',
          );
        },
      );

      // =========================================================================
      // TEST-08: Đổi mật khẩu hoặc thu hồi phiên -> phiên ghi nhớ cũ không còn dùng được
      // =========================================================================
      await t.test(
        'TEST-08: Đổi mật khẩu hoặc thu hồi phiên -> phiên ghi nhớ cũ không còn dùng được',
        async () => {
          const loginBeforePwChange = await makeRequest(
            `${baseUrl}/api/v1/auth/login`,
            {
              method: 'POST',
              body: {
                identifier: ownerUser,
                password: ownerPw,
                remember_me: true,
              },
            },
          );
          assert.equal(loginBeforePwChange.status, 200);
          const prePwCookie = parseSetCookieHeader(
            loginBeforePwChange.headers['set-cookie'],
          );

          // Simulate password change incrementing credential_version
          await pool.query(
            `UPDATE user_credentials SET credential_version = credential_version + 1 WHERE user_id = $1`,
            [ownerId],
          );

          const meAfterPwChange = await makeRequest(
            `${baseUrl}/api/v1/auth/me`,
            {
              headers: { Cookie: prePwCookie.cookiePair },
            },
          );
          assert.equal(
            meAfterPwChange.status,
            401,
            'Remembered session must be invalidated immediately when credential_version changes',
          );

          const refreshAfterPwChange = await makeRequest(
            `${baseUrl}/api/v1/auth/refresh`,
            {
              method: 'POST',
              headers: { Cookie: prePwCookie.cookiePair },
              body: {},
            },
          );
          assert.equal(
            refreshAfterPwChange.status,
            401,
            'Refresh endpoint must also reject session when credential_version changed',
          );
        },
      );

      // =========================================================================
      // TEST-09: Kiểm tra trên ít nhất 2 trình duyệt (Google Chrome + Microsoft Edge)
      // =========================================================================
      await t.test(
        'TEST-09: Kiểm tra thực tế trên 2 trình duyệt độc lập (Google Chrome Headless + Microsoft Edge Headless)',
        async () => {
          const browsers = [
            {
              name: 'Google Chrome',
              bin: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            },
            {
              name: 'Microsoft Edge',
              bin: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            },
          ].filter((b) => fs.existsSync(b.bin));

          assert.ok(
            browsers.length >= 2,
            `Expected at least 2 browsers (Chrome + Edge), found ${browsers.length}`,
          );

          for (const browser of browsers) {
            // 1. remember_me: true -> persists across browser process close & reopen
            const rememberedRun = await runIsolatedHeadlessBrowserCycle(
              browser.bin,
              baseUrl,
              { identifier: ownerUser, password: ownerPw },
              true,
            );
            assert.equal(
              rememberedRun.loginResult.loginStatus,
              200,
              `${browser.name}: login with remember_me=true must return 200`,
            );
            assert.equal(
              rememberedRun.loginResult.rememberMeEcho,
              true,
              `${browser.name}: login response must confirm remember_me=true`,
            );
            assert.equal(
              rememberedRun.loginResult.docCookie,
              '',
              `${browser.name}: document.cookie must NOT expose HttpOnly mglite_session`,
            );
            const persistentCookie = rememberedRun.loginResult.cookies.find(
              (c) => c.name === 'mglite_session',
            );
            assert.ok(
              persistentCookie &&
                persistentCookie.httpOnly &&
                !persistentCookie.session,
              `${browser.name}: mglite_session must be stored as a non-session persistent HttpOnly cookie`,
            );
            assert.equal(
              rememberedRun.reopenResult.status,
              200,
              `${browser.name}: reopening browser with persistent profile must restore session (200 OK)`,
            );
            assert.equal(rememberedRun.reopenResult.success, true);

            // 2. remember_me: false -> stored as session-only cookie (session=true in CDP)
            const sessionOnlyRun = await runIsolatedHeadlessBrowserCycle(
              browser.bin,
              baseUrl,
              { identifier: ownerUser, password: ownerPw },
              false,
            );
            const sessionCookie = sessionOnlyRun.loginResult.cookies.find(
              (c) => c.name === 'mglite_session',
            );
            assert.ok(
              sessionCookie &&
                sessionCookie.httpOnly &&
                sessionCookie.session === true,
              `${browser.name}: remember_me=false must produce a session-only cookie (session=true)`,
            );
          }
        },
      );

      // =========================================================================
      // TEST-10: Regression toàn bộ AUTH và RBAC hiện có
      // =========================================================================
      await t.test(
        'Remember Me configured at 24 hours persists explicit intent through me and refresh',
        async () => {
          const previous = process.env.SESSION_REMEMBER_MAX_AGE_SECONDS;
          process.env.SESSION_REMEMBER_MAX_AGE_SECONDS = '86400';
          try {
            const login = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
              method: 'POST',
              body: {
                identifier: ownerUser,
                password: ownerPw,
                remember_me: true,
              },
            });
            assert.equal(login.status, 200);
            const cookie = parseSetCookieHeader(login.headers['set-cookie']);
            assert.equal(cookie.attrs['max-age'], '86400');
            const { hashToken } = await import(
              `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
            );
            const tokenHash = hashToken(cookie.value);
            const read = async () =>
              (
                await pool.query(
                  'SELECT remember_me, created_at, idle_expires_at, absolute_expires_at FROM auth_sessions WHERE session_token_hash=$1',
                  [tokenHash],
                )
              ).rows[0];
            const issued = await read();
            assert.equal(issued.remember_me, true);
            assert.equal(
              issued.absolute_expires_at - issued.created_at,
              86400 * 1000,
            );
            const me = await makeRequest(`${baseUrl}/api/v1/auth/me`, {
              headers: { Cookie: cookie.cookiePair },
            });
            assert.equal(me.status, 200);
            assert.equal(me.body.data.remember_me, true);
            assert.deepEqual(
              (await read()).idle_expires_at,
              issued.absolute_expires_at,
            );
            await pool.query(
              "UPDATE auth_sessions SET idle_expires_at=now()-interval '1 minute' WHERE session_token_hash=$1",
              [tokenHash],
            );
            const refreshed = await makeRequest(
              `${baseUrl}/api/v1/auth/refresh`,
              { method: 'POST', headers: { Cookie: cookie.cookiePair } },
            );
            assert.equal(refreshed.status, 200);
            assert.equal(refreshed.body.data.remember_me, true);
            assert.ok(
              Number(
                parseSetCookieHeader(refreshed.headers['set-cookie']).attrs[
                  'max-age'
                ],
              ) <= 86400,
            );
            assert.deepEqual(
              (await read()).absolute_expires_at,
              issued.absolute_expires_at,
            );
          } finally {
            if (previous === undefined)
              delete process.env.SESSION_REMEMBER_MAX_AGE_SECONDS;
            else process.env.SESSION_REMEMBER_MAX_AGE_SECONDS = previous;
          }
        },
      );
      await t.test(
        'Legacy session returns 401 without mutation; fresh login restores explicit standard or remembered intent',
        async () => {
          const { hashToken } = await import(
            `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
          );
          for (const rememberMe of [false, true]) {
            const login = async () => {
              const response = await makeRequest(
                `${baseUrl}/api/v1/auth/login`,
                {
                  method: 'POST',
                  body: {
                    identifier: ownerUser,
                    password: ownerPw,
                    remember_me: rememberMe,
                  },
                },
              );
              assert.equal(response.status, 200);
              return parseSetCookieHeader(response.headers['set-cookie']);
            };
            const legacyCookie = await login();
            const legacyHash = hashToken(legacyCookie.value);
            await pool.query(
              'UPDATE auth_sessions SET remember_me=NULL WHERE session_token_hash=$1',
              [legacyHash],
            );
            const snapshot = async () =>
              (
                await pool.query(
                  'SELECT id, workspace_id, user_id, credential_version_at_issue, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, remember_me FROM auth_sessions WHERE session_token_hash=$1',
                  [legacyHash],
                )
              ).rows[0];
            const before = await snapshot();
            for (const [path, method] of [
              ['me', 'GET'],
              ['refresh', 'POST'],
            ]) {
              const response = await makeRequest(
                `${baseUrl}/api/v1/auth/${path}`,
                { method, headers: { Cookie: legacyCookie.cookiePair } },
              );
              assert.equal(response.status, 401);
              if (path === 'refresh')
                assert.equal(
                  parseSetCookieHeader(response.headers['set-cookie']).attrs[
                    'max-age'
                  ],
                  '0',
                );
              assert.deepEqual(await snapshot(), before);
            }
            const freshCookie = await login();
            const fresh = (
              await pool.query(
                'SELECT id, remember_me FROM auth_sessions WHERE session_token_hash=$1',
                [hashToken(freshCookie.value)],
              )
            ).rows[0];
            assert.notEqual(fresh.id, before.id);
            assert.equal(fresh.remember_me, rememberMe);
            assert.equal(
              freshCookie.attrs['max-age'] !== undefined,
              rememberMe,
            );
            for (const [path, method] of [
              ['me', 'GET'],
              ['refresh', 'POST'],
            ]) {
              const response = await makeRequest(
                `${baseUrl}/api/v1/auth/${path}`,
                { method, headers: { Cookie: freshCookie.cookiePair } },
              );
              assert.equal(response.status, 200);
              assert.equal(response.body.data.remember_me, rememberMe);
            }
            assert.deepEqual(
              await snapshot(),
              before,
              'Fresh login must not rewrite the legacy record',
            );
          }
        },
      );
      await t.test(
        'TEST-10: Regression AUTH, Origin enforcement, và RBAC (Owner vs Staff)',
        async () => {
          // 1. Untrusted Origin on /api/v1/auth/refresh must be rejected with 403
          const badOriginRefresh = await makeRequest(
            `${baseUrl}/api/v1/auth/refresh`,
            {
              method: 'POST',
              headers: { Origin: 'https://evil.example.com' },
              body: {},
            },
          );
          assert.equal(
            badOriginRefresh.status,
            403,
            'Cross-origin POST /api/v1/auth/refresh must be blocked with 403 FORBIDDEN',
          );

          // 2. Reject unknown fields on /api/v1/auth/login
          const extraFieldLogin = await makeRequest(
            `${baseUrl}/api/v1/auth/login`,
            {
              method: 'POST',
              body: {
                identifier: ownerUser,
                password: ownerPw,
                remember_me: true,
                evil_field: 'inject',
              },
            },
          );
          assert.equal(
            extraFieldLogin.status,
            400,
            'Unknown fields on login must be rejected with 400',
          );

          // 3. Reject non-boolean remember_me on /api/v1/auth/login
          const nonBoolLogin = await makeRequest(
            `${baseUrl}/api/v1/auth/login`,
            {
              method: 'POST',
              body: {
                identifier: ownerUser,
                password: ownerPw,
                remember_me: 'yes-please',
              },
            },
          );
          assert.equal(
            nonBoolLogin.status,
            400,
            'Non-boolean remember_me must be rejected with 400',
          );
        },
      );
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
