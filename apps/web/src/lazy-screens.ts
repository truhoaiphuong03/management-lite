/**
 * Route-level code splitting. Every screen except the login/shell essentials is loaded on
 * demand, so the first paint only downloads the shell, the UI kit and React — not all ~30
 * screens (about 1 MB of JavaScript before this split).
 *
 * Each lazy component keeps the exact props type of the screen it wraps and attaches `.preload`
 * bound to the same `import()` factory so `preloadRouteScreen` shares one Vite preload entry.
 */
import {
  lazy as reactLazy,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PreloadableLazy<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => Promise<{ default: T }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazy<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableLazy<T> {
  const Component = reactLazy(factory) as PreloadableLazy<T>;
  Component.preload = factory;
  return Component;
}

export const DashboardScreen = lazy(() =>
  import('./screens/DashboardScreen.js').then((m) => ({
    default: m.DashboardScreen,
  })),
);
export const ClockScreen = lazy(() =>
  import('./screens/ClockScreen.js').then((m) => ({ default: m.ClockScreen })),
);
export const ScheduleScreen = lazy(() =>
  import('./screens/ScheduleScreen.js').then((m) => ({
    default: m.ScheduleScreen,
  })),
);
export const ReportsScreen = lazy(() =>
  import('./screens/ReportsScreen.js').then((m) => ({
    default: m.ReportsScreen,
  })),
);
export const EmployeesScreen = lazy(() =>
  import('./screens/EmployeesScreen.js').then((m) => ({
    default: m.EmployeesScreen,
  })),
);
export const EmployeeNewScreen = lazy(() =>
  import('./screens/EmployeeNewScreen.js').then((m) => ({
    default: m.EmployeeNewScreen,
  })),
);
export const EmployeeDetailScreen = lazy(() =>
  import('./screens/EmployeeDetailScreen.js').then((m) => ({
    default: m.EmployeeDetailScreen,
  })),
);
export const ActivateScreen = lazy(() =>
  import('./screens/ActivateScreen.js').then((m) => ({
    default: m.ActivateScreen,
  })),
);
export const ForgotPasswordScreen = lazy(() =>
  import('./screens/ForgotPasswordScreen.js').then((m) => ({
    default: m.ForgotPasswordScreen,
  })),
);
export const ResetPasswordScreen = lazy(() =>
  import('./screens/ResetPasswordScreen.js').then((m) => ({
    default: m.ResetPasswordScreen,
  })),
);
export const VerifyEmailScreen = lazy(() =>
  import('./screens/VerifyEmailScreen.js').then((m) => ({
    default: m.VerifyEmailScreen,
  })),
);
export const PayrollScreen = lazy(() =>
  import('./screens/PayrollScreen.js').then((m) => ({
    default: m.PayrollScreen,
  })),
);
export const SystemLogsScreen = lazy(() =>
  import('./screens/SystemLogsScreen.js').then((m) => ({
    default: m.SystemLogsScreen,
  })),
);
export const PayrollStatsScreen = lazy(() =>
  import('./screens/PayrollStatsScreen.js').then((m) => ({
    default: m.PayrollStatsScreen,
  })),
);
export const WorkScreen = lazy(() =>
  import('./screens/WorkScreen.js').then((m) => ({ default: m.WorkScreen })),
);
export const AccountsScreen = lazy(() =>
  import('./screens/AccountsScreen.js').then((m) => ({
    default: m.AccountsScreen,
  })),
);
export const StorageScreen = lazy(() =>
  import('./screens/StorageScreen.js').then((m) => ({
    default: m.StorageScreen,
  })),
);
export const AuditScreen = lazy(() =>
  import('./screens/AuditScreen.js').then((m) => ({ default: m.AuditScreen })),
);
export const IssuesScreen = lazy(() =>
  import('./screens/IssuesScreen.js').then((m) => ({
    default: m.IssuesScreen,
  })),
);
export const IssueDetailScreen = lazy(() =>
  import('./screens/IssueDetailScreen.js').then((m) => ({
    default: m.IssueDetailScreen,
  })),
);
export const GroupOverviewScreen = lazy(() =>
  import('./screens/GroupOverviewScreen.js').then((m) => ({
    default: m.GroupOverviewScreen,
  })),
);
export const FinanceOverviewScreen = lazy(() =>
  import('./screens/FinanceOverviewScreen.js').then((m) => ({
    default: m.FinanceOverviewScreen,
  })),
);
export const FinanceHistoryScreen = lazy(() =>
  import('./screens/FinanceHistoryScreen.js').then((m) => ({
    default: m.FinanceHistoryScreen,
  })),
);
export const FinanceEntryScreen = lazy(() =>
  import('./screens/FinanceEntryScreen.js').then((m) => ({
    default: m.FinanceEntryScreen,
  })),
);
export const FinanceCategoriesScreen = lazy(() =>
  import('./screens/FinanceCategoriesScreen.js').then((m) => ({
    default: m.FinanceCategoriesScreen,
  })),
);
export const FinancePlanScreen = lazy(() =>
  import('./screens/FinancePlanScreen.js').then((m) => ({
    default: m.FinancePlanScreen,
  })),
);
export const PrintQuoteScreen = lazy(() =>
  import('./screens/PrintQuoteScreen.js').then((m) => ({
    default: m.PrintQuoteScreen,
  })),
);
export const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen.js').then((m) => ({
    default: m.SettingsScreen,
  })),
);

