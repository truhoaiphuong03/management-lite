import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const nav = read('packages/ui/src/components/Navigation.tsx');
const css = read('packages/ui/src/tokens.css');
const shell = read('apps/web/src/AppShell.tsx');
const notFound = read('apps/web/src/screens/NotFoundScreen.tsx');

test('UI-AUDIT-P1: tokens.css defines every custom property it consumes via alias', () => {
  for (const token of [
    '--font-sans',
    '--brand-color',
    '--surface-subtle-color',
    '--accent-text',
    '--danger-text',
    '--success-text',
    '--info-text',
  ]) {
    assert.match(css, new RegExp(`${token}:`), `${token} must be defined`);
  }
});

test('UI-AUDIT-P1: light theme overrides accent text colors for AA contrast', () => {
  const light = css.slice(
    css.indexOf(":root[data-theme='light']"),
    css.indexOf(":root[data-theme='dark']"),
  );
  assert.match(light, /--accent-text:\s*#(0f766e|0d6760)/);
  assert.match(light, /--danger-text:\s*#b91c1c/);
});

test('UI-AUDIT-P1: DesktopSidebar follows the theme (no hard-coded surface colors)', () => {
  const start = nav.indexOf('export const DesktopSidebar');
  const end = nav.indexOf('export interface MobileBottomNavProps');
  const sidebar = nav.slice(start, end);
  assert.doesNotMatch(sidebar, /#[0-9a-fA-F]{6}\b/);
  assert.match(sidebar, /var\(--surface-color\)/);
});

test('UI-AUDIT-P2: MobileBottomNav buttons expose one accessible name and no aria-hidden label', () => {
  const start = nav.indexOf('export const MobileBottomNav');
  const mobile = nav.slice(start);
  assert.match(mobile, /aria-label=\{group\.title\}/);
  assert.doesNotMatch(mobile, /mobile-nav-label-(full|short)/);
  assert.doesNotMatch(css, /mobile-nav-label-(full|short)/);
  assert.match(mobile, /fontSize: '11px'/);
  assert.match(mobile, /minHeight: '52px'/);
});

test('UI-AUDIT-P2: navigation uses dedicated icons for finance and system logs', () => {
  assert.match(nav, /path: '\/system-logs',\s+icon: 'system-logs'/);
  assert.match(nav, /path: '\/finance',\s+icon: 'finance'/);
});

test('UI-AUDIT-P2: AppShell offers a skip link to a focusable main landmark', () => {
  assert.match(shell, /href="#main-content"/);
  assert.match(shell, /id="main-content"/);
  assert.match(css, /\.skip-link:focus/);
});

test('UI-AUDIT-P2: NotFoundScreen renders a single h1 heading', () => {
  assert.match(notFound, /<h1\b/);
  assert.doesNotMatch(notFound, /<h2\b/);
});

test('UI-AUDIT-P3/4: shared components use theme-aware THEME_COLORS instead of raw TOKENS.colors hex', () => {
  for (const f of ['AppCard', 'AppButton', 'AppInput', 'AppDialog', 'AppBadge', 'AppToast', 'Pagination']) {
    const src = read(`packages/ui/src/components/${f}.tsx`);
    assert.doesNotMatch(src, /TOKENS\.colors\./, `${f} must not use TOKENS.colors`);
    assert.match(src, /THEME_COLORS/);
  }
  const tokens = read('packages/ui/src/tokens.ts');
  assert.match(tokens, /export const THEME_COLORS/);
});

test('UI-AUDIT-P4: dashboard/work/payroll screens keep no hard-coded dark surface colors', () => {
  for (const f of ['DashboardScreen', 'ClockScreen', 'WorkScreen', 'PayrollScreen', 'StorageScreen', 'SettingsScreen']) {
    const src = read(`apps/web/src/screens/${f}.tsx`);
    assert.doesNotMatch(
      src,
      /backgroundColor:\s*'#(0B1220|0F172A|151F30|1E293B)'/i,
      `${f} must use var(--surface-*) / var(--bg-color) for surfaces`,
    );
  }
});

test('UI-AUDIT-P4: responsive tables are enabled in AppShell and styled in tokens.css', () => {
  const rt = read('apps/web/src/responsive-tables.ts');
  assert.match(rt, /export function enableResponsiveTables/);
  assert.match(rt, /data-label/);
  assert.match(shell, /enableResponsiveTables\(document\.getElementById\('main-content'\)\)/);
  assert.match(css, /table\.rt-cards td\[data-label\]:not\(\[data-label=''\]\)::before/);
  assert.match(css, /table\.rt-cards thead \{\s+display: none;/);
});

test('UI-AUDIT-P4: web screens use THEME_COLORS (no TOKENS.colors) so Light theme works', () => {
  for (const f of ['finance/ui.tsx', 'screens/AuditScreen.tsx', 'screens/ClockScreen.tsx', 'screens/FinanceOverviewScreen.tsx', 'screens/FinancePlanScreen.tsx']) {
    const src = read(`apps/web/src/${f}`);
    assert.doesNotMatch(src, /TOKENS\.colors\./, `${f} must use THEME_COLORS`);
  }
});

test('UI-AUDIT-P5: form controls get accessible names at runtime and screens avoid sub-12px text', () => {
  const forms = read('apps/web/src/a11y-forms.ts');
  assert.match(forms, /export function enableFormLabelling/);
  assert.match(forms, /htmlFor/);
  assert.match(shell, /enableFormLabelling\(document\.getElementById\('main-content'\)\)/);
  for (const f of ['ClockScreen', 'PayrollScreen', 'StorageScreen', 'WorkScreen', 'AccountsScreen']) {
    const src = read(`apps/web/src/screens/${f}.tsx`);
    assert.doesNotMatch(src, /fontSize:\s*'(9|10|10\.5|11|11\.5)(px)?'/, `${f} must not use text below 12px`);
  }
});

test('UI-AUDIT-P5: loading copy uses a real ellipsis character', () => {
  const spinner = read('packages/ui/src/components/Spinner.tsx');
  assert.match(spinner, /Đang tải…/);
  assert.doesNotMatch(spinner, /Đang tải\.\.\./);
});

test('UI-AUDIT-P5: navigation and breadcrumbs use plain Vietnamese labels and theme-aware badge contrast', () => {
  const bc = read('packages/ui/src/components/Breadcrumb.tsx');
  const sb = read('packages/ui/src/components/StatusBadge.tsx');
  assert.match(nav, /label:\s*'Tài khoản dùng chung'/);
  assert.match(nav, /label:\s*'Sổ tay lỗi'/);
  assert.doesNotMatch(nav, /Tài khoản ACC|Sổ tay Issues/);
  assert.match(bc, /label:\s*'Tài khoản dùng chung'/);
  assert.match(bc, /label:\s*'Sổ tay lỗi'/);
  assert.match(sb, /var\(--warning-text,\s*#F59E0B\)/);
  assert.match(sb, /var\(--success-text,\s*#10B981\)/);
});
