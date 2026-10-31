import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('UI-FIX-47 — Finding 1: EmployeesScreen pagination error uses canonical design tokens and radii', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/EmployeesScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. Must import TOKENS from canonical package tokens
  assert.ok(
    source.includes(
      "import { TOKENS, THEME_COLORS } from '../../../../packages/ui/src/tokens.js';",
    ),
    'Must import TOKENS and THEME_COLORS from canonical UI tokens',
  );

  // 2. Pagination error alert markup uses canonical tokens
  const paginationErrorBlock = source.slice(
    source.indexOf('{paginationError && ('),
    source.indexOf('{nextCursor && ('),
  );

  assert.ok(
    paginationErrorBlock.includes('borderRadius: TOKENS.radii.sm'),
    'Pagination error alert must use canonical TOKENS.radii.sm (8px), not arbitrary 6px',
  );
  assert.ok(
    paginationErrorBlock.includes(
      'backgroundColor: THEME_COLORS.dangerSubtle',
    ),
    'Pagination error alert must use canonical THEME_COLORS.dangerSubtle',
  );
  assert.ok(
    paginationErrorBlock.includes(
      'border: `1px solid ${THEME_COLORS.danger}`',
    ),
    'Pagination error alert must use canonical THEME_COLORS.danger',
  );
  assert.ok(
    paginationErrorBlock.includes('color: THEME_COLORS.danger'),
    'Pagination error text color must use canonical THEME_COLORS.danger',
  );
  assert.ok(
    paginationErrorBlock.includes('marginTop: TOKENS.spacing[4]'),
    'Pagination error margin must use canonical TOKENS.spacing[4]',
  );
  assert.ok(
    paginationErrorBlock.includes('fontSize: TOKENS.typography.fontSize.base'),
    'Pagination error fontSize must use canonical TOKENS.typography.fontSize.base',
  );
});

test('UI-FIX-47 — Finding 2: Chrome fail-closed suite (Reports Staff, Employees unmount, FIX-41, Issue retry/copy)', (t) => {
  if (!process.env.QA_WEB_BASE) {
    t.skip('Requires live QA_WEB_BASE server');
    return;
  }
  const scriptPath = resolve(root, 'scripts/test-ui-fix-47-chrome.mjs');
  const output = execFileSync('node', [scriptPath], {
    encoding: 'utf8',
    cwd: root,
  });

  assert.ok(
    output.includes('ReportsScreen Staff Stale JSON Guard Verification: PASS'),
    'Chrome test: ReportsScreen Staff delayed JSON A vs B must pass',
  );
  assert.ok(
    output.includes('EmployeesScreen Unmount Rigorous Verification: PASS'),
    'Chrome test: EmployeesScreen unmount observation with signal & console spies must pass',
  );
  assert.ok(
    output.includes('FIX-41 Regression Verification: PASS'),
    'Chrome test: FIX-41 loading width (0.000px) & accessible status must pass',
  );
  assert.ok(
    output.includes('Issue Retry & Copy Regression Verification: PASS'),
    'Chrome test: Issue retry and copy prompt regression must pass',
  );
  assert.ok(
    output.includes('ALL UI-FIX-47 TESTS PASSED WITH 100% CONFORMANCE'),
    'Complete live Chrome fail-closed test suite must exit code 0',
  );
});
