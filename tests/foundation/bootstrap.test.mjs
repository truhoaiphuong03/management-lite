import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('compiled app and package entrypoints load successfully', async () => {
  for (const path of [
    'apps/api',
    'apps/web',
    'packages/contracts',
    'packages/domain',
    'packages/database',
    'packages/security',
    'packages/ui',
    'packages/test-support',
  ]) {
    const loaded = await import(`../../dist/${path}/src/index.js`);
    assert.ok(loaded !== null && typeof loaded === 'object');
  }
});

test('canonical provenance is intact', () => {
  execFileSync(process.execPath, ['scripts/verify-canonical.mjs']);
});

test('strict TypeScript rejects an invalid assignment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'management-lite-typecheck-'));
  try {
    const path = join(dir, 'invalid.ts');
    writeFileSync(path, 'const value: string = 42;\n');
    const result = spawnSync(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '--strict', '--noEmit', path],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stdout, /TS2322/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('secrets and build outputs are excluded from Git', () => {
  for (const path of [
    '.env',
    'apps/api/.env.local',
    'packages/security/key.pem',
    'secrets/example',
    'dist/apps/api/src/index.js',
    'node_modules',
  ]) {
    const result = spawnSync('git', ['check-ignore', '--no-index', path]);
    assert.equal(result.status, 0, path);
  }
});
