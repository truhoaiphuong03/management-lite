import test from 'node:test';
import assert from 'node:assert/strict';
import { installAuthInterceptor } from '../../dist/apps/web/src/auth-interceptor.js';

test('expired sessions replay Request bodies and rotate Request CSRF headers safely', async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  const origin = 'https://app.example.test';
  globalThis.window = {
    location: { origin, pathname: '/work' },
    fetch: async (input, init) => {
      const request =
        input instanceof Request
          ? new Request(input, init)
          : new Request(new URL(input, origin), init);
      const body = await request.text();
      calls.push({
        path: new URL(request.url).pathname,
        csrf: request.headers.get('X-CSRF-Token'),
        body,
        idempotency: request.headers.get('Idempotency-Key'),
      });
      if (request.url.endsWith('/auth/refresh'))
        return Response.json({
          success: true,
          data: { csrf_token: 'fresh-csrf' },
        });
      return new Response('{}', { status: calls.length === 1 ? 401 : 200 });
    },
  };
  try {
    installAuthInterceptor();
    const request = new Request(`${origin}/api/v1/work-items`, {
      method: 'POST',
      headers: {
        'X-CSRF-Token': 'old-csrf',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'same-operation',
      },
      body: JSON.stringify({ title: 'Test' }),
    });
    const response = await window.fetch(request);
    assert.equal(response.status, 200);
    assert.deepEqual(
      calls.map((c) => c.path),
      ['/api/v1/work-items', '/api/v1/auth/refresh', '/api/v1/work-items'],
    );
    assert.equal(calls[2].csrf, 'fresh-csrf');
    assert.equal(calls[2].body, calls[0].body);
    assert.equal(calls[2].idempotency, 'same-operation');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
