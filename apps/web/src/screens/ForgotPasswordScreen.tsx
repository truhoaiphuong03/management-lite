import React, { useState, useRef } from 'react';
import {
  AppCard,
  AppButton,
  CheckCircleIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
  ShieldAlertIcon,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';

export interface ForgotPasswordScreenProps {
  onNavigate: (path: string) => void;
}

export const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({
  onNavigate,
}) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useAutoDismiss(errorMessage, () => setErrorMessage(null), 5000);
  const [successData, setSuccessData] = useState<{
    message: string;
    deliveryStatus: string;
  } | null>(null);
  const submittingLockRef = useRef<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingLockRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Vui lòng nhập địa chỉ email.');
      return;
    }

    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setErrorMessage('Địa chỉ email không đúng định dạng.');
      return;
    }

    submittingLockRef.current = true;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không thể xử lý yêu cầu khôi phục mật khẩu',
        );
      }

      setSuccessData({
        message:
          data?.data?.message ||
          'Nếu email tồn tại trong hệ thống và hợp lệ, hướng dẫn đặt lại mật khẩu đã được xử lý.',
        deliveryStatus: data?.data?.delivery_status || 'EMAIL_DELIVERY_BLOCKED',
      });
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
        backgroundColor: 'var(--bg-color, #0B1220)',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <AppCard
          padding="large"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            border: '1px solid var(--border-subtle)',
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
                color: 'var(--accent-text)',
                marginBottom: '16px',
              }}
            >
              <ShieldAlertIcon size={26} />
            </div>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: 'var(--text-color)',
                margin: '0 0 8px 0',
              }}
            >
              Khôi phục mật khẩu
            </h1>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                margin: 0,
                lineHeight: '1.5',
              }}
            >
              Nhập địa chỉ email tài khoản để nhận hướng dẫn đặt lại mật khẩu.
            </p>
          </div>

          {/* Delivery Status Banner */}
          {successData && (
            <div
              role="status"
              data-delivery-status={successData.deliveryStatus}
              style={{
                marginBottom: '20px',
                padding: '16px',
                backgroundColor:
                  successData.deliveryStatus === 'EMAIL_DELIVERY_BLOCKED'
                    ? 'rgba(245, 158, 11, 0.08)'
                    : 'rgba(16, 185, 129, 0.1)',
                border:
                  successData.deliveryStatus === 'EMAIL_DELIVERY_BLOCKED'
                    ? '1px solid #F59E0B'
                    : '1px solid #10B981',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  color:
                    successData.deliveryStatus === 'EMAIL_DELIVERY_BLOCKED'
                      ? 'var(--warning-text)'
                      : 'var(--success-text)',
                  marginBottom: '10px',
                }}
              >
                {successData.deliveryStatus === 'EMAIL_DELIVERY_BLOCKED' ? (
                  <AlertTriangleIcon
                    size={20}
                    style={{ flexShrink: 0, marginTop: '2px' }}
                  />
                ) : (
                  <CheckCircleIcon
                    size={20}
                    style={{ flexShrink: 0, marginTop: '2px' }}
                  />
                )}
                <span
                  style={{
                    fontSize: '13px',
                    lineHeight: '1.5',
                    fontWeight: 500,
                  }}
                >
                  {successData.deliveryStatus === 'EMAIL_DELIVERY_BLOCKED'
                    ? 'Không thể gửi email khôi phục mật khẩu vì dịch vụ email đang bị chặn hoặc chưa hoàn tất cấu hình.'
                    : successData.message}
                </span>
              </div>

              {/* Global availability only; never expose recipient delivery outcomes. */}
              {successData.deliveryStatus === 'EMAIL_DELIVERY_BLOCKED' ? (
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--warning-text)',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    lineHeight: '1.5',
                    marginBottom: '12px',
                  }}
                >
                  <strong>Trạng thái gửi thư:</strong>{' '}
                  <span
                    style={{ color: 'var(--danger-text)', fontWeight: 600 }}
                  >
                    {successData.deliveryStatus}
                  </span>
                  <p
                    style={{
                      margin: '6px 0 0 0',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Dịch vụ email chưa được cấu hình hoặc người gửi chưa xác
                    minh. Chưa có email nào được gửi đi. Vui lòng liên hệ quản
                    trị viên hoặc sử dụng công cụ khôi phục cục bộ trên máy chủ.
                  </p>
                  <p
                    style={{
                      margin: '6px 0 0 0',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                    }}
                  >
                    {successData.message}
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Nếu tài khoản đủ điều kiện, bạn sẽ nhận được email chứa liên
                  kết và mã xác minh dùng một lần, có hiệu lực 15 phút. Kiểm tra
                  cả thư rác. Bạn cũng có thể nhập mã tại trang đặt lại mật
                  khẩu.
                </p>
              )}
              <AppButton onClick={() => onNavigate('/reset-password')}>
                Nhập mã xác minh
              </AppButton>
            </div>
          )}

          {/* Error Message */}
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
                color: 'var(--danger-text)',
                fontSize: '13px',
              }}
            >
              <AlertTriangleIcon size={18} style={{ flexShrink: 0 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          {!successData && (
            <form onSubmit={handleSubmit} noValidate>
              <div style={{ marginBottom: '20px' }}>
                <label
                  htmlFor="forgot-email-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: '8px',
                  }}
                >
                  Email
                </label>
                <input
                  id="forgot-email-input"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Nhập email đã đăng ký"
                  autoComplete="off"
                  autoFocus
                  required
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: 'var(--surface-hover)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#14B8A6')}
                  onBlur={(e) => (e.target.style.borderColor = '#334155')}
                />
              </div>

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
                  {isLoading ? 'Đang xử lý…' : 'Gửi yêu cầu khôi phục'}
                </AppButton>
              </div>
            </form>
          )}

          {/* Link to Email Verification */}
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <button
              type="button"
              data-testid="forgot-password-verify-email-link"
              onClick={() => onNavigate('/verify-email')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-text)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              Chưa xác minh email? Xác minh hoặc gửi lại thư tại đây
            </button>
          </div>

          {/* Back to Login Link */}
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--muted-color)',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#F8FAFC')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94A3B8')}
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
