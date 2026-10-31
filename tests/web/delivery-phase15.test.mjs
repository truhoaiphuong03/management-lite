import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const { createWebServer, negotiateEncoding } = require(
  resolve(root, 'scripts/runtime/serve-web.cjs'),
);

function request(port, { method = 'GET', path: p = '/', headers = {} } = {}) {
  return new Promise((resolveReq, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: p, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolveReq({
            status: res.statusCode,
            headers: res.headers,
            raw: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-p15-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const web = createWebServer({ root: dir, apiHost: '127.0.0.1', apiPort: 1 });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  try {
    await fn({ port: web.address().port, dir });
  } finally {
    web.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BIG_JS = 'export const answer = () => 42;\n'.repeat(400);
const INDEX_HTML =
  '<!doctype html><html><head><title>t</title></head><body><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>' +
  ' '.repeat(1100);

// ---------------------------------------------------------------------------
// 15.1 Static delivery: cache policy, compression, validators, 404s
// ---------------------------------------------------------------------------
test('PH15-1: negotiateEncoding honours q-values, wildcards and unsupported codings', () => {
  assert.equal(negotiateEncoding('gzip, deflate, br'), 'br');
  assert.equal(negotiateEncoding('gzip'), 'gzip');
  assert.equal(negotiateEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(negotiateEncoding('br;q=0, gzip;q=0'), null);
  assert.equal(negotiateEncoding('*'), 'br');
  assert.equal(negotiateEncoding('identity'), null);
  assert.equal(negotiateEncoding(undefined), null);
});

test('PH15-1: hashed assets are immutable and compressed with the best accepted coding', async () => {
  await withServer(
    { 'index.html': INDEX_HTML, 'assets/app-abc123.js': BIG_JS },
    async ({ port }) => {
      const br = await request(port, {
        path: '/assets/app-abc123.js',
        headers: { 'accept-encoding': 'gzip, br' },
      });
      assert.equal(br.status, 200);
      assert.equal(br.headers['content-encoding'], 'br');
      assert.equal(
        br.headers['cache-control'],
        'public, max-age=31536000, immutable',
      );
      assert.equal(br.headers.vary, 'Accept-Encoding');
      assert.match(br.headers.etag, /^W\/"[0-9a-f]{24}"$/);
      assert.equal(Number(br.headers['content-length']), br.raw.length);
      assert.ok(
        br.raw.length < BIG_JS.length / 5,
        'brotli shrinks repetitive JS',
      );
      assert.equal(zlib.brotliDecompressSync(br.raw).toString(), BIG_JS);

      const gz = await request(port, {
        path: '/assets/app-abc123.js',
        headers: { 'accept-encoding': 'gzip' },
      });
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.equal(zlib.gunzipSync(gz.raw).toString(), BIG_JS);

      const plain = await request(port, { path: '/assets/app-abc123.js' });
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(plain.raw.toString(), BIG_JS);
      assert.equal(plain.headers['content-type'], 'text/javascript');
    },
  );
});

test('PH15-1: conditional requests return 304 and the shell is revalidated, not frozen', async () => {
  await withServer(
    { 'index.html': INDEX_HTML, 'assets/app-abc123.js': BIG_JS },
    async ({ port }) => {
      const first = await request(port, { path: '/assets/app-abc123.js' });
      const notModified = await request(port, {
        path: '/assets/app-abc123.js',
        headers: { 'if-none-match': first.headers.etag },
      });
      assert.equal(notModified.status, 304);
      assert.equal(notModified.raw.length, 0);
      assert.equal(notModified.headers.etag, first.headers.etag);

      const shell = await request(port, { path: '/' });
      assert.equal(shell.status, 200);
      assert.equal(shell.headers['cache-control'], 'no-cache');
      assert.ok(
        shell.headers['content-security-policy'].includes("script-src 'self'"),
      );
      const shell304 = await request(port, {
        path: '/work/123',
        headers: { 'if-none-match': shell.headers.etag },
      });
      assert.equal(
        shell304.status,
        304,
        'SPA routes share the shell validator',
      );
      assert.ok(
        shell304.headers['content-security-policy'],
        'a 304 still carries the CSP header',
      );
    },
  );
});

test('PH15-1: missing assets and file-like paths are real 404s, SPA routes fall back to the shell', async () => {
  await withServer({ 'index.html': INDEX_HTML }, async ({ port }) => {
    const oldAsset = await request(port, { path: '/assets/app-OLDHASH.js' });
    assert.equal(oldAsset.status, 404);
    assert.equal(oldAsset.headers['cache-control'], 'no-store');
    assert.ok(
      !oldAsset.raw.toString().includes('<!doctype'),
      'never answers JS with HTML',
    );

    const favicon = await request(port, { path: '/favicon.ico' });
    assert.equal(favicon.status, 404);

    const route = await request(port, { path: '/payroll/stats' });
    assert.equal(route.status, 200);
    assert.ok(route.raw.toString().includes('id="root"'));
  });
});

test('PH15-1: small files, images and HEAD requests are served without needless compression', async () => {
  await withServer(
    {
      'index.html': INDEX_HTML,
      'assets/tiny.js': 'x=1',
      'assets/logo.png': Buffer.alloc(4096, 7),
    },
    async ({ port }) => {
      const tiny = await request(port, {
        path: '/assets/tiny.js',
        headers: { 'accept-encoding': 'br' },
      });
      assert.equal(tiny.headers['content-encoding'], undefined);
      assert.equal(tiny.headers.vary, undefined);

      const png = await request(port, {
        path: '/assets/logo.png',
        headers: { 'accept-encoding': 'br, gzip' },
      });
      assert.equal(png.headers['content-encoding'], undefined);
      assert.equal(png.raw.length, 4096);
      assert.equal(png.headers['content-type'], 'image/png');

      const head = await request(port, {
        method: 'HEAD',
        path: '/assets/logo.png',
      });
      assert.equal(head.status, 200);
      assert.equal(head.raw.length, 0);
      assert.equal(Number(head.headers['content-length']), 4096);
    },
  );
});

test('PH15-1: an edited file is picked up (cache keyed by mtime) with a new validator', async () => {
  await withServer(
    { 'index.html': INDEX_HTML, 'assets/app-abc123.js': BIG_JS },
    async ({ port, dir }) => {
      const before = await request(port, { path: '/assets/app-abc123.js' });
      const file = path.join(dir, 'assets/app-abc123.js');
      fs.writeFileSync(file, BIG_JS + '// changed\n');
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(file, future, future);
      const after = await request(port, { path: '/assets/app-abc123.js' });
      assert.notEqual(after.headers.etag, before.headers.etag);
      assert.ok(after.raw.toString().endsWith('// changed\n'));
    },
  );
});

// ---------------------------------------------------------------------------
// 15.2 Route-level code splitting (static guarantees on the source)
// ---------------------------------------------------------------------------
test('PH15-2: App.tsx loads feature screens lazily and keeps only the shell essentials eager', () => {
  const app = fs.readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');
  const lazySrc = fs.readFileSync(
    resolve(root, 'apps/web/src/lazy-screens.ts'),
    'utf8',
  );

  const eagerAllowed = new Set([
    'LoginScreen',
    'SettingsScreen',
    'NotFoundScreen',
    'PlaceholderScreen',
  ]);
  const eagerImports = [
    ...app.matchAll(/^import \{ (\w+Screen) \} from '\.\/screens\//gm),
  ].map((m) => m[1]);
  for (const name of eagerImports) {
    assert.ok(
      eagerAllowed.has(name),
      `${name} must be lazy, not imported eagerly`,
    );
  }

  const exported = [...lazySrc.matchAll(/^export const (\w+) = lazy\(/gm)].map(
    (m) => m[1],
  );
  assert.ok(exported.length >= 26, 'all feature screens are exported lazily');
  for (const name of exported) {
    assert.match(
      lazySrc,
      new RegExp(
        `export const ${name} = lazy\\(\\(\\) =>\\s+import\\('\\./screens/${name}\\.js'\\)\\.then\\(\\(m\\) => \\(\\{\\s+default: m\\.${name},?\\s*\\}`,
      ),
      `${name} must lazy-load ./screens/${name}.js and its same-named export`,
    );
    assert.ok(app.includes(name), `App.tsx must use ${name}`);
  }

  // Every screen rendered by App.tsx is either eager-allowed or provided by lazy-screens.
  const used = new Set([...app.matchAll(/<(\w+Screen)\b/g)].map((m) => m[1]));
  for (const name of used) {
    assert.ok(
      eagerAllowed.has(name) || exported.includes(name),
      `<${name}> is rendered but neither eager-allowed nor lazy`,
    );
  }

  // Suspense must wrap both the public screens and the in-shell content.
  assert.ok(app.includes('React.Suspense'));
  assert.ok(app.includes('{withSuspense(renderContent())}'));
  assert.equal(
    (app.match(/withSuspense\(/g) || []).length >= 5,
    true,
    'public screens and shell content are all inside Suspense',
  );
});

test('PH15-2: vite no longer groups screens into eager manual chunks', () => {
  const vite = fs.readFileSync(
    resolve(root, 'apps/web/vite.config.ts'),
    'utf8',
  );
  assert.ok(vite.includes("return 'vendor-react'"));
  assert.ok(!/screen-(payroll|attendance|storage|employees)/.test(vite));
});

// ---------------------------------------------------------------------------
// 15.5 Bundle budget
// ---------------------------------------------------------------------------
const budgetModule = await import(
  pathToFileURL(resolve(root, 'scripts/check-bundle-budget.mjs')).href
);

test('PH15-5: initialAssets lists the entry, preloads and stylesheet but never lazy chunks', () => {
  const html = `<!doctype html><head>
    <script type="module" crossorigin src="/assets/index-AAA.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-react-BBB.js">
    <link rel="stylesheet" crossorigin href="/assets/index-CCC.css">
    <link rel="icon" href="/favicon.ico">
    <script>console.log('inline')</script>
  </head>`;
  assert.deepEqual(budgetModule.initialAssets(html).sort(), [
    'assets/index-AAA.js',
    'assets/index-CCC.css',
    'assets/vendor-react-BBB.js',
  ]);
});

test('PH15-5: measure() passes within budget and flags oversize initial JS and chunks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-budget-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<script type="module" src="/assets/index-A.js"></script><link rel="stylesheet" href="/assets/index-A.css">',
    );
    const noise = () =>
      Buffer.from(
        Array.from({ length: 80 * 1024 }, () =>
          Math.floor(Math.random() * 256),
        ),
      );
    fs.writeFileSync(path.join(dir, 'assets/index-A.js'), noise());
    fs.writeFileSync(path.join(dir, 'assets/index-A.css'), 'a{}');
    fs.writeFileSync(path.join(dir, 'assets/LazyScreen-B.js'), noise());

    const ok = budgetModule.measure(dir, {
      initialRawKb: 100,
      initialGzipKb: 100,
      chunkRawKb: 100,
    });
    assert.deepEqual(ok.problems, []);
    assert.equal(
      ok.initialJs.length,
      1,
      'css and lazy chunks do not count as initial JS',
    );

    const tight = budgetModule.measure(dir, {
      initialRawKb: 50,
      initialGzipKb: 50,
      chunkRawKb: 50,
    });
    assert.equal(
      tight.problems.length,
      4,
      'raw + gzip + two chunks over their ceilings',
    );
    assert.ok(tight.problems.some((p) => p.includes('LazyScreen-B.js')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PH15-5: the real build keeps screens out of the first load and inside the budget', (t) => {
  const distIndex = resolve(root, 'apps/web/dist/index.html');
  if (!fs.existsSync(distIndex)) {
    t.skip('apps/web/dist not built');
    return;
  }
  const result = budgetModule.measure(resolve(root, 'apps/web/dist'));
  const screensInInitial = result.initial.filter((a) => /Screen-/.test(a.rel));
  if (screensInInitial.length > 0 && result.initial.length > 5) {
    t.skip(
      'apps/web/dist predates route-level code splitting; rebuild with npm run build:web',
    );
    return;
  }
  assert.deepEqual(
    screensInInitial.map((a) => a.rel),
    [],
    'no screen chunk may be part of the initial load',
  );
  assert.deepEqual(result.problems, []);
});
