import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PageHeader,
  AppCard,
  AppButton,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  RotateCcwIcon,
  SearchIcon,
  ShieldAlertIcon,
  LockIcon,
  Pagination,
  PAGINATION_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  ActionIconButton,
} from '../../../../packages/ui/src/components/index.js';
import { TOKENS } from '../../../../packages/ui/src/tokens.js';
import type {
  AuditEventData,
  ListAuditEventsResponseData,
} from '../../../../packages/contracts/src/audit.js';
import type { UserRole } from '../types.js';

export interface AuditScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
}

interface ActionBadgeMeta {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'error' | 'info';
  color: string;
}

const ACTION_MAP: Record<string, ActionBadgeMeta> = {
  'auth.login': { label: 'Đăng nhập', variant: 'success', color: '#10B981' },
  'auth.logout': { label: 'Đăng xuất', variant: 'default', color: '#94A3B8' },
  'auth.password_change': {
    label: 'Đổi mật khẩu',
    variant: 'info',
    color: '#38BDF8',
  },
  'auth.session_revocation': {
    label: 'Thu hồi phiên',
    variant: 'error',
    color: '#EF4444',
  },
  'work.create': { label: 'Tạo công việc', variant: 'info', color: '#38BDF8' },
  'work.submit': {
    label: 'Nộp báo cáo việc',
    variant: 'warning',
    color: '#F59E0B',
  },
  'work.approve': {
    label: 'Duyệt công việc',
    variant: 'success',
    color: '#10B981',
  },
  'storage.folder_create': {
    label: 'Tạo thư mục',
    variant: 'info',
    color: '#818CF8',
  },
  'storage.receipt_create': {
    label: 'Tải tệp lên',
    variant: 'info',
    color: '#818CF8',
  },
  'storage.trash_create': {
    label: 'Yêu cầu thùng rác',
    variant: 'warning',
    color: '#F59E0B',
  },
  'storage.trash_confirm': {
    label: 'Xác nhận thùng rác',
    variant: 'error',
    color: '#EF4444',
  },
  'account.create': {
    label: 'Tạo tài khoản ACC',
    variant: 'info',
    color: '#C084FC',
  },
  'account.secret_put': {
    label: 'Lưu mật khẩu ACC',
    variant: 'warning',
    color: '#F59E0B',
  },
  'account.secret_reveal': {
    label: 'Xem secret ACC (C05)',
    variant: 'warning',
    color: '#FB923C',
  },
};

function formatEventTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return isoString;
  }
}

