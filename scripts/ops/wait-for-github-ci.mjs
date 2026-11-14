#!/usr/bin/env node
/**
 * Read-only helper that waits for the GitHub Actions workflow run on `main`
 * for a target commit SHA (defaults to local HEAD) to complete with `success`
 * before running `Invoke-OwnerReleaseToWeb.ps1`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function resolveCommitSha() {
  const argSha = process.argv[2]?.trim();
  if (argSha && /^[0-9a-f]{40}$/i.test(argSha)) return argSha.toLowerCase();
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .toLowerCase();
}

function resolveGitHubToken() {
  if (process.env.GITHUB_READONLY_TOKEN?.trim()) {
    return process.env.GITHUB_READONLY_TOKEN.trim();
  }
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      cwd: repoRoot,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const match = out.match(/^password=(.+)$/m);
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const sha = resolveCommitSha();
  const token = resolveGitHubToken();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ManagementLite-CIWaitHelper',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const maxWaitMs = 12 * 60 * 1000;
  const startedAt = Date.now();
  process.stdout.write(
    `[CI-WAIT] Đang chờ GitHub Actions hoàn tất cho commit ${sha.slice(0, 7)} (${sha})...\n`,
  );

  while (Date.now() - startedAt < maxWaitMs) {
    const url = `https://api.github.com/repos/truhoaiphuong03/management-lite/actions/runs?head_sha=${sha}&per_page=10`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(
        `GitHub API trả mã ${res.status} khi kiểm tra CI cho ${sha}`,
      );
    }
    const json = await res.json();
    const runs = Array.isArray(json.workflow_runs)
      ? json.workflow_runs.filter(
          (r) =>
            (r.path === '.github/workflows/foundation.yml' ||
              r.path === '.github/workflows/deploy.yml') &&
            r.head_branch === 'main',
        )
      : [];

    const latest = runs[0];
    if (!latest) {
      process.stdout.write(
        '  • Chưa thấy workflow run trên main, chờ thêm 10 giây...\n',
      );
      await sleep(10_000);
      continue;
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(
      `  • [${elapsedSec}s] Run #${latest.id}: status='${latest.status}', conclusion='${latest.conclusion ?? ''}'\n`,
    );

    if (latest.status === 'completed') {
      if (latest.conclusion === 'success') {
        process.stdout.write(
          `[CI-WAIT] PASS: GitHub Actions run #${latest.id} đã thành công! Sẵn sàng chạy cổng phát hành Owner.\n`,
        );
        return;
      }
      process.stderr.write(
        `[CI-WAIT] FAIL: GitHub Actions run #${latest.id} kết thúc với trạng thái '${latest.conclusion}'. Dừng phát hành.\n`,
      );
      process.exit(1);
    }

    await sleep(15_000);
  }

  process.stderr.write(
    '[CI-WAIT] Quá thời gian chờ 12 phút mà GitHub Actions chưa hoàn tất.\n',
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `[CI-WAIT] Lỗi: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
