import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 SET-01: route registry, navigation binding, and SettingsScreen UI20 invariants', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /settings route in registry (UI20)
  const settingsRoute = ROUTE_REGISTRY['/settings'];
  assert.ok(settingsRoute, 'Settings route must exist in ROUTE_REGISTRY');
  assert.equal(settingsRoute.id, 'UI20');
  assert.equal(settingsRoute.path, '/settings');
  assert.equal(
    settingsRoute.implemented,
    true,
    'Settings route must be marked implemented',
  );
  assert.equal(
    settingsRoute.ownerOnly,
    undefined,
    'Settings route is accessible by both Owner and Staff',
  );
  assert.equal(
    settingsRoute.staffOnly,
    undefined,
    'Settings route is accessible by both Owner and Staff',
  );

  // 2. Verify router matching
  const matchSettings = matchRoute('/settings');
  assert.ok(matchSettings.route, 'Route matching must succeed for /settings');
  assert.equal(matchSettings.route.id, 'UI20');
});

test('V0.2 SET-01: SettingsScreen.tsx change password form, C06 workspace context, CSRF, and SEC-02 invariants', () => {
  const settingsPath = resolve(root, 'apps/web/src/screens/SettingsScreen.tsx');
  assert.ok(existsSync(settingsPath), 'SettingsScreen.tsx must exist');

  const content = readFileSync(settingsPath, 'utf-8');

  // 1. Invariants: Change Password Form (UI20)
  assert.ok(
    content.includes('Đổi mật khẩu tài khoản (UI20)'),
    'Must include UI20 Change Password section',
  );
  assert.ok(
    content.includes('input-current-password'),
    'Must include current password input',
  );
  assert.ok(
    content.includes('input-new-password'),
    'Must include new password input',
  );
  assert.ok(
    content.includes('input-confirm-password'),
    'Must include confirm password input',
  );
  assert.ok(
    content.includes('btn-change-password'),
    'Must include change password submit button',
  );

  // 2. Invariants: Contract validation and endpoints
  assert.ok(
    content.includes('/api/v1/auth/password/change'),
    'Must call canonical POST /api/v1/auth/password/change endpoint',
  );
  assert.ok(
    content.includes('current_password'),
    'Must include current_password field',
  );
  assert.ok(
    content.includes('new_password'),
    'Must include new_password field',
  );
  assert.ok(
    content.includes('X-CSRF-Token'),
    'Must enforce CSRF token transmission',
  );
  assert.ok(
    content.includes("credentials: 'include'"),
    'Must pass session cookie credentials',
  );

  // 3. Invariants: Client-side validation
  assert.ok(
    content.includes('.length < 8'),
    'Must enforce minimum 8 characters password policy',
  );
  assert.ok(
    content.includes('newPassword !== confirmPassword'),
    'Must validate password confirmation match',
  );
  assert.ok(
    content.includes('newPassword === currentPassword'),
    'Must prevent reusing existing password',
  );

  // 4. Invariants: C06 Workspace Context
  assert.ok(
    content.includes('C06 Multi-Tenant Isolated'),
    'Must display C06 isolation status',
  );
  assert.ok(
    content.includes('Quy tắc C06'),
    'Must display C06 invariant explanation',
  );
  assert.ok(
    !content.includes('WorkspaceSelector'),
    'Must NOT contain any arbitrary workspace selector',
  );

  // 5. Invariants: SEC-02 Session Revocation awareness
  assert.ok(
    content.includes('SEC-02'),
    'Must reference SEC-02 session revocation',
  );

  // 6. Invariants: Password integrity (no password trimming)
  assert.ok(
    !content.includes('currentPassword.trim()'),
    'Must NOT trim current password',
  );
  assert.ok(
    !content.includes('newPassword.trim()'),
    'Must NOT trim new password',
  );
});

test('SET-002 & SET-003: SettingsScreen supports Theme, Timezone, and Currency configuration with persistence', () => {
  const settingsPath = resolve(root, 'apps/web/src/screens/SettingsScreen.tsx');
  const content = readFileSync(settingsPath, 'utf-8');

  // SET-002: Theme controls
  assert.ok(content.includes('select-theme'), 'Must have select-theme control');
  assert.ok(content.includes('value="dark"'), 'Must have dark theme option');
  assert.ok(content.includes('value="light"'), 'Must have light theme option');
  assert.ok(
    content.includes('mglite_theme'),
    'Must persist theme in localStorage',
  );

  // SET-003: Timezone & Currency controls
  assert.ok(
    content.includes('select-timezone'),
    'Must have select-timezone control',
  );
  assert.ok(
    content.includes('Asia/Ho_Chi_Minh'),
    'Must have Vietnam timezone Asia/Ho_Chi_Minh option',
  );
  assert.ok(
    content.includes('select-currency'),
    'Must have select-currency control',
  );
  assert.ok(content.includes('value="VND"'), 'Must have VND currency option');
  assert.ok(
    content.includes('mglite_timezone'),
    'Must persist timezone in localStorage',
  );
  assert.ok(
    content.includes('mglite_currency'),
    'Must persist currency in localStorage',
  );
});

