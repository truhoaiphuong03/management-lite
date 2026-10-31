/**
 * Route-level code splitting. Every screen except the login/shell essentials is loaded on
 * demand, so the first paint only downloads the shell, the UI kit and React — not all ~30
 * screens (about 1 MB of JavaScript before this split).
 *
 * Each lazy component keeps the exact props type of the screen it wraps.
 */
import { lazy } from 'react';

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
