import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createWebServer } = require('../../scripts/runtime/serve-web.cjs');

function httpGet(port, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
        headers: {
          'Accept-Encoding': 'br, gzip',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('PERF-01: serve-web.cjs enforces immutable /assets/* cache, Brotli prewarm, bounded LRU eviction, and keep-alive API proxy', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mglite-serve-web-'));
  const assetsDir = path.join(tmpRoot, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const jsBody = 'console.log("management-lite-asset");\n'.repeat(120);
  fs.writeFileSync(
    path.join(tmpRoot, 'index.html'),
    '<!doctype html><html><head><script>window.__T=1;</script><script type="module" src="/assets/index-test123.js"></script></head><body><div id="root"></div></body></html>',
    'utf8',
  );
  fs.writeFileSync(path.join(assetsDir, 'index-test123.js'), jsBody, 'utf8');
  fs.writeFileSync(path.join(assetsDir, 'extra-1.js'), jsBody + '//1', 'utf8');
  fs.writeFileSync(path.join(assetsDir, 'extra-2.js'), jsBody + '//2', 'utf8');

  let upstreamConnections = 0;
  const apiServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  apiServer.on('connection', () => {
    upstreamConnections++;
  });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  const apiPort = apiServer.address().port;

  const webServer = createWebServer({
    root: tmpRoot,
    apiHost: '127.0.0.1',
    apiPort,
    maxCachedEntries: 3,
    prewarm: true,
  });
  await new Promise((r) => webServer.listen(0, '127.0.0.1', r));
  const webPort = webServer.address().port;

  try {
    // Allow background prewarm timer to populate compressed variants
    await new Promise((r) => setTimeout(r, 80));

    const shellRes = await httpGet(webPort, '/');
    assert.equal(shellRes.status, 200);
    assert.equal(shellRes.headers['cache-control'], 'no-cache');
    assert.ok(shellRes.headers['etag']);
    assert.ok(shellRes.headers['content-security-policy']?.includes('sha256-'));

    const assetRes = await httpGet(webPort, '/assets/index-test123.js');
    assert.equal(assetRes.status, 200);
    assert.equal(
      assetRes.headers['cache-control'],
      'public, max-age=31536000, immutable',
    );
    assert.equal(assetRes.headers['content-encoding'], 'br');
    assert.ok(assetRes.body.length < Buffer.byteLength(jsBody));

    const notModified = await httpGet(webPort, '/assets/index-test123.js', {
      'If-None-Match': assetRes.headers['etag'],
    });
    assert.equal(notModified.status, 304);

    // LRU eviction safety across > maxCachedEntries files
    const e1 = await httpGet(webPort, '/assets/extra-1.js');
    const e2 = await httpGet(webPort, '/assets/extra-2.js');
    const reloadMain = await httpGet(webPort, '/assets/index-test123.js');
    assert.equal(e1.status, 200);
    assert.equal(e2.status, 200);
    assert.equal(reloadMain.status, 200);

    // Sequential API proxy requests reuse pooled keep-alive socket
    for (let i = 0; i < 4; i++) {
      const apiRes = await httpGet(webPort, `/api/v1/health?seq=${i}`);
      assert.equal(apiRes.status, 200);
    }
    assert.equal(
      upstreamConnections,
      1,
      'Expected proxyToApi http.Agent({ keepAlive: true }) to reuse 1 upstream TCP connection across sequential requests',
    );
  } finally {
    await new Promise((r) => webServer.close(r));
    await new Promise((r) => apiServer.close(r));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test(
  'PERF-01: Switch-ProductionWebServerToServeWeb.ps1 SandboxMode switches legacy script to canonical serve-web.cjs and rolls back on failure',
  { skip: process.platform !== 'win32' },
  async () => {
    const sandboxRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mglite-web-cutover-sbx-'),
    );
    const runtimeDir = path.join(
      sandboxRoot,
      'apps/management-lite/scripts/runtime',
    );
    const webDistDir = path.join(
      sandboxRoot,
      'apps/management-lite/apps/web/dist/assets',
    );
    const scriptsDir = path.join(sandboxRoot, 'scripts');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(webDistDir, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });

    fs.copyFileSync(
      path.resolve('scripts/runtime/serve-web.cjs'),
      path.join(runtimeDir, 'serve-web.cjs'),
    );
    fs.writeFileSync(
      path.join(sandboxRoot, 'apps/management-lite/apps/web/dist/index.html'),
      '<!doctype html><html><head><script src="/assets/index-sbx.js"></script></head><body>ok</body></html>',
      'utf8',
    );
    fs.writeFileSync(
      path.join(webDistDir, 'index-sbx.js'),
      'console.log("sbx");\n'.repeat(150),
      'utf8',
    );
    const legacyPath = path.join(scriptsDir, 'serve-management-web.cjs');
    const legacyMarker = '// LEGACY_NO_STORE_SERVER_V0\n';
    fs.writeFileSync(legacyPath, legacyMarker, 'utf8');

    const psScript = path.resolve(
      'scripts/deployment/Switch-ProductionWebServerToServeWeb.ps1',
    );

    try {
      // 1. Simulated verification failure must roll back to exact legacy bytes
      const failRun = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          psScript,
          '-ServerRoot',
          sandboxRoot,
          '-SandboxMode',
          '-SkipServiceRestart',
          '-SimulateVerificationFailure',
        ],
        { encoding: 'utf8' },
      );
      assert.notEqual(failRun.status, 0);
      assert.equal(
        fs.readFileSync(legacyPath, 'utf8'),
        legacyMarker,
        'Must restore exact legacy bytes on verification failure',
      );

      // 2. Write delegator in SandboxMode, boot delegated server on ephemeral port, and run live HTTP verification
      const writeRun = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          psScript,
          '-ServerRoot',
          sandboxRoot,
          '-SandboxMode',
          '-SkipServiceRestart',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(writeRun.status, 0, writeRun.stderr || writeRun.stdout);
      const delegatedCode = fs.readFileSync(legacyPath, 'utf8');
      assert.ok(delegatedCode.includes('serve-web.cjs'));

      // Boot the generated delegator on a random free port and verify headers
      const probeServer = http.createServer();
      await new Promise((r) => probeServer.listen(0, '127.0.0.1', r));
      const freePort = probeServer.address().port;
      await new Promise((r) => probeServer.close(r));

      const child = spawn(process.execPath, [legacyPath], {
        env: {
          ...process.env,
          WEB_HOST: '127.0.0.1',
          WEB_PORT: String(freePort),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Delegated server boot timeout')),
            5000,
          );
          child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('serve-web.cjs')) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`Exited early: ${code}`));
          });
        });

        const assetCheck = await httpGet(freePort, '/assets/index-sbx.js');
        assert.equal(assetCheck.status, 200);
        assert.equal(
          assetCheck.headers['cache-control'],
          'public, max-age=31536000, immutable',
        );
        assert.equal(assetCheck.headers['content-encoding'], 'br');
      } finally {
        child.kill();
      }
    } finally {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  },
);
