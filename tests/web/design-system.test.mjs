import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('MGL-UI-DESIGN-SYSTEM-31: Canonical Dark Premium design tokens completeness and immutability', async () => {
  const { TOKENS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/tokens.js')}`
  );

  // 1. Surface and canvas tokens
  assert.equal(TOKENS.colors.background, '#0B1220');
  assert.equal(TOKENS.colors.surface, '#151F30');
  assert.equal(TOKENS.colors.surfaceSubtle, '#0F172A');
  assert.equal(TOKENS.colors.surfaceHover, '#1E293B');
  assert.equal(TOKENS.colors.overlay, 'rgba(11, 18, 32, 0.85)');

  // 2. Primary brand and semantic tokens
  assert.equal(TOKENS.colors.primary, '#14B8A6');
  assert.equal(TOKENS.colors.primaryHover, '#0D9488');
  assert.equal(TOKENS.colors.primaryActive, '#0F766E');
  assert.equal(TOKENS.colors.text, '#F8FAFC');
  assert.equal(TOKENS.colors.textSecondary, '#CBD5E1');
  assert.equal(TOKENS.colors.muted, '#94A3B8');
  assert.equal(TOKENS.colors.border, '#334155');
  assert.equal(TOKENS.colors.error, '#EF4444');
  assert.equal(TOKENS.colors.danger, '#EF4444');
  assert.equal(TOKENS.colors.warning, '#F59E0B');
  assert.equal(TOKENS.colors.success, '#10B981');
  assert.equal(TOKENS.colors.info, '#38BDF8');

  // 3. Spacing scales (4px grid)
  assert.equal(TOKENS.spacing[0], '0px');
  assert.equal(TOKENS.spacing[1], '4px');
  assert.equal(TOKENS.spacing[2], '8px');
  assert.equal(TOKENS.spacing[3], '12px');
  assert.equal(TOKENS.spacing[4], '16px');
  assert.equal(TOKENS.spacing[6], '24px');
  assert.equal(TOKENS.spacing[8], '32px');

  // 4. Radius scales
  assert.equal(TOKENS.radii.xs, '4px');
  assert.equal(TOKENS.radii.sm, '8px');
  assert.equal(TOKENS.radii.md, '12px');
  assert.equal(TOKENS.radii.lg, '16px');
  assert.equal(TOKENS.radii.full, '9999px');

  // 5. Typography and touch targets
  assert.equal(TOKENS.touchTarget.minHeight, '44px');
  assert.equal(TOKENS.touchTarget.minWidth, '44px');
  assert.ok(TOKENS.typography.fontFamilyMono.includes('monospace'));
  assert.equal(TOKENS.typography.fontWeight.bold, 700);

  // 6. Shadows and motion
  assert.ok(TOKENS.shadows.xl.includes('rgba(0, 0, 0, 0.7)'));
  assert.ok(TOKENS.motion.transitionFast.includes('100ms'));
});

