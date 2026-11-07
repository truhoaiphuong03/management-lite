# System Load & Development Speed Optimization (`v0.9.7`) Implementation Plan

> **For agentic workers:** Implement this plan task-by-task following V4 Governance Rules (only after Owner design approval; verify each step before completion). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate production asset cache-bypass (`no-store`), cut the 6-stage frontend/API boot waterfall down to parallel single-wave requests, and accelerate local TypeScript checking, code maintenance, and CI execution by 2–6×.

**Architecture:** Step 1 hardens `scripts/runtime/serve-web.cjs` (bounded LRU RAM cache, upstream HTTP keep-alive pool, background Brotli/Gzip pre-warm) and adds an elevated, rollback-safe Owner cutover script (`scripts/deployment/Switch-ProductionWebServerToServeWeb.ps1`) so `HPManagementLiteWeb` serves `immutable` cached assets without altering the locked `Deploy-SemiAutoWindows.ps1` hash. Step 2 preloads route screen chunks in parallel with `/api/v1/auth/me`, splits 1,130 lines of inline CSS out of `PrintQuoteScreen.tsx` while scoping PrintQuote API fetches to the active `viewMode` in a single parallel wave, and serves cached TikTok V4 bridge summaries on `/dashboard` with background refresh. Step 3 enables incremental TypeScript checking (`tsconfig.typecheck.json`), parallelizes `windows-p0-security` and `ci` in `.github/workflows/foundation.yml` behind a gated `publish-release-artifact` job, and prunes clean merged git worktrees.

**Tech Stack:** Node.js 22 (`http`, `zlib`), React 18 + Vite 6, TypeScript 5.9, PowerShell 5.1, GitHub Actions.

**Spec:** Owner diagnostic approval (`2026-11-07T06:52:31+07:00` — Steps 1, 2, 3 + full verification).

## Global Constraints

- Zero direct writes to `C:\HoaiPhuong-Server\` or Production PostgreSQL `:55432` by AI (`AGENTS.md §0`).
- Preserve exact SHA-256 of locked `scripts/deployment/Deploy-SemiAutoWindows.ps1` (`4809cfd5...` / `ff3ecd05...`).
- Initial Web JS bundle must stay within budget (`<= 450 KB` raw / `<= 130 KB` gzip) and individual lazy chunks `< 300 KB`.
- Preserve 100% of existing RBAC, CSRF, SSR (`renderToStaticMarkup`), and Playwright E2E selectors.

## Review Focus

- Navigating from `/print-quotes` (Quotes List) to `/print-quotes/receivables` (AR Ledger) must automatically load `receivablesSummary` without requiring a full page reload.
- Saving a quote, order, customer, vendor, price item, or ledger entry must immediately invalidate cached PrintQuote collections so stale totals never appear.
- Preloading a route chunk when unauthenticated on `/print-quotes` must never execute unauthorized data fetches or crash before `verifySession()` resolves.
- `Switch-ProductionWebServerToServeWeb.ps1` must automatically restore the previous script and fail closed if post-switch HTTP verification fails.
- Parallelizing `foundation.yml` must never upload `management-lite-release-<sha>` or `ci-run-receipt-<sha>.json` unless BOTH `windows-p0-security` and `ci` succeed.

---

### Task PERF-01 (Bước 1): Harden `serve-web.cjs` & Owner Web-Service Cutover Tooling

- [x] Enhance `scripts/runtime/serve-web.cjs` with bounded LRU file cache (`MAX_CACHED_ENTRIES = 256`), `http.Agent({ keepAlive: true })` for `/api/*` upstream proxy, and non-blocking startup asset pre-warm (`prewarmAssets`).
- [x] Create `scripts/deployment/Switch-ProductionWebServerToServeWeb.ps1` enforcing OS Kernel High-Integrity UAC on Production, `-SandboxMode` for isolated testing, automatic SHA-256 backup, atomic delegation to `scripts/runtime/serve-web.cjs`, HTTP header verification (`immutable`, `br`, `CSP`), and automatic rollback on failure.
- [x] Add `tests/backend/serve-web-cutover.test.mjs` and verify `PASS`.

### Task PERF-02 (Bước 2): Eliminate Frontend/API Waterfalls & Split `PrintQuoteScreen` Styles

- [x] Export `preloadRouteScreen(pathname)` in `apps/web/src/lazy-screens.ts` and invoke it in `apps/web/src/App.tsx` before `await verifySession()` as well as inside `handleNavigate`.
- [x] Extract 1,130 lines of CSS from `apps/web/src/screens/PrintQuoteScreen.tsx` into `apps/web/src/screens/printquote/printquote-styles.ts` (`PRINTQUOTE_STYLES`).
- [x] Replace the 2-wave 11-endpoint `loadAllData` waterfall in `apps/web/src/screens/PrintQuoteScreen.tsx` with single-wave `viewMode`-scoped parallel fetching + short-TTL memory cache invalidated on mutations.
- [x] Add short-TTL (`60s`) stale-while-revalidate summary caching in `apps/api/src/bridge/service.ts` so `/dashboard` (`GET /api/v1/bridge/tiktok-v4`) returns cached local data in `< 5 ms` without blocking on outbound HTTPS to `hoaiphuong.click`.
- [x] Add unit/integration tests in `tests/web/perf-v097-waterfalls.test.mjs` and verify `PASS`.

### Task PERF-03 (Bước 3): Accelerate `typecheck`, Parallelize GitHub Actions CI & Clean Merged Worktrees

- [x] Add `tsconfig.typecheck.json` (`incremental: true`, `tsBuildInfoFile` under `node_modules/.cache/tsc/`) and wire `npm run typecheck` in `package.json`.
- [x] Update `.github/workflows/foundation.yml` and `tests/backend/cicd-policy.test.mjs` so `windows-p0-security` and `ci` run in parallel while `publish-release-artifact` gates artifact + CI receipt creation on `needs: [windows-p0-security, ci]`.
- [x] Safely remove only clean (`dirty=0`, zero custom `.env`), already-merged git worktrees (`git worktree remove` + `git worktree prune`), bump version to `v0.9.7`, update governance docs, and run full verification + before/after benchmarks.
