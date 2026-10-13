import { spawn } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppButton } from '../dist/packages/ui/src/components/AppButton.js';

const port = 9245;
const runId = Math.random().toString(36).substring(2, 8);

// Render before-loading and during-loading buttons
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0B1220; color: #F8FAFC; font-family: -apple-system, sans-serif; padding: 40px; }
    .row { display: flex; gap: 0px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="row" id="before-container">
    ${renderToStaticMarkup(React.createElement(AppButton, { size: 'sm', id: 'btn-before' }, 'Lưu'))}
    ${renderToStaticMarkup(React.createElement(AppButton, { size: 'sm', id: 'btn-adjacent-1' }, 'Hủy'))}
  </div>
  <div class="row" id="loading-container">
    ${renderToStaticMarkup(React.createElement(AppButton, {
      size: 'sm',
      id: 'btn-loading',
      isLoading: true,
      loadingText: 'Đang gửi thông tin xác thực lên máy chủ bảo mật và hoàn tất phiên giao dịch...',
    }, 'Lưu'))}
    ${renderToStaticMarkup(React.createElement(AppButton, { size: 'sm', id: 'btn-adjacent-2' }, 'Hủy'))}
  </div>
  <div class="row" id="icon-before-container">
    ${renderToStaticMarkup(React.createElement(AppButton, { size: 'sm', id: 'btn-icon-before', icon: React.createElement('span', null, 'X') }))}
  </div>
  <div class="row" id="icon-loading-container">
    ${renderToStaticMarkup(React.createElement(AppButton, {
      size: 'sm',
      id: 'btn-icon-loading',
      isLoading: true,
      loadingText: 'Đang gửi thông tin...',
      icon: React.createElement('span', null, 'X'),
    }))}
  </div>
  <div class="row" id="notext-loading-container">
    ${renderToStaticMarkup(React.createElement(AppButton, {
      size: 'sm',
      id: 'btn-notext-loading',
      isLoading: true,
    }, 'Lưu'))}
  </div>
</body>
</html>
`;

async function measure() {
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-measure-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const encodedHtml = Buffer.from(htmlContent).toString('base64');
    const targetUrl = `data:text/html;base64,${encodedHtml}`;

    const newTab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, {
      method: 'PUT',
    }).then((r) => r.json());

    const ws = new WebSocket(newTab.webSocketDebuggerUrl);
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
      const r = await send('Runtime.evaluate', { expression: exp, returnByValue: true });
      return r.result.value;
    };

    await send('Page.enable');
    await new Promise((r) => setTimeout(r, 500));

    const measurements = await evaluate(`
      (() => {
        const btnBefore = document.getElementById('btn-before');
        const btnLoading = document.getElementById('btn-loading');
        const adj1 = document.getElementById('btn-adjacent-1');
        const adj2 = document.getElementById('btn-adjacent-2');
        const btnIconBefore = document.getElementById('btn-icon-before');
        const btnIconLoading = document.getElementById('btn-icon-loading');

        const rectBefore = btnBefore.getBoundingClientRect();
        const rectLoading = btnLoading.getBoundingClientRect();
        const rectAdj1 = adj1.getBoundingClientRect();
        const rectAdj2 = adj2.getBoundingClientRect();
        const rectIconBefore = btnIconBefore.getBoundingClientRect();
        const rectIconLoading = btnIconLoading.getBoundingClientRect();

        // Button without loadingText
        const btnNoTextLoading = document.getElementById('btn-notext-loading');

        // Accessible role="status" check: elements matching [role="status"] that are NOT inside [aria-hidden="true"]
        const getAccessibleStatusCount = (btn) => {
          const allStatuses = Array.from(btn.querySelectorAll('[role="status"]'));
          const accessibleStatuses = allStatuses.filter((el) => !el.closest('[aria-hidden="true"]'));
          const decorativeStatuses = allStatuses.filter((el) => Boolean(el.closest('[aria-hidden="true"]')));
          return {
            total: allStatuses.length,
            accessibleCount: accessibleStatuses.length,
            decorativeCount: decorativeStatuses.length,
            accessibleTexts: accessibleStatuses.map((el) => el.textContent || el.getAttribute('aria-label')),
          };
        };

        const spinnerInNarrow = btnIconLoading.querySelector('span[aria-hidden="true"] span[role="status"]');

        return {
          textButton: {
            widthBefore: rectBefore.width,
            widthLoading: rectLoading.width,
            heightBefore: rectBefore.height,
            heightLoading: rectLoading.height,
            stable: Math.abs(rectBefore.width - rectLoading.width) < 0.5,
          },
          iconButton: {
            widthBefore: rectIconBefore.width,
            widthLoading: rectIconLoading.width,
            stable: Math.abs(rectIconBefore.width - rectIconLoading.width) < 0.5,
          },
          adjacentPositions: {
            adj1Left: rectAdj1.left,
            adj2Left: rectAdj2.left,
            stable: Math.abs(rectAdj1.left - rectAdj2.left) < 0.5,
          },
          accessibility: {
            withLoadingText: getAccessibleStatusCount(btnLoading),
            withoutLoadingText: getAccessibleStatusCount(btnNoTextLoading),
            hiddenOriginalAriaHidden: btnLoading.querySelector('span[style*="visibility:hidden"], span[style*="visibility: hidden"]')?.getAttribute('aria-hidden') === 'true',
          },
          narrowButtonSpinner: {
            spinnerWidth: spinnerInNarrow ? spinnerInNarrow.getBoundingClientRect().width : null,
            spinnerHeight: spinnerInNarrow ? spinnerInNarrow.getBoundingClientRect().height : null,
            spinnerVisible: spinnerInNarrow ? spinnerInNarrow.getBoundingClientRect().width > 0 : false,
          },
        };
      })()
    `);

    console.log(JSON.stringify(measurements, null, 2));

    ws.close();
  } finally {
    chrome.kill();
  }
}

measure().catch(console.error);
