import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('MGL-AUTH-LOGIN-UI-18: LoginScreen source code static security and accessibility invariants', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. Zero plaintext storage in browser storage
  assert.ok(
    !source.includes('localStorage.setItem('),
    'Plaintext password or credentials must NEVER be stored in localStorage',
  );
  assert.ok(
    !source.includes('sessionStorage.setItem('),
    'Plaintext password or credentials must NEVER be stored in sessionStorage',
  );
  assert.ok(
    !source.includes('document.cookie'),
    'Plaintext password must NEVER be written to document.cookie directly',
  );

  // 2. Form and autofill attributes for browser password managers
  assert.ok(
    /<form\b[^>]*\bmethod="post"[^>]*>/.test(source) &&
      /<form\b[^>]*\bnoValidate\b[^>]*>/.test(source),
    'Form must use method="post" and noValidate for browser password managers',
  );
  assert.ok(
    source.includes('name="username"'),
    'Username/identifier input must specify name="username" for autofill',
  );
  assert.ok(
    source.includes('autoComplete="username"'),
    'Username/identifier input must specify autoComplete="username"',
  );
  assert.ok(
    source.includes('name="password"'),
    'Password input must specify name="password" for autofill',
  );
  assert.ok(
    source.includes('autoComplete="current-password"'),
    'Password input must specify autoComplete="current-password"',
  );

  // 3. Password visibility toggle hidden by default
  assert.ok(
    source.includes('const [showPassword, setShowPassword] = useState(false);'),
    'Password must be hidden (showPassword=false) by default',
  );
  assert.ok(
    source.includes("type={showPassword ? 'text' : 'password'}"),
    'Input type must conditionally toggle between password and text',
  );
  assert.ok(
    source.includes(
      "aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}",
    ),
    'Toggle button must provide accessible Vietnamese aria-label',
  );

  // 4. Clear Vietnamese validation messages
  assert.ok(
    source.includes('Vui lòng nhập tên đăng nhập và mật khẩu.'),
    'Must provide clear Vietnamese empty input validation',
  );
  assert.ok(
    source.includes('Vui lòng nhập tên đăng nhập hoặc email.'),
    'Must provide clear Vietnamese missing identifier validation',
  );
  assert.ok(
    source.includes('Vui lòng nhập mật khẩu.'),
    'Must provide clear Vietnamese missing password validation',
  );
  assert.ok(
    source.includes('Tên đăng nhập hoặc mật khẩu không chính xác.'),
    'Must provide clear Vietnamese 401 error message',
  );
  assert.ok(
    source.includes('Quá nhiều lần thử đăng nhập.'),
    'Must provide clear Vietnamese 429 rate limit error message',
  );
  assert.ok(
    source.includes('Không thể kết nối đến máy chủ API.'),
    'Must provide clear Vietnamese network failure error message',
  );

  // 5. Design token adherence (2026-11-12 minimalist redesign: layout/colors
  // moved to shared CSS variables in tokens.css via the .login-* classes,
  // replacing the old dark two-column theme hardcoded in this file)
  assert.ok(
    source.includes('className="login-page"'),
    'Must use the .login-page design-token-driven class',
  );
  const loginAreaSource = source.slice(
    0,
    source.indexOf('Forgot Password') === -1
      ? source.length
      : source.indexOf('Forgot Password'),
  );
  assert.ok(
    !loginAreaSource.includes('#0B1220') &&
      !loginAreaSource.includes('#151F30') &&
      !loginAreaSource.includes('#14B8A6'),
    'The login form/branding area must not hardcode the old dark two-column theme tokens anymore',
  );
});

test('MGL-AUTH-LOGIN-UI-TOIGIAN-01: Minimalist centered single-column layout invariants (2026-11-12 design)', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // Single centered column wrapper & classes (docs/design/2026-11-12-toi-gian/Main.html)
  assert.ok(
    source.includes('login-page') && source.includes('login-container'),
    'Must define login-page/login-container wrapper classes',
  );
  assert.ok(
    source.includes('login-brand') && source.includes('login-logo-box'),
    'Must define login-brand/login-logo-box for the centered logo',
  );
  assert.ok(
    source.includes('login-brand-title') && source.includes('Management Lite'),
    'Must render the Management Lite brand title (styled uppercase via CSS text-transform)',
  );
  assert.ok(
    source.includes('login-form') && source.includes('login-field'),
    'Must define login-form/login-field classes for the form layout',
  );
  assert.ok(
    source.includes('login-submit-btn'),
    'Must define login-submit-btn for the primary action button',
  );
  assert.ok(
    source.includes('login-footer') && source.includes('zalo.me/0898843938'),
    'Must render the login-footer with the Zalo contact link',
  );

  // Old title/description removed per approved design
  assert.ok(
    !source.includes('Đăng nhập hệ thống'),
    'Must NOT render the old "Đăng nhập hệ thống" title anymore',
  );

  // No placeholder on labeled inputs (Quy tắc chung #6)
  assert.ok(
    !source.includes('placeholder='),
    'Labeled inputs must NOT use placeholder text',
  );

  // Strict avoidance of unapproved elements
  assert.ok(
    !source.toLowerCase().includes('qr code') && !source.includes('qr-code'),
    'Must NOT introduce unapproved QR code login',
  );
  assert.ok(
    !source.includes('language-select') && !source.includes('select-language'),
    'Must NOT introduce unapproved language switcher',
  );
});

