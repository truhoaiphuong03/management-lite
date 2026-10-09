import React, { useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  PlusIcon,
  CheckIcon,
  CloseIcon,
  LinkIcon,
  CopyIcon,
} from '@management-lite/ui/components';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

export interface EmployeesScreenProps {
  onNavigate: (path: string) => void;
}

export const EmployeesScreen: React.FC<EmployeesScreenProps> = ({
  onNavigate,
}) => {
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activeInviteUrl, setActiveInviteUrl] = useState<string | null>(null);

  const fetchEmployees = async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        statusFilter === 'all'
          ? '/api/v1/employees'
          : `/api/v1/employees?status=${encodeURIComponent(statusFilter)}`;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không thể tải danh sách nhân sự',
        );
      }
      setEmployees(data.data.items || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi kết nối máy chủ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [statusFilter]);

  const handleSuspend = async (emp: EmployeeData) => {
    const reason = window.prompt(
      `Nhập lý do tạm ngưng nhân viên ${emp.full_name}:`,
      'Nghỉ việc tạm thời',
    );
    if (!reason) return;

    try {
      const res = await fetch(`/api/v1/employees/${emp.id}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${emp.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không thể tạm ngưng nhân viên',
        );
      }
      setActionSuccess(`Đã tạm ngưng nhân viên ${emp.full_name}`);
      fetchEmployees();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    }
  };

  const handleReactivate = async (emp: EmployeeData) => {
    const reason = window.prompt(
      `Nhập lý do kích hoạt lại nhân viên ${emp.full_name}:`,
      'Đi làm trở lại',
    );
    if (!reason) return;

    try {
      const res = await fetch(`/api/v1/employees/${emp.id}/reactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${emp.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không thể kích hoạt lại nhân viên',
        );
      }
      setActionSuccess(`Đã kích hoạt lại nhân viên ${emp.full_name}`);
      fetchEmployees();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    }
  };

  const handleGetInvite = async (emp: EmployeeData) => {
    try {
      const res = await fetch(
        `/api/v1/employees/${emp.id}/activation-invites`,
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
          data?.error?.message || 'Không thể tạo mã kích hoạt mới',
        );
      }
      const token = data.data.token;
      const inviteUrl = `${window.location.origin}/activate?token=${encodeURIComponent(token)}`;
      setActiveInviteUrl(inviteUrl);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Lỗi tạo liên kết');
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

  return (
    <div>
      <PageHeader
        title="Quản lý nhân sự"
        subtitle="Danh sách nhân viên, tài khoản và trạng thái công tác thật trong cửa hàng"
        badge={
          <AppButton
            variant="primary"
            onClick={() => onNavigate('/employees/new')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <PlusIcon size={16} />
            <span>Thêm nhân sự</span>
          </AppButton>
        }
      />

      {/* Success banner */}
      {actionSuccess && (
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
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckIcon size={18} />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#10B981',
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
              color: '#14B8A6',
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

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
      >
        {[
          { key: 'all', label: 'Tất cả' },
          { key: 'active', label: 'Đang hoạt động' },
          { key: 'invited', label: 'Chờ kích hoạt' },
          { key: 'suspended', label: 'Tạm ngưng' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            style={{
              boxSizing: 'border-box',
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: statusFilter === tab.key ? '#14B8A6' : '#334155',
              backgroundColor:
                statusFilter === tab.key
                  ? 'rgba(20, 184, 166, 0.15)'
                  : '#1E293B',
              color: statusFilter === tab.key ? '#14B8A6' : '#94A3B8',
              fontSize: '13px',
              fontWeight: 600,
              lineHeight: 1.2,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition:
                'border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Rendering */}
      {loading ? (
        <LoadingState message="Đang tải danh sách nhân sự..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchEmployees} />
      ) : employees.length === 0 ? (
        <EmptyState
          title="Chưa có nhân viên nào"
          description="Bấm nút 'Thêm nhân sự' phía trên để mời nhân viên đầu tiên vào cửa hàng."
          action={
            <AppButton
              variant="primary"
              onClick={() => onNavigate('/employees/new')}
            >
              Thêm nhân sự mới
            </AppButton>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {employees.map((emp) => (
            <AppCard key={emp.id} padding="16px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: '#334155',
                        color: '#F8FAFC',
                        fontWeight: 600,
                      }}
                    >
                      {emp.employee_code}
                    </span>
                    <strong style={{ fontSize: '15px', color: '#F8FAFC' }}>
                      {emp.full_name}
                    </strong>
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginTop: '4px',
                    }}
                  >
                    Email: {emp.user?.email || 'Chưa liên kết'}
                  </div>
                </div>
                <div>{getStatusBadge(emp.employment_status)}</div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid #1E293B',
                  paddingTop: '12px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  {emp.is_payroll_eligible
                    ? 'Tính lương tự động'
                    : 'Không tính lương (Owner)'}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <AppButton
                    variant="secondary"
                    onClick={() => onNavigate(`/employees/${emp.id}`)}
                  >
                    Chi tiết
                  </AppButton>

                  {emp.employment_status === 'invited' && (
                    <AppButton
                      variant="secondary"
                      onClick={() => handleGetInvite(emp)}
                    >
                      Lấy link mời
                    </AppButton>
                  )}

                  {emp.employment_status === 'active' &&
                    emp.employee_code !== 'OWNER' && (
                      <AppButton
                        variant="destructive"
                        onClick={() => handleSuspend(emp)}
                      >
                        Tạm ngưng
                      </AppButton>
                    )}

                  {emp.employment_status === 'suspended' && (
                    <AppButton
                      variant="primary"
                      onClick={() => handleReactivate(emp)}
                    >
                      Kích hoạt lại
                    </AppButton>
                  )}
                </div>
              </div>
            </AppCard>
          ))}
        </div>
      )}
    </div>
  );
};