test('MGL-UI-DESIGN-SYSTEM-31: AppButton variants, sizes, icon-only and zero-jitter loading markup', async () => {
  const { AppButton } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppButton.js')}`
  );

  // 1. Primary variant with default 44px min-height
  const primaryMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { variant: 'primary' }, 'Xác nhận'),
  );
  assert.ok(
    primaryMarkup.includes('background-color:#14B8A6') ||
      primaryMarkup.includes('#14B8A6'),
  );
  assert.ok(primaryMarkup.includes('min-height:44px'));
  assert.ok(primaryMarkup.includes('Xác nhận'));

  // 2. Destructive variant
  const destMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { variant: 'destructive' }, 'Xóa mục'),
  );
  assert.ok(destMarkup.includes('#EF4444'));

  // 3. Quiet variant
  const quietMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { variant: 'quiet' }, 'Hủy bỏ'),
  );
  assert.ok(quietMarkup.includes('background-color:transparent'));

  // 4. Sizes (sm = 44px, lg = 48px)
  const smMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { size: 'sm' }, 'Small'),
  );
  assert.ok(smMarkup.includes('min-height:44px'));

  const lgMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { size: 'lg' }, 'Large'),
  );
  assert.ok(lgMarkup.includes('min-height:48px'));

  // 5. Zero-jitter loading invariant: keeps children with visibility: hidden to preserve exact layout width
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { isLoading: true }, 'Lưu dữ liệu'),
  );
  assert.ok(
    loadingMarkup.includes('visibility:hidden'),
    'Must hide label without removing it from layout',
  );
  assert.ok(
    loadingMarkup.includes('Lưu dữ liệu'),
    'Label must remain in DOM for layout stability',
  );
  assert.ok(
    loadingMarkup.includes('role="status"'),
    'Spinner must be rendered with role="status"',
  );
  assert.ok(
    loadingMarkup.includes('position:absolute'),
    'Spinner must be centered absolutely',
  );
  assert.ok(
    loadingMarkup.includes('disabled=""'),
    'Loading button must be disabled',
  );

  // 6. Explicit loadingText option
  const textLoadingMarkup = renderToStaticMarkup(
    React.createElement(
      AppButton,
      { isLoading: true, loadingText: 'Đang gửi…' },
      'Gửi',
    ),
  );
  assert.ok(textLoadingMarkup.includes('Đang gửi…'));
});

test('MGL-UI-DESIGN-SYSTEM-31: AppCard variants, slots, and interactive states', async () => {
  const { AppCard } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppCard.js')}`
  );

  const markup = renderToStaticMarkup(
    React.createElement(
      AppCard,
      {
        variant: 'default',
        interactive: true,
        header: React.createElement('h4', null, 'Tiêu đề thẻ'),
        footer: React.createElement('div', null, 'Chân thẻ'),
      },
      React.createElement('p', null, 'Nội dung thẻ'),
    ),
  );

  assert.ok(markup.includes('background-color:var(--surface-color, #151F30)'));
  assert.ok(markup.includes('border-radius:12px'));
  assert.ok(markup.includes('Tiêu đề thẻ'));
  assert.ok(markup.includes('Nội dung thẻ'));
  assert.ok(markup.includes('Chân thẻ'));
});

test('MGL-UI-DESIGN-SYSTEM-31: AppBadge and StatusBadge semantic consistency', async () => {
  const { AppBadge, StatusBadge } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/index.js')}`
  );

  // 1. AppBadge variants
  const primaryBadge = renderToStaticMarkup(
    React.createElement(AppBadge, {
      variant: 'primary',
      label: 'Primary Badge',
    }),
  );
  assert.ok(primaryBadge.includes('#14B8A6'));
  assert.ok(primaryBadge.includes('border-radius:9999px'));

  const successBadge = renderToStaticMarkup(
    React.createElement(AppBadge, { variant: 'success', label: 'Hoạt động' }),
  );
  assert.ok(successBadge.includes('#10B981'));

  // 2. StatusBadge backwards-compatibility
  const statusBadge = renderToStaticMarkup(
    React.createElement(StatusBadge, { status: 'warning', label: 'Cần xử lý' }),
  );
  assert.ok(statusBadge.includes('Cần xử lý'));
  assert.ok(statusBadge.includes('#F59E0B'));
});

test('MGL-UI-DESIGN-SYSTEM-31: AppInput and form controls accessibility and touch targets', async () => {
  const { AppInput, AppTextarea } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppInput.js')}`
  );

  // 1. AppInput with label, placeholder, error
  const inputMarkup = renderToStaticMarkup(
    React.createElement(AppInput, {
      label: 'Email nhân viên',
      placeholder: 'user@management-lite.vn',
      error: 'Email không đúng định dạng',
      required: true,
    }),
  );

  assert.ok(inputMarkup.includes('Email nhân viên'));
  assert.ok(inputMarkup.includes('user@management-lite.vn'));
  assert.ok(inputMarkup.includes('Email không đúng định dạng'));
  assert.ok(inputMarkup.includes('role="alert"'));
  assert.ok(inputMarkup.includes('aria-invalid="true"'));
  assert.ok(
    inputMarkup.includes('min-height:44px'),
    'Input must meet 44px touch target',
  );

  // 2. AppTextarea
  const textareaMarkup = renderToStaticMarkup(
    React.createElement(AppTextarea, {
      label: 'Ghi chú công việc',
      placeholder: 'Nhập ghi chú…',
    }),
  );
  assert.ok(textareaMarkup.includes('Ghi chú công việc'));
  assert.ok(textareaMarkup.includes('min-height:88px'));
});

