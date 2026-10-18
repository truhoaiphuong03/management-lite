import React, { useEffect, useState, useRef } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  ErrorState,
  EmptyState,
  PlusIcon,
  CheckIcon,
  CloseIcon,
  LinkIcon,
  CopyIcon,
  ListFooter,
  AppDialog,
  AppToast,
  ActionIconButton,
  AppSkeleton,
  type ToastVariant,
} from '../../../../packages/ui/src/components/index.js';
import { TOKENS } from '../../../../packages/ui/src/tokens.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

export interface EmployeesScreenProps {
  onNavigate: (path: string) => void;
}

export const EmployeesScreen: React.FC<EmployeesScreenProps> = ({
  onNavigate,
}) => {
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activeInviteUrl, setActiveInviteUrl] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    variant?: ToastVariant;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'suspend' | 'reactivate';
    employee: EmployeeData;
    reason: string;
    loading: boolean;
  } | null>(null);

  const requestSeqRef = useRef<number>(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const fetchCsrf = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!active) return;
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
      controller.abort();
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

  const fetchEmployees = async (cursor?: string, append = false) => {
    const currentSeq = ++requestSeqRef.current;
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
      activeControllerRef.current = null;
    }

    if (append) {
      setLoadingMore(true);
      setPaginationError(null);
    } else {
      setLoading(true);
      setEmployees([]);
      setNextCursor(null);
      setError(null);
      setPaginationError(null);
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;

    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (cursor) {
        params.set('cursor', cursor);
      }

      const res = await fetch(`/api/v1/employees?${params.toString()}`, {
        credentials: 'include',
        signal: controller.signal,
      });

      if (currentSeq !== requestSeqRef.current) return;

      const data = await res.json();

      if (currentSeq !== requestSeqRef.current) return;

      if (!res.ok) {
        throw new Error(
          data?.error?.message || 'Không thể tải danh sách nhân sự',
        );
      }

      const newItems: EmployeeData[] = data.data?.items || [];
      setEmployees((prev) =>
        append
          ? [
              ...prev,
              ...newItems.filter((item) => !prev.some((p) => p.id === item.id)),
            ]
          : newItems,
      );
      setNextCursor(data.data?.next_cursor || null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (currentSeq !== requestSeqRef.current) return;
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối máy chủ';
      if (append) {
        setPaginationError(msg);
      } else {
        setError(msg);
      }
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
      if (currentSeq === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    fetchEmployees();
    return () => {
      requestSeqRef.current++;
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
        activeControllerRef.current = null;
      }
    };
  }, [statusFilter]);

  const isOwnerSelf = (emp: EmployeeData): boolean => {
    if (
      currentUserId &&
      (emp.user_id === currentUserId || emp.user?.id === currentUserId)
    ) {
      return true;
    }
    return emp.employee_code === 'OWNER' || emp.employee_code === 'ADMIN';
  };

  const handleSuspend = (emp: EmployeeData) => {
    if (isOwnerSelf(emp)) {
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
      employee: emp,
      reason: 'Nghỉ việc tạm thời',
      loading: false,
    });
  };

  const handleReactivate = (emp: EmployeeData) => {
    setConfirmDialog({
      isOpen: true,
      type: 'reactivate',
      employee: emp,
      reason: 'Đi làm trở lại',
      loading: false,
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog) return;
    const { type, employee: emp, reason } = confirmDialog;
    if (!reason.trim()) return;

    setConfirmDialog((prev) => (prev ? { ...prev, loading: true } : null));

    try {
      const token = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${emp.version}"`,
      };
      if (token) headers['X-CSRF-Token'] = token;

      const endpoint = type === 'suspend' ? 'suspend' : 'reactivate';
      const res = await fetch(`/api/v1/employees/${emp.id}/${endpoint}`, {
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
              ? 'Không thể tạm ngưng nhân viên'
              : 'Không thể kích hoạt lại nhân viên'),
        );
      }
      const msg =
        type === 'suspend'
          ? `Đã tạm ngưng nhân viên ${emp.full_name}`
          : `Đã kích hoạt lại nhân viên ${emp.full_name}`;
      setActionSuccess(msg);
      setToast({ message: msg, variant: 'success' });
      setConfirmDialog(null);
      fetchEmployees();
    } catch (err: unknown) {
      setConfirmDialog((prev) => (prev ? { ...prev, loading: false } : null));
      setToast({
        message: err instanceof Error ? err.message : 'Thao tác thất bại',
        variant: 'error',
      });
    }
  };

  const handleGetInvite = async (emp: EmployeeData) => {
    try {
      const token = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['X-CSRF-Token'] = token;

      const res = await fetch(
        `/api/v1/employees/${emp.id}/activation-invites`,
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
          data?.error?.message || 'Không thể tạo mã kích hoạt mới',
        );
      }
      const tokenVal = data.data.token;
      const inviteUrl = `${window.location.origin}/activate?token=${encodeURIComponent(tokenVal)}`;
      setActiveInviteUrl(inviteUrl);
      setToast({
        message: 'Đã tạo mã kích hoạt mới thành công!',
        variant: 'success',
      });
    } catch (err: unknown) {
      setToast({
        message: err instanceof Error ? err.message : 'Lỗi tạo liên kết',
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

  const filteredEmployees = employees.filter((emp) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (emp.employee_code && emp.employee_code.toLowerCase().includes(q)) ||
      (emp.full_name && emp.full_name.toLowerCase().includes(q)) ||
      (emp.user?.email && emp.user.email.toLowerCase().includes(q)) ||
      (emp.user?.username && emp.user.username.toLowerCase().includes(q))
    );
  });

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
            aria-label="Đóng thông báo"
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
              minHeight: '44px',
              minWidth: '44px',
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
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <AppButton
              variant="primary"
              onClick={async () => {
                try {
                  if (!navigator?.clipboard?.writeText) {
                    throw new Error('Clipboard API không được hỗ trợ');
                  }
                  await navigator.clipboard.writeText(activeInviteUrl);
                  setToast({
                    message: 'Đã sao chép liên kết kích hoạt vào bộ nhớ tạm!',
                    variant: 'success',
                  });
                } catch (err: unknown) {
                  setToast({
                    message:
                      err instanceof Error
                        ? `Không thể sao chép liên kết: ${err.message}`
                        : 'Không thể sao chép liên kết vào bộ nhớ tạm.',
                    variant: 'error',
                  });
                }
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

      {/* Search Input & Filter Tabs */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
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
                minHeight: '40px',
                padding: '8px 14px',
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

        <div
          style={{
            minWidth: 'min(100%, 220px)',
            flex: '1 1 220px',
            maxWidth: '360px',
          }}
        >
          <input
            type="text"
            data-testid="employee-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên, mã NV, email..."
            aria-label="Tìm kiếm nhân sự"
            style={{
              width: '100%',
              minHeight: '44px',
              boxSizing: 'border-box',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #334155',
              backgroundColor: '#1E293B',
              color: '#F8FAFC',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Content Rendering */}
      {loading ? (
        <div
          data-testid="employees-skeleton-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            paddingBottom: '96px',
          }}
          aria-busy="true"
          aria-label="Đang tải danh sách nhân sự"
        >
          {[1, 2, 3].map((k) => (
            <AppCard key={k} padding="16px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                  }}
                >
                  <AppSkeleton variant="circle" width={40} height={40} />
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <AppSkeleton variant="text" width="140px" height="18px" />
                    <AppSkeleton variant="text" width="90px" height="14px" />
                  </div>
                </div>
                <AppSkeleton variant="rect" width="90px" height="24px" />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <AppSkeleton variant="text" width="150px" height="14px" />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <AppSkeleton variant="circle" width={32} height={32} />
                  <AppSkeleton variant="circle" width={32} height={32} />
                </div>
              </div>
            </AppCard>
          ))}
        </div>
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
      ) : filteredEmployees.length === 0 ? (
        <EmptyState
          title="Không tìm thấy nhân viên"
          description={`Không tìm thấy nhân sự nào khớp với từ khóa "${searchQuery}".`}
          action={
            <AppButton variant="secondary" onClick={() => setSearchQuery('')}>
              Xóa bộ lọc tìm kiếm
            </AppButton>
          }
        />
      ) : (
        <div
          data-testid="employees-list-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            paddingBottom: '96px',
          }}
        >
          {filteredEmployees.map((emp) => (
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
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <ActionIconButton
                    action="view"
                    target={emp.full_name}
                    onClick={() => onNavigate(`/employees/${emp.id}`)}
                    testId={`btn-view-${emp.id}`}
                  />

                  {emp.employment_status === 'invited' && (
                    <AppButton
                      variant="secondary"
                      onClick={() => handleGetInvite(emp)}
                    >
                      Lấy link mời
                    </AppButton>
                  )}

                  {emp.employment_status === 'active' &&
                    (isOwnerSelf(emp) ? (
                      <ActionIconButton
                        action="deactivate"
                        target={emp.full_name}
                        disabled
                        label="Chủ sở hữu không thể tự tạm ngưng hoặc khóa tài khoản của chính mình"
                      />
                    ) : (
                      <ActionIconButton
                        action="deactivate"
                        target={emp.full_name}
                        onClick={() => handleSuspend(emp)}
                      />
                    ))}

                  {emp.employment_status === 'suspended' && (
                    <ActionIconButton
                      action="reactivate"
                      target={emp.full_name}
                      onClick={() => handleReactivate(emp)}
                    />
                  )}
                </div>
              </div>
            </AppCard>
          ))}
          {paginationError && (
            <div
              role="alert"
              style={{
                marginTop: TOKENS.spacing[4],
                padding: `${TOKENS.spacing[3]} ${TOKENS.spacing[4]}`,
                borderRadius: TOKENS.radii.sm,
                backgroundColor: TOKENS.colors.dangerSubtle,
                border: `1px solid ${TOKENS.colors.danger}`,
                color: TOKENS.colors.danger,
                fontSize: TOKENS.typography.fontSize.base,
                textAlign: 'center',
              }}
            >
              {paginationError}
            </div>
          )}
          {nextCursor && (
            <div
              data-testid="employees-list-footer-container"
              style={{
                marginTop: TOKENS.spacing[4],
                paddingBottom: '16px',
              }}
            >
              <ListFooter
                itemCount={employees.length}
                hasNextPage={Boolean(nextCursor)}
                onLoadMore={() => fetchEmployees(nextCursor, true)}
                isLoadingMore={loadingMore}
                loadMoreLabel="Tải thêm nhân sự"
              />
            </div>
          )}
        </div>
      )}

      {confirmDialog && (
        <AppDialog
          isOpen={confirmDialog.isOpen}
          onClose={() => !confirmDialog.loading && setConfirmDialog(null)}
          title={
            confirmDialog.type === 'suspend'
              ? `Tạm ngưng nhân viên ${confirmDialog.employee.full_name}`
              : `Kích hoạt lại nhân viên ${confirmDialog.employee.full_name}`
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
              htmlFor="employee-action-reason"
              style={{ fontSize: '13px', color: TOKENS.colors.muted }}
            >
              Nhập lý do thực hiện thao tác:
            </label>
            <input
              id="employee-action-reason"
              type="text"
              value={confirmDialog.reason}
              onChange={(e) =>
                setConfirmDialog((prev) =>
                  prev ? { ...prev, reason: e.target.value } : null,
                )
              }
              placeholder="Nhập lý do..."
              disabled={confirmDialog.loading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: TOKENS.radii.md,
                border: `1px solid ${TOKENS.colors.border}`,
                backgroundColor: TOKENS.colors.background,
                color: TOKENS.colors.text,
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
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
