import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import pg from 'pg';
import {
  redactSensitiveData,
  BugAnalyzer,
} from '../../dist/apps/api/src/ai-core/bug-analyzer.js';

test('BUG-AI-MANAGEMENT: Sanitization, Gemini Bug Analyzer, DB Schema M21, and Full Lifecycle API', async (t) => {
  // =========================================================================
  // PART 1: REDACTION & SANITIZATION ENGINE (SECURITY UNIT TESTS)
  // =========================================================================
  await t.test(
    '1. Redaction engine strips sensitive tokens, secrets, cookies, passwords, and private IPs',
    () => {
      const rawInputs = [
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456',
        'api_key: "AIzaSyD-TEST-KEY-12345"',
        'password: "SuperSecretPassword123!"',
        'auth_token: "secret-token-xyz"',
        'postgres://hp_app_test:superpass456@127.0.0.1:55432/management_lite_test',
        'Cookie: connect.sid=s%3Aabc123xyz.signature; session_id=session456',
        'Internal IP connection failed at 192.168.1.150 and 10.0.4.12',
        'User email is admin@hoaiphuong.click on host 172.16.5.20',
      ];

      const joinedInput = rawInputs.join('\n');
      const sanitized = redactSensitiveData(joinedInput);

      assert.ok(
        !sanitized.includes('AIzaSyD-TEST-KEY-12345'),
        'Must redact API key',
      );
      assert.ok(
        !sanitized.includes('SuperSecretPassword123!'),
        'Must redact raw password',
      );
      assert.ok(!sanitized.includes('superpass456'), 'Must redact DB password');
      assert.ok(
        !sanitized.includes('eyJhbGciOiJIUzI1Ni'),
        'Must redact JWT token',
      );
      assert.ok(
        !sanitized.includes('connect.sid=s%3Aabc123xyz'),
        'Must redact session cookie',
      );
      assert.ok(
        !sanitized.includes('192.168.1.150'),
        'Must redact 192.168.x.x IP',
      );
      assert.ok(!sanitized.includes('10.0.4.12'), 'Must redact 10.x.x.x IP');
      assert.ok(
        !sanitized.includes('172.16.5.20'),
        'Must redact 172.16.x.x IP',
      );

      assert.ok(
        sanitized.includes('[REDACTED_SECRET]'),
        'Must replace secrets with tag',
      );
      assert.ok(
        sanitized.includes('[REDACTED_PASSWORD]'),
        'Must replace DB password with tag',
      );
      assert.ok(
        sanitized.includes('[REDACTED_COOKIE]'),
        'Must replace cookies with tag',
      );
      assert.ok(
        sanitized.includes('[REDACTED_INTERNAL_IP]'),
        'Must replace internal IPs with tag',
      );
    },
  );

  // =========================================================================
  // PART 2: BUG ANALYZER FORMAT & OFFLINE RESILIENCE
  // =========================================================================
  await t.test(
    '2. BugAnalyzer returns valid structured schema conforming to GeminiAnalysisResult',
    async () => {
      const analyzer = new BugAnalyzer({ apiKey: 'mock-test-key' });
      const result = await analyzer.analyze({
        title: 'Lỗi không tải được danh sách nhân viên',
        description:
          'Khi bấm vào tab Nhân viên, trang xoay tròn và báo lỗi 500 kèm kết nối database.',
        route_template: '/employees',
        module_name: 'Nhân sự',
        metadata_context: {
          error_id: 'ERR-MOCK-1',
          url: 'https://ql.hoaiphuong.click/employees',
        },
      });

      assert.ok(result, 'Result must exist');
      assert.ok(
        typeof result.summary === 'string' && result.summary.length > 0,
        'Must have summary',
      );
      assert.ok(
        typeof result.root_cause === 'string' && result.root_cause.length > 0,
        'Must have root_cause',
      );
      assert.ok(
        Array.isArray(result.affected_files),
        'affected_files must be an array',
      );
      assert.ok(
        typeof result.suggested_fix === 'string',
        'suggested_fix must be string',
      );
      assert.ok(
        ['P0', 'P1', 'P2', 'P3'].includes(result.severity),
        'severity must be P0-P3',
      );
      assert.ok(
        typeof result.can_auto_verify === 'boolean',
        'can_auto_verify must be boolean',
      );
      assert.ok(
        Array.isArray(result.suggested_tests),
        'suggested_tests must be array',
      );
      assert.ok(result.model, 'Must record model name used');
    },
  );

  // =========================================================================
  // PART 3: DATABASE SCHEMA & MIGRATION 21 VERIFICATION (ISOLATED TEST DB)
  // =========================================================================
  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const { runMigrations, loadMigrationFiles } =
    await import('../../dist/packages/database/src/migrator.js');
  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { resolve } = await import('node:path');
  const crypto = await import('node:crypto');

  let dbConfig;
  try {
    dbConfig = loadTestDatabaseConfig();
    assertSafeTestDatabase(dbConfig);
  } catch {
    t.skip(
      'Isolated test database not configured - set TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true',
    );
    return;
  }

  const pool = new pg.Pool({
    connectionString: dbConfig.connectionString,
    max: 5,
  });
  t.after(async () => {
    await pool.end();
  });

  await runMigrations(
    pool,
    loadMigrationFiles(resolve('packages/database/src/migrations')),
  );

  await t.test(
    '3. Database has Migration 21 applied with sequence and all columns',
    async () => {
      // 3.1 Check sequence
      const seqRes = await pool.query(
        `SELECT sequence_name FROM information_schema.sequences WHERE sequence_name = 'issue_bug_code_seq'`,
      );
      assert.equal(
        seqRes.rows.length,
        1,
        'Sequence issue_bug_code_seq must exist',
      );

      // 3.2 Check columns in issues table
      const colRes = await pool.query(
        `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'issues' AND column_name IN (
         'bug_code', 'severity', 'gemini_analysis', 'github_issue_number',
         'github_issue_url', 'pr_number', 'deploy_sha', 'test_result',
         'reopen_count', 'metadata_context', 'screenshot_url'
       )`,
      );
      const foundCols = colRes.rows.map((r) => r.column_name);
      assert.ok(foundCols.includes('bug_code'), 'Must have bug_code');
      assert.ok(foundCols.includes('severity'), 'Must have severity');
      assert.ok(
        foundCols.includes('gemini_analysis'),
        'Must have gemini_analysis',
      );
      assert.ok(foundCols.includes('test_result'), 'Must have test_result');
      assert.ok(foundCols.includes('reopen_count'), 'Must have reopen_count');
      assert.ok(foundCols.includes('deploy_sha'), 'Must have deploy_sha');
      assert.ok(
        foundCols.includes('metadata_context'),
        'Must have metadata_context',
      );
      assert.ok(
        foundCols.includes('screenshot_url'),
        'Must have screenshot_url',
      );
    },
  );

  // =========================================================================
  // PART 4: FULL LIFECYCLE API INTEGRATION TEST
  // =========================================================================
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');
  const handler = createRequestHandler({
    pool,
    csrfSecret: 'bug_management_test_csrf_secret_min_32_bytes!',
    allowedOrigins: [
      'https://ql.hoaiphuong.click',
      'http://127.0.0.1:3000',
      'http://127.0.0.1',
    ],
    isProduction: false,
  });
  const inProcessServer = http.createServer(handler);
  await new Promise((res) => inProcessServer.listen(0, '127.0.0.1', res));
  const addr = inProcessServer.address();
  const apiBase = `http://127.0.0.1:${addr.port}`;
  t.after(() => new Promise((res) => inProcessServer.close(res)));
  const origin = 'https://ql.hoaiphuong.click';

  // Seed isolated workspace + Owner user fixture
  const wsId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const ownerUsername = `bug_ai_owner_${Date.now()}`;
  const ownerPass = 'BugAiOwnerPass2026!';
  await pool.query(
    `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
    [wsId, `BugAI_WS_${Date.now()}`],
  );
  await pool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
    [ownerId, ownerUsername, `${ownerUsername}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
    [ownerId, await hashPassword(ownerPass)],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
    [wsId, ownerId],
  );
  await pool.query(
    `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
    [wsId, ownerId],
  );

  async function apiRequest(
    path,
    method = 'GET',
    data = null,
    cookie = null,
    csrf = null,
    extraHeaders = {},
  ) {
    const headers = { ...extraHeaders };
    if (cookie) headers['cookie'] = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    if (data) headers['content-type'] = 'application/json';
    headers['origin'] = origin;

    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    const setCookie = res.headers.get('set-cookie');
    const etag = res.headers.get('etag');

    return {
      status: res.status,
      headers: res.headers,
      json,
      text,
      setCookie,
      etag,
    };
  }

  function extractCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    return setCookieHeader.split(';')[0].trim();
  }

  const loginRes = await apiRequest('/api/v1/auth/login', 'POST', {
    identifier: ownerUsername,
    password: ownerPass,
  });
  assert.equal(loginRes.status, 200, 'Isolated Owner login must succeed');

  const ownerCookie = extractCookie(loginRes.setCookie);
  const ownerCsrf = loginRes.json?.data?.csrf_token;
  assert.ok(ownerCookie, 'Owner session cookie required');
  assert.ok(ownerCsrf, 'Owner CSRF token required');

  let testIssueId = '';
  let testBugCode = '';
  let currentVersion = 1;

  await t.test(
    '4.1 Submit bug report via POST /api/v1/reports generates bug_code and metadata',
    async () => {
      const reportPayload = {
        title: 'Lỗi kiểm thử tự động quy trình AI Bug Management',
        description:
          'Kiểm tra quy trình báo lỗi -> Gemini phân tích -> CI verify -> Đánh dấu fixed.',
        route_template: '/issues',
        module_name: 'Vấn đề & Lỗi',
        severity: 'P1',
        screenshot_url:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        metadata_context: {
          url: 'https://ql.hoaiphuong.click/issues',
          client_timestamp: new Date().toISOString(),
          error_id: 'ERR-REGRESSION-01',
          user_agent: 'Node-Test/Automated-Regression',
        },
      };

      const res = await apiRequest(
        '/api/v1/reports',
        'POST',
        reportPayload,
        ownerCookie,
        ownerCsrf,
        { 'idempotency-key': `report-test-${Date.now()}` },
      );

      assert.equal(res.status, 201, 'Must create report');
      assert.equal(res.json?.success, true);
      const data = res.json?.data;
      assert.ok(data.id, 'Must return issue ID');
      assert.ok(data.bug_code, 'Must return bug_code (BUG-xxxx)');
      assert.match(
        data.bug_code,
        /^BUG-\d{4}$/,
        'Bug code must match BUG-xxxx format',
      );
      assert.equal(data.severity, 'P1', 'Must store severity');
      assert.equal(data.status, 'open', 'Initial status must be open');
      assert.ok(
        data.metadata_context?.error_id,
        'Must persist metadata_context',
      );
      assert.ok(data.screenshot_url, 'Must persist screenshot_url');

      testIssueId = data.id;
      testBugCode = data.bug_code;
    },
  );

  await t.test(
    '4.2 Trigger Gemini AI Analysis via POST /api/v1/issues/:id/analyze',
    async () => {
      const res = await apiRequest(
        `/api/v1/issues/${testIssueId}/analyze`,
        'POST',
        null,
        ownerCookie,
        ownerCsrf,
      );

      assert.equal(res.status, 200, 'Analyze request must succeed');
      assert.equal(res.json?.success, true);
      const data = res.json?.data;
      assert.ok(data.analysis, 'Must return analysis result');
      assert.equal(
        data.issue.status,
        'fixing',
        'Status must transition to fixing',
      );
      assert.ok(data.issue.gemini_analysis, 'Must persist gemini_analysis');
      assert.ok(
        data.issue.gemini_analysis.summary,
        'Must have analysis summary',
      );
      assert.ok(
        data.issue.gemini_analysis.root_cause,
        'Must have root cause hypothesis',
      );
    },
  );

  await t.test(
    '4.3 Verify fix via POST /api/v1/issues/:id/verify: test_result=passed -> awaiting_owner, then Owner confirms -> fixed',
    async () => {
      const deploySha = 'a1b2c3d4e5f6789012345678901234567890abcd';
      const verifyPayload = {
        commit_sha: deploySha,
        test_result: 'passed',
      };

      const res = await apiRequest(
        `/api/v1/issues/${testIssueId}/verify`,
        'POST',
        verifyPayload,
        ownerCookie,
        ownerCsrf,
      );

      assert.equal(res.status, 200, 'Verify request must succeed');
      const data = res.json?.data;
      assert.equal(
        data.status,
        'awaiting_owner',
        'Status must transition to awaiting_owner when passed (never auto-close to fixed)',
      );
      assert.equal(data.test_result, 'passed');
      assert.equal(data.deploy_sha, deploySha);
      assert.equal(
        data.closed_at,
        null,
        'closed_at must be null while awaiting_owner',
      );
      currentVersion = data.version;

      // Owner confirms and closes issue
      const confirmRes = await apiRequest(
        `/api/v1/issues/${testIssueId}/confirm-fix`,
        'POST',
        { comment: 'Owner verified fix on production' },
        ownerCookie,
        ownerCsrf,
        {
          'idempotency-key': `confirm-${Date.now()}`,
          'if-match': `"${currentVersion}"`,
        },
      );
      assert.equal(confirmRes.status, 200, 'Owner confirm-fix must succeed');
      const confirmed = confirmRes.json?.data;
      assert.equal(
        confirmed.status,
        'fixed',
        'Status only becomes fixed upon Owner confirmation',
      );
      assert.ok(
        confirmed.closed_at,
        'closed_at must be populated after Owner confirms',
      );
      currentVersion = confirmed.version;
    },
  );

  await t.test(
    '4.4 Reopen fixed issue via POST /api/v1/issues/:id/reopen',
    async () => {
      const reopenPayload = {
        reason: 'Lỗi vẫn tái diễn sau khi test lại giao diện thật.',
      };

      const res = await apiRequest(
        `/api/v1/issues/${testIssueId}/reopen`,
        'POST',
        reopenPayload,
        ownerCookie,
        ownerCsrf,
        {
          'idempotency-key': `reopen-${Date.now()}`,
          'if-match': `"${currentVersion}"`,
        },
      );

      assert.equal(res.status, 200, 'Reopen request must succeed');
      const data = res.json?.data;
      assert.equal(
        data.status,
        'reopened',
        'Status must transition to reopened',
      );
      assert.equal(
        data.reopen_count,
        1,
        'reopen_count must be incremented to 1',
      );
      assert.equal(data.closed_at, null, 'closed_at must be reset to null');
    },
  );

  await t.test(
    '4.5 Verify fix: test_result=failed -> reopened with incremented count',
    async () => {
      const verifyPayload = {
        commit_sha: 'fail123456789012345678901234567890abcdef',
        test_result: 'failed',
      };

      const res = await apiRequest(
        `/api/v1/issues/${testIssueId}/verify`,
        'POST',
        verifyPayload,
        ownerCookie,
        ownerCsrf,
      );

      assert.equal(res.status, 200, 'Verify request must succeed');
      const data = res.json?.data;
      assert.equal(
        data.status,
        'reopened',
        'Status must transition to reopened when failed',
      );
      assert.equal(data.test_result, 'failed');
      assert.equal(
        data.reopen_count,
        2,
        'reopen_count must be incremented to 2',
      );
    },
  );

  await t.test(
    '4.6 Verify fix: test_result=manual -> waiting_for_owner',
    async () => {
      const verifyPayload = {
        commit_sha: 'manual123456789012345678901234567890abcde',
        test_result: 'manual',
      };

      const res = await apiRequest(
        `/api/v1/issues/${testIssueId}/verify`,
        'POST',
        verifyPayload,
        ownerCookie,
        ownerCsrf,
      );

      assert.equal(res.status, 200, 'Verify request must succeed');
      const data = res.json?.data;
      assert.equal(
        data.status,
        'awaiting_owner',
        'Status must transition to awaiting_owner',
      );
      assert.equal(data.test_result, 'manual');
    },
  );

  await t.test(
    '4.7 Check issue detail & append-only activity trail',
    async () => {
      const res = await apiRequest(
        `/api/v1/issues/${testIssueId}`,
        'GET',
        null,
        ownerCookie,
      );

      assert.equal(res.status, 200, 'Must fetch detail');
      const data = res.json?.data;
      assert.equal(data.issue.bug_code, testBugCode);
      assert.equal(data.issue.status, 'awaiting_owner');

      const activityActions = data.activities.map((a) => a.action);
      assert.ok(
        activityActions.includes('created'),
        'Must record created activity',
      );
      assert.ok(
        activityActions.includes('gemini_analyzed'),
        'Must record gemini_analyzed activity',
      );
      assert.ok(
        activityActions.includes('test_verified'),
        'Must record test_verified activity',
      );
      assert.ok(
        activityActions.includes('reopened'),
        'Must record reopened activity',
      );
    },
  );
});
