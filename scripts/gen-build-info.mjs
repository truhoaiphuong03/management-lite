/**
 * Deterministic Build & Release Metadata Generator (Phase 16 / Task 16.1)
 *
 * Reads canonical version from package.json and git commit metadata from HEAD,
 * then writes:
 *   - dist/release-version.json
 *   - apps/web/dist/release-version.json (when apps/web/dist exists)
 *
 * Pass `--sync-contracts` before compiling to synchronize `SYSTEM_VERSION` and
 * `SYSTEM_COMMIT` in `packages/contracts/src/version.ts` automatically.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function readGitMetadata() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    const committedAt = execFileSync('git', ['log', '-1', '--format=%cI'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    return {
      sha: sha || null,
      shortSha: sha ? sha.slice(0, 7).toLowerCase() : null,
      committedAt: committedAt || null,
    };
  } catch {
    return { sha: null, shortSha: null, committedAt: null };
  }
}

const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = String(pkg.version || '0.1.0').replace(/^v/i, '');
const git = readGitMetadata();
const nowIso = new Date().toISOString();

const contractsVersionPath = path.join(
  rootDir,
  'packages/contracts/src/version.ts',
);

if (process.argv.includes('--sync-contracts') && fs.existsSync(contractsVersionPath)) {
  let content = fs.readFileSync(contractsVersionPath, 'utf8');
  content = content.replace(
    /export const SYSTEM_VERSION = '[^']+';/,
    `export const SYSTEM_VERSION = '${version}';`,
  );
  if (git.shortSha) {
    content = content.replace(
      /export const SYSTEM_COMMIT = '[^']+';/,
      `export const SYSTEM_COMMIT = '${git.shortSha}';`,
    );
  }
  fs.writeFileSync(contractsVersionPath, content, 'utf8');
}

let fallbackCommit = '0000000';
if (fs.existsSync(contractsVersionPath)) {
  const m = fs
    .readFileSync(contractsVersionPath, 'utf8')
    .match(/export const SYSTEM_COMMIT = '([^']+)';/);
  if (m && m[1]) fallbackCommit = m[1];
}

const sha = git.sha || fallbackCommit;
const shortSha = git.shortSha || sha.slice(0, 7).toLowerCase();
const releasedAt = git.committedAt || nowIso;
const environment =
  process.env.NODE_ENV === 'production' ? 'production' : 'staging';

const payload = {
  name: 'Management Lite',
  version,
  sha,
  shortSha,
  releasedAt,
  builtAt: nowIso,
  environment,
};

const distDir = path.join(rootDir, 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, 'release-version.json'),
  `${JSON.stringify(payload, null, 2)}\n`,
  'utf8',
);

const webDistDir = path.join(rootDir, 'apps/web/dist');
if (fs.existsSync(webDistDir)) {
  fs.writeFileSync(
    path.join(webDistDir, 'release-version.json'),
    `${JSON.stringify({ ...payload, component: 'web' }, null, 2)}\n`,
    'utf8',
  );
}

console.log(
  `[BUILD-INFO] v${version} (${shortSha}) -> dist/release-version.json${fs.existsSync(webDistDir) ? ' + apps/web/dist/release-version.json' : ''}`,
);