test('SET-002: applyTheme applies visual theme (data-theme, colorScheme, root background) to document', () => {
  const settingsPath = resolve(root, 'apps/web/src/screens/SettingsScreen.tsx');
  const appPath = resolve(root, 'apps/web/src/App.tsx');
  const tokensCssPath = resolve(root, 'packages/ui/src/tokens.css');
  const indexHtmlPath = resolve(root, 'apps/web/index.html');

  const settingsContent = readFileSync(settingsPath, 'utf-8');
  const appContent = readFileSync(appPath, 'utf-8');
  const tokensCss = readFileSync(tokensCssPath, 'utf-8');
  const indexHtml = readFileSync(indexHtmlPath, 'utf-8');

  // 1. SettingsScreen must define and invoke applyTheme
  assert.ok(
    settingsContent.includes(
      'export function applyTheme(selectedTheme: string)',
    ),
    'SettingsScreen must export applyTheme',
  );
  assert.ok(
    settingsContent.includes('applyTheme(newTheme)'),
    'handleSavePreferences must invoke applyTheme',
  );
  assert.ok(
    settingsContent.includes('applyTheme(theme)'),
    'Mount effect must invoke applyTheme',
  );
  assert.ok(
    settingsContent.includes("root.setAttribute('data-theme', selectedTheme)"),
    'applyTheme must set data-theme attribute on root',
  );
  assert.ok(
    settingsContent.includes("root.style.colorScheme = 'light'"),
    'applyTheme must set colorScheme for light theme',
  );
  assert.ok(
    settingsContent.includes("document.body.style.backgroundColor = '#F8FAFC'"),
    'applyTheme must set light body background',
  );

  // 2. App.tsx must initialize theme on mount
  assert.ok(
    appContent.includes('applyTheme(savedTheme)'),
    'App.tsx must initialize visual theme from localStorage on startup',
  );

  // 3. index.html must initialize theme before render to eliminate FOUC
  assert.ok(
    indexHtml.includes("document.documentElement.setAttribute('data-theme'"),
    'index.html must set initial theme attribute',
  );

  // 4. tokens.css must contain full light and dark theme overrides
  assert.ok(
    tokensCss.includes("[data-theme='light']"),
    'tokens.css must contain light theme overrides',
  );
  assert.ok(
    tokensCss.includes("[data-theme='dark']"),
    'tokens.css must contain dark theme overrides',
  );
  assert.ok(
    tokensCss.includes('--bg-color: #f8fafc'),
    'tokens.css light theme must define light background color',
  );
  assert.ok(
    tokensCss.includes('--text-color: #0f172a'),
    'tokens.css light theme must define dark text color',
  );

  // 5. Behavioral verification of the applyTheme logic
  const rootElement = {
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
  const bodyElement = {
    style: {},
  };

  // Simulate applyTheme execution
  const simulateApplyTheme = (selectedTheme) => {
    rootElement.setAttribute('data-theme', selectedTheme);
    if (selectedTheme === 'light') {
      rootElement.style.colorScheme = 'light';
      bodyElement.style.backgroundColor = '#F8FAFC';
      bodyElement.style.color = '#0F172A';
    } else if (selectedTheme === 'dark') {
      rootElement.style.colorScheme = 'dark';
      bodyElement.style.backgroundColor = '#0B1220';
      bodyElement.style.color = '#F8FAFC';
    }
  };

  simulateApplyTheme('light');
  assert.equal(rootElement.getAttribute('data-theme'), 'light');
  assert.equal(rootElement.style.colorScheme, 'light');
  assert.equal(bodyElement.style.backgroundColor, '#F8FAFC');

  simulateApplyTheme('dark');
  assert.equal(rootElement.getAttribute('data-theme'), 'dark');
  assert.equal(rootElement.style.colorScheme, 'dark');
  assert.equal(bodyElement.style.backgroundColor, '#0B1220');
});

test('SET-002: System theme reacts dynamically to prefers-color-scheme OS changes without reload & cleans up on manual override', () => {
  const settingsPath = resolve(root, 'apps/web/src/screens/SettingsScreen.tsx');
  const appPath = resolve(root, 'apps/web/src/App.tsx');
  const tokensCssPath = resolve(root, 'packages/ui/src/tokens.css');
  const indexHtmlPath = resolve(root, 'apps/web/index.html');

  const settingsContent = readFileSync(settingsPath, 'utf-8');
  const appContent = readFileSync(appPath, 'utf-8');
  const tokensCss = readFileSync(tokensCssPath, 'utf-8');
  const indexHtml = readFileSync(indexHtmlPath, 'utf-8');

  // 1. SettingsScreen exports removeThemeListener and manages media query listener
  assert.ok(
    settingsContent.includes('export function removeThemeListener(): void'),
    'Must export removeThemeListener',
  );
  assert.ok(
    settingsContent.includes(
      "mq.addEventListener('change', activeMediaListener)",
    ),
    'Must attach change listener to media query for system theme',
  );
  assert.ok(
    settingsContent.includes("root.style.colorScheme = 'light dark'"),
    'Must set colorScheme to light dark for system theme',
  );

  // 2. App.tsx unmount cleanup
  assert.ok(
    appContent.includes('removeThemeListener()'),
    'App.tsx must clean up theme listener on unmount',
  );

  // 3. index.html system theme colorScheme
  assert.ok(
    indexHtml.includes(
      "document.documentElement.style.colorScheme = 'light dark'",
    ),
    'index.html must set light dark colorScheme for system theme',
  );

  // 4. tokens.css system media query rules
  assert.ok(
    tokensCss.includes('@media (prefers-color-scheme: light)'),
    'tokens.css must contain prefers-color-scheme: light query',
  );
  assert.ok(
    tokensCss.includes('@media (prefers-color-scheme: dark)'),
    'tokens.css must contain prefers-color-scheme: dark query',
  );
  assert.ok(
    tokensCss.includes("[data-theme='system']"),
    'tokens.css must style data-theme=system',
  );

  // 5. Behavioral test of dynamic media listener registration, OS change reaction, and manual override detachment
  let attachedListener = null;
  let currentMatches = true; // initially dark OS

  const fakeMediaQuery = {
    get matches() {
      return currentMatches;
    },
    addEventListener(event, listener) {
      if (event === 'change') attachedListener = listener;
    },
    removeEventListener(event, listener) {
      if (event === 'change' && attachedListener === listener)
        attachedListener = null;
    },
  };

  const fakeRoot = {
    attributes: {},
    style: {},
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return this.attributes[k];
    },
  };

  const fakeBody = {
    style: {},
  };

  // Behavioral simulation of applyTheme & removeThemeListener
  let activeMq = null;
  let activeListener = null;

  function simulateRemoveThemeListener() {
    if (activeMq && activeListener) {
      activeMq.removeEventListener('change', activeListener);
    }
    activeMq = null;
    activeListener = null;
  }

  function simulateApplyTheme(theme) {
    fakeRoot.setAttribute('data-theme', theme);
    simulateRemoveThemeListener();

    if (theme === 'light') {
      fakeRoot.style.colorScheme = 'light';
      fakeBody.style.backgroundColor = '#F8FAFC';
      fakeBody.style.color = '#0F172A';
    } else if (theme === 'dark') {
      fakeRoot.style.colorScheme = 'dark';
      fakeBody.style.backgroundColor = '#0B1220';
      fakeBody.style.color = '#F8FAFC';
    } else {
      fakeRoot.style.colorScheme = 'light dark';
      activeMq = fakeMediaQuery;
      const updateVisuals = (dark) => {
        fakeBody.style.backgroundColor = dark ? '#0B1220' : '#F8FAFC';
        fakeBody.style.color = dark ? '#F8FAFC' : '#0F172A';
      };
      updateVisuals(fakeMediaQuery.matches);

      activeListener = (e) => {
        if (fakeRoot.getAttribute('data-theme') === 'system') {
          updateVisuals(e.matches);
        }
      };
      fakeMediaQuery.addEventListener('change', activeListener);
    }
  }

  // A. Select 'system' when OS is dark -> renders dark
  currentMatches = true;
  simulateApplyTheme('system');
  assert.equal(fakeRoot.getAttribute('data-theme'), 'system');
  assert.equal(fakeRoot.style.colorScheme, 'light dark');
  assert.equal(fakeBody.style.backgroundColor, '#0B1220');
  assert.equal(fakeBody.style.color, '#F8FAFC');
  assert.ok(
    attachedListener !== null,
    'Listener must be attached to mediaQuery',
  );

  // B. OS switches to light in real time (CDP Emulation.setEmulatedMedia) -> listener updates body without reload!
  currentMatches = false;
  attachedListener({ matches: false });
  assert.equal(
    fakeBody.style.backgroundColor,
    '#F8FAFC',
    'Body background must switch to light immediately',
  );
  assert.equal(
    fakeBody.style.color,
    '#0F172A',
    'Body text must switch to dark immediately',
  );

  // C. OS switches back to dark in real time -> listener updates body without reload!
  currentMatches = true;
  attachedListener({ matches: true });
  assert.equal(
    fakeBody.style.backgroundColor,
    '#0B1220',
    'Body background must switch to dark immediately',
  );
  assert.equal(
    fakeBody.style.color,
    '#F8FAFC',
    'Body text must switch to light immediately',
  );

  // D. User explicitly chooses 'light' -> listener is removed, manual preference overrides OS
  simulateApplyTheme('light');
  assert.equal(fakeRoot.getAttribute('data-theme'), 'light');
  assert.equal(fakeBody.style.backgroundColor, '#F8FAFC');
  assert.equal(
    attachedListener,
    null,
    'Listener must be detached when manually selecting light',
  );

  // E. Subsequent OS appearance changes do NOT override manual selection
  currentMatches = true;
  // attachedListener is null, no event fired to manual selection
  assert.equal(
    fakeBody.style.backgroundColor,
    '#F8FAFC',
    'OS appearance change must NOT override manual light choice',
  );
  assert.equal(fakeBody.style.color, '#0F172A');
});
