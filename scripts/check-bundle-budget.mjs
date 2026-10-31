#!/usr/bin/env node
/**
 * Bundle budget gate for the web app.
 *
 * Measures what the browser must download before the first screen can render (the entry
 * script, its modulepreload'ed static imports and the stylesheet) and fails when it grows
 * past the budget. Lazily loaded screen chunks are only checked against a per-chunk ceiling.
 *
 * usage: node scripts/check-bundle-budget.mjs [distDir]
 * env:   BUNDLE_BUDGET_INITIAL_RAW_KB, BUNDLE_BUDGET_INITIAL_GZIP_KB, BUNDLE_BUDGET_CHUNK_RAW_KB
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const KB = 1024;

export const DEFAULT_BUDGET = {
  // Measured after route-level code splitting: ~416 KB raw / ~118 KB gzip. Headroom is small
  // on purpose, so growth of the shell is a conscious decision rather than an accident.
  initialRawKb: 450,
  initialGzipKb: 130,
  chunkRawKb: 300,
};

function budgetFromEnv(env = process.env) {
  const num = (name, fallback) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    initialRawKb: num(
      'BUNDLE_BUDGET_INITIAL_RAW_KB',
      DEFAULT_BUDGET.initialRawKb,
    ),
    initialGzipKb: num(
      'BUNDLE_BUDGET_INITIAL_GZIP_KB',
      DEFAULT_BUDGET.initialGzipKb,
    ),
    chunkRawKb: num('BUNDLE_BUDGET_CHUNK_RAW_KB', DEFAULT_BUDGET.chunkRawKb),
  };
}

/** Assets referenced directly by index.html: they block (or immediately follow) first paint. */
export function initialAssets(indexHtml) {
  const refs = new Set();
  const tag = /<(script|link)\b[^>]*>/gi;
  let m;
  while ((m = tag.exec(indexHtml)) !== null) {
    const el = m[0];
    const isScript =
      /^<script/i.test(el) && /\btype\s*=\s*["']module["']/i.test(el);
    const isPreload = /\brel\s*=\s*["']modulepreload["']/i.test(el);
    const isStyle = /\brel\s*=\s*["']stylesheet["']/i.test(el);
    if (!isScript && !isPreload && !isStyle) continue;
    const ref = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(el)?.[1];
    if (ref && ref.startsWith('/')) refs.add(ref.replace(/^\//, ''));
  }
  return [...refs];
}

export function measure(distDir, budget = budgetFromEnv()) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `index.html not found in ${distDir} (run npm run build:web first)`,
    );
  }
  const initial = initialAssets(fs.readFileSync(indexPath, 'utf8')).map(
    (rel) => {
      const buf = fs.readFileSync(path.join(distDir, rel));
      return {
        rel,
        raw: buf.length,
        gzip: zlib.gzipSync(buf, { level: 9 }).length,
      };
    },
  );
  const initialJs = initial.filter((a) => a.rel.endsWith('.js'));
  const totals = {
    raw: initialJs.reduce((n, a) => n + a.raw, 0),
    gzip: initialJs.reduce((n, a) => n + a.gzip, 0),
  };

  const assetsDir = path.join(distDir, 'assets');
  const chunks = fs.existsSync(assetsDir)
    ? fs
        .readdirSync(assetsDir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => ({
          rel: `assets/${f}`,
          raw: fs.statSync(path.join(assetsDir, f)).size,
        }))
    : [];

  const problems = [];
  if (totals.raw > budget.initialRawKb * KB) {
    problems.push(
      `initial JS ${(totals.raw / KB).toFixed(1)} KB raw exceeds ${budget.initialRawKb} KB`,
    );
  }
  if (totals.gzip > budget.initialGzipKb * KB) {
    problems.push(
      `initial JS ${(totals.gzip / KB).toFixed(1)} KB gzip exceeds ${budget.initialGzipKb} KB`,
    );
  }
  for (const chunk of chunks) {
    if (chunk.raw > budget.chunkRawKb * KB) {
      problems.push(
        `${chunk.rel} is ${(chunk.raw / KB).toFixed(1)} KB raw, over the ${budget.chunkRawKb} KB per-chunk ceiling`,
      );
    }
  }
  return { initial, initialJs, totals, chunks, problems, budget };
}

function main() {
  const distDir = path.resolve(process.argv[2] || 'apps/web/dist');
  const result = measure(distDir);
  const kb = (n) => (n / KB).toFixed(1).padStart(7);
  console.log(`Initial load (${result.initial.length} assets):`);
  for (const a of result.initial) {
    console.log(`  ${kb(a.raw)} KB raw ${kb(a.gzip)} KB gzip  ${a.rel}`);
  }
  console.log(
    `Initial JS total: ${(result.totals.raw / KB).toFixed(1)} KB raw / ${(result.totals.gzip / KB).toFixed(1)} KB gzip ` +
      `(budget ${result.budget.initialRawKb} / ${result.budget.initialGzipKb} KB)`,
  );
  console.log(
    `Async chunks: ${result.chunks.length - result.initialJs.length}`,
  );
  if (result.problems.length > 0) {
    for (const p of result.problems) console.error(`BUDGET EXCEEDED: ${p}`);
    process.exit(1);
  }
  console.log('Bundle budget OK');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
