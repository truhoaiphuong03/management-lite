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

const PROXY_TIMEOUT_MS = 60_000;

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

function createWebServer(options = {}) {
  const root = path.resolve(
    options.root ||
      process.env.WEB_ROOT ||
      path.resolve(__dirname, '../../apps/web/dist'),
  );
  const apiHost = options.apiHost || process.env.API_HOST || '127.0.0.1';
  const apiPort = Number(options.apiPort || process.env.API_PORT || 3002);

  let cspCache = { mtimeMs: -1, value: "default-src 'self'" };
  async function currentCsp() {
    const indexPath = path.join(root, 'index.html');
    try {
      const stat = await fs.promises.stat(indexPath);
      if (stat.mtimeMs !== cspCache.mtimeMs) {
        const html = await fs.promises.readFile(indexPath, 'utf8');
        cspCache = { mtimeMs: stat.mtimeMs, value: buildCsp(html) };
      }
    } catch {
      // Keep the last known policy (or the restrictive default).
    }
    return cspCache.value;
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

  async function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, securityHeaders(req));
      return res.end();
    }

    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, securityHeaders(req));
      return res.end();
    }
    if (decoded.includes('\0')) {
      res.writeHead(400, securityHeaders(req));
      return res.end();
    }

    let target = path.resolve(root, '.' + decoded);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403, securityHeaders(req));
      return res.end();
    }

    let isFile = false;
    try {
      isFile = (await fs.promises.stat(target)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) target = path.join(root, 'index.html');

    const headers = {
      ...securityHeaders(req),
      'Cache-Control': 'no-store',
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
    };
    if (path.basename(target) === 'index.html') {
      headers['Content-Security-Policy'] = await currentCsp();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, securityHeaders(req));
      return res.end();
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

module.exports = { createWebServer, buildCsp };
