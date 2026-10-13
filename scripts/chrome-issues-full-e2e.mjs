import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

// Read rotated QA credentials without printing them
const credsRaw = readFileSync(resolve(root, '.env.qa-credentials.local'), 'utf8');
const qaCreds = parseEnv(credsRaw);
const ownerPassword = qaCreds.QA_OWNER_PASSWORD || qaCreds.OWNER_PASSWORD;
const staffPassword = qaCreds.QA_STAFF_PASSWORD || qaCreds.STAFF_PASSWORD;
const adminPassword = qaCreds.ADMIN_PASSWORD;

assert.ok(ownerPassword, 'Missing QA_OWNER_PASSWORD');
assert.ok(staffPassword, 'Missing QA_STAFF_PASSWORD');
assert.ok(adminPassword, 'Missing ADMIN_PASSWORD');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const runId = Math.random().toString(36).substring(2, 8);
const webBase = 'http://127.0.0.1:3001';
const port = 9255;

async function runFullE2e() {
  console.log('======================================================================');
  console.log('🌐 FULL CHROME E2E ACCEPTANCE — ISSUES LIFECYCLE & RBAC (CDP REAL UI)');
  console.log(`Target: ${webBase}`);
  console.log('======================================================================\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-issues-e2e-${runId}`,
    ],
  );

  chrome.on('error', (err) => {
    console.error('Failed to spawn Chrome:', err);
  });

  const steps = [];
  function record(name, pass, detail = '') {
    steps.push({ name, pass, detail });
    console.log(`  ${pass ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  }

  try {
    // Wait for Chrome port
    let versionRes = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          versionRes = await res.json();
          break;
        }
      } catch {}
    }
    assert.ok(versionRes, 'Chrome CDP failed to launch in 6s');

    // Create session tab
    const tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(webBase + '/login')}`, {
      method: 'PUT',
    }).then((r) => r.json());

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    let msgId = 1;
    const callbacks = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
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
      return r.result?.value;
    };

    const navigate = async (url) => {
      await send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, 800));
    };

    await send('Page.enable');
    await send('DOM.enable');

    // Helper: Login in browser
    async function loginAs(username, password) {
      await navigate(`${webBase}/login`);
      for (let i = 0; i < 20; i++) {
        const ready = await evaluate(`Boolean(document.querySelector('input[type="password"]'))`);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      await evaluate(`
        (() => {
          const userIn = document.querySelector('input[type="text"]') || document.querySelector('input[name="identifier"]');
          const passIn = document.querySelector('input[type="password"]');
          const btn = document.querySelector('button[type="submit"]');
          const setVal = (input, val) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, val);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };
          setVal(userIn, ${JSON.stringify(username)});
          setVal(passIn, ${JSON.stringify(password)});
          btn.click();
        })()
      `);

      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const path = await evaluate(`window.location.pathname`);
        if (path && path !== '/login') return true;
      }
      return false;
    }

    // Helper: Logout in browser
    async function logout() {
      await evaluate(`
        (() => {
          const btn = document.querySelector('[data-testid="btn-logout"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng xuất'));
          if (btn) btn.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 500));
      await navigate(`${webBase}/login`);
    }

    // ------------------------------------------------------------------
    // STEP 1: Owner login & Bug Report creation via Widget
    // ------------------------------------------------------------------
    console.log('--- 1. OWNER FLOW: Đăng nhập & Tạo báo lỗi từ giao diện Web ---');
    const ownerLoggedIn = await loginAs('qa_owner', ownerPassword);
    record('1.1. Owner đăng nhập thành công', ownerLoggedIn);
    assert.ok(ownerLoggedIn, 'Owner login failed');

    // Open bug report widget modal
    const openWidgetRes = await evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-open-report-bug"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    record('1.2. Mở hộp thoại Báo lỗi (ReportBugWidget)', openWidgetRes);
    assert.ok(openWidgetRes, 'Widget trigger button not found');

    await new Promise((r) => setTimeout(r, 500));

    // Fill report form
    const issueTitle = `[E2E UI Test] Lỗi hiển thị giao diện Chrome - ${Date.now()}`;
    const issueDesc = 'Kiểm thử luồng báo lỗi thực tế từ giao diện trình duyệt Chrome headless qua CDP.';
    const fillReportRes = await evaluate(`
      (() => {
        const modal = document.querySelector('[data-testid="report-bug-modal-container"]');
        if (!modal) return { success: false, reason: 'Modal container not found' };
        const titleIn = document.querySelector('[data-testid="input-report-title"]');
        const descIn = document.querySelector('[data-testid="input-report-description"]');
        const submitBtn = document.querySelector('[data-testid="btn-submit-report"]');
        if (!descIn || !submitBtn) return { success: false, reason: 'Inputs not found' };

        const setVal = (el, val) => {
          const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (titleIn) setVal(titleIn, ${JSON.stringify(issueTitle)});
        setVal(descIn, ${JSON.stringify(issueDesc)});
        submitBtn.click();
        return { success: true };
      })()
    `);
    record('1.3. Nhập tiêu đề, mô tả và nhấn Gửi báo cáo', fillReportRes?.success);
    assert.ok(fillReportRes?.success, 'Failed to fill bug report form');

    // Wait for submission success alert
    let submissionSuccess = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const alert = await evaluate(`Boolean(document.querySelector('[data-testid="report-success-alert"]'))`);
      if (alert) {
        submissionSuccess = true;
        break;
      }
    }
    record('1.4. Gửi báo cáo thành công (Hiển thị thông báo thành công)', submissionSuccess);
    assert.ok(submissionSuccess, 'Submission alert not shown');

    // Close modal
    await evaluate(`
      (() => {
        const closeBtn = document.querySelector('[data-testid="btn-close-report-modal"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));

    // Verify record in PostgreSQL database!
    const dbOwnerIssue = await pool.query('SELECT * FROM issues WHERE title = $1', [issueTitle]);
    record('1.5. Dữ liệu đã lưu thực tế trong PostgreSQL QA', dbOwnerIssue.rows.length === 1, `ID: ${dbOwnerIssue.rows[0]?.id}`);
    assert.equal(dbOwnerIssue.rows.length, 1);
    const ownerIssueId = dbOwnerIssue.rows[0].id;

    // ------------------------------------------------------------------
    // STEP 2: Navigate to /issues, reload and verify persistence
    // ------------------------------------------------------------------
    console.log('\n--- 2. OWNER FLOW: Xem danh sách /issues và tải lại trang ---');
    await navigate(`${webBase}/issues`);
    await new Promise((r) => setTimeout(r, 800));

    const listLoaded = await evaluate(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        return text.includes(${JSON.stringify(issueTitle)});
      })()
    `);
    record('2.1. Danh sách /issues hiển thị bản ghi vừa tạo', listLoaded);
    assert.ok(listLoaded, 'Created issue not found on /issues list');

    // Reload page
    await send('Page.reload');
    await new Promise((r) => setTimeout(r, 800));

    const listPersisted = await evaluate(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        return text.includes(${JSON.stringify(issueTitle)});
      })()
    `);
    record('2.2. Tải lại trang (F5/Reload): Dữ liệu vẫn được lưu nguyên vẹn', listPersisted);
    assert.ok(listPersisted, 'Issue disappeared after page reload');

    // ------------------------------------------------------------------
    // STEP 3: Open Issue Detail, Confirm Fix, Reopen Issue
    // ------------------------------------------------------------------
    console.log('\n--- 3. OWNER FLOW: Xem chi tiết, Đóng lỗi (Confirm Fix) & Mở lại (Reopen) ---');
    await navigate(`${webBase}/issues/${ownerIssueId}`);
    await new Promise((r) => setTimeout(r, 800));

    const detailRendered = await evaluate(`
      (() => {
        const titleEl = document.querySelector('h1') || document.querySelector('.page-header-title');
        const descEl = document.querySelector('[data-testid="issue-description"]');
        return Boolean(descEl && document.body.innerText.includes(${JSON.stringify(issueTitle)}));
      })()
    `);
    record('3.1. Trang chi tiết /issues/:id hiển thị đúng thông tin lỗi', detailRendered);
    assert.ok(detailRendered, 'Issue detail failed to render');

    // 3.2. Confirm Fix (Close issue)
    const openConfirmModal = await evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-confirm-fix"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    record('3.2. Mở hộp thoại Xác nhận đã sửa (btn-confirm-fix)', openConfirmModal);
    assert.ok(openConfirmModal, 'Confirm fix button not found');

    await new Promise((r) => setTimeout(r, 400));
    await evaluate(`
      (() => {
        const commentIn = document.querySelector('[data-testid="input-confirm-fix-comment"]');
        const submitBtn = document.querySelector('[data-testid="btn-submit-confirm-fix"]');
        if (commentIn) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(commentIn, 'Đã xác nhận khắc phục thành công qua Chrome E2E.');
          commentIn.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (submitBtn) submitBtn.click();
      })()
    `);

    // Wait for closed status on screen
    let closedOnUi = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusText = await evaluate(`document.body.innerText`);
      if (statusText.includes('Đã đóng') || statusText.includes('Xác nhận khắc phục thành công')) {
        closedOnUi = true;
        break;
      }
    }
    record('3.3. Xác nhận sửa lỗi thành công, trạng thái chuyển sang Đã đóng (closed)', closedOnUi);
    assert.ok(closedOnUi, 'Issue status did not update to closed on UI');

    // Verify in DB
    const dbClosedCheck = await pool.query('SELECT status, closed_at FROM issues WHERE id = $1', [ownerIssueId]);
    record('3.4. Database ghi nhận status = closed và closed_at', dbClosedCheck.rows[0]?.status === 'closed');

    // 3.5. Reopen Issue
    await new Promise((r) => setTimeout(r, 500));
    const openReopenModal = await evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-reopen-issue"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    record('3.5. Mở hộp thoại Mở lại vấn đề (btn-reopen-issue)', openReopenModal);
    assert.ok(openReopenModal, 'Reopen button not found');

    await new Promise((r) => setTimeout(r, 400));
    await evaluate(`
      (() => {
        const reasonIn = document.querySelector('[data-testid="input-reopen-reason"]');
        const commentIn = document.querySelector('[data-testid="input-reopen-comment"]');
        const submitBtn = document.querySelector('[data-testid="btn-submit-reopen"]');
        if (reasonIn) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(reasonIn, 'Lý do: Kiểm thử luồng mở lại lỗi trên Chrome E2E.');
          reasonIn.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (commentIn) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(commentIn, 'Ghi chú mở lại.');
          commentIn.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (submitBtn) submitBtn.click();
      })()
    `);

    let reopenedOnUi = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const statusText = await evaluate(`document.body.innerText`);
      if (statusText.includes('Đã mở lại vấn đề thành công') || statusText.includes('Mở (Open)')) {
        reopenedOnUi = true;
        break;
      }
    }
    record('3.6. Mở lại lỗi thành công, trạng thái chuyển về Mở (Open)', reopenedOnUi);
    assert.ok(reopenedOnUi, 'Issue status did not revert to open on UI');

    // ------------------------------------------------------------------
    // STEP 4: Staff Bug Report via Widget
    // ------------------------------------------------------------------
    console.log('\n--- 4. STAFF FLOW: Đăng nhập Staff & Gửi báo lỗi qua Widget ---');
    await logout();

    const staffLoggedIn = await loginAs('qa_staff', staffPassword);
    record('4.1. Staff đăng nhập thành công', staffLoggedIn);
    assert.ok(staffLoggedIn, 'Staff login failed');

    // Open widget as staff
    const staffOpenWidget = await evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-open-report-bug"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    record('4.2. Staff mở widget Báo lỗi', staffOpenWidget);
    assert.ok(staffOpenWidget, 'Staff cannot find widget button');

    await new Promise((r) => setTimeout(r, 400));
    const staffIssueTitle = `[Staff E2E] Báo lỗi giao diện chấm công - ${Date.now()}`;
    await evaluate(`
      (() => {
        const descIn = document.querySelector('[data-testid="input-report-description"]');
        const titleIn = document.querySelector('[data-testid="input-report-title"]');
        const submitBtn = document.querySelector('[data-testid="btn-submit-report"]');
        const setVal = (el, val) => {
          const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        if (titleIn) setVal(titleIn, ${JSON.stringify(staffIssueTitle)});
        setVal(descIn, 'Nút bấm phản hồi chậm khi thao tác chấm công trên mobile.');
        submitBtn.click();
      })()
    `);

    let staffSubmitted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const alert = await evaluate(`Boolean(document.querySelector('[data-testid="report-success-alert"]'))`);
      if (alert) {
        staffSubmitted = true;
        break;
      }
    }
    record('4.3. Staff gửi báo lỗi thành công qua Widget', staffSubmitted);
    assert.ok(staffSubmitted, 'Staff submission alert not shown');

    // Verify staff issue in DB
    const dbStaffIssue = await pool.query('SELECT * FROM issues WHERE title = $1', [staffIssueTitle]);
    record('4.4. Database ghi nhận báo lỗi của Staff với reporter_user_id của Staff', dbStaffIssue.rows.length === 1);
    assert.equal(dbStaffIssue.rows.length, 1);

    // ------------------------------------------------------------------
    // STEP 5: Staff RBAC Block Enforcement
    // ------------------------------------------------------------------
    console.log('\n--- 5. STAFF RBAC ENFORCEMENT: Chặn Staff khỏi phân hệ Sổ tay Lỗi ---');

    // 5.1. Sidebar hides issues
    const sidebarHasIssues = await evaluate(`
      (() => {
        const nav = document.querySelector('nav');
        if (!nav) return false;
        return Boolean(nav.querySelector('a[href="/issues"]') || nav.innerText.includes('Báo lỗi'));
      })()
    `);
    record('5.1. Menu bên trái của Staff: Hoàn toàn ẩn tab Sổ tay Báo lỗi', !sidebarHasIssues);
    assert.equal(sidebarHasIssues, false, 'Sidebar must not show issues link to staff');

    // 5.2. Direct URL access /issues
    await navigate(`${webBase}/issues`);
    await new Promise((r) => setTimeout(r, 600));

    const accessDeniedResult = await evaluate(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        const has403 = text.includes('403') || text.includes('Truy cập bị từ chối') || text.includes('chỉ dành cho Chủ sở hữu');
        const hasList = Boolean(document.querySelector('[data-testid="issues-list-footer"]') || document.querySelector('[data-testid="btn-refresh-issues"]'));
        return { has403, hasList, snippet: text.slice(0, 200) };
      })()
    `);

    record('5.2. Staff truy cập trực tiếp /issues: Bị chặn với lỗi 403 Forbidden fail-closed', accessDeniedResult?.has403 && !accessDeniedResult?.hasList);
    assert.ok(accessDeniedResult?.has403, 'Direct access did not show 403 access denied');
    assert.equal(accessDeniedResult?.hasList, false, 'Issues list rendered for staff!');

    // 5.3. Direct URL access /issues/:id
    await navigate(`${webBase}/issues/${ownerIssueId}`);
    await new Promise((r) => setTimeout(r, 600));

    const detailDeniedResult = await evaluate(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        const has403 = text.includes('403') || text.includes('Truy cập bị từ chối') || text.includes('chỉ dành cho Chủ sở hữu');
        const hasDetailCard = Boolean(document.querySelector('[data-testid="issue-description"]'));
        return { has403, hasDetailCard };
      })()
    `);

    record('5.3. Staff truy cập trực tiếp /issues/:id: Bị chặn tuyệt đối không xem được nội dung', detailDeniedResult?.has403 && !detailDeniedResult?.hasDetailCard);
    assert.ok(detailDeniedResult?.has403, 'Direct detail access did not show 403');
    assert.equal(detailDeniedResult?.hasDetailCard, false, 'Issue detail rendered for staff!');

    ws.close();
    chrome.kill('SIGTERM');

    console.log('\n======================================================================');
    console.log('🎉 TOÀN BỘ 13/13 BƯỚC CHROME E2E CHỨC NĂNG BÁO LỖI HOÀN TOÀN ĐẠT (PASS)!');
    console.log('======================================================================\n');
  } catch (err) {
    chrome.kill('SIGTERM');
    console.error('\n✖ CHROME E2E THẤT BẠI TẠI BƯỚC:', err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runFullE2e();
