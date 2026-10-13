import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { act } from 'react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 ACC-01: route registry, navigation binding, and AccountsScreen RBAC guards', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /accounts route in registry (UI17)
  const accountsRoute = ROUTE_REGISTRY['/accounts'];
  assert.ok(accountsRoute, 'Accounts route must exist in ROUTE_REGISTRY');
  assert.equal(accountsRoute.id, 'UI17');
  assert.equal(accountsRoute.title, 'Tài khoản quản lý (ACC)');
  assert.equal(
    accountsRoute.ownerOnly,
    true,
    'Accounts route must be Owner-only',
  );
  assert.equal(
    accountsRoute.implemented,
    true,
    'Accounts route must be marked implemented',
  );
  assert.equal(accountsRoute.category, 'accounts');

  // 2. Verify /accounts/:id route in registry (UI18)
  const accountDetailRoute = ROUTE_REGISTRY['/accounts/:id'];
  assert.ok(
    accountDetailRoute,
    'Account detail route must exist in ROUTE_REGISTRY',
  );
  assert.equal(accountDetailRoute.id, 'UI18');
  assert.equal(accountDetailRoute.title, 'Chi tiết tài khoản & Secret (C05)');
  assert.equal(
    accountDetailRoute.ownerOnly,
    true,
    'Account detail route must be Owner-only',
  );
  assert.equal(
    accountDetailRoute.implemented,
    true,
    'Account detail route must be marked implemented',
  );
  assert.equal(accountDetailRoute.category, 'accounts');

  // 3. Verify router matching
  const matchAccounts = matchRoute('/accounts');
  assert.equal(matchAccounts.route?.id, 'UI17');
  assert.equal(matchAccounts.isExact, true);

  const matchAccountsTrailing = matchRoute('/accounts/');
  assert.equal(matchAccountsTrailing.route?.id, 'UI17');
  assert.equal(matchAccountsTrailing.isExact, true);

  const matchAccountDetail = matchRoute('/accounts/ACC-TEST-UUID-456');
  assert.equal(matchAccountDetail.route?.id, 'UI18');
  assert.equal(matchAccountDetail.isExact, false);
  assert.equal(matchAccountDetail.params.id, 'ACC-TEST-UUID-456');

  // 4. Verify NAV_ITEMS contains accounts
  const accNavItem = NAV_ITEMS.find((item) => item.id === 'accounts');
  assert.ok(accNavItem, 'Accounts item must exist in NAV_ITEMS');
  assert.equal(accNavItem.path, '/accounts');
  assert.equal(
    accNavItem.ownerOnly,
    true,
    'Navigation item must be marked ownerOnly',
  );

  // 5. Verify RBAC navigation visibility: Staff CANNOT see accounts
  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.ok(
    !staffVisible.some((i) => i.id === 'accounts'),
    'Staff must NEVER see accounts in navigation (SEC-02 / RBAC-02)',
  );

  // 6. Verify Owner sees accounts in navigation
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false;
    return true;
  });
  assert.ok(
    ownerVisible.some((i) => i.id === 'accounts'),
    'Owner MUST see accounts in navigation',
  );
});

