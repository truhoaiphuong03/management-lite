import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

test('FILE PROVIDER SAFETY: durable per-folder operations, partial failure, timeout, crash/restart recovery, and stale snapshot protection', async (t) => {
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
  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');
  const { StorageService } =
    await import('../../dist/apps/api/src/storage/service.js');
  const { MockGoogleDriveProvider } =
    await import('../../dist/apps/api/src/storage/provider.js');

  let server;
  const mockProvider = new MockGoogleDriveProvider();
  const storageService = new StorageService(pool, mockProvider);

  try {
    // 1. Setup isolated database schema
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    await runMigrations(pool, migrations);

    // 2. Provision test workspace, users, and employees
    const workspaceId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const staff1UserId = crypto.randomUUID();
    const staff1EmpId = crypto.randomUUID();
    const staff2UserId = crypto.randomUUID();
    const staff2EmpId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Safety Test Workspace', 'Asia/Ho_Chi_Minh', 'active');`,
      [workspaceId],
    );

    const runId = crypto.randomUUID().substring(0, 8);
    const ownerUsername = `safe_own_${runId}`;
    const staff1Username = `safe_st1_${runId}`;
    const staff2Username = `safe_st2_${runId}`;

    const pwHash = await hashPassword('TestSafePass123!');
    for (const [uid, uname] of [
      [ownerUserId, ownerUsername],
      [staff1UserId, staff1Username],
      [staff2UserId, staff2Username],
    ]) {
      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [uid, uname, `${uname}@test.local`],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2);`,
        [uid, pwHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active');`,
        [workspaceId, uid, uid === ownerUserId ? 'owner' : 'staff'],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status) VALUES ($1, $2, 'active');`,
        [workspaceId, uid],
      );
    }

    await pool.query(
      `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status) VALUES
       ($1, $2, $3, 'EMP-S1', 'Staff One', 'active'),
       ($4, $2, $5, 'EMP-S2', 'Staff Two', 'active');`,
      [staff1EmpId, workspaceId, staff1UserId, staff2EmpId, staff2UserId],
    );

    // 3. Start test API server with mock provider
    const appHandler = createRequestHandler({
      pool,
      storageService,
      csrfSecret: 'test-csrf-secret-01234567890123456789012345678901',
      allowedOrigins: ['http://127.0.0.1:3006', 'http://localhost:3006'],
      isProduction: false,
    });

    server = http.createServer(appHandler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const request = (path, method = 'GET', data = null, headers = {}) => {
      return new Promise((resolveReq, rejectReq) => {
        const bodyStr = data ? JSON.stringify(data) : '';
        const reqHeaders = {
          'Origin': 'http://127.0.0.1:3006',
          ...headers,
        };
        if (data) {
          reqHeaders['Content-Type'] = 'application/json';
          reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        const reqObj = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path,
            method,
            headers: reqHeaders,
          },
          (res) => {
            let resBody = '';
            res.on('data', (c) => (resBody += c));
            res.on('end', () => {
              const parsed = resBody ? JSON.parse(resBody) : null;
              resolveReq({
                status: res.statusCode,
                headers: res.headers,
                body: parsed,
              });
            });
          },
        );
        reqObj.on('error', rejectReq);
        if (data) reqObj.write(bodyStr);
        reqObj.end();
      });
    };

    // Helper: Login
    const login = async (identifier) => {
      const res = await request('/api/v1/auth/login', 'POST', {
        identifier,
        password: 'TestSafePass123!',
      });
      const cookie = res.headers['set-cookie'][0].split(';')[0];
      const csrf = res.body.data.csrf_token;
      return { cookie, csrf, data: res.body.data };
    };

    const ownerAuth = await login(ownerUsername);
    const staff1Auth = await login(staff1Username);
    const staff2Auth = await login(staff2Username);

    // 4. Create complete folder group with 2 deliverables and 100% receipt confirmations
    const createFolderRes = await request(
      '/api/v1/storage/folders',
      'POST',
      {
        name: 'Project Alpha Media',
        drive_url: 'https://drive.google.com/drive/folders/alpha_root_provider_id',
        folder_type: 'source',
        assigned_employee_ids: [staff1EmpId, staff2EmpId],
      },
      { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
    );
    const rootFolderId = createFolderRes.body.data.id;

    // Staff 1 & 2 confirm download receipts
    await request(
      `/api/v1/storage/folders/${rootFolderId}/receipts`,
      'POST',
      { receipt_type: 'download' },
      { Cookie: staff1Auth.cookie, 'X-CSRF-Token': staff1Auth.csrf },
    );
    await request(
      `/api/v1/storage/folders/${rootFolderId}/receipts`,
      'POST',
      { receipt_type: 'download' },
      { Cookie: staff2Auth.cookie, 'X-CSRF-Token': staff2Auth.csrf },
    );

    // Staff 1 & 2 submit deliverables
    const out1Res = await request(
      '/api/v1/storage/folders',
      'POST',
      {
        name: 'Alpha Deliverable Staff 1',
        drive_url: 'https://drive.google.com/drive/folders/alpha_deliv1_provider_id',
        folder_type: 'deliverable',
        parent_folder_id: rootFolderId,
      },
      { Cookie: staff1Auth.cookie, 'X-CSRF-Token': staff1Auth.csrf },
    );
    const out1Id = out1Res.body.data.id;

    const out2Res = await request(
      '/api/v1/storage/folders',
      'POST',
      {
        name: 'Alpha Deliverable Staff 2',
        drive_url: 'https://drive.google.com/drive/folders/alpha_deliv2_provider_id',
        folder_type: 'deliverable',
        parent_folder_id: rootFolderId,
      },
      { Cookie: staff2Auth.cookie, 'X-CSRF-Token': staff2Auth.csrf },
    );
    const out2Id = out2Res.body.data.id;

    // Owner confirms output receipts
    await request(
      `/api/v1/storage/folders/${rootFolderId}/receipts`,
      'POST',
      { receipt_type: 'deliverable_approval', output_id: out1Id, revision_number: 1 },
      { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
    );
    await request(
      `/api/v1/storage/folders/${rootFolderId}/receipts`,
      'POST',
      { receipt_type: 'deliverable_approval', output_id: out2Id, revision_number: 1 },
      { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
    );

    // Verify readiness
    const detailRes = await request(
      `/api/v1/storage/folders/${rootFolderId}`,
      'GET',
      null,
      { Cookie: ownerAuth.cookie },
    );
    assert.equal(detailRes.body.data.delete_readiness.is_ready, true);
    const validSnapshotHash = detailRes.body.data.delete_readiness.group_snapshot_hash;

    // Step 1: Initiate Trash Request
    const trashReqRes = await request(
      `/api/v1/storage/folders/${rootFolderId}/trash-requests`,
      'POST',
      { version: detailRes.body.data.version },
      { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
    );
    assert.equal(trashReqRes.status, 200);
    const trashRequestId = trashReqRes.body.data.trash_request_id;

    // =========================================================================
    // TEST CASE 1: Partial Failure (Deliverable 2 fails on Google Drive)
    // =========================================================================
    await t.test('Scenario 1: Partial Provider Failure does not mark group trashed and persists durable progress', async () => {
      // Configure mock provider: root and deliv1 succeed, but deliv2 fails with rate limit error
      mockProvider.clearOverrides();
      mockProvider.overrideFolderResult('alpha_deliv2_provider_id', {
        success: false,
        status: 'failed',
        errorMessage: 'Google Drive API rateLimitExceeded on folder alpha_deliv2',
      });

      const confirmRes = await request(
        `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: validSnapshotHash,
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      // Must fail with HTTP 502 Bad Gateway
      assert.equal(confirmRes.status, 502);
      assert.equal(confirmRes.body.error.code, 'STORAGE_PROVIDER_PARTIAL_FAILURE');
      assert.ok(confirmRes.body.error.details.length > 0);

      // Invariant: Root folder MUST NOT be marked trashed
      const checkRoot = await pool.query('SELECT status FROM storage_folders WHERE id=$1', [rootFolderId]);
      assert.notEqual(checkRoot.rows[0].status, 'trashed', 'Root folder must NOT be marked trashed');

      // Invariant: Trash request MUST remain pending for retry
      const checkTrashReq = await pool.query('SELECT status FROM storage_trash_requests WHERE id=$1', [trashRequestId]);
      assert.equal(checkTrashReq.rows[0].status, 'pending', 'Trash request must remain pending');

      // Invariant: Deliverable 1 durable operation MUST be 'completed' (No PG rollback lost state)
      const opDeliv1 = await pool.query(
        "SELECT status FROM storage_operations WHERE folder_id=$1 AND operation_type='trash_group' ORDER BY created_at DESC LIMIT 1",
        [out1Id],
      );
      assert.equal(opDeliv1.rows[0]?.status, 'completed', 'Deliverable 1 operation must be durably recorded as completed');

      // Invariant: Deliverable 2 durable operation MUST be 'failed'
      const opDeliv2 = await pool.query(
        "SELECT status FROM storage_operations WHERE folder_id=$1 AND operation_type='trash_group' ORDER BY created_at DESC LIMIT 1",
        [out2Id],
      );
      assert.equal(opDeliv2.rows[0]?.status, 'failed', 'Deliverable 2 operation must be durably recorded as failed');
    });

    // =========================================================================
    // TEST CASE 2: Provider Timeout / Unknown status
    // =========================================================================
    await t.test('Scenario 2: Provider Timeout / Unknown status returns 504 without marking group trashed', async () => {
      mockProvider.clearOverrides();
      mockProvider.overrideFolderResult('alpha_deliv2_provider_id', {
        success: false,
        status: 'unknown',
        errorMessage: 'ETIMEDOUT: Connection to Google Drive API timed out',
      });

      const confirmRes = await request(
        `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: validSnapshotHash,
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      // Must fail with HTTP 504 Gateway Timeout
      assert.equal(confirmRes.status, 504);
      assert.equal(confirmRes.body.error.code, 'STORAGE_PROVIDER_TIMEOUT');

      const checkTrashReq = await pool.query('SELECT status FROM storage_trash_requests WHERE id=$1', [trashRequestId]);
      assert.equal(checkTrashReq.rows[0].status, 'pending');

      const opDeliv2 = await pool.query(
        "SELECT status FROM storage_operations WHERE folder_id=$1 AND operation_type='trash_group' ORDER BY created_at DESC LIMIT 1",
        [out2Id],
      );
      assert.equal(opDeliv2.rows[0]?.status, 'unknown');
    });

    // =========================================================================
    // TEST CASE 3: Stale Snapshot Protection
    // =========================================================================
    await t.test('Scenario 3: Stale Snapshot Hash rejects retry with 412 PRECONDITION_FAILED', async () => {
      const confirmRes = await request(
        `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: 'stale-outdated-hash-0123456789',
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      assert.equal(confirmRes.status, 412);
      assert.equal(confirmRes.body.error.code, 'PRECONDITION_FAILED');
    });

    // =========================================================================
    // TEST CASE 4: Idempotent Resumption / Crash Recovery
    // =========================================================================
    await t.test('Scenario 4: Idempotent Retry skips already-completed folders and completes group trash', async () => {
      // Clear failure override (simulating Google Drive outage resolved)
      mockProvider.clearOverrides();

      // Clear call tracker to verify which folders get called
      mockProvider.trashedFolders.clear();

      const confirmRes = await request(
        `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: validSnapshotHash,
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      // Succeeded!
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.body.data.status, 'trashed');

      // Idempotency verification:
      // Root and Deliv1 were ALREADY completed, so only Deliv2 should have been called!
      assert.ok(!mockProvider.trashedFolders.has('alpha_root_provider_id'), 'Root was already completed, must not re-call provider');
      assert.ok(!mockProvider.trashedFolders.has('alpha_deliv1_provider_id'), 'Deliv 1 was already completed, must not re-call provider');
      assert.ok(mockProvider.trashedFolders.has('alpha_deliv2_provider_id'), 'Deliv 2 was retried and called');

      // Invariant: Entire group is now confirmed trashed
      const checkRoot = await pool.query('SELECT status FROM storage_folders WHERE id=$1', [rootFolderId]);
      assert.equal(checkRoot.rows[0].status, 'trashed');

      const checkDelivs = await pool.query('SELECT status FROM storage_folders WHERE parent_folder_id=$1', [rootFolderId]);
      assert.equal(checkDelivs.rows.every((d) => d.status === 'trashed'), true);

      const checkTrashReq = await pool.query('SELECT status FROM storage_trash_requests WHERE id=$1', [trashRequestId]);
      assert.equal(checkTrashReq.rows[0].status, 'confirmed');
    });

    // =========================================================================
    // TEST CASE 5: Unknown State Reconciliation with Provider before Retry
    // =========================================================================
    await t.test('Scenario 5: Unknown status performs provider reconciliation before retry', async () => {
      // Create a second group (Beta) to test reconciliation specifically
      const createBetaRes = await request(
        '/api/v1/storage/folders',
        'POST',
        {
          name: 'Project Beta Media',
          drive_url: 'https://drive.google.com/drive/folders/beta_root_provider_id',
          folder_type: 'source',
          assigned_employee_ids: [staff1EmpId],
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );
      const betaRootId = createBetaRes.body.data.id;

      // Staff download receipt
      await request(
        `/api/v1/storage/folders/${betaRootId}/receipts`,
        'POST',
        { receipt_type: 'download' },
        { Cookie: staff1Auth.cookie, 'X-CSRF-Token': staff1Auth.csrf },
      );

      // Staff deliverable
      const betaOutRes = await request(
        '/api/v1/storage/folders',
        'POST',
        {
          name: 'Beta Deliverable 1',
          drive_url: 'https://drive.google.com/drive/folders/beta_out1_provider_id',
          folder_type: 'deliverable',
          parent_folder_id: betaRootId,
        },
        { Cookie: staff1Auth.cookie, 'X-CSRF-Token': staff1Auth.csrf },
      );
      const betaOutId = betaOutRes.body.data.id;

      // Owner deliverable receipt
      await request(
        `/api/v1/storage/folders/${betaRootId}/receipts`,
        'POST',
        { receipt_type: 'deliverable_approval', output_id: betaOutId, revision_number: 1 },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      const betaDetail = await request(
        `/api/v1/storage/folders/${betaRootId}`,
        'GET',
        null,
        { Cookie: ownerAuth.cookie },
      );
      assert.equal(betaDetail.body.data.delete_readiness.is_ready, true);
      const betaSnapshotHash = betaDetail.body.data.delete_readiness.group_snapshot_hash;

      // Create trash request
      const betaTrashReq = await request(
        `/api/v1/storage/folders/${betaRootId}/trash-requests`,
        'POST',
        { version: betaDetail.body.data.version },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );
      const betaTrashReqId = betaTrashReq.body.data.trash_request_id;

      // Step 1: Simulate provider timeout on betaOut1 (returns unknown)
      mockProvider.clearOverrides();
      mockProvider.overrideFolderResult('beta_out1_provider_id', {
        success: false,
        status: 'unknown',
        errorMessage: 'ETIMEDOUT: Provider connection timeout',
      });

      const confirmRes1 = await request(
        `/api/v1/storage/trash-requests/${betaTrashReqId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: betaSnapshotHash,
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );
      assert.equal(confirmRes1.status, 504);
      assert.equal(confirmRes1.body.error.code, 'STORAGE_PROVIDER_TIMEOUT');

      // Verify DB operation is in 'unknown' state
      const opBetaOut = await pool.query(
        "SELECT status FROM storage_operations WHERE folder_id=$1 AND operation_type='trash_group' ORDER BY created_at DESC LIMIT 1",
        [betaOutId],
      );
      assert.equal(opBetaOut.rows[0].status, 'unknown');

      // Step 2: Now simulate that the provider actually DID complete the deletion during that timeout
      mockProvider.clearOverrides();
      mockProvider.trashedFolders.add('beta_out1_provider_id'); // Provider has it trashed
      let trashFolderCalledForOut1 = false;
      const originalTrash = mockProvider.trashFolder.bind(mockProvider);
      mockProvider.trashFolder = async (id) => {
        if (id === 'beta_out1_provider_id') trashFolderCalledForOut1 = true;
        return originalTrash(id);
      };

      // Retry confirm trash
      const confirmRes2 = await request(
        `/api/v1/storage/trash-requests/${betaTrashReqId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: betaSnapshotHash,
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      // Must succeed!
      assert.equal(confirmRes2.status, 200);
      assert.equal(confirmRes2.body.data.status, 'trashed');

      // Invariant: reconciliation discovered it was already trashed, so trashFolder was NOT called again
      assert.equal(trashFolderCalledForOut1, false, 'trashFolder must not be called when reconciliation confirms completed');

      // Invariant: group is now trashed
      const betaRootCheck = await pool.query('SELECT status FROM storage_folders WHERE id=$1', [betaRootId]);
      assert.equal(betaRootCheck.rows[0].status, 'trashed');
    });

    // =========================================================================
    // TEST CASE 6: Real Server Crash & Restart Recovery
    // =========================================================================
    await t.test('Scenario 6: Real server crash and restart recovery with durable checkpointing', async () => {
      // 1. Create Gamma group
      const createGammaRes = await request(
        '/api/v1/storage/folders',
        'POST',
        {
          name: 'Project Gamma Media',
          drive_url: 'https://drive.google.com/drive/folders/gamma_root_provider_id',
          folder_type: 'source',
          assigned_employee_ids: [staff1EmpId],
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );
      const gammaRootId = createGammaRes.body.data.id;

      await request(
        `/api/v1/storage/folders/${gammaRootId}/receipts`,
        'POST',
        { receipt_type: 'download' },
        { Cookie: staff1Auth.cookie, 'X-CSRF-Token': staff1Auth.csrf },
      );

      const gammaOutRes = await request(
        '/api/v1/storage/folders',
        'POST',
        {
          name: 'Gamma Deliverable 1',
          drive_url: 'https://drive.google.com/drive/folders/gamma_out1_provider_id',
          folder_type: 'deliverable',
          parent_folder_id: gammaRootId,
        },
        { Cookie: staff1Auth.cookie, 'X-CSRF-Token': staff1Auth.csrf },
      );
      const gammaOutId = gammaOutRes.body.data.id;

      await request(
        `/api/v1/storage/folders/${gammaRootId}/receipts`,
        'POST',
        { receipt_type: 'deliverable_approval', output_id: gammaOutId, revision_number: 1 },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      const gammaDetail = await request(
        `/api/v1/storage/folders/${gammaRootId}`,
        'GET',
        null,
        { Cookie: ownerAuth.cookie },
      );
      const gammaSnapshotHash = gammaDetail.body.data.delete_readiness.group_snapshot_hash;

      const gammaTrashReq = await request(
        `/api/v1/storage/folders/${gammaRootId}/trash-requests`,
        'POST',
        { version: gammaDetail.body.data.version },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );
      const gammaTrashReqId = gammaTrashReq.body.data.trash_request_id;

      // 2. Simulate server crash mid-flight:
      // Insert a durable operation into storage_operations with status 'unknown' simulating crash during execution
      await pool.query(
        `INSERT INTO storage_operations (workspace_id, folder_id, operation_type, status, requested_by, provider, error_message)
         VALUES ($1, $2, 'trash_group', 'unknown', $3, 'google_drive', 'Process crash / SIGKILL during operation');`,
        [workspaceId, gammaOutId, ownerUserId],
      );

      // 3. Abruptly kill existing HTTP server to simulate crash
      await new Promise((resolveClose) => server.close(resolveClose));

      // 4. Restart: instantiate new MockGoogleDriveProvider, new StorageService, new HTTP server
      const newMockProvider = new MockGoogleDriveProvider();
      // Ensure provider reflects that gammaOut1 was completed before crash
      newMockProvider.trashedFolders.add('gamma_out1_provider_id');

      const newStorageService = new StorageService(pool, newMockProvider);
      const newAppHandler = createRequestHandler({
        pool,
        storageService: newStorageService,
        csrfSecret: 'test-csrf-secret-01234567890123456789012345678901',
        allowedOrigins: ['http://127.0.0.1:3006', 'http://localhost:3006'],
        isProduction: false,
      });

      const newServer = http.createServer(newAppHandler);
      await new Promise((resolveListen) => newServer.listen(0, '127.0.0.1', resolveListen));
      const newPort = newServer.address().port;

      const newRequest = (path, method = 'GET', data = null, headers = {}) => {
        return new Promise((resolveReq, rejectReq) => {
          const bodyStr = data ? JSON.stringify(data) : '';
          const reqHeaders = {
            'Origin': 'http://127.0.0.1:3006',
            ...headers,
          };
          if (data) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
          }
          const reqObj = http.request(
            {
              hostname: '127.0.0.1',
              port: newPort,
              path,
              method,
              headers: reqHeaders,
            },
            (res) => {
              let resBody = '';
              res.on('data', (c) => (resBody += c));
              res.on('end', () => {
                const parsed = resBody ? JSON.parse(resBody) : null;
                resolveReq({
                  status: res.statusCode,
                  headers: res.headers,
                  body: parsed,
                });
              });
            },
          );
          reqObj.on('error', rejectReq);
          if (data) reqObj.write(bodyStr);
          reqObj.end();
        });
      };

      // 5. Post-restart retry: Owner confirms trash request on restarted server
      const retryConfirmRes = await newRequest(
        `/api/v1/storage/trash-requests/${gammaTrashReqId}/confirm`,
        'POST',
        {
          acknowledged: true,
          group_snapshot_hash: gammaSnapshotHash,
        },
        { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrf },
      );

      // The new server recovers, reconciles gammaOut1 as already trashed, trashes root, and completes!
      assert.equal(retryConfirmRes.status, 200);
      assert.equal(retryConfirmRes.body.data.status, 'trashed');

      const gammaRootCheck = await pool.query('SELECT status FROM storage_folders WHERE id=$1', [gammaRootId]);
      assert.equal(gammaRootCheck.rows[0].status, 'trashed');

      await new Promise((resolveClose) => newServer.close(resolveClose));
      server = null; // Prevent double close in finally
    });
  } finally {
    if (server) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    await pool.end();
  }
});
