// Staging only. Configuration stays on Windows; this file never loads a Mac .env.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateStagingEnvironment(env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('Explicit staging DATABASE_URL required');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55433' ||
    decodeURIComponent(url.username) !== 'hp_stage_app' ||
    !url.password ||
    !env.APPROVED_STAGING_DATABASE_NAME ||
    decodeURIComponent(url.pathname.slice(1)) !==
      env.APPROVED_STAGING_DATABASE_NAME
  )
    throw new Error('Database does not match approved staging binding');
  if (
    env.NODE_ENV !== 'staging' ||
    env.HOST !== '127.0.0.1' ||
    env.PORT !== '3202'
  )
    throw new Error('Staging process binding required');
  if (
    !env.CSRF_SECRET ||
    env.CSRF_SECRET.length < 32 ||
    env.CSRF_SECRET.startsWith('mglite_dev_') ||
    /^(.)\1+$/.test(env.CSRF_SECRET) ||
    !env.ACCOUNT_SECRET_KEY
  )
    throw new Error(
      'Explicit staging keys required; preserve existing staging encryption key',
    );
  if (
    env.FIN_RECEIPT_DIR &&
    !path.win32
      .resolve(env.FIN_RECEIPT_DIR)
      .toLowerCase()
      .startsWith('c:\\hoaiphuong-staging\\shared\\receipts\\')
  )
    throw new Error(
      'Receipt storage must be inside dedicated staging receipt directory',
    );
}

export function resolveStaticFile(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  if (
    pathname.includes('\\') ||
    pathname.includes('\0') ||
    pathname.split('/').some((p) => p.startsWith('.'))
  )
    return null;
  const file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  if (path.extname(pathname)) return null;
  return path.join(root, 'index.html');
}

async function main() {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    process.versions.node !== '22.14.0'
  )
    throw new Error('Windows x64 Node 22.14.0 required');
  const mode = process.argv[2];
  if (mode === 'api') {
    validateStagingEnvironment(process.env);
    await import('../../dist/apps/api/src/main.js');
    return;
  }
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };
  const root = path.resolve(
    fileURLToPath(new URL('../../web/', import.meta.url)),
  );
  const ports = { web: 3201, gateway: 3203 };
  if (!ports[mode]) throw new Error('Mode must be api, web or gateway');
  http
    .createServer((req, res) => {
      if (mode === 'gateway') {
        const port = req.url?.startsWith('/api/') ? 3202 : 3201;
        const upstream = http.request(
          {
            host: '127.0.0.1',
            port,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: '127.0.0.1:3203' },
          },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          },
        );
        upstream.setTimeout(15000, () => upstream.destroy());
        upstream.on('error', () => {
          if (!res.headersSent) res.writeHead(502);
          res.end('Staging upstream unavailable');
        });
        req.on('aborted', () => upstream.destroy());
        req.pipe(upstream);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method ?? '')) {
        res.writeHead(405);
        res.end();
        return;
      }
      const file = resolveStaticFile(root, req.url ?? '/');
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      fs.readFile(file, (err, bytes) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type':
            mime[path.extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      });
    })
    .listen(ports[mode], '127.0.0.1', () =>
      console.log(`Staging ${mode} listening on loopback:${ports[mode]}`),
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      'Staging startup failed; check isolated configuration and port ownership',
    );
    process.exitCode = 1;
  });