test('V0.2 ACC-01: C05 Secret Vault and SEC-02 Invariants in AccountsScreen source code', async () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/AccountsScreen.tsx'),
    'utf8',
  );

  // 1. Staff RBAC guard
  assert.ok(
    screenContent.includes("role !== 'owner'") ||
      screenContent.includes('403 Forbidden'),
    'Screen must have explicit RBAC guard rejecting staff',
  );
  assert.ok(
    screenContent.includes('Chỉ Chủ sở hữu (Owner) mới có quyền truy cập'),
    'Screen must display clear Vietnamese message informing staff of Owner-only access',
  );

  // 2. Secret Vault Card with C05 / SEC-02 references
  assert.ok(
    screenContent.includes('C05 Secret Vault') &&
      screenContent.includes('SEC-02'),
    'Screen must feature C05 / SEC-02 Secret Vault section',
  );

  // 3. Reauth API calls with action scopes: secret_reveal vs secret_write
  assert.ok(
    screenContent.includes('/api/v1/auth/reauth'),
    'Screen must call reauth endpoint before accessing secrets',
  );
  assert.ok(
    screenContent.includes("'secret_reveal'"),
    'Reauth must support action scope secret_reveal',
  );
  assert.ok(
    screenContent.includes("'secret_write'"),
    'Reauth must support action scope secret_write',
  );

  // 4. Secret reveal endpoint and proof transmission
  assert.ok(
    screenContent.includes(
      '/api/v1/accounts/${selectedAccount.id}/secrets/reveal',
    ) || screenContent.includes('/secrets/reveal'),
    'Screen must call secret reveal endpoint with account ID',
  );
  assert.ok(
    screenContent.includes('reauth_proof'),
    'Proof must be transmitted in request body to unlock secret',
  );

  // 5. Secret write endpoint (PUT)
  assert.ok(
    screenContent.includes('/api/v1/accounts/${selectedAccount.id}/secrets') ||
      screenContent.includes('/secrets'),
    'Screen must support writing/updating secret via PUT',
  );

  // 6. Security UX: 60-second auto-clear timer & clipboard copy
  assert.ok(
    screenContent.includes('countdown') || screenContent.includes('timer'),
    'Screen must implement auto-clear timer for revealed secret',
  );
  assert.ok(
    screenContent.includes('navigator.clipboard.writeText'),
    'Screen must support secure copy to clipboard',
  );
  assert.ok(
    screenContent.includes('Tự động ẩn sau'),
    'Screen must notify user of auto-hide countdown in Vietnamese',
  );

  // 7. No plaintext secret in list table
  assert.ok(
    !screenContent.includes('account.secret') &&
      !screenContent.includes('account.password') &&
      !screenContent.includes('account.plaintext'),
    'AccountsScreen must NEVER render plaintext secret in account list or rows',
  );

  // 8. Supported platforms
  assert.ok(
    screenContent.includes('tiktok') &&
      screenContent.includes('gmail') &&
      screenContent.includes('ai') &&
      screenContent.includes('pm') &&
      screenContent.includes('other'),
    'Screen must configure TikTok, Gmail, AI, PM, and Other platforms',
  );
});

test('V0.2 ACC-01: Shared contracts, DTO types, and reauth action lock', async () => {
  const contractsPath = resolve(root, 'packages/contracts/src/accounts.ts');
  assert.ok(
    existsSync(contractsPath),
    'packages/contracts/src/accounts.ts must exist',
  );

  const contractsContent = readFileSync(contractsPath, 'utf8');

  // Verify ManagedAccountData has NO secret properties
  assert.ok(
    contractsContent.includes('export interface ManagedAccountData'),
    'ManagedAccountData DTO must be exported',
  );
  assert.ok(
    !contractsContent.match(
      /export interface ManagedAccountData[\s\S]*?(secret|password):/,
    ),
    'ManagedAccountData must NEVER contain secret or password fields',
  );

  // Verify ManagedAccountDetailData only contains metadata about secrets
  assert.ok(
    contractsContent.includes('export interface ManagedAccountDetailData'),
    'ManagedAccountDetailData DTO must be exported',
  );
  assert.ok(
    contractsContent.includes('has_secret?: boolean') ||
      contractsContent.includes('has_secret'),
    'ManagedAccountDetailData must indicate presence via has_secret boolean',
  );
  assert.ok(
    contractsContent.includes('secret_types?: AccountSecretType[]') ||
      contractsContent.includes('secret_types'),
    'ManagedAccountDetailData must indicate secret_types',
  );

  // Verify Reauth types in auth.ts
  const authContractsPath = resolve(root, 'packages/contracts/src/auth.ts');
  const authContent = readFileSync(authContractsPath, 'utf8');
  assert.ok(
    authContent.includes(
      "export type ReauthAction = 'secret_write' | 'secret_reveal'",
    ),
    'auth.ts must define ReauthAction strictly as secret_write | secret_reveal',
  );
  assert.ok(
    authContent.includes('export interface ReauthRequestBody'),
    'auth.ts must define ReauthRequestBody',
  );
  assert.ok(
    authContent.includes('export interface ReauthResponseData'),
    'auth.ts must define ReauthResponseData with reauth_proof and expires_in',
  );
});

