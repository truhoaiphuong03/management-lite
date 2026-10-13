import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PageHeader,
  AppCard,
  AppButton,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  ArrowLeftIcon,
  RotateCcwIcon,
  CopyIcon,
  CheckIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  CloseIcon,
} from '../../../../packages/ui/src/components/index.js';
import type {
  IssueData,
  IssueActivityData,
  IssueStatus,
  IssueType,
  IssueActivityAction,
  IssueDetailResponseData,
} from '../../../../packages/contracts/src/issues.js';
import type { UserRole } from '../types.js';
import { getModuleNameFromPath } from '../components/ReportBugWidget.js';

export interface IssueDetailScreenProps {
  issueId: string;
  role?: UserRole;
  csrfToken?: string;
  onNavigate: (path: string) => void;
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
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

function getStatusBadge(status: IssueStatus): {
  status: 'success' | 'warning' | 'error' | 'muted' | 'neutral';
  label: string;
} {
  switch (status) {
    case 'open':
      return { status: 'neutral', label: 'Mở (Open)' };
    case 'analyzing':
      return { status: 'warning', label: 'Đang phân tích' };
    case 'fixing':
      return { status: 'warning', label: 'Đang sửa' };
    case 'awaiting_owner':
      return { status: 'warning', label: 'Chờ Owner duyệt' };
    case 'closed':
      return { status: 'success', label: 'Đã đóng' };
    default:
      return { status: 'muted', label: status };
  }
}

function getTypeBadge(type: IssueType): {
  status: 'error' | 'neutral';
  label: string;
} {
  switch (type) {
    case 'bug':
      return { status: 'error', label: 'Lỗi (Bug)' };
    case 'improvement':
      return { status: 'neutral', label: 'Cải tiến' };
    default:
      return { status: 'neutral', label: type };
  }
}

function getActivityActionBadge(action: IssueActivityAction): {
  status: 'success' | 'warning' | 'error' | 'muted' | 'neutral';
  label: string;
} {
  switch (action) {
    case 'created':
      return { status: 'neutral', label: 'Tạo vấn đề' };
    case 'edited':
      return { status: 'warning', label: 'Chỉnh sửa' };
    case 'status_changed':
      return { status: 'warning', label: 'Chuyển trạng thái' };
    case 'fix_confirmed':
      return { status: 'success', label: 'Xác nhận khắc phục (Đóng)' };
    case 'reopened':
      return { status: 'error', label: 'Mở lại vấn đề' };
    default:
      return { status: 'muted', label: action };
  }
}

export const IssueDetailScreen: React.FC<IssueDetailScreenProps> = ({
  issueId,
  role,
  csrfToken,
  onNavigate,
}) => {
  const [issue, setIssue] = useState<IssueData | null>(null);
  const [activities, setActivities] = useState<IssueActivityData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<{
    title?: string;
    message: string;
    isNotFound?: boolean;
  } | null>(null);

  const [copied, setCopied] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Fix Confirmation & Reopen action states
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showConfirmFixModal, setShowConfirmFixModal] =
    useState<boolean>(false);
  const [confirmComment, setConfirmComment] = useState<string>('');

  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [reopenComment, setReopenComment] = useState<string>('');

  const isOwner = role === undefined || role === 'owner';

