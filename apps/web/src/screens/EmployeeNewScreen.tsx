import React, { useState, useEffect } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  CheckCircleIcon,
  AlertTriangleIcon,
  CopyIcon,
  AppToast,
} from '../../../../packages/ui/src/components/index.js';

export interface EmployeeNewScreenProps {
  onNavigate: (path: string) => void;
}

export const EmployeeNewScreen: React.FC<EmployeeNewScreenProps> = ({
  onNavigate,
}) => {
  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [csrfToken, setCsrfToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [createdEmployeeName, setCreatedEmployeeName] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchCsrf = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (res.ok) {
          const body = await res.json();
          if (active && body.data?.csrf_token) {
            setCsrfToken(body.data.csrf_token);
          }
        }
      } catch {
        // Silently ignore network failures on initial CSRF fetch
      }
    };
    fetchCsrf();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setErrorMessage('Vui lòng điền đầy đủ Họ tên và Email.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const res = await fetch('/api/v1/employees', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          employee_code: employeeCode.trim() || undefined,
          full_name: fullName.trim(),
          email: email.trim(),
          username: username.trim() || undefined,
          role,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể tạo nhân viên');
      }

      setCreatedEmployeeName(data.data.full_name);
      if (data.data.invite_token) {
        const url = `${window.location.origin}/activate?token=${encodeURIComponent(data.data.invite_token)}`;
        setCreatedInviteUrl(url);
      } else {
        onNavigate('/employees');
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (createdInviteUrl) {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <PageHeader
          title="Tạo nhân viên thành công"
          subtitle={`Nhân viên ${createdEmployeeName} đã được thêm vào hệ thống`}
        />

        <AppCard padding="24px">
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
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '6px',
              }}
            >
              <CheckCircleIcon size={20} />
              <strong style={{ fontSize: '15px' }}>
                Hồ sơ nhân viên đã sẵn sàng!
              </strong>
            </div>
            <div style={{ color: '#F8FAFC' }}>
              Hãy gửi liên kết bảo mật bên dưới cho nhân viên để họ tự thiết lập
              mật khẩu và đăng nhập. Mật khẩu không bao giờ được gửi qua tin
              nhắn dạng rõ.
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: '#94A3B8',
                marginBottom: '6px',
              }}
            >
              Liên kết kích hoạt tài khoản:
            </label>
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: '#0B1220',
                border: '1px solid #334155',
                color: '#14B8A6',
                fontSize: '13px',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}
            >
              {createdInviteUrl}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <AppButton
              variant="primary"
              fullWidth
              onClick={() => {
                navigator.clipboard.writeText(createdInviteUrl);
                setToastMessage(
                  'Đã sao chép liên kết kích hoạt vào bộ nhớ tạm!',
                );
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                justifyContent: 'center',
              }}
            >
              <CopyIcon size={16} />
              <span>Sao chép liên kết</span>
            </AppButton>
            <AppButton
              variant="secondary"
              fullWidth
              onClick={() => onNavigate('/employees')}
            >
              Về danh sách nhân sự
            </AppButton>
          </div>
        </AppCard>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <PageHeader
        title="Thêm nhân sự mới"
        subtitle="Khởi tạo hồ sơ nhân viên và tạo liên kết kích hoạt tài khoản"
      />

      <AppCard padding="24px">
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
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangleIcon size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="empCode"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Mã nhân viên (tùy chọn, để trống để tự động tạo mã):
            </label>
            <input
              id="empCode"
              type="text"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="VD: NV002 (để trống hệ thống tự tạo NV001...)"
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

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="empRole"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Chức vụ / Phân quyền: <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <select
              id="empRole"
              value={role}
              onChange={(e) => setRole(e.target.value as 'staff' | 'admin')}
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
            >
              <option value="staff">Nhân viên (Staff) - Mặc định</option>
              <option value="admin" disabled>Quản trị viên (Admin) - Cần migration nâng cấp schema để kích hoạt</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="fullName"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Họ và tên nhân viên: <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="VD: Nguyễn Văn A"
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

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Email đăng nhập: <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="VD: nva@management-lite.local"
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
              htmlFor="username"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Tên tài khoản (tùy chọn):
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Mặc định lấy từ tiền tố email"
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

          <div style={{ display: 'flex', gap: '12px' }}>
            <AppButton
              variant="primary"
              fullWidth
              type="submit"
              disabled={isLoading}
            >
              {isLoading
                ? 'Đang tạo hồ sơ...'
                : 'Tạo nhân sự & Tạo liên kết mời'}
            </AppButton>
            <AppButton
              variant="secondary"
              type="button"
              disabled={isLoading}
              onClick={() => onNavigate('/employees')}
            >
              Hủy
            </AppButton>
          </div>
        </form>
      </AppCard>

      {toastMessage && (
        <AppToast
          message={toastMessage}
          variant="success"
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  );
};
