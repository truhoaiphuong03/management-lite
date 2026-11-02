import React, { useEffect, useState, useRef } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  ErrorState,
  CheckIcon,
  CloseIcon,
  LinkIcon,
  CopyIcon,
  ArrowLeftIcon,
  AppDialog,
  AppToast,
  type ToastVariant,
} from '../../../../packages/ui/src/components/index.js';
import { TOKENS, THEME_COLORS } from '../../../../packages/ui/src/tokens.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import type { HourlyRateData } from '../../../../packages/contracts/src/payroll.js';
import type { UserRole } from '../types.js';
import {
  VnDateOfBirthSelect,
  VnBankAutocompleteInput,
} from '../components/VnProfileInputs.js';

export interface EmployeeDetailScreenProps {
  employeeId: string;
  role: UserRole;
  onNavigate: (path: string) => void;
}

export const EmployeeDetailScreen: React.FC<EmployeeDetailScreenProps> = ({
  employeeId,
  role,
  onNavigate,
}) => {
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [hourlyRates, setHourlyRates] = useState<HourlyRateData[]>([]);
  const [currentHourlyRate, setCurrentHourlyRate] =
    useState<HourlyRateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [memberRole, setMemberRole] = useState<'owner' | 'staff'>('staff');
  const [isPayrollEligible, setIsPayrollEligible] = useState(true);
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
  const [isSaving, setIsSaving] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [activeInviteUrl, setActiveInviteUrl] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [isSavingRate, setIsSavingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    variant?: ToastVariant;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'suspend' | 'reactivate';
    reason: string;
    loading: boolean;
  } | null>(null);

  const rateIdempotencyKeyRef = useRef<string | null>(null);
  const savingRateLockRef = useRef<boolean>(false);

  useEffect(() => {
    let active = true;
    const fetchCsrf = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (res.ok) {
          const body = await res.json();
          if (active) {
            if (body.data?.csrf_token) {
              setCsrfToken(body.data.csrf_token);
            }
            if (body.data?.user?.id) {
              setCurrentUserId(body.data.user.id);
            }
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

  const getEffectiveCsrfToken = async (): Promise<string> => {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.ok) {
        const body = await res.json();
        if (body.data?.user?.id) {
          setCurrentUserId(body.data.user.id);
        }
        const tok = body.data?.csrf_token;
        if (tok) {
          setCsrfToken(tok);
          return tok;
        }
      }
    } catch {
      // fallback
    }
    return '';
  };

  const fetchEmployee = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/employees/${encodeURIComponent(employeeId)}`,
        {
          credentials: 'include',
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không tìm thấy hồ sơ nhân viên',
        );
      }
      setEmployee(data.data);
      setFullName(data.data.full_name || '');
      setMemberRole(
        data.data.role === 'owner' ||
          data.data.user?.role === 'owner' ||
          data.data.employee_code === 'OWNER'
          ? 'owner'
          : 'staff',
      );
      setIsPayrollEligible(Boolean(data.data.is_payroll_eligible));
      setPhone(data.data.phone || '');
      setPositionTitle(data.data.position_title || '');
      setDateOfBirth(data.data.date_of_birth || '');
      setGender(data.data.gender || '');
      setNationalId(data.data.national_id || '');
      setAddress(data.data.address || '');
      setEmergencyContact(data.data.emergency_contact || '');
      setBankName(data.data.bank_name || '');
      setBankAccountNumber(data.data.bank_account_number || '');
      setBankAccountHolder(data.data.bank_account_holder || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tải hồ sơ nhân sự');
    } finally {
      setLoading(false);
    }
  };

  const fetchRates = async () => {
    if (role !== 'owner') return;
    try {
      const res = await fetch('/api/v1/payroll/hourly-rates', {
        credentials: 'include',
      });
      if (res.ok) {
        const body = await res.json();
        const allRates: HourlyRateData[] = Array.isArray(body.data)
          ? body.data
          : [];
        const empRates = allRates.filter((r) => r.employee_id === employeeId);
        setHourlyRates(empRates);
        const active = empRates.find((r) => !r.effective_to);
        setCurrentHourlyRate(
          active ?? (empRates.length > 0 ? empRates[0]! : null),
        );
      }
    } catch {
      // Silently fall back if payroll service is unreachable
    }
  };

  useEffect(() => {
    fetchEmployee();
    if (role === 'owner') {
      fetchRates();
    }
  }, [employeeId, role]);

  const handleOpenRateModal = () => {
    rateIdempotencyKeyRef.current = null;
    savingRateLockRef.current = false;
    setRateInput(
      currentHourlyRate ? String(currentHourlyRate.hourly_rate_vnd) : '',
    );
    setRateError(null);
    setIsRateModalOpen(true);
  };

  const handleSaveRate = async () => {
    if (savingRateLockRef.current) return;
    const numericRate = parseInt(rateInput.replace(/\D/g, ''), 10);
    if (isNaN(numericRate) || numericRate <= 0) {
      setRateError('Vui lòng nhập mức lương hợp lệ lớn hơn 0 VNĐ');
      return;
    }

    savingRateLockRef.current = true;
    setIsSavingRate(true);
    setRateError(null);
    try {
      const token = await getEffectiveCsrfToken();
      if (!rateIdempotencyKeyRef.current) {
        rateIdempotencyKeyRef.current =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `rate-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': rateIdempotencyKeyRef.current,
      };
      if (token) headers['X-CSRF-Token'] = token;

      const res = await fetch('/api/v1/payroll/hourly-rates', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          employee_id: employeeId,
          hourly_rate_vnd: numericRate,
          effective_from: new Date().toISOString(),
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body?.error?.message || 'Không thể lưu mức lương theo giờ',
        );
      }

      rateIdempotencyKeyRef.current = null;
      setIsRateModalOpen(false);
      setToast({
        message: `Đã cập nhật mức lương theo giờ: ${numericRate.toLocaleString('vi-VN')} ₫/giờ`,
        variant: 'success',
      });
      fetchRates();
    } catch (err: unknown) {
      setRateError(
        err instanceof Error ? err.message : 'Lỗi cập nhật mức lương',
      );
    } finally {
      savingRateLockRef.current = false;
      setIsSavingRate(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;

    setIsSaving(true);
    setActionNotice(null);
    try {
      const token = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${employee.version}"`,
      };
      if (token) headers['X-CSRF-Token'] = token;

      const res = await fetch(`/api/v1/employees/${employee.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          full_name: fullName.trim(),
          role: memberRole,
          is_payroll_eligible: isPayrollEligible,
          phone: phone.trim() || null,
          position_title: positionTitle.trim() || null,
          date_of_birth: dateOfBirth.trim() || null,
          gender: gender.trim() || null,
          national_id: nationalId.trim() || null,
          address: address.trim() || null,
          emergency_contact: emergencyContact.trim() || null,
          bank_name: bankName.trim() || null,
          bank_account_number: bankAccountNumber.trim() || null,
          bank_account_holder: bankAccountHolder.trim().toUpperCase() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể cập nhật hồ sơ');
      }
      setEmployee(data.data);
      setMemberRole(
        data.data.role === 'owner' ||
          data.data.user?.role === 'owner' ||
          data.data.employee_code === 'OWNER'
          ? 'owner'
          : 'staff',
      );
      setIsEditing(false);
      setActionNotice('Đã cập nhật thông tin nhân viên thành công.');
      setToast({
        message: 'Đã cập nhật thông tin nhân viên thành công.',
        variant: 'success',
      });
    } catch (err: unknown) {
      setToast({
        message: err instanceof Error ? err.message : 'Cập nhật thất bại',
        variant: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenSuspend = () => {
    if (!employee) return;
    const isSelf =
      Boolean(currentUserId && employee.user_id === currentUserId) ||
      employee.employee_code === 'OWNER';
    if (isSelf) {
      setToast({
        message:
          'Chủ sở hữu không thể tự tạm ngưng hoặc khóa tài khoản của chính mình.',
        variant: 'warning',
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      type: 'suspend',
      reason: 'Nghỉ việc tạm thời',
      loading: false,
    });
  };

  const handleOpenReactivate = () => {
    if (!employee) return;
    setConfirmDialog({
      isOpen: true,
      type: 'reactivate',
      reason: 'Đi làm trở lại',
      loading: false,
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog || !employee) return;
    const { type, reason } = confirmDialog;
    if (!reason.trim()) return;

    setConfirmDialog((prev) => (prev ? { ...prev, loading: true } : null));

    try {
      const token = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${employee.version}"`,
      };
      if (token) headers['X-CSRF-Token'] = token;

      const endpoint = type === 'suspend' ? 'suspend' : 'reactivate';
      const res = await fetch(`/api/v1/employees/${employee.id}/${endpoint}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message ||
            (type === 'suspend'
              ? 'Không thể tạm ngưng'
              : 'Không thể kích hoạt lại'),
        );
      }
      const msg =
        type === 'suspend'
          ? 'Đã tạm ngưng nhân viên.'
          : 'Đã kích hoạt lại nhân viên thành công.';
      setActionNotice(msg);
      setToast({ message: msg, variant: 'success' });
      setConfirmDialog(null);
      fetchEmployee();
    } catch (err: unknown) {
      setConfirmDialog((prev) => (prev ? { ...prev, loading: false } : null));
      setToast({
        message: err instanceof Error ? err.message : 'Thao tác thất bại',
        variant: 'error',
      });
    }
  };

  const handleGetInvite = async () => {
    if (!employee) return;
    try {
      const token = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['X-CSRF-Token'] = token;

      const res = await fetch(
        `/api/v1/employees/${employee.id}/activation-invites`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({}),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không thể cấp lại liên kết kích hoạt',
        );
      }
      const tokenVal = data.data.token;
      const inviteUrl = `${window.location.origin}/activate?token=${encodeURIComponent(tokenVal)}`;
      setActiveInviteUrl(inviteUrl);
      setToast({
        message: 'Đã cấp lại liên kết kích hoạt thành công!',
        variant: 'success',
      });
    } catch (err: unknown) {
      setToast({
        message: err instanceof Error ? err.message : 'Lỗi cấp lại liên kết',
        variant: 'error',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <StatusBadge status="success" label="Đang hoạt động" />;
      case 'invited':
        return <StatusBadge status="warning" label="Chờ kích hoạt" />;
      case 'suspended':
        return <StatusBadge status="error" label="Tạm ngưng" />;
      default:
        return <StatusBadge status="muted" label={status} />;
    }
  };

  if (loading) {
    return <LoadingState message="Đang tải hồ sơ nhân sự…" />;
  }

  if (error || !employee) {
    return (
      <ErrorState
        message={error || 'Không tìm thấy thông tin nhân viên'}
        onRetry={fetchEmployee}
      />
    );
  }

  const isOwner = role === 'owner';

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <PageHeader
        title={`Hồ sơ: ${employee.full_name}`}
        subtitle={`Mã nhân viên: ${employee.employee_code} • Phiên bản: v${employee.version}`}
        badge={getStatusBadge(employee.employment_status)}
      />

      {actionNotice && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            marginBottom: '16px',
            color: 'var(--success-text)',
            fontSize: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckIcon size={18} />
            <span>{actionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--success-text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              minHeight: '32px',
              minWidth: '32px',
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* Active Invite Modal / Box */}
      {activeInviteUrl && (
        <AppCard
          padding="16px"
          style={{ marginBottom: '20px', border: '1px solid #14B8A6' }}
        >
          <div
            style={{
              color: 'var(--accent-text)',
              fontWeight: 600,
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <LinkIcon size={18} />
            <span>Liên kết kích hoạt tài khoản nhân viên:</span>
          </div>
          <div
            style={{
              padding: '10px',
              backgroundColor: 'var(--bg-color)',
              borderRadius: '6px',
              fontSize: '13px',
              color: 'var(--text-color)',
              wordBreak: 'break-all',
              border: '1px solid var(--border-color)',
              marginBottom: '12px',
            }}
          >
            {activeInviteUrl}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <AppButton
              variant="primary"
              onClick={() => {
                navigator.clipboard.writeText(activeInviteUrl);
                setToast({
                  message: 'Đã sao chép liên kết kích hoạt vào bộ nhớ tạm!',
                  variant: 'success',
                });
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <CopyIcon size={16} />
              <span>Sao chép liên kết</span>
            </AppButton>
            <AppButton
              variant="secondary"
              onClick={() => setActiveInviteUrl(null)}
            >
              Đóng
            </AppButton>
          </div>
        </AppCard>
      )}

      <AppCard padding="24px" style={{ marginBottom: '20px' }}>
        <h3
          style={{
            fontSize: '16px',
            color: 'var(--text-color)',
            marginBottom: '16px',
          }}
        >
          Thông tin chi tiết
        </h3>

        {!isEditing ? (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '16px',
                marginBottom: '20px',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Mã nhân viên
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: 'var(--text-color)',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  {employee.employee_code}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Họ và tên
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: 'var(--text-color)',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  {employee.full_name}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Vai trò / Phân quyền
                </div>
                <div
                  data-testid="employee-detail-role-badge"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    marginTop: '4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 10px',
                    borderRadius: '999px',
                    backgroundColor:
                      (employee.role ||
                        employee.user?.role ||
                        (employee.employee_code === 'OWNER'
                          ? 'owner'
                          : 'staff')) === 'owner'
                        ? 'rgba(20, 184, 166, 0.15)'
                        : 'var(--surface-hover)',
                    color:
                      (employee.role ||
                        employee.user?.role ||
                        (employee.employee_code === 'OWNER'
                          ? 'owner'
                          : 'staff')) === 'owner'
                        ? 'var(--accent-text)'
                        : 'var(--text-color)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {(employee.role ||
                    employee.user?.role ||
                    (employee.employee_code === 'OWNER'
                      ? 'owner'
                      : 'staff')) === 'owner'
                    ? 'Quản trị / Chủ sở hữu (Owner)'
                    : 'Nhân viên (Staff)'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Chức danh / Vị trí
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.position_title
                      ? 'var(--text-color)'
                      : 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.position_title || 'Chưa cập nhật'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Số điện thoại
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.phone
                      ? 'var(--accent-text)'
                      : 'var(--warning-text)',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  {employee.phone || 'Chưa cập nhật'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Email tài khoản
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.user?.email || 'Chưa liên kết'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Tên đăng nhập
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.user?.username || '—'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Ngày sinh
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.date_of_birth
                      ? 'var(--text-color)'
                      : 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.date_of_birth || 'Chưa cập nhật'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Giới tính
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.gender
                      ? 'var(--text-color)'
                      : 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.gender || 'Chưa cập nhật'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Số CCCD / CMND
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.national_id
                      ? 'var(--text-color)'
                      : 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.national_id || 'Chưa cập nhật'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Tính lương tự động
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.is_payroll_eligible
                    ? 'Có (Nhân viên)'
                    : 'Không (Chủ sở hữu)'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Ngày tham gia
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {new Date(employee.created_at).toLocaleDateString('vi-VN')}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Liên hệ khẩn cấp
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.emergency_contact
                      ? 'var(--text-color)'
                      : 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.emergency_contact || 'Chưa cập nhật'}
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Địa chỉ thường trú / Nơi ở hiện tại
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    color: employee.address
                      ? 'var(--text-color)'
                      : 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {employee.address || 'Chưa cập nhật'}
                </div>
              </div>
            </div>

            {/* Bank Info Section */}
            <div
              data-testid="employee-bank-info-section"
              style={{
                padding: '16px',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-color)',
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
                🏦 Thông tin ngân hàng (Nhận lương)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                  gap: '16px',
                }}
              >
                <div>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Ngân hàng
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: employee.bank_name
                        ? 'var(--text-color)'
                        : 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {employee.bank_name || 'Chưa thiết lập'}
                  </div>
                </div>

                <div>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Số tài khoản
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '2px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        fontFamily: employee.bank_account_number
                          ? 'monospace'
                          : 'inherit',
                        color: employee.bank_account_number
                          ? 'var(--text-color)'
                          : 'var(--muted-color)',
                      }}
                    >
                      {employee.bank_account_number || 'Chưa thiết lập'}
                    </span>
                    {employee.bank_account_number && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            employee.bank_account_number || '',
                          );
                          setToast({
                            message: 'Đã sao chép số tài khoản ngân hàng!',
                            variant: 'success',
                          });
                        }}
                        style={{
                          background: 'rgba(20, 184, 166, 0.15)',
                          border: '1px solid rgba(20, 184, 166, 0.3)',
                          borderRadius: '6px',
                          color: 'var(--accent-text)',
                          fontSize: '12px',
                          padding: '2px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        Sao chép
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Chủ tài khoản
                  </div>
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: employee.bank_account_holder
                        ? 'var(--text-color)'
                        : 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {employee.bank_account_holder || 'Chưa thiết lập'}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <form onSubmit={handleUpdate} style={{ marginBottom: '20px' }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--accent-text)',
                marginBottom: '12px',
              }}
            >
              1. Thông tin cơ bản nhân sự
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '14px',
                marginBottom: '16px',
              }}
            >
              <div>
                <label
                  htmlFor="editName"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Họ và tên nhân viên: *
                </label>
                <input
                  id="editName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
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

              <div>
                <label
                  htmlFor="editRole"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Phân quyền hệ thống (Vai trò truy cập): *
                </label>
                <select
                  id="editRole"
                  data-testid="edit-employee-role-select"
                  value={memberRole}
                  disabled={
                    Boolean(
                      currentUserId && employee.user_id === currentUserId,
                    ) || employee.employee_code === 'OWNER'
                  }
                  onChange={(e) => {
                    const nextRole = e.target.value as 'owner' | 'staff';
                    setMemberRole(nextRole);
                    if (nextRole === 'owner') {
                      setIsPayrollEligible(false);
                    } else if (nextRole === 'staff') {
                      setIsPayrollEligible(true);
                    }
                  }}
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
                    opacity:
                      (currentUserId && employee.user_id === currentUserId) ||
                      employee.employee_code === 'OWNER'
                        ? 0.65
                        : 1,
                  }}
                >
                  <option value="staff">
                    Nhân viên (Staff) — Chấm công, nhận việc, xem lương cá nhân
                  </option>
                  <option value="owner">
                    Quản trị / Chủ sở hữu (Owner) — Toàn quyền quản lý hệ thống
                  </option>
                </select>
                {((currentUserId && employee.user_id === currentUserId) ||
                  employee.employee_code === 'OWNER') && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                    }}
                  >
                    Tài khoản Chủ sở hữu hiện tại không thể tự hạ quyền của
                    chính mình.
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="editPositionTitle"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Chức danh / Vị trí công việc:
                </label>
                <input
                  id="editPositionTitle"
                  type="text"
                  value={positionTitle}
                  onChange={(e) => setPositionTitle(e.target.value)}
                  placeholder="VD: Editor, Kịch bản, Vận hành…"
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

              <div>
                <label
                  htmlFor="editPhone"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Số điện thoại liên hệ:
                </label>
                <input
                  id="editPhone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="VD: 0901234567"
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

              <div>
                <label
                  htmlFor="editDob"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ngày sinh (Không bắt buộc):
                </label>
                <VnDateOfBirthSelect
                  id="editDob"
                  testId="editDob"
                  value={dateOfBirth}
                  onChange={setDateOfBirth}
                />
              </div>

              <div>
                <label
                  htmlFor="editGender"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Giới tính:
                </label>
                <select
                  id="editGender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
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
                  <option value="">-- Chọn giới tính --</option>
                  <option value="Nam">Nam</option>
                  <option value="Nữ">Nữ</option>
                  <option value="Khác">Khác</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="editNationalId"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Số CCCD / CMND (Không bắt buộc):
                </label>
                <input
                  id="editNationalId"
                  type="text"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="VD: 079200012345"
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

              <div>
                <label
                  htmlFor="editEmergencyContact"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Liên hệ khẩn cấp (Người thân & SĐT):
                </label>
                <input
                  id="editEmergencyContact"
                  type="text"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="VD: Nguyễn Thị B (Mẹ) - 0912345678"
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

              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  htmlFor="editAddress"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Địa chỉ thường trú / Nơi ở hiện tại (Không bắt buộc):
                </label>
                <input
                  id="editAddress"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="VD: Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
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
            </div>

            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--accent-text)',
                marginBottom: '12px',
                marginTop: '8px',
              }}
            >
              2. Thông tin ngân hàng nhận lương
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '14px',
                marginBottom: '16px',
              }}
            >
              <div>
                <label
                  htmlFor="editBankName"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ngân hàng (Không bắt buộc):
                </label>
                <VnBankAutocompleteInput
                  id="editBankName"
                  testId="editBankName"
                  value={bankName}
                  onChange={setBankName}
                  placeholder="🔍 Tìm tên ngân hàng (MB, VCB, Techcombank…)"
                />
              </div>

              <div>
                <label
                  htmlFor="editBankAccountNumber"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Số tài khoản ngân hàng:
                </label>
                <input
                  id="editBankAccountNumber"
                  type="text"
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                  placeholder="VD: 1023456789"
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

              <div>
                <label
                  htmlFor="editBankAccountHolder"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Chủ tài khoản (in hoa không dấu):
                </label>
                <input
                  id="editBankAccountHolder"
                  type="text"
                  value={bankAccountHolder}
                  onChange={(e) =>
                    setBankAccountHolder(e.target.value.toUpperCase())
                  }
                  placeholder="VD: TRU HOAI PHUONG"
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
            </div>

            {employee.employee_code !== 'OWNER' && (
              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isPayrollEligible}
                    onChange={(e) => setIsPayrollEligible(e.target.checked)}
                    style={{
                      width: '18px',
                      height: '18px',
                      accentColor: '#14B8A6',
                    }}
                  />
                  Đủ điều kiện tính lương ca làm việc (Payroll Eligible)
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <AppButton variant="primary" type="submit" disabled={isSaving}>
                {isSaving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </AppButton>
              <AppButton
                variant="secondary"
                type="button"
                onClick={() => setIsEditing(false)}
              >
                Hủy
              </AppButton>
            </div>
          </form>
        )}

        {/* Action Controls for Owner */}
        {isOwner && (
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '16px',
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            {!isEditing && (
              <AppButton variant="secondary" onClick={() => setIsEditing(true)}>
                Chỉnh sửa thông tin
              </AppButton>
            )}

            {employee.employment_status === 'invited' && (
              <AppButton variant="secondary" onClick={handleGetInvite}>
                Cấp lại link kích hoạt
              </AppButton>
            )}

            {employee.employment_status === 'active' &&
              ((currentUserId && employee.user_id === currentUserId) ||
              employee.employee_code === 'OWNER' ? (
                <AppButton
                  variant="destructive"
                  disabled
                  title="Chủ sở hữu không thể tự tạm ngưng hoặc khóa tài khoản của chính mình"
                  style={{ opacity: 0.45, cursor: 'not-allowed' }}
                >
                  Tạm ngưng công tác
                </AppButton>
              ) : (
                <AppButton variant="destructive" onClick={handleOpenSuspend}>
                  Tạm ngưng công tác
                </AppButton>
              ))}

            {employee.employment_status === 'suspended' && (
              <AppButton variant="primary" onClick={handleOpenReactivate}>
                Kích hoạt lại nhân viên
              </AppButton>
            )}

            <AppButton
              variant="secondary"
              onClick={() => onNavigate('/employees')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ArrowLeftIcon size={16} />
              <span>Quay lại danh sách</span>
            </AppButton>
          </div>
        )}
      </AppCard>

      {/* Hourly Rate Card (EMP-009) */}
      <AppCard padding="24px" style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <h3
              style={{
                fontSize: '16px',
                color: 'var(--text-color)',
                margin: 0,
              }}
            >
              Mức lương theo giờ
            </h3>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginTop: '4px',
                marginBottom: 0,
              }}
            >
              Áp dụng tính lương tự động cho các ca làm việc đã duyệt (EMP-009)
            </p>
          </div>
          {isOwner && employee.is_payroll_eligible && (
            <AppButton
              variant="secondary"
              data-testid="open-rate-modal-btn"
              onClick={handleOpenRateModal}
            >
              Cập nhật mức lương
            </AppButton>
          )}
        </div>

        {employee.is_payroll_eligible ? (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                padding: '16px',
                backgroundColor: 'var(--surface-hover)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
              }}
            >
              <div
                data-testid="current-hourly-rate-value"
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: currentHourlyRate
                    ? 'var(--success-text)'
                    : 'var(--muted-color)',
                }}
              >
                {currentHourlyRate
                  ? `${currentHourlyRate.hourly_rate_vnd.toLocaleString('vi-VN')} ₫`
                  : 'Chưa thiết lập'}
              </div>
              <span style={{ fontSize: '14px', color: 'var(--muted-color)' }}>
                / giờ
              </span>
            </div>

            {currentHourlyRate && (
              <div
                style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                }}
              >
                Hiệu lực từ:{' '}
                {new Date(currentHourlyRate.effective_from).toLocaleDateString(
                  'vi-VN',
                )}
              </div>
            )}

            {/* Rate History if more than 1 rate */}
            {hourlyRates.length > 1 && (
              <div style={{ marginTop: '16px' }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '8px',
                  }}
                >
                  Lịch sử thay đổi mức lương:
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  {hourlyRates.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: 'var(--bg-color)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span
                        style={{ color: 'var(--text-color)', fontWeight: 500 }}
                      >
                        {r.hourly_rate_vnd.toLocaleString('vi-VN')} ₫/giờ
                      </span>
                      <span style={{ color: 'var(--muted-color)' }}>
                        {new Date(r.effective_from).toLocaleDateString('vi-VN')}
                        {r.effective_to
                          ? ` - ${new Date(r.effective_to).toLocaleDateString('vi-VN')}`
                          : ' (Hiện tại)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: 'var(--surface-hover)',
              color: 'var(--muted-color)',
              fontSize: '13px',
            }}
          >
            Nhân sự này không thuộc diện tính lương theo giờ (Chủ sở hữu hoặc
            không áp dụng).
          </div>
        )}
      </AppCard>

      {confirmDialog && (
        <AppDialog
          isOpen={confirmDialog.isOpen}
          onClose={() => !confirmDialog.loading && setConfirmDialog(null)}
          title={
            confirmDialog.type === 'suspend'
              ? `Tạm ngưng nhân viên ${employee?.full_name}`
              : `Kích hoạt lại nhân viên ${employee?.full_name}`
          }
          confirmLabel={
            confirmDialog.type === 'suspend'
              ? 'Xác nhận tạm ngưng'
              : 'Kích hoạt lại'
          }
          cancelLabel="Hủy"
          onConfirm={handleConfirmAction}
          confirmVariant={
            confirmDialog.type === 'suspend' ? 'destructive' : 'primary'
          }
          isLoading={confirmDialog.loading}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: TOKENS.spacing[3],
            }}
          >
            <label
              htmlFor="employee-detail-action-reason"
              style={{ fontSize: '13px', color: THEME_COLORS.muted }}
            >
              Nhập lý do thực hiện thao tác:
            </label>
            <input
              id="employee-detail-action-reason"
              type="text"
              value={confirmDialog.reason}
              onChange={(e) =>
                setConfirmDialog((prev) =>
                  prev ? { ...prev, reason: e.target.value } : null,
                )
              }
              placeholder="Nhập lý do…"
              disabled={confirmDialog.loading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: TOKENS.radii.md,
                border: `1px solid ${THEME_COLORS.border}`,
                backgroundColor: THEME_COLORS.background,
                color: THEME_COLORS.text,
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
          </div>
        </AppDialog>
      )}

      {isRateModalOpen && employee && (
        <AppDialog
          isOpen={isRateModalOpen}
          onClose={() => {
            if (!isSavingRate) {
              rateIdempotencyKeyRef.current = null;
              setIsRateModalOpen(false);
            }
          }}
          title={`Cập nhật mức lương cho ${employee.full_name}`}
          confirmLabel="Lưu mức lương"
          cancelLabel="Hủy"
          onConfirm={handleSaveRate}
          confirmVariant="primary"
          isLoading={isSavingRate}
        >
          <div
            data-testid="hourly-rate-modal"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: TOKENS.spacing[3],
            }}
          >
            <label
              htmlFor="hourly-rate-input-field"
              style={{ fontSize: '13px', color: THEME_COLORS.muted }}
            >
              Mức lương theo giờ mới (VNĐ/giờ):
            </label>
            <input
              id="hourly-rate-input-field"
              data-testid="hourly-rate-input"
              type="number"
              min="1000"
              step="1000"
              value={rateInput}
              onChange={(e) => {
                rateIdempotencyKeyRef.current = null;
                setRateInput(e.target.value);
              }}
              placeholder="VD: 35000"
              disabled={isSavingRate}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: TOKENS.radii.md,
                border: `1px solid ${THEME_COLORS.border}`,
                backgroundColor: THEME_COLORS.background,
                color: THEME_COLORS.text,
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
            {rateError && (
              <div style={{ color: THEME_COLORS.danger, fontSize: '13px' }}>
                {rateError}
              </div>
            )}
          </div>
        </AppDialog>
      )}

      {toast && (
        <AppToast
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};