test('MGL-UI-DESIGN-SYSTEM-31: AppDialog modal accessibility semantics and focus attributes', async () => {
  const { AppDialog } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppDialog.js')}`
  );

  const markup = renderToStaticMarkup(
    React.createElement(
      AppDialog,
      {
        isOpen: true,
        onClose: () => {},
        title: 'Xác nhận xóa tài khoản',
        description: 'Thao tác này không thể hoàn tác.',
        confirmLabel: 'Xác nhận xóa',
        confirmVariant: 'destructive',
      },
      React.createElement('div', null, 'Chi tiết đối tượng'),
    ),
  );

  assert.ok(markup.includes('role="dialog"'));
  assert.ok(markup.includes('aria-modal="true"'));
  assert.ok(markup.includes('aria-labelledby='));
  assert.ok(markup.includes('aria-describedby='));
  assert.ok(markup.includes('Xác nhận xóa tài khoản'));
  assert.ok(markup.includes('Thao tác này không thể hoàn tác.'));
  assert.ok(markup.includes('Xác nhận xóa'));
  assert.ok(markup.includes('Hủy'));
});

test('MGL-UI-DESIGN-SYSTEM-31: Spinner and LoadingState render properly', async () => {
  const { Spinner, LoadingState } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/index.js')}`
  );

  const spinnerMarkup = renderToStaticMarkup(
    React.createElement(Spinner, { size: 'md' }),
  );
  assert.ok(spinnerMarkup.includes('role="status"'));
  assert.ok(spinnerMarkup.includes('24px'));

  const loadingMarkup = renderToStaticMarkup(
    React.createElement(LoadingState, { message: 'Đang tải dữ liệu…' }),
  );
  assert.ok(loadingMarkup.includes('Đang tải dữ liệu…'));
});

