# UI-02 — Unified Design System

Dark only. Tokens: background #0B1220, surface #151F30, primary #14B8A6, text #F8FAFC, muted #94A3B8, border #334155, error #EF4444, warning #F59E0B. Spacing 4/8/12/16/24px; radius 8/12/16px; touch target >=44x44px; mobile-first >=360px; WCAG AA contrast; reduced-motion support.

One AppShell and shared component registry: PageHeader, AppButton, AppInput, AppSelect, AppCard, StatusBadge, DataList, ConfirmDialog, AppToast, EmptyState, ErrorState, LoadingState, PermissionGate, AuditTimeline, SecureRevealDialog. Owner and Staff share shell; menus derive from backend rights. Desktop sidebar; mobile bottom nav max four primary destinations + More.

Screens: login, activate, dashboard, employee list/form/detail, clock, attendance history/review, daily report/summary, assigned work/detail/submission, Content/Video review (V0.2), payroll overview/own pay, managed account list/detail/reauth, Drive folder/receipt/trash, audit/settings.

No layout-jumping buttons: fixed dimensions through loading, transform/opacity animations only, prevent double submit, never show success before API acknowledgement. Display pending/unknown for email/Drive async operations. Secret not in list/detail, require reauth and no cache. UI is not authorization. Prototype examples are fake data only, not live implementation.