const EXACT_PRELOADERS: Record<string, { preload: () => Promise<unknown> }> = {
  '/': DashboardScreen,
  '/dashboard': DashboardScreen,
  '/clock': ClockScreen,
  '/attendance': ClockScreen,
  '/attendance/adjustments': ClockScreen,
  '/schedules': ScheduleScreen,
  '/reports': ReportsScreen,
  '/employees': EmployeesScreen,
  '/employees/new': EmployeeNewScreen,
  '/activate': ActivateScreen,
  '/forgot-password': ForgotPasswordScreen,
  '/reset-password': ResetPasswordScreen,
  '/verify-email': VerifyEmailScreen,
  '/payroll': PayrollScreen,
  '/my-pay': PayrollScreen,
  '/payroll/stats': PayrollStatsScreen,
  '/system-logs': SystemLogsScreen,
  '/work': WorkScreen,
  '/accounts': AccountsScreen,
  '/storage': StorageScreen,
  '/audit': AuditScreen,
  '/issues': IssuesScreen,
  '/finance': FinanceOverviewScreen,
  '/finance/new': FinanceOverviewScreen,
  '/finance/history': FinanceHistoryScreen,
  '/finance/categories': FinanceCategoriesScreen,
  '/finance/plan': FinancePlanScreen,
  '/print-quotes': PrintQuoteScreen,
  '/settings': SettingsScreen,
};

/**
 * Starts downloading the lazy screen chunk for `pathname` immediately (in parallel
 * with `/api/v1/auth/me` on initial page load or during SPA route transitions).
 */
export function preloadRouteScreen(pathname: string): Promise<unknown> | null {
  const cleanPath = (pathname || '/').split(/[?#]/, 1)[0] || '/';
  const exact = EXACT_PRELOADERS[cleanPath];
  if (exact) return exact.preload().catch(() => null);
  if (cleanPath.startsWith('/print-quotes/'))
    return PrintQuoteScreen.preload().catch(() => null);
  if (cleanPath.startsWith('/work/'))
    return WorkScreen.preload().catch(() => null);
  if (cleanPath.startsWith('/employees/'))
    return EmployeeDetailScreen.preload().catch(() => null);
  if (cleanPath.startsWith('/issues/'))
    return IssueDetailScreen.preload().catch(() => null);
  if (cleanPath.startsWith('/groups/'))
    return GroupOverviewScreen.preload().catch(() => null);
  if (cleanPath.startsWith('/finance/entries/'))
    return FinanceEntryScreen.preload().catch(() => null);
  return null;
}
