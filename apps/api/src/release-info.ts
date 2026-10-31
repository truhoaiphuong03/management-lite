import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  SYSTEM_VERSION,
  SYSTEM_COMMIT,
  SYSTEM_ENV,
  RELEASE_NOTES_CATALOG,
} from '../../../packages/contracts/src/version.js';

export interface RuntimeReleaseState {
  version: string;
  commit: string;
  sha: string;
  releasedAt: string | null;
  environment: string;
  productionStatus: string;
}

export interface GitFallback {
  sha: string | null;
  date: string | null;
}

type Exec = (args: string[]) => string;

const defaultExec: Exec = (args) =>
  execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1500,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/**
 * Reads `git rev-parse HEAD` / last commit date at most once. The checkout does not change
 * under a running process, and spawning git blocks the event loop, so it must never be
 * repeated per request (the health endpoint is public).
 */
export function createGitFallbackReader(
  exec: Exec = defaultExec,
): () => GitFallback {
  let cached: GitFallback | undefined;
  return () => {
    if (cached) return cached;
    cached = { sha: null, date: null };
    try {
      cached.sha = exec(['rev-parse', 'HEAD']) || null;
      if (cached.sha) cached.date = exec(['log', '-1', '--format=%cI']) || null;
    } catch {
      // Keep the SYSTEM_COMMIT fallback.
    }
    return cached;
  };
}

const sharedGitReader = createGitFallbackReader();

/**
 * Resolves what is actually running (version, commit, release time) from the release record
 * written at deploy time, falling back to package.json and, last, git.
 */
export function resolveReleaseState(
  isProduction: boolean,
  deps: { readGit: () => GitFallback } = { readGit: sharedGitReader },
): RuntimeReleaseState {
  let runtimeVersion = '0.1.0';
  let runtimeSha = SYSTEM_COMMIT;
  let runtimeReleasedAt: string | null = null;
  let runtimeEnv = isProduction ? 'production' : SYSTEM_ENV;

  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        version?: string;
      };
      if (pkg.version) {
        runtimeVersion = String(pkg.version).replace(/^v/i, '');
      }
    }
  } catch {
    // Ignore fallback read errors
  }

  const releaseVerCandidates = [
    path.resolve(process.cwd(), 'dist/release-version.json'),
    path.resolve(process.cwd(), 'apps/web/dist/release-version.json'),
  ];
  for (const candidate of releaseVerCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        const rel = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          version?: string;
          sha?: string;
          shortSha?: string;
          releasedAt?: string;
          builtAt?: string;
          environment?: string;
        };
        if (rel.version) {
          runtimeVersion = String(rel.version).replace(/^v/i, '');
        }
        if (rel.sha) {
          runtimeSha = String(rel.sha).trim();
        } else if (rel.shortSha) {
          runtimeSha = String(rel.shortSha).trim();
        }
        if (rel.releasedAt || rel.builtAt) {
          runtimeReleasedAt = String(rel.releasedAt || rel.builtAt);
        }
        if (rel.environment) {
          runtimeEnv = String(rel.environment);
        }
        break;
      }
    } catch {
      // Try next candidate
    }
  }

  const explicitReportsDir = process.env['SERVER_REPORTS_DIR'];
  const reportsDir = explicitReportsDir || 'C:\\HoaiPhuong-Server\\reports';
  let rcVerifiedAt: string | null = null;
  try {
    const runningCompPath = path.join(
      reportsDir,
      'running-components-sha.json',
    );
    if (fs.existsSync(runningCompPath)) {
      const rc = JSON.parse(fs.readFileSync(runningCompPath, 'utf8')) as {
        sha?: string;
        verified_at_utc?: string;
      };
      if (rc.sha) {
        const rcShaTrimmed = String(rc.sha).trim();
        if (
          explicitReportsDir ||
          runtimeSha === SYSTEM_COMMIT ||
          rcShaTrimmed.slice(0, 7).toLowerCase() ===
            runtimeSha.slice(0, 7).toLowerCase()
        ) {
          runtimeSha = rcShaTrimmed;
          if (rc.verified_at_utc) {
            rcVerifiedAt = String(rc.verified_at_utc);
            runtimeReleasedAt = rcVerifiedAt;
          }
        }
      }
    } else if (explicitReportsDir) {
      const liveShaPath = path.join(reportsDir, 'current-live-sha.txt');
      if (fs.existsSync(liveShaPath)) {
        const liveSha = fs.readFileSync(liveShaPath, 'utf8').trim();
        if (liveSha) runtimeSha = liveSha;
      }
    }
  } catch {
    // Ignore optional server report read errors
  }

  if (runtimeSha === SYSTEM_COMMIT) {
    // No release record on disk (dev/sandbox): fall back to the checkout's own git state.
    // Read once per process; never spawn git on the request path.
    const git = deps.readGit();
    if (git.sha) runtimeSha = git.sha;
    if (!runtimeReleasedAt && git.date) runtimeReleasedAt = git.date;
  }

  const shortCommit = runtimeSha.slice(0, 7).toLowerCase();
  const matchedHistorical = RELEASE_NOTES_CATALOG.find(
    (item) =>
      item.commit !== 'latest' &&
      item.commit.slice(0, 7).toLowerCase() === shortCommit,
  );
  if (matchedHistorical) {
    runtimeVersion = matchedHistorical.version.replace(/^v/i, '');
    if (!rcVerifiedAt) {
      runtimeReleasedAt = matchedHistorical.released_at;
    }
  }

  const isProdActive =
    isProduction || runtimeEnv.toLowerCase() === 'production';

  return {
    version: runtimeVersion || SYSTEM_VERSION.replace(/^v/i, ''),
    commit: shortCommit,
    sha: runtimeSha,
    releasedAt: runtimeReleasedAt,
    environment: isProdActive ? 'production' : runtimeEnv,
    productionStatus: isProdActive
      ? 'Production — Đang hoạt động'
      : 'Staging / Dev — Đang hoạt động',
  };
}
