import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('shared design tokens match canonical doc 44 specifications', async () => {
  const { TOKENS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/tokens.js')}`
  );

  assert.equal(TOKENS.colors.background, '#0B1220');
  assert.equal(TOKENS.colors.surface, '#151F30');
  assert.equal(TOKENS.colors.primary, '#14B8A6');
  assert.equal(TOKENS.colors.text, '#F8FAFC');
  assert.equal(TOKENS.colors.muted, '#94A3B8');
  assert.equal(TOKENS.colors.border, '#334155');
  assert.equal(TOKENS.colors.error, '#EF4444');
  assert.equal(TOKENS.colors.warning, '#F59E0B');

  assert.equal(TOKENS.spacing[1], '4px');
  assert.equal(TOKENS.spacing[2], '8px');
  assert.equal(TOKENS.spacing[3], '12px');
  assert.equal(TOKENS.spacing[4], '16px');
  assert.equal(TOKENS.spacing[6], '24px');

  assert.equal(TOKENS.radii.sm, '8px');
  assert.equal(TOKENS.radii.md, '12px');
  assert.equal(TOKENS.radii.lg, '16px');

  assert.equal(TOKENS.touchTarget.minHeight, '44px');
});

test('route registry defines canonical V0.1 screens with RBAC guards', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );

  // Initial implemented demo screens
  assert.equal(ROUTE_REGISTRY['/login']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/clock']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/reports']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/settings']?.implemented, true);

  // Unimplemented screens marked as not implemented
  assert.equal(ROUTE_REGISTRY['/activate']?.implemented, false);
  assert.equal(ROUTE_REGISTRY['/attendance']?.implemented, false);
  assert.equal(ROUTE_REGISTRY['/attendance/corrections']?.implemented, false);
  assert.equal(ROUTE_REGISTRY['/payroll']?.implemented, false);

  // Owner only route guards per RBAC-02
  assert.equal(ROUTE_REGISTRY['/attendance/review']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/employees']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/payroll']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/accounts']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/audit']?.ownerOnly, true);
});

test('production bundle builds successfully into apps/web/dist', () => {
  const indexHtmlPath = resolve(root, 'apps/web/dist/index.html');
  assert.equal(existsSync(indexHtmlPath), true);
  const content = readFileSync(indexHtmlPath, 'utf8');
  assert.match(content, /Management Lite V0\.1/);
});
