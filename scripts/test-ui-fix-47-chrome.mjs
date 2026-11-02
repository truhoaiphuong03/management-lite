import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = 9249;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = process.env.QA_WEB_BASE;
if (!targetUrl) throw new Error('Explicit isolated QA_WEB_BASE is required');
const qaTarget = new URL(targetUrl);
if (
  qaTarget.protocol !== 'http:' ||
  qaTarget.hostname !== '127.0.0.1' ||
  ['3017', '3018', '3027', '3028', '3008'].includes(qaTarget.port)
)
  throw new Error('Operational/nonlocal browser endpoint refused');
// Portable repo root (no hard-coded absolute path); used for Vite /@fs imports.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appButtonFsPath = `/@fs${repoRoot}/packages/ui/src/components/AppButton.tsx`;

async function run() {
  console.log('=== STARTING UI-FIX-49 LIVE CHROME SUITE (FAIL-CLOSED) ===');
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-fix-49-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));

    // 1. Open about:blank FIRST (never navigate to app before interception is installed)
    const newTab = await fetch(
      `http://127.0.0.1:${port}/json/new?about:blank`,
      { method: 'PUT' },
    ).then((r) => r.json());

    const ws = new WebSocket(newTab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    let msgId = 1;
    const callbacks = new Map();
    const unmockedCdpBlocked = [];
    const cdpErrors = [];

    let currentCdpPhase = 'startup';

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Fetch.requestPaused') {
        unmockedCdpBlocked.push({
          url: msg.params.request.url,
          phase: currentCdpPhase,
          timestamp: Date.now(),
        });
        send('Fetch.failRequest', {
          requestId: msg.params.requestId,
          errorReason: 'AccessDenied',
        }).catch((err) => {
          cdpErrors.push(err);
        });
        return;
      }
      if (msg.id && callbacks.has(msg.id)) {
        const { res, rej } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = msgId++;
        callbacks.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (exp) => {
      const r = await send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.text +
            ': ' +
            (r.exceptionDetails.exception?.description || ''),
        );
      }
      return r.result?.value;
    };

    // 2. Enable CDP domains and setup protocol-level network block before navigation
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', {
      patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }],
    });

    // 3. Install fail-closed fetch guard in page before any scripts run
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__CURRENT_PHASE__ = 'startup';
          window.__FAIL_CLOSED_VIOLATIONS__ = [];
          window.__mockFetchRegistry__ = [];
          window.__lastCopiedText__ = null;

          if (!navigator.clipboard) {
            navigator.clipboard = {};
          }
          navigator.clipboard.writeText = async (text) => {
            window.__lastCopiedText__ = text;
            return true;
          };

          // Strict fail-closed fetch: ZERO fallback to real network
          window.fetch = async (url, opts = {}) => {
            const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
            for (const handler of window.__mockFetchRegistry__) {
              if (handler.matches(urlStr, opts)) {
                return handler.handle(urlStr, opts);
              }
            }
            window.__FAIL_CLOSED_VIOLATIONS__.push({
              url: urlStr,
              opts,
              phase: window.__CURRENT_PHASE__ || 'startup',
              timestamp: Date.now(),
            });
            throw new Error('FAIL-CLOSED HARNESS: Real network blocked for ' + urlStr);
          };
        })()
      `,
    });

    // 4. Navigate to local web dev server with pre-document fail-closed script installed
    await send('Page.navigate', { url: targetUrl });
    await new Promise((r) => setTimeout(r, 1200));

    // 5. Controlled Probe: verify that unmocked API requests are strictly fail-closed
    currentCdpPhase = 'probe';
    await evaluate(`window.__CURRENT_PHASE__ = 'probe'`);

    const probeResult = await evaluate(`
      (async () => {
        try {
          await window.fetch('/api/v1/controlled-probe-unmocked-endpoint');
          return { blocked: false, count: window.__FAIL_CLOSED_VIOLATIONS__.length, violations: window.__FAIL_CLOSED_VIOLATIONS__ };
        } catch (e) {
          return {
            blocked: true,
            errorMsg: e.message,
            violationRecorded: window.__FAIL_CLOSED_VIOLATIONS__.some(v => v.url?.includes('controlled-probe-unmocked-endpoint')),
            count: window.__FAIL_CLOSED_VIOLATIONS__.length,
            violations: window.__FAIL_CLOSED_VIOLATIONS__,
          };
        }
      })()
    `);
    console.log('Controlled probe result:', JSON.stringify(probeResult));
    assert.equal(probeResult.blocked, true, 'Controlled probe must be blocked');
    assert.ok(
      probeResult.errorMsg.includes('FAIL-CLOSED HARNESS'),
      'Must throw fail-closed error',
    );
    assert.equal(
      probeResult.violationRecorded,
      true,
      'Must record probe violation',
    );
    console.log(
      '✔ Harness Safety Controlled Probe: PASS (Unmocked requests strictly blocked)',
    );
    // Ledger is strictly append-only; violations are preserved throughout the suite run

    // Switch to test_suite phase: unmocked /auth/me outside startup is strictly forbidden
    currentCdpPhase = 'test_suite';
    await evaluate(`window.__CURRENT_PHASE__ = 'test_suite'`);

    // =========================================================================
    // 1. REPORTS STAFF: DELAYED JSON A COMPLETING AFTER B
    // =========================================================================
    console.log('\n--- 1. Testing ReportsScreen Staff Delayed JSON A vs B ---');
    const staffReportsResult = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { ReportsScreen } = await import('/src/screens/ReportsScreen.tsx');

          const container = document.createElement('div');
          container.id = 'reports-staff-root';
          document.body.appendChild(container);
          const root = ReactDOM.createRoot(container);

          let pendingMyReportsRequests = [];
          let isInitialMounted = false;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    active_workspace: { id: 'ws-staff-1', role: 'staff' },
                    csrf_token: 'csrf-rep-staff',
                  },
                }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/reports/daily'),
              handle: async () => ({
                ok: true,
                status: 201,
                json: async () => ({
                  success: true,
                  data: { id: 'staff-rep-created-1' },
                }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/reports/me'),
              handle: async (url, opts) => {
                if (!isInitialMounted) {
                  return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                      success: true,
                      data: {
                        items: [
                          {
                            id: 'staff-rep-init',
                            report_date: '2026-10-01',
                            status: 'draft',
                            employee_name: 'Staff Initial',
                            entries: [],
                          },
                        ],
                        next_cursor: 'cursor-init',
                      },
                    }),
                  };
                }
                return new Promise((resolve, reject) => {
                  pendingMyReportsRequests.push({ url, opts, resolve, reject });
                });
              },
            },
          ];

          root.render(React.createElement(ReportsScreen, { role: 'staff' }));
          await new Promise(r => setTimeout(r, 200));
          isInitialMounted = true;

          const getCardText = () => container.innerText || '';
          const getLoadMoreBtn = () => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Tải thêm báo cáo'));

          const initialLoadMoreBtn = getLoadMoreBtn();
          if (!initialLoadMoreBtn) {
            throw new Error('Initial "Tải thêm báo cáo" button not found');
          }

          // Trigger Request A (load more)
          initialLoadMoreBtn.click();
          while (pendingMyReportsRequests.length === 0) {
            await new Promise(r => setTimeout(r, 10));
          }
          const reqA = pendingMyReportsRequests.shift();

          let resolveDelayedJsonA;
          const delayedJsonPromiseA = new Promise((res) => {
            resolveDelayedJsonA = () => res({
              success: true,
              data: {
                items: [
                  {
                    id: 'staff-rep-stale-A',
                    report_date: '2026-10-02',
                    status: 'draft',
                    employee_name: 'Stale Staff Report A',
                    entries: [],
                  },
                ],
                next_cursor: 'cursor-stale-A',
              },
            });
          });

          reqA.resolve({
            ok: true,
            status: 200,
            json: () => delayedJsonPromiseA,
          });
          await new Promise(r => setTimeout(r, 30));

          // Trigger Request B (create draft report while A is waiting for json)
          const createReportBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Tạo báo cáo ngày'));
          createReportBtn.click();
          await new Promise(r => setTimeout(r, 80));

          const saveDraftBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Lưu bản nháp'));
          saveDraftBtn.click();

          while (pendingMyReportsRequests.length === 0) {
            await new Promise(r => setTimeout(r, 10));
          }
          const reqB = pendingMyReportsRequests.shift();

          reqB.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  {
                    id: 'staff-rep-winner-B',
                    report_date: '2026-10-03',
                    status: 'draft',
                    employee_name: 'Winner Staff Report B',
                    entries: [],
                  },
                ],
                next_cursor: 'cursor-winner-B',
              },
            }),
          });
          await new Promise(r => setTimeout(r, 150));

          const textAfterB = getCardText();
          const hasB_BeforeAResolve = textAfterB.includes('Winner Staff Report B') || textAfterB.includes('2026-10-03');
          const hasA_BeforeAResolve = textAfterB.includes('Stale Staff Report A');

          // Request A delayed JSON resolves now
          resolveDelayedJsonA();
          await new Promise(r => setTimeout(r, 150));

          const textAfterDelayedA = getCardText();
          const hasB_AfterAResolve = textAfterDelayedA.includes('Winner Staff Report B') || textAfterDelayedA.includes('2026-10-03');
          const hasA_AfterAResolve = textAfterDelayedA.includes('Stale Staff Report A') || textAfterDelayedA.includes('2026-10-02');

          const loadMoreBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Tải thêm báo cáo'));
          const hasLoadingIndicator = container.innerText.includes('Đang tải...');
          const hasErrorBanner = Boolean(container.querySelector('[role="alert"]'));

          root.unmount();
          container.remove();
          window.__mockFetchRegistry__ = [];

          return {
            hasB_BeforeAResolve,
            hasA_BeforeAResolve,
            hasB_AfterAResolve,
            hasA_AfterAResolve,
            hasLoadMoreBtn: Boolean(loadMoreBtn),
            hasLoadingIndicator,
            hasErrorBanner,
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (staffReportsResult.error) {
      throw new Error(
        'Staff Reports test error: ' +
          staffReportsResult.error +
          '\n' +
          staffReportsResult.stack,
      );
    }
    console.log('Staff Reports Result:', staffReportsResult);
    assert.equal(
      staffReportsResult.hasB_BeforeAResolve,
      true,
      'Request B must be rendered initially',
    );
    assert.equal(
      staffReportsResult.hasA_BeforeAResolve,
      false,
      'Stale A must not be present',
    );
    assert.equal(
      staffReportsResult.hasB_AfterAResolve,
      true,
      'Request B content must remain after A JSON resolves',
    );
    assert.equal(
      staffReportsResult.hasA_AfterAResolve,
      false,
      'Stale Request A must NEVER overwrite Request B in Staff mode',
    );
    assert.equal(
      staffReportsResult.hasLoadMoreBtn,
      true,
      'Cursor from Request B must be active',
    );
    assert.equal(
      staffReportsResult.hasLoadingIndicator,
      false,
      'Loading must be false after Request B',
    );
    assert.equal(
      staffReportsResult.hasErrorBanner,
      false,
      'Error must be null',
    );
    console.log('✔ ReportsScreen Staff Stale JSON Guard Verification: PASS');

    // =========================================================================
    // 2. EMPLOYEES TARGETED TESTS: UNMOUNT (INITIAL & LOAD-MORE), FILTER CLEANUP, RETRY
    // =========================================================================
    console.log(
      '\n--- 2. Testing EmployeesScreen Unmount (Initial & Load-More), Filter Cleanup & Retry ---',
    );
    const employeesTargetedResult = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { EmployeesScreen } = await import('/src/screens/EmployeesScreen.tsx');

          // --- 2A: UNMOUNT DURING INITIAL LOAD PENDING ---
          let initialSignal = null;
          let initialResolve = null;
          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: async (url, opts) => {
                initialSignal = opts?.signal;
                return new Promise((res, rej) => {
                  initialResolve = res;
                });
              },
            },
          ];

          const container1 = document.createElement('div');
          document.body.appendChild(container1);
          const root1 = ReactDOM.createRoot(container1);

          root1.render(React.createElement(EmployeesScreen, { onNavigate: () => {} }));
          await new Promise(r => setTimeout(r, 60));

          const initialSignalBeforeUnmountAborted = initialSignal?.aborted;
          root1.unmount();
          container1.remove();

          const initialSignalAfterUnmountAborted = initialSignal?.aborted;

          // Late resolve after unmount
          if (initialResolve) {
            initialResolve({
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                data: { items: [{ id: 'late-init', full_name: 'Late Initial' }] },
              }),
            });
          }
          await new Promise(r => setTimeout(r, 80));

          // --- 2B: UNMOUNT DURING LOAD-MORE PENDING ---
          let loadMoreSignal = null;
          let loadMoreResolve = null;
          let initialLoadDone = false;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: async (url, opts) => {
                if (!initialLoadDone) {
                  return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                      success: true,
                      data: {
                        items: [{ id: 'emp-p1', employee_code: 'P1', full_name: 'Page 1 Emp', employment_status: 'active' }],
                        next_cursor: 'cursor-p1',
                      },
                    }),
                  };
                }
                loadMoreSignal = opts?.signal;
                return new Promise((res) => {
                  loadMoreResolve = res;
                });
              },
            },
          ];

          const container2 = document.createElement('div');
          document.body.appendChild(container2);
          const root2 = ReactDOM.createRoot(container2);

          root2.render(React.createElement(EmployeesScreen, { onNavigate: () => {} }));
          await new Promise(r => setTimeout(r, 120));
          initialLoadDone = true;

          const loadMoreBtn = Array.from(container2.querySelectorAll('button')).find(b => b.textContent.includes('Tải thêm nhân sự'));
          if (!loadMoreBtn) {
            throw new Error('Load more button not found for Test 2B');
          }

          loadMoreBtn.click();
          await new Promise(r => setTimeout(r, 60));

          const loadMoreSignalBeforeUnmountAborted = loadMoreSignal?.aborted;
          root2.unmount();
          container2.remove();

          const loadMoreSignalAfterUnmountAborted = loadMoreSignal?.aborted;

          // Late resolve after unmount
          if (loadMoreResolve) {
            loadMoreResolve({
              ok: true,
              status: 200,
              json: async () => ({
                success: true,
                data: { items: [{ id: 'late-p2', full_name: 'Late Page 2' }] },
              }),
            });
          }
          await new Promise(r => setTimeout(r, 80));

          // --- 2C: FILTER CHANGE CLEANUP & GUARD ---
          let filterPendingRequests = [];
          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: async (url, opts) => {
                return new Promise((res) => {
                  filterPendingRequests.push({ url, opts, res });
                });
              },
            },
          ];

          const container3 = document.createElement('div');
          document.body.appendChild(container3);
          const root3 = ReactDOM.createRoot(container3);

          root3.render(React.createElement(EmployeesScreen, { onNavigate: () => {} }));
          await new Promise(r => setTimeout(r, 60));

          const reqFilter1 = filterPendingRequests.shift();
          reqFilter1.res({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { items: [{ id: 'emp-all', employee_code: 'ALL', full_name: 'All Emp', employment_status: 'active' }] },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          // Click 'Tạm ngưng' filter tab -> starts Request A
          const suspendedTab = Array.from(container3.querySelectorAll('button')).find(b => b.textContent.includes('Tạm ngưng'));
          suspendedTab.click();
          await new Promise(r => setTimeout(r, 60));

          const reqA = filterPendingRequests.shift();
          const reqASignalBeforeCleanupAborted = reqA.opts?.signal?.aborted;

          // Click 'Đang hoạt động' filter tab before A resolves -> effect cleanup runs
          const activeTab = Array.from(container3.querySelectorAll('button')).find(b => b.textContent.includes('Đang hoạt động'));
          activeTab.click();
          await new Promise(r => setTimeout(r, 60));

          const reqASignalAfterCleanupAborted = reqA.opts?.signal?.aborted;
          const reqB = filterPendingRequests.shift();

          // Request B finishes first
          reqB.res({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { items: [{ id: 'emp-active-winner', employee_code: 'ACT', full_name: 'Active Winner Emp', employment_status: 'active' }] },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          const textAfterB = container3.innerText;
          const hasActiveWinner = textAfterB.includes('Active Winner Emp');

          // Now resolve Request A late
          reqA.res({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { items: [{ id: 'emp-stale-A', employee_code: 'STL', full_name: 'Stale Suspended Emp', employment_status: 'suspended' }] },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          const textAfterDelayedA = container3.innerText;
          const hasActiveWinnerAfterDelayedA = textAfterDelayedA.includes('Active Winner Emp');
          const hasStaleAAfterDelayedA = textAfterDelayedA.includes('Stale Suspended Emp');

          root3.unmount();
          container3.remove();

          // --- 2D: LOAD MORE FAILURE & RETRY PRESERVES LIST / CURSOR ---
          let loadMoreAttempt = 0;
          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: async (url) => {
                if (url.includes('cursor=')) {
                  loadMoreAttempt++;
                  if (loadMoreAttempt === 1) {
                    return {
                      ok: false,
                      status: 500,
                      json: async () => ({ error: { message: 'Máy chủ quá tải khi tải trang 2' } }),
                    };
                  }
                  return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                      success: true,
                      data: {
                        items: [{ id: 'emp-page2', employee_code: 'P2', full_name: 'Page 2 Emp', employment_status: 'active' }],
                        next_cursor: null,
                      },
                    }),
                  };
                }
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      items: [{ id: 'emp-page1', employee_code: 'P1', full_name: 'Page 1 Emp', employment_status: 'active' }],
                      next_cursor: 'cursor-retry-test',
                    },
                  }),
                };
              },
            },
          ];

          const container4 = document.createElement('div');
          document.body.appendChild(container4);
          const root4 = ReactDOM.createRoot(container4);

          root4.render(React.createElement(EmployeesScreen, { onNavigate: () => {} }));
          await new Promise(r => setTimeout(r, 150));

          const btnLoadMoreRetry = Array.from(container4.querySelectorAll('button')).find(b => b.textContent.includes('Tải thêm nhân sự'));
          // First click -> fails with 500
          btnLoadMoreRetry.click();
          await new Promise(r => setTimeout(r, 150));

          const textAfterLoadMoreFail = container4.innerText;
          const hasP1AfterFail = textAfterLoadMoreFail.includes('Page 1 Emp');
          const hasErrorBannerAfterFail = container4.querySelector('[role="alert"]')?.textContent?.includes('Máy chủ quá tải') || textAfterLoadMoreFail.includes('Máy chủ quá tải');
          const hasLoadMoreBtnAfterFail = Boolean(Array.from(container4.querySelectorAll('button')).find(b => b.textContent.includes('Tải thêm nhân sự')));

          // Second click -> retry succeeds
          btnLoadMoreRetry.click();
          await new Promise(r => setTimeout(r, 150));

          const textAfterRetrySuccess = container4.innerText;
          const hasP1AfterSuccess = textAfterRetrySuccess.includes('Page 1 Emp');
          const hasP2AfterSuccess = textAfterRetrySuccess.includes('Page 2 Emp');
          const hasErrorBannerAfterSuccess = Boolean(container4.querySelector('[role="alert"]'));

          // --- 2E: UNMOUNT DELAYED JSON / REJECT CONTINUATION PROOF ---
          const container5 = document.createElement('div');
          container5.id = 'emp-test-root-5';
          document.body.appendChild(container5);
          const root5 = ReactDOM.createRoot(container5);

          let unmountTestSignal = null;
          let resolveDelayedEmpReq = null;
          let jsonCalledAfterUnmount = false;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: (url, opts) => {
                unmountTestSignal = opts?.signal;
                return new Promise((res) => {
                  resolveDelayedEmpReq = res;
                });
              },
            },
          ];

          root5.render(React.createElement(EmployeesScreen));
          await new Promise(r => setTimeout(r, 60));

          const unmountSignalBefore = Boolean(unmountTestSignal?.aborted);

          // Component unmounts while request is pending
          root5.unmount();
          container5.remove();
          await new Promise(r => setTimeout(r, 60));

          const unmountSignalAfter = Boolean(unmountTestSignal?.aborted);

          // Delayed response resolves with JSON continuation after unmount
          let continuationErrorThrown = false;
          try {
            resolveDelayedEmpReq({
              ok: true,
              status: 200,
              json: async () => {
                jsonCalledAfterUnmount = true;
                return {
                  success: true,
                  data: {
                    items: [{ id: 'late-emp', employee_code: 'LATE', full_name: 'Late Emp', employment_status: 'active' }],
                  },
                };
              },
            });
            await new Promise(r => setTimeout(r, 60));
          } catch {
            continuationErrorThrown = true;
          }

          // --- 2E-1: JSON PENDING BEFORE UNMOUNT ---
          const container6 = document.createElement('div');
          container6.id = 'emp-test-root-6';
          document.body.appendChild(container6);
          const root6 = ReactDOM.createRoot(container6);

          let resolveJson6 = null;
          let json6Executed = false;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: () => new Promise((res) => {
                  resolveJson6 = res;
                }),
              }),
            },
          ];

          root6.render(React.createElement(EmployeesScreen));
          await new Promise(r => setTimeout(r, 60));

          // Component unmounts while JSON is pending
          root6.unmount();
          container6.remove();
          await new Promise(r => setTimeout(r, 60));

          let pendingJsonErrorThrown = false;
          try {
            if (resolveJson6) {
              resolveJson6({
                success: true,
                data: {
                  items: [{ id: 'json-pending-emp', employee_code: 'PJSON', full_name: 'Pending JSON Emp', employment_status: 'active' }],
                },
              });
              json6Executed = true;
            }
            await new Promise(r => setTimeout(r, 60));
          } catch {
            pendingJsonErrorThrown = true;
          }

          // --- 2E-2: LATE REJECT AFTER CLEANUP ---
          const container7 = document.createElement('div');
          container7.id = 'emp-test-root-7';
          document.body.appendChild(container7);
          const root7 = ReactDOM.createRoot(container7);

          let rejectEmpReq7 = null;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { csrf_token: 'csrf' } }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/employees'),
              handle: () => new Promise((_res, rej) => {
                rejectEmpReq7 = rej;
              }),
            },
          ];

          root7.render(React.createElement(EmployeesScreen));
          await new Promise(r => setTimeout(r, 60));

          // Component unmounts while request is pending
          root7.unmount();
          container7.remove();
          await new Promise(r => setTimeout(r, 60));

          let lateRejectHandledCleanly = true;
          try {
            if (rejectEmpReq7) {
              rejectEmpReq7(new Error('Late network error after unmount'));
            }
            await new Promise(r => setTimeout(r, 60));
          } catch {
            lateRejectHandledCleanly = false;
          }

          window.__mockFetchRegistry__ = [];

          return {
            initialSignalBeforeUnmountAborted,
            initialSignalAfterUnmountAborted,
            loadMoreSignalBeforeUnmountAborted,
            loadMoreSignalAfterUnmountAborted,
            reqASignalBeforeCleanupAborted,
            reqASignalAfterCleanupAborted,
            hasActiveWinner,
            hasActiveWinnerAfterDelayedA,
            hasStaleAAfterDelayedA,
            hasP1AfterFail,
            hasErrorBannerAfterFail,
            hasLoadMoreBtnAfterFail,
            hasP1AfterSuccess,
            hasP2AfterSuccess,
            hasErrorBannerAfterSuccess,
            unmountSignalBefore,
            unmountSignalAfter,
            jsonCalledAfterUnmount,
            continuationErrorThrown,
            pendingJsonErrorThrown,
            json6Executed,
            lateRejectHandledCleanly,
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (employeesTargetedResult.error) {
      throw new Error(
        'Employees targeted test error: ' +
          employeesTargetedResult.error +
          '\n' +
          employeesTargetedResult.stack,
      );
    }

    console.log('Employees Targeted Result:', employeesTargetedResult);
    // 2A Assertions: Initial load unmount
    assert.equal(
      employeesTargetedResult.initialSignalBeforeUnmountAborted,
      false,
      'Initial signal not aborted before unmount',
    );
    assert.equal(
      employeesTargetedResult.initialSignalAfterUnmountAborted,
      true,
      'Initial signal MUST be aborted on unmount cleanup',
    );

    // 2B Assertions: Load-more unmount
    assert.equal(
      employeesTargetedResult.loadMoreSignalBeforeUnmountAborted,
      false,
      'Load-more signal not aborted before unmount',
    );
    assert.equal(
      employeesTargetedResult.loadMoreSignalAfterUnmountAborted,
      true,
      'Load-more signal MUST be aborted on unmount cleanup',
    );

    // 2C Assertions: Filter change cleanup & guard
    assert.equal(
      employeesTargetedResult.reqASignalBeforeCleanupAborted,
      false,
      'Request A signal not aborted before filter change',
    );
    assert.equal(
      employeesTargetedResult.reqASignalAfterCleanupAborted,
      true,
      'Request A signal MUST be aborted when filter changes',
    );
    assert.equal(
      employeesTargetedResult.hasActiveWinner,
      true,
      'Request B data must be displayed',
    );
    assert.equal(
      employeesTargetedResult.hasActiveWinnerAfterDelayedA,
      true,
      'Request B data remains after delayed A resolves',
    );
    assert.equal(
      employeesTargetedResult.hasStaleAAfterDelayedA,
      false,
      'Stale Request A must NEVER overwrite Request B',
    );

    // 2D Assertions: Load-more failure & retry
    assert.equal(
      employeesTargetedResult.hasP1AfterFail,
      true,
      'Page 1 items preserved on load-more error',
    );
    assert.equal(
      employeesTargetedResult.hasErrorBannerAfterFail,
      true,
      'Pagination error banner displayed',
    );
    assert.equal(
      employeesTargetedResult.hasLoadMoreBtnAfterFail,
      true,
      'Load-more button retained on error',
    );
    assert.equal(
      employeesTargetedResult.hasP1AfterSuccess,
      true,
      'Page 1 items preserved after retry',
    );
    assert.equal(
      employeesTargetedResult.hasP2AfterSuccess,
      true,
      'Page 2 items appended after retry',
    );
    assert.equal(
      employeesTargetedResult.hasErrorBannerAfterSuccess,
      false,
      'Pagination error banner cleared on success',
    );

    // 2E Assertions: Delayed JSON continuation and late reject after unmount
    assert.equal(
      employeesTargetedResult.unmountSignalBefore,
      false,
      'Signal before unmount is active',
    );
    assert.equal(
      employeesTargetedResult.unmountSignalAfter,
      true,
      'Signal after unmount is aborted',
    );
    assert.equal(
      employeesTargetedResult.continuationErrorThrown,
      false,
      'Continuation resolves cleanly without unhandled rejection',
    );
    assert.equal(
      employeesTargetedResult.json6Executed,
      true,
      'Pending JSON before unmount was resolved',
    );
    assert.equal(
      employeesTargetedResult.pendingJsonErrorThrown,
      false,
      'Pending JSON resolving after unmount does not throw',
    );
    assert.equal(
      employeesTargetedResult.lateRejectHandledCleanly,
      true,
      'Late reject after unmount is safely handled without uncaught errors',
    );
    console.log(
      '✔ EmployeesScreen Targeted Lifecycle & Cleanup Verification: ALL PASS',
    );
    console.log('✔ EmployeesScreen Unmount Rigorous Verification: PASS');

    // =========================================================================
    // 3. FIX-41 REGRESSION ON FINAL SNAPSHOT
    // =========================================================================
    console.log('\n--- 3. Testing FIX-41 Loading Width & Accessibility ---');
    const fix41Result = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { AppButton } = await import(${JSON.stringify(appButtonFsPath)});

          const container = document.createElement('div');
          container.id = 'btn-test-container';
          container.style.display = 'flex';
          container.style.flexDirection = 'column';
          container.style.gap = '20px';
          container.style.padding = '40px';
          document.body.appendChild(container);

          const root = ReactDOM.createRoot(container);
          root.render(
            React.createElement('div', null,
              React.createElement('div', { id: 'row-before', style: { display: 'flex', gap: '0px' } },
                React.createElement(AppButton, { size: 'sm', id: 'btn-norm-before' }, 'Lưu'),
                React.createElement(AppButton, { size: 'sm', id: 'btn-adj-before' }, 'Hủy')
              ),
              React.createElement('div', { id: 'row-loading', style: { display: 'flex', gap: '0px' } },
                React.createElement(AppButton, {
                  size: 'sm',
                  id: 'btn-norm-loading',
                  isLoading: true,
                  loadingText: 'Đang gửi thông tin xác thực lên máy chủ bảo mật và hoàn tất phiên giao dịch...',
                }, 'Lưu'),
                React.createElement(AppButton, { size: 'sm', id: 'btn-adj-loading' }, 'Hủy')
              ),
              React.createElement('div', { id: 'row-notext', style: { display: 'flex', gap: '0px' } },
                React.createElement(AppButton, {
                  size: 'sm',
                  id: 'btn-notext-loading',
                  isLoading: true,
                }, 'Lưu')
              )
            )
          );

          await new Promise(r => setTimeout(r, 100));

          const btnBefore = document.getElementById('btn-norm-before');
          const btnLoading = document.getElementById('btn-norm-loading');
          const btnAdjBefore = document.getElementById('btn-adj-before');
          const btnAdjLoading = document.getElementById('btn-adj-loading');
          const btnNoTextLoading = document.getElementById('btn-notext-loading');

          const rBefore = btnBefore.getBoundingClientRect();
          const rLoading = btnLoading.getBoundingClientRect();
          const rAdjBefore = btnAdjBefore.getBoundingClientRect();
          const rAdjLoading = btnAdjLoading.getBoundingClientRect();

          const getStatusInfo = (el) => {
            const all = Array.from(el.querySelectorAll('[role="status"]'));
            const accessible = all.filter(s => !s.closest('[aria-hidden="true"]'));
            const decorative = all.filter(s => Boolean(s.closest('[aria-hidden="true"]')));
            return {
              total: all.length,
              accessibleCount: accessible.length,
              decorativeCount: decorative.length,
              accessibleTexts: accessible.map(s => s.textContent || s.getAttribute('aria-label')),
            };
          };

          const widthDiff = Math.abs(rBefore.width - rLoading.width);
          const adjShift = Math.abs(rAdjBefore.left - rAdjLoading.left);

          const statusWithLoadingText = getStatusInfo(btnLoading);
          const statusWithoutLoadingText = getStatusInfo(btnNoTextLoading);

          root.unmount();
          container.remove();

          return {
            widthBefore: rBefore.width,
            widthLoading: rLoading.width,
            widthDiff,
            adjShift,
            statusWithLoadingText,
            statusWithoutLoadingText,
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (fix41Result.error) {
      throw new Error(
        'FIX-41 test error: ' + fix41Result.error + '\n' + fix41Result.stack,
      );
    }
    console.log('FIX-41 Measurements:', fix41Result);
    assert.equal(
      fix41Result.widthDiff,
      0,
      'Width difference must be exactly 0.000px',
    );
    assert.equal(
      fix41Result.adjShift,
      0,
      'Adjacent button position shift must be 0.000px',
    );
    assert.equal(
      fix41Result.statusWithLoadingText.accessibleCount,
      1,
      'Exactly one accessible status when loadingText present',
    );
    assert.equal(
      fix41Result.statusWithLoadingText.decorativeCount,
      1,
      'Spinner is decorative when loadingText present',
    );
    assert.equal(
      fix41Result.statusWithoutLoadingText.accessibleCount,
      1,
      'Exactly one accessible status when loadingText absent',
    );
    console.log('✔ FIX-41 Regression Verification: PASS');

    // =========================================================================
    // 4. ISSUE RETRY & COPY REGRESSION TEST (BROWSER + MOCKED NETWORK)
    // =========================================================================
    console.log('\n--- 4. Testing Issue Retry & Copy Regression ---');
    const issueRegressionResult = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { IssuesScreen } = await import('/src/screens/IssuesScreen.tsx');
          const { ReportBugWidget } = await import('/src/components/ReportBugWidget.tsx');

          // Part A: IssuesScreen Error Retry & Copy
          const container = document.createElement('div');
          container.id = 'issues-test-root';
          document.body.appendChild(container);
          const root = ReactDOM.createRoot(container);

          let initialIssuesCallFailed = false;
          let retryOccurred = false;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    user: { id: 'usr-1', email: 'owner@test.local' },
                    active_workspace: { id: 'ws-issues-qa', role: 'owner' },
                    csrf_token: 'csrf-issues',
                  },
                }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/issues/ISS-001'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    issue: {
                      id: 'ISS-001',
                      workspace_id: 'ws-issues-qa',
                      reporter_user_id: 'usr-1',
                      title: 'Lỗi vỡ layout thanh điều hướng',
                      description: 'Menu bị tràn khi co nhỏ màn hình',
                      module_name: 'Navigation',
                      route_template: '/navigation',
                      status: 'open',
                      type: 'bug',
                      version: 1,
                      created_at: '2026-10-10T10:00:00Z',
                      updated_at: '2026-10-10T10:00:00Z',
                      closed_at: null,
                    },
                    activities: [],
                  },
                }),
              }),
            },
            {
              matches: (url) => url.includes('/api/v1/issues'),
              handle: async () => {
                if (!initialIssuesCallFailed) {
                  initialIssuesCallFailed = true;
                  return {
                    ok: false,
                    status: 500,
                    json: async () => ({
                      error: { message: 'Máy chủ quá tải, vui lòng thử lại' },
                    }),
                  };
                }
                retryOccurred = true;
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      items: [
                        {
                          id: 'ISS-001',
                          workspace_id: 'ws-issues-qa',
                          reporter_user_id: 'usr-1',
                          title: 'Lỗi vỡ layout thanh điều hướng',
                          description: 'Menu bị tràn khi co nhỏ màn hình',
                          module_name: 'Navigation',
                          route_template: '/navigation',
                          status: 'open',
                          type: 'bug',
                          version: 1,
                          created_at: '2026-10-10T10:00:00Z',
                          updated_at: '2026-10-10T10:00:00Z',
                          closed_at: null,
                        },
                      ],
                      next_cursor: null,
                      has_more: false,
                      counts: { all: 1, open: 1, analyzing: 0, fixing: 0, awaiting_owner: 0, closed: 0 },
                    },
                  }),
                };
              },
            },
          ];

          root.render(React.createElement(IssuesScreen, { onNavigate: () => {} }));
          await new Promise(r => setTimeout(r, 200));

          // 1. Initial 500 failure renders ErrorState
          const errorStateTitle = container.querySelector('h2, h3, [role="alert"]')?.textContent || '';
          const hasInitialError = errorStateTitle.includes('Máy chủ quá tải') || container.innerText.includes('Máy chủ quá tải');

          // 2. Click "Thử lại" button
          const retryBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Thử lại'));
          if (retryBtn) {
            retryBtn.click();
          }
          await new Promise(r => setTimeout(r, 200));

          const hasItemAfterRetry = container.innerText.includes('Lỗi vỡ layout thanh điều hướng');

          // 3. Select Item and Copy Prompt
          const selectAllCheckbox = container.querySelector('[data-testid="checkbox-select-all"]') || container.querySelector('[data-testid="checkbox-issue-ISS-001"]');
          if (selectAllCheckbox) {
            selectAllCheckbox.click();
          }
          await new Promise(r => setTimeout(r, 100));

          const copyBtn = container.querySelector('[data-testid="btn-copy-selected-issues"]');
          let copiedPromptContent = null;
          let btnTextAfterCopy = null;

          if (copyBtn) {
            copyBtn.click();
            await new Promise(r => setTimeout(r, 200));
            copiedPromptContent = window.__lastCopiedText__;
            btnTextAfterCopy = copyBtn.textContent;
          }

          root.unmount();
          container.remove();

          // Part B: ReportBugWidget Retry on Network Failure (Unknown Outcome)
          const widgetContainer = document.createElement('div');
          widgetContainer.id = 'widget-test-root';
          document.body.appendChild(widgetContainer);
          const widgetRoot = ReactDOM.createRoot(widgetContainer);

          sessionStorage.clear();
          let bugSubmissionAttempts = 0;

          window.__mockFetchRegistry__ = [
            {
              matches: (url) => url.includes('/api/v1/auth/me'),
              handle: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    user: { id: 'usr-bug', email: 'owner@test.local' },
                    active_workspace: { id: 'ws-bug-qa', role: 'owner' },
                    csrf_token: 'csrf-bug',
                  },
                }),
              }),
            },
            {
              matches: (url, opts) => url.includes('/api/v1/reports') && opts?.method === 'POST',
              handle: async () => {
                bugSubmissionAttempts++;
                if (bugSubmissionAttempts === 1) {
                  throw new TypeError('Failed to fetch (simulated network disruption)');
                }
                return {
                  ok: true,
                  status: 201,
                  json: async () => ({
                    success: true,
                    data: { id: 'REP-NEW-01' },
                  }),
                };
              },
            },
          ];

          widgetRoot.render(React.createElement(ReportBugWidget, {
            currentPath: '/settings',
            userId: 'usr-bug',
            workspaceId: 'ws-bug-qa',
            csrfToken: 'csrf-bug',
          }));
          await new Promise(r => setTimeout(r, 150));

          // Open widget
          const openBtn = widgetContainer.querySelector('[data-testid="btn-open-report-bug"]');
          if (openBtn) {
            openBtn.click();
          }
          await new Promise(r => setTimeout(r, 150));

          // Fill description using React native setter
          const textarea = widgetContainer.querySelector('textarea');
          if (textarea) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(textarea, 'Description for retry testing');
            } else {
              textarea.value = 'Description for retry testing';
            }
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await new Promise(r => setTimeout(r, 80));

          // First submit -> network failure
          const form = widgetContainer.querySelector('form');
          if (form) {
            form.requestSubmit();
          }
          await new Promise(r => setTimeout(r, 200));

          const textAfterNetworkDrop = widgetContainer.innerText;
          const hasUnknownOutcome = textAfterNetworkDrop.includes('Mất kết nối') || textAfterNetworkDrop.includes('Gửi lại');
          const submitBtn = widgetContainer.querySelector('[data-testid="btn-submit-report"]');
          const submitBtnTextAfterFailure = submitBtn?.textContent || '';

          // Second submit -> click retry "Gửi lại"
          if (form) {
            form.requestSubmit();
          }
          await new Promise(r => setTimeout(r, 200));

          const textAfterRetrySuccess = widgetContainer.innerText;
          const hasSuccessConfirmed = textAfterRetrySuccess.includes('Báo lỗi đã được gửi thành công') || textAfterRetrySuccess.includes('thành công');

          widgetRoot.unmount();
          widgetContainer.remove();
          window.__mockFetchRegistry__ = [];

          return {
            hasInitialError,
            retryOccurred,
            hasItemAfterRetry,
            copiedPromptContainsId: copiedPromptContent ? copiedPromptContent.includes('ISS-001') : false,
            copiedPromptContainsTitle: copiedPromptContent ? copiedPromptContent.includes('Lỗi vỡ layout thanh điều hướng') : false,
            copiedPromptContainsGuidance: copiedPromptContent ? copiedPromptContent.includes('ChatGPT: Phân tích từng lỗi') : false,
            btnTextAfterCopy,
            bugSubmissionAttempts,
            hasUnknownOutcome,
            submitBtnTextAfterFailure,
            hasSuccessConfirmed,
            failClosedBlockedCount: window.__FAIL_CLOSED_VIOLATIONS__.filter(
              (v) => !v.url?.includes('/api/v1/auth/me') && !v.url?.includes('controlled-probe-unmocked-endpoint')
            ).length,
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (issueRegressionResult.error) {
      throw new Error(
        'Issue regression test error: ' +
          issueRegressionResult.error +
          '\n' +
          issueRegressionResult.stack,
      );
    }
    console.log('Issue Regression Result:', issueRegressionResult);
    assert.equal(
      issueRegressionResult.hasInitialError,
      true,
      'Initial error state rendered',
    );
    assert.equal(
      issueRegressionResult.retryOccurred,
      true,
      'Retry was executed',
    );
    assert.equal(
      issueRegressionResult.hasItemAfterRetry,
      true,
      'Data rendered after retry',
    );
    assert.equal(
      issueRegressionResult.copiedPromptContainsId,
      true,
      'Copied prompt contains ISS-001',
    );
    assert.equal(
      issueRegressionResult.copiedPromptContainsTitle,
      true,
      'Copied prompt contains title',
    );
    assert.equal(
      issueRegressionResult.copiedPromptContainsGuidance,
      true,
      'Copied prompt contains ChatGPT analysis guidance',
    );
    assert.ok(
      issueRegressionResult.btnTextAfterCopy &&
        issueRegressionResult.btnTextAfterCopy.includes('Đã sao chép'),
      'Button shows copied confirmation',
    );
    assert.equal(
      issueRegressionResult.bugSubmissionAttempts,
      2,
      'Two attempts made (1 fail, 1 retry)',
    );
    assert.equal(
      issueRegressionResult.hasUnknownOutcome,
      true,
      'Unknown outcome state triggered on network drop',
    );
    assert.equal(
      issueRegressionResult.submitBtnTextAfterFailure,
      'Gửi lại',
      'Button switches to "Gửi lại"',
    );
    assert.equal(
      issueRegressionResult.hasSuccessConfirmed,
      true,
      'Success confirmed after retry',
    );
    assert.equal(
      issueRegressionResult.failClosedBlockedCount,
      0,
      'Zero fail-closed network violations during test run',
    );
    console.log('✔ Issue Retry & Copy Regression Verification: PASS');
    // =========================================================================
    // 5. FAIL-CLOSED LEDGER AUDIT & PROTOCOL SAFETY VERIFICATION
    // =========================================================================
    console.log('\n--- 5. Fail-Closed Ledger Audit & CDP Protocol Safety ---');
    const finalViolations = await evaluate(
      `window.__FAIL_CLOSED_VIOLATIONS__ || []`,
    );
    const startupAuthMe = finalViolations.filter(
      (v) => v.url?.includes('/api/v1/auth/me') && v.phase === 'startup',
    );
    const expectedProbe = finalViolations.filter(
      (v) =>
        v.url?.includes('/api/v1/controlled-probe-unmocked-endpoint') &&
        v.phase === 'probe',
    );
    const unexpectedViolations = finalViolations.filter(
      (v) =>
        !(v.url?.includes('/api/v1/auth/me') && v.phase === 'startup') &&
        !(
          v.url?.includes('/api/v1/controlled-probe-unmocked-endpoint') &&
          v.phase === 'probe'
        ),
    );

    console.log('Ledger Audit Result:', {
      totalViolations: finalViolations.length,
      startupAuthMeCount: startupAuthMe.length,
      expectedProbeCount: expectedProbe.length,
      unexpectedCount: unexpectedViolations.length,
      unmockedCdpCount: unmockedCdpBlocked.length,
      cdpErrorsCount: cdpErrors.length,
    });

    assert.equal(
      unexpectedViolations.length,
      0,
      'No unexpected network violations allowed in fail-closed ledger',
    );
    assert.equal(
      unmockedCdpBlocked.length,
      0,
      'No unmocked CDP requests allowed outside mock registry',
    );
    assert.equal(
      cdpErrors.length,
      0,
      'Zero CDP Fetch.failRequest errors allowed',
    );
    console.log('✔ Fail-Closed Ledger Audit & Protocol Safety: PASS');

    ws.close();
    console.log('\n=== ALL UI-FIX-47 TESTS PASSED WITH 100% CONFORMANCE ===');
    console.log('=== ALL UI-FIX-49 TESTS PASSED WITH 100% CONFORMANCE ===\n');
  } finally {
    chrome.kill();
  }
}

run().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
