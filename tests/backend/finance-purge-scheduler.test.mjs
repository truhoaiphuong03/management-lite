import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPurgeScheduler } from '../../dist/apps/api/src/finance/purge-scheduler.js';
import { startServer } from '../../dist/apps/api/src/server.js';

const fakeTimers = () => {
  const t = { fn: null, ms: null, cleared: 0, unref: 0 };
  return {
    t,
    setIntervalFn: (fn, ms) => {
      t.fn = fn;
      t.ms = ms;
      return { unref: () => void t.unref++ };
    },
    clearIntervalFn: () => void t.cleared++,
  };
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

test('startup pass runs once immediately and the hourly interval is scheduled and unref-ed', async () => {
  const f = fakeTimers();
  let runs = 0;
  const s = startPurgeScheduler({ run: async () => ++runs, ...f });
  await s.tick();
  assert.equal(f.t.ms, 3_600_000);
  assert.equal(f.t.unref, 1);
  assert.equal(runs, 1, 'startup pass ran (tick joined the in-flight pass)');
  f.t.fn();
  await s.tick();
  assert.equal(runs, 2, 'interval fires another pass');
  await s.stop();
});

test('passes never overlap: interval during an in-flight pass is skipped', async () => {
  const f = fakeTimers();
  const gate = deferred();
  let runs = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const s = startPurgeScheduler({
    run: async () => {
      runs++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate.promise;
      concurrent--;
      return 0;
    },
    ...f,
  });
  f.t.fn();
  f.t.fn();
  const joined = s.tick();
  assert.equal(
    runs,
    1,
    'interval ticks and manual tick join the in-flight pass',
  );
  gate.resolve();
  await joined;
  f.t.fn();
  await s.tick();
  assert.equal(runs, 2, 'a new pass starts once the previous one finished');
  assert.equal(maxConcurrent, 1);
  await s.stop();
});

test('failures are logged without detail, do not reject, and later passes still run', async () => {
  const f = fakeTimers();
  const logs = [];
  let n = 0;
  const s = startPurgeScheduler({
    run: async () => {
      n++;
      if (n === 1)
        throw Object.assign(new Error('secret=abc /private/path jpeg-bytes'), {
          name: 'PgError',
        });
      return 0;
    },
    logger: { warn: (m) => logs.push(m) },
    ...f,
  });
  await s.tick();
  assert.deepEqual(logs, ['FIN receipt cleanup failed (PgError)']);
  assert.ok(!logs.join().includes('secret'));
  f.t.fn();
  await s.tick();
  assert.equal(n, 2);
  assert.equal(logs.length, 1);
  await s.stop();
});

test('a throwing logger cannot break the scheduler', async () => {
  const f = fakeTimers();
  const s = startPurgeScheduler({
    run: async () => {
      throw new Error('x');
    },
    logger: {
      warn: () => {
        throw new Error('log down');
      },
    },
    ...f,
  });
  await s.tick();
  await s.stop();
});

test('stop clears the timer, waits for the in-flight pass and blocks further passes', async () => {
  const f = fakeTimers();
  const gate = deferred();
  let runs = 0;
  let finished = false;
  const s = startPurgeScheduler({
    run: async () => {
      runs++;
      await gate.promise;
      finished = true;
      return 0;
    },
    ...f,
  });
  const stopping = s.stop();
  assert.equal(f.t.cleared, 1);
  gate.resolve();
  await stopping;
  assert.equal(finished, true);
  f.t.fn();
  await s.tick();
  assert.equal(runs, 1, 'no new pass after stop');
});

test('startServer: runs a cleanup on boot, keeps manual FIN reachable when cleanup fails, and stops on close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fin-purge-'));
  const queries = [];
  let ended = 0;
  const pool = {
    query: async (sql) => {
      queries.push(String(sql));
      throw Object.assign(new Error('db down: password=hunter2'), {
        name: 'ConnError',
      });
    },
    end: async () => void ended++,
  };
  const warns = [];
  const origWarn = console.warn;
  console.warn = (m) => warns.push(String(m));
  let running;
  try {
    running = await startServer(
      {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        isProduction: false,
        csrfSecret: 'x'.repeat(40),
        allowedOrigins: [],
        trustedProxies: [],
        database: {},
        finReceiptDirectory: dir,
      },
      pool,
    );
    const deadline = Date.now() + 2000;
    while (warns.length < 2 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(
      queries.some((q) => q.includes('fin_receipts')),
      'cleanup query issued at startup',
    );
    assert.ok(
      queries.some((q) => q.includes('account_reauth_proofs')),
      'auth/session housekeeping also runs at startup',
    );
    assert.deepEqual(
      [...warns].sort(),
      [
        'Auth session cleanup failed (ConnError)',
        'FIN receipt cleanup failed (ConnError)',
      ],
      'each housekeeping job reports its own name and never leaks error text',
    );
    assert.ok(!warns.join().includes('hunter2'));
    const res = await fetch(
      `http://127.0.0.1:${running.server.address().port}/api/v1/health`,
    ).catch(() => null);
    assert.ok(res, 'server still answers after a failed cleanup');
    await running.close();
    running = undefined;
    assert.equal(ended, 1);
    const before = queries.length;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(queries.length, before, 'no cleanup after close');
  } finally {
    console.warn = origWarn;
    if (running) await running.close();
    await rm(dir, { recursive: true, force: true });
  }
});
