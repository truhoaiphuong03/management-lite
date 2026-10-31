import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

test('Phase 16.1: gen-build-info.mjs generates consistent dist/release-version.json and apps/web/dist/release-version.json', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  const apiRelPath = path.join(root, 'dist/release-version.json');
  const webRelPath = path.join(root, 'apps/web/dist/release-version.json');

  assert.equal(
    fs.existsSync(apiRelPath),
    true,
    'dist/release-version.json must exist',
  );
  assert.equal(
    fs.existsSync(webRelPath),
    true,
    'apps/web/dist/release-version.json must exist',
  );

  const apiRel = JSON.parse(fs.readFileSync(apiRelPath, 'utf8'));
  const webRel = JSON.parse(fs.readFileSync(webRelPath, 'utf8'));

  assert.equal(apiRel.version, pkg.version);
  assert.equal(webRel.version, pkg.version);
  assert.match(apiRel.shortSha, /^[0-9a-f]{7}$/i);
  assert.equal(apiRel.shortSha, webRel.shortSha);
  assert.ok(apiRel.releasedAt);
  assert.ok(apiRel.builtAt);
});

test('Phase 16.2: Owner-locked release runbook and runtime server packaging exist', () => {
  const runbookPath = path.join(
    root,
    'docs/deployment/OWNER-RELEASE-RUNBOOK.md',
  );
  assert.equal(fs.existsSync(runbookPath), true);
  const runbook = fs.readFileSync(runbookPath, 'utf8');
  assert.ok(runbook.includes('Sign-Release-Owner.ps1'));
  assert.ok(runbook.includes('Deploy-SemiAutoWindows.ps1'));
  assert.ok(runbook.includes('scripts/runtime/serve-web.cjs'));

  const packager = fs.readFileSync(
    path.join(root, 'scripts/deployment/package-release-bundle.mjs'),
    'utf8',
  );
  assert.ok(packager.includes("copyFiltered(\n      'scripts/runtime'"));
});

test('Phase 16.3: .gitattributes and .prettierrc.json normalize line endings across OS checkouts', () => {
  const gitattributes = fs.readFileSync(
    path.join(root, '.gitattributes'),
    'utf8',
  );
  assert.ok(gitattributes.includes('* text=auto eol=lf'));
  assert.ok(gitattributes.includes('docs/canonical/** -text'));

  const prettierrc = JSON.parse(
    fs.readFileSync(path.join(root, '.prettierrc.json'), 'utf8'),
  );
  assert.equal(prettierrc.endOfLine, 'auto');
});
