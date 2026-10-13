import React, { useState, useEffect, useRef } from 'react';
import {
  AppCard,
  AppButton,
  CheckCircleIcon,
  AlertTriangleIcon,
  LockIcon,
  EyeIcon,
  ArrowLeftIcon,
} from '../../../../packages/ui/src/components/index.js';

export interface ResetPasswordScreenProps {
  onNavigate: (path: string) => void;
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

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({
  onNavigate,
}) => {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const submittingLockRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const queryToken = params.get('token');
      if (queryToken) {
        setToken(queryToken);
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingLockRef.current) return;

    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setErrorMessage('Mã khôi phục không được để trống.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('Mật khẩu mới phải có độ dài tối thiểu 8 ký tự.');
      return;
    }

    if (newPassword.length > 128) {
      setErrorMessage('Mật khẩu không được vượt quá 128 ký tự.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    submittingLockRef.current = true;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: trimmedToken,
          new_password: newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể đặt lại mật khẩu');
      }

      setSuccessMessage(
        data?.data?.message ||
          'Mật khẩu đã được đặt lại thành công! Bạn có thể đăng nhập bằng mật khẩu mới.',
      );
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      submittingLockRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0B1220',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <AppCard
          padding="large"
          style={{
            backgroundColor: '#0F172A',
            border: '1px solid #1E293B',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Header */}
          <div style={{ marginBottom: '24px', textAlign: 'center' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: 'rgba(20, 184, 166, 0.1)',
                color: '#14B8A6',
                marginBottom: '16px',
              }}
            >
              <LockIcon size={24} />
            </div>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: '#F8FAFC',
                margin: '0 0 8px 0',
              }}
            >
              Đặt lại mật khẩu mới
            </h1>
            <p
              style={{
                fontSize: '13px',
                color: '#94A3B8',
                margin: 0,
                lineHeight: '1.5',
              }}
            >
              Thiết lập mật khẩu bảo mật mới cho tài khoản của bạn (tối thiểu 8
              ký tự).
            </p>
          </div>

          {/* Success Banner */}
          {successMessage && (
            <div
              style={{
                marginBottom: '20px',
                padding: '16px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid #10B981',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  color: '#10B981',
                  marginBottom: '16px',
                }}
              >
                <CheckCircleIcon
                  size={20}
                  style={{ flexShrink: 0, marginTop: '2px' }}
                />
                <span
                  style={{
                    fontSize: '13px',
                    lineHeight: '1.5',
                    fontWeight: 500,
                  }}
                >
                  {successMessage}
                </span>
              </div>
              <AppButton
                variant="primary"
                onClick={() => onNavigate('/login')}
                style={{ width: '100%', fontSize: '14px' }}
              >
                Đăng nhập ngay →
              </AppButton>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div
              style={{
                marginBottom: '20px',
                padding: '12px 14px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #EF4444',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                color: '#EF4444',
                fontSize: '13px',
              }}
            >
              <AlertTriangleIcon size={18} style={{ flexShrink: 0 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          {!successMessage && (
            <form onSubmit={handleSubmit}>
              {/* Token Input */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="reset-token-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#CBD5E1',
                    marginBottom: '8px',
                  }}
                >
                  Mã khôi phục (Token)
                </label>
                <input
                  id="reset-token-input"
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Nhập mã xác nhận khôi phục"
                  required
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#14B8A6')}
                  onBlur={(e) => (e.target.style.borderColor = '#334155')}
                />
              </div>

              {/* New Password Input */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="new-password-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#CBD5E1',
                    marginBottom: '8px',
                  }}
                >
                  Mật khẩu mới
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="new-password-input"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Tối thiểu 8 ký tự"
                    required
                    disabled={isLoading}
                    style={{
                      width: '100%',
                      padding: '10px 40px 10px 14px',
                      backgroundColor: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#F8FAFC',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      outline: 'none',
                      transition: 'border-color 0.15s ease',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = '#14B8A6')}
                    onBlur={(e) => (e.target.style.borderColor = '#334155')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#64748B',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOffIcon size={18} />
                    ) : (
                      <EyeIcon size={18} />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password Input */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="confirm-password-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#CBD5E1',
                    marginBottom: '8px',
                  }}
                >
                  Xác nhận mật khẩu mới
                </label>
                <input
                  id="confirm-password-input"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  required
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#14B8A6')}
                  onBlur={(e) => (e.target.style.borderColor = '#334155')}
                />
              </div>

              {/* Submit Button */}
              <div style={{ marginBottom: '16px' }}>
                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                >
                  {isLoading ? 'Đang cập nhật mật khẩu...' : 'Lưu mật khẩu mới'}
                </AppButton>
              </div>
            </form>
          )}

          {/* Links */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
            }}
          >
            <button
              type="button"
              onClick={() => onNavigate('/forgot-password')}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                fontSize: '13px',
                cursor: 'pointer',
                padding: '4px 0',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#F8FAFC')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94A3B8')}
            >
              Yêu cầu mã mới
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/login')}
              style={{
                background: 'none',
                border: 'none',
                color: '#14B8A6',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 0',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.textDecoration = 'underline')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.textDecoration = 'none')
              }
            >
              <ArrowLeftIcon size={14} />
              Quay lại đăng nhập
            </button>
          </div>
        </AppCard>
      </div>
    </div>
  );
};