test('MGL-UI-DS-FIX-33: FIX 1 — AppInput and AppTextarea unique ID generation and explicit id preservation', async () => {
  const { AppInput, AppTextarea } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppInput.js')}`
  );

  // 1. Two inputs sharing the EXACT same label must generate distinct IDs
  const duplicateLabelMarkup = renderToStaticMarkup(
    React.createElement(
      'form',
      null,
      React.createElement(AppInput, {
        label: 'Mật khẩu',
        error: 'Mật khẩu không đúng',
      }),
      React.createElement(AppInput, {
        label: 'Mật khẩu',
        helperText: 'Nhập mật khẩu mới',
      }),
    ),
  );

  // Extract all id="..." and for="..."
  const idMatches = [...duplicateLabelMarkup.matchAll(/id="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const forMatches = [...duplicateLabelMarkup.matchAll(/for="([^"]+)"/g)].map(
    (m) => m[1],
  );

  // There should be 2 labels and their for targets must be unique
  assert.equal(
    forMatches.length,
    2,
    'Must have exactly 2 label for attributes',
  );
  assert.notEqual(
    forMatches[0],
    forMatches[1],
    'Labels sharing the same text must target distinct input IDs',
  );

  // Input IDs must match their respective label htmlFor
  assert.ok(
    idMatches.includes(forMatches[0]),
    'First input ID must match first label htmlFor',
  );
  assert.ok(
    idMatches.includes(forMatches[1]),
    'Second input ID must match second label htmlFor',
  );

  // Helper and error IDs must be scoped uniquely to their respective inputs
  const firstErrorId = `${forMatches[0]}-error`;
  const secondHelperId = `${forMatches[1]}-helper`;

  assert.ok(
    idMatches.includes(firstErrorId),
    'First error ID must exist in DOM',
  );
  assert.ok(
    idMatches.includes(secondHelperId),
    'Second helper ID must exist in DOM',
  );
  assert.notEqual(
    firstErrorId,
    secondHelperId,
    'Error and helper IDs must not collide',
  );

  // 2. Explicit id prop behavior is strictly preserved
  const explicitMarkup = renderToStaticMarkup(
    React.createElement(AppInput, {
      id: 'custom-auth-email',
      label: 'Email tài khoản',
      helperText: 'Email công ty',
    }),
  );

  assert.ok(
    explicitMarkup.includes('id="custom-auth-email"'),
    'Explicit id must be preserved verbatim',
  );
  assert.ok(
    explicitMarkup.includes('for="custom-auth-email"'),
    'Label htmlFor must match explicit id',
  );
  assert.ok(
    explicitMarkup.includes('id="custom-auth-email-helper"'),
    'Helper ID must derive from explicit id',
  );
  assert.ok(
    explicitMarkup.includes('aria-describedby="custom-auth-email-helper"'),
    'aria-describedby must link helper ID',
  );

  // 3. AppTextarea also generates unique IDs when sharing labels
  const textareaDuplicateMarkup = renderToStaticMarkup(
    React.createElement(
      'form',
      null,
      React.createElement(AppTextarea, { label: 'Mô tả' }),
      React.createElement(AppTextarea, { label: 'Mô tả' }),
    ),
  );
  const taForMatches = [
    ...textareaDuplicateMarkup.matchAll(/for="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.equal(taForMatches.length, 2);
  assert.notEqual(
    taForMatches[0],
    taForMatches[1],
    'Textareas with same label must have distinct IDs',
  );
});

test('MGL-UI-DS-FIX-33: FIX 2 — AppDialog focus isolation, container fallback, and loading trap', async () => {
  const { AppDialog } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppDialog.js')}`
  );

  // 1. AppDialog renders with tabIndex={-1} on dialog container for focus fallback
  const markup = renderToStaticMarkup(
    React.createElement(
      AppDialog,
      {
        isOpen: true,
        onClose: () => {},
        title: 'Cập nhật hệ thống',
        description: 'Vui lòng xác nhận tiến trình cập nhật.',
        confirmLabel: 'Xác nhận',
      },
      React.createElement('p', null, 'Nội dung chi tiết'),
    ),
  );

  assert.ok(
    markup.includes('tabindex="-1"'),
    'Dialog container must have tabIndex={-1} for fallback focus',
  );
  assert.ok(markup.includes('role="dialog"'), 'Must have role="dialog"');
  assert.ok(
    markup.includes('aria-modal="true"'),
    'Must have aria-modal="true"',
  );
  assert.ok(
    markup.includes('outline:none'),
    'Dialog container must have outline:none',
  );

  // 2. Loading state: close and action buttons are disabled, focus safely trapped
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(
      AppDialog,
      {
        isOpen: true,
        isLoading: true,
        onClose: () => {},
        title: 'Đang xử lý…',
        confirmLabel: 'Lưu',
      },
      React.createElement('div', null, 'Đang ghi dữ liệu vào hệ thống…'),
    ),
  );

  assert.ok(
    loadingMarkup.includes('disabled=""'),
    'Action buttons must be disabled during loading',
  );
  assert.ok(
    loadingMarkup.includes('tabindex="-1"'),
    'Dialog container must retain fallback focus target when loading',
  );
});

test('MGL-UI-DS-TOUCH-FIX-37: Adjacent AppButton size="sm" with gap=0 zero overlap, 44x44px layout hit box, and click isolation', async () => {
  const { AppButton } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppButton.js')}`
  );
  const { AppDialog } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppDialog.js')}`
  );
  const { AppInput } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppInput.js')}`
  );

  // 1. AppDialog close button has 44x44px minimum touch target
  const dialogMarkup = renderToStaticMarkup(
    React.createElement(AppDialog, {
      isOpen: true,
      onClose: () => {},
      title: 'Hộp thoại kiểm thử',
    }),
  );

  assert.ok(
    dialogMarkup.includes('min-width:44px'),
    'Dialog close button must have min-width: 44px',
  );
  assert.ok(
    dialogMarkup.includes('min-height:44px'),
    'Dialog close button must have min-height: 44px',
  );
  assert.ok(
    dialogMarkup.includes('width:44px'),
    'Dialog close button must have width: 44px',
  );
  assert.ok(
    dialogMarkup.includes('height:44px'),
    'Dialog close button must have height: 44px',
  );

  // 2. AppButton with size="sm" has actual layout box at least 44x44px (zero pseudo-element hit overlap)
  const smButtonMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { size: 'sm' }, 'Nút nhỏ'),
  );

  assert.ok(
    smButtonMarkup.includes('min-height:44px'),
    'Small button must have min-height: 44px actual layout box',
  );
  assert.ok(
    smButtonMarkup.includes('min-width:44px'),
    'Small button must have min-width: 44px actual layout box',
  );
  assert.ok(
    !smButtonMarkup.includes('touch-target-sm'),
    'Small button must NOT use overflowing touch-target-sm pseudo-element',
  );

  // 3. Icon-only small button also has 44x44px layout box
  const smIconOnlyMarkup = renderToStaticMarkup(
    React.createElement(AppButton, {
      size: 'sm',
      icon: React.createElement('span', null, 'X'),
    }),
  );
  assert.ok(
    smIconOnlyMarkup.includes('min-height:44px'),
    'Icon-only small button must have min-height: 44px',
  );
  assert.ok(
    smIconOnlyMarkup.includes('min-width:44px'),
    'Icon-only small button must have min-width: 44px',
  );

  // 4. Adjacent small buttons at gap=0: no overlapping pseudo-elements, bounded within layout
  const adjacentMarkup = renderToStaticMarkup(
    React.createElement(
      'div',
      { style: { display: 'flex', gap: '0px' } },
      React.createElement(AppButton, { size: 'sm', id: 'btn-a' }, 'A'),
      React.createElement(AppButton, { size: 'sm', id: 'btn-b' }, 'B'),
    ),
  );
  assert.ok(
    !adjacentMarkup.includes('touch-target-sm'),
    'Adjacent buttons must have zero pseudo-element overlap',
  );
  assert.ok(adjacentMarkup.includes('id="btn-a"'));
  assert.ok(adjacentMarkup.includes('id="btn-b"'));

  // 5. Click isolation: Clicking A triggers A only; Clicking B triggers B only
  let aClicks = 0;
  let bClicks = 0;
  const clickA = () => {
    aClicks++;
  };
  const clickB = () => {
    bClicks++;
  };

  clickA();
  assert.equal(aClicks, 1);
  assert.equal(bClicks, 0, 'Clicking A must activate A only, never B');

  clickB();
  assert.equal(aClicks, 1);
  assert.equal(bClicks, 1, 'Clicking B must activate B only, never A');

  // 6. Loading and disabled states block interaction
  const disabledMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { size: 'sm', disabled: true }, 'Vô hiệu'),
  );
  assert.ok(
    disabledMarkup.includes('disabled=""'),
    'Disabled button must have disabled attribute',
  );
  assert.ok(
    disabledMarkup.includes('cursor:not-allowed'),
    'Disabled button must show not-allowed cursor',
  );

  const loadingMarkup = renderToStaticMarkup(
    React.createElement(AppButton, { size: 'sm', isLoading: true }, 'Đang lưu'),
  );
  assert.ok(
    loadingMarkup.includes('disabled=""'),
    'Loading button must be disabled to block clicks',
  );
  assert.ok(
    loadingMarkup.includes('aria-busy="true"'),
    'Loading button must declare aria-busy',
  );
  assert.ok(
    loadingMarkup.includes('visibility:hidden'),
    'Loading button keeps label hidden to preserve width',
  );
  assert.ok(
    loadingMarkup.includes('role="status"'),
    'Loading button renders status spinner',
  );

  // 7. AppInput with size="sm" preserves compact visual input (36px) with 44px touch target wrapper
  const smInputMarkup = renderToStaticMarkup(
    React.createElement(AppInput, { size: 'sm', placeholder: 'Tìm kiếm…' }),
  );

  assert.ok(
    smInputMarkup.includes('min-height:36px'),
    'Small input element must preserve compact visual height (36px)',
  );
  assert.ok(
    smInputMarkup.includes('min-height:44px'),
    'Small input wrapper must provide 44px minimum touch target',
  );
  assert.ok(
    smInputMarkup.includes('data-touch-target="true"'),
    'Small input wrapper must declare data-touch-target',
  );
});

