import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import {
  WebCustomerService,
  sanitizeSignupLanding,
  sanitizeSignupRef,
  sanitizeSignupUtm,
} from '../../dist/apps/api/src/web-customers/service.js';
import {
  getCustomerCookieName,
  serializeCustomerCookie,
} from '../../dist/apps/api/src/web-customers/guard.js';
import { AuthService } from '../../dist/apps/api/src/auth/service.js';
import { serializeSessionCookie } from '../../dist/apps/api/src/cookie.js';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';

const TEST_CLIENT_ID =
  '980505397989-test-gcn-customer.apps.googleusercontent.com';
const TEST_CSRF_SECRET = 'gcn_cust_02a_test_csrf_secret_at_least_32_bytes_long';
const TEST_PROXY_SECRET =
  'gcn_cust_02a_test_proxy_secret_at_least_32_bytes_hex';
const TEST_POLICY_VERSION = '2026-04-01';
const ALLOWED_ORIGIN = 'https://hoaiphuong.click';
const EVIL_ORIGIN = 'https://evil-attacker.example';

// Ephemeral RS256 keypairs for offline Google ID token verification (ZERO live Google calls)
const { privateKey: TRUSTED_PRIVATE_KEY, publicKey: TRUSTED_PUBLIC_KEY } =
  crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: ROGUE_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function signTestIdToken(claims, signingKey = TRUSTED_PRIVATE_KEY) {
  const header = base64UrlEncode(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key-1' }),
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iss: 'https://accounts.google.com',
    aud: TEST_CLIENT_ID,
    exp: nowSec + 3600,
    iat: nowSec,
    sub: 'google-sub-default-001',
    email: 'KhachHang.Test@Example.COM',
    email_verified: true,
    name: 'Nguyễn Văn Khách',
    picture: 'https://lh3.googleusercontent.com/a/avatar-test',
    ...claims,
  };
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${header}.${body}`;
  const sig = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), signingKey)
    .toString('base64url');
  return `${signingInput}.${sig}`;
}

/**
 * Cryptographic RS256 offline ID token verifier mirroring OAuth2Client.verifyIdToken
 * using the ephemeral test public key (never calls live Google endpoints).
 */
async function verifyTestRs256IdToken(idToken, expectedAudience) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(
    Buffer.from(headerB64, 'base64url').toString('utf8'),
  );
  if (header.alg !== 'RS256') {
    throw new Error('Unsupported alg');
  }
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
    TRUSTED_PUBLIC_KEY,
    Buffer.from(sigB64, 'base64url'),
  );
  if (!verified) {
    throw new Error('Invalid RSA signature');
  }
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8'),
  );
  if (payload.aud !== expectedAudience) {
    throw new Error('Wrong audience');
  }
  return payload;
}

function extractCookiePair(setCookieHeader, cookieName) {
  if (!setCookieHeader) return null;
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];
  for (const item of list) {
    const firstPart = item.split(';')[0]?.trim() ?? '';
    if (firstPart.startsWith(`${cookieName}=`)) {
      return firstPart;
    }
  }
  return null;
}

async function startEphemeralServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function httpJson(baseUrl, path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  let body;
  if (options.body !== undefined) {
    if (typeof options.body === 'string') {
      body = options.body;
    } else {
      body = JSON.stringify(options.body);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
    }
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    headers: res.headers,
    setCookie: res.headers.get('set-cookie'),
    json,
    raw: text,
  };
}

/**
 * Lightweight in-memory mock DB pool supporting WebCustomerService queries so all
 * unit/security tests execute offline inside `npm run verify` even without PostgreSQL.
 */
function createInMemoryCustomerPool(workspaceId) {
  const workspaces = new Map([
    [workspaceId, { id: workspaceId, status: 'active' }],
  ]);
  const customers = new Map(); // id -> row
  const sessions = new Map(); // id -> row
  const audits = [];

  async function runQuery(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith('SELECT id FROM workspaces WHERE id = $1')) {
      const ws = workspaces.get(params[0]);
      return { rows: ws ? [{ id: ws.id }] : [], rowCount: ws ? 1 : 0 };
    }
    if (q.startsWith('SELECT id FROM workspaces WHERE status')) {
      const first = [...workspaces.values()][0];
      return { rows: first ? [{ id: first.id }] : [], rowCount: first ? 1 : 0 };
    }
    if (
      q.includes(
        'FROM web_customers WHERE workspace_id = $1 AND google_sub = $2',
      )
    ) {
      const match = [...customers.values()].find(
        (c) => c.workspace_id === params[0] && c.google_sub === params[1],
      );
      return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
    }
    if (q.startsWith('INSERT INTO web_customers')) {
      const now = new Date();
      const row = {
        id: crypto.randomUUID(),
        workspace_id: params[0],
        google_sub: params[1],
        email_normalized: params[2],
        display_name: params[3],
        avatar_url: params[4],
        status: 'active',
        consent_version: params[5],
        consent_at: now,
        signup_ref: params[6],
        signup_utm: JSON.parse(params[7]),
        signup_landing: params[8],
        created_at: now,
        updated_at: now,
        last_login_at: now,
      };
      customers.set(row.id, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (q.startsWith('UPDATE web_customers SET email_normalized')) {
      const existing = customers.get(params[3]);
      if (!existing) return { rows: [], rowCount: 0 };
      existing.email_normalized = params[0];
      existing.display_name = params[1];
      existing.avatar_url = params[2];
      existing.updated_at = new Date();
      existing.last_login_at = new Date();
      return { rows: [{ ...existing }], rowCount: 1 };
    }
    if (q.startsWith('INSERT INTO web_customer_sessions')) {
      const now = new Date();
      const row = {
        id: crypto.randomUUID(),
        customer_id: params[0],
        token_hash: params[1],
        expires_at: params[2],
        revoked_at: null,
        created_ip: params[3],
        user_agent: params[4],
        created_at: now,
        last_seen_at: now,
      };
      sessions.set(row.id, row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (q.startsWith('INSERT INTO audit_events')) {
      const entry = {
        id: crypto.randomUUID(),
        workspace_id: params[0],
        actor_user_id: params[1],
        action: params[2],
        entity_type: params[3],
        entity_id: params[4],
        request_id: params[5],
        metadata_sanitized: JSON.parse(params[6]),
      };
      audits.push(entry);
      return { rows: [{ id: entry.id }], rowCount: 1 };
    }
    if (q.includes('FROM web_customer_sessions s INNER JOIN web_customers c')) {
      const tokenHash = params[0];
      const wsFilter = params[1];
      const session = [...sessions.values()].find(
        (s) => s.token_hash === tokenHash,
      );
      if (!session) return { rows: [], rowCount: 0 };
      const cust = customers.get(session.customer_id);
      if (!cust) return { rows: [], rowCount: 0 };
      if (wsFilter && cust.workspace_id !== wsFilter) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            ...cust,
            session_id: session.id,
            expires_at: session.expires_at,
            revoked_at: session.revoked_at,
            last_seen_at: session.last_seen_at,
          },
        ],
        rowCount: 1,
      };
    }
    if (q.startsWith('UPDATE web_customer_sessions SET last_seen_at')) {
      const s = sessions.get(params[0]);
      if (s && s.revoked_at === null) {
        s.last_seen_at = new Date();
        s.expires_at = params[1];
      }
      return { rows: [], rowCount: s ? 1 : 0 };
    }
    if (q.startsWith('UPDATE web_customer_sessions SET revoked_at = NOW()')) {
      const s = sessions.get(params[0]);
      if (s && s.customer_id === params[1] && s.revoked_at === null) {
        s.revoked_at = new Date();
      }
      return { rows: [], rowCount: s ? 1 : 0 };
    }
    if (
      q.startsWith('SELECT') &&
      q.includes('FROM web_customers WHERE id = $1 AND workspace_id = $2')
    ) {
      const c = customers.get(params[0]);
      if (!c || c.workspace_id !== params[1] || c.status !== 'active') {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ ...c }], rowCount: 1 };
    }
    if (
      q.startsWith('SELECT') &&
      q.includes('FROM web_customer_sessions WHERE customer_id = $1')
    ) {
      const list = [...sessions.values()]
        .filter((s) => s.customer_id === params[0] && s.revoked_at === null)
        .map((s) => ({
          id: s.id,
          created_at: s.created_at,
          last_seen_at: s.last_seen_at,
          expires_at: s.expires_at,
          created_ip: s.created_ip,
          user_agent: s.user_agent,
        }));
      return { rows: list, rowCount: list.length };
    }
    if (
      q.startsWith(
        'DELETE FROM web_customers WHERE id = $1 AND workspace_id = $2',
      )
    ) {
      const c = customers.get(params[0]);
      if (!c || c.workspace_id !== params[1]) {
        return { rows: [], rowCount: 0 };
      }
      customers.delete(params[0]);
      // Emulate ON DELETE CASCADE on web_customer_sessions
      for (const [sid, s] of sessions.entries()) {
        if (s.customer_id === params[0]) sessions.delete(sid);
      }
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    // Staff auth_sessions lookup returns empty (proves customer token not in staff sessions)
    return { rows: [], rowCount: 0 };
  }

  return {
    customers,
    sessions,
    audits,
    query: runQuery,
    connect: async () => ({
      query: runQuery,
      release: () => {},
    }),
    end: async () => {},
  };
}

// ============================================================================
// PART A: OFFLINE DETERMINISTIC UNIT + HTTP SECURITY SUITE (ALWAYS RUNS)
// ============================================================================

test('GCN-CUST-02A [Unit]: ref/utm/landing sanitization strips invalid chars, overlong values, and >5 utm keys', () => {
  assert.equal(sanitizeSignupRef('partner_01-abc.2026'), 'partner_01-abc.2026');
  assert.equal(sanitizeSignupRef('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(sanitizeSignupRef('a'.repeat(65)), null);
  assert.equal(sanitizeSignupRef('bad<script>alert(1)</script>'), null);
  assert.equal(sanitizeSignupRef('has space'), null);
  assert.equal(sanitizeSignupRef('tiếng-việt'), null);
  assert.equal(sanitizeSignupRef(12345), null);

  const utm = sanitizeSignupUtm({
    utm_source: 'facebook',
    utm_medium: 'cpc-2026',
    utm_campaign: 'tet_sale.01',
    utm_term: 'valid_term',
    utm_content: 'banner_1',
    utm_extra6: 'dropped_over_5',
    not_utm: 'dropped_prefix',
    utm_bad_val: 'bad value with space!',
    utm_too_long: 'x'.repeat(65),
  });
  assert.deepEqual(utm, {
    utm_source: 'facebook',
    utm_medium: 'cpc-2026',
    utm_campaign: 'tet_sale.01',
    utm_term: 'valid_term',
    utm_content: 'banner_1',
  });
  assert.equal(Object.keys(utm).length, 5);

  assert.equal(sanitizeSignupLanding('/cong-cu/bao-gia'), '/cong-cu/bao-gia');
  assert.equal(
    sanitizeSignupLanding('https://hoaiphuong.click/huong-dan'),
    'https://hoaiphuong.click/huong-dan',
  );
  assert.equal(sanitizeSignupLanding('javascript:alert(1)'), null);
  assert.equal(sanitizeSignupLanding('http://insecure.example/x'), null);
  assert.equal(sanitizeSignupLanding('/bad<script>'), null);
});

test('GCN-CUST-02A [HTTP Offline]: full security matrix (realm isolation, RS256 token checks, consent, block, CSRF, X-GCN-Client-IP, rate limit, delete, prod 503)', async (t) => {
  const workspaceId = crypto.randomUUID();
  const mockPool = createInMemoryCustomerPool(workspaceId);

  // Mock staff AuthService that ONLY recognizes a single valid staff token
  const validStaffToken = 'staff_only_token_'.padEnd(64, 'a');
  const mockStaffAuthService = {
    resolveSession: async (token) => {
      if (token !== validStaffToken) return null;
      return {
        sessionId: crypto.randomUUID(),
        sessionTokenHash: crypto
          .createHash('sha256')
          .update(validStaffToken)
          .digest('hex'),
        user: {
          id: crypto.randomUUID(),
          username: 'staff_qa',
          email: 'staff@hoaiphuong.click',
          full_name: 'Staff QA',
          status: 'active',
        },
        workspace: {
          id: workspaceId,
          name: 'Gà Công Nghệ',
          role: 'owner',
          permissions: [],
        },
      };
    },
  };

  const webCustomerService = new WebCustomerService(
    mockPool,
    TEST_CSRF_SECRET,
    {
      googleClientId: TEST_CLIENT_ID,
      publicCustomerWorkspaceId: workspaceId,
      privacyPolicyVersion: TEST_POLICY_VERSION,
      isProduction: false,
      idTokenVerifier: verifyTestRs256IdToken,
    },
  );

  const handler = createRequestHandler({
    pool: mockPool,
    authService: mockStaffAuthService,
    webCustomerService,
    csrfSecret: TEST_CSRF_SECRET,
    allowedOrigins: [ALLOWED_ORIGIN],
    trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    isProduction: false,
    gcnProxySecret: TEST_PROXY_SECRET,
  });

  const srv = await startEphemeralServer(handler);
  t.after(() => srv.close());

  // 1. Invalid Google ID tokens -> 401
  const badTokenCases = [
    [
      'wrong audience',
      signTestIdToken({ aud: 'other-client.apps.googleusercontent.com' }),
    ],
    [
      'expired token',
      signTestIdToken({ exp: Math.floor(Date.now() / 1000) - 60 }),
    ],
    ['wrong issuer', signTestIdToken({ iss: 'https://evil-idp.example' })],
    ['email_verified=false', signTestIdToken({ email_verified: false })],
    ['bad signature (rogue key)', signTestIdToken({}, ROGUE_PRIVATE_KEY)],
  ];
  for (const [label, token] of badTokenCases) {
    const res = await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN },
      body: { credential: token, consent: true },
    });
    assert.equal(
      res.status,
      401,
      `Expected 401 for ${label}, got ${res.status}`,
    );
    assert.equal(res.json?.success, false);
  }

  // 2. Origin & Content-Type & assertAllowedFields enforcement on /auth/google
  const foreignOriginLogin = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: { origin: EVIL_ORIGIN },
      body: { credential: signTestIdToken({}), consent: true },
    },
  );
  assert.equal(foreignOriginLogin.status, 403);

  const nonJsonLogin = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'text/plain' },
      body: JSON.stringify({ credential: signTestIdToken({}), consent: true }),
    },
  );
  assert.equal(nonJsonLogin.status, 415);

  const extraFieldLogin = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN },
      body: {
        credential: signTestIdToken({}),
        consent: true,
        role: 'owner',
      },
    },
  );
  assert.equal(extraFieldLogin.status, 400);

  // 3. New customer missing consent -> 400 CONSENT_REQUIRED
  const validToken1 = signTestIdToken({
    sub: 'sub-cust-001',
    email: 'Minh.Khach@Example.VN',
    name: 'Trần Minh Khách',
  });
  const noConsentRes = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN },
      body: { credential: validToken1 },
    },
  );
  assert.equal(noConsentRes.status, 400);
  assert.equal(noConsentRes.json?.error?.code, 'CONSENT_REQUIRED');

  // 4. New customer WITH consent + mixed valid/invalid ref/utm + wrong X-GCN-Proxy-Secret
  const signupRes = await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
    method: 'POST',
    headers: {
      origin: ALLOWED_ORIGIN,
      'x-gcn-client-ip': '203.0.113.99',
      'x-gcn-proxy-secret': 'wrong-secret',
    },
    body: {
      credential: validToken1,
      consent: true,
      ref: 'affiliate_01',
      utm: {
        utm_source: 'youtube',
        utm_medium: 'video',
        utm_bad: 'invalid space<>',
        utm_long: 'z'.repeat(65),
        non_utm_key: 'dropped',
      },
      landing: '/cong-cu/tao-qr',
    },
  });
  assert.equal(signupRes.status, 200);
  assert.equal(signupRes.json?.success, true);
  assert.equal(signupRes.json.data.customer.email, 'minh.khach@example.vn');
  assert.equal(
    signupRes.json.data.customer.consent_version,
    TEST_POLICY_VERSION,
  );
  assert.ok(signupRes.json.data.customer.consent_at);
  assert.equal(signupRes.json.data.customer.signup_ref, 'affiliate_01');
  assert.deepEqual(signupRes.json.data.customer.signup_utm, {
    utm_source: 'youtube',
    utm_medium: 'video',
  });
  assert.equal(signupRes.json.data.customer.signup_landing, '/cong-cu/tao-qr');
  assert.ok(signupRes.json.data.csrf_token);

  const customerCookie = extractCookiePair(signupRes.setCookie, 'gcn_customer');
  assert.ok(customerCookie, 'Must set gcn_customer cookie in dev/test');
  assert.match(signupRes.setCookie, /HttpOnly/i);
  assert.match(signupRes.setCookie, /SameSite=Lax/i);
  assert.match(signupRes.setCookie, /Path=\//i);
  assert.match(signupRes.setCookie, /Max-Age=2592000/i);

  // Verify X-GCN-Client-IP was IGNORED because X-GCN-Proxy-Secret was wrong
  const createdSession = [...mockPool.sessions.values()][0];
  assert.notEqual(
    createdSession.created_ip,
    '203.0.113.99',
    'Spoofed X-GCN-Client-IP must be ignored when proxy secret is wrong',
  );

  // 5. Customer cookie calling internal staff endpoints -> 401
  const staffEndpoints = [
    '/api/v1/accounts',
    '/api/v1/employees',
    '/api/v1/payroll/periods',
    '/api/v1/fin/summary',
    '/api/v1/auth/me',
  ];
  for (const ep of staffEndpoints) {
    const res = await httpJson(srv.baseUrl, ep, {
      headers: { cookie: customerCookie },
    });
    assert.equal(
      res.status,
      401,
      `Customer cookie must get 401 on internal endpoint ${ep}, got ${res.status}`,
    );
  }

  // 6. Staff cookie calling public customer endpoints -> 401
  const staffCookie = serializeSessionCookie(validStaffToken, {
    isProduction: false,
  }).split(';')[0];
  const staffOnPublicMe = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/me',
    {
      headers: { cookie: staffCookie },
    },
  );
  assert.equal(staffOnPublicMe.status, 401);

  const staffOnPublicDelete = await httpJson(
    srv.baseUrl,
    '/api/v1/public/account',
    {
      method: 'DELETE',
      headers: {
        cookie: staffCookie,
        origin: ALLOWED_ORIGIN,
        'x-csrf-token': signupRes.json.data.csrf_token,
      },
    },
  );
  assert.equal(staffOnPublicDelete.status, 401);

  // 7. Customer GET /auth/me & GET /account/export work with customer cookie
  const meRes = await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
    headers: { cookie: customerCookie, origin: ALLOWED_ORIGIN },
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.json.data.customer.id, signupRes.json.data.customer.id);
  const csrfToken = meRes.json.data.csrf_token;

  const exportRes = await httpJson(
    srv.baseUrl,
    '/api/v1/public/account/export',
    {
      headers: { cookie: customerCookie },
    },
  );
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.json.data.customer.email, 'minh.khach@example.vn');
  assert.equal(exportRes.raw.includes('token_hash'), false);

  // 8. Missing/wrong CSRF or foreign Origin on mutating public routes -> 403
  const noCsrfLogout = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/logout',
    {
      method: 'POST',
      headers: { cookie: customerCookie, origin: ALLOWED_ORIGIN },
    },
  );
  assert.equal(noCsrfLogout.status, 403);

  const badCsrfDelete = await httpJson(srv.baseUrl, '/api/v1/public/account', {
    method: 'DELETE',
    headers: {
      cookie: customerCookie,
      origin: ALLOWED_ORIGIN,
      'x-csrf-token': '0'.repeat(64),
    },
  });
  assert.equal(badCsrfDelete.status, 403);

  const evilOriginDelete = await httpJson(
    srv.baseUrl,
    '/api/v1/public/account',
    {
      method: 'DELETE',
      headers: {
        cookie: customerCookie,
        origin: EVIL_ORIGIN,
        'x-csrf-token': csrfToken,
      },
    },
  );
  assert.equal(evilOriginDelete.status, 403);

  // 9. Blocked customer: existing session immediately 401 + cannot re-login (403, no new session)
  const customerId = signupRes.json.data.customer.id;
  mockPool.customers.get(customerId).status = 'blocked';

  const blockedMe = await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
    headers: { cookie: customerCookie },
  });
  assert.equal(blockedMe.status, 401);

  const sessionsBeforeBlockedLogin = mockPool.sessions.size;
  const blockedLogin = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN },
      body: { credential: validToken1 },
    },
  );
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.json?.error?.code, 'CUSTOMER_BLOCKED');
  assert.equal(mockPool.sessions.size, sessionsBeforeBlockedLogin);
  assert.ok(
    mockPool.audits.some((a) => a.action === 'web_customer.login_blocked'),
  );

  // Unblock and verify trusted X-GCN-Proxy-Secret honors X-GCN-Client-IP
  mockPool.customers.get(customerId).status = 'active';
  const trustedProxyLogin = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: {
        origin: ALLOWED_ORIGIN,
        'x-gcn-client-ip': '198.51.100.42',
        'x-gcn-proxy-secret': TEST_PROXY_SECRET,
      },
      body: { credential: validToken1 },
    },
  );
  assert.equal(trustedProxyLogin.status, 200);
  const newestSession = [...mockPool.sessions.values()].at(-1);
  assert.equal(newestSession.created_ip, '198.51.100.42');

  const activeCookie2 = extractCookiePair(
    trustedProxyLogin.setCookie,
    'gcn_customer',
  );
  const activeCsrf2 = trustedProxyLogin.json.data.csrf_token;

  // 9b. POST /api/v1/public/auth/logout revokes session & clears cookie
  const logoutRes = await httpJson(srv.baseUrl, '/api/v1/public/auth/logout', {
    method: 'POST',
    headers: {
      cookie: activeCookie2,
      origin: ALLOWED_ORIGIN,
      'x-csrf-token': activeCsrf2,
    },
  });
  assert.equal(logoutRes.status, 200);
  assert.equal(logoutRes.json?.data?.logged_out, true);
  assert.match(logoutRes.setCookie ?? '', /Max-Age=0/i);
  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
        headers: { cookie: activeCookie2 },
      })
    ).status,
    401,
  );

  // Re-login to test DELETE /account rate limit (3/hr/customer) and deletion
  const reloginBeforeDelete = await httpJson(
    srv.baseUrl,
    '/api/v1/public/auth/google',
    {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN },
      body: { credential: validToken1 },
    },
  );
  assert.equal(reloginBeforeDelete.status, 200);
  const activeCookie3 = extractCookiePair(
    reloginBeforeDelete.setCookie,
    'gcn_customer',
  );
  const activeCsrf3 = reloginBeforeDelete.json.data.csrf_token;

  // Verify DELETE /account rate limit (3/hour/customer): after 3 attempts, 4th returns 429
  for (let i = 0; i < 3; i++) {
    assert.equal(
      webCustomerService.deleteAccountLimiter.increment(customerId).allowed,
      true,
    );
  }
  const deleteRateLimited = await httpJson(
    srv.baseUrl,
    '/api/v1/public/account',
    {
      method: 'DELETE',
      headers: {
        cookie: activeCookie3,
        origin: ALLOWED_ORIGIN,
        'x-csrf-token': activeCsrf3,
      },
    },
  );
  assert.equal(deleteRateLimited.status, 429);
  assert.equal(deleteRateLimited.json?.error?.code, 'RATE_LIMITED');
  assert.ok(deleteRateLimited.headers.get('retry-after'));

  // Reset limiter for actual DELETE /account verification
  webCustomerService.deleteAccountLimiter.reset(customerId);

  // 10. DELETE /api/v1/public/account: deletes row + cascades sessions + audit has ID only (NO email)
  const deleteRes = await httpJson(srv.baseUrl, '/api/v1/public/account', {
    method: 'DELETE',
    headers: {
      cookie: activeCookie3,
      origin: ALLOWED_ORIGIN,
      'x-csrf-token': activeCsrf3,
    },
  });
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.json?.data?.deleted, true);
  assert.equal(mockPool.customers.has(customerId), false);
  assert.equal(mockPool.sessions.size, 0);

  const afterDeleteMe = await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
    headers: { cookie: activeCookie3 },
  });
  assert.equal(afterDeleteMe.status, 401);

  const deletedAudit = mockPool.audits.find(
    (a) => a.action === 'web_customer.deleted',
  );
  assert.ok(deletedAudit);
  assert.equal(deletedAudit.entity_id, customerId);
  assert.equal(
    JSON.stringify(deletedAudit.metadata_sanitized).includes('minh.khach'),
    false,
    'web_customer.deleted audit must NEVER contain customer email',
  );
  assert.deepEqual(deletedAudit.metadata_sanitized, {
    customer_id: customerId,
  });

  // 11. Rate limit: 20 requests / 15m per IP -> #21 returns 429
  for (let i = 0; i < 20; i++) {
    const r = await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
      method: 'POST',
      headers: {
        origin: ALLOWED_ORIGIN,
        'x-gcn-client-ip': '198.51.100.77',
        'x-gcn-proxy-secret': TEST_PROXY_SECRET,
      },
      body: { credential: 'not-a-valid-jwt' },
    });
    assert.equal(
      r.status,
      401,
      `Attempt ${i + 1} should hit 401 before rate limit`,
    );
  }
  const rl21 = await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
    method: 'POST',
    headers: {
      origin: ALLOWED_ORIGIN,
      'x-gcn-client-ip': '198.51.100.77',
      'x-gcn-proxy-secret': TEST_PROXY_SECRET,
    },
    body: { credential: 'not-a-valid-jwt' },
  });
  assert.equal(rl21.status, 429);
  assert.equal(rl21.json?.error?.code, 'RATE_LIMITED');

  // 12. Production fail-closed when PUBLIC_CUSTOMER_WORKSPACE_ID is missing -> 503
  assert.equal(getCustomerCookieName(true), '__Host-gcn_customer');
  const prodCookieStr = serializeCustomerCookie('tok_abc', true);
  assert.match(prodCookieStr, /^__Host-gcn_customer=/);
  assert.match(prodCookieStr, /Secure/);
  assert.match(prodCookieStr, /HttpOnly/);
  assert.match(prodCookieStr, /SameSite=Lax/);
  assert.match(prodCookieStr, /Path=\//);

  const prodMissingWsService = new WebCustomerService(
    mockPool,
    TEST_CSRF_SECRET,
    {
      googleClientId: TEST_CLIENT_ID,
      publicCustomerWorkspaceId: undefined,
      isProduction: true,
      idTokenVerifier: verifyTestRs256IdToken,
    },
  );
  const prodSrv = await startEphemeralServer(
    createRequestHandler({
      pool: mockPool,
      webCustomerService: prodMissingWsService,
      csrfSecret: TEST_CSRF_SECRET,
      allowedOrigins: [ALLOWED_ORIGIN],
      isProduction: true,
    }),
  );
  t.after(() => prodSrv.close());

  const prod503 = await httpJson(prodSrv.baseUrl, '/api/v1/public/auth/me');
  assert.equal(prod503.status, 503);
  assert.equal(prod503.json?.error?.code, 'SERVICE_UNAVAILABLE');
});

// ============================================================================
// PART B: REAL ISOLATED POSTGRESQL INTEGRATION SUITE (RUNS WHEN TEST_DATABASE_URL IS SET)
// ============================================================================

test('GCN-CUST-02A [PostgreSQL Isolated]: idempotent migrations, real tables, cross-realm cookie isolation, sliding renewal, cascade delete & audit verification', async (t) => {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.CONFIRM_ISOLATED_TEST_DB !== 'true'
  ) {
    t.skip(
      'Requires isolated PostgreSQL TEST_DATABASE_URL + CONFIRM_ISOLATED_TEST_DB=true',
    );
    return;
  }

  const dbConfig = loadTestDatabaseConfig(process.env);
  assertSafeTestDatabase(dbConfig, process.env);
  const pool = createDatabasePool(dbConfig);
  t.after(() => pool.end());

  // 1. Run migrations TWICE consecutively -> must be idempotent without errors
  const migrations = loadMigrationFiles('packages/database/src/migrations');
  await runMigrations(pool, migrations);
  const secondRun = await runMigrations(pool, migrations);
  assert.equal(secondRun.appliedCount, 0);
  assert.ok(migrations.some((m) => m.id === '0044_web_customers'));

  // 2. Seed isolated workspace + real internal staff account & session
  const workspaceId = crypto.randomUUID();
  const staffUserId = crypto.randomUUID();
  const staffEmail = `staff-gcn-${staffUserId.slice(0, 8)}@isolated.test`;
  const staffPassword = `StaffIso_${crypto.randomBytes(8).toString('hex')}!9A`;
  await pool.query(
    `INSERT INTO workspaces (id, name, status) VALUES ($1, $2, 'active')`,
    [workspaceId, 'GCN Isolated QA Workspace'],
  );
  await pool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active')`,
    [staffUserId, `staff_${staffUserId.slice(0, 8)}`, staffEmail],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [workspaceId, staffUserId],
  );
  await pool.query(
    `INSERT INTO user_workspace_bindings (workspace_id, user_id, status) VALUES ($1, $2, 'active')`,
    [workspaceId, staffUserId],
  );
  const pwHash = await hashPassword(staffPassword);
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1)`,
    [staffUserId, pwHash],
  );

  const authService = new AuthService(pool, TEST_CSRF_SECRET);
  const staffLogin = await authService.loginUser({
    identifier: staffEmail,
    password: staffPassword,
    clientIp: '127.0.0.1',
    requestId: crypto.randomUUID(),
    rememberMe: false,
  });
  const staffCookie = serializeSessionCookie(staffLogin.sessionToken, {
    isProduction: false,
  }).split(';')[0];

  const webCustomerService = new WebCustomerService(pool, TEST_CSRF_SECRET, {
    googleClientId: TEST_CLIENT_ID,
    publicCustomerWorkspaceId: workspaceId,
    privacyPolicyVersion: TEST_POLICY_VERSION,
    isProduction: false,
    idTokenVerifier: verifyTestRs256IdToken,
  });

  const srv = await startEphemeralServer(
    createRequestHandler({
      pool,
      authService,
      webCustomerService,
      csrfSecret: TEST_CSRF_SECRET,
      allowedOrigins: [ALLOWED_ORIGIN],
      trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
      isProduction: false,
      gcnProxySecret: TEST_PROXY_SECRET,
    }),
  );
  t.after(() => srv.close());

  const usersCountBefore = Number(
    (await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c,
  );
  const authSessionsBefore = Number(
    (await pool.query('SELECT COUNT(*)::int AS c FROM auth_sessions')).rows[0]
      .c,
  );

  // 3. Signup new customer on real PostgreSQL
  const custEmail = `khach.${workspaceId.slice(0, 8)}@example.vn`;
  const idToken = signTestIdToken({
    sub: `pg-sub-${workspaceId.slice(0, 8)}`,
    email: custEmail.toUpperCase(),
    name: 'Lê Khách Thực Tế',
  });

  const signupRes = await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
    method: 'POST',
    headers: {
      origin: ALLOWED_ORIGIN,
      'x-gcn-client-ip': '203.0.113.55',
      'x-gcn-proxy-secret': TEST_PROXY_SECRET,
    },
    body: {
      credential: idToken,
      consent: true,
      ref: 'ref_pg_01',
      utm: {
        utm_source: 'google',
        utm_campaign: 'launch_2026',
        utm_bad: 'nope space',
      },
      landing: '/tools',
    },
  });
  assert.equal(signupRes.status, 200);
  const custId = signupRes.json.data.customer.id;
  const custCookie = extractCookiePair(signupRes.setCookie, 'gcn_customer');
  const custCsrf = signupRes.json.data.csrf_token;
  assert.ok(custCookie);

  // Invariant: customer NEVER appears in users / auth_sessions / workspace_memberships / user_credentials
  const usersCountAfter = Number(
    (await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c,
  );
  const authSessionsAfter = Number(
    (await pool.query('SELECT COUNT(*)::int AS c FROM auth_sessions')).rows[0]
      .c,
  );
  assert.equal(usersCountAfter, usersCountBefore);
  assert.equal(authSessionsAfter, authSessionsBefore);

  // Check DB row fields & created_ip
  const dbCust = (
    await pool.query('SELECT * FROM web_customers WHERE id = $1', [custId])
  ).rows[0];
  assert.equal(dbCust.email_normalized, custEmail);
  assert.equal(dbCust.consent_version, TEST_POLICY_VERSION);
  assert.ok(dbCust.consent_at);
  assert.equal(dbCust.signup_ref, 'ref_pg_01');
  assert.deepEqual(dbCust.signup_utm, {
    utm_source: 'google',
    utm_campaign: 'launch_2026',
  });

  const dbSess = (
    await pool.query(
      'SELECT * FROM web_customer_sessions WHERE customer_id = $1',
      [custId],
    )
  ).rows[0];
  assert.equal(dbSess.created_ip, '203.0.113.55');

  // 4. Cross-realm isolation with REAL PostgreSQL AuthService
  for (const ep of [
    '/api/v1/accounts',
    '/api/v1/employees',
    '/api/v1/payroll/periods',
    '/api/v1/fin/summary',
    '/api/v1/auth/me',
  ]) {
    const r = await httpJson(srv.baseUrl, ep, {
      headers: { cookie: custCookie },
    });
    assert.equal(r.status, 401, `PG: customer cookie on ${ep} must be 401`);
  }

  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
        headers: { cookie: staffCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/account', {
        method: 'DELETE',
        headers: {
          cookie: staffCookie,
          origin: ALLOWED_ORIGIN,
          'x-csrf-token': staffLogin.responseData.csrf_token,
        },
      })
    ).status,
    401,
  );

  // Also verify against live QA_API_BASE when invoked via run-with-isolated-qa-stack.mjs
  if (process.env.QA_API_BASE) {
    const qaRes = await httpJson(
      process.env.QA_API_BASE,
      '/api/v1/public/auth/me',
      { headers: { cookie: staffCookie } },
    );
    assert.equal(qaRes.status, 401);
  }

  // 5. Sliding renewal when last_seen_at > 24h
  await pool.query(
    `UPDATE web_customer_sessions SET last_seen_at = NOW() - INTERVAL '25 hours', expires_at = NOW() + INTERVAL '10 days' WHERE id = $1`,
    [dbSess.id],
  );
  const beforeRenew = (
    await pool.query(
      'SELECT expires_at FROM web_customer_sessions WHERE id = $1',
      [dbSess.id],
    )
  ).rows[0].expires_at;

  const renewMe = await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
    headers: { cookie: custCookie },
  });
  assert.equal(renewMe.status, 200);
  const afterRenew = (
    await pool.query(
      'SELECT expires_at FROM web_customer_sessions WHERE id = $1',
      [dbSess.id],
    )
  ).rows[0].expires_at;
  assert.ok(
    new Date(afterRenew).getTime() > new Date(beforeRenew).getTime(),
    'Session expires_at must be extended when last_seen_at > 24h',
  );

  // 6. Blocked customer immediately rejected on PG
  await pool.query(
    `UPDATE web_customers SET status = 'blocked' WHERE id = $1`,
    [custId],
  );
  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
        headers: { cookie: custCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN },
        body: { credential: idToken },
      })
    ).status,
    403,
  );

  // Unblock, test logout, then re-login and test DELETE /account
  await pool.query(`UPDATE web_customers SET status = 'active' WHERE id = $1`, [
    custId,
  ]);
  const logoutRes = await httpJson(srv.baseUrl, '/api/v1/public/auth/logout', {
    method: 'POST',
    headers: {
      cookie: custCookie,
      origin: ALLOWED_ORIGIN,
      'x-csrf-token': custCsrf,
    },
  });
  assert.equal(logoutRes.status, 200);
  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
        headers: { cookie: custCookie },
      })
    ).status,
    401,
  );

  // Re-login (existing customer does not need consent again)
  const reloginRes = await httpJson(srv.baseUrl, '/api/v1/public/auth/google', {
    method: 'POST',
    headers: { origin: ALLOWED_ORIGIN },
    body: { credential: idToken },
  });
  assert.equal(reloginRes.status, 200);
  const custCookie2 = extractCookiePair(reloginRes.setCookie, 'gcn_customer');
  const custCsrf2 = reloginRes.json.data.csrf_token;

  // DELETE /account -> hard delete + cascade + audit has ID only (no email)
  const delRes = await httpJson(srv.baseUrl, '/api/v1/public/account', {
    method: 'DELETE',
    headers: {
      cookie: custCookie2,
      origin: ALLOWED_ORIGIN,
      'x-csrf-token': custCsrf2,
    },
  });
  assert.equal(delRes.status, 200);

  assert.equal(
    (await pool.query('SELECT id FROM web_customers WHERE id = $1', [custId]))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT id FROM web_customer_sessions WHERE customer_id = $1',
        [custId],
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await httpJson(srv.baseUrl, '/api/v1/public/auth/me', {
        headers: { cookie: custCookie2 },
      })
    ).status,
    401,
  );

  const auditRes = await pool.query(
    `SELECT action, entity_id, metadata_sanitized FROM audit_events WHERE workspace_id = $1 AND entity_id = $2 ORDER BY created_at ASC`,
    [workspaceId, custId],
  );
  const actions = auditRes.rows.map((r) => r.action);
  for (const expectedAction of [
    'web_customer.signup',
    'web_customer.login_blocked',
    'web_customer.logout',
    'web_customer.login',
    'web_customer.deleted',
  ]) {
    assert.ok(
      actions.includes(expectedAction),
      `Missing audit event ${expectedAction}`,
    );
  }
  const deletedRow = auditRes.rows.find(
    (r) => r.action === 'web_customer.deleted',
  );
  assert.deepEqual(deletedRow.metadata_sanitized, { customer_id: custId });
  assert.equal(
    JSON.stringify(deletedRow.metadata_sanitized).includes(custEmail),
    false,
  );
});
