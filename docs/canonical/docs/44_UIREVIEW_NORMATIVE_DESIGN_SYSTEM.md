# UI-REVIEW — Normative Unified Design System
Version 0.1.0-doc.15 | Parent doc.14 | Status PASS design / HOLD implementation

## Authority and scope
Owner-approved PAY-02, RBAC-02, SEC-02, C01–C06, G01–G05 prevail. This document supersedes conflicting V0.1 UI examples in `06_UI_DESIGN_SYSTEM.md`; its WORK/Drive/Content/Video examples are V0.2 references only. No UI may grant authorization. No code or mockups are implemented.

## Design tokens (retain UI-02)
Dark-only: bg #0B1220; surface #151F30; primary #14B8A6; text #F8FAFC; muted #94A3B8; border #334155; error #EF4444; warning #F59E0B. Spacing 4/8/12/16/24px, radii 8/12/16px. Contrast WCAG AA verified in implementation, not presumed. 360px minimum viewport design target, >=44x44px interactive target. Never encode state with color alone. System typography consistent; no per-module hardcoded palettes.

## Single shell and navigation
One AppShell, common PageHeader, page gutters, breadcrumbs (desktop), contextual actions and notification region. Mobile bottom navigation max 4 primary destinations: Dashboard, Clock, Reports, More; Owner additionally reaches Employees, Attendance Review, Payroll, Accounts, Audit, Settings via More. Staff More exposes only authorized self-service items. Desktop sidebar uses same canonical route registry. Preserve scroll position and focus when switching permitted routes; no silent workspace switch or selector (C06). Explicit workspace context in session, no ambiguous default. Routes unavailable to role omitted in navigation, backend still authorizes; direct URL denied safely.

## Canonical components and interaction contract
AppButton (primary/secondary/destructive/quiet), AppInput, AppSelect, AppTextarea, AppCheckbox, AppDateTime, AppFormField, AppCard, StatusBadge, DataList, AppTable, ConfirmDialog, AppToast, EmptyState, ErrorState, LoadingState, PermissionGate, AuditTimeline, SecureRevealDialog. Each module consumes the shared component, no independent button/dialog/toast styles. Fixed minimum button height and reserved spinner/icon width; no layout shifts when loading, disabled, success or error. All submit actions prevent duplicate in-flight requests and show success only on server acknowledgment. Idempotency-Key/If-Match semantics are backend enforced, not replaced by disabling a button.

Form errors appear inline with text and aria association, first invalid field receives focus after failed submit; preserve entered nonsecret data. Secret fields clear on error/close; never persist, log, cache or show plaintext outside explicitly authorized reveal. Dialogs have focus trap, escape handling except when unsafe, descriptive labels, explicit destructive confirmation; restore focus on close. Toasts are supplemental, never sole evidence of error; persistent errors inline. Empty/loading/offline/permission/404/conflict/reauth-expired states are standardized. Unknown asynchronous email state never presented as delivered.

## Accessibility and responsive behavior
Mobile first 360/390/430px, tablet 768px, desktop 1280px reference sizes; these are review targets not new business policy. No horizontal overflow in core flows. Tables become labeled cards on narrow screens, retaining critical IDs, dates, amounts and actions. Keyboard order, visible focus, screen-reader labels, reduced-motion, 200% text zoom and accessible confirmation required. Touch feedback via opacity/transform only; never animate layout dimensions. Debounce search, not mutation. Status transitions announced accessibly.

## Financial/time display and privacy
Store timestamps server-side; UI displays workspace-local dates with timezone label for overnight shift; seconds and VND exact as PAY-02. Do not round per shift; label preview vs finalized pay. Owner cannot approve own attendance; no Owner payroll entry. No Staff ACC list, detail, route or metadata. Secret reveal and change require C05/SEC-02 scoped reauth and never appear in toasts, browser storage, telemetry or clipboard by default.

## UI acceptance gates
Single AppShell and token snapshots across all V0.1 screens; no independent module shell. Mobile navigation, 44px targets, loading button stability, keyboard/screen-reader and reduced-motion tests. All C01–C06 UI paths covered. No V0.2 feature routes or menus in V0.1. All gates DESIGN PASS only; visual regression and browser tests HOLD until implementation.
