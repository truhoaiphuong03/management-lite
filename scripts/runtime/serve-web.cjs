#!/usr/bin/env node
/**
 * Static web + API reverse proxy for Management Lite (the process behind HPManagementLiteWeb).
 *
 * Tracked in the repository so its behaviour is reviewed, tested and released like the rest
 * of the code. Configuration (all optional):
 *   WEB_ROOT   directory with the built SPA   (default: apps/web/dist)
 *   WEB_HOST   bind address                   (default: 127.0.0.1)
 *   WEB_PORT   bind port                      (default: 3001)
 *   API_HOST   upstream API host              (default: 127.0.0.1)
 *   API_PORT   upstream API port              (default: 3002)
 */
'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS runtime script, no build step */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** Text-like types worth compressing; images and woff/woff2 are already compressed. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.ttf']);
const MIN_COMPRESS_BYTES = 1024;
/** Files above this size are streamed instead of being kept in memory. */
const MAX_CACHED_BYTES = 8 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 60_000;

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_REVALIDATE = 'no-cache';
const CACHE_SHORT = 'public, max-age=3600';

/**
 * Builds the Content-Security-Policy for the HTML document. Inline scripts (the theme
 * bootstrap that prevents a light/dark flash) are allowed by SHA-256 hash instead of
 * 'unsafe-inline', so injected scripts still cannot run.
 */
