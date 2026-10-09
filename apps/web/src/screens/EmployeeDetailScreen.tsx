import React, { useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  ErrorState,
} from '@management-lite/ui/components';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import type { UserRole } from '../types.js';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [isPayrollEligible, setIsPayrollEligible] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [activeInviteUrl, setActiveInviteUrl] = useState<string | null>(null);

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
      setFullName(data.data.full_name);
      setIsPayrollEligible(data.data.is_payroll_eligible);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi tải hồ sơ nhân sự');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployee();
  }, [employeeId]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;

    setIsSaving(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/v1/employees/${employee.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${employee.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({
          full_name: fullName.trim(),
          is_payroll_eligible: isPayrollEligible,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể cập nhật hồ sơ');
      }
      setEmployee(data.data);
      setIsEditing(false);
      setActionNotice('Đã cập nhật thông tin nhân viên thành công.');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Cập nhật thất bại');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSuspend = async () => {
    if (!employee) return;
    const reason = window.prompt(
      `Nhập lý do tạm ngưng nhân viên ${employee.full_name}:`,
      'Nghỉ việc tạm thời',
    );
    if (!reason) return;

    try {
      const res = await fetch(`/api/v1/employees/${employee.id}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${employee.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể tạm ngưng');
      }
      setActionNotice('Đã tạm ngưng nhân viên.');
      fetchEmployee();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    }
  };

  const handleReactivate = async () => {
    if (!employee) return;
    const reason = window.prompt(
      `Nhập lý do kích hoạt lại nhân viên ${employee.full_name}:`,
      'Đi làm trở lại',
    );
    if (!reason) return;

    try {
      const res = await fetch(`/api/v1/employees/${employee.id}/reactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${employee.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'Không thể kích hoạt lại');
      }
      setActionNotice('Đã kích hoạt lại nhân viên thành công.');
      fetchEmployee();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    }
  };

  const handleGetInvite = async () => {
    if (!employee) return;
    try {
      const res = await fetch(
        `/api/v1/employees/${employee.id}/activation-invites`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      const token = data.data.token;
      const inviteUrl = `${window.location.origin}/activate?token=${encodeURIComponent(token)}`;
      setActiveInviteUrl(inviteUrl);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Lỗi cấp lại liên kết');
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
    return <LoadingState message="Đang tải hồ sơ nhân sự..." />;
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
            color: '#10B981',
            fontSize: '14px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>✅ {actionNotice}</span>
          <button
            onClick={() => setActionNotice(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#10B981',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            ✕
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
            style={{ color: '#14B8A6', fontWeight: 600, marginBottom: '8px' }}
          >
            🔗 Liên kết kích hoạt tài khoản nhân viên:
          </div>
          <div
            style={{
              padding: '10px',
              backgroundColor: '#0B1220',
              borderRadius: '6px',
              fontSize: '13px',
              color: '#F8FAFC',
              wordBreak: 'break-all',
              border: '1px solid #334155',
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
                alert('Đã sao chép liên kết kích hoạt vào bộ nhớ tạm!');
              }}
            >
              Sao chép liên kết
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
          style={{ fontSize: '16px', color: '#F8FAFC', marginBottom: '16px' }}
        >
          Thông tin chi tiết
        </h3>

        {!isEditing ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Mã nhân viên
              </div>
              <div
                style={{
                  fontSize: '15px',
                  color: '#F8FAFC',
                  fontWeight: 600,
                  marginTop: '2px',
                }}
              >
                {employee.employee_code}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Họ và tên
              </div>
              <div
                style={{
                  fontSize: '15px',
                  color: '#F8FAFC',
                  fontWeight: 600,
                  marginTop: '2px',
                }}
              >
                {employee.full_name}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Email tài khoản
              </div>
              <div
                style={{ fontSize: '15px', color: '#F8FAFC', marginTop: '2px' }}
              >
                {employee.user?.email || 'Chưa liên kết'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Tên đăng nhập
              </div>
              <div
                style={{ fontSize: '15px', color: '#F8FAFC', marginTop: '2px' }}
              >
                {employee.user?.username || '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Tính lương tự động
              </div>
              <div
                style={{ fontSize: '15px', color: '#F8FAFC', marginTop: '2px' }}
              >
                {employee.is_payroll_eligible
                  ? 'Có (Nhân viên)'
                  : 'Không (Chủ sở hữu)'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Ngày tham gia
              </div>
              <div
                style={{ fontSize: '15px', color: '#F8FAFC', marginTop: '2px' }}
              >
                {new Date(employee.created_at).toLocaleDateString('vi-VN')}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleUpdate} style={{ marginBottom: '20px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="editName"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: '#94A3B8',
                  marginBottom: '6px',
                }}
              >
                Họ và tên nhân viên:
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
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {employee.employee_code !== 'OWNER' && (
              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    color: '#F8FAFC',
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
                {isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
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
              borderTop: '1px solid #1E293B',
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
              employee.employee_code !== 'OWNER' && (
                <AppButton variant="destructive" onClick={handleSuspend}>
                  Tạm ngưng công tác
                </AppButton>
              )}

            {employee.employment_status === 'suspended' && (
              <AppButton variant="primary" onClick={handleReactivate}>
                Kích hoạt lại nhân viên
              </AppButton>
            )}

            <AppButton
              variant="secondary"
              onClick={() => onNavigate('/employees')}
            >
              ← Quay lại danh sách
            </AppButton>
          </div>
        )}
      </AppCard>
    </div>
  );
};
