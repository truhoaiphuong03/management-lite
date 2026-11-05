import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import {
  findChromeBinary,
  installScriptWatchdog,
  withIsolatedViteDevServer,
} from '../../scripts/qa-chrome-harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test(
  'ISSUES-FIX-03 ISOLATED E2E: Browser ReportBugWidget <-> POST /api/v1/reports <-> Isolated PostgreSQL (Fix 03A/03B/03C)',
  { timeout: 90_000 },
  async (t) => {
    const { loadTestDatabaseConfig, assertSafeTestDatabase } =
      await import('../../dist/packages/database/src/config.js');
    const { runMigrations, loadMigrationFiles } =
      await import('../../dist/packages/database/src/migrator.js');
    const { hashPassword } =
      await import('../../dist/packages/security/src/password.js');
    const { createRequestHandler } =
      await import('../../dist/apps/api/src/app.js');
    const { SystemLogService } =
      await import('../../dist/apps/api/src/system-log/service.js');

    let baseDbConfig;
    try {
      baseDbConfig = loadTestDatabaseConfig();
      assertSafeTestDatabase(baseDbConfig);
    } catch {
      t.skip(
        'Isolated test database not configured - set TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true',
      );
      return;
    }

    const chromeBin = findChromeBinary();
    if (!chromeBin) {
      t.skip('Headless Chrome/Edge binary not found on host');
      return;
    }

    // Create a brand-new dedicated database exclusively for this test run, and drop ONLY this database on teardown
    const parsedBase = new URL(baseDbConfig.connectionString);
    const portNum = Number(parsedBase.port || 5432);
    const isDisposableLinuxCi =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      process.platform === 'linux' &&
      decodeURIComponent(parsedBase.username) === 'ci_test';
    if (!isDisposableLinuxCi) {
      assert.notEqual(
        portNum,
        55432,
        'Refusing to run against Production PostgreSQL port 55432',
      );
    }
    assert.notEqual(
      portNum,
      5432,
      'Refusing to run against default PostgreSQL port 5432',
    );

    const dedicatedDbName = `mglite_fix03_e2e_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assert.match(dedicatedDbName, /^mglite_fix03_e2e_test_[0-9]+_[0-9a-f]{6}$/);

    const adminUrl = new URL(baseDbConfig.connectionString);
    adminUrl.pathname = '/postgres';

    const dedicatedUrlObj = new URL(baseDbConfig.connectionString);
    dedicatedUrlObj.pathname = `/${dedicatedDbName}`;
    const dedicatedUrl = dedicatedUrlObj.toString();

    assertSafeTestDatabase(
      { ...baseDbConfig, connectionString: dedicatedUrl },
      {
        ...process.env,
        TEST_DATABASE_URL: dedicatedUrl,
        CONFIRM_ISOLATED_TEST_DB: 'true',
      },
    );

    const adminClient = new pg.Client({
      connectionString: adminUrl.toString(),
    });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dedicatedDbName}"`);
    await adminClient.end();

    const clearWatchdog = installScriptWatchdog(
      'issues-fix-03-isolated-e2e',
      90_000,
    );
    const pool = new pg.Pool({
      connectionString: dedicatedUrl,
      max: 5,
    });
    const systemLogService = new SystemLogService(pool);

    try {
      await runMigrations(
        pool,
        loadMigrationFiles(resolve(root, 'packages/database/src/migrations')),
      );

      // Seed isolated workspace + Owner + Staff users
      const wsId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const staffId = crypto.randomUUID();
      const ownerUsername = `fix03_owner_${Date.now()}`;
      const staffUsername = `fix03_staff_${Date.now()}`;
      const userPass = 'Fix03IsolatedPass2026!';

      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
        [wsId, 'Fix03 Isolated Test Workspace'],
      );

      const pwHash = await hashPassword(userPass);
      for (const [uid, uname, role] of [
        [ownerId, ownerUsername, 'owner'],
        [staffId, staffUsername, 'staff'],
      ]) {
        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active')`,
          [uid, uname, `${uname}@example.invalid`],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1)`,
          [uid, pwHash],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`,
          [wsId, uid, role],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1)`,
          [wsId, uid],
        );
      }

      let currentHandler = (_req, res) => {
        res.writeHead(503);
        res.end('Initializing');
      };
      const apiServer = http.createServer((req, res) =>
        currentHandler(req, res),
      );
      await new Promise((res) => apiServer.listen(0, '127.0.0.1', res));
      const apiAddr = apiServer.address();
      const apiPort = typeof apiAddr === 'object' && apiAddr ? apiAddr.port : 0;
      assert.ok(apiPort > 0 && apiPort !== 3002, 'Ephemeral API port required');
      const apiBase = `http://127.0.0.1:${apiPort}`;

      try {
        await withIsolatedViteDevServer(
          root,
          async (webBase) => {
            currentHandler = createRequestHandler({
              pool,
              systemLogService,
              csrfSecret: 'fix03_isolated_e2e_csrf_secret_min_32_bytes_ok!',
              allowedOrigins: [webBase, apiBase],
              isProduction: false,
            });

            const browser = await chromium.launch({
              executablePath: chromeBin,
              headless: true,
            });

            try {
              let firstIdempotencyKey = '';
              let firstRequestRawBody = '';
              let firstCommittedIssueId = '';
              let firstCommittedBugCode = '';
              let ownerCookieHeader = '';
              let ownerCsrfToken = '';

              await t.test(
                '1. Fix 03A + 03B + 03C: Mid-flight network drop AFTER PostgreSQL commit locks snapshot, enters unknown state, and "Gửi lại" replays 201 with strictly 1 DB row',
                async () => {
                  const context = await browser.newContext({
                    viewport: { width: 1280, height: 800 },
                  });
                  await context.addInitScript(() => {
                    try {
                      window.sessionStorage.setItem(
                        'mglite_phone_prompt_dismissed',
                        '1',
                      );
                    } catch {
                      // ignore
                    }
                  });
                  const page = await context.newPage();

                  try {
                    await page.goto(`${webBase}/login`, {
                      waitUntil: 'domcontentloaded',
                    });
                    await page.fill('#identifier', ownerUsername);
                    await page.fill('#password', userPass);
                    await page.click('button[type="submit"]');

                    await page.waitForSelector(
                      '[data-testid="btn-open-report-bug"]',
                      {
                        timeout: 15_000,
                      },
                    );

                    // Capture authenticated session cookie + CSRF token for subsequent direct API mismatch check
                    const meRes = await page.evaluate(async () => {
                      const r = await fetch('/api/v1/auth/me', {
                        credentials: 'include',
                      });
                      return r.json();
                    });
                    ownerCsrfToken = meRes?.data?.csrf_token || '';
                    const cookies = await context.cookies();
                    ownerCookieHeader = cookies
                      .map((c) => `${c.name}=${c.value}`)
                      .join('; ');
                    assert.ok(
                      ownerCsrfToken,
                      'Owner CSRF token must be issued',
                    );
                    assert.ok(
                      ownerCookieHeader,
                      'Owner session cookie must be set',
                    );

                    await page.click('[data-testid="btn-open-report-bug"]');
                    await page.waitForSelector(
                      '[data-testid="report-bug-modal-overlay"]',
                    );

                    const reportTitle = 'Sự cố đứt mạng sau commit Fix-03 E2E';
                    const reportDesc =
                      'Mô tả chi tiết kiểm thử thực tế trình duyệt -> POST /api/v1/reports -> PostgreSQL cô lập.';

                    await page.fill(
                      '[data-testid="input-report-title"]',
                      reportTitle,
                    );
                    await page.fill(
                      '[data-testid="input-report-description"]',
                      reportDesc,
                    );

                    // Intercept 1st POST /api/v1/reports: forward to real API so PostgreSQL commits the row,
                    // then abort the response back to Chromium so the browser experiences a lost HTTP response!
                    let dropInjected = false;
                    await page.route('**/api/v1/reports', async (route) => {
                      if (
                        !dropInjected &&
                        route.request().method() === 'POST'
                      ) {
                        dropInjected = true;
                        const req = route.request();
                        const reqHeaders = await req.allHeaders();
                        firstIdempotencyKey =
                          reqHeaders['idempotency-key'] || '';
                        firstRequestRawBody = req.postData() || '';

                        const forwardHeaders = {
                          'content-type':
                            reqHeaders['content-type'] || 'application/json',
                          origin: reqHeaders['origin'] || webBase,
                          cookie: reqHeaders['cookie'] || ownerCookieHeader,
                          'x-csrf-token':
                            reqHeaders['x-csrf-token'] || ownerCsrfToken,
                          'idempotency-key': firstIdempotencyKey,
                        };
                        const realApiRes = await fetch(
                          `${apiBase}/api/v1/reports`,
                          {
                            method: 'POST',
                            headers: forwardHeaders,
                            body: firstRequestRawBody,
                          },
                        );
                        const realJson = await realApiRes.json();
                        assert.equal(
                          realApiRes.status,
                          201,
                          'Real backend must commit the 1st report before simulated response drop',
                        );
                        firstCommittedIssueId = realJson?.data?.id || '';
                        firstCommittedBugCode = realJson?.data?.bug_code || '';

                        await route.abort('internetdisconnected');
                        return;
                      }
                      await route.continue();
                    });

                    await page.click('[data-testid="btn-submit-report"]');

                    // Wait for unknown outcome banner
                    const alertEl = page.locator(
                      '[data-testid="report-error-alert"]',
                    );
                    await alertEl.waitFor({
                      state: 'visible',
                      timeout: 10_000,
                    });
                    const alertText = await alertEl.textContent();
                    assert.match(
                      alertText || '',
                      /Gửi lại/,
                      'Unknown outcome alert must instruct user to click "Gửi lại"',
                    );

                    // Verify PostgreSQL ALREADY has 1 committed row while browser is in unknown outcome
                    const midDbCount = await pool.query(
                      `SELECT COUNT(*)::int AS cnt FROM issues WHERE workspace_id = $1`,
                      [wsId],
                    );
                    assert.equal(
                      midDbCount.rows[0].cnt,
                      1,
                      'PostgreSQL must hold the committed row while browser outcome is unknown',
                    );

                    // Fix 03B: Verify inputs are locked, discard button is hidden, and submit label is "Gửi lại"
                    assert.equal(
                      await page.isDisabled(
                        '[data-testid="input-report-title"]',
                      ),
                      true,
                      'Title input must be locked during unknown outcome (Fix 03B)',
                    );
                    assert.equal(
                      await page.isDisabled(
                        '[data-testid="input-report-description"]',
                      ),
                      true,
                      'Description textarea must be locked during unknown outcome (Fix 03B)',
                    );
                    assert.equal(
                      await page
                        .locator('[data-testid="btn-discard-pending-report"]')
                        .count(),
                      0,
                      'Discard draft button must NOT render during unknown outcome (Fix 02/03B)',
                    );
                    assert.equal(
                      (
                        await page.textContent(
                          '[data-testid="btn-submit-report"]',
                        )
                      )?.trim(),
                      'Gửi lại',
                      'Submit button must switch to "Gửi lại"',
                    );

                    // Verify partitioned sessionStorage holds exact idempotencyKey & immutable snapshotPayload
                    const storageKey = `mglite_pending_report_v1:${wsId}:${ownerId}`;
                    const storedRaw = await page.evaluate(
                      (k) => window.sessionStorage.getItem(k),
                      storageKey,
                    );
                    assert.ok(
                      storedRaw,
                      'Pending report must be persisted under workspace+user storage key',
                    );
                    const storedParsed = JSON.parse(storedRaw);
                    assert.equal(storedParsed.status, 'unknown');
                    assert.equal(
                      storedParsed.idempotencyKey,
                      firstIdempotencyKey,
                    );
                    assert.deepEqual(
                      storedParsed.snapshotPayload,
                      JSON.parse(firstRequestRawBody),
                      'Stored snapshotPayload must equal the exact payload sent on attempt 1',
                    );

                    // Observe the 2nd POST /api/v1/reports on "Gửi lại" without intercepting
                    let retryIdempotencyKey = '';
                    let retryRawBody = '';
                    page.on('request', (req) => {
                      if (
                        req.url().includes('/api/v1/reports') &&
                        req.method() === 'POST'
                      ) {
                        retryIdempotencyKey =
                          req.headers()['idempotency-key'] || '';
                        retryRawBody = req.postData() || '';
                      }
                    });

                    const [retryResponse] = await Promise.all([
                      page.waitForResponse(
                        (res) =>
                          res.url().includes('/api/v1/reports') &&
                          res.request().method() === 'POST',
                      ),
                      page.click('[data-testid="btn-submit-report"]'),
                    ]);

                    assert.equal(
                      retryResponse.status(),
                      201,
                      'Idempotent retry on POST /api/v1/reports must replay HTTP 201',
                    );
                    const retryJson = await retryResponse.json();
                    assert.equal(
                      retryIdempotencyKey,
                      firstIdempotencyKey,
                      'Retry must reuse the exact same Idempotency-Key (Fix 03C)',
                    );
                    assert.deepEqual(
                      JSON.parse(retryRawBody),
                      JSON.parse(firstRequestRawBody),
                      'Retry must transmit the exact locked snapshot payload (Fix 03B)',
                    );
                    assert.equal(
                      retryJson?.data?.id,
                      firstCommittedIssueId,
                      'Replayed response must return the original committed issue ID (Fix 03A)',
                    );
                    assert.equal(
                      retryJson?.data?.bug_code,
                      firstCommittedBugCode,
                      'Replayed response must return the original BUG-xxxx code (Fix 03A)',
                    );

                    await page.waitForSelector(
                      '[data-testid="report-success-alert"]',
                      {
                        timeout: 10_000,
                      },
                    );

                    const afterStorage = await page.evaluate(
                      (k) => window.sessionStorage.getItem(k),
                      storageKey,
                    );
                    assert.equal(
                      afterStorage,
                      null,
                      'Pending sessionStorage entry must be cleared after successful replay',
                    );

                    // Strictly 1 issue row and 1 'created' activity row in PostgreSQL!
                    const finalIssueRows = await pool.query(
                      `SELECT id, bug_code, title FROM issues WHERE workspace_id = $1`,
                      [wsId],
                    );
                    assert.equal(
                      finalIssueRows.rows.length,
                      1,
                      'PostgreSQL issues table must contain strictly 1 row (zero duplicates)',
                    );
                    const activityRows = await pool.query(
                      `SELECT COUNT(*)::int AS cnt FROM issue_activity WHERE issue_id = $1 AND action = 'created'`,
                      [firstCommittedIssueId],
                    );
                    assert.equal(
                      activityRows.rows[0].cnt,
                      1,
                      'PostgreSQL issue_activity must contain strictly 1 created event',
                    );
                  } finally {
                    await context.close();
                  }
                },
              );

              await t.test(
                '2. Fix 03A Mismatch Guard: Reusing committed Idempotency-Key with mutated payload returns 409 CONFLICT without mutating DB',
                async () => {
                  const mutatedPayload = {
                    ...JSON.parse(firstRequestRawBody),
                    title: 'Tiêu đề bị sửa trái phép trên cùng Idempotency-Key',
                  };
                  const mismatchRes = await fetch(`${apiBase}/api/v1/reports`, {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      origin: webBase,
                      cookie: ownerCookieHeader,
                      'x-csrf-token': ownerCsrfToken,
                      'idempotency-key': firstIdempotencyKey,
                    },
                    body: JSON.stringify(mutatedPayload),
                  });
                  assert.equal(
                    mismatchRes.status,
                    409,
                    'POST /api/v1/reports must reject mutated payload on existing Idempotency-Key with 409',
                  );
                  const dbRow = await pool.query(
                    `SELECT title FROM issues WHERE id = $1`,
                    [firstCommittedIssueId],
                  );
                  assert.equal(
                    dbRow.rows[0].title,
                    'Sự cố đứt mạng sau commit Fix-03 E2E',
                    'Stored issue title must remain untouched after 409 mismatch',
                  );
                },
              );

              await t.test(
                '3. Fix 03C Reload Recovery & Fix 01/03 User Isolation: Pending unknown report survives page reload and does not leak to Staff user',
                async () => {
                  const context = await browser.newContext({
                    viewport: { width: 1280, height: 800 },
                  });
                  await context.addInitScript(() => {
                    try {
                      window.sessionStorage.setItem(
                        'mglite_phone_prompt_dismissed',
                        '1',
                      );
                    } catch {
                      // ignore
                    }
                  });
                  const page = await context.newPage();

                  try {
                    await page.goto(`${webBase}/login`, {
                      waitUntil: 'domcontentloaded',
                    });
                    await page.fill('#identifier', ownerUsername);
                    await page.fill('#password', userPass);
                    await page.click('button[type="submit"]');
                    await page.waitForSelector(
                      '[data-testid="btn-open-report-bug"]',
                      {
                        timeout: 15_000,
                      },
                    );

                    // Simulate pre-reach network drop so sessionStorage holds unknown state across reload
                    let failOnce = true;
                    await page.route('**/api/v1/reports', async (route) => {
                      if (failOnce && route.request().method() === 'POST') {
                        failOnce = false;
                        await route.abort('failed');
                        return;
                      }
                      await route.continue();
                    });

                    await page.click('[data-testid="btn-open-report-bug"]');
                    await page.fill(
                      '[data-testid="input-report-title"]',
                      'Báo lỗi giữ nguyên qua F5 Reload',
                    );
                    await page.fill(
                      '[data-testid="input-report-description"]',
                      'Kiểm tra khôi phục trạng thái unknown từ sessionStorage sau khi tải lại trang.',
                    );
                    await page.click('[data-testid="btn-submit-report"]');
                    await page.waitForSelector(
                      '[data-testid="report-error-alert"]',
                    );

                    // Reload browser tab while pending unknown report exists
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    await page.waitForSelector(
                      '[data-testid="btn-open-report-bug"]',
                      {
                        timeout: 15_000,
                      },
                    );
                    await page.click('[data-testid="btn-open-report-bug"]');

                    assert.equal(
                      await page.inputValue(
                        '[data-testid="input-report-title"]',
                      ),
                      'Báo lỗi giữ nguyên qua F5 Reload',
                      'Pending title must be restored after page reload',
                    );
                    assert.equal(
                      await page.isDisabled(
                        '[data-testid="input-report-title"]',
                      ),
                      true,
                      'Restored unknown report must keep inputs locked after reload',
                    );
                    assert.equal(
                      (
                        await page.textContent(
                          '[data-testid="btn-submit-report"]',
                        )
                      )?.trim(),
                      'Gửi lại',
                      'Restored unknown report must show "Gửi lại" button after reload',
                    );

                    // Log out Owner and log in as Staff in the SAME tab (sharing sessionStorage) -> Staff must NOT inherit Owner's pending report!
                    await page.evaluate(async () => {
                      const me = await (
                        await fetch('/api/v1/auth/me', {
                          credentials: 'include',
                        })
                      ).json();
                      await fetch('/api/v1/auth/logout', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'x-csrf-token': me?.data?.csrf_token || '' },
                      });
                    });
                    await page.goto(`${webBase}/login`, {
                      waitUntil: 'domcontentloaded',
                    });
                    await page.fill('#identifier', staffUsername);
                    await page.fill('#password', userPass);
                    await page.click('button[type="submit"]');
                    await page.waitForSelector(
                      '[data-testid="btn-open-report-bug"]',
                      {
                        timeout: 15_000,
                      },
                    );
                    await page.click('[data-testid="btn-open-report-bug"]');

                    assert.equal(
                      await page.inputValue(
                        '[data-testid="input-report-description"]',
                      ),
                      '',
                      'Staff user in same tab must NOT see Owner pending report (Fix 01/03 partition)',
                    );
                    assert.equal(
                      await page.isDisabled(
                        '[data-testid="input-report-description"]',
                      ),
                      false,
                      'Staff user form must be unlocked and clean',
                    );
                    assert.equal(
                      (
                        await page.textContent(
                          '[data-testid="btn-submit-report"]',
                        )
                      )?.trim(),
                      'Gửi báo lỗi',
                      'Staff user must see fresh "Gửi báo lỗi" action',
                    );
                  } finally {
                    await context.close();
                  }
                },
              );
            } finally {
              await browser.close().catch(() => {});
            }
          },
          { apiTarget: apiBase },
        );
      } finally {
        apiServer.closeAllConnections?.();
        await new Promise((res) => apiServer.close(() => res()));
      }
    } finally {
      if (typeof systemLogService.stop === 'function') {
        await systemLogService.stop().catch(() => {});
      } else {
        await systemLogService.flush(true).catch(() => {});
      }
      await pool.end().catch(() => {});
      const dropClient = new pg.Client({
        connectionString: adminUrl.toString(),
      });
      try {
        await dropClient.connect();
        await dropClient.query(
          `DROP DATABASE IF EXISTS "${dedicatedDbName}" WITH (FORCE)`,
        );
      } finally {
        await dropClient.end().catch(() => {});
      }
      clearWatchdog();
    }
  },
);
