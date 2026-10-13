import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('UI-FIX-45 — Finding 1: ReportsScreen stale JSON guard after await res.json() & sequence check in catch/finally', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/ReportsScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. fetchMyReports sequence guard after await res.json()
  const fetchMyReportsBlock = source.slice(
    source.indexOf('const fetchMyReports = async'),
    source.indexOf('const fetchEmployees = async'),
  );
  assert.ok(
    fetchMyReportsBlock.includes('const data = await res.json();\n        if (currentSeq !== myReportsSeqRef.current) return;'),
    'fetchMyReports must check currentSeq !== myReportsSeqRef.current immediately after await res.json()',
  );
  assert.ok(
    fetchMyReportsBlock.includes('catch {\n      if (currentSeq !== myReportsSeqRef.current) return;'),
    'fetchMyReports must guard catch block against stale sequences',
  );
  assert.ok(
    fetchMyReportsBlock.includes('if (currentSeq === myReportsSeqRef.current) {\n        setLoadingMoreMyReports(false);'),
    'fetchMyReports must guard finally loading state against stale sequences',
  );

  // 2. fetchAllReports sequence guard after await res.json()
  const fetchAllReportsBlock = source.slice(
    source.indexOf('const fetchAllReports = async'),
    source.indexOf('// Re-fetch when Owner filters change'),
  );
  assert.ok(
    fetchAllReportsBlock.includes('const data = await res.json();\n        if (currentSeq !== allReportsSeqRef.current) return;'),
    'fetchAllReports must check currentSeq !== allReportsSeqRef.current immediately after await res.json()',
  );
  assert.ok(
    fetchAllReportsBlock.includes('catch {\n      if (currentSeq !== allReportsSeqRef.current) return;'),
    'fetchAllReports must guard catch block against stale sequences',
  );
  assert.ok(
    fetchAllReportsBlock.includes('if (currentSeq === allReportsSeqRef.current) {\n        setLoadingMoreAllReports(false);'),
    'fetchAllReports must guard finally loading state against stale sequences',
  );
});

test('UI-FIX-45 — Finding 2: LoginScreen timing-safe focusTarget mechanism on authentication and network errors', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. focusTarget state and useEffect
  assert.ok(
    source.includes("const [focusTarget, setFocusTarget] = useState<'identifier' | 'password' | null>(null);"),
    'Must declare focusTarget state to coordinate post-render focus',
  );
  assert.ok(
    source.includes('useEffect(() => {\n    if (!isLoading && focusTarget) {'),
    'Must use useEffect watching [isLoading, focusTarget] so focus only fires after inputs are enabled',
  );
  assert.ok(
    source.includes('passwordInputRef.current?.focus()'),
    'Must focus password input after DOM render and enable',
  );

  // 2. Auth error branch (401/429/API failure) triggers focusTarget
  const onAuthFailureBlock = source.slice(
    source.indexOf('if (!res.ok || !body?.success)'),
    source.indexOf('if (res.status === 401)'),
  );
  assert.ok(
    onAuthFailureBlock.includes("setFocusTarget('password');"),
    'Must setFocusTarget("password") on authentication error',
  );
  assert.ok(
    onAuthFailureBlock.includes("setPassword('');"),
    'Must clear password on authentication error',
  );

  // 3. Network failure branch triggers focusTarget
  const onNetworkErrorBlock = source.slice(
    source.indexOf('} catch {'),
    source.indexOf('} finally {'),
  );
  assert.ok(
    onNetworkErrorBlock.includes("setFocusTarget('password');"),
    'Must setFocusTarget("password") on network failure',
  );
  assert.ok(
    onNetworkErrorBlock.includes("setPassword('');"),
    'Must clear password on network failure',
  );
});

test('UI-FIX-45 — Finding 3: EmployeesScreen pagination error boundary retains existing page items on failure', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/EmployeesScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. paginationError state declared
  assert.ok(
    source.includes('const [paginationError, setPaginationError] = useState<string | null>(null);'),
    'Must declare paginationError state',
  );

  // 2. fetchEmployees distinguishes fresh vs append errors
  const fetchEmployeesBlock = source.slice(
    source.indexOf('const fetchEmployees = async'),
    source.indexOf('useEffect(() => {\n    fetchEmployees();'),
  );
  assert.ok(
    fetchEmployeesBlock.includes('if (append) {\n        setPaginationError(msg);\n      } else {\n        setError(msg);\n      }'),
    'Must only set paginationError on append, keeping existing employees intact',
  );

  // 3. UI renders paginationError banner with role="alert"
  assert.ok(
    source.includes('{paginationError && ('),
    'Must render inline paginationError container',
  );
  assert.ok(
    source.includes('role="alert"'),
    'Error banner must have role="alert" for accessibility',
  );
});

test('UI-FIX-45 — Finding 4: Headless Chrome mounted live browser suite (CDP execution)', () => {
  // Execute live Chrome CDP test suite
  const scriptPath = resolve(root, 'scripts/test-ui-fix-45-chrome.mjs');
  const output = execFileSync('node', [scriptPath], { encoding: 'utf8', cwd: root });

  assert.ok(
    output.includes('LoginScreen Focus Verification: ALL 3 SUB-TESTS PASS'),
    'Chrome test: LoginScreen 401, 429, network error focus must pass',
  );
  assert.ok(
    output.includes('EmployeesScreen Mounted Runtime Verification: ALL 6 CHECKS PASS'),
    'Chrome test: EmployeesScreen deduplication, reset, stale guard, error retry must pass',
  );
  assert.ok(
    output.includes('ReportsScreen Stale JSON Guard Verification: PASS'),
    'Chrome test: ReportsScreen stale JSON guard must pass',
  );
  assert.ok(
    output.includes('ALL MOUNTED COMPONENT TESTS PASSED PERFECTLY'),
    'Complete live Chrome test suite must exit code 0',
  );
});
