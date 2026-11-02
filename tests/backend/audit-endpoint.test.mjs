import { loadQaEndpoint } from '../../scripts/explicit-database.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getAcceptanceOwnerCredentials,
  getAcceptanceStaffCredentials,
} from '../../scripts/qa-credentials-reader.mjs';

test('AUDIT API: Endpoint security, Owner-only RBAC, cursor pagination, and metadata sanitization', async (t) => {
  const apiBase = loadQaEndpoint(process.env.QA_API_BASE);
  const origin = loadQaEndpoint(process.env.QA_WEB_BASE);

  const ownerCreds = getAcceptanceOwnerCredentials();
  const staffCreds = getAcceptanceStaffCredentials();

  async function apiRequest(
    path,
    method = 'GET',
    data = null,
    cookie = null,
    csrf = null,
  ) {
    const headers = {};
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
    return {
      status: res.status,
      headers: res.headers,
      json,
      raw: text,
      cookie: res.headers.get('set-cookie'),
    };
  }

  // 1. Anonymous request
  await t.test(
    '1. Anonymous access to /api/v1/audit returns 401 UNAUTHENTICATED',
    async () => {
      const res = await apiRequest('/api/v1/audit');
      assert.equal(res.status, 401);
      assert.equal(res.json?.error?.code, 'UNAUTHENTICATED');
    },
  );

  // 2. Staff login & 403 Forbidden check
  let staffCookie = null;
  await t.test(
    '2. Staff login succeeds but accessing /api/v1/audit returns 403 FORBIDDEN',
    async () => {
      const loginRes = await apiRequest('/api/v1/auth/login', 'POST', {
        identifier: staffCreds.identifier,
        password: staffCreds.password,
      });
      assert.equal(loginRes.status, 200);
      assert.equal(
        loginRes.json?.data?.user?.id,
        staffCreds.id,
        'Must be exact Acceptance Staff',
      );
      const setCookie = loginRes.headers.get('set-cookie');
      assert.ok(setCookie, 'Should have received session cookie');
      staffCookie = setCookie.split(';')[0];

      const auditRes = await apiRequest(
        '/api/v1/audit',
        'GET',
        null,
        staffCookie,
      );
      assert.equal(auditRes.status, 403);
      assert.equal(auditRes.json?.error?.code, 'FORBIDDEN');
    },
  );

  // 3. Owner login & 200 check
  let ownerCookie = null;
  await t.test(
    '3. Owner login succeeds and accessing /api/v1/audit returns 200 with sanitized events',
    async () => {
      const loginRes = await apiRequest('/api/v1/auth/login', 'POST', {
        identifier: ownerCreds.identifier,
        password: ownerCreds.password,
      });
      assert.equal(loginRes.status, 200);
      assert.equal(
        loginRes.json?.data?.user?.id,
        ownerCreds.id,
        'Must be exact Acceptance Owner (admin)',
      );
      const setCookie = loginRes.headers.get('set-cookie');
      assert.ok(setCookie, 'Should have received owner session cookie');
      ownerCookie = setCookie.split(';')[0];

      const auditRes = await apiRequest(
        '/api/v1/audit',
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(auditRes.status, 200);
      assert.ok(auditRes.json?.data, 'Should contain data envelope');
      assert.ok(
        Array.isArray(auditRes.json.data.items),
        'items must be an array',
      );
      assert.ok(
        auditRes.json.data.items.length > 0,
        'Audit log should contain recorded events',
      );
      assert.ok(
        typeof auditRes.json.data.total_count === 'number',
        'total_count must be a number',
      );

      const sample = auditRes.json.data.items[0];
      assert.ok(sample.id, 'Event must have id');
      assert.ok(sample.workspace_id, 'Event must have workspace_id');
      assert.ok(sample.action, 'Event must have action');
      assert.ok(sample.entity_type, 'Event must have entity_type');
      assert.ok(sample.created_at, 'Event must have created_at');

      // Verify metadata sanitization across all returned items
      for (const item of auditRes.json.data.items) {
        const meta = JSON.stringify(item.metadata || {});
        assert.ok(
          !meta.includes('password_hash'),
          'Metadata must not contain password_hash',
        );
        assert.ok(
          !meta.includes('secret_ciphertext'),
          'Metadata must not contain secret_ciphertext',
        );
        assert.ok(
          !meta.includes('token_hash'),
          'Metadata must not contain token_hash',
        );
      }
    },
  );

  // 4. Cursor pagination & limits
  await t.test(
    '4. Cursor pagination returns subset and next_cursor',
    async () => {
      const page1 = await apiRequest(
        '/api/v1/audit?limit=3',
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(page1.status, 200);
      assert.ok(page1.json.data.items.length <= 3);

      if (page1.json.data.next_cursor) {
        const cursor = encodeURIComponent(page1.json.data.next_cursor);
        const page2 = await apiRequest(
          `/api/v1/audit?limit=3&cursor=${cursor}`,
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(page2.status, 200);
        assert.ok(Array.isArray(page2.json.data.items));

        // Ensure page 2 does not duplicate page 1 IDs
        const p1Ids = new Set(page1.json.data.items.map((i) => i.id));
        for (const item of page2.json.data.items) {
          assert.ok(
            !p1Ids.has(item.id),
            `ID ${item.id} should not appear in both pages`,
          );
        }
      }
    },
  );

  // 5. Action and entity_type filters
  await t.test(
    '5. Action filter correctly restricts returned events',
    async () => {
      const filteredRes = await apiRequest(
        '/api/v1/audit?action=auth.login',
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(filteredRes.status, 200);
      for (const item of filteredRes.json.data.items) {
        assert.equal(item.action, 'auth.login');
      }
    },
  );

  // 6. Invalid / Malformed Cursor rejection (No silent fallback to page 1)
  await t.test(
    '6. Invalid/malformed cursor returns 400 with INVALID_CURSOR error',
    async () => {
      // 6.1 Non-base64 / corrupt string
      const corruptRes = await apiRequest(
        '/api/v1/audit?cursor=not-a-valid-cursor-string!@#$',
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(corruptRes.status, 400);
      assert.equal(corruptRes.json?.error?.code, 'INVALID_CURSOR');

      // 6.2 Valid base64 but empty object
      const emptyObjCursor = Buffer.from(JSON.stringify({})).toString(
        'base64url',
      );
      const emptyRes = await apiRequest(
        `/api/v1/audit?cursor=${emptyObjCursor}`,
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(emptyRes.status, 400);
      assert.equal(emptyRes.json?.error?.code, 'INVALID_CURSOR');

      // 6.3 Missing id field
      const noIdCursor = Buffer.from(
        JSON.stringify({ created_at: '2026-10-09T00:00:00.000Z' }),
      ).toString('base64url');
      const noIdRes = await apiRequest(
        `/api/v1/audit?cursor=${noIdCursor}`,
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(noIdRes.status, 400);
      assert.equal(noIdRes.json?.error?.code, 'INVALID_CURSOR');

      // 6.4 Invalid date format
      const badDateCursor = Buffer.from(
        JSON.stringify({
          created_at: 'invalid-date',
          id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        }),
      ).toString('base64url');
      const badDateRes = await apiRequest(
        `/api/v1/audit?cursor=${badDateCursor}`,
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(badDateRes.status, 400);
      assert.equal(badDateRes.json?.error?.code, 'INVALID_CURSOR');

      // 6.5 Non-UUID id format
      const badUuidCursor = Buffer.from(
        JSON.stringify({
          created_at: '2026-10-09T00:00:00.000Z',
          id: 'not-a-uuid-123',
        }),
      ).toString('base64url');
      const badUuidRes = await apiRequest(
        `/api/v1/audit?cursor=${badUuidCursor}`,
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(badUuidRes.status, 400);
      assert.equal(badUuidRes.json?.error?.code, 'INVALID_CURSOR');
    },
  );

  // 7. Workspace Isolation (C06)
  await t.test(
    '7. Workspace isolation ensures all events belong strictly to active workspace',
    async () => {
      const meRes = await apiRequest(
        '/api/v1/auth/me',
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(meRes.status, 200);
      const activeWorkspaceId = meRes.json?.data?.active_workspace?.id;
      assert.ok(activeWorkspaceId, 'Must have active workspace ID');

      const auditRes = await apiRequest(
        '/api/v1/audit?limit=50',
        'GET',
        null,
        ownerCookie,
      );
      assert.equal(auditRes.status, 200);
      for (const item of auditRes.json.data.items) {
        assert.equal(
          item.workspace_id,
          activeWorkspaceId,
          `Event ${item.id} workspace_id must match active workspace ${activeWorkspaceId}`,
        );
      }
    },
  );
});
