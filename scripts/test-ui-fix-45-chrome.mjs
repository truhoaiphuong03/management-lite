import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 9247;
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

async function run() {
  console.log('=== STARTING UI-FIX-45 LIVE CHROME MOUNTED TESTS ===');
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-fix-45-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));
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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', {
      patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }],
    });

    // Install pre-navigation fail-closed fetch guard before page scripts load
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__CURRENT_PHASE__ = 'startup';
          window.__FAIL_CLOSED_VIOLATIONS__ = [];
          window.fetch = async (url) => {
            const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
            window.__FAIL_CLOSED_VIOLATIONS__.push({
              url: urlStr,
              phase: window.__CURRENT_PHASE__ || 'startup',
              timestamp: Date.now(),
            });
            throw new Error('FAIL-CLOSED HARNESS: Real network blocked for ' + urlStr);
          };
        })()
      `,
    });

    // Navigate to local dev server ONLY after interception and fail-closed harness are installed
    await send('Page.navigate', { url: targetUrl });
    await new Promise((r) => setTimeout(r, 1200));

    currentCdpPhase = 'test_suite';
    await evaluate(`window.__CURRENT_PHASE__ = 'test_suite'`);

    // ==========================================
    // 1. LOGIN SCREEN FOCUS TESTS
    // ==========================================
    console.log(
      '\n--- 1. Testing LoginScreen Focus on 401, 429, and Network Error ---',
    );
    const loginResults = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { LoginScreen } = await import('/src/screens/LoginScreen.tsx');

          const container = document.createElement('div');
          container.id = 'login-test-root';
          document.body.appendChild(container);
          const root = ReactDOM.createRoot(container);

          const pendingRequests = [];
          window.fetch = (url, opts) => {
            if (typeof url === 'string' && url.includes('/api/v1/auth/login')) {
              return new Promise((resolve, reject) => {
                pendingRequests.push({ url, opts, resolve, reject });
              });
            }
            throw new Error('FAIL-CLOSED: Unmocked fetch blocked for ' + url);
          };

          const waitNextRequest = async () => {
            while (pendingRequests.length === 0) {
              await new Promise(r => setTimeout(r, 10));
            }
            return pendingRequests.shift();
          };

          const onLogin = () => {};
          root.render(React.createElement(LoginScreen, { onLogin }));
          await new Promise(r => setTimeout(r, 100));

          const getPass = () => document.getElementById('password');
          const getId = () => document.getElementById('identifier');
          const getSubmit = () => document.querySelector('button[type="submit"]');

          const setNative = (el, val) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };

          // --- SUB-TEST 1: 401 Unauthorized ---
          setNative(getId(), 'admin_qa');
          setNative(getPass(), 'wrong_pass_401');

          getSubmit().focus();
          const submitFocusedBefore = document.activeElement === getSubmit();
          getSubmit().click();

          const req1 = await waitNextRequest();
          const pendingLoading401 = getSubmit().disabled && getPass().disabled;

          req1.resolve({
            ok: false,
            status: 401,
            json: async () => ({ success: false, error: { message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' } }),
          });
          await new Promise(r => setTimeout(r, 100));

          const res401 = {
            submitFocusedBefore,
            pendingLoading: pendingLoading401,
            idValue: getId().value,
            passValue: getPass().value,
            activeId: document.activeElement?.id,
            passAriaInvalid: getPass().getAttribute('aria-invalid'),
            passAriaDescribedby: getPass().getAttribute('aria-describedby'),
            alertText: document.getElementById('login-error-alert')?.textContent,
          };

          // --- SUB-TEST 2: 429 Rate Limit ---
          setNative(getPass(), 'rate_limit_pass');
          getSubmit().focus();
          getSubmit().click();

          const req2 = await waitNextRequest();
          const pendingLoading429 = getSubmit().disabled && getPass().disabled;

          req2.resolve({
            ok: false,
            status: 429,
            json: async () => ({ success: false, error: { message: 'Quá nhiều lần thử đăng nhập.' } }),
          });
          await new Promise(r => setTimeout(r, 100));

          const res429 = {
            pendingLoading: pendingLoading429,
            idValue: getId().value,
            passValue: getPass().value,
            activeId: document.activeElement?.id,
            alertText: document.getElementById('login-error-alert')?.textContent,
          };

          // --- SUB-TEST 3: Network Error ---
          setNative(getPass(), 'net_error_pass');
          getSubmit().focus();
          getSubmit().click();

          const req3 = await waitNextRequest();
          const pendingLoadingNet = getSubmit().disabled && getPass().disabled;

          req3.reject(new TypeError('Failed to fetch'));
          await new Promise(r => setTimeout(r, 100));

          const resNet = {
            pendingLoading: pendingLoadingNet,
            idValue: getId().value,
            passValue: getPass().value,
            activeId: document.activeElement?.id,
            alertText: document.getElementById('login-error-alert')?.textContent,
          };

          // Clean up
          root.unmount();
          container.remove();

          return { res401, res429, resNet };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (loginResults.error) {
      throw new Error(
        'Login screen test error: ' +
          loginResults.error +
          '\n' +
          loginResults.stack,
      );
    }

    console.log('Login 401 Result:', loginResults.res401);
    assert.equal(loginResults.res401.submitFocusedBefore, true);
    assert.equal(loginResults.res401.pendingLoading, true);
    assert.equal(loginResults.res401.idValue, 'admin_qa');
    assert.equal(loginResults.res401.passValue, '');
    assert.equal(loginResults.res401.activeId, 'password');
    assert.equal(loginResults.res401.passAriaInvalid, 'true');

    console.log('Login 429 Result:', loginResults.res429);
    assert.equal(loginResults.res429.pendingLoading, true);
    assert.equal(loginResults.res429.idValue, 'admin_qa');
    assert.equal(loginResults.res429.passValue, '');
    assert.equal(loginResults.res429.activeId, 'password');

    console.log('Login Network Error Result:', loginResults.resNet);
    assert.equal(loginResults.resNet.pendingLoading, true);
    assert.equal(loginResults.resNet.idValue, 'admin_qa');
    assert.equal(loginResults.resNet.passValue, '');
    assert.equal(loginResults.resNet.activeId, 'password');
    console.log('✔ LoginScreen Focus Verification: ALL 3 SUB-TESTS PASS');

    // ==========================================
    // 2. EMPLOYEES SCREEN MOUNTED RUNTIME TESTS
    // ==========================================
    console.log(
      '\n--- 2. Testing EmployeesScreen Mounted Runtime Paging & Guards ---',
    );
    const employeesResults = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { EmployeesScreen } = await import('/src/screens/EmployeesScreen.tsx');

          const container = document.createElement('div');
          container.id = 'emp-test-root';
          document.body.appendChild(container);
          const root = ReactDOM.createRoot(container);

          const pendingRequests = [];
          window.fetch = (url, opts) => {
            if (typeof url === 'string' && url.includes('/api/v1/auth/me')) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { user: { id: 'usr-1' }, csrf_token: 'csrf-1' } }),
              });
            }
            if (typeof url === 'string' && url.includes('/api/v1/employees')) {
              return new Promise((resolve, reject) => {
                pendingRequests.push({ url, opts, resolve, reject });
              });
            }
            throw new Error('FAIL-CLOSED: Unmocked fetch blocked for ' + url);
          };

          const waitNextRequest = async () => {
            while (pendingRequests.length === 0) {
              await new Promise(r => setTimeout(r, 10));
            }
            return pendingRequests.shift();
          };

          // Mount component
          root.render(React.createElement(EmployeesScreen, { onNavigate: () => {} }));

          // 1. Initial Page 1
          const reqPage1 = await waitNextRequest();
          reqPage1.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-1', employee_code: 'E01', full_name: 'Nguyen Van A', employment_status: 'active' },
                  { id: 'emp-2', employee_code: 'E02', full_name: 'Tran Thi B', employment_status: 'active' },
                ],
                next_cursor: 'cursor-p1',
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          const getEmployeeNames = () => Array.from(document.querySelectorAll('#emp-test-root strong')).map(h => h.textContent.trim());
          const getLoadMoreBtn = () => Array.from(document.querySelectorAll('#emp-test-root button')).find(b => b.textContent.includes('Tải thêm nhân sự'));
          const getFilterTab = (text) => Array.from(document.querySelectorAll('#emp-test-root button')).find(b => b.textContent.includes(text));

          const page1Names = getEmployeeNames();
          const hasLoadMore1 = Boolean(getLoadMoreBtn());

          // 2. Click Load More -> Page 2 with duplicate emp-2
          getLoadMoreBtn().click();
          const reqPage2 = await waitNextRequest();
          reqPage2.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-2', employee_code: 'E02', full_name: 'Tran Thi B', employment_status: 'active' }, // Duplicate
                  { id: 'emp-3', employee_code: 'E03', full_name: 'Le Van C', employment_status: 'active' },
                ],
                next_cursor: null,
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          const page2Names = getEmployeeNames();
          const hasLoadMore2 = Boolean(getLoadMoreBtn());

          // 3. Filter change -> Resets rows and cursor
          getFilterTab('Tạm ngưng').click();
          const reqFilter = await waitNextRequest();
          reqFilter.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-4', employee_code: 'E04', full_name: 'Pham Van D (Suspended)', employment_status: 'suspended' },
                ],
                next_cursor: 'cursor-susp',
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          const filteredNames = getEmployeeNames();
          const hasLoadMoreFiltered = Boolean(getLoadMoreBtn());

          // 4. Stale Response Guard:
          // Currently status is 'suspended'.
          // Request A: click 'Đang hoạt động'
          getFilterTab('Đang hoạt động').click();
          const reqA = await waitNextRequest();

          // Request B: click 'Tất cả'
          getFilterTab('Tất cả').click();
          const reqB = await waitNextRequest();

          // B finishes FIRST
          reqB.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-winner', employee_code: 'E99', full_name: 'Winner Request B', employment_status: 'active' },
                ],
                next_cursor: null,
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));
          const afterBNames = getEmployeeNames();

          // Stale A finishes LATER
          reqA.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-stale', employee_code: 'E00', full_name: 'Stale Request A', employment_status: 'active' },
                ],
                next_cursor: 'stale-cursor',
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));
          const afterStaleANames = getEmployeeNames();

          // 5. Next page error and retry does not lose data
          getFilterTab('Chờ kích hoạt').click();
          const reqInitialRetry = await waitNextRequest();
          reqInitialRetry.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-base-1', employee_code: 'EB1', full_name: 'Base 1', employment_status: 'invited' },
                ],
                next_cursor: 'cursor-retry-test',
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));
          const baseNames = getEmployeeNames();
          const loadMoreBeforeRetry = getLoadMoreBtn();
          if (!loadMoreBeforeRetry) {
            const allButtons = Array.from(document.querySelectorAll('#emp-test-root button')).map(b => b.textContent);
            const rootText = document.getElementById('emp-test-root')?.innerText;
            return { error: 'getLoadMoreBtn is null. Buttons: ' + JSON.stringify(allButtons) + '. Text: ' + rootText };
          }
          loadMoreBeforeRetry.click();
          const reqLoadMoreFail = await waitNextRequest();
          reqLoadMoreFail.resolve({
            ok: false,
            status: 500,
            json: async () => ({
              success: false,
              error: { message: 'Lỗi máy chủ tải thêm' },
            }),
          });
          await new Promise(r => setTimeout(r, 100));

          const namesAfterError = getEmployeeNames();
          const errorMessageDisplayed = document.querySelector('#emp-test-root [role="alert"]')?.textContent;

          // Retry load more -> succeeds
          getLoadMoreBtn().click();
          const reqLoadMoreSuccess = await waitNextRequest();
          reqLoadMoreSuccess.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  { id: 'emp-base-2', employee_code: 'EB2', full_name: 'Base 2', employment_status: 'invited' },
                ],
                next_cursor: null,
              },
            }),
          });
          await new Promise(r => setTimeout(r, 100));
          const namesAfterRetry = getEmployeeNames();

          // 6. Unmount during in-flight fetch
          getFilterTab('Tất cả').click();
          const reqLingering = await waitNextRequest();

          root.unmount();
          container.remove();

          const signalAbortedOnUnmount = Boolean(reqLingering.opts?.signal?.aborted);

          let unmountError = null;
          try {
            reqLingering.resolve({
              ok: true,
              status: 200,
              json: async () => ({ success: true, data: { items: [] } }),
            });
          } catch (e) {
            unmountError = e.message;
          }

          return {
            page1Names,
            hasLoadMore1,
            page2Names,
            hasLoadMore2,
            filteredNames,
            hasLoadMoreFiltered,
            afterBNames,
            afterStaleANames,
            baseNames,
            namesAfterError,
            errorMessageDisplayed,
            namesAfterRetry,
            signalAbortedOnUnmount,
            unmountError,
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (employeesResults.error) {
      throw new Error(
        'Employees screen test error: ' +
          employeesResults.error +
          '\n' +
          employeesResults.stack,
      );
    }

    console.log('Employees Page 1 Names:', employeesResults.page1Names);
    assert.deepEqual(employeesResults.page1Names, [
      'Nguyen Van A',
      'Tran Thi B',
    ]);
    assert.equal(employeesResults.hasLoadMore1, true);

    console.log(
      'Employees Page 2 Names (Deduplicated):',
      employeesResults.page2Names,
    );
    assert.deepEqual(employeesResults.page2Names, [
      'Nguyen Van A',
      'Tran Thi B',
      'Le Van C',
    ]);
    assert.equal(employeesResults.hasLoadMore2, false);

    console.log('Employees Filtered Names:', employeesResults.filteredNames);
    assert.deepEqual(employeesResults.filteredNames, [
      'Pham Van D (Suspended)',
    ]);
    assert.equal(employeesResults.hasLoadMoreFiltered, true);

    console.log('Employees Stale Guard Result:');
    console.log(' - After Request B:', employeesResults.afterBNames);
    console.log(
      ' - After Stale Request A resolved:',
      employeesResults.afterStaleANames,
    );
    assert.deepEqual(employeesResults.afterBNames, ['Winner Request B']);
    assert.deepEqual(
      employeesResults.afterStaleANames,
      ['Winner Request B'],
      'Stale Request A must NOT overwrite Request B',
    );

    console.log('Employees Error Retry Result:');
    assert.deepEqual(employeesResults.baseNames, ['Base 1']);
    assert.deepEqual(
      employeesResults.namesAfterError,
      ['Base 1'],
      'Page 1 data must be retained on next page failure',
    );
    assert.deepEqual(
      employeesResults.namesAfterRetry,
      ['Base 1', 'Base 2'],
      'Data appends correctly on retry',
    );
    assert.equal(
      employeesResults.signalAbortedOnUnmount,
      true,
      'Signal must be aborted upon unmount cleanup',
    );
    assert.equal(employeesResults.unmountError, null);
    console.log(
      '✔ EmployeesScreen Mounted Runtime Verification: ALL 6 CHECKS PASS',
    );

    // ==========================================
    // 3. REPORTS SCREEN STALE JSON GUARD TESTS
    // ==========================================
    console.log('\n--- 3. Testing ReportsScreen Mounted Stale JSON Guard ---');
    const reportsResults = await evaluate(`
      (async () => {
        try {
          const React = (await import('/node_modules/.vite/deps/react.js')).default;
          const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
          const { ReportsScreen } = await import('/src/screens/ReportsScreen.tsx');


          const container = document.createElement('div');
          container.id = 'rep-test-root';
          document.body.appendChild(container);
          const root = ReactDOM.createRoot(container);

          let isMounted = false;
          const pendingRequests = [];
          const originalFetch = window.fetch;
          window.fetch = (url, opts) => {
            if (typeof url === 'string' && url.includes('/api/v1/auth/me')) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    active_workspace: { id: 'ws-owner', role: 'owner' },
                    csrf_token: 'csrf-rep',
                  },
                }),
              });
            }
            if (typeof url === 'string' && url.includes('/api/v1/employees')) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { items: [] } }),
              });
            }
            if (typeof url === 'string' && url.includes('/api/v1/reports/me')) {
              return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { items: [] } }),
              });
            }
            if (typeof url === 'string' && url.includes('/api/v1/reports/daily')) {
              if (!isMounted) {
                return Promise.resolve({
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      items: [
                        {
                          id: 'rep-init',
                          report_date: '2026-10-01',
                          status: 'draft',
                          employee_name: 'Nhân viên 1',
                          employee_id: 'emp-1',
                          entries: [],
                        },
                      ],
                      next_cursor: null,
                    },
                  }),
                });
              }
              return new Promise((resolve, reject) => {
                pendingRequests.push({ url, opts, resolve, reject });
              });
            }
            throw new Error('FAIL-CLOSED: Unmocked fetch blocked for ' + url);
          };

          const waitNextDailyRequest = async () => {
            while (pendingRequests.length === 0) {
              await new Promise(r => setTimeout(r, 10));
            }
            return pendingRequests.shift();
          };

          // Mount ReportsScreen as Owner
          root.render(React.createElement(ReportsScreen, { role: 'owner' }));
          await new Promise(r => setTimeout(r, 200));
          isMounted = true;

          const getReportCards = () => document.getElementById('rep-test-root')?.innerText || '';

          // 2. Trigger Filter Change A (Request A)
          let statusSelect = null;
          for (let i = 0; i < 40; i++) {
            statusSelect = document.querySelectorAll('#rep-test-root select')[1] || document.querySelector('#rep-test-root select');
            if (statusSelect) break;
            await new Promise(r => setTimeout(r, 50));
          }
          if (!statusSelect) throw new Error('Status select element not found in DOM');
          statusSelect.value = 'draft';
          statusSelect.dispatchEvent(new Event('change', { bubbles: true }));

          const reqA = await waitNextDailyRequest();

          // 3. Request A receives HEADERS immediately, but its JSON is DELAYED
          let resolveDelayedJsonA;
          const delayedJsonPromise = new Promise((res) => {
            resolveDelayedJsonA = () => res({
              success: true,
              data: {
                items: [
                  {
                    id: 'rep-stale-A',
                    report_date: '2026-10-02',
                    status: 'draft',
                    employee_name: 'Stale Report A',
                    employee_id: 'emp-1',
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
            json: () => delayedJsonPromise,
          });
          await new Promise(r => setTimeout(r, 30));

          // 4. Trigger Filter Change B while A is waiting for res.json()
          statusSelect.value = 'submitted';
          statusSelect.dispatchEvent(new Event('change', { bubbles: true }));

          const reqB = await waitNextDailyRequest();

          // 5. Request B returns headers AND finishes JSON immediately
          reqB.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  {
                    id: 'rep-winner-B',
                    report_date: '2026-10-03',
                    status: 'submitted',
                    employee_name: 'Winner Report B',
                    employee_id: 'emp-2',
                    entries: [],
                  },
                ],
                next_cursor: 'cursor-winner-B',
              },
            }),
          });
          await new Promise(r => setTimeout(r, 150));

          const contentAfterB = getReportCards();
          const hasWinnerB = contentAfterB.includes('Winner Report B') || contentAfterB.includes('2026-10-03');
          const hasStaleABeforeResolve = contentAfterB.includes('Stale Report A');

          // 6. Request A delayed JSON resolves now!
          resolveDelayedJsonA();
          await new Promise(r => setTimeout(r, 150));

          const contentAfterDelayedA = getReportCards();
          const hasWinnerBAfterA = contentAfterDelayedA.includes('Winner Report B') || contentAfterDelayedA.includes('2026-10-03');
          const hasStaleAAfterResolve = contentAfterDelayedA.includes('Stale Report A') || contentAfterDelayedA.includes('2026-10-02');

          const loadMoreBtn = Array.from(document.querySelectorAll('#rep-test-root button')).find(b => b.textContent.includes('Tải thêm báo cáo'));

          root.unmount();
          container.remove();

          return {
            hasWinnerB,
            hasStaleABeforeResolve,
            hasWinnerBAfterA,
            hasStaleAAfterResolve,
            hasLoadMoreBtn: Boolean(loadMoreBtn),
          };
        } catch (e) {
          return { error: e.message, stack: e.stack };
        }
      })()
    `);

    if (reportsResults.error) {
      throw new Error(
        'Reports screen test error: ' +
          reportsResults.error +
          '\n' +
          reportsResults.stack,
      );
    }

    console.log('Reports Stale JSON Guard Result:', reportsResults);
    assert.equal(reportsResults.hasWinnerB, true, 'Request B must be rendered');
    assert.equal(reportsResults.hasStaleABeforeResolve, false);
    assert.equal(
      reportsResults.hasWinnerBAfterA,
      true,
      'Request B content must remain after Request A JSON resolves',
    );
    assert.equal(
      reportsResults.hasStaleAAfterResolve,
      false,
      'Stale Request A must NEVER overwrite Request B',
    );
    assert.equal(
      reportsResults.hasLoadMoreBtn,
      true,
      'Load more button is rendered for Request B cursor',
    );
    console.log('✔ ReportsScreen Stale JSON Guard Verification: PASS');

    // =========================================================================
    // FAIL-CLOSED LEDGER AUDIT & PROTOCOL SAFETY VERIFICATION
    // =========================================================================
    console.log('\n--- Fail-Closed Ledger Audit & CDP Protocol Safety ---');
    const finalViolations = await evaluate(
      `window.__FAIL_CLOSED_VIOLATIONS__ || []`,
    );
    const startupAuthMe = finalViolations.filter(
      (v) =>
        (typeof v === 'string' ? v : v?.url)?.includes('/api/v1/auth/me') &&
        v?.phase === 'startup',
    );
    const unexpectedViolations = finalViolations.filter(
      (v) =>
        !(
          (typeof v === 'string' ? v : v?.url)?.includes('/api/v1/auth/me') &&
          v?.phase === 'startup'
        ),
    );

    console.log('Ledger Audit Result (FIX-45):', {
      totalViolations: finalViolations.length,
      startupAuthMeCount: startupAuthMe.length,
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
    console.log('\n=== ALL MOUNTED COMPONENT TESTS PASSED PERFECTLY ===\n');
  } finally {
    chrome.kill();
  }
}

run().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
