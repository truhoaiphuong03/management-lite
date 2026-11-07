/**
 * Route-level code splitting. Every screen except the login/shell essentials is loaded on
 * demand, so the first paint only downloads the shell, the UI kit and React — not all ~30
 * screens (about 1 MB of JavaScript before this split).
 *
 * Each lazy component shares its exact loader function with `preloadRouteScreen` so Vite
 * emits each module preload manifest only once.
 */
import { lazy } from 'react';

const loadDashboardScreen = () =>
  import('./screens/DashboardScreen.js').then((m) => ({
    default: m.DashboardScreen,
  }));
const loadClockScreen = () =>
  import('./screens/ClockScreen.js').then((m) => ({ default: m.ClockScreen }));
const loadScheduleScreen = () =>
  import('./screens/ScheduleScreen.js').then((m) => ({
    default: m.ScheduleScreen,
  }));
const loadReportsScreen = () =>
  import('./screens/ReportsScreen.js').then((m) => ({
    default: m.ReportsScreen,
  }));
const loadEmployeesScreen = () =>
  import('./screens/EmployeesScreen.js').then((m) => ({
    default: m.EmployeesScreen,
  }));
const loadEmployeeNewScreen = () =>
  import('./screens/EmployeeNewScreen.js').then((m) => ({
    default: m.EmployeeNewScreen,
  }));
const loadEmployeeDetailScreen = () =>
  import('./screens/EmployeeDetailScreen.js').then((m) => ({
    default: m.EmployeeDetailScreen,
  }));
const loadActivateScreen = () =>
  import('./screens/ActivateScreen.js').then((m) => ({
    default: m.ActivateScreen,
  }));
const loadForgotPasswordScreen = () =>
  import('./screens/ForgotPasswordScreen.js').then((m) => ({
    default: m.ForgotPasswordScreen,
  }));
const loadResetPasswordScreen = () =>
  import('./screens/ResetPasswordScreen.js').then((m) => ({
    default: m.ResetPasswordScreen,
  }));
const loadVerifyEmailScreen = () =>
  import('./screens/VerifyEmailScreen.js').then((m) => ({
    default: m.VerifyEmailScreen,
  }));
const loadPayrollScreen = () =>
  import('./screens/PayrollScreen.js').then((m) => ({
    default: m.PayrollScreen,
  }));
const loadSystemLogsScreen = () =>
  import('./screens/SystemLogsScreen.js').then((m) => ({
    default: m.SystemLogsScreen,
  }));
const loadPayrollStatsScreen = () =>
  import('./screens/PayrollStatsScreen.js').then((m) => ({
    default: m.PayrollStatsScreen,
  }));
const loadWorkScreen = () =>
  import('./screens/WorkScreen.js').then((m) => ({ default: m.WorkScreen }));
const loadAccountsScreen = () =>
  import('./screens/AccountsScreen.js').then((m) => ({
    default: m.AccountsScreen,
  }));
const loadStorageScreen = () =>
  import('./screens/StorageScreen.js').then((m) => ({
    default: m.StorageScreen,
  }));
const loadAuditScreen = () =>
  import('./screens/AuditScreen.js').then((m) => ({ default: m.AuditScreen }));
const loadIssuesScreen = () =>
  import('./screens/IssuesScreen.js').then((m) => ({
    default: m.IssuesScreen,
  }));
const loadIssueDetailScreen = () =>
  import('./screens/IssueDetailScreen.js').then((m) => ({
    default: m.IssueDetailScreen,
  }));
const loadGroupOverviewScreen = () =>
  import('./screens/GroupOverviewScreen.js').then((m) => ({
    default: m.GroupOverviewScreen,
  }));
const loadFinanceOverviewScreen = () =>
  import('./screens/FinanceOverviewScreen.js').then((m) => ({
    default: m.FinanceOverviewScreen,
  }));
const loadFinanceHistoryScreen = () =>
  import('./screens/FinanceHistoryScreen.js').then((m) => ({
    default: m.FinanceHistoryScreen,
  }));
const loadFinanceEntryScreen = () =>
  import('./screens/FinanceEntryScreen.js').then((m) => ({
    default: m.FinanceEntryScreen,
  }));
const loadFinanceCategoriesScreen = () =>
  import('./screens/FinanceCategoriesScreen.js').then((m) => ({
    default: m.FinanceCategoriesScreen,
  }));
const loadFinancePlanScreen = () =>
  import('./screens/FinancePlanScreen.js').then((m) => ({
    default: m.FinancePlanScreen,
  }));
const loadPrintQuoteScreen = () =>
  import('./screens/PrintQuoteScreen.js').then((m) => ({
    default: m.PrintQuoteScreen,
  }));
