import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  AppButton,
  BuildingIcon,
  AlertTriangleIcon,
  EyeIcon,
  LockIcon,
  CloseIcon,
  ShieldAlertIcon,
  ClockIcon,
  ClipboardListIcon,
  CheckCircleIcon,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import { SYSTEM_VERSION } from '../../../../packages/contracts/src/version.js';

export interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
  onNavigate?: (path: string) => void;
}

const EyeOffIcon: React.FC<{ size?: number; style?: React.CSSProperties }> = ({
  size = 18,
  style,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px 16px',
        backgroundColor: '#0B1220',
        boxSizing: 'border-box',
      }}
    >
      {/* Responsive layout container */}
      <div className="login-card-container">
        {/* Left Column: Management Lite Branding & Visual Identity (Desktop only) */}
        <div className="login-brand-panel">
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '56px',
                borderRadius: '14px',
                backgroundColor: 'rgba(20, 184, 166, 0.1)',
                border: '1px solid rgba(20, 184, 166, 0.25)',
                color: '#14B8A6',
                marginBottom: '18px',
              }}
            >
              <BuildingIcon size={30} />
            </div>
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 800,
                color: '#F8FAFC',
                margin: '0 0 8px 0',
                letterSpacing: '-0.02em',
              }}
            >
              Management Lite
            </h1>
            <p
              style={{
                fontSize: '13px',
                color: '#94A3B8',
                margin: '0 0 24px 0',
                lineHeight: 1.5,
              }}
            >
              Hệ thống quản lý vận hành cửa hàng &amp; nhân sự chuyên nghiệp,
              tối ưu hóa năng suất và kiểm soát phiên an toàn.
            </p>

            {/* Visual Identity Highlights */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                marginTop: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid #1E293B',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(20, 184, 166, 0.15)',
                    color: '#14B8A6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <ClockIcon size={16} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#F1F5F9',
                      marginBottom: '2px',
                    }}
                  >
                    Ca &amp; Chấm công
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#94A3B8',
                      lineHeight: 1.4,
                    }}
                  >
                    Theo dõi chấm công, lịch biểu và phê duyệt công minh bạch.
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid #1E293B',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(20, 184, 166, 0.15)',
                    color: '#14B8A6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <ClipboardListIcon size={16} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#F1F5F9',
                      marginBottom: '2px',
                    }}
                  >
                    Công việc &amp; Báo cáo
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#94A3B8',
                      lineHeight: 1.4,
                    }}
                  >
                    Điều phối giao việc, tiến độ tác vụ và tổng hợp báo cáo.
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid #1E293B',
                }}
              >
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(20, 184, 166, 0.15)',
                    color: '#14B8A6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '2px',
                  }}
                >
                  <CheckCircleIcon size={16} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#F1F5F9',
                      marginBottom: '2px',
                    }}
                  >
                    Bảo mật &amp; Phân quyền
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#94A3B8',
                      lineHeight: 1.4,
                    }}
                  >
                    Phân định rõ ràng quyền hạn giữa Quản trị viên và Nhân viên.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Left Footer Note */}
          <div
            style={{
              paddingTop: '20px',
              borderTop: '1px solid #1E293B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '12px', color: '#64748B' }}>
              Hệ thống quản lý nội bộ
            </span>
            <span style={{ fontSize: '11px', color: '#64748B' }}>
              v{SYSTEM_VERSION}
            </span>
          </div>
        </div>

        {/* Right Column: Clean Login Form */}
        <div className="login-form-panel">
          {/* Mobile-only Brand Header */}
          <div className="mobile-brand-header">
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                backgroundColor: 'rgba(20, 184, 166, 0.1)',
                border: '1px solid rgba(20, 184, 166, 0.25)',
                color: '#14B8A6',
                marginBottom: '12px',
              }}
            >
              <BuildingIcon size={28} />
            </div>
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: '#F8FAFC',
                marginBottom: '4px',
                letterSpacing: '-0.02em',
              }}
            >
              Management Lite
            </h2>
            <p
              style={{
                fontSize: '12px',
                color: '#94A3B8',
                margin: '0 0 10px 0',
              }}
            >
              Hệ thống quản lý vận hành cửa hàng &amp; nhân sự
            </p>
          </div>

          {/* Form Header */}
          <div style={{ marginBottom: '22px' }}>
            <h2
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: '#F8FAFC',
                marginBottom: '6px',
                letterSpacing: '-0.02em',
              }}
            >
              Đăng nhập hệ thống
            </h2>
            <p
              style={{
                fontSize: '13px',
                color: '#94A3B8',
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              Nhập thông tin tài khoản để truy cập workspace làm việc
            </p>
          </div>

          {/* Error Notification */}
          {errorMessage && (
            <div
              id="login-error-alert"
              role="alert"
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                marginBottom: '20px',
                fontSize: '13px',
                color: '#EF4444',
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
          <form onSubmit={handleSubmit} method="post" noValidate>
            {/* Identifier Input */}
            <div style={{ marginBottom: '18px' }}>
              <label
                htmlFor="identifier"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: '#CBD5E1',
                }}
              >
                Tên đăng nhập hoặc Email:
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
                  if (
                    invalidField === 'identifier' ||
                    invalidField === 'both'
                  ) {
                    setInvalidField(
                      invalidField === 'both' ? 'password' : null,
                    );
                  }
                }}
                placeholder="admin, staff hoặc email..."
                disabled={isLoading}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: `1px solid ${invalidField === 'identifier' || invalidField === 'both' ? '#EF4444' : '#334155'}`,
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s ease',
                }}
                onFocus={(e) => (e.target.style.borderColor = '#14B8A6')}
                onBlur={(e) =>
                  (e.target.style.borderColor =
                    invalidField === 'identifier' || invalidField === 'both'
                      ? '#EF4444'
                      : '#334155')
                }
              />
            </div>

            {/* Password Input with Show/Hide Toggle */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label
                  htmlFor="password"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#CBD5E1',
                  }}
                >
                  Mật khẩu:
                </label>
              </div>

              <div style={{ position: 'relative', width: '100%' }}>
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
                    if (
                      invalidField === 'password' ||
                      invalidField === 'both'
                    ) {
                      setInvalidField(
                        invalidField === 'both' ? 'identifier' : null,
                      );
                    }
                  }}
                  placeholder="Nhập mật khẩu..."
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '0 46px 0 14px',
                    borderRadius: '8px',
                    border: `1px solid ${invalidField === 'password' || invalidField === 'both' ? '#EF4444' : '#334155'}`,
                    backgroundColor: '#0B1220',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#14B8A6')}
                  onBlur={(e) =>
                    (e.target.style.borderColor =
                      invalidField === 'password' || invalidField === 'both'
                        ? '#EF4444'
                        : '#334155')
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  disabled={isLoading}
                  style={{
                    position: 'absolute',
                    right: '2px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: showPassword ? '#14B8A6' : '#94A3B8',
                    cursor: 'pointer',
                    minWidth: '40px',
                    minHeight: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'color 0.15s ease',
                  }}
                >
                  {showPassword ? (
                    <EyeOffIcon size={18} />
                  ) : (
                    <EyeIcon size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* Row: Remember Me & Forgot Password */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '24px',
              }}
            >
              {/* Remember Me: Persistent 30-day HttpOnly session cookie when checked */}
              <label
                htmlFor="remember-me"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: '#CBD5E1',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  userSelect: 'none',
                }}
                title="Duy trì phiên làm việc an toàn qua HttpOnly cookie lên đến 30 ngày trên trình duyệt này (hoặc phiên tiêu chuẩn 12 giờ nếu không chọn)."
              >
                <input
                  id="remember-me"
                  name="remember_me"
                  type="checkbox"
                  disabled={isLoading}
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{
                    accentColor: '#14B8A6',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    width: '15px',
                    height: '15px',
                  }}
                />
                <span>Ghi nhớ đăng nhập</span>
              </label>

              {/* Forgot Password Trigger Link */}
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
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#14B8A6',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '4px 0',
                  textDecoration: 'none',
                  transition: 'opacity 0.15s ease',
                  display: 'inline-block',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.textDecoration = 'underline')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.textDecoration = 'none')
                }
              >
                Quên mật khẩu?
              </a>
            </div>

            {/* Submit Button */}
            <AppButton
              variant="primary"
              fullWidth
              type="submit"
              disabled={isLoading}
              style={{
                minHeight: '44px',
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {isLoading ? 'Đang xác thực...' : 'Đăng nhập'}
            </AppButton>
          </form>

          {/* Footer Note */}
          <div
            style={{
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid #1E293B',
              textAlign: 'center',
              fontSize: '12px',
              color: '#64748B',
              lineHeight: 1.5,
            }}
          >
            Hệ thống quản lý vận hành nội bộ Management Lite
          </div>
        </div>
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
              backgroundColor: '#151F30',
              border: '1px solid #334155',
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
                borderBottom: '1px solid #334155',
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
                    color: '#14B8A6',
                  }}
                >
                  <LockIcon size={18} />
                </div>
                <h3
                  id="forgot-password-modal-title"
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#F8FAFC',
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
                  color: '#94A3B8',
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
              style={{ fontSize: '13px', color: '#CBD5E1', lineHeight: 1.6 }}
            >
              <p style={{ marginTop: 0, marginBottom: '14px' }}>
                Vì lý do an toàn dữ liệu và tuân thủ chính sách bảo mật nội bộ,
                Management Lite không hỗ trợ tính năng đặt lại mật khẩu tự động
                qua email công khai nhằm tránh rủi ro dò quét tài khoản.
              </p>

              <div
                style={{
                  backgroundColor: '#0B1220',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: '#14B8A6',
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
                  color: '#94A3B8',
                  marginBottom: '20px',
                }}
              >
                <ShieldAlertIcon
                  size={16}
                  style={{ color: '#F59E0B', flexShrink: 0 }}
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

      {/* Responsive layout styles */}
      <style>{`
        .login-card-container {
          display: flex;
          flex-direction: row;
          width: 100%;
          max-width: 920px;
          background-color: #151F30;
          border: 1px solid #334155;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
          box-sizing: border-box;
        }
        .login-brand-panel {
          width: 44%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 40px 32px;
          background: linear-gradient(145deg, #0F172A 0%, #0B1322 100%);
          border-right: 1px solid #1E293B;
          box-sizing: border-box;
        }
        .login-form-panel {
          width: 56%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 40px 36px;
          box-sizing: border-box;
        }
        .mobile-brand-header {
          display: none;
        }
        @media (max-width: 768px) {
          .login-card-container {
            flex-direction: column !important;
            max-width: 440px !important;
            border-radius: 16px !important;
          }
          .login-brand-panel {
            display: none !important;
          }
          .login-form-panel {
            width: 100% !important;
            padding: 32px 24px !important;
          }
          .mobile-brand-header {
            display: block !important;
            text-align: center;
            margin-bottom: 24px;
          }
        }
      `}</style>
    </div>
  );
};
