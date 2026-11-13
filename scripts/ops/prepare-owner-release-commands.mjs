#!/usr/bin/env node
/**
 * Prints the exact, verified Owner-Locked Release Gate commands for the current
 * branch/commit without touching Production or C:\HoaiPhuong-Server\.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const sha = git(['rev-parse', 'HEAD']);
const shortSha = sha.slice(0, 7);

const lines = [
  '======================================================================',
  `BỘ LỆNH PHÁT HÀNH QUA CỔNG OWNER — Management Lite v${version} (${shortSha})`,
  `Nhánh hiện tại: ${branch}`,
  'LƯU Ý: Chạy bởi chính Owner trong PowerShell (Run as Administrator).',
  '======================================================================',
  '',
  '# BƯỚC 1: Hợp nhất nhánh nâng cấp vào main & gắn tag phiên bản (trên repo gốc)',
  'cd C:\\Projects\\management-lite',
  'git fetch origin',
  'git checkout main',
  'git pull --ff-only origin main',
  `git merge --no-ff origin/${branch} -m "chore(release): merge ${branch} (v${version})"`,
  `git tag v${version}`,
  `git push origin main v${version}`,
  '',
  '# BƯỚC 2: Biên dịch bản chuẩn & đóng gói Release Bundle có SHA-256 manifest',
  'npm run build',
  'npm run build:web',
  'npm run check:bundle',
  'node scripts/deployment/package-release-bundle.mjs --type=full',
  '',
  '# BƯỚC 3: Kiểm tra Preflight chỉ đọc (0 ghi đĩa Production)',
  'powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\deployment\\Invoke-OwnerReleaseToWeb.ps1 `',
  '  -CommitSha (git rev-parse HEAD) `',
  '  -DryRunPreflightOnly',
  '',
  '# BƯỚC 4: Ký duyệt Ed25519 & phát hành 1-chạm qua Owner-Locked Release Gate',
  'powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\deployment\\Invoke-OwnerReleaseToWeb.ps1 `',
  '  -CommitSha (git rev-parse HEAD)',
  '======================================================================',
];

process.stdout.write(`${lines.join('\n')}\n`);
