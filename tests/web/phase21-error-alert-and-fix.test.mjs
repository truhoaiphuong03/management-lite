import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('PHASE21-T1: app.ts & SystemLogService expose /api/v1/system/version, log dismissal, and 1-click AI Fix escalation', () => {
  const appSrc = read('apps/api/src/app.ts');
  assert.ok(
    appSrc.includes("pathname === '/api/v1/system/version'"),
    'app.ts must expose GET /api/v1/system/version alias to prevent 404 warnings',
  );
  assert.ok(
    appSrc.includes("method === 'DELETE' && pathname === '/api/v1/system/logs'") &&
      appSrc.includes("method === 'POST' && pathname === '/api/v1/system/logs/escalate'"),
    'app.ts must register DELETE /api/v1/system/logs and POST /api/v1/system/logs/escalate',
  );

  const sysLogSrc = read('apps/api/src/system-log/service.ts');
  assert.ok(
    sysLogSrc.includes('buildAiFixPrompt(') &&
      sysLogSrc.includes('async dismiss(') &&
      sysLogSrc.includes('async escalate(') &&
      sysLogSrc.includes("metadata_context->>'log_fingerprint'"),
    'SystemLogService must implement buildAiFixPrompt, dismiss, and deduplicated escalate',
  );
});

test('PHASE21-T2: SystemLogsScreen renders 1-click AI Fix, dismiss group, clear resolved logs, and theme-aware colors', () => {
  const src = read('apps/web/src/screens/SystemLogsScreen.tsx');
  assert.ok(
    src.includes('data-testid="btn-escalate-error"') &&
      src.includes('🔧 Yêu cầu AI sửa'),
    'SystemLogsScreen must render 1-click AI Fix escalation button on top error rows',
  );
  assert.ok(
    src.includes('data-testid="btn-dismiss-error"') &&
      src.includes('data-testid="btn-clear-resolved-logs"'),
    'SystemLogsScreen must render group dismiss and clear resolved logs buttons',
  );
  assert.ok(
    !src.includes('#cbd5e1') &&
      !src.includes('#e2e8f0') &&
      !src.includes('#f1f5f9'),
    'SystemLogsScreen must use theme-aware variables instead of hardcoded light borders',
  );
});

test('PHASE21-T3: DashboardScreen surfaces proactive system error alert in Action Center for Owner only', () => {
  const src = read('apps/web/src/screens/DashboardScreen.tsx');
  assert.ok(
    src.includes("fetch('/api/v1/system/logs/summary?hours=24'") &&
      src.includes('if (role !== \'owner\') return;') &&
      src.includes('data-testid="action-center-system-errors"'),
    'DashboardScreen must poll 24h system log summary for Owner and render action-center-system-errors alert',
  );
});

test('PHASE21-T4: IssuesScreen and IssuesService support 1-click Bulk Confirm for awaiting_owner issues', () => {
  const routesSrc = read('apps/api/src/routes/issues-routes.ts');
  const serviceSrc = read('apps/api/src/issues/service.ts');
  const screenSrc = read('apps/web/src/screens/IssuesScreen.tsx');

  assert.ok(
    routesSrc.includes("issueId === 'bulk-confirm'") &&
      serviceSrc.includes('async bulkConfirmFixes('),
    'Backend must expose POST /api/v1/issues/bulk-confirm and IssuesService.bulkConfirmFixes',
  );
  assert.ok(
    screenSrc.includes('data-testid="btn-bulk-confirm-issues"') &&
      screenSrc.includes("fetch('/api/v1/issues/bulk-confirm'"),
    'IssuesScreen must expose bulk confirm button for awaiting_owner issues',
  );
});

test('PHASE21-T5: SystemLogService.escalate has valid SQL quotes & migration 0031 matches catalog parity', () => {
  const sysLogSrc = read('apps/api/src/system-log/service.ts');
  assert.ok(
    !sysLogSrc.includes("bug_code ~ '^BUG-[0-9]+`"),
    'SystemLogService.escalate must never contain unterminated SQL string literal',
  );
  assert.ok(
    sysLogSrc.includes('RETURNING id, bug_code') &&
      sysLogSrc.includes("bug_code: 'BUG-LOG'"),
    'SystemLogService.escalate must rely on DB default bug_code with safe fallback',
  );

  const sql0031 = read(
    'packages/database/src/migrations/0031_accounts_ecosystem_hierarchy.sql',
  )
    .replace(/\r\n/g, '\n')
    .trim();
  const catalogSrc = read('packages/database/src/migrations/catalog.ts').replace(
    /\r\n/g,
    '\n',
  );
  assert.ok(
    catalogSrc.includes(sql0031),
    '0031_accounts_ecosystem_hierarchy.sql must match catalog.ts byte-for-byte',
  );
});
