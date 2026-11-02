import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

test('FILE-01 Storage Backend: 8 API endpoints, contracts, revisions, receipts, delete_readiness, and group trash protocol', async (t) => {
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
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');

  let server;

  try {
    // 1. Verify migration catalog and schema
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    await t.test(
      'M09 Storage migration checksum, replay and schema validation',
      async () => {
        assert.ok(migrations.length >= 12);
        assert.equal(migrations.length, EMBEDDED_MIGRATIONS.length);
        for (let i = 0; i < migrations.length; i++) {
          assert.equal(migrations[i].checksum, EMBEDDED_MIGRATIONS[i].checksum);
        }
        const migResult = await runMigrations(pool, migrations);
        assert.equal(typeof migResult.appliedCount, 'number');

        // Verify tables exist
        const tblRes = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name IN (
               'storage_folders', 'folder_assignments', 'folder_revisions',
               'folder_receipts', 'storage_files', 'storage_trash_requests',
               'storage_operations', 'resource_access_grants'
             );`,
        );
        assert.equal(tblRes.rows.length, 8);
      },
    );

    // 2. Set up test workspaces and test server
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workspaces(id, name) VALUES
        ($1, 'Storage QA Workspace A'),
        ($2, 'Storage QA Workspace B')
       ON CONFLICT (id) DO NOTHING;`,
      [workspaceA, workspaceB],
    );

    const origin = 'http://localhost:3000';

    server = http.createServer(
      createRequestHandler({
        pool,
        csrfSecret: crypto.randomBytes(32).toString('hex'),
        allowedOrigins: [origin],
        isProduction: false,
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
    async function provisionActor(role, ws = workspaceA, name = 'Tester') {
      const id = crypto.randomUUID();
      const empId = crypto.randomUUID();
      const username = 'storqa_' + id.replaceAll('-', '').slice(0, 16);
      const email = `${username}@storage-qa.test`;
      const pw = 'StoragePass!2026#' + id.slice(0, 8);

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
         VALUES($1, $2, $3, $4, $5, 'active');`,
        [empId, ws, id, username, name],
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
        name,
        cookie: login.cookie.split(';')[0],
        csrf: login.data.data.csrf_token,
      };
    }

    const ownerA = await provisionActor('owner', workspaceA, 'Chủ sở hữu A');
    const staffA1 = await provisionActor('staff', workspaceA, 'Nhân sự A1');
    const staffA2 = await provisionActor('staff', workspaceA, 'Nhân sự A2');
    const ownerB = await provisionActor('owner', workspaceB, 'Chủ sở hữu B');

    let sourceFolderId;
    let deliverable1Id;
    let deliverable2Id;
    let snapshotHashForTrash;
    let trashRequestId;

    // 3. Test: Owner creates source folder with multiple assignments
    await t.test(
      'Owner creates source folder with assignments to Staff 1 and 2',
      async () => {
        // Staff tries to create source folder -> 403 Forbidden
        const staffCreate = await request('/api/v1/storage/folders', staffA1, {
          name: 'Staff unauthorized source',
          drive_url:
            'https://drive.google.com/drive/folders/unauthorized-staff-folder',
          folder_type: 'source',
        });
        assert.equal(staffCreate.status, 403);

        // Owner creates valid source folder
        const createRes = await request(
          '/api/v1/storage/folders',
          ownerA,
          {
            name: 'Video Dự Án Mùa Hè 2026',
            drive_url:
              'https://drive.google.com/drive/folders/1ABC_source_summer_2026',
            folder_type: 'source',
            assigned_employee_ids: [staffA1.empId, staffA2.empId],
            notes: 'Source footage and briefs',
          },
          { 'Idempotency-Key': 'idemp-source-create-01' },
        );

        assert.equal(createRes.status, 201);
        assert.equal(createRes.data.success, true);
        sourceFolderId = createRes.data.data.id;
        assert.equal(createRes.data.data.name, 'Video Dự Án Mùa Hè 2026');
        assert.equal(createRes.data.data.folder_type, 'source');
        assert.equal(createRes.data.data.status, 'ready_for_download');

        // Idempotency replay
        const replayRes = await request(
          '/api/v1/storage/folders',
          ownerA,
          {
            name: 'Video Dự Án Mùa Hè 2026',
            drive_url:
              'https://drive.google.com/drive/folders/1ABC_source_summer_2026',
            folder_type: 'source',
            assigned_employee_ids: [staffA1.empId, staffA2.empId],
            notes: 'Source footage and briefs',
          },
          { 'Idempotency-Key': 'idemp-source-create-01' },
        );
        assert.equal(replayRes.status, 201);
        assert.equal(replayRes.data.data.id, sourceFolderId);

        // Verify assignments in database
        const assignCheck = await pool.query(
          'SELECT * FROM folder_assignments WHERE folder_id = $1 ORDER BY employee_id',
          [sourceFolderId],
        );
        assert.equal(assignCheck.rows.length, 2);

        // Verify access grants
        const grantCheck = await pool.query(
          'SELECT * FROM resource_access_grants WHERE resource_id = $1',
          [sourceFolderId],
        );
        assert.equal(grantCheck.rows.length, 2);
      },
    );

    // 4. Test: List Folders respects RBAC and tenant isolation
    await t.test(
      'GET /api/v1/storage/folders respects RBAC and tenant isolation',
      async () => {
        // Owner A sees source folder
        const listOwner = await request('/api/v1/storage/folders', ownerA);
        assert.equal(listOwner.status, 200);
        assert.equal(listOwner.data.data.length >= 1, true);

        // Staff A1 sees source folder
        const listStaff1 = await request('/api/v1/storage/folders', staffA1);
        assert.equal(listStaff1.status, 200);
        assert.equal(
          listStaff1.data.data.some((f) => f.id === sourceFolderId),
          true,
        );

        // Owner B sees 0 folders (tenant isolated)
        const listOwnerB = await request('/api/v1/storage/folders', ownerB);
        assert.equal(listOwnerB.status, 200);
        assert.equal(
          listOwnerB.data.data.some((f) => f.id === sourceFolderId),
          false,
        );
      },
    );

    // 5. Test: Initial Delete-Readiness check (fail-closed)
    await t.test(
      'GET /api/v1/storage/folders/:id returns fail-closed delete_readiness initially',
      async () => {
        const detailRes = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        assert.equal(detailRes.status, 200);
        const data = detailRes.data.data;
        assert.equal(data.delete_readiness.is_ready, false);
        assert.equal(data.delete_readiness.total_assignments, 2);
        assert.equal(data.delete_readiness.confirmed_downloads, 0);
        assert.equal(data.delete_readiness.delivered_assignments, 0);
        assert.equal(data.delete_readiness.block_reasons.length >= 2, true);
      },
    );

    // 6. Test: Staff 1 & Staff 2 confirm download receipts
    await t.test(
      'POST /api/v1/storage/folders/:id/receipts records download receipts',
      async () => {
        // Staff 1 downloads
        const r1 = await request(
          `/api/v1/storage/folders/${sourceFolderId}/receipts`,
          staffA1,
          {
            receipt_type: 'download',
            notes: 'Downloaded by Staff 1',
          },
        );
        assert.equal(r1.status, 201);
        assert.equal(r1.data.data.receipt_type, 'download');

        // Check detail: confirmed_downloads is 1
        const detail1 = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        assert.equal(detail1.data.data.delete_readiness.confirmed_downloads, 1);
        assert.equal(detail1.data.data.delete_readiness.is_ready, false);

        // Staff 2 downloads
        const r2 = await request(
          `/api/v1/storage/folders/${sourceFolderId}/receipts`,
          staffA2,
          {
            receipt_type: 'download',
          },
        );
        assert.equal(r2.status, 201);

        // Check detail: confirmed_downloads is 2
        const detail2 = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        assert.equal(detail2.data.data.delete_readiness.confirmed_downloads, 2);
        assert.equal(
          detail2.data.data.delete_readiness.delivered_assignments,
          0,
        );
        assert.equal(detail2.data.data.delete_readiness.is_ready, false);
      },
    );

    // 7. Test: Partial Deliverable Submission & Partial Delete Block
    await t.test(
      'Partial deliverable submission blocks deletion (no partial delete invariant)',
      async () => {
        // Staff 1 submits deliverable
        const deliv1Res = await request('/api/v1/storage/folders', staffA1, {
          name: 'Thành phẩm Tập 1 - Staff 1',
          drive_url:
            'https://drive.google.com/drive/folders/1XYZ_deliverable_staff1',
          folder_type: 'deliverable',
          parent_folder_id: sourceFolderId,
        });
        assert.equal(deliv1Res.status, 201);
        deliverable1Id = deliv1Res.data.data.id;

        // Check delete readiness: Staff 2 has not delivered yet -> BLOCKED!
        const detailRes = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        const readiness = detailRes.data.data.delete_readiness;
        assert.equal(readiness.is_ready, false);
        assert.equal(readiness.delivered_assignments, 1);
        assert.equal(readiness.total_assignments, 2);
        assert.equal(
          readiness.block_reasons.some((r) =>
            r.includes('Không được phép xóa từng phần'),
          ),
          true,
        );

        // Owner attempts trash request -> rejected with 409 Conflict
        const trashReqAttempt = await request(
          `/api/v1/storage/folders/${sourceFolderId}/trash-requests`,
          ownerA,
          { version: 1 },
        );
        assert.equal(trashReqAttempt.status, 409);
        assert.equal(
          trashReqAttempt.data.error.code,
          'CANNOT_TRASH_INCOMPLETE_GROUP',
        );
      },
    );

    // 8. Test: Staff 2 submits deliverable, then Owner approvals by revision
    await t.test(
      'All deliverables submitted, verified and approved by exact revision',
      async () => {
        // Staff 2 submits deliverable
        const deliv2Res = await request('/api/v1/storage/folders', staffA2, {
          name: 'Thành phẩm Tập 2 - Staff 2',
          drive_url:
            'https://drive.google.com/drive/folders/2XYZ_deliverable_staff2',
          folder_type: 'deliverable',
          parent_folder_id: sourceFolderId,
        });
        assert.equal(deliv2Res.status, 201);
        deliverable2Id = deliv2Res.data.data.id;

        // Staff tries to approve deliverable -> 403 Forbidden
        const staffApprove = await request(
          `/api/v1/storage/folders/${sourceFolderId}/receipts`,
          staffA1,
          {
            receipt_type: 'deliverable_approval',
            output_id: deliverable1Id,
          },
        );
        assert.equal(staffApprove.status, 403);

        // Owner approves Deliverable 1
        const app1 = await request(
          `/api/v1/storage/folders/${sourceFolderId}/receipts`,
          ownerA,
          {
            receipt_type: 'deliverable_approval',
            output_id: deliverable1Id,
            revision_number: 1,
          },
        );
        assert.equal(app1.status, 201);

        // Readiness still false (Deliverable 2 not yet approved)
        const detail1 = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        assert.equal(detail1.data.data.delete_readiness.is_ready, false);

        // Owner approves Deliverable 2
        const app2 = await request(
          `/api/v1/storage/folders/${sourceFolderId}/receipts`,
          ownerA,
          {
            receipt_type: 'deliverable_approval',
            output_id: deliverable2Id,
            revision_number: 1,
          },
        );
        assert.equal(app2.status, 201);

        // Now all assignments delivered AND all outputs approved!
        const detail2 = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        const readiness = detail2.data.data.delete_readiness;
        assert.equal(readiness.is_ready, true);
        assert.equal(readiness.block_reasons.length, 0);
        assert.equal(typeof readiness.group_snapshot_hash, 'string');
        assert.equal(readiness.group_snapshot_hash.length, 64);
        snapshotHashForTrash = readiness.group_snapshot_hash;
      },
    );

    // 9. Test: Stale Revision Invariant (Doc 26 line 14: Trash vs folder revision change)
    await t.test(
      'Stale deliverable revision blocks group deletion until re-approved',
      async () => {
        // Simulate revision bump on Deliverable 1 (e.g. employee updated file on Drive)
        await pool.query(
          'UPDATE storage_folders SET current_revision_number = 2 WHERE id = $1',
          [deliverable1Id],
        );

        // Delete readiness must immediately become false
        const detailStale = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        assert.equal(detailStale.data.data.delete_readiness.is_ready, false);
        assert.equal(
          detailStale.data.data.delete_readiness.stale_output_revisions,
          1,
        );
        assert.equal(
          detailStale.data.data.delete_readiness.block_reasons.some((r) =>
            r.includes('biên nhận lạc hậu'),
          ),
          true,
        );

        // Re-approve revision 2
        const reApprove = await request(
          `/api/v1/storage/folders/${sourceFolderId}/receipts`,
          ownerA,
          {
            receipt_type: 'deliverable_approval',
            output_id: deliverable1Id,
            revision_number: 2,
          },
        );
        assert.equal(reApprove.status, 201);

        // Readiness restored to true
        const detailRestored = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerA,
        );
        assert.equal(detailRestored.data.data.delete_readiness.is_ready, true);
        snapshotHashForTrash =
          detailRestored.data.data.delete_readiness.group_snapshot_hash;
      },
    );

    // 10. Test: Step 1 of Group Trash (POST /trash-requests)
    await t.test(
      'POST /api/v1/storage/folders/:id/trash-requests initiates group trash',
      async () => {
        // Staff cannot initiate trash request
        const staffTrash = await request(
          `/api/v1/storage/folders/${sourceFolderId}/trash-requests`,
          staffA1,
          { version: 1 },
        );
        assert.equal(staffTrash.status, 403);

        // Stale If-Match check
        const staleIfMatch = await request(
          `/api/v1/storage/folders/${sourceFolderId}/trash-requests`,
          ownerA,
          { version: 1 },
          { 'If-Match': '"99"' },
        );
        assert.equal(staleIfMatch.status, 412);

        // Owner initiates valid trash request
        const reqRes = await request(
          `/api/v1/storage/folders/${sourceFolderId}/trash-requests`,
          ownerA,
          { version: 1 },
          { 'If-Match': '"1"' },
        );
        assert.equal(reqRes.status, 200);
        assert.equal(reqRes.data.success, true);
        const data = reqRes.data.data;
        assert.equal(data.folder_id, sourceFolderId);
        assert.equal(data.group_snapshot_hash, snapshotHashForTrash);
        assert.equal(data.deliverables_affected_count, 2);
        assert.equal(data.warning.includes('Google Drive'), true);
        trashRequestId = data.trash_request_id;
      },
    );

    // 11. Test: Step 2 of Group Trash (POST /trash-requests/:id/confirm)
    await t.test(
      'POST /api/v1/storage/trash-requests/:id/confirm moves group to Google Drive Trash',
      async () => {
        // Mismatched group_snapshot_hash rejected with 412
        const mismatch = await request(
          `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
          ownerA,
          {
            acknowledged: true,
            group_snapshot_hash:
              'bad-hash-0000000000000000000000000000000000000000000000000000000000',
          },
        );
        assert.equal(mismatch.status, 412);

        // Missing acknowledgment rejected with 400
        const noAck = await request(
          `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
          ownerA,
          {
            acknowledged: false,
            group_snapshot_hash: snapshotHashForTrash,
          },
        );
        assert.equal(noAck.status, 400);

        // Staff cannot confirm trash -> 403
        const staffConfirm = await request(
          `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
          staffA1,
          {
            acknowledged: true,
            group_snapshot_hash: snapshotHashForTrash,
          },
        );
        assert.equal(staffConfirm.status, 403);

        // Owner confirms trash
        const confirmRes = await request(
          `/api/v1/storage/trash-requests/${trashRequestId}/confirm`,
          ownerA,
          {
            acknowledged: true,
            group_snapshot_hash: snapshotHashForTrash,
          },
        );
        assert.equal(confirmRes.status, 200);
        assert.equal(confirmRes.data.data.status, 'trashed');

        // Verify in DB that parent and all deliverables are now trashed
        const parentCheck = await pool.query(
          'SELECT status FROM storage_folders WHERE id = $1',
          [sourceFolderId],
        );
        assert.equal(parentCheck.rows[0].status, 'trashed');

        const delivCheck = await pool.query(
          'SELECT status FROM storage_folders WHERE parent_folder_id = $1',
          [sourceFolderId],
        );
        assert.equal(delivCheck.rows.length, 2);
        assert.equal(
          delivCheck.rows.every((r) => r.status === 'trashed'),
          true,
        );
      },
    );

    // 12. Test: Durable Storage Operation Record (GET /api/v1/storage/operations/:id)
    await t.test(
      'GET /api/v1/storage/operations/:id retrieves durable operation record',
      async () => {
        const opCheck = await pool.query(
          "SELECT id FROM storage_operations WHERE folder_id = $1 AND operation_type = 'trash_group'",
          [sourceFolderId],
        );
        assert.equal(opCheck.rows.length >= 1, true);
        const opId = opCheck.rows[0].id;

        const opRes = await request(
          `/api/v1/storage/operations/${opId}`,
          ownerA,
        );
        assert.equal(opRes.status, 200);
        assert.equal(opRes.data.data.operation_type, 'trash_group');
        assert.equal(opRes.data.data.status, 'completed');
        assert.equal(opRes.data.data.provider, 'google_drive');
      },
    );

    // 13. Test: GET /api/v1/storage/folders/:id/files
    await t.test(
      'GET /api/v1/storage/folders/:id/files retrieves folder files',
      async () => {
        // Seed a test file in storage_files
        await pool.query(
          `INSERT INTO storage_files (workspace_id, folder_id, name, size_bytes, mime_type, status)
         VALUES ($1, $2, 'brief.pdf', 1048576, 'application/pdf', 'available')`,
          [workspaceA, sourceFolderId],
        );

        const filesRes = await request(
          `/api/v1/storage/folders/${sourceFolderId}/files`,
          ownerA,
        );
        assert.equal(filesRes.status, 200);
        assert.equal(filesRes.data.data.length, 1);
        assert.equal(filesRes.data.data[0].name, 'brief.pdf');
      },
    );

    // 14. Test: Cross-Tenant Concealment (Doc 24)
    await t.test(
      'Cross-tenant folder access returns 404 NOT_FOUND without data leakage',
      async () => {
        const crossRes = await request(
          `/api/v1/storage/folders/${sourceFolderId}`,
          ownerB,
        );
        assert.equal(crossRes.status, 404);
        assert.equal(crossRes.data.error.code, 'NOT_FOUND');
      },
    );

    // 15. Test: Google Drive Storage V2 (OAuth 2.0 AEAD encryption, Drive API v3 folder create, resumable video upload, permissions, sync, review, and non-destructive detachment)
    await t.test(
      'FILE-01 Google Drive V2: OAuth 2.0 encrypted token, direct Drive folder creation, resumable video upload, staff Google email permissions, sync, review, and non-destructive Drive record removal',
      async () => {
        // 15.1 Verify storage_drive_connections table exists
        const connTbl = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'storage_drive_connections'`,
        );
        assert.equal(connTbl.rows.length, 1);

        // 15.2 Get OAuth URL -> must use drive.file scope
        const oauthUrlRes = await request(
          '/api/v1/storage/drive/oauth/url',
          ownerA,
        );
        assert.equal(oauthUrlRes.status, 200);
        assert.equal(
          oauthUrlRes.data.data.scope,
          'https://www.googleapis.com/auth/drive.file',
        );
        assert.ok(
          oauthUrlRes.data.data.authorization_url.includes('drive.file'),
          'OAuth URL must request drive.file scope',
        );

        // Staff cannot connect Google Drive OAuth -> 403
        const staffConnect = await request(
          '/api/v1/storage/drive/connect',
          staffA1,
          { code: 'mock_auth_code_123' },
        );
        assert.equal(staffConnect.status, 403);

        // Unapproved wide scope rejected -> 400 FORBIDDEN_DRIVE_SCOPE
        const wideScopeRes = await request(
          '/api/v1/storage/drive/connect',
          ownerA,
          {
            code: 'mock_auth_code_123',
            scope: 'https://www.googleapis.com/auth/drive',
          },
        );
        assert.equal(wideScopeRes.status, 400);
        assert.equal(wideScopeRes.data.error.code, 'FORBIDDEN_DRIVE_SCOPE');

        // Missing OAuth state rejected -> 400 INVALID_OAUTH_STATE
        const missingStateRes = await request(
          '/api/v1/storage/drive/connect',
          ownerA,
          {
            code: 'mock_auth_code_missing_state',
            scope: 'https://www.googleapis.com/auth/drive.file',
          },
        );
        assert.equal(missingStateRes.status, 400);
        assert.equal(missingStateRes.data.error.code, 'INVALID_OAUTH_STATE');

        // Tampered OAuth state rejected -> 400 INVALID_OAUTH_STATE
        const tamperedStateRes = await request(
          '/api/v1/storage/drive/connect',
          ownerA,
          {
            code: 'mock_auth_code_valid_2026',
            state: 'tampered.invalid.signature',
            scope: 'https://www.googleapis.com/auth/drive.file',
          },
        );
        assert.equal(tamperedStateRes.status, 400);
        assert.equal(tamperedStateRes.data.error.code, 'INVALID_OAUTH_STATE');

        // OAuth callback endpoint returns code & state when Accept: application/json
        const callbackRes = await request(
          `/api/v1/storage/drive/oauth/callback?code=mock_auth_code_valid_2026&state=${encodeURIComponent(oauthUrlRes.data.data.state)}`,
          ownerA,
          undefined,
          { Accept: 'application/json' },
        );
        assert.equal(callbackRes.status, 200);
        assert.equal(callbackRes.data.data.code, 'mock_auth_code_valid_2026');

        // Valid OAuth connect with drive.file scope + signed state
        const connectRes = await request(
          '/api/v1/storage/drive/connect',
          ownerA,
          {
            code: 'mock_auth_code_valid_2026',
            state: oauthUrlRes.data.data.state,
            google_email: 'admin-drive@hoaiphuong.click',
            display_name: 'Hoài Phương Drive Admin',
            scope: 'https://www.googleapis.com/auth/drive.file',
          },
        );
        assert.equal(connectRes.status, 200);
        assert.equal(connectRes.data.data.connected, true);
        assert.equal(
          connectRes.data.data.google_email,
          'admin-drive@hoaiphuong.click',
        );
        assert.ok(connectRes.data.data.root_folder_id);
        assert.equal(connectRes.data.data.oauth_mode, 'mock');

        // Replaying the exact same OAuth state token a second time is rejected -> 400 OAUTH_STATE_REPLAYED
        const replayStateRes = await request(
          '/api/v1/storage/drive/connect',
          ownerA,
          {
            code: 'mock_auth_code_valid_2026',
            state: oauthUrlRes.data.data.state,
            google_email: 'admin-drive@hoaiphuong.click',
            scope: 'https://www.googleapis.com/auth/drive.file',
          },
        );
        assert.equal(replayStateRes.status, 400);
        assert.equal(
          replayStateRes.data.error.code,
          'OAUTH_STATE_REPLAYED',
          'Replaying an already consumed OAuth state token must be blocked',
        );

        // Ensure response NEVER leaks refresh_token or ciphertext
        const rawConnectJson = JSON.stringify(connectRes.data);
        assert.equal(rawConnectJson.includes('refresh_token'), false);
        assert.equal(rawConnectJson.includes('ciphertext'), false);

        // Verify in DB that refresh_token is AEAD encrypted (not plaintext)
        const dbConn = await pool.query(
          'SELECT refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag, key_version FROM storage_drive_connections WHERE workspace_id = $1',
          [workspaceA],
        );
        assert.equal(dbConn.rows.length, 1);
        assert.ok(Buffer.isBuffer(dbConn.rows[0].refresh_token_ciphertext));
        assert.ok(dbConn.rows[0].refresh_token_ciphertext.length > 0);
        assert.equal(dbConn.rows[0].refresh_token_nonce.length, 12);
        assert.equal(dbConn.rows[0].refresh_token_auth_tag.length, 16);
        assert.equal(
          dbConn.rows[0].refresh_token_ciphertext
            .toString('utf8')
            .includes('mock_refresh_token'),
          false,
          'Ciphertext must not contain plaintext refresh token',
        );

        // 15.3 Direct Folder Creation on Google Drive (without manual drive_url)
        const directFolderRes = await request(
          '/api/v1/storage/folders',
          ownerA,
          {
            name: 'Thư mục Drive Trực Tiếp V2',
            create_on_drive: true,
            folder_type: 'source',
            assigned_employee_ids: [staffA1.empId],
            permission_role: 'reader',
          },
        );
        assert.equal(directFolderRes.status, 201);
        const v2Folder = directFolderRes.data.data;
        assert.ok(v2Folder.provider_folder_id, 'Must store folderId');
        assert.ok(v2Folder.provider_parent_id, 'Must store parentId');
        assert.equal(
          v2Folder.drive_owner_email,
          'admin-drive@hoaiphuong.click',
          'Must store owner email',
        );
        assert.ok(v2Folder.drive_created_at, 'Must store drive_created_at');
        assert.ok(
          v2Folder.drive_url.includes(v2Folder.provider_folder_id),
          'Auto-generated Drive URL must reference provider_folder_id',
        );

        // Create a second independent folder to verify cross-folder data & permission isolation
        const secondFolderRes = await request(
          '/api/v1/storage/folders',
          ownerA,
          {
            name: 'Thư mục Độc Lập B (Không Bị Ảnh Hưởng)',
            create_on_drive: true,
            folder_type: 'source',
            assigned_employee_ids: [staffA1.empId],
            permission_role: 'reader',
          },
        );
        assert.equal(secondFolderRes.status, 201);
        const isolatedFolder = secondFolderRes.data.data;
        assert.notEqual(
          isolatedFolder.provider_folder_id,
          v2Folder.provider_folder_id,
        );

        // 15.4 Resumable Video Upload: initiate -> chunk -> interrupt -> retry to completion
        const videoSize = 10 * 1024 * 1024; // 10 MB
        const halfChunk = 5 * 1024 * 1024; // 5 MB
        const initUploadRes = await request(
          `/api/v1/storage/folders/${v2Folder.id}/files/upload-sessions`,
          ownerA,
          {
            name: 'tvc_quang_cao_4k.mp4',
            size_bytes: videoSize,
            mime_type: 'video/mp4',
            assigned_employee_id: staffA1.empId,
            permission_role: 'writer',
          },
        );
        assert.equal(initUploadRes.status, 201);
        const videoFile = initUploadRes.data.data;
        assert.equal(videoFile.upload_status, 'resumable_session_created');
        assert.ok(videoFile.upload_session_id);
        assert.equal(videoFile.uploaded_bytes, 0);
        assert.equal(videoFile.upload_progress_pct, 0);
        assert.equal(videoFile.assigned_employee_id, staffA1.empId);

        // Upload first 50% chunk with real binary MP4 header base64
        const sampleMp4Base64 = Buffer.from(
          '00000018667479706d703432000000006d70343269736f6d',
          'hex',
        ).toString('base64');
        const chunk1Res = await request(
          `/api/v1/storage/files/${videoFile.id}/upload-chunk`,
          ownerA,
          {
            chunk_size_bytes: halfChunk,
            offset_bytes: 0,
            chunk_base64: sampleMp4Base64,
          },
        );
        assert.equal(chunk1Res.status, 200);
        assert.equal(chunk1Res.data.data.upload_status, 'uploading');
        assert.equal(chunk1Res.data.data.uploaded_bytes, halfChunk);
        assert.equal(chunk1Res.data.data.upload_progress_pct, 50);

        // Simulate network interruption on second chunk
        const interruptRes = await request(
          `/api/v1/storage/files/${videoFile.id}/upload-chunk`,
          ownerA,
          {
            chunk_size_bytes: halfChunk,
            offset_bytes: halfChunk,
            simulate_interruption: true,
          },
        );
        assert.equal(interruptRes.status, 200);
        assert.equal(interruptRes.data.data.upload_status, 'interrupted');
        assert.equal(interruptRes.data.data.uploaded_bytes, halfChunk);
        assert.ok(interruptRes.data.data.upload_error_message);

        // Retry from offset_bytes = halfChunk to completion
        const retryRes = await request(
          `/api/v1/storage/files/${videoFile.id}/upload-chunk`,
          ownerA,
          {
            chunk_size_bytes: halfChunk,
            offset_bytes: halfChunk,
            chunk_base64: sampleMp4Base64,
            retry: true,
            is_final_chunk: true,
          },
        );
        assert.equal(retryRes.status, 200);
        assert.equal(retryRes.data.data.upload_status, 'completed');
        assert.equal(retryRes.data.data.uploaded_bytes, videoSize);
        assert.equal(retryRes.data.data.upload_progress_pct, 100);
        assert.equal(retryRes.data.data.upload_retry_count, 1);
        assert.equal(retryRes.data.data.upload_error_message, null);

        // 15.5 Staff Google Email Permissions, anyoneWithLink forbidden, inheritance & audit log
        const anyoneAttempt = await request(
          `/api/v1/storage/folders/${v2Folder.id}/permissions`,
          ownerA,
          {
            employee_id: staffA2.empId,
            role: 'reader',
            type: 'anyone',
          },
        );
        assert.equal(anyoneAttempt.status, 400);
        assert.equal(
          anyoneAttempt.data.error.code,
          'ANYONE_PERMISSION_FORBIDDEN',
        );

        // Before granting on v2Folder, staffA2 cannot access isolatedFolder (returns 404 NOT_FOUND to prevent enumeration)
        const staffA2IsoBefore = await request(
          `/api/v1/storage/folders/${isolatedFolder.id}/files`,
          staffA2,
        );
        assert.equal(staffA2IsoBefore.status, 404);

        // Grant writer permission on v2Folder to staffA2
        const grantFolderRes = await request(
          `/api/v1/storage/folders/${v2Folder.id}/permissions`,
          ownerA,
          {
            employee_id: staffA2.empId,
            role: 'writer',
          },
        );
        assert.equal(grantFolderRes.status, 201);
        assert.equal(grantFolderRes.data.data.drive_role, 'writer');
        assert.equal(grantFolderRes.data.data.access_level, 'write');
        assert.ok(grantFolderRes.data.data.google_email.includes('@'));
        assert.ok(grantFolderRes.data.data.drive_permission_id);

        // Verify staffA2 CAN access v2Folder files after grant
        const staffA2V2AfterGrant = await request(
          `/api/v1/storage/folders/${v2Folder.id}/files`,
          staffA2,
        );
        assert.equal(
          staffA2V2AfterGrant.status,
          200,
          'Staff must be able to access folder files once granted permission',
        );

        // Verify isolatedFolder permissions and data remain completely unaffected by v2Folder grant
        const staffA2IsoDuring = await request(
          `/api/v1/storage/folders/${isolatedFolder.id}/files`,
          staffA2,
        );
        assert.equal(
          staffA2IsoDuring.status,
          404,
          'Other folders must not be affected when granting permission on target folder',
        );
        const staffA1IsoDuring = await request(
          `/api/v1/storage/folders/${isolatedFolder.id}/files`,
          staffA1,
        );
        assert.equal(
          staffA1IsoDuring.status,
          200,
          'Existing staff access on other folders must remain intact',
        );

        // Grant permission on file inside v2Folder to staffA2 -> detects inherited_from_resource_id
        const grantFileRes = await request(
          `/api/v1/storage/files/${videoFile.id}/permissions`,
          ownerA,
          {
            employee_id: staffA2.empId,
            role: 'reader',
          },
        );
        assert.equal(grantFileRes.status, 201);
        assert.equal(
          grantFileRes.data.data.inherited_from_resource_id,
          v2Folder.id,
          'File permission must record inherited_from_resource_id from parent folder grant',
        );

        // Attempting to revoke an inherited child file permission directly while parent folder grant is active must fail closed -> 409 INHERITED_PERMISSION_ACTIVE_ON_PARENT
        const directFileRevokeWhileInheritedRes = await request(
          `/api/v1/storage/files/${videoFile.id}/permissions/revoke`,
          ownerA,
          {
            employee_id: staffA2.empId,
            reason: 'Thử thu hồi trực tiếp quyền kế thừa từ thư mục cha',
          },
        );
        assert.equal(directFileRevokeWhileInheritedRes.status, 409);
        assert.equal(
          directFileRevokeWhileInheritedRes.data.error.code,
          'INHERITED_PERMISSION_ACTIVE_ON_PARENT',
          'Direct revocation of inherited file permission must fail closed while parent folder grant is active',
        );

        // Simulate Google Drive API HTTP 403 on revokePermission -> must fail closed (502) and NOT mark revoked_at in DB
        const { MockGoogleDriveProvider } =
          await import('../../dist/apps/api/src/storage/provider.js');
        const origRevokePermission =
          MockGoogleDriveProvider.prototype.revokePermission;
        MockGoogleDriveProvider.prototype.revokePermission = async () => {
          throw new Error('GOOGLE_DRIVE_REVOKE_PERMISSION_FAILED: HTTP 403');
        };
        try {
          const failedRevokeRes = await request(
            `/api/v1/storage/folders/${v2Folder.id}/permissions/revoke`,
            ownerA,
            {
              employee_id: staffA2.empId,
              reason: 'Kiểm tra fail-closed khi Google Drive trả HTTP 403',
            },
          );
          assert.equal(failedRevokeRes.status, 502);
          assert.equal(
            failedRevokeRes.data.error.code,
            'GOOGLE_DRIVE_REVOKE_PERMISSION_FAILED',
          );
          const dbGrantStillActive = await pool.query(
            `SELECT revoked_at FROM resource_access_grants
             WHERE workspace_id = $1 AND resource_type = 'storage_folder'
               AND resource_id = $2 AND employee_id = $3`,
            [workspaceA, v2Folder.id, staffA2.empId],
          );
          assert.equal(
            dbGrantStillActive.rows[0].revoked_at,
            null,
            'Permission must remain active in DB when Drive API returns HTTP 403',
          );
        } finally {
          MockGoogleDriveProvider.prototype.revokePermission =
            origRevokePermission;
        }

        // Revoke permission on folder for staffA2
        const revokeRes = await request(
          `/api/v1/storage/folders/${v2Folder.id}/permissions/revoke`,
          ownerA,
          {
            employee_id: staffA2.empId,
            reason: 'Hoàn thành nhiệm vụ dựng video',
          },
        );
        assert.equal(revokeRes.status, 200);
        assert.ok(revokeRes.data.data.revoked_at);

        // Verify staffA2 immediately loses access to v2Folder and inherited child grant is revoked
        const staffA2V2AfterRevoke = await request(
          `/api/v1/storage/folders/${v2Folder.id}/files`,
          staffA2,
        );
        assert.equal(
          staffA2V2AfterRevoke.status,
          404,
          'Staff must immediately lose access to folder after permission revocation',
        );
        const inheritedChildAfterRevoke = await pool.query(
          `SELECT revoked_at FROM resource_access_grants
           WHERE workspace_id = $1 AND resource_type = 'storage_file'
             AND resource_id = $2 AND employee_id = $3`,
          [workspaceA, videoFile.id, staffA2.empId],
        );
        assert.ok(
          inheritedChildAfterRevoke.rows[0].revoked_at,
          'Inherited child file grant must also be marked revoked when parent folder permission is revoked',
        );

        // Verify audit logs recorded for OAuth, upload, permission grant, and permission revoke
        const auditRes = await pool.query(
          `SELECT action FROM audit_events
           WHERE workspace_id = $1
             AND action IN (
               'storage.drive_oauth_connect',
               'storage.video_upload_initiated',
               'storage.video_upload_completed',
               'storage.permission_grant',
               'storage.permission_revoke'
             )`,
          [workspaceA],
        );
        assert.equal(auditRes.rows.length >= 5, true);

        // 15.6 Sync folder files & review uploaded video
        const syncRes = await request(
          `/api/v1/storage/folders/${v2Folder.id}/sync`,
          ownerA,
          {},
        );
        assert.equal(syncRes.status, 200);
        assert.equal(syncRes.data.data.synced_count >= 1, true);

        const reviewRes = await request(
          `/api/v1/storage/files/${videoFile.id}/review`,
          ownerA,
          {
            review_status: 'approved',
            notes: 'Chất lượng video 4K đạt chuẩn',
          },
        );
        assert.equal(reviewRes.status, 200);
        assert.equal(reviewRes.data.data.review_status, 'approved');

        // 15.7 Non-Destructive Record Removal (Requirement 9): deleting in Management Lite NEVER deletes on Google Drive
        const detachFileRes = await request(
          `/api/v1/storage/files/${videoFile.id}`,
          ownerA,
          undefined,
          {},
          'DELETE',
        );
        assert.equal(detachFileRes.status, 200);
        assert.equal(detachFileRes.data.data.detached, true);
        assert.equal(detachFileRes.data.data.drive_data_preserved, true);

        const dbFileAfterDetach = await pool.query(
          'SELECT status, provider_file_id FROM storage_files WHERE id = $1',
          [videoFile.id],
        );
        assert.equal(dbFileAfterDetach.rows[0].status, 'detached');
        assert.ok(dbFileAfterDetach.rows[0].provider_file_id);

        const detachFolderRes = await request(
          `/api/v1/storage/folders/${v2Folder.id}`,
          ownerA,
          undefined,
          {},
          'DELETE',
        );
        assert.equal(detachFolderRes.status, 200);
        assert.equal(detachFolderRes.data.data.detached, true);
        assert.equal(detachFolderRes.data.data.drive_data_preserved, true);

        const dbFolderAfterDetach = await pool.query(
          'SELECT record_status, provider_folder_id FROM storage_folders WHERE id = $1',
          [v2Folder.id],
        );
        assert.equal(dbFolderAfterDetach.rows[0].record_status, 'detached');
        assert.ok(dbFolderAfterDetach.rows[0].provider_folder_id);

        // Verify isolatedFolder is still active after detaching v2Folder
        const dbIsolatedAfterDetach = await pool.query(
          'SELECT record_status FROM storage_folders WHERE id = $1',
          [isolatedFolder.id],
        );
        assert.equal(dbIsolatedAfterDetach.rows[0].record_status, 'active');

        // 15.8 Disconnect OAuth wipes AEAD ciphertext, nonce, and auth tag at rest
        const disconnectRes = await request(
          '/api/v1/storage/drive/disconnect',
          ownerA,
          {},
        );
        assert.equal(disconnectRes.status, 200);
        assert.equal(disconnectRes.data.data.connected, false);

        const dbConnAfterDisconnect = await pool.query(
          'SELECT status, refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag FROM storage_drive_connections WHERE workspace_id = $1',
          [workspaceA],
        );
        assert.equal(dbConnAfterDisconnect.rows[0].status, 'disconnected');
        assert.equal(
          dbConnAfterDisconnect.rows[0].refresh_token_ciphertext,
          null,
          'Refresh token ciphertext must be wiped on disconnect',
        );
        assert.equal(dbConnAfterDisconnect.rows[0].refresh_token_nonce, null);
        assert.equal(
          dbConnAfterDisconnect.rows[0].refresh_token_auth_tag,
          null,
        );
      },
    );

    // =========================================================================
    // 16. OAuth Replay Protection Across API Process Restart & Chunk Retry Idempotency
    // =========================================================================
    await t.test(
      '16. OAuth State Replay Blocked Across API Process Restart & Resumable Chunk Retry Buffer Idempotency',
      async () => {
        const { spawnSync } = await import('node:child_process');
        const workerScript = `
          import { StorageService } from './dist/apps/api/src/storage/service.js';
          const mode = process.argv[1];
          const inputState = process.argv[2] || '';
          let exchangeCalls = 0;
          const pool = { connect() { throw new Error('UNEXPECTED_DATABASE_ACCESS'); } };
          const provider = {
            providerName: 'google_drive',
            parseFolderId: () => 'gdrive_folder_restart_test',
            isValidDriveUrl: () => true,
            trashFolder: async () => ({ success: true, status: 'completed', trashed: true, providerFolderId: 'x' }),
            reconcileFolderStatus: async () => ({ success: true, status: 'completed' }),
            async exchangeOAuthCode() {
              exchangeCalls += 1;
              throw new Error('Simulated token endpoint failure after code redemption');
            },
          };
          const auth = {
            user: { id: '33333333-3333-4333-8333-333333333333', username: 'owner', status: 'active' },
            workspace: { id: '44444444-4444-4444-8444-444444444444', role: 'owner', membershipStatus: 'active' },
            session: { id: '55555555-5555-4555-8555-555555555555' },
          };
          const service = new StorageService(pool, provider);
          if (mode === 'first') {
            const { state } = await service.getDriveOAuthUrl(auth);
            try {
              await service.connectDriveOAuth(auth, {
                code: '4/0AVGzR1-restart-replay-check',
                state,
                scopes: ['https://www.googleapis.com/auth/drive.file'],
              });
            } catch (err) {
              console.log(JSON.stringify({ state, exchangeCalls, message: err.message }));
            }
          } else {
            try {
              await service.connectDriveOAuth(auth, {
                code: '4/0AVGzR1-restart-replay-check',
                state: inputState,
                scopes: ['https://www.googleapis.com/auth/drive.file'],
              });
              console.log(JSON.stringify({ replayed: false, exchangeCalls }));
            } catch (err) {
              console.log(JSON.stringify({ replayed: true, code: err.code, status: err.statusCode, exchangeCalls }));
            }
          }
        `;

        const firstProc = spawnSync(
          process.execPath,
          ['--input-type=module', '-e', workerScript, 'first'],
          { encoding: 'utf8' },
        );
        assert.equal(firstProc.status, 0, firstProc.stderr);
        const firstOut = JSON.parse(firstProc.stdout.trim());
        assert.ok(firstOut.state);
        assert.equal(firstOut.exchangeCalls, 1);

        // Second separate Node process (simulating full API server restart) replaying the same state
        const secondProc = spawnSync(
          process.execPath,
          ['--input-type=module', '-e', workerScript, 'second', firstOut.state],
          { encoding: 'utf8' },
        );
        assert.equal(secondProc.status, 0, secondProc.stderr);
        const secondOut = JSON.parse(secondProc.stdout.trim());
        assert.equal(
          secondOut.replayed,
          true,
          'Replayed state after API process restart must throw',
        );
        assert.equal(secondOut.code, 'OAUTH_STATE_REPLAYED');
        assert.equal(secondOut.status, 400);
        assert.equal(
          secondOut.exchangeCalls,
          0,
          'Provider exchangeOAuthCode must NOT be called when replaying a consumed state after restart',
        );

        // Verify chunk buffer retry idempotency at non-zero offset
        const { MockGoogleDriveProvider } =
          await import('../../dist/apps/api/src/storage/provider.js');
        const mockProvider = new MockGoogleDriveProvider();
        const chunk0 = Buffer.from('AAAA', 'utf8').toString('base64');
        const chunk1 = Buffer.from('BBBB', 'utf8').toString('base64');
        await mockProvider.uploadResumableChunk({
          sessionUri:
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test_buf',
          providerFileId: 'gdrive_buf_test',
          offsetBytes: 0,
          chunkSizeBytes: 4,
          totalBytes: 12,
          chunkDataBase64: chunk0,
          retry: false,
        });
        await mockProvider.uploadResumableChunk({
          sessionUri:
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test_buf',
          providerFileId: 'gdrive_buf_test',
          offsetBytes: 4,
          chunkSizeBytes: 4,
          totalBytes: 12,
          chunkDataBase64: chunk1,
          retry: false,
        });
        // Retry same offset 4
        await mockProvider.uploadResumableChunk({
          sessionUri:
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test_buf',
          providerFileId: 'gdrive_buf_test',
          offsetBytes: 4,
          chunkSizeBytes: 4,
          totalBytes: 12,
          chunkDataBase64: chunk1,
          retry: true,
        });
        const chunkMap = mockProvider.fileChunkBuffers.get('gdrive_buf_test');
        assert.ok(chunkMap instanceof Map);
        assert.equal(
          chunkMap.size,
          2,
          'Retrying a chunk at the same byte offset must overwrite rather than duplicate buffered chunks',
        );
      },
    );
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    await pool.end();
  }
});
