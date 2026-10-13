// Build and npm ci occur on hosted Windows. No script from this archive runs on the deployment runner.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const sha = process.env.RELEASE_SHA;
if (
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.versions.node !== '22.14.0'
)
  throw new Error('Pinned Windows x64 builder required');
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
  sha
)
  throw new Error('Checkout SHA mismatch');
const dest = path.resolve('release-bundle');
if (fs.existsSync(dest)) throw new Error('Bundle exists');
fs.mkdirSync(dest);
const copy = (from, to) =>
  fs.cpSync(from, path.join(dest, to), {
    recursive: true,
    filter: (source) =>
      !fs.lstatSync(source).isSymbolicLink() &&
      !source
        .split(path.sep)
        .some(
          (p) =>
            p === '.bin' ||
            p === '@management-lite' ||
            p === '.env' ||
            p.startsWith('.env.'),
        ),
  });
copy('dist', 'dist');
copy('apps/web/dist', 'web');
copy('node_modules', 'node_modules');
copy('package.json', 'package.json');
fs.writeFileSync(
  path.join(dest, 'web/release-version.json'),
  JSON.stringify({ sha }),
);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
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
const files = [];
const walk = (dir) => {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else {
      const rel = path.relative(dest, file).replaceAll('\\', '/');
      if (
        rel.startsWith('dist/') &&
        file.endsWith('.js') &&
        /from\s+['"]@management-lite\//.test(fs.readFileSync(file, 'utf8'))
      )
        throw new Error(
          'New workspace runtime import requires packaging review',
        );
      files.push({ path: rel, sha256: hash(fs.readFileSync(file)) });
    }
  }
};
walk(dest);
files.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(
  path.join(dest, 'release.json'),
  JSON.stringify(
    {
      sha,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      schemaIdentity: hash(JSON.stringify(migrations)),
      migrations,
      files,
    },
    null,
    2,
  ),
);
console.log(
  'Prepared allowlisted bundle without runtime environment or user data.',
);