test('MGL-AUTH-LOGIN-UI-FIX-21: Forgot Password modal accessibility, focus management, and keyboard trap invariants', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // Modal accessibility attributes
  assert.ok(source.includes('role="dialog"'), 'Modal must have role="dialog"');
  assert.ok(
    source.includes('aria-modal="true"'),
    'Modal must have aria-modal="true"',
  );
  assert.ok(
    source.includes('aria-labelledby="forgot-password-modal-title"'),
    'Modal must have aria-labelledby',
  );
  assert.ok(
    source.includes('aria-describedby="forgot-password-modal-desc"'),
    'Modal must have aria-describedby',
  );

  // Keyboard trap and Escape handler
  assert.ok(
    source.includes("e.key === 'Escape'"),
    'Must handle Escape key to close modal',
  );
  assert.ok(
    source.includes("e.key === 'Tab'"),
    'Must trap Tab / Shift+Tab keyboard focus inside modal',
  );
  assert.ok(
    source.includes("document.body.style.overflow = 'hidden'"),
    'Must lock body scroll while modal is active',
  );

  // Focus restore to trigger button
  assert.ok(
    source.includes('forgotTriggerRef.current?.focus()'),
    'Must restore focus to trigger button upon modal close',
  );

  // Accessible close button
  assert.ok(
    source.includes('aria-label="Đóng hộp thoại khôi phục mật khẩu"'),
    'Close button must have accessible Vietnamese aria-label',
  );

  // Safe recovery guidance content
  assert.ok(
    source.includes('Khôi phục quyền truy cập'),
    'Modal title must be present',
  );
  assert.ok(
    source.includes('Nhân viên (Staff)'),
    'Modal must provide guidance for Staff',
  );
  assert.ok(
    source.includes('Chủ sở hữu (Owner)'),
    'Modal must provide guidance for Owner',
  );
});

test('MGL-AUTH-LOGIN-UI-FIX-21 & AUTH-REMEMBER-01: Remember Me enabled state, remember_me payload, and HttpOnly cookie session guidance', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // Enabled Remember Me checkbox & payload forwarding
  assert.ok(
    source.includes('Ghi nhớ trên máy này'),
    'Remember Me label must be present (2026-11-12 design wording)',
  );
  assert.ok(
    source.includes('const [rememberMe, setRememberMe] = useState(false);'),
    'Remember Me state must default to false',
  );
  assert.ok(
    source.includes('checked={rememberMe}') &&
      source.includes('onChange={(e) => setRememberMe(e.target.checked)}'),
    'Remember Me checkbox must be interactive and bound to rememberMe state',
  );
  assert.ok(
    source.includes('remember_me: rememberMe'),
    'Login request body must pass remember_me boolean to /api/v1/auth/login',
  );
  assert.ok(
    !source.includes('Chưa hỗ trợ'),
    'Must NOT display outdated "Chưa hỗ trợ" disabled badge',
  );

  // Accurate cookie & session guidance
  assert.ok(
    source.includes('30 ngày') && source.includes('12 giờ'),
    'Must explain 30-day Remember Me and 12-hour standard HttpOnly cookie lifetime',
  );
});

test('MGL-AUTH-LOGIN-UI-18 & FIX-21: LoginScreen runtime React static markup rendering', async () => {
  const { LoginScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/LoginScreen.js')}`
  );

  const markup = renderToStaticMarkup(
    React.createElement(LoginScreen, {
      onLogin: () => {},
    }),
  );

  // 1. Minimalist centered single-column structure and branding
  assert.ok(markup.includes('login-page'), 'Must render login-page');
  assert.ok(markup.includes('login-container'), 'Must render login-container');
  assert.ok(markup.includes('login-brand'), 'Must render login-brand');
  assert.ok(
    markup.includes('Management Lite'),
    'Must render the Management Lite brand title (styled uppercase via CSS text-transform)',
  );
  assert.ok(
    !markup.includes('Phiên bảo mật C06'),
    'Must NOT render visible C06 security badge (MGL-UI-CLEANUP-VERSION-24)',
  );
  assert.ok(
    markup.includes('zalo.me/0898843938'),
    'Must render the Zalo contact link in the footer',
  );
  assert.ok(
    !markup.includes('Argon2id • HttpOnly Session Cookie'),
    'Must NOT render developer technical jargon in login footer',
  );
  assert.ok(
    !markup.includes('Đăng nhập hệ thống'),
    'Must NOT render the old "Đăng nhập hệ thống" title anymore',
  );

  // 2. Autofill and inputs
  assert.ok(
    markup.includes('method="post"'),
    'Must render form with method="post"',
  );
  assert.ok(
    markup.includes('name="username"') &&
      /autocomplete="username"/i.test(markup),
    'Must render username input with autocomplete="username"',
  );
  assert.ok(
    markup.includes('name="password"') &&
      markup.includes('type="password"') &&
      /autocomplete="current-password"/i.test(markup),
    'Must render password input with type="password" and autocomplete="current-password"',
  );

  // 3. Password toggle
  assert.ok(
    markup.includes('aria-label="Hiện mật khẩu"'),
    'Must render password toggle button with aria-label="Hiện mật khẩu"',
  );

  // 4. Remember Me: interactive checkbox and accurate session text
  assert.ok(
    markup.includes('Ghi nhớ trên máy này'),
    'Must render "Ghi nhớ trên máy này"',
  );
  assert.ok(
    markup.includes('id="remember-me"') &&
      markup.includes('name="remember_me"'),
    'Checkbox must have id="remember-me" and name="remember_me"',
  );
  assert.ok(
    !markup.includes('Chưa hỗ trợ'),
    'Must NOT render "Chưa hỗ trợ" tag',
  );
  assert.ok(
    markup.includes('30 ngày') && markup.includes('12 giờ'),
    'Must include 30-day and 12-hour session explanation',
  );

  // 5. Forgot Password trigger
  assert.ok(
    markup.includes('Quên mật khẩu?'),
    'Must render "Quên mật khẩu?" button',
  );
  assert.ok(markup.includes('Đăng nhập'), 'Must render submit button');
});