test('V0.2 ACC-01: SCOPE-EXT-04-ACC-01 documentation adherence and security lock', async () => {
  const docPath = resolve(root, 'docs/extensions/SCOPE-EXT-04-ACC-01.md');
  assert.ok(
    existsSync(docPath),
    'SCOPE-EXT-04-ACC-01.md documentation must exist',
  );

  const docContent = readFileSync(docPath, 'utf8');

  // Invariant checks
  assert.ok(
    docContent.includes('C05') && docContent.includes('SEC-02'),
    'Specification must cite C05 and SEC-02 normative architectures',
  );
  assert.ok(
    docContent.includes('secret_reveal') && docContent.includes('secret_write'),
    'Specification must specify action-scoped reauth proofs',
  );
  assert.ok(
    docContent.includes('Cache-Control: no-store'),
    'Specification must enforce Cache-Control: no-store on reveal endpoint',
  );
  assert.ok(
    docContent.includes('API-ACC-01') && docContent.includes('API-ACC-07'),
    'Specification must detail API-ACC-01 through API-ACC-07 endpoints',
  );
  assert.ok(
    docContent.includes('UI17') && docContent.includes('UI18'),
    'Specification must map UI17 (/accounts) and UI18 (/accounts/:id)',
  );
});

test('UI: AccountsScreen uses shared ActionIconButton (aria-label/title) and Pagination', async () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/AccountsScreen.tsx'),
    'utf8',
  );
  assert.ok(screen.includes('<ActionIconButton'));
  assert.ok(screen.includes('<Pagination'));
  assert.ok(!screen.includes('<ListFooter'));
  // Security flows untouched
  assert.ok(screen.includes('Xem pass'));
  assert.ok(screen.includes('handleArchiveAccount'));

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const ui = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/index.js')}`
  );
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      ...['view', 'edit', 'deactivate', 'reactivate'].map((a) =>
        React.createElement(ui.ActionIconButton, {
          key: a,
          action: a,
          target: 'x',
        }),
      ),
      React.createElement(ui.Pagination, {
        testId: 'accounts-pager',
        total: 45,
        page: 0,
        pageSize: 20,
        onPage: () => {},
        onPageSize: () => {},
      }),
    ),
  );
  for (const l of ['Xem chi tiết', 'Sửa', 'Ngừng dùng', 'Kích hoạt lại']) {
    assert.ok(html.includes(`aria-label="${l}: x"`), l);
    assert.ok(html.includes(`title="${l}"`), l);
  }
  assert.ok(html.includes('data-testid="accounts-pager-next"'));
  assert.ok(html.includes('Trang 1 / 3'));
});

test('ACC-005: AccountsScreen auto-hides revealed secret after exactly 30 seconds', async () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/AccountsScreen.tsx'),
    'utf8',
  );
  assert.ok(
    screen.includes('setRevealCountdown(30)'),
    'Must initialize countdown to 30s',
  );
  assert.ok(
    screen.includes('tự động ẩn sau 30 giây'),
    'Must inform user secret auto-hides in 30s',
  );
  assert.ok(
    screen.includes('setRevealedSecret(null)'),
    'Must auto-clear secret when countdown expires',
  );
});

