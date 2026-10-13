import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(
  resolve(root, 'apps/web/src/screens/WorkScreen.tsx'),
  'utf8',
);

test('WorkScreen list uses ActionIconButton (view) with accessible label', () => {
  assert.match(src, /<ActionIconButton[\s\S]*?action="view"/);
  assert.match(src, /testId=\{`work-view-\$\{item\.id\}`\}/);
});

test('WorkScreen list is client-side paginated (default 20, shared Pagination)', () => {
  assert.match(src, /useState\(20\)/);
  assert.match(src, /<Pagination[\s\S]*?testId="work-pager"/);
  assert.match(src, /pagedItems\.map\(/);
});

test('ActionIconButton view exposes Vietnamese title + aria-label', async () => {
  const { ACTION_ICON_LABELS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/ActionIconButton.js')}`
  );
  assert.equal(ACTION_ICON_LABELS.view, 'Xem chi tiết');
});

test('WorkScreen search, filters, and empty search state are wired', () => {
  assert.match(src, /data-testid="work-search-input"/);
  assert.match(src, /data-testid="work-status-filter"/);
  assert.match(src, /data-testid="work-priority-filter"/);
  assert.match(src, /data-testid="work-assignee-filter"/);
  assert.match(src, /data-testid="work-empty-search"/);
  assert.match(src, /<ErrorState message=\{errorMessage\}/);
});