export const AuditScreen: React.FC<AuditScreenProps> = ({
  role = 'owner',
  onNavigate,
}) => {
  const [events, setEvents] = useState<AuditEventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Page-by-page pagination states
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([
    undefined,
  ]);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  // Expandable details
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Race condition guards (AUDIT-004)
  const requestSeqRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchAuditEvents = useCallback(
    async (cursor?: string, targetLimit = pageSize) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(targetLimit));
        if (cursor) queryParams.set('cursor', cursor);
        if (actionFilter) queryParams.set('action', actionFilter);
        if (entityFilter) queryParams.set('entity_type', entityFilter);

        const res = await fetch(`/api/v1/audit?${queryParams.toString()}`, {
          credentials: 'include',
          signal: controller.signal,
        });

        if (seq !== requestSeqRef.current) {
          return;
        }

        if (res.status === 401) {
          setError('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
          return;
        }

        if (res.status === 403) {
          setError(
            'Truy cập bị từ chối: Nhật ký kiểm toán hệ thống chỉ dành cho Chủ sở hữu (Owner).',
          );
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (seq !== requestSeqRef.current) return;
          throw new Error(
            body?.error?.message || `Lỗi tải nhật ký kiểm toán (${res.status})`,
          );
        }

        const json = (await res.json()) as {
          success: boolean;
          data: ListAuditEventsResponseData;
        };
        if (seq !== requestSeqRef.current) {
          return;
        }

        if (json.success && json.data) {
          setEvents(Array.isArray(json.data.items) ? json.data.items : []);
          setNextCursor(json.data.next_cursor);
          if (typeof json.data.total_count === 'number') {
            setTotalCount(json.data.total_count);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (seq === requestSeqRef.current) {
          setError(
            err instanceof Error
              ? err.message
              : 'Lỗi hệ thống khi tải nhật ký kiểm toán.',
          );
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [actionFilter, entityFilter, pageSize],
  );

  // Clean up in-flight request on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
    setCursorHistory([undefined]);
    if (role === 'owner') {
      fetchAuditEvents(undefined, pageSize);
    }
  }, [actionFilter, entityFilter, pageSize, role, fetchAuditEvents]);

  // Handle external audit-updated events
  useEffect(() => {
    const handleAuditUpdated = () => {
      if (role === 'owner') {
        const currentCursor = cursorHistory[currentPage - 1];
        fetchAuditEvents(currentCursor, pageSize);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('audit-updated', handleAuditUpdated);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('audit-updated', handleAuditUpdated);
      }
    };
  }, [role, fetchAuditEvents, cursorHistory, currentPage, pageSize]);

  const handlePrevPage = () => {
    if (currentPage <= 1 || loading) return;
    const prevPage = currentPage - 1;
    const prevCursor = cursorHistory[prevPage - 1];
    setCurrentPage(prevPage);
    fetchAuditEvents(prevCursor, pageSize);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (!nextCursor || loading) return;
    const nextPage = currentPage + 1;
    setCursorHistory((prev) => {
      const next = [...prev];
      next[currentPage] = nextCursor;
      return next;
    });
    setCurrentPage(nextPage);
    fetchAuditEvents(nextCursor, pageSize);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopy = (text: string, id: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Staff guard (C06 & UI19 Owner Only)
  if (role !== 'owner') {
    return (
      <div
        style={{
          maxWidth: '800px',
          margin: '40px auto',
          padding: TOKENS.spacing[4],
        }}
      >
        <AppCard>
          <div style={{ textAlign: 'center', padding: TOKENS.spacing[6] }}>
            <div
              style={{
                color: TOKENS.colors.error,
                marginBottom: TOKENS.spacing[4],
              }}
            >
              <ShieldAlertIcon size={48} />
            </div>
            <h2
              style={{
                color: TOKENS.colors.text,
                fontSize: '20px',
                fontWeight: 600,
                margin: '0 0 8px 0',
              }}
            >
              Truy cập bị từ chối (403 Forbidden)
            </h2>
            <p
              style={{
                color: TOKENS.colors.muted,
                fontSize: '14px',
                marginBottom: TOKENS.spacing[6],
              }}
            >
              Nhật ký kiểm toán hệ thống (UI19) chỉ dành riêng cho tài khoản Chủ
              sở hữu (Owner). Nhân viên không có quyền truy cập nhật ký bảo mật
              (DOC-03, Q3-OPS-003).
            </p>
            {onNavigate && (
              <AppButton variant="primary" onClick={() => onNavigate('/')}>
                Về trang chủ
              </AppButton>
            )}
          </div>
        </AppCard>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: TOKENS.spacing[4],
      }}
    >
      <div data-testid="audit-header">
        <PageHeader
          title="Nhật ký kiểm toán hệ thống"
          subtitle="Lịch sử sự kiện vận hành, truy vết quyền hạn và nhật ký bảo mật hệ thống (UI19, Q3-OPS-003, Q3-ACC-006)"
          badge={
            <StatusBadge status="success" label="Chủ sở hữu (Owner Only)" />
          }
        />
      </div>

      {/* Security Assurance Banner */}
      <div
        data-testid="audit-security-banner"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: TOKENS.spacing[3],
          padding: `${TOKENS.spacing[3]} ${TOKENS.spacing[4]}`,
          backgroundColor: 'rgba(20, 184, 166, 0.08)',
          border: '1px solid rgba(20, 184, 166, 0.25)',
          borderRadius: TOKENS.radii.md,
          marginBottom: TOKENS.spacing[6],
          color: TOKENS.colors.text,
          fontSize: '13px',
        }}
      >
        <LockIcon
          size={18}
          style={{ color: TOKENS.colors.primary, flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <strong style={{ color: TOKENS.colors.primary }}>
            Nguyên tắc an toàn bảo mật:{' '}
          </strong>
          Nhật ký tuân thủ chuẩn <code>Q3-OPS-003</code> và{' '}
          <code>Q3-ACC-006</code>. Toàn bộ mã băm mật khẩu, token phiên, khóa
          AES và thông tin nhạy cảm đã được làm sạch hoàn toàn trước khi hiển
          thị. Dữ liệu chỉ ghi (append-only), không thể chỉnh sửa hay xóa.
        </div>
      </div>

      {/* Filter and Control Bar */}
      <AppCard style={{ marginBottom: TOKENS.spacing[6] }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: TOKENS.spacing[4],
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: TOKENS.spacing[3],
              alignItems: 'center',
              minWidth: 0,
            }}
          >
            {/* Action Filter */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: TOKENS.spacing[2],
                flex: '1 1 220px',
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              <label
                htmlFor="audit-action-filter"
                style={{
                  fontSize: '13px',
                  color: TOKENS.colors.muted,
                  fontWeight: 500,
                }}
              >
                Hành động:
              </label>
              <select
                id="audit-action-filter"
                data-testid="select-audit-action"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                style={{
                  backgroundColor: TOKENS.colors.background,
                  color: TOKENS.colors.text,
                  border: `1px solid ${TOKENS.colors.border}`,
                  borderRadius: TOKENS.radii.sm,
                  padding: '6px 12px',
                  fontSize: '13px',
                  minHeight: '38px',
                  flex: '1 1 160px',
                  minWidth: 0,
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              >
                <option value="">Tất cả hành động</option>
                <option value="auth.login">auth.login (Đăng nhập)</option>
                <option value="auth.logout">auth.logout (Đăng xuất)</option>
                <option value="auth.password_change">
                  auth.password_change (Đổi mật khẩu)
                </option>
                <option value="auth.session_revocation">
                  auth.session_revocation (Thu hồi phiên)
                </option>
                <option value="work.create">work.create (Tạo công việc)</option>
                <option value="work.submit">work.submit (Nộp báo cáo)</option>
                <option value="work.approve">
                  work.approve (Duyệt công việc)
                </option>
                <option value="storage.folder_create">
                  storage.folder_create (Tạo thư mục)
                </option>
                <option value="storage.receipt_create">
                  storage.receipt_create (Biên lai tệp)
                </option>
                <option value="storage.trash_create">
                  storage.trash_create (Yêu cầu thùng rác)
                </option>
                <option value="storage.trash_confirm">
                  storage.trash_confirm (Xác nhận thùng rác)
                </option>
                <option value="account.create">
                  account.create (Tạo tài khoản)
                </option>
                <option value="account.secret_put">
                  account.secret_put (Lưu mật khẩu ACC)
                </option>
                <option value="account.secret_reveal">
                  account.secret_reveal (Xem secret C05)
                </option>
              </select>
            </div>

            {/* Entity Type Filter */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: TOKENS.spacing[2],
                flex: '1 1 220px',
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              <label
                htmlFor="audit-entity-filter"
                style={{
                  fontSize: '13px',
                  color: TOKENS.colors.muted,
                  fontWeight: 500,
                }}
              >
                Thực thể:
              </label>
              <select
                id="audit-entity-filter"
                data-testid="select-audit-entity"
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                style={{
                  backgroundColor: TOKENS.colors.background,
                  color: TOKENS.colors.text,
                  border: `1px solid ${TOKENS.colors.border}`,
                  borderRadius: TOKENS.radii.sm,
                  padding: '6px 12px',
                  fontSize: '13px',
                  minHeight: '38px',
                  flex: '1 1 160px',
                  minWidth: 0,
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              >
                <option value="">Tất cả thực thể</option>
                <option value="session">session (Phiên đăng nhập)</option>
                <option value="user">user (Người dùng)</option>
                <option value="work_item">work_item (Công việc)</option>
                <option value="work_assignment">
                  work_assignment (Phân công)
                </option>
                <option value="storage_folder">
                  storage_folder (Thư mục tệp)
                </option>
                <option value="storage_receipt">
                  storage_receipt (Biên lai tệp)
                </option>
                <option value="storage_trash_request">
                  storage_trash_request (Thùng rác)
                </option>
                <option value="managed_account">
                  managed_account (Tài khoản ACC)
                </option>
                <option value="account_secret">
                  account_secret (Secret bảo mật)
                </option>
                <option value="employee">employee (Hồ sơ nhân sự)</option>
              </select>
            </div>

            {(actionFilter || entityFilter) && (
              <AppButton
                variant="secondary"
                data-testid="btn-reset-filters"
                onClick={() => {
                  setActionFilter('');
                  setEntityFilter('');
                }}
              >
                Đặt lại bộ lọc
              </AppButton>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: TOKENS.spacing[3],
            }}
          >
            <span style={{ fontSize: '13px', color: TOKENS.colors.muted }}>
              Tổng cộng:{' '}
              <strong style={{ color: TOKENS.colors.text }}>
                {totalCount}
              </strong>{' '}
              sự kiện
            </span>
            <AppButton
              variant="secondary"
              data-testid="btn-refresh-audit"
              onClick={() =>
                fetchAuditEvents(cursorHistory[currentPage - 1], pageSize)
              }
              disabled={loading}
            >
              <RotateCcwIcon size={14} style={{ marginRight: '6px' }} />
              Làm mới
            </AppButton>
          </div>
        </div>
      </AppCard>

      {/* Main Content Area */}
      {loading ? (
        <LoadingState message="Đang tải nhật ký kiểm toán hệ thống..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchAuditEvents()} />
      ) : (events || []).length === 0 ? (
        <EmptyState
          title="Không tìm thấy sự kiện kiểm toán nào"
          description={
            actionFilter || entityFilter
              ? 'Không có sự kiện nào khớp với tiêu chí bộ lọc đã chọn. Hãy thử xóa hoặc chọn lại bộ lọc.'
              : 'Hệ thống chưa ghi nhận sự kiện kiểm toán nào trong không gian làm việc này.'
          }
          icon={<SearchIcon size={40} />}
          action={
            actionFilter || entityFilter ? (
              <AppButton
                variant="secondary"
                onClick={() => {
                  setActionFilter('');
                  setEntityFilter('');
                }}
              >
                Xóa bộ lọc
              </AppButton>
            ) : undefined
          }
        />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: TOKENS.spacing[3],
          }}
        >
          {(events || []).map((evt) => {
            const actionMeta = ACTION_MAP[evt.action] || {
              label: evt.action,
              variant: 'default',
              color: '#94A3B8',
            };
            const isExpanded = expandedIds.has(evt.id);

            return (
              <AppCard
                key={evt.id}
                data-testid="audit-event-card"
                style={{
                  padding: TOKENS.spacing[4],
                  transition: 'background-color 0.2s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: TOKENS.spacing[3],
                    marginBottom: TOKENS.spacing[2],
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: TOKENS.spacing[2],
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* Timestamp */}
                    <span
                      style={{
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: TOKENS.colors.muted,
                        backgroundColor: TOKENS.colors.background,
                        padding: '3px 8px',
                        borderRadius: TOKENS.radii.sm,
                        border: `1px solid ${TOKENS.colors.border}`,
                      }}
                    >
                      {formatEventTime(evt.created_at)}
                    </span>

                    {/* Action Badge */}
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: actionMeta.color,
                        backgroundColor: `${actionMeta.color}15`,
                        border: `1px solid ${actionMeta.color}40`,
                        borderRadius: TOKENS.radii.sm,
                        padding: '3px 10px',
                      }}
                    >
                      {actionMeta.label}
                    </span>

                    <span
                      style={{
                        fontSize: '12px',
                        color: TOKENS.colors.muted,
                        fontFamily: 'monospace',
                      }}
                    >
                      ({evt.action})
                    </span>
                  </div>

                  {/* Actor details */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: TOKENS.spacing[2],
                    }}
                  >
                    <span
                      style={{ fontSize: '13px', color: TOKENS.colors.muted }}
                    >
                      Thực hiện bởi:
                    </span>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: evt.actor_username
                          ? TOKENS.colors.primary
                          : TOKENS.colors.text,
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        padding: '2px 8px',
                        borderRadius: TOKENS.radii.sm,
                      }}
                    >
                      {evt.actor_username || 'Hệ thống'}
                    </span>
                  </div>
                </div>

                {/* Target & Request ID details */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: TOKENS.spacing[4],
                    fontSize: '13px',
                    color: TOKENS.colors.muted,
                    paddingTop: TOKENS.spacing[2],
                    borderTop: `1px solid rgba(51, 65, 85, 0.5)`,
                  }}
                >
                  <div>
                    <span style={{ color: TOKENS.colors.muted }}>
                      Thực thể:{' '}
                    </span>
                    <strong style={{ color: TOKENS.colors.text }}>
                      {evt.entity_type || 'N/A'}
                    </strong>
                    {evt.entity_id && (
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          marginLeft: '6px',
                          color: '#93C5FD',
                        }}
                      >
                        #{evt.entity_id.slice(0, 8)}...
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span style={{ color: TOKENS.colors.muted }}>Req ID: </span>
                    {evt.request_id ? (
                      <>
                        <code
                          style={{
                            fontSize: '11px',
                            backgroundColor: TOKENS.colors.background,
                            padding: '2px 6px',
                            borderRadius: TOKENS.radii.sm,
                            color: TOKENS.colors.muted,
                          }}
                          title={evt.request_id}
                        >
                          {evt.request_id.slice(0, 8)}...
                        </code>
                        <ActionIconButton
                          action="copy"
                          target={`Request ID ${evt.request_id}`}
                          label={
                            copiedId === evt.id
                              ? 'Đã sao chép!'
                              : 'Sao chép Request ID'
                          }
                          onClick={() => handleCopy(evt.request_id, evt.id)}
                          testId={`btn-copy-${evt.id}`}
                        />
                      </>
                    ) : null}
                  </div>

                  <div style={{ marginLeft: 'auto' }}>
                    <button
                      type="button"
                      data-testid="btn-expand-metadata"
                      onClick={() => toggleExpand(evt.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: TOKENS.colors.primary,
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: TOKENS.radii.sm,
                        fontWeight: 500,
                        textDecoration: 'underline',
                      }}
                    >
                      {isExpanded
                        ? 'Ẩn chi tiết kỹ thuật'
                        : 'Xem chi tiết kỹ thuật'}
                    </button>
                  </div>
                </div>

                {/* Expandable Technical Details (Sanitized metadata) */}
                {isExpanded && (
                  <div
                    data-testid="audit-metadata-block"
                    style={{
                      marginTop: TOKENS.spacing[3],
                      padding: TOKENS.spacing[3],
                      backgroundColor: '#070D18',
                      borderRadius: TOKENS.radii.sm,
                      border: `1px solid ${TOKENS.colors.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: TOKENS.spacing[2],
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: TOKENS.colors.muted,
                          letterSpacing: '0.5px',
                        }}
                      >
                        DỮ LIỆU SIÊU DỮ LIỆU ĐÃ LÀM SẠCH (SANITIZED METADATA)
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          color: TOKENS.colors.success,
                        }}
                      >
                        ✓ Không chứa mã băm, token hay secret
                      </span>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: '12px',
                        fontFamily:
                          'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        color: '#A7F3D0',
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        lineHeight: 1.5,
                      }}
                    >
                      {JSON.stringify(evt.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </AppCard>
            );
          })}

          {/* Unified Pagination */}
          <div
            data-testid="audit-pagination-controls"
            style={{ marginTop: 16 }}
          >
            {/* Tải thêm sự kiện cũ hơn */}
            <Pagination
              testId="audit-pager"
              total={totalCount}
              page={currentPage - 1}
              pageSize={pageSize}
              onPage={(p) => {
                if (p > currentPage - 1) {
                  handleNextPage();
                } else if (p < currentPage - 1) {
                  handlePrevPage();
                }
              }}
              onPageSize={(newSize) => {
                setPageSize(newSize);
                setCurrentPage(1);
                setCursorHistory([undefined]);
                fetchAuditEvents(undefined, newSize);
              }}
              pageSizes={PAGINATION_PAGE_SIZES}
              loading={loading}
              hasNext={Boolean(nextCursor)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
export default AuditScreen;