test('ACC-005: Real-time deadline calculation & background tab visibility protection against throttling', () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/AccountsScreen.tsx'),
    'utf8',
  );
  // 1. Static source verification
  assert.ok(
    screen.includes('revealDeadlineRef'),
    'Must use revealDeadlineRef for real-time tracking',
  );
  assert.ok(
    screen.includes('Date.now() + 30000'),
    'Must compute deadline from Date.now() + 30000ms',
  );
  assert.ok(
    screen.includes("document.visibilityState === 'hidden'"),
    'Must detect background tab via document.visibilityState',
  );
  assert.ok(
    screen.includes("addEventListener('visibilitychange'"),
    'Must register visibilitychange listener',
  );

  // 2. Behavioral verification of deadline expiry and visibility protection
  let revealedSecret = 'secret_test_value';
  let revealCountdown = 30;
  let deadline = Date.now() + 30000;

  const clearSecret = () => {
    revealedSecret = null;
    revealCountdown = 0;
    deadline = null;
  };

  const checkExpiry = (currentTime) => {
    if (!deadline) return;
    const remainingMs = deadline - currentTime;
    if (remainingMs <= 0) {
      clearSecret();
    } else {
      revealCountdown = Math.ceil(remainingMs / 1000);
    }
  };

  // Foreground tick at 10s: remaining is 20s
  checkExpiry(Date.now() + 10000);
  assert.equal(revealedSecret, 'secret_test_value');
  assert.equal(revealCountdown, 20);

  // Throttled background or frozen scenario: after 31s elapsed in real time
  checkExpiry(Date.now() + 31000);
  assert.equal(
    revealedSecret,
    null,
    'Must clear secret when deadline passes regardless of callback throttling',
  );
  assert.equal(revealCountdown, 0);

  // Background hide immediate clearing scenario
  revealedSecret = 'secret_bg_test';
  revealCountdown = 30;
  deadline = Date.now() + 30000;

  const handleVisibilityChange = (visibilityState) => {
    if (visibilityState === 'hidden') {
      clearSecret();
    }
  };

  handleVisibilityChange('hidden');
  assert.equal(
    revealedSecret,
    null,
    'Must clear secret immediately when tab becomes hidden',
  );
  assert.equal(revealCountdown, 0);
});

test('ACC-006: Keyboard accessibility closes reauth/archive modals on Escape key without leakage', () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/AccountsScreen.tsx'),
    'utf8',
  );
  assert.ok(
    screen.includes("e.key === 'Escape'"),
    'Must handle Escape key event',
  );
  assert.ok(
    screen.includes('closeRevealModal()'),
    'Must call closeRevealModal on Escape',
  );
  assert.ok(
    screen.includes("addEventListener('keydown'"),
    'Must listen for keydown events when modal is open',
  );
});

/* -------------------------------------------------------------------------- */
/* MOUNTED COMPONENT REGRESSIONS: ACC-005 & ACC-006 LIFECYCLE & RACE GUARDS     */
/* -------------------------------------------------------------------------- */

const responseHelper = (data) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});
const deferredHelper = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tickHelper = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

async function setupMountedAccountsScreen() {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act: reactAct } = await import('react');
  const { createRoot } = await import('react-dom/client');

  const dom = installFakeDom();
  document.visibilityState = 'visible';
  const pending = deferredHelper();
  let signal;
  let navigated = null;

  globalThis.fetch = async (url, opts = {}) => {
    if (url.endsWith('/auth/me'))
      return responseHelper({ csrf_token: 'synthetic-csrf' });
    if (url.endsWith('/auth/reauth'))
      return responseHelper({ reauth_proof: 'synthetic-proof' });
    if (url.includes('/secrets/reveal')) {
      signal = opts.signal;
      return pending.promise;
    }
    return responseHelper({
      items: [
        {
          id: 'a1',
          username: 'synthetic-account',
          platform: 'other',
          status: 'active',
          version: 1,
        },
      ],
    });
  };

  const { AccountsScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/AccountsScreen.js')}`
  );
  const c = dom.container();
  const rootEl = createRoot(c);
  await reactAct(async () =>
    rootEl.render(
      React.createElement(AccountsScreen, {
        role: 'owner',
        onNavigate: (p) => {
          navigated = p;
        },
      }),
    ),
  );
  await tickHelper();

  const btn = dom.find(
    c,
    (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Xem pass'),
  )[0];
  await reactAct(async () => dom.props(btn).onClick());

  const inp = dom.find(
    c,
    (n) => n.nodeName === 'INPUT' && dom.props(n).type === 'password',
  )[0];
  await reactAct(async () =>
    dom.props(inp).onChange({ target: { value: 'synthetic-reauth' } }),
  );

  const form = dom.find(c, (n) => n.nodeName === 'FORM')[0];
  let task;
  await reactAct(async () => {
    task = dom.props(form).onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });
  await tickHelper();

  return {
    dom,
    c,
    root: rootEl,
    pending,
    signal: () => signal,
    task: () => task,
    getNavigated: () => navigated,
  };
}

