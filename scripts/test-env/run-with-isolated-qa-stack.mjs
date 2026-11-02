import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const FORBIDDEN_PORTS = new Set([
  3000, 3001, 3002, 3004, 3005, 3007, 3008, 3017, 3018, 3027, 3028, 55432,
  55433,
]);

async function allocateFreeLoopbackPort(exclude = new Set()) {
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
    });
    if (!FORBIDDEN_PORTS.has(port) && !exclude.has(port)) {
      return port;
    }
  }
}

async function main() {
  const testFile = process.argv[2];
  if (!testFile) {
    throw new Error(
      'Usage: node scripts/test-env/run-with-isolated-qa-stack.mjs <test-file>',
    );
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } = await import(
    pathToFileURL(path.join(ROOT, 'dist/packages/database/src/config.js')).href
  );
  const { createDatabasePool } = await import(
    pathToFileURL(path.join(ROOT, 'dist/packages/database/src/pool.js')).href
  );
  const { runMigrations, loadMigrationFiles } = await import(
    pathToFileURL(path.join(ROOT, 'dist/packages/database/src/migrator.js'))
      .href
  );
  const { startServer } = await import(
    pathToFileURL(path.join(ROOT, 'dist/apps/api/src/server.js')).href
  );
  const { normalizeEncryptionKey } = await import(
    pathToFileURL(path.join(ROOT, 'dist/packages/security/src/aead.js')).href
  );

  const dbConfig = loadTestDatabaseConfig(process.env);
  assertSafeTestDatabase(dbConfig, process.env);

  const qaCredsPath = path.join(ROOT, '.env.qa-credentials.local');
  const hadExistingCreds = fs.existsSync(qaCredsPath);
  if (!hadExistingCreds) {
    const mkPass = (prefix) =>
      `${prefix}_${crypto.randomBytes(12).toString('base64url')}!9Aa`;
    const credsContent = [
      `OWNER_PASSWORD=${mkPass('OwnerIso')}`,
      `ADMIN_PASSWORD=${mkPass('AdminIso')}`,
      `STAFF_PASSWORD=${mkPass('StaffIso')}`,
      `STAFF2_PASSWORD=${mkPass('Staff2Iso')}`,
      '',
    ].join('\n');
    fs.writeFileSync(qaCredsPath, credsContent, 'utf8');
  }

  const accountSecretKey =
    process.env.ACCOUNT_SECRET_KEY || crypto.randomBytes(32).toString('hex');
  process.env.ACCOUNT_SECRET_KEY = accountSecretKey;

  let runningApi = null;
  let webProxy = null;

  try {
    // 1. Migrate isolated test database
    const migPool = createDatabasePool(dbConfig);
    try {
      await runMigrations(
        migPool,
        loadMigrationFiles(path.join(ROOT, 'packages/database/src/migrations')),
      );
    } finally {
      await migPool.end();
    }

    // 2. Seed unified QA dataset into isolated test database
    const seedRes = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/seed-unified-qa.mjs')],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          ACCOUNT_SECRET_KEY: accountSecretKey,
        },
      },
    );
    if (seedRes.status !== 0) {
      throw new Error(
        `seed-unified-qa.mjs failed (exit ${seedRes.status}):\n${seedRes.stderr || seedRes.stdout}`,
      );
    }

    // 3. Allocate isolated loopback ports for QA API & Web proxy
    const apiPort = await allocateFreeLoopbackPort();
    const webPort = await allocateFreeLoopbackPort(new Set([apiPort]));
    const apiBase = `http://127.0.0.1:${apiPort}`;
    const webBase = `http://127.0.0.1:${webPort}`;

    const apiPool = createDatabasePool(dbConfig);
    runningApi = await startServer(
      {
        port: apiPort,
        host: '127.0.0.1',
        nodeEnv: 'test',
        isProduction: false,
        database: dbConfig,
        csrfSecret: crypto.randomBytes(32).toString('hex'),
        allowedOrigins: [webBase, apiBase],
        trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
        accountSecretKey: normalizeEncryptionKey(accountSecretKey),
        sessionCookieName: 'mglite_session',
      },
      apiPool,
    );

    webProxy = http.createServer((req, res) => {
      if (req.url && req.url.startsWith('/api/')) {
        const upstream = http.request(
          {
            host: '127.0.0.1',
            port: apiPort,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: `127.0.0.1:${webPort}` },
          },
          (upRes) => {
            res.writeHead(upRes.statusCode ?? 502, upRes.headers);
            upRes.pipe(res);
          },
        );
        upstream.on('error', (err) => {
          if (!res.headersSent) res.writeHead(502);
          res.end(String(err));
        });
        req.pipe(upstream);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end('<!doctype html><html><body>Isolated QA Web Proxy</body></html>');
    });

    await new Promise((resolve, reject) => {
      webProxy.once('error', reject);
      webProxy.listen(webPort, '127.0.0.1', resolve);
    });

    // 4. Execute target test file asynchronously so this process event loop serves runningApi & webProxy!
    const testStatus = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--test', testFile], {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          QA_API_BASE: apiBase,
          QA_WEB_BASE: webBase,
          ACCOUNT_SECRET_KEY: accountSecretKey,
        },
      });
      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', () => resolve(1));
    });

    process.exitCode = testStatus;
  } finally {
    if (webProxy) {
      webProxy.closeAllConnections?.();
      await new Promise((resolve) => webProxy.close(() => resolve()));
    }
    if (runningApi) {
      runningApi.server.closeAllConnections?.();
      await runningApi.close();
    }
    if (!hadExistingCreds && fs.existsSync(qaCredsPath)) {
      fs.rmSync(qaCredsPath, { force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
