import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

test('ACC-01 Managed Accounts & Secrets: security, crypto AEAD, reauth protocol, RBAC and audit immutability', async (t) => {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.CONFIRM_ISOLATED_TEST_DB !== 'true'
  ) {
    t.skip('Explicit isolated QA DB required');
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const cfg = loadTestDatabaseConfig();
  assertSafeTestDatabase(cfg);

  const { createDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const pool = createDatabasePool(cfg);

  const { runMigrations, loadMigrationFiles } =
    await import('../../dist/packages/database/src/migrator.js');
  const { EMBEDDED_MIGRATIONS } =
    await import('../../dist/packages/database/src/migrations/catalog.js');
  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { normalizeEncryptionKey } =
    await import('../../dist/packages/security/src/aead.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');

  let server;
  let noKeyServer;

  try {
    // 1. Verify migration catalog and schema
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    await t.test(
      'M06 Accounts migration checksum, replay and schema validation',
      async () => {
        assert.ok(migrations.length >= 11);
        for (let i = 0; i < 11; i++) {
          assert.equal(migrations[i].checksum, EMBEDDED_MIGRATIONS[i].checksum);
        }
        const migResult = await runMigrations(pool, migrations);
        assert.equal(typeof migResult.appliedCount, 'number');

        // Verify tables exist
        const tblRes = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN ('managed_accounts', 'account_secrets', 'account_reauth_proofs', 'secret_access_events');`,
        );
        assert.equal(tblRes.rows.length, 4);
      },
    );

    // 2. Set up test workspaces and test server
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workspaces(id, name) VALUES
        ($1, 'ACC QA Workspace A'),
        ($2, 'ACC QA Workspace B')
       ON CONFLICT (id) DO NOTHING;`,
      [workspaceA, workspaceB],
    );

    const origin = 'http://localhost:3000';
    const testSecretKey = normalizeEncryptionKey(
      process.env.ACCOUNT_SECRET_KEY ||
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );

    server = http.createServer(
      createRequestHandler({
        pool,
        csrfSecret: crypto.randomBytes(32).toString('hex'),
        allowedOrigins: [origin],
        isProduction: false,
        accountSecretKey: testSecretKey,
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;

    // Helper to send HTTP requests
    async function request(
      path,
      actor,
      body,
      headers = {},
      method = undefined,
    ) {
      const effectiveMethod = method || (body === undefined ? 'GET' : 'POST');
      const res = await fetch(base + path, {
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
      let json = null;
      try {
        json = await res.json();
      } catch {}
      return {
        status: res.status,
        data: json,
        headers: res.headers,
        cookie: res.headers.get('set-cookie'),
      };
    }

    // Helper to provision user, credentials, and session
    async function provisionActor(role, ws = workspaceA) {
      const id = crypto.randomUUID();
      const empId = crypto.randomUUID();
      const username = 'accqa_' + id.replaceAll('-', '').slice(0, 16);
      const email = `${username}@acc-qa.test`;
      const pw = 'AccPass!2026#' + id.slice(0, 8);

      await pool.query(
        `INSERT INTO users(id, username_normalized, email_normalized, status)
         VALUES($1, $2, $3, 'active');`,
        [id, username, email],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id, password_hash) VALUES($1, $2);',
        [id, await hashPassword(pw)],
      );
      await pool.query(
        `INSERT INTO workspace_memberships(workspace_id, user_id, role, status)
         VALUES($1, $2, $3, 'active');`,
        [ws, id, role],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings(workspace_id, user_id, status)
         VALUES($1, $2, 'active');`,
        [ws, id],
      );
      await pool.query(
        `INSERT INTO employees(id, workspace_id, user_id, employee_code, full_name, employment_status)
         VALUES($1, $2, $3, $4, 'ACC Tester', 'active');`,
        [empId, ws, id, username],
      );

      const login = await request('/api/v1/auth/login', null, {
        identifier: username,
        password: pw,
      });
      assert.equal(login.status, 200);

      return {
        id,
        empId,
        ws,
        pw,
        username,
        cookie: login.cookie.split(';')[0],
        csrf: login.data.data.csrf_token,
      };
    }

    const ownerA = await provisionActor('owner', workspaceA);
    const staffA = await provisionActor('staff', workspaceA);
    const ownerB = await provisionActor('owner', workspaceB);

    // Initial Account creation for subsequent tests
    const createRes = await request('/api/v1/accounts', ownerA, {
      platform: 'tiktok',
      username: 'creator_studio_vn',
      platform_account_id: '@creator_studio_vn',
      notes: 'Initial primary account',
    });
    assert.equal(createRes.status, 201);
    const testAccount = createRes.data.data;
    assert.ok(testAccount.id);
    assert.equal(testAccount.platform, 'tiktok');
    assert.equal(testAccount.version, 1);

    // S01: RBAC Enforcement - Staff must be rejected with 403 on all 9 endpoints
    await t.test(
      'S01: RBAC enforcement - Staff is rejected with 403 on all 9 endpoints',
      async () => {
        const dummyProof = crypto.randomBytes(32).toString('hex');

        // 1. Reauth
        const r1 = await request('/api/v1/auth/reauth', staffA, {
          password: staffA.pw,
          action: 'secret_reveal',
          account_id: testAccount.id,
        });
        assert.equal(r1.status, 403);

        // 2. List accounts
        const r2 = await request('/api/v1/accounts', staffA, undefined);
        assert.equal(r2.status, 403);

        // 3. Create account
        const r3 = await request('/api/v1/accounts', staffA, {
          platform: 'gmail',
          username: 'staff_hack@gmail.com',
        });
        assert.equal(r3.status, 403);

        // 4. Get account
        const r4 = await request(
          `/api/v1/accounts/${testAccount.id}`,
          staffA,
          undefined,
        );
        assert.equal(r4.status, 403);

        // 5. Update account
        const r5 = await request(
          `/api/v1/accounts/${testAccount.id}`,
          staffA,
          { notes: 'tampered by staff' },
          { 'If-Match': '1' },
          'PATCH',
        );
        assert.equal(r5.status, 403);

        // 6. Archive account
        const r6 = await request(
          `/api/v1/accounts/${testAccount.id}/archive`,
          staffA,
          { reason: 'staff archive attempt' },
          { 'If-Match': '1' },
        );
        assert.equal(r6.status, 403);

        // 7. Restore account
        const r7 = await request(
          `/api/v1/accounts/${testAccount.id}/restore`,
          staffA,
          {},
          { 'If-Match': '1' },
        );
        assert.equal(r7.status, 403);

        // 8. Put secret
        const r8 = await request(
          `/api/v1/accounts/${testAccount.id}/secrets`,
          staffA,
          {
            secret_type: 'password',
            secret_value: 'staff_secret',
            reauth_proof: dummyProof,
          },
          { 'If-Match': '1' },
          'PUT',
        );
        assert.equal(r8.status, 403);

        // 9. Reveal secret
        const r9 = await request(
          `/api/v1/accounts/${testAccount.id}/secrets/reveal`,
          staffA,
          {
            secret_type: 'password',
            reauth_proof: dummyProof,
          },
        );
        assert.equal(r9.status, 403);
      },
    );

    // S02: Multi-tenant Workspace Isolation - Cross-workspace access concealed with 404
    await t.test(
      'S02: Multi-tenant workspace isolation - Cross-workspace resources return 404',
      async () => {
        // Owner B tries to access Account of Workspace A
        const rGet = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerB,
          undefined,
        );
        assert.equal(rGet.status, 404);

        const rPatch = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerB,
          { notes: 'Cross-tenant edit' },
          { 'If-Match': '1' },
          'PATCH',
        );
        assert.equal(rPatch.status, 404);

        const rArchive = await request(
          `/api/v1/accounts/${testAccount.id}/archive`,
          ownerB,
          { reason: 'Cross-tenant archive' },
          { 'If-Match': '1' },
        );
        assert.equal(rArchive.status, 404);

        const rReauth = await request('/api/v1/auth/reauth', ownerB, {
          password: ownerB.pw,
          action: 'secret_reveal',
          account_id: testAccount.id,
        });
        assert.equal(rReauth.status, 404);

        const rPutSec = await request(
          `/api/v1/accounts/${testAccount.id}/secrets`,
          ownerB,
          {
            secret_type: 'password',
            secret_value: 'cross-sec',
            reauth_proof: crypto.randomBytes(32).toString('hex'),
          },
          { 'If-Match': '1' },
          'PUT',
        );
        assert.equal(rPutSec.status, 404);

        // List in Workspace B should NOT include Account from Workspace A
        const rList = await request('/api/v1/accounts', ownerB, undefined);
        assert.equal(rList.status, 200);
        const itemIds = rList.data.data.items.map((i) => i.id);
        assert.ok(!itemIds.includes(testAccount.id));
      },
    );

    // S03: Reauth Protocol Security
    await t.test('S03: Reauth protocol security and lifecycle', async () => {
      // 1. Wrong password fails with 401
      const wrongPwRes = await request('/api/v1/auth/reauth', ownerA, {
        password: 'wrong_password_123',
        action: 'secret_write',
        account_id: testAccount.id,
      });
      assert.equal(wrongPwRes.status, 401);

      // 2. Invalid action fails with 400
      const badActionRes = await request('/api/v1/auth/reauth', ownerA, {
        password: ownerA.pw,
        action: 'secret_delete',
        account_id: testAccount.id,
      });
      assert.equal(badActionRes.status, 400);

      // 3. Issue valid proof for secret_write
      const writeReauth = await request('/api/v1/auth/reauth', ownerA, {
        password: ownerA.pw,
        action: 'secret_write',
        account_id: testAccount.id,
      });
      assert.equal(writeReauth.status, 200);
      assert.equal(writeReauth.headers.get('cache-control'), 'no-store');
      const writeProof = writeReauth.data.data.reauth_proof;
      assert.equal(typeof writeProof, 'string');
      assert.equal(writeProof.length, 64); // 32 bytes hex

      // 4. Action mismatch: proof issued for 'secret_write' cannot be used for 'secret_reveal'
      const mismatchActionRes = await request(
        `/api/v1/accounts/${testAccount.id}/secrets/reveal`,
        ownerA,
        {
          secret_type: 'password',
          reauth_proof: writeProof,
        },
      );
      assert.equal(mismatchActionRes.status, 403);

      // 5. Account mismatch: create account 2 and try to use Account 1 proof on Account 2
      const acc2Res = await request('/api/v1/accounts', ownerA, {
        platform: 'gmail',
        username: 'acc2@gmail.com',
      });
      const account2 = acc2Res.data.data;
      const mismatchAccRes = await request(
        `/api/v1/accounts/${account2.id}/secrets`,
        ownerA,
        {
          secret_type: 'password',
          secret_value: 'val',
          reauth_proof: writeProof,
        },
        { 'If-Match': '1' },
        'PUT',
      );
      assert.equal(mismatchAccRes.status, 403);

      // 6. Valid secret write with writeProof
      const putRes = await request(
        `/api/v1/accounts/${testAccount.id}/secrets`,
        ownerA,
        {
          secret_type: 'password',
          secret_value: 'SuperSecret!2026',
          reauth_proof: writeProof,
        },
        { 'If-Match': '1' },
        'PUT',
      );
      assert.equal(putRes.status, 200);
      assert.equal(putRes.data.data.secret_version, 1);
      assert.equal(putRes.headers.get('cache-control'), 'no-store');

      // 7. Single-use: exact same proof cannot be reused
      const reuseRes = await request(
        `/api/v1/accounts/${testAccount.id}/secrets`,
        ownerA,
        {
          secret_type: 'password',
          secret_value: 'AnotherSecret!2026',
          reauth_proof: writeProof,
        },
        { 'If-Match': '2' },
        'PUT',
      );
      assert.equal(reuseRes.status, 403);

      // 8. Expired proof validation
      const expReauth = await request('/api/v1/auth/reauth', ownerA, {
        password: ownerA.pw,
        action: 'secret_reveal',
        account_id: testAccount.id,
      });
      assert.equal(expReauth.status, 200);
      const expProof = expReauth.data.data.reauth_proof;

      // Manually backdate expiration in DB
      await pool.query(
        `UPDATE account_reauth_proofs
         SET expires_at = clock_timestamp() - interval '10 minutes'
         WHERE account_id = $1 AND action = 'secret_reveal';`,
        [testAccount.id],
      );

      const expRevealRes = await request(
        `/api/v1/accounts/${testAccount.id}/secrets/reveal`,
        ownerA,
        {
          secret_type: 'password',
          reauth_proof: expProof,
        },
      );
      assert.equal(expRevealRes.status, 403);

      // 9. Session revocation invalidates unconsumed proofs
      const sessReauth = await request('/api/v1/auth/reauth', ownerA, {
        password: ownerA.pw,
        action: 'secret_reveal',
        account_id: testAccount.id,
      });
      const sessProof = sessReauth.data.data.reauth_proof;

      // Revoke ownerA's session
      await pool.query(
        `UPDATE auth_sessions
         SET revoked_at = clock_timestamp()
         WHERE user_id = $1;`,
        [ownerA.id],
      );

      const revokedReveal = await request(
        `/api/v1/accounts/${testAccount.id}/secrets/reveal`,
        ownerA,
        {
          secret_type: 'password',
          reauth_proof: sessProof,
        },
      );
      assert.equal(revokedReveal.status, 401);
    });

    // Re-login ownerA after session revocation test
    const reLogin = await request('/api/v1/auth/login', null, {
      identifier: ownerA.username,
      password: ownerA.pw,
    });
    ownerA.cookie = reLogin.cookie.split(';')[0];
    ownerA.csrf = reLogin.data.data.csrf_token;

    // S04: Zero Secret Leakage in listing, detail, and audit trails
    await t.test(
      'S04: Zero secret leakage in API responses and database audits',
      async () => {
        // List accounts
        const listRes = await request('/api/v1/accounts', ownerA, undefined);
        assert.equal(listRes.status, 200);
        for (const item of listRes.data.data.items) {
          assert.equal(item.secret, undefined);
          assert.equal(item.secret_value, undefined);
          assert.equal(item.ciphertext, undefined);
          assert.equal(item.nonce, undefined);
          assert.equal(item.auth_tag, undefined);
        }

        // Get account detail
        const detailRes = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerA,
          undefined,
        );
        assert.equal(detailRes.status, 200);
        assert.equal(detailRes.data.data.has_secret, true);
        assert.deepEqual(detailRes.data.data.secret_types, ['password']);
        assert.equal(detailRes.data.data.secret, undefined);
        assert.equal(detailRes.data.data.secret_value, undefined);
        assert.equal(detailRes.data.data.ciphertext, undefined);

        // Audit events must never contain secret plaintext or ciphertext
        const auditRes = await pool.query(
          `SELECT metadata_sanitized FROM audit_events
           WHERE entity_id = $1;`,
          [testAccount.id],
        );
        for (const row of auditRes.rows) {
          const str = JSON.stringify(row.metadata_sanitized || {});
          assert.ok(!str.includes('SuperSecret!2026'));
          assert.ok(!str.includes('ciphertext'));
          assert.ok(!str.includes('nonce'));
        }
      },
    );

    // S05: Cryptographic AEAD Integrity and Tamper Detection
    await t.test(
      'S05: AEAD (AES-256-GCM) encryption and tamper detection',
      async () => {
        // Issue fresh reveal proof
        const revReauth = await request('/api/v1/auth/reauth', ownerA, {
          password: ownerA.pw,
          action: 'secret_reveal',
          account_id: testAccount.id,
        });
        assert.equal(revReauth.status, 200);
        const revProof = revReauth.data.data.reauth_proof;

        // Reveal secret successfully
        const revealRes = await request(
          `/api/v1/accounts/${testAccount.id}/secrets/reveal`,
          ownerA,
          {
            secret_type: 'password',
            reauth_proof: revProof,
          },
        );
        assert.equal(revealRes.status, 200);
        assert.equal(revealRes.data.data.secret_value, 'SuperSecret!2026');
        assert.equal(revealRes.headers.get('cache-control'), 'no-store');

        // Check raw DB storage: ciphertext, nonce (12 bytes), auth_tag (16 bytes)
        const secRowRes = await pool.query(
          `SELECT ciphertext, nonce, auth_tag, encryption_schema_version
           FROM account_secrets
           WHERE account_id = $1 AND secret_type = 'password';`,
          [testAccount.id],
        );
        assert.equal(secRowRes.rows.length, 1);
        const secRow = secRowRes.rows[0];
        assert.equal(secRow.nonce.length, 12);
        assert.equal(secRow.auth_tag.length, 16);
        assert.equal(secRow.encryption_schema_version, 1);
        const rawCiphertext = Buffer.isBuffer(secRow.ciphertext)
          ? secRow.ciphertext.toString('hex')
          : String(secRow.ciphertext);
        assert.ok(!rawCiphertext.includes('SuperSecret!2026'));

        // Tamper test 1: Flip byte in ciphertext -> AEAD integrity check must fail
        const originalCiphertext = secRow.ciphertext;
        const tamperedCiphertext = Buffer.from(originalCiphertext);
        tamperedCiphertext[0] = tamperedCiphertext[0] ^ 0xff;
        await pool.query(
          `UPDATE account_secrets SET ciphertext = $1 WHERE account_id = $2;`,
          [tamperedCiphertext, testAccount.id],
        );

        const tamperReauth1 = await request('/api/v1/auth/reauth', ownerA, {
          password: ownerA.pw,
          action: 'secret_reveal',
          account_id: testAccount.id,
        });
        const tamperReveal1 = await request(
          `/api/v1/accounts/${testAccount.id}/secrets/reveal`,
          ownerA,
          {
            secret_type: 'password',
            reauth_proof: tamperReauth1.data.data.reauth_proof,
          },
        );
        assert.equal(tamperReveal1.status, 500); // AEAD integrity failure

        // Restore ciphertext
        await pool.query(
          `UPDATE account_secrets SET ciphertext = $1 WHERE account_id = $2;`,
          [originalCiphertext, testAccount.id],
        );

        // Tamper test 2: Cross-account swap attack
        // Create account 3 in workspace A and copy account 1's secret row into account 3
        const acc3Res = await request('/api/v1/accounts', ownerA, {
          platform: 'ai',
          username: 'claude_acc',
        });
        const account3 = acc3Res.data.data;

        await pool.query(
          `INSERT INTO account_secrets (
            workspace_id, account_id, secret_type, ciphertext, nonce, auth_tag, key_version, encryption_schema_version, secret_version
          ) VALUES ($1, $2, 'password', $3, $4, $5, 'v1', 1, 1);`,
          [
            workspaceA,
            account3.id,
            secRow.ciphertext,
            secRow.nonce,
            secRow.auth_tag,
          ],
        );

        const swapReauth = await request('/api/v1/auth/reauth', ownerA, {
          password: ownerA.pw,
          action: 'secret_reveal',
          account_id: account3.id,
        });
        const swapReveal = await request(
          `/api/v1/accounts/${account3.id}/secrets/reveal`,
          ownerA,
          {
            secret_type: 'password',
            reauth_proof: swapReauth.data.data.reauth_proof,
          },
        );
        // Must fail with 500 because AAD binds account_id!
        assert.equal(swapReveal.status, 500);
      },
    );

    // S06: Fail-closed without Key
    await t.test(
      'S06: Secret vault fails closed with 503 when encryption key is missing',
      async () => {
        noKeyServer = http.createServer(
          createRequestHandler({
            pool,
            csrfSecret: crypto.randomBytes(32).toString('hex'),
            allowedOrigins: [origin],
            isProduction: false,
            accountSecretKey: undefined, // NO KEY
          }),
        );
        await new Promise((r) => noKeyServer.listen(0, '127.0.0.1', r));
        const noKeyBase = 'http://127.0.0.1:' + noKeyServer.address().port;

        // Login on noKeyServer
        const rLogin = await fetch(noKeyBase + '/api/v1/auth/login', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: ownerA.username,
            password: ownerA.pw,
          }),
        });
        const loginData = await rLogin.json();
        const cookie = rLogin.headers.get('set-cookie').split(';')[0];
        const csrf = loginData.data.csrf_token;

        // Metadata endpoint still works
        const rList = await fetch(noKeyBase + '/api/v1/accounts', {
          headers: { Origin: origin, Cookie: cookie },
        });
        assert.equal(rList.status, 200);

        // Put secret on noKeyServer fails with 503
        const rPut = await fetch(
          `${noKeyBase}/api/v1/accounts/${testAccount.id}/secrets`,
          {
            method: 'PUT',
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              Cookie: cookie,
              'X-CSRF-Token': csrf,
              'If-Match': '2',
            },
            body: JSON.stringify({
              secret_type: 'password',
              secret_value: 'keyless_secret',
              reauth_proof: 'dummy',
            }),
          },
        );
        assert.equal(rPut.status, 503);
      },
    );

    // S07: Concurrency & Optimistic Locking (If-Match)
    await t.test(
      'S07: Concurrency & optimistic locking on metadata and secrets',
      async () => {
        // Query current account version
        const curAccRes = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerA,
          undefined,
        );
        const curVer = curAccRes.data.data.version;

        // PATCH missing If-Match -> 428
        const p1 = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerA,
          { notes: 'Patch test' },
          {},
          'PATCH',
        );
        assert.equal(p1.status, 428);

        // PATCH stale If-Match -> 412
        const p2 = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerA,
          { notes: 'Patch test' },
          { 'If-Match': '9999' },
          'PATCH',
        );
        assert.equal(p2.status, 412);

        // PATCH valid If-Match -> 200, version increments
        const p3 = await request(
          `/api/v1/accounts/${testAccount.id}`,
          ownerA,
          { notes: 'Patched successfully' },
          { 'If-Match': String(curVer) },
          'PATCH',
        );
        assert.equal(p3.status, 200);
        const verAfterPatch = p3.data.data.version;
        assert.equal(verAfterPatch, curVer + 1);

        // Archive with stale If-Match -> 412
        const a1 = await request(
          `/api/v1/accounts/${testAccount.id}/archive`,
          ownerA,
          { reason: 'Archiving' },
          { 'If-Match': String(curVer) },
        );
        assert.equal(a1.status, 412);

        // Archive with valid If-Match -> 200
        const a2 = await request(
          `/api/v1/accounts/${testAccount.id}/archive`,
          ownerA,
          { reason: 'Archiving' },
          { 'If-Match': String(verAfterPatch) },
        );
        assert.equal(a2.status, 200);
        assert.equal(a2.data.data.status, 'archived');
        const verAfterArchive = a2.data.data.version;
        assert.equal(verAfterArchive, verAfterPatch + 1);

        // Archive already archived -> 409 Conflict
        const a3 = await request(
          `/api/v1/accounts/${testAccount.id}/archive`,
          ownerA,
          { reason: 'Duplicate archive' },
          { 'If-Match': String(verAfterArchive) },
        );
        assert.equal(a3.status, 409);

        // Restore with valid If-Match -> 200
        const r1 = await request(
          `/api/v1/accounts/${testAccount.id}/restore`,
          ownerA,
          {},
          { 'If-Match': String(verAfterArchive) },
        );
        assert.equal(r1.status, 200);
        assert.equal(r1.data.data.status, 'active');
        const verAfterRestore = r1.data.data.version;
        assert.equal(verAfterRestore, verAfterArchive + 1);

        // Restore already active -> 409 Conflict
        const r2 = await request(
          `/api/v1/accounts/${testAccount.id}/restore`,
          ownerA,
          {},
          { 'If-Match': String(verAfterRestore) },
        );
        assert.equal(r2.status, 409);
      },
    );

    // S08: CSRF Protection
    await t.test('S08: CSRF and Origin protection on mutations', async () => {
      // Mutating request without CSRF token -> 403
      const noCsrf = await fetch(`${base}/api/v1/accounts/${testAccount.id}`, {
        method: 'PATCH',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: ownerA.cookie,
          'If-Match': '5',
        },
        body: JSON.stringify({ notes: 'CSRF attack' }),
      });
      assert.equal(noCsrf.status, 403);

      // Mutating request with invalid origin -> 403
      const badOrigin = await fetch(
        `${base}/api/v1/accounts/${testAccount.id}`,
        {
          method: 'PATCH',
          headers: {
            Origin: 'http://malicious-site.com',
            'Content-Type': 'application/json',
            Cookie: ownerA.cookie,
            'X-CSRF-Token': ownerA.csrf,
            'If-Match': '5',
          },
          body: JSON.stringify({ notes: 'Bad origin attack' }),
        },
      );
      assert.equal(badOrigin.status, 403);
    });

    // S09: Immutable Audit Log (secret_access_events)
    await t.test(
      'S09: Immutable audit history and trigger protection',
      async () => {
        // Query secret access events for testAccount
        const evRes = await pool.query(
          `SELECT action, actor_user_id, request_id
           FROM secret_access_events
           WHERE account_id = $1
           ORDER BY created_at ASC;`,
          [testAccount.id],
        );
        assert.ok(evRes.rows.length >= 3);
        const actions = evRes.rows.map((r) => r.action);
        assert.ok(actions.includes('write'));
        assert.ok(actions.includes('reveal'));
        assert.ok(actions.includes('archive'));
        assert.ok(actions.includes('restore'));

        // Direct DB UPDATE on secret_access_events must be blocked by trigger
        await assert.rejects(
          pool.query(
            `UPDATE secret_access_events SET action = 'tampered' WHERE account_id = $1;`,
            [testAccount.id],
          ),
          /immutable/i,
        );

        // Direct DB DELETE on secret_access_events must be blocked by trigger
        await assert.rejects(
          pool.query(
            `DELETE FROM secret_access_events WHERE account_id = $1;`,
            [testAccount.id],
          ),
          /immutable/i,
        );
      },
    );

    // S10: Extended Account Management fields & multi-secret AEAD vault
    await t.test(
      'S10: Extended fields (recovery_email, account_group, assigned_employee_id, status) and multi-secret AEAD vault (password, two_fa_secret, email_password)',
      async () => {
        // Create an employee in workspaceA to assign to account
        const empId = crypto.randomUUID();
        const empUserId = crypto.randomUUID();
        const empMembershipId = crypto.randomUUID();
        const empSuffix = crypto.randomBytes(4).toString('hex');
        const empCode = `NV-ACC-${empSuffix.toUpperCase()}`;
        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status)
           VALUES ($1, $2, $3, 'active');`,
          [empUserId, `nv_acc_${empSuffix}`, `nv_acc_${empSuffix}@test.local`],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
           VALUES ($1, $2, $3, 'staff', 'active');`,
          [empMembershipId, workspaceA, empUserId],
        );
        await pool.query(
          `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status)
           VALUES ($1, $2, $3, $4, 'Trần Phụ Trách Kênh', 'active');`,
          [empId, workspaceA, empUserId, empCode],
        );

        // 1. Create account with recovery_email, account_group, assigned_employee_id, and initial_secrets
        const createEnhancedRes = await request('/api/v1/accounts', ownerA, {
          platform: 'tiktok',
          username: 'shop_flagship_vn',
          platform_account_id: 'UID-99887766',
          recovery_email: 'recovery.flagship@hoaiphuong.click',
          account_group: 'Marketing',
          assigned_employee_id: empId,
          notes: 'Kênh TikTok chính thức',
          initial_secrets: [
            { secret_type: 'password', secret_value: 'AccPass!2026' },
            { secret_type: 'two_fa_secret', secret_value: 'JBSWY3DPEHPK3PXP' },
            { secret_type: 'email_password', secret_value: 'MailPass#999' },
          ],
        });
        assert.equal(createEnhancedRes.status, 201);
        const enhAcc = createEnhancedRes.data.data;
        assert.equal(enhAcc.username, 'shop_flagship_vn');
        assert.equal(enhAcc.platform_account_id, 'UID-99887766');
        assert.equal(
          enhAcc.recovery_email,
          'recovery.flagship@hoaiphuong.click',
        );
        assert.equal(enhAcc.account_group, 'Marketing');
        assert.equal(enhAcc.assigned_employee_id, empId);
        assert.equal(enhAcc.assigned_employee_name, 'Trần Phụ Trách Kênh');
        assert.equal(enhAcc.assigned_employee_code, empCode);
        // Never leak secrets in create response
        assert.equal(enhAcc.password, undefined);
        assert.equal(enhAcc.email_password, undefined);
        assert.equal(enhAcc.two_fa_secret, undefined);

        // 2. Detail API lists secret_types without returning secret values
        const enhDetailRes = await request(
          `/api/v1/accounts/${enhAcc.id}`,
          ownerA,
          undefined,
        );
        assert.equal(enhDetailRes.status, 200);
        assert.equal(enhDetailRes.data.data.has_secret, true);
        assert.ok(enhDetailRes.data.data.secret_types.includes('password'));
        assert.ok(
          enhDetailRes.data.data.secret_types.includes('two_fa_secret'),
        );
        assert.ok(
          enhDetailRes.data.data.secret_types.includes('email_password'),
        );
        assert.equal(enhDetailRes.data.data.secret_value, undefined);

        // 3. Filter list by account_group and assigned_employee_id
        const filterGrpRes = await request(
          `/api/v1/accounts?account_group=Marketing&assigned_employee_id=${empId}`,
          ownerA,
          undefined,
        );
        assert.equal(filterGrpRes.status, 200);
        assert.equal(filterGrpRes.data.data.items.length, 1);
        assert.equal(filterGrpRes.data.data.items[0].id, enhAcc.id);

        // 4. Reveal two_fa_secret and email_password via single-use reauth_proof
        for (const [secType, expectedVal] of [
          ['two_fa_secret', 'JBSWY3DPEHPK3PXP'],
          ['email_password', 'MailPass#999'],
        ]) {
          const rAuth = await request('/api/v1/auth/reauth', ownerA, {
            password: ownerA.pw,
            action: 'secret_reveal',
            account_id: enhAcc.id,
          });
          assert.equal(rAuth.status, 200);
          const rev = await request(
            `/api/v1/accounts/${enhAcc.id}/secrets/reveal`,
            ownerA,
            {
              secret_type: secType,
              reauth_proof: rAuth.data.data.reauth_proof,
            },
          );
          assert.equal(rev.status, 200);
          assert.equal(rev.data.data.secret_value, expectedVal);
        }

        // 5. Update metadata (recovery_email, account_group, status = archived)
        const patchEnhRes = await request(
          `/api/v1/accounts/${enhAcc.id}`,
          ownerA,
          {
            recovery_email: 'updated.recovery@hoaiphuong.click',
            account_group: 'Sales',
            status: 'archived',
          },
          { 'If-Match': String(enhAcc.version) },
          'PATCH',
        );
        assert.equal(patchEnhRes.status, 200);
        assert.equal(
          patchEnhRes.data.data.recovery_email,
          'updated.recovery@hoaiphuong.click',
        );
        assert.equal(patchEnhRes.data.data.account_group, 'Sales');
        assert.equal(patchEnhRes.data.data.status, 'archived');
      },
    );
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    if (noKeyServer) {
      await new Promise((r) => noKeyServer.close(r));
    }
    await pool.end();
  }
});