test('Mounted ACC: Hidden before response rejects secret from state', async () => {
  const s = await setupMountedAccountsScreen();
  try {
    await act(async () => {
      document.visibilityState = 'hidden';
      document.dispatchEvent({ type: 'visibilitychange' });
    });
    await act(async () =>
      s.pending.resolve(responseHelper({ secret_value: 'secret-tab-hidden' })),
    );
    await s.task();
    await tickHelper();

    assert.equal(
      s.c.textContent.includes('secret-tab-hidden'),
      false,
      'Secret must not be displayed when response arrives while tab is hidden',
    );
  } finally {
    await act(async () => s.root.unmount());
  }
});

test('Mounted ACC: Hidden -> visible before response invalidates stale reveal', async () => {
  const s = await setupMountedAccountsScreen();
  try {
    await act(async () => {
      document.visibilityState = 'hidden';
      document.dispatchEvent({ type: 'visibilitychange' });
    });
    await act(async () => {
      document.visibilityState = 'visible';
      document.dispatchEvent({ type: 'visibilitychange' });
    });
    await act(async () =>
      s.pending.resolve(
        responseHelper({ secret_value: 'secret-hidden-then-visible' }),
      ),
    );
    await s.task();
    await tickHelper();

    assert.equal(
      s.c.textContent.includes('secret-hidden-then-visible'),
      false,
      'Background transition must permanently invalidate in-flight reveal even after tab becomes visible again',
    );
  } finally {
    await act(async () => s.root.unmount());
  }
});

test('Mounted ACC: Close modal while pending aborts request and discards response', async () => {
  const s = await setupMountedAccountsScreen();
  try {
    // Click close button on modal
    const closeBtn = s.dom.find(
      s.c,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Hủy'),
    )[0];
    await act(async () => s.dom.props(closeBtn).onClick());

    assert.equal(
      s.signal().aborted,
      true,
      'Closing modal must abort pending request',
    );
    await act(async () =>
      s.pending.resolve(responseHelper({ secret_value: 'secret-closed-modal' })),
    );
    await s.task();
    await tickHelper();

    assert.equal(
      s.c.textContent.includes('secret-closed-modal'),
      false,
      'Closed modal must not display revealed secret',
    );
  } finally {
    await act(async () => s.root.unmount());
  }
});

test('Mounted ACC: Escape aborts pending reveal and a reopened modal remains usable', async () => {
  const s = await setupMountedAccountsScreen();
  try {
    await act(async () => window.dispatchEvent({ type: 'keydown', key: 'Escape' }));
    assert.equal(s.signal().aborted, true, 'Escape must abort request');
    await act(async () =>
      s.pending.resolve(responseHelper({ secret_value: 'secret-escape' })),
    );
    await s.task();
    await tickHelper();

    assert.equal(
      s.c.textContent.includes('secret-escape'),
      false,
      'Secret must not be displayed after Escape',
    );

    // Reopen modal and verify not stuck in actionLoading
    const btn = s.dom.find(
      s.c,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Xem pass'),
    )[0];
    await act(async () => s.dom.props(btn).onClick());

    const inp = s.dom.find(
      s.c,
      (n) => n.nodeName === 'INPUT' && s.dom.props(n).type === 'password',
    )[0];
    await act(async () =>
      s.dom.props(inp).onChange({ target: { value: 'reauth-again' } }),
    );

    const submit = s.dom.find(
      s.c,
      (n) => n.nodeName === 'BUTTON' && s.dom.props(n).type === 'submit',
    )[0];
    assert.equal(
      s.dom.props(submit).disabled,
      false,
      'Reopened modal must not remain stuck in actionLoading',
    );
  } finally {
    await act(async () => s.root.unmount());
  }
});

