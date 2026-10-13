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
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    await pool.end();
  }
});
