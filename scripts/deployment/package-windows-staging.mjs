// Cross-resolved prebuilt Windows dependencies. This does NOT prove Windows runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const [dependencyRoot, destination] = process.argv.slice(2);
if (!dependencyRoot || !destination)
  throw new Error(
    'Usage: node package-windows-staging.mjs WINDOWS_DEPENDENCIES EMPTY_DESTINATION',
  );
if (process.versions.node !== '22.14.0')
  throw new Error('Pinned Node 22.14.0 required');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const branch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8',
}).trim();
if (
  !branch.startsWith('codex/windows-staging-') ||
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
)
  throw new Error('Clean dedicated staging branch required');
const dest = path.resolve(destination);
if (dest.startsWith(process.cwd() + path.sep) || fs.existsSync(dest))
  throw new Error('New external output directory required');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
if (
  hash(fs.readFileSync(path.join(dependencyRoot, 'package-lock.json'))) !==
  hash(fs.readFileSync('package-lock.json'))
)
  throw new Error('Dependency lockfile mismatch');
const binaries = [];
const checkBinaries = (dir) => {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) checkBinaries(file);
    else if (file.endsWith('.node') || file.endsWith('.dll')) {
      const bytes = fs.readFileSync(file);
      const offset =
        bytes.length > 64 && bytes.toString('ascii', 0, 2) === 'MZ'
          ? bytes.readUInt32LE(60)
          : 0;
      if (
        !offset ||
        offset + 6 > bytes.length ||
        !bytes
          .subarray(offset, offset + 4)
          .equals(Buffer.from([80, 69, 0, 0])) ||
        bytes.readUInt16LE(offset + 4) !== 0x8664
      )
        throw new Error('Non-Windows-x64 native binary rejected');
      binaries.push(path.relative(dependencyRoot, file).replaceAll('\\', '/'));
    }
  }
};
checkBinaries(path.join(dependencyRoot, 'node_modules'));
if (
  !binaries.some((p) => p.includes('argon2')) ||
  !binaries.some((p) => p.includes('sharp'))
)
  throw new Error('Missing Windows Argon2/sharp binaries');
fs.mkdirSync(dest, { recursive: true });
const copy = (from, to) =>
  fs.cpSync(from, path.join(dest, to), {
    recursive: true,
    filter: (source) =>
      !fs.lstatSync(source).isSymbolicLink() &&
      !source
        .split(path.sep)
        .some(
          (p) =>
            p === '.bin' || p === '@management-lite' || p.startsWith('.env'),
        ),
  });
copy('dist/apps/api', 'dist/apps/api');
copy('dist/packages', 'dist/packages');
copy('apps/web/dist', 'web');
copy(path.join(dependencyRoot, 'node_modules'), 'node_modules');
for (const file of [
  'staging-runtime.mjs',
  'smoke-windows-native.mjs',
  'Verify-StagingBundle.ps1',
])
  copy('scripts/deployment/' + file, 'scripts/deployment/' + file);
fs.writeFileSync(
  path.join(dest, 'package.json'),
  JSON.stringify({
    name: 'management-lite-staging-runtime',
    private: true,
    type: 'module',
  }),
);
fs.writeFileSync(
  path.join(dest, 'web/release-version.json'),
  JSON.stringify({ sha }),
);
const files = [];
const walk = (dir) => {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else
      files.push({
        path: path.relative(dest, file).replaceAll('\\', '/'),
        sha256: hash(fs.readFileSync(file)),
        bytes: fs.statSync(file).size,
      });
  }
};
walk(dest);
files.sort((a, b) => a.path.localeCompare(b.path));
const migrations = fs
  .readdirSync('packages/database/src/migrations')
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => ({
    id: n.slice(0, -4),
    checksum: hash(
      fs
        .readFileSync('packages/database/src/migrations/' + n, 'utf8')
        .replace(/\r\n/g, '\n')
        .trim(),
    ),
  }));
const manifest = {
  repository: 'truhoaiphuong03/management-lite',
  branch,
  sha,
  applicationBaseline: 'e2bedec14714709cf5db2a0c0782f4bb9c3cb941',
  designBaseline: '89d18fcb1721f012cfc4d28e6372e4e383e664e6',
  purpose: 'WINDOWS_STAGING_DIAGNOSTIC_CANDIDATE',
  productionApproved: false,
  builder: {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    npm: '10.9.2',
    ciRunId: null,
    artifactId: null,
    method:
      'local compiled JS/static Web + npm cross-resolved prebuilt Windows native packages',
  },
  target: {
    platform: 'win32',
    arch: 'x64',
    node: '22.14.0',
    windowsRuntimeVerified: false,
  },
  buildCommands: [
    'npm ci',
    'npm run typecheck',
    'npm run lint (FAIL: 4 existing frontend errors)',
    'npm run build',
    'npm run build:web',
    'npm ci --omit=dev --ignore-scripts --os=win32 --cpu=x64 --no-audit --no-fund (separate dependency directory)',
  ],
  lockfileSha256: hash(fs.readFileSync('package-lock.json')),
  nativeBinaries: binaries,
  qa: {
    status: 'QA_HOLD',
    release: 'RELEASE_HOLD',
    focusedCurrentRun: { pass: 26, fail: 0, skip: 0, databaseConnections: 0 },
    historicalRegression: { pass: 686, fail: 0, skip: 1, rerun: false },
    open: [
      'ACC background expiry P1',
      '4 SettingsScreen lint errors',
      'FIN fake-DOM flaky',
      'legacy ISSUES SKIP',
      'credential rotation approval pending',
      'Windows runtime + staging E2E not tested',
    ],
  },
  migrations,
  migrationsIncludedOrExecuted: false,
  files,
};
fs.writeFileSync(
  path.join(dest, 'staging-manifest.json'),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    sha,
    files: files.length,
    nativeBinaries: binaries.length,
    target: manifest.target,
    ciRunId: null,
  }),
);