function buildCsp(indexHtml) {
  const hashes = [];
  const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(indexHtml)) !== null) {
    // The HTML parser normalises CR/CRLF to LF before the script text is hashed.
    const body = match[1].replace(/\r\n?/g, '\n');
    if (body.trim().length === 0) continue;
    const digest = crypto
      .createHash('sha256')
      .update(body, 'utf8')
      .digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...hashes].join(' ')}`,
    // React renders inline style attributes, so styles keep 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    // img.vietqr.io renders the bank-transfer QR code in the payroll dialog.
    "img-src 'self' data: blob: https://img.vietqr.io",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function securityHeaders(req) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  // TLS terminates at the tunnel/edge; only advertise HSTS when the request arrived over it.
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    headers['Strict-Transport-Security'] =
      'max-age=31536000; includeSubDomains';
  }
  return headers;
}

/** Picks the best supported content-coding from an Accept-Encoding header. */
function negotiateEncoding(acceptEncoding) {
  if (typeof acceptEncoding !== 'string') return null;
  const accepted = new Map();
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    accepted.set(name.trim(), q);
  }
  const ok = (name) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  if (header.trim() === '*') return true;
  const strip = (v) => v.trim().replace(/^W\//, '');
  return header.split(',').some((v) => strip(v) === strip(etag));
}

function createWebServer(options = {}) {
  const root = path.resolve(
    options.root ||
      process.env.WEB_ROOT ||
      path.resolve(__dirname, '../../apps/web/dist'),
  );
  const apiHost = options.apiHost || process.env.API_HOST || '127.0.0.1';
  const apiPort = Number(options.apiPort || process.env.API_PORT || 3002);

  /**
   * One cache entry per file version (path + mtime + size). Compressed variants are produced
   * lazily, once, then served from memory so repeat requests cost no CPU.
   */
  const files = new Map();
  async function loadFile(filePath, stat) {
    const key = `${stat.mtimeMs}:${stat.size}`;
    const hit = files.get(filePath);
    if (hit && hit.key === key) return hit;
    const raw = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath);
    const entry = {
      key,
      raw,
      ext,
      etag: `W/"${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24)}"`,
      csp: ext === '.html' ? buildCsp(raw.toString('utf8')) : null,
      variants: new Map(),
    };
    files.set(filePath, entry);
    return entry;
  }
  async function variant(entry, encoding) {
    let pending = entry.variants.get(encoding);
    if (!pending) {
      pending =
        encoding === 'br'
          ? brotliCompress(entry.raw, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 7,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.raw.length,
              },
            })
          : gzip(entry.raw, { level: 9 });
      entry.variants.set(encoding, pending);
    }
    return pending;
  }

  function proxyToApi(req, res, url) {
    const headers = { ...req.headers, host: `${apiHost}:${apiPort}` };
    // Record who connected to us so the API can walk the chain from the right.
    const peer = req.socket.remoteAddress || '';
    const incoming = headers['x-forwarded-for'];
    headers['x-forwarded-for'] = incoming ? `${incoming}, ${peer}` : peer;

    const upstream = http.request(
      {
        host: apiHost,
        port: apiPort,
        path: url.pathname + url.search,
        method: req.method,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    upstream.setTimeout(PROXY_TIMEOUT_MS, () =>
      upstream.destroy(new Error('upstream timeout')),
    );
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, securityHeaders(req));
        res.end();
      } else {
        res.destroy();
      }
    });
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  }

  function endWith(req, res, status, extra = {}) {
    res.writeHead(status, { ...securityHeaders(req), ...extra });
    res.end();
  }

  async function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      return endWith(req, res, 405);
    }

    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return endWith(req, res, 400);
    }
    if (decoded.includes('\0')) return endWith(req, res, 400);

    let target = path.resolve(root, '.' + decoded);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return endWith(req, res, 403);
    }

    let stat = null;
    try {
      const s = await fs.promises.stat(target);
      if (s.isFile()) stat = s;
    } catch {
      stat = null;
    }

    if (!stat) {
      // A missing asset (or anything that looks like a file) must be a real 404: answering
      // with index.html would hand the browser HTML where it expects JS/CSS.
      if (decoded.startsWith('/assets/') || path.extname(decoded) !== '') {
        return endWith(req, res, 404, { 'Cache-Control': 'no-store' });
      }
      // SPA route -> the application shell.
      target = path.join(root, 'index.html');
      try {
        stat = await fs.promises.stat(target);
      } catch {
        return endWith(req, res, 404, { 'Cache-Control': 'no-store' });
      }
    }

    const ext = path.extname(target);
    const isShell = path.basename(target) === 'index.html';
    const headers = {
      ...securityHeaders(req),
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isShell
        ? CACHE_REVALIDATE
        : decoded.startsWith('/assets/')
          ? CACHE_IMMUTABLE
          : CACHE_SHORT,
    };

    if (stat.size > MAX_CACHED_BYTES) {
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target)
        .on('error', () => res.destroy())
        .pipe(res);
      return;
    }

    const entry = await loadFile(target, stat);
    headers.ETag = entry.etag;
    if (entry.csp) headers['Content-Security-Policy'] = entry.csp;
    const compressible =
      COMPRESSIBLE.has(ext) && entry.raw.length >= MIN_COMPRESS_BYTES;
    if (compressible) headers.Vary = 'Accept-Encoding';

    if (etagMatches(req.headers['if-none-match'], entry.etag)) {
      delete headers['Content-Type'];
      res.writeHead(304, headers);
      return res.end();
    }

    let body = entry.raw;
    const encoding = compressible
      ? negotiateEncoding(req.headers['accept-encoding'])
      : null;
    if (encoding) {
      body = await variant(entry, encoding);
      headers['Content-Encoding'] = encoding;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return endWith(req, res, 400);
    }
    if (url.pathname.startsWith('/api/')) return proxyToApi(req, res, url);
    serveStatic(req, res, url).catch(() => {
      if (!res.headersSent) res.writeHead(500, securityHeaders(req));
      res.end();
    });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  return server;
}

if (require.main === module) {
  const host = process.env.WEB_HOST || '127.0.0.1';
  const port = Number(process.env.WEB_PORT || 3001);
  createWebServer().listen(port, host, () =>
    console.log(`Built MANAGEMENT LITE web on http://${host}:${port}`),
  );
}

module.exports = { createWebServer, buildCsp, negotiateEncoding };
