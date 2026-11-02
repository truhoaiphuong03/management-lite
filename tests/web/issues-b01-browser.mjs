import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';

import { getAcceptanceOwnerCredentials } from '../../scripts/qa-credentials-reader.mjs';

const ownerCreds = getAcceptanceOwnerCredentials();
const adminPass = ownerCreds.password;

async function main() {
  console.log('=== ISSUES-B01 LIVE BROWSER VERIFICATION ===');
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9444',
      '--disable-gpu',
      '--no-sandbox',
    ],
  );

  await new Promise((r) => setTimeout(r, 1200));

  const list = await new Promise((resolve, reject) => {
    http
      .get('http://127.0.0.1:9444/json/list', (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      })
      .on('error', reject);
  });

  const pageTab = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
  let id = 1;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const curId = id++;
      const handler = (evt) => {
        const resp = JSON.parse(evt.data);
        if (resp.id === curId) {
          ws.removeEventListener('message', handler);
          resolve(resp.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Page.enable');
  await send('Runtime.enable');

  try {
    // 1. Navigate to /issues
    console.log('1. Navigating to http://127.0.0.1:3017/issues...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3017/issues' });
    await new Promise((r) => setTimeout(r, 1500));

    // If at login page, log in
    let bodyText = (
      await send('Runtime.evaluate', { expression: 'document.body.innerText' })
    ).result.value;
    if (bodyText.includes('Đăng nhập') || bodyText.includes('Tên đăng nhập')) {
      console.log('Logging in as admin...');
      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const setVal = (el, val) => {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
              setter.call(el, val);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            };
            const inputs = Array.from(document.querySelectorAll("input"));
            setVal(inputs[0], "admin");
            setVal(inputs[1], ${JSON.stringify(adminPass)});
            const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Đăng nhập"));
            if (btn) btn.click();
          })()
        `,
      });
      await new Promise((r) => setTimeout(r, 2000));
      // Navigate to /issues if not redirected
      await send('Page.navigate', { url: 'http://127.0.0.1:3017/issues' });
      await new Promise((r) => setTimeout(r, 2000));
    }

    bodyText = (
      await send('Runtime.evaluate', { expression: 'document.body.innerText' })
    ).result.value;
    console.log(
      'Page header check: Sổ tay Vấn đề & Lỗi (Issues) present:',
      bodyText.includes('Sổ tay Vấn đề & Lỗi'),
    );
    assert.ok(
      bodyText.includes('Sổ tay Vấn đề & Lỗi'),
      'Must render Issues page header',
    );

    // 2. Verify 4 Group Tabs and workspace-wide counts
    console.log('2. Verifying 4 Group Tabs and workspace counts...');
    const tabsInfo = (
      await send('Runtime.evaluate', {
        expression: `
          Array.from(document.querySelectorAll("button[data-testid^='tab-status-']")).map(b => ({
            testId: b.getAttribute("data-testid"),
            text: b.innerText.replace(/\\n/g, ' ')
          }))
        `,
        returnByValue: true,
      })
    ).result.value;

    console.log('Detected tabs:', tabsInfo);
    assert.ok(
      tabsInfo.some(
        (t) => t.testId === 'tab-status-all' && t.text.includes('Tất cả'),
      ),
      'Must have Tất cả tab',
    );
    assert.ok(
      tabsInfo.some(
        (t) => t.testId === 'tab-status-open' && t.text.includes('Mới'),
      ),
      'Must have Mới tab',
    );
    assert.ok(
      tabsInfo.some(
        (t) =>
          t.testId === 'tab-status-in_progress' && t.text.includes('Đang sửa'),
      ),
      'Must have Đang sửa tab',
    );
    assert.ok(
      tabsInfo.some(
        (t) =>
          t.testId === 'tab-status-awaiting_owner' && t.text.includes('Đã sửa'),
      ),
      'Must have Đã sửa tab',
    );
    assert.ok(
      tabsInfo.some(
        (t) => t.testId === 'tab-status-closed' && t.text.includes('Đã đóng'),
      ),
      'Must have Đã đóng tab',
    );

    // 3. Click "Đã sửa" tab (awaiting_owner)
    console.log('3. Clicking "Đã sửa" tab...');
    await send('Runtime.evaluate', {
      expression: `document.querySelector("button[data-testid='tab-status-awaiting_owner']").click()`,
    });
    await new Promise((r) => setTimeout(r, 1000));

    const awaitingListInfo = (
      await send('Runtime.evaluate', {
        expression: `
          Array.from(document.querySelectorAll("div[data-testid^='issue-item-']")).map(el => el.getAttribute("data-testid").replace("issue-item-", ""))
        `,
        returnByValue: true,
      })
    ).result.value;
    console.log('Awaiting owner issues in list:', awaitingListInfo);
    assert.ok(awaitingListInfo.length > 0, 'Must show awaiting_owner issues');
    const issueAId = awaitingListInfo[0];

    // 4. Select Issue A via checkbox (without navigating)
    console.log(`4. Clicking checkbox for Issue A (${issueAId})...`);
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const cb = document.querySelector("input[data-testid='checkbox-issue-${issueAId}']");
          if (cb) cb.click();
        })()
      `,
    });
    await new Promise((r) => setTimeout(r, 500));

    let selCountText = (
      await send('Runtime.evaluate', {
        expression: `document.body.innerText.includes("Đã chọn: 1 lỗi")`,
      })
    ).result.value;
    console.log('Selected count text contains "Đã chọn: 1 lỗi":', selCountText);
    assert.ok(selCountText, 'Must reflect 1 selected issue');

    // Verify current URL is still /issues (checkbox did NOT navigate!)
    const curUrl = (
      await send('Runtime.evaluate', { expression: 'window.location.pathname' })
    ).result.value;
    console.log('Current URL after checkbox click:', curUrl);
    assert.equal(
      curUrl,
      '/issues',
      'Checkbox click MUST NOT trigger route navigation',
    );

    // 5. Switch to "Mới" tab (open) and select another issue
    console.log('5. Switching to "Mới" tab...');
    await send('Runtime.evaluate', {
      expression: `document.querySelector("button[data-testid='tab-status-open']").click()`,
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Selection from previous tab must be preserved!
    selCountText = (
      await send('Runtime.evaluate', {
        expression: `document.body.innerText.includes("Đã chọn: 1 lỗi")`,
      })
    ).result.value;
    console.log('Selection preserved across tab switch:', selCountText);
    assert.ok(selCountText, 'Selection must persist across tabs');

    const openListInfo = (
      await send('Runtime.evaluate', {
        expression: `
          Array.from(document.querySelectorAll("div[data-testid^='issue-item-']")).map(el => el.getAttribute("data-testid").replace("issue-item-", ""))
        `,
        returnByValue: true,
      })
    ).result.value;
    const issueBId =
      openListInfo.find((id) => id !== issueAId) || openListInfo[0];
    console.log(`Selecting Issue B (${issueBId})...`);
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const cb = document.querySelector("input[data-testid='checkbox-issue-${issueBId}']");
          if (cb) cb.click();
        })()
      `,
    });
    await new Promise((r) => setTimeout(r, 500));

    selCountText = (
      await send('Runtime.evaluate', {
        expression: `document.body.innerText.includes("Đã chọn: 2 lỗi")`,
      })
    ).result.value;
    console.log('Selected count is now 2:', selCountText);
    assert.ok(
      selCountText,
      'Must reflect 2 selected issues across different groups',
    );

    // 6. Hook clipboard write to capture copied text
    console.log(
      '6. Clicking "Sao chép 2 lỗi đã chọn" and capturing clipboard content...',
    );
    await send('Runtime.evaluate', {
      expression: `
        window.__capturedCopiedText = null;
        navigator.clipboard.writeText = async (text) => {
          window.__capturedCopiedText = text;
        };
        // Click bulk copy button
        const btn = document.querySelector("button[data-testid='btn-copy-selected-issues']");
        if (btn) btn.click();
      `,
    });
    await new Promise((r) => setTimeout(r, 1500));

    const copiedText = (
      await send('Runtime.evaluate', {
        expression: `window.__capturedCopiedText`,
      })
    ).result.value;

    console.log('\n--- VERIFYING COPIED CONTENT ---');
    console.log('Copied text length:', copiedText?.length);
    assert.ok(copiedText, 'Copied prompt text must not be empty');

    // Detailed assertions on copied content
    assert.ok(
      copiedText.includes('DANH SÁCH BÁO CÁO LỖI HỆ THỐNG MANAGEMENT LITE'),
      'Must have header',
    );
    assert.ok(
      copiedText.includes('CHỈ DẪN DÀNH CHO CHATGPT & ĐIỀU PHỐI ANTIGRAVITY'),
      'Must have ChatGPT instructions',
    );
    assert.ok(
      copiedText.includes(
        'Phân tích nguyên nhân gốc rễ, sửa triệt để bằng Minimal Diff',
      ),
      'Must have minimal diff guidance',
    );
    assert.ok(
      copiedText.includes('Tuyệt đối không tự động đóng lỗi'),
      'Must instruct not to self-close',
    );
    assert.ok(
      copiedText.includes(issueAId),
      `Must contain ID of Issue A (${issueAId})`,
    );
    assert.ok(
      copiedText.includes(issueBId),
      `Must contain ID of Issue B (${issueBId})`,
    );
    assert.ok(
      copiedText.includes('Mã định danh (ID)'),
      'Must contain ID label',
    );
    assert.ok(
      copiedText.includes('Trạng thái thực tế'),
      'Must contain actual status label',
    );
    assert.ok(
      copiedText.includes('Phân hệ / Module'),
      'Must contain module name',
    );
    assert.ok(
      copiedText.includes('Đường dẫn màn hình (Route)'),
      'Must contain route template',
    );
    assert.ok(
      copiedText.includes('Mô tả nguyên văn'),
      'Must contain verbatim description',
    );
    assert.ok(
      copiedText.includes('Lịch sử xử lý & Ghi chú (Activities)'),
      'Must contain activities section',
    );
    assert.ok(
      copiedText.includes(`/issues/${issueAId}`),
      'Must contain valid link for issue A',
    );
    assert.ok(
      copiedText.includes(`/issues/${issueBId}`),
      'Must contain valid link for issue B',
    );

    // Verify zero sensitive data leakage
    assert.ok(!copiedText.includes('password'), 'Must NOT leak password');
    assert.ok(
      !copiedText.includes('mglite_session'),
      'Must NOT leak session cookie',
    );
    assert.ok(!copiedText.includes('csrf_token'), 'Must NOT leak csrf token');
    console.log('All copied content checks passed 100%!');

    // 7. Test "Bỏ chọn" (Deselect all)
    console.log('7. Testing "Bỏ chọn" button...');
    const deselectRes = (
      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const btn = document.querySelector("button[data-testid='btn-deselect-all']");
            if (!btn) return { found: false };
            btn.click();
            return { found: true };
          })()
        `,
        returnByValue: true,
      })
    ).result.value;
    console.log('Deselect button click result:', deselectRes);
    await new Promise((r) => setTimeout(r, 1000));

    const hasSelectedNow = (
      await send('Runtime.evaluate', {
        expression: `document.body.innerText.includes("Đã chọn:")`,
      })
    ).result.value;
    console.log('Selection text present after Bỏ chọn:', hasSelectedNow);
    assert.equal(
      hasSelectedNow,
      false,
      'Deselect all must clear all selections',
    );

    // 8. Test "Chọn tất cả" checkbox on current page
    console.log('8. Testing "Chọn tất cả" checkbox...');
    await send('Runtime.evaluate', {
      expression: `
        const cbAll = document.querySelector("input[data-testid='checkbox-select-all']");
        if (cbAll) cbAll.click();
      `,
    });
    await new Promise((r) => setTimeout(r, 500));

    const allPageCount = openListInfo.length;
    const selectAllText = (
      await send('Runtime.evaluate', {
        expression: `document.body.innerText.includes("Đã chọn: ${allPageCount} lỗi")`,
      })
    ).result.value;
    console.log(
      `Select all selected all ${allPageCount} visible items:`,
      selectAllText,
    );
    assert.ok(
      selectAllText,
      `Must select all ${allPageCount} items on current page`,
    );

    // 9. Test clicking Card body navigates to detail
    console.log(
      `9. Testing card body click navigation to /issues/${issueBId}...`,
    );
    await send('Runtime.evaluate', {
      expression: `
        const card = document.querySelector("div[data-testid='issue-item-${issueBId}']");
        if (card) card.click();
      `,
    });
    await new Promise((r) => setTimeout(r, 1500));

    const detailUrlAfterClick = (
      await send('Runtime.evaluate', { expression: 'window.location.pathname' })
    ).result.value;
    console.log('Navigated to:', detailUrlAfterClick);
    assert.equal(
      detailUrlAfterClick,
      `/issues/${issueBId}`,
      'Card click must navigate to issue detail screen',
    );

    // Verify IssueDetailScreen renders properly with Confirm Fix, Reopen, and Copy
    const detailBody = (
      await send('Runtime.evaluate', { expression: 'document.body.innerText' })
    ).result.value;
    console.log(
      'Detail screen has Copy prompt button:',
      detailBody.includes('Sao chép để giao việc'),
    );
    assert.ok(
      detailBody.includes('Sao chép để giao việc'),
      'Original single copy button must be preserved on detail screen',
    );

    console.log('\n=== ALL BROWSER CDP TESTS PASSED (10/10) ===');
  } finally {
    try {
      ws.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
  }
}

main().catch((err) => {
  console.error('\nBROWSER TEST FAILED:', err);
  process.exit(1);
});
