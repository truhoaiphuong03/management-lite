import React, { useState, useEffect } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  CheckCircleIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
} from '@management-lite/ui/components';

export interface ActivateScreenProps {
  onNavigate: (path: string) => void;
}

export const ActivateScreen: React.FC<ActivateScreenProps> = ({
  onNavigate,
}) => {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    if (!token.trim()) {
      setErrorMessage('Mã kích hoạt không được để trống.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('Mật khẩu phải có độ dài tối thiểu 8 ký tự.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Xác nhận mật khẩu không khớp.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          new_password: newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Kích hoạt tài khoản không thành công',
        );
      }

      setSuccessMessage(
        data?.data?.message ||
          'Tài khoản đã được kích hoạt thành công! Vui lòng đăng nhập.',
      );
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
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
        <PageHeader
          title="Kích hoạt tài khoản"
          subtitle="Thiết lập mật khẩu cá nhân để bắt đầu làm việc (UI02)"
        />

        <AppCard padding="24px">
          {successMessage ? (
            <div>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  marginBottom: '20px',
                  color: '#10B981',
                  fontSize: '14px',
                  lineHeight: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <CheckCircleIcon size={20} />
                <span>{successMessage}</span>
              </div>
              <AppButton
                variant="primary"
                fullWidth
                onClick={() => onNavigate('/login')}
              >
                Đăng nhập ngay
              </AppButton>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {errorMessage && (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    marginBottom: '20px',
                    fontSize: '13px',
                    color: '#EF4444',
                    lineHeight: 1.4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <AlertTriangleIcon size={18} />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="tokenInput"
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    marginBottom: '6px',
                    color: '#94A3B8',
                  }}
                >
                  Mã kích hoạt (Token):
                </label>
                <input
                  id="tokenInput"
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Dán mã kích hoạt tại đây..."
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    backgroundColor: '#0B1220',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'monospace',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="newPassword"
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    marginBottom: '6px',
                    color: '#94A3B8',
                  }}
                >
                  Mật khẩu mới (tối thiểu 8 ký tự):
                </label>
                <input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    backgroundColor: '#0B1220',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="confirmPassword"
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    marginBottom: '6px',
                    color: '#94A3B8',
                  }}
                >
                  Xác nhận mật khẩu:
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    backgroundColor: '#0B1220',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <AppButton
                variant="primary"
                fullWidth
                type="submit"
                disabled={isLoading}
              >
                {isLoading ? 'Đang kích hoạt...' : 'Kích hoạt tài khoản'}
              </AppButton>

              <div style={{ marginTop: '16px', textAlign: 'center' }}>
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
                  }}
                >
                  <ArrowLeftIcon size={14} />
                  <span>Đã có tài khoản? Đăng nhập</span>
                </button>
              </div>
            </form>
          )}
        </AppCard>
      </div>
    </div>
  );
};
