import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

function makeRequest(url, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolvePromise({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        } catch {
          resolvePromise({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/v1/health returns 200 with Doc 24 success envelope', async () => {
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  const handler = createRequestHandler();
  const server = http.createServer(handler);

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const customRequestId = 'test-req-uuid-1234';
    const response = await makeRequest(
      `http://127.0.0.1:${port}/api/v1/health`,
      {
        headers: { 'X-Request-Id': customRequestId },
      },
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, 'pass');
    assert.equal(response.body.data.service, '@management-lite/api');
    assert.equal(response.body.meta.request_id, customRequestId);
    assert.equal(response.headers['x-request-id'], customRequestId);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test('GET /api/v1/ready returns 200 when database pool is healthy', async () => {
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  // Mock pool with successful ping
  const mockHealthyPool = {
    query: async (sql) => {
      if (sql.includes('SELECT 1')) {
        return { rows: [{ ping: 1 }] };
      }
      return { rows: [] };
    },
  };

  const handler = createRequestHandler({ pool: mockHealthyPool });
  const server = http.createServer(handler);

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const response = await makeRequest(`http://127.0.0.1:${port}/api/v1/ready`);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, 'ready');
    assert.equal(response.body.data.database, 'connected');
    assert.ok(typeof response.body.data.latency_ms === 'number');
    assert.ok(response.body.meta.request_id);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test('GET /api/v1/ready returns 503 with sanitized error when DB is unavailable (zero credential leaks)', async () => {
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  // Mock pool simulating a database connection failure with credentials in raw error
  const mockFailingPool = {
    query: async () => {
      throw new Error(
        'Connection to postgresql://admin:super_secret_pw@127.0.0.1:5432/mglite failed: ECONNREFUSED',
      );
    },
  };

  const handler = createRequestHandler({ pool: mockFailingPool });
  const server = http.createServer(handler);

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const response = await makeRequest(`http://127.0.0.1:${port}/api/v1/ready`);

    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(
      response.body.error.message,
      'Database connection is not ready',
    );
    assert.ok(response.body.meta.request_id);

    // CRITICAL: Ensure zero credential or internal stack leak in HTTP response
    const rawBody = JSON.stringify(response.body);
    assert.ok(!rawBody.includes('super_secret_pw'));
    assert.ok(!rawBody.includes('postgresql://'));
    assert.ok(!rawBody.includes('ECONNREFUSED'));
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test('Unknown route returns 404 with Doc 24 error envelope', async () => {
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  const handler = createRequestHandler();
  const server = http.createServer(handler);

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const response = await makeRequest(
      `http://127.0.0.1:${port}/api/v1/nonexistent`,
    );

    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'NOT_FOUND');
    assert.ok(response.body.meta.request_id);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test('startServer lifecycle starts on configured host/port and closes cleanly', async () => {
  const { startServer } = await import(
    `file://${resolve(root, 'dist/apps/api/src/server.js')}`
  );

  const mockConfig = {
    port: 0, // Ephemeral port for test
    host: '127.0.0.1',
    nodeEnv: 'test',
    database: {
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 2000,
    },
  };

  let poolClosed = false;
  const mockPool = {
    end: async () => {
      poolClosed = true;
    },
  };

  const running = await startServer(mockConfig, mockPool);
  assert.ok(running.server.listening);

  await running.close();
  assert.equal(running.server.listening, false);
  assert.equal(poolClosed, true);
});