const loadSettingsScreen = () =>
  import('./screens/SettingsScreen.js').then((m) => ({
    default: m.SettingsScreen,
  }));

export const DashboardScreen = lazy(loadDashboardScreen);
export const ClockScreen = lazy(loadClockScreen);
export const ScheduleScreen = lazy(loadScheduleScreen);
export const ReportsScreen = lazy(loadReportsScreen);
export const EmployeesScreen = lazy(loadEmployeesScreen);
export const EmployeeNewScreen = lazy(loadEmployeeNewScreen);
export const EmployeeDetailScreen = lazy(loadEmployeeDetailScreen);
export const ActivateScreen = lazy(loadActivateScreen);
export const ForgotPasswordScreen = lazy(loadForgotPasswordScreen);
export const ResetPasswordScreen = lazy(loadResetPasswordScreen);
export const VerifyEmailScreen = lazy(loadVerifyEmailScreen);
export const PayrollScreen = lazy(loadPayrollScreen);
export const SystemLogsScreen = lazy(loadSystemLogsScreen);
export const PayrollStatsScreen = lazy(loadPayrollStatsScreen);
export const WorkScreen = lazy(loadWorkScreen);
export const AccountsScreen = lazy(loadAccountsScreen);
export const StorageScreen = lazy(loadStorageScreen);
export const AuditScreen = lazy(loadAuditScreen);
export const IssuesScreen = lazy(loadIssuesScreen);
export const IssueDetailScreen = lazy(loadIssueDetailScreen);
export const GroupOverviewScreen = lazy(loadGroupOverviewScreen);
export const FinanceOverviewScreen = lazy(loadFinanceOverviewScreen);
export const FinanceHistoryScreen = lazy(loadFinanceHistoryScreen);
export const FinanceEntryScreen = lazy(loadFinanceEntryScreen);
export const FinanceCategoriesScreen = lazy(loadFinanceCategoriesScreen);
export const FinancePlanScreen = lazy(loadFinancePlanScreen);
export const PrintQuoteScreen = lazy(loadPrintQuoteScreen);
export const SettingsScreen = lazy(loadSettingsScreen);

const EXACT_PRELOADERS: Record<string, () => Promise<unknown>> = {
  '/': loadDashboardScreen,
  '/dashboard': loadDashboardScreen,
  '/clock': loadClockScreen,
  '/attendance': loadClockScreen,
  '/attendance/adjustments': loadClockScreen,
  '/schedules': loadScheduleScreen,
  '/reports': loadReportsScreen,
  '/employees': loadEmployeesScreen,
  '/employees/new': loadEmployeeNewScreen,
  '/activate': loadActivateScreen,
  '/forgot-password': loadForgotPasswordScreen,
  '/reset-password': loadResetPasswordScreen,
  '/verify-email': loadVerifyEmailScreen,
  '/payroll': loadPayrollScreen,
  '/my-pay': loadPayrollScreen,
  '/payroll/stats': loadPayrollStatsScreen,
  '/system-logs': loadSystemLogsScreen,
  '/work': loadWorkScreen,
  '/accounts': loadAccountsScreen,
  '/storage': loadStorageScreen,
  '/audit': loadAuditScreen,
  '/issues': loadIssuesScreen,
  '/finance': loadFinanceOverviewScreen,
  '/finance/new': loadFinanceOverviewScreen,
  '/finance/history': loadFinanceHistoryScreen,
  '/finance/categories': loadFinanceCategoriesScreen,
  '/finance/plan': loadFinancePlanScreen,
  '/print-quotes': loadPrintQuoteScreen,
  '/settings': loadSettingsScreen,
};

/**
 * Starts downloading the lazy screen chunk for `pathname` immediately (in parallel
 * with `/api/v1/auth/me` on initial page load or during SPA route transitions).
 */
export function preloadRouteScreen(pathname: string): Promise<unknown> | null {
  const cleanPath = (pathname || '/').split(/[?#]/, 1)[0] || '/';
  const exact = EXACT_PRELOADERS[cleanPath];
  if (exact) return exact().catch(() => null);
  if (cleanPath.startsWith('/print-quotes/'))
    return loadPrintQuoteScreen().catch(() => null);
  if (cleanPath.startsWith('/work/')) return loadWorkScreen().catch(() => null);
  if (cleanPath.startsWith('/employees/'))
    return loadEmployeeDetailScreen().catch(() => null);
  if (cleanPath.startsWith('/issues/'))
    return loadIssueDetailScreen().catch(() => null);
  if (cleanPath.startsWith('/groups/'))
    return loadGroupOverviewScreen().catch(() => null);
  if (cleanPath.startsWith('/finance/entries/'))
    return loadFinanceEntryScreen().catch(() => null);
  return null;
}