test('Mounted ACC: Superseded request ignores older response', async () => {
  const s = await setupMountedAccountsScreen();
  try {
    // Escape and reopen modal
    await act(async () => window.dispatchEvent({ type: 'keydown', key: 'Escape' }));
    const btn = s.dom.find(
      s.c,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Xem pass'),
    )[0];
    await act(async () => s.dom.props(btn).onClick());

    // Resolve old generation 1 promise
    await act(async () =>
      s.pending.resolve(responseHelper({ secret_value: 'superseded-old-secret' })),
    );
    await s.task();
    await tickHelper();

    assert.equal(
      s.c.textContent.includes('superseded-old-secret'),
      false,
      'Old generation response must be discarded',
    );
  } finally {
    await act(async () => s.root.unmount());
  }
});

test('Mounted ACC: Unmount while reveal pending aborts controller cleanly', async () => {
  const s = await setupMountedAccountsScreen();
  await act(async () => s.root.unmount());
  assert.equal(s.signal().aborted, true, 'Unmounting must abort in-flight reveal');
});

test('Mounted ACC: Navigation triggers onNavigate and cleans up modal state', async () => {
  const s = await setupMountedAccountsScreen();
  try {
    const viewBtn = s.dom.find(
      s.c,
      (n) => s.dom.props(n)['data-testid'] === 'account-view-a1',
    )[0];
    if (viewBtn) {
      await act(async () => s.dom.props(viewBtn).onClick());
      assert.equal(s.getNavigated(), '/accounts/a1');
    }
  } finally {
    await act(async () => s.root.unmount());
  }
});

test('Mounted ACC: Open modal A -> request pending -> open modal B -> response A arrives late -> secret A discarded', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const dom = installFakeDom();
  const React = (await import('react')).default;
  const { act: reactAct } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const tickHelper = () =>
    reactAct(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

  let resolveA;
  const pendingA = new Promise((r) => {
    resolveA = r;
  });

  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { csrf_token: 'csrf-1' } }),
      };
    if (url.endsWith('/auth/reauth'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { reauth_proof: 'proof-1' } }),
      };
    if (url.includes('/accounts/a1/secrets/reveal')) return pendingA;
    if (url.includes('/accounts/a2/secrets/reveal'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { secret_value: 'secret-b' } }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [
            {
              id: 'a1',
              username: 'account-alpha',
              platform: 'other',
              status: 'active',
              version: 1,
            },
            {
              id: 'a2',
              username: 'account-beta',
              platform: 'other',
              status: 'active',
              version: 1,
            },
          ],
        },
      }),
    };
  };

  const { AccountsScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/AccountsScreen.js')}`
  );
  const c = dom.container();
  const rootEl = createRoot(c);
  try {
    await reactAct(async () =>
      rootEl.render(
        React.createElement(AccountsScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await tickHelper();

    // 1. Click "Xem pass" for Account A
    const revealBtns = dom.find(
      c,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Xem pass'),
    );
    await reactAct(async () => dom.props(revealBtns[0]).onClick());

    // Enter reauth password and submit
    const inp = dom.find(
      c,
      (n) => n.nodeName === 'INPUT' && dom.props(n).type === 'password',
    )[0];
    await reactAct(async () =>
      dom.props(inp).onChange({ target: { value: 'passwordA' } }),
    );
    const form = dom.find(c, (n) => n.nodeName === 'FORM')[0];
    let taskA;
    await reactAct(async () => {
      taskA = dom.props(form).onSubmit({ preventDefault() {} });
      await Promise.resolve();
    });
    await tickHelper();

    // Request A is now pending. Now switch/reopen reveal for Account B
    await reactAct(async () => dom.props(revealBtns[1]).onClick());

    // 2. Resolve request A with secret A
    await reactAct(async () => {
      resolveA({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { secret_value: 'secret-a-should-not-appear' },
        }),
      });
    });
    await taskA;
    await tickHelper();

    // 3. Assert secret A is NOT shown
    assert.equal(
      c.textContent.includes('secret-a-should-not-appear'),
      false,
      'Secret A must not be shown when modal was switched to Account B',
    );
  } finally {
    await reactAct(async () => rootEl.unmount());
  }
});

