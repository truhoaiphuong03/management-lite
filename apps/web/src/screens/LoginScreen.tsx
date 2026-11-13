import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  AppButton,
  AlertTriangleIcon,
  EyeIcon,
  LockIcon,
  CloseIcon,
  ShieldAlertIcon,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import { SYSTEM_VERSION } from '../../../../packages/contracts/src/version.js';

export interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
  onNavigate?: (path: string) => void;
}

const EyeOffIcon: React.FC<{ size?: number; style?: React.CSSProperties }> = ({
  size = 20,
  style,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{
      display: 'inline-block',
      verticalAlign: 'middle',
      flexShrink: 0,
      ...style,
    }}
  >
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
);

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  onNavigate,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useAutoDismiss(errorMessage, () => setErrorMessage(null), 5000);
  const [invalidField, setInvalidField] = useState<
    'identifier' | 'password' | 'both' | null
  >(null);
  const [showForgotModal, setShowForgotModal] = useState(false);
  // prettier-ignore
  const [focusTarget, setFocusTarget] = useState<'identifier' | 'password' | null>(null);

  // Field input refs for accessible validation focus
  const identifierInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && focusTarget) {
      if (focusTarget === 'identifier') {
        identifierInputRef.current?.focus();
      } else if (focusTarget === 'password') {
        passwordInputRef.current?.focus();
      }
      setFocusTarget(null);
    }
  }, [isLoading, focusTarget]);

  // Focus management refs for accessible dialog
  const forgotTriggerRef = useRef<HTMLButtonElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const handleOpenForgotModal = () => {
    setShowForgotModal(true);
  };

  const handleCloseForgotModal = useCallback(() => {
    setShowForgotModal(false);
    setTimeout(() => {
      forgotTriggerRef.current?.focus();
    }, 0);
  }, []);

  // Modal keyboard accessibility: focus trap, Escape key, and scroll lock
  useEffect(() => {
    if (!showForgotModal) return;

    const timer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 40);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseForgotModal();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalContainerRef.current) return;
        const focusable =
          modalContainerRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showForgotModal, handleCloseForgotModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = identifier.trim();

    if (!cleanId && !password) {
      setErrorMessage('Vui lòng nhập tên đăng nhập và mật khẩu.');
      setInvalidField('both');
      identifierInputRef.current?.focus();
      return;
    }
    if (!cleanId) {
      setErrorMessage('Vui lòng nhập tên đăng nhập hoặc email.');
      setInvalidField('identifier');
      identifierInputRef.current?.focus();
      return;
    }
    if (!password) {
      setErrorMessage('Vui lòng nhập mật khẩu.');
      setInvalidField('password');
      passwordInputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setInvalidField(null);
    setFocusTarget(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          identifier: cleanId,
          password,
          remember_me: rememberMe,
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.success) {
        // Canonical doc 44: Secret fields clear on error/close; preserve entered nonsecret data
        setPassword('');
        setInvalidField('password');
        setFocusTarget('password');

        if (res.status === 401) {
          setErrorMessage('Tên đăng nhập hoặc mật khẩu không chính xác.');
          return;
        }
        if (res.status === 429) {
          setErrorMessage(
            'Quá nhiều lần thử đăng nhập. Vui lòng đợi trong giây lát rồi thử lại.',
          );
          return;
        }

        const primaryMessage = body?.error?.message;
        const detailMessage = body?.error?.details?.[0]?.message;
        const fullMessage =
          primaryMessage && detailMessage && primaryMessage !== detailMessage
            ? `${primaryMessage}. ${detailMessage}`
            : primaryMessage ||
              'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.';
        setErrorMessage(fullMessage);
        return;
      }

      const role = body.data?.active_workspace?.role as UserRole;
      onLogin(role || 'staff');
    } catch {
      // Canonical doc 44: Secret fields clear on error/close
      setPassword('');
      setInvalidField('password');
      setFocusTarget('password');

      setErrorMessage(
        'Không thể kết nối đến máy chủ API. Vui lòng kiểm tra kết nối mạng và thử lại sau.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page" data-app-version={SYSTEM_VERSION}>
      <div className="login-container">
        <div className="login-brand">
          <div className="login-logo-box">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
              <path d="m3 8 9 5 9-5M12 13v8" />
            </svg>
          </div>
          <span className="login-brand-title">Management Lite</span>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div
            id="login-error-alert"
            role="alert"
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              backgroundColor: 'var(--danger-subtle, rgba(239, 68, 68, 0.1))',
              border: '1px solid var(--danger-color, rgba(239, 68, 68, 0.3))',
              marginTop: '20px',
              marginBottom: '-20px',
              fontSize: '13px',
              color: 'var(--danger-text)',
              lineHeight: 1.4,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}
          >
            <AlertTriangleIcon
              size={18}
              style={{ flexShrink: 0, marginTop: '2px' }}
            />
            <span style={{ flex: 1 }}>{errorMessage}</span>
          </div>
        )}

        {/* Login Form */}
        <form
          className="login-form"
          onSubmit={handleSubmit}
          method="post"
          noValidate
        >
          {/* Identifier Input */}
          <div className="login-field">
            <label htmlFor="identifier" className="login-label">
              Tài khoản
            </label>
            <input
              ref={identifierInputRef}
              id="identifier"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              value={identifier}
              aria-invalid={
                invalidField === 'identifier' || invalidField === 'both'
                  ? 'true'
                  : undefined
              }
              aria-describedby={
                errorMessage &&
                (invalidField === 'identifier' || invalidField === 'both')
                  ? 'login-error-alert'
                  : undefined
              }
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (invalidField === 'identifier' || invalidField === 'both') {
                  setInvalidField(invalidField === 'both' ? 'password' : null);
                }
              }}
              disabled={isLoading}
              className="login-input"
              style={
                invalidField === 'identifier' || invalidField === 'both'
                  ? { borderColor: 'var(--danger-color, #ef4444)' }
                  : undefined
              }
            />
          </div>

          {/* Password Input with Show/Hide Toggle */}
          <div className="login-field">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <label htmlFor="password" className="login-label">
                Mật khẩu
              </label>
            </div>

            <div style={{ position: 'relative' }}>
              <input
                ref={passwordInputRef}
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                aria-invalid={
                  invalidField === 'password' || invalidField === 'both'
                    ? 'true'
                    : undefined
                }
                aria-describedby={
                  errorMessage &&
                  (invalidField === 'password' || invalidField === 'both')
                    ? 'login-error-alert'
                    : undefined
                }
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (invalidField === 'password' || invalidField === 'both') {
                    setInvalidField(
                      invalidField === 'both' ? 'identifier' : null,
                    );
                  }
                }}
                disabled={isLoading}
                className="login-input login-input-password"
                style={
                  invalidField === 'password' || invalidField === 'both'
                    ? { borderColor: 'var(--danger-color, #ef4444)' }
                    : undefined
                }
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                disabled={isLoading}
                className="login-eye-btn"
              >
                {showPassword ? (
                  <EyeOffIcon size={20} />
                ) : (
                  <EyeIcon size={20} />
                )}
              </button>
            </div>
          </div>

          {/* Row: Remember Me & Forgot Password */}
          <div className="login-options-row">
            <label
              htmlFor="remember-me"
              className="login-remember-label"
              title="Duy trì phiên làm việc an toàn qua HttpOnly cookie lên đến 30 ngày trên trình duyệt này (hoặc phiên tiêu chuẩn 12 giờ nếu không chọn)."
            >
              <input
                id="remember-me"
                name="remember_me"
                type="checkbox"
                disabled={isLoading}
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="login-remember-checkbox"
              />
              Ghi nhớ trên máy này
            </label>

            <a
              ref={
                forgotTriggerRef as unknown as React.RefObject<HTMLAnchorElement>
              }
              href="/forgot-password"
              onClick={(e) => {
                e.preventDefault();
                if (onNavigate) {
                  onNavigate('/forgot-password');
                } else {
                  handleOpenForgotModal();
                }
              }}
              className="login-forgot-link"
            >
              Quên mật khẩu?
            </a>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="login-submit-btn"
          >
            {isLoading ? 'Đang xác thực…' : 'Đăng nhập'}
          </button>
        </form>

        <p className="login-footer">
          Liên hệ:{' '}
          <a
            href="https://zalo.me/0898843938"
            target="_blank"
            rel="noopener noreferrer"
            className="login-footer-link"
          >
            089.884.3938
          </a>{' '}
          - Hoài Phương
        </p>
      </div>

      {/* Forgot Password Safe Recovery Guidance Accessible Modal */}
      {showForgotModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-password-modal-title"
          aria-describedby="forgot-password-modal-desc"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(11, 18, 32, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
          onClick={handleCloseForgotModal}
        >
          <div
            ref={modalContainerRef}
            style={{
              backgroundColor: 'var(--surface-color, #151F30)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(20, 184, 166, 0.1)',
                    color: 'var(--accent-text)',
                  }}
                >
                  <LockIcon size={18} />
                </div>
                <h3
                  id="forgot-password-modal-title"
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                    margin: 0,
                  }}
                >
                  Khôi phục quyền truy cập
                </h3>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={handleCloseForgotModal}
                aria-label="Đóng hộp thoại khôi phục mật khẩu"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  minWidth: '36px',
                  minHeight: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div
              id="forgot-password-modal-desc"
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <p style={{ marginTop: 0, marginBottom: '14px' }}>
                Vì lý do an toàn dữ liệu và tuân thủ chính sách bảo mật nội bộ,
                Management Lite không hỗ trợ tính năng đặt lại mật khẩu tự động
                qua email công khai nhằm tránh rủi ro dò quét tài khoản.
              </p>

              <div
                style={{
                  backgroundColor: 'var(--bg-color, #0B1220)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--accent-text)',
                    marginBottom: '8px',
                    fontSize: '13px',
                  }}
                >
                  Quy trình khôi phục được cấp phép:
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <li>
                    <strong>Nhân viên (Staff):</strong> Vui lòng liên hệ trực
                    tiếp Quản trị viên (Chủ sở hữu) của cửa hàng / workspace để
                    được cấp lại mật khẩu truy cập mới.
                  </li>
                  <li>
                    <strong>Chủ sở hữu (Owner):</strong> Sử dụng kịch bản quản
                    trị máy chủ nội bộ được bảo vệ hoặc liên hệ kỹ thuật viên
                    vận hành hệ thống.
                  </li>
                </ul>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  marginBottom: '20px',
                }}
              >
                <ShieldAlertIcon
                  size={16}
                  style={{ color: 'var(--warning-text)', flexShrink: 0 }}
                />
                <span>
                  Không cung cấp mật khẩu hoặc mã phiên cho bất kỳ đối tượng nào
                  bên ngoài.
                </span>
              </div>
            </div>

            {/* Modal Action */}
            <AppButton
              variant="primary"
              fullWidth
              onClick={handleCloseForgotModal}
              style={{ minHeight: '40px', fontSize: '14px' }}
            >
              Đã hiểu
            </AppButton>
          </div>
        </div>
      )}
    </div>
  );
};
