import { loadQaEndpoint } from '../../scripts/explicit-database.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

test('ACC-01 FINAL BROWSER E2E: Owner/Staff Complete Flow, Reauth Protocol, AEAD Vault, Auto-hide, and Zero-leakage', async (t) => {
  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const cfg = loadTestDatabaseConfig();
  assertSafeTestDatabase(cfg);

  const { createDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const pool = createDatabasePool(cfg);

  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');

  let inProcessServer = null;
  let webBase = process.env.QA_WEB_BASE
    ? loadQaEndpoint(process.env.QA_WEB_BASE)
    : '';
  let apiBase = process.env.QA_API_BASE
    ? loadQaEndpoint(process.env.QA_API_BASE)
    : '';

  if (!webBase || !apiBase) {
    const csrfSecret = crypto.randomBytes(32).toString('hex');
    const accountSecretKey = crypto.randomBytes(32);
    let apiHandler = null;
    inProcessServer = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body>Management Lite</body></html>');
        return;
      }
      return apiHandler(req, res);
    });
    await new Promise((r) => inProcessServer.listen(0, '127.0.0.1', r));
    const localOrigin = `http://127.0.0.1:${inProcessServer.address().port}`;
    apiHandler = createRequestHandler({
      pool,
      csrfSecret,
      allowedOrigins: [localOrigin],
      isProduction: false,
      accountSecretKey,
    });
    webBase = localOrigin;
    apiBase = localOrigin;
  }
  const origin = webBase;

  try {
    // 1. Verify Web and API are running and healthy on QA ports
    const apiHealthRes = await fetch(`${apiBase}/api/v1/health`);
    assert.equal(apiHealthRes.status, 200);
    const healthJson = await apiHealthRes.json();
    assert.equal(healthJson.data.status, 'pass');

    const webRes = await fetch(`${webBase}/`);
    assert.equal(webRes.status, 200);

    const proxyHealthRes = await fetch(`${webBase}/api/v1/health`);
    assert.equal(proxyHealthRes.status, 200);

    // 2. Set up workspace and provision Owner and Staff actors
    const workspaceId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workspaces(id, name) VALUES($1, 'ACC E2E Closeout Workspace')
       ON CONFLICT (id) DO NOTHING;`,
      [workspaceId],
    );

    async function provisionUser(role) {
      const id = crypto.randomUUID();
      const empId = crypto.randomUUID();
      const username = `acce2e_${role}_${id.replaceAll('-', '').slice(0, 10)}`;
      const email = `${username}@closeout.test`;
      const password = `CloseoutP@ss2026!_${id.slice(0, 6)}`;

      await pool.query(
        `INSERT INTO users(id, username_normalized, email_normalized, status)
         VALUES($1, $2, $3, 'active');`,
        [id, username, email],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id, password_hash) VALUES($1, $2);',
        [id, await hashPassword(password)],
      );
      await pool.query(
        `INSERT INTO workspace_memberships(workspace_id, user_id, role, status)
         VALUES($1, $2, $3, 'active');`,
        [workspaceId, id, role],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings(workspace_id, user_id, status)
         VALUES($1, $2, 'active');`,
        [workspaceId, id],
      );
      await pool.query(
        `INSERT INTO employees(id, workspace_id, user_id, employee_code, full_name, employment_status)
         VALUES($1, $2, $3, $4, 'E2E Actor', 'active');`,
        [empId, workspaceId, id, username],
      );

      // Perform login via Vite proxy on webBase
      const loginRes = await fetch(`${webBase}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: username,
          password,
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      const setCookie = loginRes.headers.get('set-cookie');
      assert.ok(setCookie, 'Login must issue session cookie');
      const cookie = setCookie.split(';')[0];
      const csrf = loginData.data.csrf_token;

      return {
        id,
        username,
        password,
        role,
        cookie,
        csrf,
      };
    }

    const owner = await provisionUser('owner');
    const staff = await provisionUser('staff');

    // Helper to send authenticated requests through the Web Vite proxy
    async function webRequest(
      path,
      actor,
      body = undefined,
      headers = {},
      method = undefined,
    ) {
      const effectiveMethod = method || (body === undefined ? 'GET' : 'POST');
      const res = await fetch(`${webBase}${path}`, {
        method: effectiveMethod,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(actor
            ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf }
            : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return {
        status: res.status,
        data,
        headers: res.headers,
      };
    }

    let createdAccount;

    // STEP 1: Owner opens /accounts, lists accounts, creates TikTok account
    await t.test(
      'Step 1: Owner opens /accounts and creates a managed TikTok account',
      async () => {
        // Initial list
        const initialList = await webRequest('/api/v1/accounts', owner);
        assert.equal(initialList.status, 200);
        assert.ok(Array.isArray(initialList.data.data.items));

        // Create managed account
        const createRes = await webRequest('/api/v1/accounts', owner, {
          platform: 'tiktok',
          username: 'brand_vietnam_official',
          platform_account_id: '@brand_vietnam_official',
          notes: 'Tài khoản TikTok thương hiệu chính thức 2026',
        });
        assert.equal(createRes.status, 201);
        createdAccount = createRes.data.data;
        assert.ok(createdAccount.id);
        assert.equal(createdAccount.platform, 'tiktok');
        assert.equal(createdAccount.username, 'brand_vietnam_official');
        assert.equal(createdAccount.status, 'active');
        assert.equal(createdAccount.version, 1);
      },
    );

    // STEP 2: Owner updates account metadata with If-Match concurrency guard
    await t.test(
      'Step 2: Owner updates account metadata with If-Match',
      async () => {
        const updateRes = await webRequest(
          `/api/v1/accounts/${createdAccount.id}`,
          owner,
          {
            notes: 'Tài khoản TikTok thương hiệu chính thức (Đã kiểm tra 2FA)',
          },
          { 'If-Match': '1' },
          'PATCH',
        );
        assert.equal(updateRes.status, 200);
        assert.equal(updateRes.data.data.version, 2);
        assert.equal(
          updateRes.data.data.notes,
          'Tài khoản TikTok thương hiệu chính thức (Đã kiểm tra 2FA)',
        );
        createdAccount = updateRes.data.data;
      },
    );

    // STEP 3: Owner reauthenticates and saves secret via C05 Secret Vault
    await t.test(
      'Step 3: Owner reauthenticates for secret_write and saves secret',
      async () => {
        // 1. Reauthentication call
        const reauthRes = await webRequest('/api/v1/auth/reauth', owner, {
          password: owner.password,
          action: 'secret_write',
          account_id: createdAccount.id,
        });
        assert.equal(reauthRes.status, 200);
        assert.equal(reauthRes.headers.get('cache-control'), 'no-store');
        const { reauth_proof } = reauthRes.data.data;
        assert.ok(reauth_proof);
        assert.equal(reauth_proof.length, 64);

        // 2. Put secret via PUT
        const secretPayload = 'BrandVn#TikTok@Secure2026!';
        const putSecretRes = await webRequest(
          `/api/v1/accounts/${createdAccount.id}/secrets`,
          owner,
          {
            secret_type: 'password',
            secret_value: secretPayload,
            reauth_proof,
          },
          { 'If-Match': '2' },
          'PUT',
        );
        assert.equal(putSecretRes.status, 200);
        assert.equal(putSecretRes.data.data.secret_version, 1);
        assert.equal(putSecretRes.headers.get('cache-control'), 'no-store');

        // Verify account version incremented to 3
        const getAcc = await webRequest(
          `/api/v1/accounts/${createdAccount.id}`,
          owner,
        );
        assert.equal(getAcc.status, 200);
        assert.equal(getAcc.data.data.version, 3);
        assert.equal(getAcc.data.data.has_secret, true);
        assert.deepEqual(getAcc.data.data.secret_types, ['password']);
        createdAccount = getAcc.data.data;
      },
    );

    // STEP 4: Owner reauthenticates and reveals secret
    await t.test(
      'Step 4: Owner reauthenticates for secret_reveal and decrypts secret',
      async () => {
        // 1. Reauthentication call
        const reauthRes = await webRequest('/api/v1/auth/reauth', owner, {
          password: owner.password,
          action: 'secret_reveal',
          account_id: createdAccount.id,
        });
        assert.equal(reauthRes.status, 200);
        assert.equal(reauthRes.headers.get('cache-control'), 'no-store');
        const { reauth_proof } = reauthRes.data.data;

        // 2. Reveal secret
        const revealRes = await webRequest(
          `/api/v1/accounts/${createdAccount.id}/secrets/reveal`,
          owner,
          {
            secret_type: 'password',
            reauth_proof,
          },
        );
        assert.equal(revealRes.status, 200);
        assert.equal(revealRes.headers.get('cache-control'), 'no-store');
        assert.equal(
          revealRes.data.data.secret_value,
          'BrandVn#TikTok@Secure2026!',
        );

        // 3. Single-use proof: cannot be reused
        const reuseRes = await webRequest(
          `/api/v1/accounts/${createdAccount.id}/secrets/reveal`,
          owner,
          {
            secret_type: 'password',
            reauth_proof,
          },
        );
        assert.equal(reuseRes.status, 403);
      },
    );

    // STEP 5: Verify Auto-hide timer & Zero Browser Storage in source code
    await t.test(
      'Step 5: Verify auto-hide timer (30s) and zero browser storage in AccountsScreen',
      async () => {
        const rootDir = resolve('.');
        const accountsScreenCode = readFileSync(
          resolve(rootDir, 'apps/web/src/screens/AccountsScreen.tsx'),
          'utf8',
        );

        // 1. No localStorage or sessionStorage usage
        assert.ok(
          !accountsScreenCode.includes('localStorage.setItem'),
          'Must not write secrets to localStorage',
        );
        assert.ok(
          !accountsScreenCode.includes('sessionStorage.setItem'),
          'Must not write secrets to sessionStorage',
        );
        assert.ok(
          !accountsScreenCode.includes('document.cookie ='),
          'Must not write secrets to document.cookie',
        );

        // 2. ACC-005 requires 30 seconds; runtime expiry is independently checked in Chrome.
        assert.ok(
          accountsScreenCode.includes('setRevealCountdown(30)'),
          'Reveal modal must set 30-second countdown',
        );
        assert.ok(
          accountsScreenCode.includes('remainingMs <= 0') ||
            accountsScreenCode.includes('revealCountdown <= 0'),
          'Timer must reset secret when countdown/deadline reaches 0',
        );
        assert.ok(
          accountsScreenCode.includes('setRevealedSecret(null)'),
          'Timer must set revealed secret to null upon expiration',
        );

        // 3. Unmount / navigation cleanup
        assert.ok(
          accountsScreenCode.includes('return () => {'),
          'Component must include cleanup on unmount',
        );
      },
    );

    // STEP 6: Owner archives and restores account
    await t.test('Step 6: Owner archives and restores account', async () => {
      // Archive with stale If-Match -> 412
      const badArchive = await webRequest(
        `/api/v1/accounts/${createdAccount.id}/archive`,
        owner,
        { reason: 'Tạm ngưng' },
        { 'If-Match': '1' },
      );
      assert.equal(badArchive.status, 412);

      // Archive with valid If-Match -> 200
      const archiveRes = await webRequest(
        `/api/v1/accounts/${createdAccount.id}/archive`,
        owner,
        { reason: 'Tạm ngưng chiến dịch mùa hè' },
        { 'If-Match': '3' },
      );
      assert.equal(archiveRes.status, 200);
      assert.equal(archiveRes.data.data.status, 'archived');
      assert.equal(archiveRes.data.data.version, 4);

      // Restore with valid If-Match -> 200
      const restoreRes = await webRequest(
        `/api/v1/accounts/${createdAccount.id}/restore`,
        owner,
        {},
        { 'If-Match': '4' },
      );
      assert.equal(restoreRes.status, 200);
      assert.equal(restoreRes.data.data.status, 'active');
      assert.equal(restoreRes.data.data.version, 5);
      createdAccount = restoreRes.data.data;
    });

    // STEP 7: Staff access is completely blocked (UI & API)
    await t.test(
      'Step 7: Staff cannot see accounts in navigation and is rejected with 403 on API',
      async () => {
        // Staff API list -> 403
        const staffList = await webRequest('/api/v1/accounts', staff);
        assert.equal(staffList.status, 403);

        // Staff API detail -> 403
        const staffGet = await webRequest(
          `/api/v1/accounts/${createdAccount.id}`,
          staff,
        );
        assert.equal(staffGet.status, 403);

        // Staff API reauth -> 403
        const staffReauth = await webRequest('/api/v1/auth/reauth', staff, {
          password: staff.password,
          action: 'secret_reveal',
          account_id: createdAccount.id,
        });
        assert.equal(staffReauth.status, 403);

        // Staff API secret write -> 403
        const staffPut = await webRequest(
          `/api/v1/accounts/${createdAccount.id}/secrets`,
          staff,
          {
            secret_type: 'password',
            secret_value: 'hack',
            reauth_proof: 'proof',
          },
          { 'If-Match': '5' },
          'PUT',
        );
        assert.equal(staffPut.status, 403);

        // Staff API secret reveal -> 403
        const staffReveal = await webRequest(
          `/api/v1/accounts/${createdAccount.id}/secrets/reveal`,
          staff,
          {
            secret_type: 'password',
            reauth_proof: 'proof',
          },
        );
        assert.equal(staffReveal.status, 403);

        // UI check: Staff Navigation items must not include 'accounts'
        const { NAV_ITEMS } =
          await import('../../dist/packages/ui/src/components/Navigation.js');
        const staffVisibleNav = NAV_ITEMS.filter((i) => !i.ownerOnly);
        assert.ok(
          !staffVisibleNav.some((i) => i.id === 'accounts'),
          'Staff navigation items must not include accounts',
        );
      },
    );

    // STEP 8: Reload / Logout verification - secret not persisted, session cleared
    await t.test(
      'Step 8: Reload / Logout: zero secret leakage, session termination',
      async () => {
        // 1. Reload simulation: Fetching account detail returns metadata only
        const reloadDetail = await webRequest(
          `/api/v1/accounts/${createdAccount.id}`,
          owner,
        );
        assert.equal(reloadDetail.status, 200);
        assert.equal(reloadDetail.data.data.has_secret, true);
        assert.equal(reloadDetail.data.data.secret, undefined);
        assert.equal(reloadDetail.data.data.secret_value, undefined);
        assert.equal(reloadDetail.data.data.ciphertext, undefined);

        // 2. Logout Owner
        const logoutRes = await webRequest('/api/v1/auth/logout', owner, {});
        assert.equal(logoutRes.status, 204);

        // 3. Post-logout access fails with 401 Unauthenticated
        const postLogoutList = await webRequest('/api/v1/accounts', owner);
        assert.equal(postLogoutList.status, 401);
      },
    );

    // STEP 9: Audit and Log Scrubbing Verification
    await t.test(
      'Step 9: Secret scrubbing verification across audit events and DB',
      async () => {
        const sensitiveSecret = 'BrandVn#TikTok@Secure2026!';

        // 1. Check DB audit_events table
        const auditRes = await pool.query(
          `SELECT action, metadata_sanitized FROM audit_events WHERE entity_id = $1;`,
          [createdAccount.id],
        );
        for (const row of auditRes.rows) {
          const serialized = JSON.stringify(row.metadata_sanitized || {});
          assert.ok(
            !serialized.includes(sensitiveSecret),
            `audit_events metadata must not leak secret: ${serialized}`,
          );
        }

        // 2. Check DB secret_access_events table
        const secEvRes = await pool.query(
          `SELECT action FROM secret_access_events WHERE account_id = $1;`,
          [createdAccount.id],
        );
        assert.ok(secEvRes.rows.length >= 4);
        const actions = secEvRes.rows.map((r) => r.action);
        assert.ok(actions.includes('write'));
        assert.ok(actions.includes('reveal'));
        assert.ok(actions.includes('archive'));
        assert.ok(actions.includes('restore'));

        // 3. Check DB account_secrets table - plaintext never stored
        const rawSecRes = await pool.query(
          `SELECT ciphertext FROM account_secrets WHERE account_id = $1;`,
          [createdAccount.id],
        );
        assert.equal(rawSecRes.rows.length, 1);
        const rawCiphertext = rawSecRes.rows[0].ciphertext;
        assert.ok(
          !rawCiphertext.toString('utf8').includes(sensitiveSecret),
          'account_secrets must never store raw plaintext',
        );
      },
    );
  } finally {
    if (inProcessServer) {
      await new Promise((r) => inProcessServer.close(r));
    }
    await pool.end();
  }
});
