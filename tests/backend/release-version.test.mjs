import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';

test('version endpoint is explicit and safe before release packaging', async () => {
  const server = http.createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(
      'http://127.0.0.1:' + server.address().port + '/api/v1/version',
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data, {
      commit: 'unversioned',
      version: '0.1.0',
      target: 'development',
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
