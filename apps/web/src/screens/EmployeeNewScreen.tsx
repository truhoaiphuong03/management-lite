import React, { useState } from 'react';
import { AppCard, AppButton, PageHeader } from '@management-lite/ui/components';

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
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [createdEmployeeName, setCreatedEmployeeName] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeCode.trim() || !fullName.trim() || !email.trim()) {
      setErrorMessage('Vui lòng điền đầy đủ Mã nhân viên, Họ tên và Email.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employee_code: employeeCode.trim(),
          full_name: fullName.trim(),
          email: email.trim(),
          username: username.trim() || undefined,
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
            🎉 <strong>Hồ sơ nhân viên đã sẵn sàng!</strong>
            <div style={{ marginTop: '8px', color: '#F8FAFC' }}>
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
                alert('Đã sao chép liên kết kích hoạt vào bộ nhớ tạm!');
              }}
            >
              Sao chép liên kết
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
            }}
          >
            ⚠️ {errorMessage}
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
              Mã nhân viên (duy nhất):{' '}
              <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              id="empCode"
              type="text"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="VD: NV002, NV_CREATOR"
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
    </div>
  );
};