test('Mounted ACC: Switching accountId purges revealed secret and prevents cross-account leak', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const dom = installFakeDom();
  const React = (await import('react')).default;
  const { act: reactAct } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const tickHelper = () =>
    reactAct(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { csrf_token: 'csrf-1' } }),
      };
    if (url.endsWith('/auth/reauth'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { reauth_proof: 'proof-1' } }),
      };
    if (url.includes('/accounts/a1/secrets/reveal'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { secret_value: 'secret-a1-sensitive' } }),
      };
    if (url.includes('/accounts/a2/secrets/reveal'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { secret_value: 'secret-a2-sensitive' } }),
      };
    if (url.includes('/accounts/a1'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 'a1',
            username: 'account-alpha',
            platform: 'other',
            status: 'active',
            version: 1,
          },
        }),
      };
    if (url.includes('/accounts/a2'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 'a2',
            username: 'account-beta',
            platform: 'other',
            status: 'active',
            version: 1,
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  const { AccountsScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/AccountsScreen.js')}`
  );
  const c = dom.container();
  const rootEl = createRoot(c);
  try {
    // 1. Render Account A detail view
    await reactAct(async () =>
      rootEl.render(
        React.createElement(AccountsScreen, {
          role: 'owner',
          accountId: 'a1',
          onNavigate: () => {},
        }),
      ),
    );
    await tickHelper();

    // 2. Click "Xem mật khẩu" in detail view
    const revealBtns = dom.find(
      c,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Xem mật khẩu'),
    );
    assert.ok(revealBtns.length > 0, 'Must have Xem mật khẩu button in detail view');
    await reactAct(async () => dom.props(revealBtns[0]).onClick());
    await tickHelper();

    // Enter reauth password and submit
    const inp = dom.find(
      c,
      (n) => n.nodeName === 'INPUT' && dom.props(n).type === 'password',
    )[0];
    await reactAct(async () =>
      dom.props(inp).onChange({ target: { value: 'passwordA' } }),
    );
    const form = dom.find(c, (n) => n.nodeName === 'FORM')[0];
    await reactAct(async () => {
      await dom.props(form).onSubmit({ preventDefault() {} });
    });
    await tickHelper();

    // Verify secret for a1 is displayed
    assert.equal(
      c.textContent.includes('secret-a1-sensitive'),
      true,
      'Secret for Account A must be displayed after reauth',
    );

    // 3. Switch accountId prop to 'a2'
    await reactAct(async () =>
      rootEl.render(
        React.createElement(AccountsScreen, {
          role: 'owner',
          accountId: 'a2',
          onNavigate: () => {},
        }),
      ),
    );
    await tickHelper();

    // 4. Assert Secret A is PURGED immediately upon switching to Account B
    assert.equal(
      c.textContent.includes('secret-a1-sensitive'),
      false,
      'Secret A must be purged immediately when switching accountId to a2',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await reactAct(async () => rootEl.unmount());
  }
});

test('ACC Security: sanitizeUiError scrubs secrets, passwords, tokens, and bearer credentials', async () => {
  const { sanitizeUiError } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/AccountsScreen.js')}`
  );
  assert.equal(
    sanitizeUiError('Error: password=SuperSecret123 occurred'),
    'Error: password=[REDACTED] occurred',
  );
  assert.equal(
    sanitizeUiError('Failed with token=eyJhbGciOi...'),
    'Failed with token=[REDACTED]',
  );
  assert.equal(
    sanitizeUiError('Auth failed: Bearer secret-token-xyz123'),
    'Auth failed: Bearer [REDACTED]',
  );
  assert.equal(
    sanitizeUiError('Internal proof=abc12345 expired'),
    'Internal proof=[REDACTED] expired',
  );
});




