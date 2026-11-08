import React, { useState, useEffect, useRef } from 'react';
import {
  AppCard,
  AppButton,
  CheckCircleIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
  ShieldAlertIcon,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';

export interface VerifyEmailScreenProps {
  initialToken?: string | undefined;
  initialEmail?: string | undefined;
  isEmailVerified?: boolean | undefined;
  isLoggedIn?: boolean | undefined;
  onNavigate: (path: string) => void;
  onVerified?: (() => void) | undefined;
}

function readLocationVerifyToken(fallback: string): string {
  const trimmedFallback = fallback.trim();
  if (trimmedFallback) return trimmedFallback;
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(
    window.location.hash.slice(1) || window.location.search,
  );
  return (params.get('token') || '').trim();
}

export const VerifyEmailScreen: React.FC<VerifyEmailScreenProps> = ({
  initialToken = '',
  initialEmail = '',
  isEmailVerified = false,
  isLoggedIn = false,
  onNavigate,
  onVerified,
}) => {
  const [token, setToken] = useState(() =>
    readLocationVerifyToken(initialToken),
  );
  const [email, setEmail] = useState(initialEmail);
  const [confirmState, setConfirmState] = useState<
    'idle' | 'submitting' | 'success' | 'failed'
  >('idle');
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [resendState, setResendState] = useState<
    'idle' | 'submitting' | 'sent'
  >('idle');
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  useAutoDismiss(confirmError, () => setConfirmError(null), 5000);
  useAutoDismiss(resendMessage, () => setResendMessage(null), 4000);
  useAutoDismiss(resendError, () => setResendError(null), 5000);

  const lastConfirmedTokenRef = useRef<string>('');

  useEffect(() => {
    if (initialEmail && !email) {
      setEmail(initialEmail);
    }
  }, [initialEmail, email]);

  const confirmWithToken = async (rawToken: string) => {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      setConfirmState('failed');
      setConfirmError('Vui lòng nhập mã xác minh email.');
      return;
    }

    setConfirmState('submitting');
    setConfirmError(null);
    setConfirmMessage(null);

    try {
      const res = await fetch('/api/v1/auth/verify-email/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: trimmed }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const code = data?.error?.code;
        setConfirmState('failed');
        if (code === 'RATE_LIMITED') {
          setConfirmError(
            'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ít phút.',
          );
        } else if (code === 'TOKEN_EXPIRED') {
          setConfirmError(
            'Mã xác minh đã hết hạn (quá 15 phút). Vui lòng yêu cầu gửi lại email xác minh mới.',
          );
        } else if (code === 'INVALID_TOKEN') {
          setConfirmError(
            'Liên kết hoặc mã xác minh không hợp lệ, đã được sử dụng hoặc không khớp với tài khoản.',
          );
        } else {
          setConfirmError(
            data?.error?.message ||
              'Xác minh email thất bại. Vui lòng kiểm tra lại hoặc gửi lại email xác minh.',
          );
        }
        return;
      }

      setConfirmState('success');
      setConfirmMessage(
        data?.data?.message ||
          'Xác minh email thành công! Tài khoản của bạn đã đủ điều kiện khôi phục mật khẩu qua email.',
      );
      if (onVerified) {
        onVerified();
      }
    } catch {
      setConfirmState('failed');
      setConfirmError('Lỗi kết nối máy chủ. Vui lòng thử lại.');
    }
  };

  useEffect(() => {
    const consumeLocationToken = (propToken?: string) => {
      let resolvedToken = (propToken || '').trim();
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(
          window.location.hash.slice(1) || window.location.search,
        );
        const queryToken = params.get('token');
        if (queryToken && queryToken.trim()) {
          resolvedToken = queryToken.trim();
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      if (resolvedToken) {
        setToken(resolvedToken);
        if (lastConfirmedTokenRef.current !== resolvedToken) {
          lastConfirmedTokenRef.current = resolvedToken;
          void confirmWithToken(resolvedToken);
        }
      }
    };

    consumeLocationToken(initialToken);

    if (typeof window !== 'undefined') {
      const handleHashOrPop = () => consumeLocationToken('');
      window.addEventListener('hashchange', handleHashOrPop);
      window.addEventListener('popstate', handleHashOrPop);
      return () => {
        window.removeEventListener('hashchange', handleHashOrPop);
        window.removeEventListener('popstate', handleHashOrPop);
      };
    }
    return undefined;
  }, [initialToken]);

  const handleManualConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    await confirmWithToken(token);
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendError(null);
    setResendMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail && !isLoggedIn) {
      setResendError('Vui lòng nhập địa chỉ email cần xác minh.');
      return;
    }

    setResendState('submitting');
    try {
      const payload = trimmedEmail ? { email: trimmedEmail } : {};
      const res = await fetch('/api/v1/auth/verify-email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error?.code === 'RATE_LIMITED') {
          setResendError(
            'Bạn đã gửi yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.',
          );
        } else {
          setResendError(
            data?.error?.message ||
              'Không thể gửi yêu cầu xác minh email. Vui lòng thử lại.',
          );
        }
        setResendState('idle');
        return;
      }

      setResendState('sent');
      setResendMessage(
        data?.data?.message ||
          'Nếu tài khoản hợp lệ và chưa xác minh email, liên kết xác minh đã được gửi qua email (hiệu lực 15 phút).',
      );
    } catch {
      setResendError('Lỗi kết nối máy chủ. Vui lòng thử lại.');
      setResendState('idle');
    }
  };

  return (
    <div
      data-testid="verify-email-page"
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
      <div style={{ width: '100%', maxWidth: '460px' }}>
        <AppCard
          padding="large"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div style={{ marginBottom: '20px', textAlign: 'center' }}>
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
                marginBottom: '14px',
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
              Xác minh địa chỉ Email
            </h1>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                margin: 0,
                lineHeight: '1.5',
              }}
            >
              Xác nhận email chính chủ để bảo vệ tài khoản và bật tính năng khôi
              phục mật khẩu.
            </p>
          </div>

          {!isEmailVerified && confirmState !== 'success' && (
            <div
              role="status"
              data-testid="verify-email-unverified-notice"
              style={{
                marginBottom: '16px',
                padding: '12px 14px',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid #F59E0B',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                color: 'var(--warning-text)',
                fontSize: '13px',
                lineHeight: '1.5',
              }}
            >
              <AlertTriangleIcon
                size={18}
                style={{ flexShrink: 0, marginTop: '2px' }}
              />
              <span>
                <strong>Email chưa được xác minh:</strong> Tài khoản chỉ có thể
                nhận email đặt lại mật khẩu sau khi hoàn tất xác minh email.
              </span>
            </div>
          )}

          {confirmState === 'submitting' && (
            <div
              role="status"
              data-testid="verify-email-loading"
              style={{
                marginBottom: '16px',
                padding: '12px 14px',
                backgroundColor: 'rgba(20, 184, 166, 0.1)',
                border: '1px solid #14B8A6',
                borderRadius: '8px',
                color: 'var(--accent-text)',
                fontSize: '13px',
              }}
            >
              Đang kiểm tra và xác minh mã xác nhận email…
            </div>
          )}

          {confirmState === 'success' && (
            <div
              data-testid="verify-email-success"
              style={{ marginBottom: '16px' }}
            >
              <div
                role="status"
                style={{
                  marginBottom: '16px',
                  padding: '14px',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid #10B981',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  color: 'var(--success-text)',
                  fontSize: '13px',
                  lineHeight: '1.5',
                }}
              >
                <CheckCircleIcon
                  size={20}
                  style={{ flexShrink: 0, marginTop: '2px' }}
                />
                <span>
                  <strong>Xác minh thành công!</strong>{' '}
                  {confirmMessage ||
                    'Địa chỉ email của bạn đã được xác minh chính thức.'}
                </span>
              </div>
              <AppButton
                variant="primary"
                data-testid="verify-email-continue-btn"
                onClick={() => onNavigate(isLoggedIn ? '/' : '/login')}
                style={{ width: '100%', padding: '12px', fontWeight: 600 }}
              >
                {isLoggedIn ? 'Về bảng điều khiển' : 'Đi tới trang Đăng nhập'}
              </AppButton>
            </div>
          )}

          {confirmState === 'failed' && confirmError && (
            <div
              role="alert"
              data-testid="verify-email-error"
              style={{
                marginBottom: '16px',
                padding: '12px 14px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #EF4444',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                color: 'var(--danger-text)',
                fontSize: '13px',
                lineHeight: '1.5',
              }}
            >
              <AlertTriangleIcon
                size={18}
                style={{ flexShrink: 0, marginTop: '2px' }}
              />
              <span>
                <strong>Xác minh không thành công:</strong> {confirmError}
              </span>
            </div>
          )}

          {confirmState !== 'success' && (
            <>
              <form
                onSubmit={handleManualConfirm}
                noValidate
                data-testid="verify-email-confirm-form"
              >
                <div style={{ marginBottom: '14px' }}>
                  <label
                    htmlFor="verify-email-token"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}
                  >
                    Mã xác minh từ email
                  </label>
                  <input
                    id="verify-email-token"
                    type="text"
                    placeholder="Dán mã xác minh nếu không mở trực tiếp từ liên kết"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={confirmState === 'submitting'}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      backgroundColor: 'var(--surface-hover)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <AppButton
                  type="submit"
                  variant="primary"
                  data-testid="verify-email-submit-btn"
                  disabled={confirmState === 'submitting'}
                  style={{ width: '100%', padding: '12px', fontWeight: 600 }}
                >
                  {confirmState === 'submitting'
                    ? 'Đang xác minh…'
                    : 'Xác nhận mã email'}
                </AppButton>
              </form>

              <hr
                style={{
                  margin: '20px 0',
                  border: 'none',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              />

              <form
                onSubmit={handleResend}
                noValidate
                data-testid="verify-email-resend-form"
              >
                <div style={{ marginBottom: '14px' }}>
                  <label
                    htmlFor="verify-email-address"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}
                  >
                    Chưa nhận được thư hoặc mã đã hết hạn?
                  </label>
                  <input
                    id="verify-email-address"
                    type="email"
                    placeholder="Nhập email tài khoản của bạn"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={resendState === 'submitting'}
                    autoComplete="email"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      backgroundColor: 'var(--surface-hover)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {resendError && (
                  <div
                    role="alert"
                    data-testid="verify-email-resend-error"
                    style={{
                      marginBottom: '12px',
                      padding: '10px 12px',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid #EF4444',
                      borderRadius: '8px',
                      color: 'var(--danger-text)',
                      fontSize: '13px',
                    }}
                  >
                    {resendError}
                  </div>
                )}

                {resendMessage && (
                  <div
                    role="status"
                    data-testid="verify-email-resend-success"
                    style={{
                      marginBottom: '12px',
                      padding: '10px 12px',
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid #10B981',
                      borderRadius: '8px',
                      color: 'var(--success-text)',
                      fontSize: '13px',
                    }}
                  >
                    {resendMessage}
                  </div>
                )}

                <AppButton
                  type="submit"
                  variant="secondary"
                  data-testid="verify-email-resend-btn"
                  disabled={resendState === 'submitting'}
                  style={{ width: '100%', padding: '11px', fontWeight: 600 }}
                >
                  {resendState === 'submitting'
                    ? 'Đang gửi email xác minh…'
                    : 'Gửi lại email xác minh'}
                </AppButton>
              </form>
            </>
          )}

          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button
              type="button"
              onClick={() => onNavigate(isLoggedIn ? '/' : '/login')}
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
              }}
            >
              <ArrowLeftIcon size={14} />
              {isLoggedIn ? 'Quay lại ứng dụng' : 'Quay lại đăng nhập'}
            </button>
          </div>
        </AppCard>
      </div>
    </div>
  );
};