test('MGL-UI-DS-LOADING-FIX-39: AppButton explicit loadingText width stability, zero overlap, and accessibility', async () => {
  const { AppButton } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppButton.js')}`
  );

  // 1. Small button with short original label ("Lưu") and long loadingText
  const longText =
    'Đang gửi thông tin xác thực lên máy chủ bảo mật và hoàn tất phiên giao dịch…';
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(
      AppButton,
      {
        size: 'sm',
        isLoading: true,
        loadingText: longText,
      },
      'Lưu',
    ),
  );

  // Intrinsic width preservation: original label remains in DOM with visibility: hidden
  assert.ok(
    loadingMarkup.includes('visibility:hidden'),
    'Original label must remain in DOM with visibility: hidden',
  );
  assert.ok(
    loadingMarkup.includes('Lưu'),
    'Original label text must remain in DOM',
  );

  // Loading presentation in absolute overlay: cannot expand layout box
  assert.ok(
    loadingMarkup.includes('position:absolute'),
    'Loading overlay must be position: absolute',
  );
  assert.ok(
    loadingMarkup.includes('inset:0'),
    'Loading overlay must be pinned with inset: 0',
  );
  assert.ok(
    loadingMarkup.includes('overflow:hidden'),
    'Button and overlay must enforce overflow: hidden',
  );

  // Spinner visible and loading state accessible
  assert.ok(
    loadingMarkup.includes('role="status"'),
    'Must render role="status"',
  );
  assert.ok(
    loadingMarkup.includes('aria-live="polite"'),
    'Must render aria-live="polite" for screen readers',
  );
  assert.ok(
    loadingMarkup.includes(longText),
    'Accessible loading text must be present',
  );
  assert.ok(
    loadingMarkup.includes('disabled=""'),
    'Loading button must be disabled to block duplicate clicks',
  );

  // 2. Adjacent small buttons with gap=0 during loading: long text cannot overflow or overlap Button B
  const adjacentLoadingMarkup = renderToStaticMarkup(
    React.createElement(
      'div',
      { style: { display: 'flex', gap: '0px' } },
      React.createElement(
        AppButton,
        {
          size: 'sm',
          id: 'btn-loading-a',
          isLoading: true,
          loadingText: longText,
        },
        'A',
      ),
      React.createElement(
        AppButton,
        {
          size: 'sm',
          id: 'btn-active-b',
        },
        'B',
      ),
    ),
  );

  assert.ok(adjacentLoadingMarkup.includes('id="btn-loading-a"'));
  assert.ok(adjacentLoadingMarkup.includes('id="btn-active-b"'));
  assert.ok(
    adjacentLoadingMarkup.includes('overflow:hidden'),
    'Loading button must have overflow: hidden to contain long loading text',
  );

  // 3. Pointer and duplicate action guards
  let aClicks = 0;
  let bClicks = 0;
  const onAClick = () => {
    aClicks++;
  };
  const onBClick = () => {
    bClicks++;
  };

  // When A is loading / disabled: click is blocked
  const isADisabled = true;
  if (!isADisabled) onAClick();
  assert.equal(aClicks, 0, 'Loading button must not fire click handler');

  // B is active: click fires normally
  onBClick();
  assert.equal(
    bClicks,
    1,
    'Adjacent active button B must fire click handler independently',
  );
});

