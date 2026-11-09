import React, { useState, useEffect } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  CheckCircleIcon,
  AlertTriangleIcon,
  CopyIcon,
  AppToast,
  useAutoDismiss,
  VnDateOfBirthSelect,
  VnBankAutocompleteInput,
} from '../../../../packages/ui/src/components/index.js';

export interface EmployeeNewScreenProps {
  onNavigate: (path: string) => void;
}

export const EmployeeNewScreen: React.FC<EmployeeNewScreenProps> = ({
  onNavigate,
}) => {
  const [suggestedCode, setSuggestedCode] = useState('NV001');
  const [employeeCode, setEmployeeCode] = useState('NV001');
  const [codeEditedManually, setCodeEditedManually] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [phone, setPhone] = useState('');
  const [positionTitle, setPositionTitle] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [createdEmployeeName, setCreatedEmployeeName] = useState<string>('');
  const [createdEmployeeCode, setCreatedEmployeeCode] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useAutoDismiss(errorMessage, () => setErrorMessage(null), 5000);
  useAutoDismiss(toastMessage, () => setToastMessage(null), 4000);

  useEffect(() => {
    let active = true;
    const fetchInitialData = async () => {
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

      try {
        let resolvedCode = '';
        const nextRes = await fetch('/api/v1/employees/next-code', {
          credentials: 'include',
        });
        if (nextRes.ok) {
          const nextBody = await nextRes.json().catch(() => null);
          if (typeof nextBody?.data?.next_employee_code === 'string') {
            resolvedCode = nextBody.data.next_employee_code.trim();
          }
        }
        if (!resolvedCode) {
          const listRes = await fetch('/api/v1/employees?limit=50', {
            credentials: 'include',
          });
          if (listRes.ok) {
            const listBody = await listRes.json().catch(() => null);
            const items = Array.isArray(listBody?.data?.items)
              ? listBody.data.items
              : [];
            let maxNum = 0;
            for (const item of items) {
              const m = String(item?.employee_code || '').match(/^NV(\d+)$/i);
              if (m && m[1]) {
                const n = parseInt(m[1], 10);
                if (n > maxNum) maxNum = n;
              }
            }
            resolvedCode = `NV${String(maxNum + 1).padStart(3, '0')}`;
          }
        }
        if (active && resolvedCode) {
          setSuggestedCode(resolvedCode);
          setEmployeeCode((prev) =>
            prev === 'NV001' || !prev.trim() ? resolvedCode : prev,
          );
        }
      } catch {
        // Keep default NV001 fallback
      }
    };
    void fetchInitialData();
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

      const trimmedCode = employeeCode.trim();
      const sendCustomCode =
        codeEditedManually && trimmedCode && trimmedCode !== suggestedCode
          ? trimmedCode
          : undefined;

      const res = await fetch('/api/v1/employees', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          employee_code: sendCustomCode,
          full_name: fullName.trim(),
          email: email.trim(),
          username: username.trim() || undefined,
          password: password.trim() || undefined,
          role,
          phone: phone.trim() || undefined,
          position_title: positionTitle.trim() || undefined,
          date_of_birth: dateOfBirth.trim() || undefined,
          gender: gender.trim() || undefined,
          national_id: nationalId.trim() || undefined,
          address: address.trim() || undefined,
          emergency_contact: emergencyContact.trim() || undefined,
          bank_name: bankName.trim() || undefined,
          bank_account_number: bankAccountNumber.trim() || undefined,
          bank_account_holder:
            bankAccountHolder.trim().toUpperCase() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể tạo nhân viên');
      }

      setCreatedEmployeeName(data.data.full_name);
      setCreatedEmployeeCode(
        data.data.employee_code || trimmedCode || suggestedCode,
      );
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
          subtitle={`Nhân viên ${createdEmployeeName}${createdEmployeeCode ? ` (${createdEmployeeCode})` : ''} đã được thêm vào hệ thống`}
        />

        <AppCard padding="24px">
          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              marginBottom: '20px',
              color: 'var(--success-text)',
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
            <div style={{ color: 'var(--text-color)' }}>
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
                color: 'var(--muted-color)',
                marginBottom: '6px',
              }}
            >
              Liên kết kích hoạt tài khoản:
            </label>
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                color: 'var(--accent-text)',
                fontSize: '13px',
                wordBreak: 'break-all',
                fontFamily: 'var(--font-mono)',
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
              color: 'var(--danger-text)',
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '6px',
              }}
            >
              <label
                htmlFor="empCode"
                style={{
                  display: 'block',
                  fontSize: '14px',
                  color: 'var(--muted-color)',
                }}
              >
                Mã nhân viên (hệ thống tự động cấp — khóa chỉnh sửa):
              </label>
              {codeEditedManually ? (
                <button
                  type="button"
                  onClick={() => {
                    setEmployeeCode(suggestedCode);
                    setCodeEditedManually(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Dùng lại mã tự động ({suggestedCode})
                </button>
              ) : (
                <span
                  style={{
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(20, 184, 166, 0.15)',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Tự động ({employeeCode})
                </span>
              )}
            </div>
            <input
              id="empCode"
              type="text"
              autoComplete="off"
              value={employeeCode}
              readOnly
              tabIndex={-1}
              onChange={() => {
                // Locked: employee code is strictly auto-assigned
                // Do not allow manual override
              }}
              placeholder={`Tự động: ${suggestedCode}`}
              title="Mã nhân viên được hệ thống tự động cấp tuần tự và không thể sửa tay"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
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
                color: 'var(--muted-color)',
              }}
            >
              Chức vụ / Phân quyền:{' '}
              <span style={{ color: 'var(--danger-text)' }}>*</span>
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
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            >
              <option value="staff">Nhân viên (Staff) - Mặc định</option>
              <option value="admin">
                Quản lý phụ (Admin) - Phân quyền vận hành theo nhóm
              </option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="fullName"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: 'var(--muted-color)',
              }}
            >
              Họ và tên nhân viên:{' '}
              <span style={{ color: 'var(--danger-text)' }}>*</span>
            </label>
            <input
              id="fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="VD: Nguyễn Văn A"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
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
                color: 'var(--muted-color)',
              }}
            >
              Email đăng nhập:{' '}
              <span style={{ color: 'var(--danger-text)' }}>*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="VD: nva@management-lite.local"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="username"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: 'var(--muted-color)',
              }}
            >
              Tên tài khoản (tùy chọn):
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Mặc định lấy từ tiền tố email hoặc mã nhân viên (NV002)"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="newEmpPassword"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: 'var(--muted-color)',
              }}
            >
              Mật khẩu đăng nhập ban đầu (tùy chọn — nếu nhập sẽ kích hoạt ngay):
            </label>
            <input
              id="newEmpPassword"
              data-testid="new-employee-password-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự (để trống nếu muốn gửi link kích hoạt)"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div
            style={{
              padding: '16px',
              borderRadius: '10px',
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--accent-text)',
                marginBottom: '12px',
              }}
            >
              Thông tin cơ bản nhân sự (Tùy chọn)
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label
                  htmlFor="newEmpPhone"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Số điện thoại:
                </label>
                <input
                  id="newEmpPhone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="VD: 0901234567"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="newEmpPosition"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Chức danh / Vị trí:
                </label>
                <input
                  id="newEmpPosition"
                  type="text"
                  value={positionTitle}
                  onChange={(e) => setPositionTitle(e.target.value)}
                  placeholder="VD: Editor, Kịch bản…"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="newEmpDob"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Ngày sinh:
                </label>
                <VnDateOfBirthSelect
                  id="newEmpDob"
                  testId="new-employee-dob-select"
                  value={dateOfBirth}
                  onChange={setDateOfBirth}
                  disabled={isLoading}
                />
              </div>
              <div>
                <label
                  htmlFor="newEmpGender"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Giới tính:
                </label>
                <select
                  id="newEmpGender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">-- Chọn --</option>
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="newEmpNationalId"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Số CCCD / CMND:
                </label>
                <input
                  id="newEmpNationalId"
                  type="text"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="VD: 079200012345"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="newEmpEmergency"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Liên hệ khẩn cấp:
                </label>
                <input
                  id="newEmpEmergency"
                  type="text"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="Tên & SĐT người thân"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  htmlFor="newEmpAddress"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Địa chỉ nơi ở:
                </label>
                <input
                  id="newEmpAddress"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '16px',
              borderRadius: '10px',
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--accent-text)',
                marginBottom: '12px',
              }}
            >
              🏦 Thông tin ngân hàng nhận lương (Tùy chọn)
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label
                  htmlFor="newEmpBankName"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Ngân hàng:
                </label>
                <VnBankAutocompleteInput
                  id="newEmpBankName"
                  testId="new-employee-bank-name-input"
                  value={bankName}
                  onChange={setBankName}
                  disabled={isLoading}
                  placeholder="Gõ tên NH (VD: Vietcombank, MB…)"
                />
              </div>
              <div>
                <label
                  htmlFor="newEmpBankNumber"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Số tài khoản:
                </label>
                <input
                  id="newEmpBankNumber"
                  type="text"
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                  placeholder="VD: 1023456789"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="newEmpBankHolder"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    marginBottom: '4px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Chủ tài khoản:
                </label>
                <input
                  id="newEmpBankHolder"
                  type="text"
                  value={bankAccountHolder}
                  onChange={(e) =>
                    setBankAccountHolder(e.target.value.toUpperCase())
                  }
                  placeholder="VD: NGUYEN VAN A"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    minHeight: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <AppButton
              variant="primary"
              fullWidth
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? 'Đang tạo hồ sơ…' : 'Tạo nhân sự & Tạo liên kết mời'}
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
