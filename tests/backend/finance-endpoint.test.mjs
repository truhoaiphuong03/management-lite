import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { realpathSync } from 'node:fs';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { FinanceService } from '../../dist/apps/api/src/finance/service.js';
import { AuthService } from '../../dist/apps/api/src/auth/service.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';

// No credential defaults or candidate-server calls. All HTTP uses this suite's ephemeral server.
test('FIN authenticated HTTP/DB acceptance on exact FIN-only cluster', async (t) => {
  const url = process.env.FIN_TEST_DATABASE_URL;
  if (
    !url ||
    !process.env.FIN_TEST_SYSTEM_IDENTIFIER ||
    !process.env.FIN_TEST_DATA_DIRECTORY ||
    !process.env.FIN_TEST_SOCKET ||
    !process.env.FIN_TEST_PORT ||
    !process.env.FIN_TEST_DATABASE
  ) {
    t.skip(
      'FIN-only cluster identity and credential required; no connection attempted',
    );
    return;
  }
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, process.env.FIN_TEST_PORT);
  assert.ok(
    !['55499', '55571', '55601', '55701', '55777', '5432'].includes(
      target.port,
    ),
    'Operational PostgreSQL port refused',
  );
  assert.equal(target.pathname, '/' + process.env.FIN_TEST_DATABASE);
  const pool = createDatabasePool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000,
  });
  let server;
  try {
    const proof = (
      await pool.query(
        "SELECT current_database() AS db,current_setting('data_directory') AS directory,current_setting('port') AS port,current_setting('unix_socket_directories') AS socket,current_setting('listen_addresses') AS listen,(SELECT system_identifier::text FROM pg_control_system()) AS system_id",
      )
    ).rows[0];
    assert.equal(proof.db, process.env.FIN_TEST_DATABASE);
    assert.equal(proof.port, process.env.FIN_TEST_PORT);
    assert.equal(proof.system_id, process.env.FIN_TEST_SYSTEM_IDENTIFIER);
    assert.equal(
      realpathSync(proof.directory),
      realpathSync(process.env.FIN_TEST_DATA_DIRECTORY),
    );
    assert.equal(proof.socket, process.env.FIN_TEST_SOCKET);
    assert.equal(proof.listen, '127.0.0.1');
    assert.equal(
      (
        await runMigrations(
          pool,
          loadMigrationFiles('packages/database/src/migrations'),
        )
      ).appliedCount,
      0,
    );
    const workspace = crypto.randomUUID(),
      otherWorkspace = crypto.randomUUID(),
      secret = crypto.randomBytes(32).toString('hex'),
      origin = 'http://127.0.0.1:3017';
    await pool.query(
      "INSERT INTO workspaces(id,name) VALUES ($1,'FIN API synthetic'),($2,'FIN API synthetic other')",
      [workspace, otherWorkspace],
    );
    const authService = new AuthService(pool, secret);
    // Failure injection is confined to the FIN service client, leaving production source untouched.
    let rejectAudit = false;
    const wrapped = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql, values) => {
            if (
              rejectAudit &&
              typeof sql === 'string' &&
              sql.includes('INSERT INTO audit_events')
            )
              throw new Error('FIN synthetic audit failure');
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    };
    const finance = new FinanceService(wrapped);
    server = http.createServer(
      createRequestHandler({
        pool,
        authService,
        financeService: finance,
        csrfSecret: secret,
        allowedOrigins: [origin],
        isProduction: false,
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(
      path,
      actor = null,
      body = undefined,
      headers = {},
      method = body === undefined ? 'GET' : 'POST',
    ) {
      const res = await fetch(base + path, {
        method,
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
      return {
        status: res.status,
        body: res.status === 204 ? null : await res.json(),
        cookie: res.headers.get('set-cookie'),
      };
    }
    async function actor(role, scope = workspace) {
      const id = crypto.randomUUID(),
        name = 'fin_' + id.replaceAll('-', ''),
        password = crypto.randomBytes(30).toString('base64url');
      await pool.query(
        "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES ($1,$2,$3,'active')",
        [id, name, name + '@test.invalid'],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id,password_hash) VALUES ($1,$2)',
        [id, await hashPassword(password)],
      );
      await pool.query(
        "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES ($1,$2,$3,'active')",
        [scope, id, role],
      );
      await pool.query(
        "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES ($1,$2,'active')",
        [scope, id],
      );
      const login = await request('/api/v1/auth/login', null, {
        identifier: name,
        password,
      });
      assert.equal(login.status, 200);
      const out = {
        id,
        scope,
        cookie: login.cookie.split(';')[0],
        csrf: login.body.data.csrf_token,
      };
      const me = await request('/api/v1/auth/me', out);
      assert.equal(me.status, 200);
      assert.equal(me.body.data.user.id, id);
      return out;
    }
    const owner = await actor('owner'),
      second = await actor('owner'),
      staff = await actor('staff'),
      foreign = await actor('owner', otherWorkspace);
    const p = '/api/v1/fin';
    const mutation = (
      path,
      a,
      body,
      key = crypto.randomUUID(),
      match = undefined,
      method = 'POST',
    ) =>
      request(
        path,
        a,
        body,
        { 'Idempotency-Key': key, ...(match ? { 'If-Match': match } : {}) },
        method,
      );
    const category = (a, direction, name) =>
      mutation(p + '/categories', a, { direction, name });
    let income, expense, entry, entryBody;
    await t.test(
      'Owner categories; every read/mutation denies Staff and missing session',
      async () => {
        income = (await category(owner, 'income', 'Salary')).body.data;
        expense = (await category(owner, 'expense', 'House')).body.data;
        assert.ok(income.id && expense.id);
        assert.equal((await category(second, 'expense', 'House')).status, 201);
        assert.equal(
          (await request(p + '/categories', second)).body.data.items.length,
          1,
        );
        assert.equal(
          (await request(p + '/categories', foreign)).body.data.items.length,
          0,
        );
        for (const path of [
          '/categories',
          '/entries',
          '/summary?period=month&anchor=2026-10-01',
          `/entries/${crypto.randomUUID()}`,
          `/entries/${crypto.randomUUID()}/corrections`,
        ]) {
          assert.equal((await request(p + path, staff)).status, 403);
          assert.equal((await request(p + path)).status, 401);
        }
        assert.equal((await category(staff, 'expense', 'Denied')).status, 403);
        const deniedEntry = {
          direction: 'expense',
          category_id: expense.id,
          amount_vnd: '1',
          occurred_on: '2026-10-01',
          note: null,
        };
        assert.equal(
          (await mutation(p + '/entries', staff, deniedEntry)).status,
          403,
        );
        assert.equal(
          (
            await mutation(
              `${p}/categories/${expense.id}`,
              staff,
              { is_active: false },
              crypto.randomUUID(),
              '"1"',
              'PATCH',
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await mutation(
              `${p}/entries/${crypto.randomUUID()}/correct`,
              staff,
              { ...deniedEntry, reason: 'Denied' },
              crypto.randomUUID(),
              '"1"',
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      'mandatory headers, CSRF/Origin, unknown fields and exact money validation',
      async () => {
        assert.equal(
          (
            await request(p + '/categories', owner, {
              direction: 'expense',
              name: 'No key',
            })
          ).status,
          428,
        );
        assert.equal(
          (
            await mutation(
              p + '/categories',
              owner,
              { direction: 'expense', name: 'CSRF' },
              undefined,
              undefined,
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request(
              p + '/categories',
              owner,
              { direction: 'expense', name: 'Bad origin' },
              {
                Origin: 'https://foreign.invalid',
                'Idempotency-Key': crypto.randomUUID(),
              },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              p + '/categories',
              owner,
              { direction: 'expense', name: 'Bad CSRF' },
              {
                'X-CSRF-Token': 'invalid',
                'Idempotency-Key': crypto.randomUUID(),
              },
            )
          ).status,
          403,
        );
        for (const body of [
          { direction: 'expense', name: 'Unknown', owner_user_id: owner.id },
          { direction: 'expense', name: 'Unknown', workspace_id: workspace },
        ])
          assert.equal((await categoryRequest(body)).status, 400);
        async function categoryRequest(body) {
          return mutation(p + '/categories', owner, body);
        }
        const valid = {
          direction: 'expense',
          category_id: expense.id,
          amount_vnd: '1',
          occurred_on: '2026-10-01',
          note: null,
        };
        for (const value of [0, '0', '-1', '1.5', '1e3', '9223372036854775808'])
          assert.equal(
            (
              await mutation(p + '/entries', owner, {
                ...valid,
                amount_vnd: value,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await mutation(p + '/entries', owner, {
              ...valid,
              occurred_on: '2026-02-30',
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      'entry preserves description, replay envelope and atomic audit counters',
      async () => {
        entryBody = {
          direction: 'expense',
          category_id: expense.id,
          amount_vnd: '1200000',
          occurred_on: '2026-10-01',
          note: '  Original\nprivate note  ',
        };
        const key = crypto.randomUUID(),
          first = await mutation(p + '/entries', owner, entryBody, key);
        assert.equal(first.status, 201);
        entry = first.body.data;
        assert.equal(entry.note, entryBody.note);
        const replay = await mutation(p + '/entries', owner, entryBody, key);
        assert.equal(replay.status, 201);
        assert.deepEqual(replay.body, first.body);
        assert.equal(
          (
            await mutation(
              p + '/entries',
              owner,
              { ...entryBody, amount_vnd: '1' },
              key,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM fin_entries WHERE workspace_id=$1 AND owner_user_id=$2 AND root_entry_id=$3',
              [workspace, owner.id, entry.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND actor_user_id=$2 AND entity_id=$3',
              [workspace, owner.id, entry.revision_id],
            )
          ).rows[0].n,
          1,
        );
        const audit = (
          await pool.query(
            'SELECT metadata_sanitized FROM audit_events WHERE workspace_id=$1 AND actor_user_id=$2 AND entity_id=$3',
            [workspace, owner.id, entry.revision_id],
          )
        ).rows[0].metadata_sanitized;
        assert.deepEqual(Object.keys(audit), ['version']);
      },
    );
    await t.test(
      'Owner A/B and other workspace cannot detail/correct/archive foreign records',
      async () => {
        for (const a of [second, foreign]) {
          assert.equal(
            (await request(`${p}/entries/${entry.id}`, a)).status,
            404,
          );
          assert.equal(
            (await request(`${p}/entries/${entry.id}/corrections`, a)).status,
            404,
          );
          assert.equal(
            (
              await mutation(
                `${p}/entries/${entry.id}/correct`,
                a,
                { ...entryBody, amount_vnd: '2', reason: 'Synthetic reason' },
                crypto.randomUUID(),
                '"1"',
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await mutation(
                `${p}/categories/${expense.id}`,
                a,
                { is_active: false },
                crypto.randomUUID(),
                '"1"',
                'PATCH',
              )
            ).status,
            404,
          );
          assert.equal(
            (await mutation(`${p}/entries`, a, entryBody)).status,
            404,
          );
        }
      },
    );
    await t.test(
      'category direction/archive/reactivate and immutable historical name',
      async () => {
        assert.equal(
          (
            await mutation(p + '/entries', owner, {
              ...entryBody,
              category_id: income.id,
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await mutation(
              `${p}/categories/${expense.id}`,
              owner,
              { name: 'Rent' },
              crypto.randomUUID(),
              undefined,
              'PATCH',
            )
          ).status,
          428,
        );
        const key = crypto.randomUUID(),
          edited = await mutation(
            `${p}/categories/${expense.id}`,
            owner,
            { name: 'Rent' },
            key,
            '"1"',
            'PATCH',
          );
        assert.equal(edited.status, 200);
        assert.deepEqual(
          (
            await mutation(
              `${p}/categories/${expense.id}`,
              owner,
              { name: 'Rent' },
              key,
              '"1"',
              'PATCH',
            )
          ).body,
          edited.body,
        );
        assert.equal(
          (
            await mutation(
              `${p}/categories/${expense.id}`,
              owner,
              { name: 'Other' },
              crypto.randomUUID(),
              '"1"',
              'PATCH',
            )
          ).status,
          412,
        );
        assert.equal(
          (await request(`${p}/entries/${entry.id}`, owner)).body.data
            .category_name_snapshot,
          'House',
        );
        assert.equal(
          (
            await mutation(
              `${p}/categories/${expense.id}`,
              owner,
              { is_active: false },
              crypto.randomUUID(),
              '"2"',
              'PATCH',
            )
          ).status,
          200,
        );
        assert.equal(
          (await mutation(p + '/entries', owner, entryBody)).status,
          422,
        );
        assert.equal(
          (
            await mutation(
              `${p}/categories/${expense.id}`,
              owner,
              { is_active: true },
              crypto.randomUUID(),
              '"3"',
              'PATCH',
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      'correction reason, no-op, If-Match, concurrent winner and replay',
      async () => {
        assert.equal(
          (
            await mutation(
              `${p}/entries/${entry.id}/correct`,
              owner,
              { ...entryBody, reason: 'No change' },
              crypto.randomUUID(),
              '"1"',
            )
          ).status,
          422,
        );
        assert.equal(
          (
            await mutation(
              `${p}/entries/${entry.id}/correct`,
              owner,
              { ...entryBody, amount_vnd: '2', reason: ' ' },
              crypto.randomUUID(),
              '"1"',
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await mutation(`${p}/entries/${entry.id}/correct`, owner, {
              ...entryBody,
              amount_vnd: '2',
              reason: 'Missing match',
            })
          ).status,
          428,
        );
        const changed = {
          ...entryBody,
          amount_vnd: '1300000',
          occurred_on: '2026-11-01',
          reason: 'Private correction reason',
        };
        const key = crypto.randomUUID();
        const races = await Promise.all([
          mutation(
            `${p}/entries/${entry.id}/correct`,
            owner,
            changed,
            key,
            '"1"',
          ),
          mutation(
            `${p}/entries/${entry.id}/correct`,
            owner,
            { ...changed, amount_vnd: '1400000' },
            crypto.randomUUID(),
            '"1"',
          ),
        ]);
        assert.deepEqual(races.map((r) => r.status).sort(), [201, 412]);
        const winner = races.find((r) => r.status === 201);
        entry = winner.body.data;
        assert.equal(entry.version, 2);
        const history = await request(
          `${p}/entries/${entry.id}/corrections`,
          owner,
        );
        assert.equal(history.body.data.items.length, 1);
        assert.equal(history.body.data.items[0].reason, changed.reason);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM fin_entries WHERE workspace_id=$1 AND owner_user_id=$2 AND root_entry_id=$3',
              [workspace, owner.id, entry.id],
            )
          ).rows[0].n,
          2,
        );
        if (races[0].status === 201)
          assert.deepEqual(
            (
              await mutation(
                `${p}/entries/${entry.id}/correct`,
                owner,
                changed,
                key,
                '"1"',
              )
            ).body,
            winner.body,
          );
      },
    );
    await t.test(
      'summary day/week/month/year and correction moves period; exact decimal strings',
      async () => {
        const incomeEntry = await mutation(p + '/entries', owner, {
          direction: 'income',
          category_id: income.id,
          amount_vnd: '8500000',
          occurred_on: '2026-10-01',
          note: null,
        });
        assert.equal(incomeEntry.status, 201);
        for (const period of ['day', 'week', 'month', 'year']) {
          const result = await request(
            `${p}/summary?period=${period}&anchor=2026-10-01`,
            owner,
          );
          assert.equal(result.status, 200);
          assert.equal(result.body.data.total_income_vnd, '8500000');
          assert.equal(
            result.body.data.total_expense_vnd,
            period === 'year' ? entry.amount_vnd : '0',
          );
          assert.equal(
            result.body.data.net_vnd,
            (8500000n - BigInt(result.body.data.total_expense_vnd)).toString(),
          );
        }
        const week = (
          await request(`${p}/summary?period=week&anchor=2026-10-01`, owner)
        ).body.data;
        assert.equal(week.from, '2026-09-28');
        assert.equal(week.to, '2026-10-04');
        assert.equal(
          (await request(`${p}/summary?period=month&anchor=2024-02-29`, owner))
            .body.data.to,
          '2024-02-29',
        );
        assert.equal(
          (await request(`${p}/summary?period=month&anchor=2026-11-01`, owner))
            .body.data.total_expense_vnd,
          entry.amount_vnd,
        );
        assert.equal(
          (await request(`${p}/summary?period=month&anchor=2026-10-01`, second))
            .body.data.total_income_vnd,
          '0',
        );
        const large = await mutation(p + '/entries', owner, {
          direction: 'income',
          category_id: income.id,
          amount_vnd: '9223372036854775807',
          occurred_on: '2028-01-01',
          note: null,
        });
        assert.equal(large.status, 201);
        const large2 = await mutation(p + '/entries', owner, {
          direction: 'income',
          category_id: income.id,
          amount_vnd: '1',
          occurred_on: '2028-01-01',
          note: null,
        });
        assert.equal(large2.status, 201);
        assert.equal(
          (await request(`${p}/summary?period=day&anchor=2028-01-01`, owner))
            .body.data.total_income_vnd,
          '9223372036854775808',
        );
      },
    );
    await t.test(
      'correction history paginates newest revision first and replays unchanged',
      async () => {
        const previous = entry.revision_id;
        const body = {
          ...entryBody,
          amount_vnd: entry.amount_vnd,
          occurred_on: '2026-11-01',
          note: 'Revision three note',
          reason: 'Private history reason',
        };
        const key = crypto.randomUUID();
        const result = await mutation(
          `${p}/entries/${entry.id}/correct`,
          owner,
          body,
          key,
          '"2"',
        );
        assert.equal(result.status, 201);
        entry = result.body.data;
        assert.deepEqual(
          (
            await mutation(
              `${p}/entries/${entry.id}/correct`,
              owner,
              body,
              key,
              '"2"',
            )
          ).body,
          result.body,
        );
        assert.equal(
          (await mutation(`${p}/entries/${entry.id}/correct`, owner, body, key))
            .status,
          428,
        );
        const first = await request(
          `${p}/entries/${entry.id}/corrections?limit=1`,
          owner,
        );
        assert.equal(
          first.body.data.items[0].replacement_revision_id,
          entry.revision_id,
        );
        assert.ok(first.body.data.next_cursor);
        const secondPage = await request(
          `${p}/entries/${entry.id}/corrections?limit=1&cursor=${first.body.data.next_cursor}`,
          owner,
        );
        assert.equal(
          secondPage.body.data.items[0].replacement_revision_id,
          previous,
        );
        assert.equal(secondPage.body.data.next_cursor, null);
        const audits = await pool.query(
          'SELECT metadata_sanitized FROM audit_events WHERE workspace_id=$1 AND actor_user_id=$2 AND entity_type=$3',
          [workspace, owner.id, 'finance'],
        );
        assert.ok(
          audits.rows.every((r) =>
            Object.keys(r.metadata_sanitized).every((k) => k === 'version'),
          ),
        );
      },
    );
    await t.test(
      'real cursor pagination across categories/entries and filter scope validation',
      async () => {
        const collected = [];
        let cur = null;
        do {
          const res = await request(
            `${p}/categories?limit=1${cur ? '&cursor=' + cur : ''}`,
            owner,
          );
          assert.equal(res.status, 200);
          collected.push(...res.body.data.items.map((r) => r.id));
          cur = res.body.data.next_cursor;
        } while (cur);
        assert.equal(new Set(collected).size, collected.length);
        assert.equal(collected.length, 3);
        const first = await request(`${p}/entries?limit=1`, owner);
        assert.ok(first.body.data.next_cursor);
        const next = await request(
          `${p}/entries?limit=1&cursor=${first.body.data.next_cursor}`,
          owner,
        );
        assert.equal(next.status, 200);
        assert.notEqual(
          first.body.data.items[0].id,
          next.body.data.items[0].id,
        );
        assert.equal(
          (
            await request(
              `${p}/entries?direction=expense&cursor=${first.body.data.next_cursor}`,
              owner,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request(`${p}/entries?cursor=garbage`, owner)).status,
          400,
        );
        assert.equal(
          (
            await request(
              `${p}/entries?cursor=${first.body.data.next_cursor}`,
              second,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      'duplicate concurrent create and durable replay after registry record loss',
      async () => {
        const body = { ...entryBody, occurred_on: '2027-01-01' },
          key = crypto.randomUUID();
        const responses = await Promise.all([
          mutation(p + '/entries', owner, body, key),
          mutation(p + '/entries', owner, body, key),
        ]);
        assert.equal(responses[0].status, 201);
        assert.deepEqual(responses[0].body, responses[1].body);
        const op = `FIN:POST:/api/v1/fin/entries:${key}`;
        // Delete only this suite's synthetic registry record to exercise retained immutable evidence.
        await pool.query(
          'DELETE FROM idempotency_records WHERE workspace_id=$1 AND actor_user_id=$2 AND operation_key=$3',
          [workspace, owner.id, op],
        );
        const retry = await mutation(p + '/entries', owner, body, key);
        assert.deepEqual(retry.body, responses[0].body);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM fin_entries WHERE workspace_id=$1 AND owner_user_id=$2 AND operation_key=$3',
              [workspace, owner.id, op],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await mutation(
              p + '/entries',
              owner,
              { ...body, amount_vnd: '2' },
              key,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      'audit failure rolls back entry and idempotency claim together',
      async () => {
        const key = crypto.randomUUID(),
          op = `FIN:POST:/api/v1/fin/entries:${key}`;
        rejectAudit = true;
        try {
          assert.equal(
            (await mutation(p + '/entries', owner, entryBody, key)).status,
            500,
          );
        } finally {
          rejectAudit = false;
        }
        assert.equal(
          (
            await pool.query(
              'SELECT id FROM fin_entries WHERE workspace_id=$1 AND owner_user_id=$2 AND operation_key=$3',
              [workspace, owner.id, op],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT id FROM idempotency_records WHERE workspace_id=$1 AND actor_user_id=$2 AND operation_key=$3',
              [workspace, owner.id, op],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await mutation(p + '/entries', owner, entryBody, key)).status,
          201,
        );
      },
    );
    await t.test(
      'session expiry while waiting for ledger lock prevents mutation',
      async () => {
        const context = await authService.resolveSession(
          foreign.cookie.split('=').slice(1).join('='),
        );
        assert.ok(context);
        const blocker = await pool.connect();
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [`fin:${otherWorkspace}:${foreign.id}`],
          );
          await pool.query(
            "UPDATE auth_sessions SET idle_expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1 AND user_id=$2",
            [context.sessionId, foreign.id],
          );
          const waiting = finance.createCategory(
            context,
            { direction: 'income', name: 'Expired' },
            crypto.randomUUID(),
            crypto.randomUUID(),
          );
          // Attach rejection handling before releasing the blocker.
          const result = assert.rejects(waiting, (e) => e.statusCode === 401);
          await new Promise((resolve) => setTimeout(resolve, 300));
          await blocker.query('COMMIT');
          await result;
          assert.equal(
            (
              await pool.query(
                'SELECT id FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2',
                [otherWorkspace, foreign.id],
              )
            ).rowCount,
            0,
          );
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
        }
      },
    );
    await t.test('revoked session denies FIN without writes', async () => {
      assert.equal(
        (await request('/api/v1/auth/logout', staff, {})).status,
        204,
      );
      assert.equal((await request(p + '/categories', staff)).status, 401);
      const context = await authService.resolveSession(
        second.cookie.split('=').slice(1).join('='),
      );
      assert.ok(context);
      await pool.query(
        'UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND user_id=$2',
        [context.sessionId, second.id],
      );
      await assert.rejects(
        finance.createCategory(
          context,
          { direction: 'income', name: 'Revoked' },
          crypto.randomUUID(),
          crypto.randomUUID(),
        ),
        (e) => e.statusCode === 401,
      );
      assert.equal((await request(p + '/categories', second)).status, 401);
    });
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
  }
});