  const requestSeqRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCopyIssuePrompt = async () => {
    if (!issue) return;
    const origin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'http://127.0.0.1:3017';
    const moduleName = getModuleNameFromPath(issue.route_template);
    const statusMeta = getStatusBadge(issue.status);
    const detailUrl = `${origin}/issues/${issue.id}`;

    const lines: string[] = [
      `# BÁO CÁO LỖI: ${issue.title}`,
      `- **Mã định danh (ID):** \`${issue.id}\``,
      `- **Trạng thái thực tế:** \`${issue.status}\` (${statusMeta.label})`,
      `- **Phân loại:** ${issue.type === 'bug' ? 'Lỗi (Bug)' : 'Cải tiến'}`,
      `- **Phân hệ / Module:** ${moduleName}`,
      `- **Đường dẫn màn hình (Route):** \`${issue.route_template}\``,
      `- **Thời gian báo cáo:** ${formatTimestamp(issue.created_at)}`,
      `- **Thời gian cập nhật:** ${formatTimestamp(issue.updated_at)}`,
      `- **Phiên bản dữ liệu:** v${issue.version}`,
      `- **Người báo cáo:** ${issue.reporter_name || 'Owner'}`,
      `- **Liên kết chi tiết:** ${detailUrl}`,
      '',
      `## Nội dung chi tiết (Mô tả nguyên văn):`,
      issue.description && issue.description.trim()
        ? issue.description
        : '(Không có mô tả chi tiết)',
      '',
      `## Lịch sử xử lý & Ghi chú (Activities):`,
    ];

    if (!activities || activities.length === 0) {
      lines.push('- *Chưa có lịch sử hoạt động ghi nhận.*');
    } else {
      activities.forEach((act) => {
        const actTime = formatTimestamp(act.created_at);
        const actor = act.actor_name || 'Hệ thống';
        const meta = act.metadata_sanitized || {};
        let extraNote = '';
        if (typeof meta.reason === 'string' && meta.reason.trim()) {
          extraNote += ` | Lý do: "${meta.reason.trim()}"`;
        }
        if (typeof meta.comment === 'string' && meta.comment.trim()) {
          extraNote += ` | Ghi chú: "${meta.comment.trim()}"`;
        }
        lines.push(
          `- [${actTime}] ${actor} — Hành động: \`${act.action}\`${extraNote}`,
        );
      });
    }

    lines.push('');
    lines.push('---');
    lines.push(
      'ChatGPT: Phân tích từng lỗi theo ID, nội dung gốc và trạng thái. Xác định lỗi cần sửa mới, đang xử lý hoặc cần kiểm tra lại. Kiểm tra trùng lặp, chuẩn bị nhiệm vụ tối thiểu cho Anti và đánh giá kết quả kiểm thử. Không tự kết luận lỗi đã hoàn thành nếu chưa có bằng chứng.',
    );

    const promptText = lines.join('\n');

    setCopyError(null);
    let copySuccess = false;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(promptText);
        copySuccess = true;
      }
    } catch {
      // Fallback below
    }

    if (!copySuccess && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = promptText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          copySuccess = true;
        }
      } catch {
        copySuccess = false;
      }
    }

    if (copySuccess) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyError(
        'Không thể sao chép vào bộ nhớ tạm (Clipboard). Vui lòng kiểm tra quyền truy cập của trình duyệt.',
      );
      setTimeout(() => setCopyError(null), 5000);
    }
  };

  const fetchDetail = useCallback(async () => {
    // Abort any earlier pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentSeq = ++requestSeqRef.current;

    if (!issueId) {
      setError({
        title: 'Mã vấn đề không hợp lệ',
        message: 'Đường dẫn thiếu mã định danh vấn đề.',
        isNotFound: true,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/issues/${encodeURIComponent(issueId)}`, {
        credentials: 'include',
        signal: controller.signal,
      });

      // Discard if a newer request was initiated
      if (currentSeq !== requestSeqRef.current) return;

      if (res.status === 404) {
        setError({
          title: 'Không tìm thấy vấn đề (404 Not Found)',
          message:
            'Vấn đề không tồn tại hoặc thuộc không gian làm việc (workspace) khác.',
          isNotFound: true,
        });
        return;
      }

      if (res.status === 401) {
        setError({
          title: 'Phiên làm việc hết hạn',
          message: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
        });
        return;
      }

      if (res.status === 403) {
        setError({
          title: 'Truy cập bị từ chối (403 Forbidden)',
          message:
            'Chỉ Chủ sở hữu (Owner) mới có quyền truy cập chi tiết Issues.',
        });
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message || `Lỗi tải chi tiết vấn đề (${res.status})`,
        );
      }

      const json = (await res.json()) as {
        success: boolean;
        data: IssueDetailResponseData;
      };

      if (currentSeq !== requestSeqRef.current) return;

      if (json.success && json.data) {
        setIssue(json.data.issue);
        setActivities(json.data.activities || []);
      } else {
        throw new Error('Định dạng dữ liệu phản hồi từ máy chủ không hợp lệ.');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (currentSeq !== requestSeqRef.current) return;

      setError({
        title: 'Lỗi tải dữ liệu',
        message:
          err instanceof Error
            ? err.message
            : 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại đường truyền.',
      });
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [issueId]);

  useEffect(() => {
    fetchDetail();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDetail]);

  const getEffectiveCsrfToken = async (): Promise<string | undefined> => {
    if (csrfToken) return csrfToken;
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        return data.data?.csrf_token;
      }
    } catch {
      // Fallback
    }
    return undefined;
  };

  const handleConfirmFix = async () => {
    if (!issue || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const effectiveCsrf = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${issue.version}"`,
        'Idempotency-Key': `confirm-fix-${issue.id}-${issue.version}-${Date.now()}`,
      };
      if (effectiveCsrf) {
        headers['X-CSRF-Token'] = effectiveCsrf;
      }

      const res = await fetch(
        `/api/v1/issues/${encodeURIComponent(issue.id)}/confirm-fix`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            comment: confirmComment.trim() || undefined,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message || `Lỗi xác nhận sửa lỗi (${res.status})`,
        );
      }

      await fetchDetail();
      setShowConfirmFixModal(false);
      setConfirmComment('');
      setActionSuccess(
        'Đã xác nhận khắc phục thành công! Vấn đề đã được đóng.',
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('issues-updated'));
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ.',
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleReopen = async () => {
    if (!issue || actionLoading) return;
    const cleanReason = reopenReason.trim();
    if (!cleanReason) {
      setActionError('Vui lòng nhập lý do mở lại vấn đề.');
      return;
    }
    if (cleanReason.length > 1000) {
      setActionError('Lý do mở lại không được vượt quá 1000 ký tự.');
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const effectiveCsrf = await getEffectiveCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${issue.version}"`,
        'Idempotency-Key': `reopen-${issue.id}-${issue.version}-${Date.now()}`,
      };
      if (effectiveCsrf) {
        headers['X-CSRF-Token'] = effectiveCsrf;
      }

      const res = await fetch(
        `/api/v1/issues/${encodeURIComponent(issue.id)}/reopen`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            reason: cleanReason,
            comment: reopenComment.trim() || undefined,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message || `Lỗi mở lại vấn đề (${res.status})`,
        );
      }

      await fetchDetail();
      setShowReopenModal(false);
      setReopenReason('');
      setReopenComment('');
      setActionSuccess(
        'Đã mở lại vấn đề thành công! Trạng thái đã chuyển sang Mở (Open).',
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('issues-updated'));
      }
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ.',
      );
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: '16px' }}>
          <AppButton
            variant="secondary"
            onClick={() => onNavigate('/issues')}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ArrowLeftIcon size={16} />
            <span>Quay lại danh sách</span>
          </AppButton>
        </div>
        <LoadingState message="Đang tải chi tiết vấn đề..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: '16px' }}>
          <AppButton
            variant="secondary"
            onClick={() => onNavigate('/issues')}
            data-testid="btn-back-to-list"
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ArrowLeftIcon size={16} />
            <span>Quay lại danh sách</span>
          </AppButton>
        </div>
        <ErrorState
          title={error.title || 'Có lỗi xảy ra'}
          message={error.message}
          {...(!error.isNotFound && {
            onRetry: () => {
              void fetchDetail();
            },
          })}
        />
      </div>
    );
  }

  if (!issue) {
    return null;
  }

  const statusMeta = getStatusBadge(issue.status);
  const typeMeta = getTypeBadge(issue.type);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
      {/* Top action row */}
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
        <AppButton
          variant="secondary"
          onClick={() => onNavigate('/issues')}
          data-testid="btn-back-to-issues"
          style={{
            minHeight: '44px',
            minWidth: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <ArrowLeftIcon size={16} />
          <span>Quay lại danh sách</span>
        </AppButton>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {isOwner && issue.status !== 'closed' && (
            <AppButton
              variant="primary"
              onClick={() => {
                setActionError(null);
                setShowConfirmFixModal(true);
              }}
              data-testid="btn-confirm-fix"
              disabled={actionLoading}
              style={{
                minHeight: '44px',
                minWidth: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#10B981',
                borderColor: '#10B981',
                color: '#FFFFFF',
              }}
            >
              <CheckIcon size={16} />
              <span>Xác nhận đã sửa</span>
            </AppButton>
          )}

          {isOwner && issue.status === 'closed' && (
            <AppButton
              variant="secondary"
              onClick={() => {
                setActionError(null);
                setShowReopenModal(true);
              }}
              data-testid="btn-reopen-issue"
              disabled={actionLoading}
              style={{
                minHeight: '44px',
                minWidth: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: '#F59E0B',
                borderColor: '#F59E0B',
              }}
            >
              <RotateCcwIcon size={16} />
              <span>Mở lại lỗi</span>
            </AppButton>
          )}

          <AppButton
            variant="secondary"
            onClick={handleCopyIssuePrompt}
            data-testid="btn-copy-issue-prompt"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: copied ? '#10B981' : undefined,
              borderColor: copied ? '#10B981' : undefined,
            }}
          >
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            <span>
              {copied
                ? 'Đã sao chép thông tin lỗi'
                : 'Sao chép để giao việc (Copy)'}
            </span>
          </AppButton>

          <AppButton
            variant="secondary"
            onClick={fetchDetail}
            data-testid="btn-refresh-detail"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RotateCcwIcon size={16} />
            <span>Làm mới</span>
          </AppButton>
        </div>
      </div>

      {/* Page Header */}
      <PageHeader
        title={issue.title}
        subtitle={`ID: ${issue.id} • Phiên bản: v${issue.version}`}
        actions={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge status={typeMeta.status} label={typeMeta.label} />
            <StatusBadge status={statusMeta.status} label={statusMeta.label} />
          </div>
        }
      />

      {/* Action Notification Banners */}
      {actionSuccess && (
        <div
          data-testid="action-success-banner"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10B981',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: '#34D399',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircleIcon size={18} />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#34D399',
              cursor: 'pointer',
              padding: '4px',
              display: 'inline-flex',
            }}
            aria-label="Đóng thông báo"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {copyError && (
        <div
          data-testid="copy-error-banner"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #EF4444',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: '#F87171',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangleIcon size={18} />
            <span>{copyError}</span>
          </div>
          <button
            type="button"
            onClick={() => setCopyError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#F87171',
              cursor: 'pointer',
              padding: '4px',
              display: 'inline-flex',
            }}
            aria-label="Đóng thông báo lỗi sao chép"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {actionError && (
        <div
          data-testid="action-error-banner"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #EF4444',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: '#F87171',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangleIcon size={18} />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#F87171',
              cursor: 'pointer',
              padding: '4px',
              display: 'inline-flex',
            }}
            aria-label="Đóng thông báo lỗi"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* Main Metadata Card */}
      <AppCard style={{ marginBottom: '24px', padding: '24px' }}>
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#F8FAFC',
            marginBottom: '16px',
            borderBottom: '1px solid #334155',
            paddingBottom: '8px',
          }}
        >
          Thông tin chi tiết
        </h3>

        {/* Grid info */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          <div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: '#94A3B8',
                marginBottom: '4px',
              }}
            >
              Tuyến đường (Route Template)
            </span>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(51, 65, 85, 0.4)',
                color: '#F8FAFC',
                fontFamily: 'monospace',
                fontSize: '13px',
                display: 'inline-block',
              }}
            >
              {issue.route_template}
            </span>
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: '#94A3B8',
                marginBottom: '4px',
              }}
            >
              Người báo cáo
            </span>
            <span
              style={{ fontSize: '14px', color: '#F8FAFC', fontWeight: 500 }}
            >
              {issue.reporter_name || 'Chủ sở hữu (Owner)'}
            </span>
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: '#94A3B8',
                marginBottom: '4px',
              }}
            >
              Thời điểm tạo
            </span>
            <span style={{ fontSize: '13px', color: '#F8FAFC' }}>
              {formatTimestamp(issue.created_at)}
            </span>
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: '#94A3B8',
                marginBottom: '4px',
              }}
            >
              Cập nhật gần nhất
            </span>
            <span style={{ fontSize: '13px', color: '#F8FAFC' }}>
              {formatTimestamp(issue.updated_at)}
            </span>
          </div>

          {issue.closed_at && (
            <div>
              <span
                style={{
                  display: 'block',
                  fontSize: '12px',
                  color: '#10B981',
                  marginBottom: '4px',
                }}
              >
                Thời điểm đóng
              </span>
              <span style={{ fontSize: '13px', color: '#10B981' }}>
                {formatTimestamp(issue.closed_at)}
              </span>
            </div>
          )}
        </div>

        {/* Description Section */}
        <div>
          <span
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#94A3B8',
              marginBottom: '8px',
            }}
          >
            Mô tả chi tiết:
          </span>
          <div
            data-testid="issue-description"
            style={{
              backgroundColor: '#0B1220',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '16px',
              color: '#F8FAFC',
              fontSize: '14px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {issue.description}
          </div>
        </div>
      </AppCard>

      {/* Activity Timeline Card */}
      <AppCard style={{ marginBottom: '32px', padding: '24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
            borderBottom: '1px solid #334155',
            paddingBottom: '8px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#F8FAFC',
              margin: 0,
            }}
          >
            Lịch sử hoạt động (Activity Timeline)
          </h3>
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
            {activities.length} sự kiện được ghi nhận (Append-only)
          </span>
        </div>

        {activities.length === 0 ? (
          <EmptyState
            title="Chưa có lịch sử hoạt động"
            description="Chưa có sự kiện nào được ghi nhận cho vấn đề này."
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative',
              paddingLeft: '8px',
            }}
          >
            {activities.map((act) => {
              const actBadge = getActivityActionBadge(act.action);
              const meta = act.metadata_sanitized || {};

              return (
                <div
                  key={act.id}
                  data-testid={`activity-item-${act.id}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '14px 16px',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    backgroundColor: 'rgba(11, 18, 32, 0.6)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <StatusBadge
                        status={actBadge.status}
                        label={actBadge.label}
                      />
                      <span
                        style={{
                          fontSize: '13px',
                          color: '#F8FAFC',
                          fontWeight: 500,
                        }}
                      >
                        bởi {act.actor_name || 'Owner'}
                      </span>
                    </div>

                    <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                      {formatTimestamp(act.created_at)}
                    </span>
                  </div>

                  {/* Sanitized Activity Metadata Details */}
                  {Object.keys(meta).length > 0 && (
                    <div
                      style={{
                        marginTop: '6px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        backgroundColor: '#0B1220',
                        fontSize: '12px',
                        color: '#94A3B8',
                        lineHeight: 1.5,
                      }}
                    >
                      {Boolean(meta.previous_status && meta.to_status) && (
                        <div style={{ color: '#F8FAFC', marginBottom: '2px' }}>
                          Trạng thái:{' '}
                          <span style={{ color: '#94A3B8' }}>
                            {String(meta.previous_status)}
                          </span>{' '}
                          ➔{' '}
                          <span style={{ color: '#14B8A6', fontWeight: 600 }}>
                            {String(meta.to_status)}
                          </span>
                        </div>
                      )}

                      {Boolean(meta.reason) && (
                        <div style={{ color: '#F8FAFC', marginTop: '4px' }}>
                          <span style={{ color: '#F59E0B', fontWeight: 600 }}>
                            Lý do:{' '}
                          </span>
                          <span>{String(meta.reason)}</span>
                        </div>
                      )}

                      {Boolean(meta.comment) && (
                        <div style={{ color: '#F8FAFC', marginTop: '4px' }}>
                          <span style={{ color: '#10B981', fontWeight: 600 }}>
                            Ghi chú:{' '}
                          </span>
                          <span>{String(meta.comment)}</span>
                        </div>
                      )}

                      {Boolean(meta.fields_changed) && (
                        <div style={{ color: '#94A3B8', marginTop: '2px' }}>
                          Các trường thay đổi:{' '}
                          {Array.isArray(meta.fields_changed)
                            ? meta.fields_changed.join(', ')
                            : String(meta.fields_changed)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AppCard>

      {/* Modal: Xác nhận đã sửa (Confirm Fix) */}
      {showConfirmFixModal && (
        <div
          data-testid="confirm-fix-modal"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoading) {
              setShowConfirmFixModal(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#151F30',
              borderRadius: '12px',
              border: '1px solid #334155',
              width: '100%',
              maxWidth: '520px',
              boxShadow:
                '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid #334155',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10B981',
                  }}
                >
                  <CheckIcon size={18} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 600,
                    color: '#F8FAFC',
                  }}
                >
                  Xác nhận đã khắc phục sự cố
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !actionLoading && setShowConfirmFixModal(false)}
                disabled={actionLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Đóng hộp thoại"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div style={{ padding: '20px' }}>
              <p
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '14px',
                  color: '#F8FAFC',
                  lineHeight: 1.5,
                }}
              >
                Bạn đang thực hiện xác nhận đã khắc phục cho vấn đề:{' '}
                <strong style={{ color: '#14B8A6' }}>{issue.title}</strong> (ID:{' '}
                {issue.id}). Trạng thái sẽ được chuyển sang{' '}
                <strong style={{ color: '#10B981' }}>Đã đóng (closed)</strong>.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="confirm-fix-comment"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú xác nhận (Tùy chọn)
                </label>
                <textarea
                  id="confirm-fix-comment"
                  data-testid="input-confirm-fix-comment"
                  rows={3}
                  placeholder="Nhập ghi chú kiểm tra hoặc phản hồi (nếu có)..."
                  value={confirmComment}
                  onChange={(e) => setConfirmComment(e.target.value)}
                  disabled={actionLoading}
                  style={{
                    width: '100%',
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  marginTop: '20px',
                }}
              >
                <AppButton
                  variant="secondary"
                  onClick={() => setShowConfirmFixModal(false)}
                  disabled={actionLoading}
                  data-testid="btn-cancel-confirm-fix"
                  style={{ minHeight: '44px' }}
                >
                  Hủy
                </AppButton>
                <AppButton
                  variant="primary"
                  onClick={handleConfirmFix}
                  disabled={actionLoading}
                  data-testid="btn-submit-confirm-fix"
                  style={{
                    minHeight: '44px',
                    backgroundColor: '#10B981',
                    borderColor: '#10B981',
                    color: '#FFFFFF',
                  }}
                >
                  {actionLoading ? 'Đang xác nhận...' : 'Xác nhận đóng sự cố'}
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Mở lại vấn đề (Reopen Issue) */}
      {showReopenModal && (
        <div
          data-testid="reopen-issue-modal"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoading) {
              setShowReopenModal(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: '#151F30',
              borderRadius: '12px',
              border: '1px solid #334155',
              width: '100%',
              maxWidth: '520px',
              boxShadow:
                '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid #334155',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#F59E0B',
                  }}
                >
                  <RotateCcwIcon size={18} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 600,
                    color: '#F8FAFC',
                  }}
                >
                  Mở lại vấn đề
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !actionLoading && setShowReopenModal(false)}
                disabled={actionLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Đóng hộp thoại"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div style={{ padding: '20px' }}>
              <p
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '14px',
                  color: '#F8FAFC',
                  lineHeight: 1.5,
                }}
              >
                Vui lòng nhập lý do mở lại vấn đề để đội ngũ kỹ thuật tiếp tục
                khắc phục. Trạng thái sẽ được chuyển sang{' '}
                <strong style={{ color: '#F59E0B' }}>Mở (open)</strong>.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="reopen-reason"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#F8FAFC',
                    marginBottom: '6px',
                  }}
                >
                  Lý do mở lại <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <textarea
                  id="reopen-reason"
                  data-testid="input-reopen-reason"
                  rows={3}
                  placeholder="Ví dụ: Vẫn còn lỗi khi thao tác trên màn hình..."
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  disabled={actionLoading}
                  style={{
                    width: '100%',
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                  required
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="reopen-comment"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú bổ sung (Tùy chọn)
                </label>
                <input
                  id="reopen-comment"
                  data-testid="input-reopen-comment"
                  type="text"
                  placeholder="Ghi chú thêm..."
                  value={reopenComment}
                  onChange={(e) => setReopenComment(e.target.value)}
                  disabled={actionLoading}
                  style={{
                    width: '100%',
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  marginTop: '20px',
                }}
              >
                <AppButton
                  variant="secondary"
                  onClick={() => setShowReopenModal(false)}
                  disabled={actionLoading}
                  data-testid="btn-cancel-reopen"
                  style={{ minHeight: '44px' }}
                >
                  Hủy
                </AppButton>
                <AppButton
                  variant="primary"
                  onClick={handleReopen}
                  disabled={actionLoading || !reopenReason.trim()}
                  data-testid="btn-submit-reopen"
                  style={{
                    minHeight: '44px',
                    backgroundColor: '#F59E0B',
                    borderColor: '#F59E0B',
                    color: '#0B1220',
                    fontWeight: 600,
                  }}
                >
                  {actionLoading ? 'Đang mở lại...' : 'Mở lại vấn đề'}
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