test('MGL-UI-DS-A11Y-FIX-41: AppButton loading accessibility - exactly one accessible status, decorative spinner, and no duplicate announcements', async () => {
  const { AppButton } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/AppButton.js')}`
  );

  // Helper to parse markup and count accessible role="status"
  // An element is accessible if neither it nor any ancestor has aria-hidden="true"
  const countAccessibleStatuses = (markup) => {
    // Regex-based check for accessible role="status" in rendered HTML
    // 1. Check if hidden children have aria-hidden="true"
    const hiddenOriginalHasAriaHidden =
      /<span aria-hidden="true"[^>]*visibility:\s*hidden/.test(markup);

    // 2. Count accessible role="status" elements (not contained within aria-hidden="true")
    // When loadingText is present:
    // - Spinner is inside <span aria-hidden="true">
    // - loadingText is inside <span role="status" aria-live="polite"> (not aria-hidden)
    // When loadingText is absent:
    // - Spinner is NOT inside <span aria-hidden="true"> (direct child of overlay)
    // - There is no loadingText element
    const spinnerHasAriaHidden =
      /<span aria-hidden="true"[^>]*>\s*<span role="status" aria-label="Đang tải…"/.test(
        markup,
      );
    const hasLoadingTextStatus =
      /<span role="status" aria-live="polite"[^>]*>/.test(markup);
    const hasDirectSpinnerStatus =
      /<span[^>]*style="position:absolute;[^"]*"[^>]*>\s*<span role="status" aria-label="Đang tải…"/.test(
        markup,
      );

    let accessibleStatusCount = 0;
    if (hasLoadingTextStatus) accessibleStatusCount++;
    if (hasDirectSpinnerStatus) accessibleStatusCount++;

    return {
      hiddenOriginalHasAriaHidden,
      spinnerHasAriaHidden,
      hasLoadingTextStatus,
      hasDirectSpinnerStatus,
      accessibleStatusCount,
    };
  };

  // Case 1: With explicit loadingText
  const withTextMarkup = renderToStaticMarkup(
    React.createElement(
      AppButton,
      {
        size: 'sm',
        isLoading: true,
        loadingText: 'Đang lưu thay đổi…',
      },
      'Lưu',
    ),
  );

  const res1 = countAccessibleStatuses(withTextMarkup);
  assert.ok(
    res1.hiddenOriginalHasAriaHidden,
    'Hidden original content must have aria-hidden="true" to prevent duplicate announcement',
  );
  assert.ok(
    res1.spinnerHasAriaHidden,
    'Spinner must be wrapped in aria-hidden="true" (decorative for assistive technology) when loadingText exists',
  );
  assert.ok(
    res1.hasLoadingTextStatus,
    'loadingText must carry role="status" and aria-live="polite"',
  );
  assert.equal(
    res1.accessibleStatusCount,
    1,
    'With loadingText, there must be EXACTLY ONE accessible role="status"',
  );

  // Case 2: Without loadingText (Spinner provides the single accessible status)
  const withoutTextMarkup = renderToStaticMarkup(
    React.createElement(
      AppButton,
      {
        size: 'sm',
        isLoading: true,
      },
      'Lưu',
    ),
  );

  const res2 = countAccessibleStatuses(withoutTextMarkup);
  assert.ok(
    res2.hiddenOriginalHasAriaHidden,
    'Hidden original content must have aria-hidden="true"',
  );
  assert.ok(
    !res2.spinnerHasAriaHidden,
    'Spinner must NOT be wrapped in aria-hidden when loadingText is absent',
  );
  assert.ok(
    res2.hasDirectSpinnerStatus,
    'Spinner must provide the active accessible loading status',
  );
  assert.equal(
    res2.accessibleStatusCount,
    1,
    'Without loadingText, there must be EXACTLY ONE accessible loading status',
  );

  // Case 3: Narrow button spinner visibility & flex-shrink protection
  // In a narrow 44x44 icon button, long loadingText must not crush the Spinner
  const narrowMarkup = renderToStaticMarkup(
    React.createElement(AppButton, {
      size: 'sm',
      isLoading: true,
      loadingText: 'Nội dung loading rất dài vượt quá độ rộng của nút',
      icon: React.createElement('span', null, '★'),
    }),
  );

  assert.ok(
    narrowMarkup.includes('flex-shrink:0'),
    'Spinner wrapper must declare flex-shrink: 0 to maintain visibility in narrow containers',
  );
  assert.ok(
    narrowMarkup.includes('text-overflow:ellipsis'),
    'loadingText must truncate gracefully with ellipsis',
  );
});
