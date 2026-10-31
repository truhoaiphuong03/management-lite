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
  IssueDetailResponseData,
} from '../../../../packages/contracts/src/issues.js';
import type { UserRole } from '../types.js';
import { getModuleNameFromPath } from '../components/ReportBugWidget.js';
import {
  formatTimestamp,
  getStatusBadge,
  getSeverityBadge,
  getTestResultBadge,
  getTypeBadge,
  getActivityActionBadge,
} from './helpers/issues-helpers.js';

export interface IssueDetailScreenProps {
  issueId: string;
  role?: UserRole;
  csrfToken?: string;
  onNavigate: (path: string) => void;
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

  // Gemini AI Analysis state
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [analyzeSuccess, setAnalyzeSuccess] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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

  const handleAnalyzeWithGemini = async () => {
    if (!issue) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeSuccess(null);

    try {
      const res = await fetch(
        `/api/v1/issues/${encodeURIComponent(issue.id)}/analyze`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
          },
        },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(
          errBody?.error?.message || `Lỗi phân tích Gemini (${res.status})`,
        );
      }

      const json = await res.json();
      if (json.success && json.data) {
        setIssue(json.data.issue);
        setAnalyzeSuccess(
          'Phân tích sự cố bằng Gemini AI thành công! Đã cập nhật giả thuyết nguyên nhân và giải pháp đề xuất.',
        );
        setTimeout(() => setAnalyzeSuccess(null), 6000);
        void fetchDetail();
      }
    } catch (err: unknown) {
      setAnalyzeError(
        err instanceof Error
          ? err.message
          : 'Không thể thực hiện phân tích Gemini AI.',
      );
      setTimeout(() => setAnalyzeError(null), 8000);
    } finally {
      setAnalyzing(false);
    }
  };

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
      `# BÁO CÁO LỖI: ${issue.bug_code ? `[${issue.bug_code}] ` : ''}${issue.title}`,
      `- **Mã định danh (ID):** \`${issue.id}\``,
      ...(issue.bug_code ? [`- **Mã BUG:** \`${issue.bug_code}\``] : []),
      ...(issue.severity
        ? [`- **Mức độ (Severity):** \`${issue.severity}\``]
        : []),
      `- **Trạng thái thực tế:** \`${issue.status}\` (${statusMeta.label})`,
      ...(issue.test_result
        ? [`- **Kết quả kiểm thử:** \`${issue.test_result}\``]
        : []),
      `- **Phân loại:** ${issue.type === 'bug' ? 'Lỗi (Bug)' : 'Cải tiến'}`,
      `- **Phân hệ / Module:** ${moduleName}`,
      `- **Đường dẫn màn hình (Route):** \`${issue.route_template}\``,
      `- **Thời gian báo cáo:** ${formatTimestamp(issue.created_at)}`,
      `- **Thời gian cập nhật:** ${formatTimestamp(issue.updated_at)}`,
      `- **Phiên bản dữ liệu:** v${issue.version}`,
      `- **Người báo cáo:** ${issue.reporter_name || 'Owner'}`,
      ...(issue.github_issue_url
        ? [`- **GitHub Issue:** ${issue.github_issue_url}`]
        : []),
      ...(issue.deploy_sha
        ? [`- **Deploy SHA:** \`${issue.deploy_sha}\``]
        : []),
      `- **Liên kết chi tiết:** ${detailUrl}`,
      '',
      `## Nội dung chi tiết (Mô tả nguyên văn):`,
      issue.description && issue.description.trim()
        ? issue.description
        : '(Không có mô tả chi tiết)',
    ];

    if (issue.gemini_analysis) {
      lines.push('');
      lines.push('## Phân tích kỹ thuật từ Gemini AI:');
      if (issue.gemini_analysis.summary) {
        lines.push(`- **Tóm tắt sự cố:** ${issue.gemini_analysis.summary}`);
      }
      if (issue.gemini_analysis.root_cause) {
        lines.push(
          `- **Nguyên nhân gốc rễ:** ${issue.gemini_analysis.root_cause}`,
        );
      }
      if (issue.gemini_analysis.suggested_fix) {
        lines.push(
          `- **Đề xuất sửa đổi:** ${issue.gemini_analysis.suggested_fix}`,
        );
      }
      if (
        Array.isArray(issue.gemini_analysis.affected_files) &&
        issue.gemini_analysis.affected_files.length > 0
      ) {
        lines.push(
          `- **File ảnh hưởng:** ${issue.gemini_analysis.affected_files.join(', ')}`,
        );
      }
      if (
        Array.isArray(issue.gemini_analysis.suggested_tests) &&
        issue.gemini_analysis.suggested_tests.length > 0
      ) {
        lines.push(
          `- **Kiểm thử đề xuất:** ${issue.gemini_analysis.suggested_tests.join(', ')}`,
        );
      }
      lines.push(
        `- **Khả năng tự động kiểm thử:** ${issue.gemini_analysis.can_auto_verify ? 'Có thể tự động test' : 'Cần kiểm thử thủ công'}`,
      );
    }

    lines.push('');
    lines.push(`## Lịch sử xử lý & Ghi chú (Activities):`);

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
        <LoadingState message="Đang tải chi tiết vấn đề…" />
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
  const severityMeta = getSeverityBadge(issue.severity);
  const testResultMeta = getTestResultBadge(issue.test_result);

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
          {/* Gemini AI Bug Analysis Button */}
          {isOwner && (
            <AppButton
              variant="secondary"
              onClick={handleAnalyzeWithGemini}
              data-testid="btn-analyze-gemini"
              disabled={analyzing || actionLoading}
              style={{
                minHeight: '44px',
                minWidth: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--info-text)',
                borderColor: '#38BDF8',
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
              }}
            >
              <span>
                {analyzing
                  ? 'AI đang phân tích…'
                  : '🤖 Phân tích bằng Gemini AI'}
              </span>
            </AppButton>
          )}

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
                color: 'var(--warning-text)',
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
              color: copied ? 'var(--success-text)' : undefined,
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
        title={
          issue.bug_code ? `[${issue.bug_code}] ${issue.title}` : issue.title
        }
        subtitle={`ID: ${issue.id} • Phiên bản: v${issue.version}${issue.bug_code ? ` • Mã: ${issue.bug_code}` : ''}`}
        actions={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            {issue.bug_code && (
              <span
                data-testid="detail-badge-bug-code"
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(20, 184, 166, 0.15)',
                  color: 'var(--accent-text)',
                  border: '1px solid rgba(20, 184, 166, 0.4)',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  fontWeight: 700,
                }}
              >
                {issue.bug_code}
              </span>
            )}
            <StatusBadge status={typeMeta.status} label={typeMeta.label} />
            <StatusBadge status={statusMeta.status} label={statusMeta.label} />
            {severityMeta && (
              <span
                data-testid="detail-badge-severity"
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  backgroundColor: severityMeta.bg,
                  color: severityMeta.color,
                  border: `1px solid ${severityMeta.border}`,
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {severityMeta.label}
              </span>
            )}
            {testResultMeta && (
              <span
                data-testid="detail-badge-test-result"
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--surface-subtle)',
                  color: testResultMeta.color,
                  border: `1px solid ${testResultMeta.color}`,
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                {testResultMeta.label}
              </span>
            )}
            {typeof issue.reopen_count === 'number' &&
              issue.reopen_count > 0 && (
                <span
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: 'var(--danger-text)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  Mở lại {issue.reopen_count}x
                </span>
              )}
          </div>
        }
      />

      {/* Action Notification Banners */}
      {analyzeSuccess && (
        <div
          data-testid="analyze-success-banner"
          style={{
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid #38BDF8',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: 'var(--info-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircleIcon size={18} />
            <span>{analyzeSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setAnalyzeSuccess(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--info-text)',
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

      {analyzeError && (
        <div
          data-testid="analyze-error-banner"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #EF4444',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: 'var(--danger-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangleIcon size={18} />
            <span>{analyzeError}</span>
          </div>
          <button
            type="button"
            onClick={() => setAnalyzeError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--danger-text)',
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
            color: 'var(--success-text)',
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
              color: 'var(--success-text)',
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
            color: 'var(--danger-text)',
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
              color: 'var(--danger-text)',
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
            color: 'var(--danger-text)',
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
              color: 'var(--danger-text)',
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

      {/* 1. Gemini AI Analysis Card */}
      {issue.gemini_analysis && (
        <AppCard
          data-testid="gemini-analysis-card"
          style={{
            marginBottom: '24px',
            padding: '24px',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            background:
              'linear-gradient(180deg, rgba(56, 189, 248, 0.05) 0%, var(--surface-subtle) 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
              paddingBottom: '12px',
              marginBottom: '16px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>🤖</span>
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--info-text)',
                  margin: 0,
                }}
              >
                Phân tích kỹ thuật & Đề xuất sửa đổi từ Gemini AI
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {issue.gemini_analysis.model && (
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    fontFamily: 'monospace',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(51, 65, 85, 0.4)',
                  }}
                >
                  Model: {issue.gemini_analysis.model}
                </span>
              )}
              {issue.gemini_analysis.analyzed_at && (
                <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  {formatTimestamp(issue.gemini_analysis.analyzed_at)}
                </span>
              )}
            </div>
          </div>

          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            {/* Summary */}
            {issue.gemini_analysis.summary && (
              <div>
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '4px',
                  }}
                >
                  Tóm tắt sự cố:
                </span>
                <p
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    color: 'var(--text-color)',
                    lineHeight: 1.5,
                  }}
                >
                  {issue.gemini_analysis.summary}
                </p>
              </div>
            )}

            {/* Root Cause Hypothesis */}
            {issue.gemini_analysis.root_cause && (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--warning-text)',
                    marginBottom: '6px',
                  }}
                >
                  🔍 Giả thuyết nguyên nhân gốc rễ (Root Cause Hypothesis):
                </span>
                <p
                  style={{
                    margin: 0,
                    fontSize: '13px',
                    color: 'var(--text-color)',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {issue.gemini_analysis.root_cause}
                </p>
              </div>
            )}

            {/* Suggested Fix */}
            {issue.gemini_analysis.suggested_fix && (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--success-text)',
                    marginBottom: '6px',
                  }}
                >
                  💡 Hướng dẫn sửa đổi đề xuất cho Anty:
                </span>
                <p
                  style={{
                    margin: 0,
                    fontSize: '13px',
                    color: 'var(--text-color)',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {issue.gemini_analysis.suggested_fix}
                </p>
              </div>
            )}

            {/* Affected Files & Suggested Tests */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                gap: '16px',
              }}
            >
              {Array.isArray(issue.gemini_analysis.affected_files) &&
                issue.gemini_analysis.affected_files.length > 0 && (
                  <div>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      File mã nguồn nghi vấn bị ảnh hưởng:
                    </span>
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}
                    >
                      {issue.gemini_analysis.affected_files.map((file, idx) => (
                        <span
                          key={idx}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-subtle)',
                            border: '1px solid var(--border-color)',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            color: 'var(--info-text)',
                          }}
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {Array.isArray(issue.gemini_analysis.suggested_tests) &&
                issue.gemini_analysis.suggested_tests.length > 0 && (
                  <div>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      Ca kiểm thử hồi quy đề xuất:
                    </span>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '18px',
                        color: 'var(--text-secondary)',
                        fontSize: '13px',
                        lineHeight: 1.5,
                      }}
                    >
                      {issue.gemini_analysis.suggested_tests.map(
                        (test, idx) => (
                          <li key={idx}>{test}</li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
            </div>

            {/* Feasibility for Auto-Verification */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid rgba(56, 189, 248, 0.15)',
              }}
            >
              <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Khả năng tự động kiểm thử:
              </span>
              {issue.gemini_analysis.can_auto_verify ? (
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    color: 'var(--success-text)',
                    border: '1px solid #10B981',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  ✓ Có thể kiểm thử tự động (CI/CD Automated Verification)
                </span>
              ) : (
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: 'var(--warning-text)',
                    border: '1px solid #F59E0B',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  ⚠ Cần Owner nghiệm thu thủ công (Waiting for Owner)
                </span>
              )}
            </div>
          </div>
        </AppCard>
      )}

      {/* 2. CI/CD & Deployment Verification Panel */}
      {(issue.github_issue_url ||
        issue.deploy_sha ||
        issue.pr_number ||
        issue.test_result) && (
        <AppCard
          data-testid="cicd-verification-card"
          style={{ marginBottom: '24px', padding: '24px' }}
        >
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--text-color)',
              marginBottom: '16px',
              borderBottom: '1px solid var(--border-color)',
              paddingBottom: '8px',
            }}
          >
            Liên kết Triển khai & Xác minh (CI/CD Verification)
          </h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: '16px',
            }}
          >
            {issue.github_issue_url && (
              <div>
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '4px',
                  }}
                >
                  GitHub Issue liên kết:
                </span>
                <a
                  href={issue.github_issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--info-text)',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  #{issue.github_issue_number || 'Issue'} ↗
                </a>
              </div>
            )}

            {issue.pr_number && (
              <div>
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '4px',
                  }}
                >
                  Pull Request:
                </span>
                <span
                  style={{
                    color: 'var(--text-color)',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  PR #{issue.pr_number}
                </span>
              </div>
            )}

            {issue.deploy_sha && (
              <div>
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '4px',
                  }}
                >
                  Commit SHA đã deploy:
                </span>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    color: '#A5B4FC',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                  }}
                >
                  {issue.deploy_sha.slice(0, 10)}
                </span>
              </div>
            )}

            {issue.test_result && (
              <div>
                <span
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '4px',
                  }}
                >
                  Kết quả kiểm thử:
                </span>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    backgroundColor:
                      issue.test_result === 'passed'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : issue.test_result === 'failed'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                    color:
                      issue.test_result === 'passed'
                        ? 'var(--success-text)'
                        : issue.test_result === 'failed'
                          ? 'var(--danger-text)'
                          : 'var(--warning-text)',
                    border: `1px solid ${issue.test_result === 'passed' ? '#10B981' : issue.test_result === 'failed' ? '#EF4444' : '#F59E0B'}`,
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  {issue.test_result.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </AppCard>
      )}

      {/* Main Metadata Card */}
      <AppCard style={{ marginBottom: '24px', padding: '24px' }}>
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-color)',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '8px',
          }}
        >
          Thông tin chi tiết
        </h3>

        {/* Grid info */}
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
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--muted-color)',
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
                color: 'var(--text-color)',
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
                color: 'var(--muted-color)',
                marginBottom: '4px',
              }}
            >
              Người báo cáo
            </span>
            <span
              style={{ fontSize: '14px', color: 'var(--text-color)', fontWeight: 500 }}
            >
              {issue.reporter_name || 'Chủ sở hữu (Owner)'}
            </span>
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--muted-color)',
                marginBottom: '4px',
              }}
            >
              Thời điểm tạo
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-color)' }}>
              {formatTimestamp(issue.created_at)}
            </span>
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--muted-color)',
                marginBottom: '4px',
              }}
            >
              Cập nhật gần nhất
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-color)' }}>
              {formatTimestamp(issue.updated_at)}
            </span>
          </div>

          {issue.closed_at && (
            <div>
              <span
                style={{
                  display: 'block',
                  fontSize: '12px',
                  color: 'var(--success-text)',
                  marginBottom: '4px',
                }}
              >
                Thời điểm đóng
              </span>
              <span style={{ fontSize: '13px', color: 'var(--success-text)' }}>
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
              color: 'var(--muted-color)',
              marginBottom: '8px',
            }}
          >
            Mô tả chi tiết:
          </span>
          <div
            data-testid="issue-description"
            style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '16px',
              color: 'var(--text-color)',
              fontSize: '14px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {issue.description}
          </div>
        </div>

        {/* Client Environment Context */}
        {issue.metadata_context &&
          Object.keys(issue.metadata_context).length > 0 && (
            <div
              data-testid="metadata-context-box"
              style={{
                marginTop: '20px',
                padding: '14px 16px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '8px',
                }}
              >
                Môi trường client ghi nhận lúc báo lỗi:
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                  gap: '10px',
                  fontSize: '12px',
                }}
              >
                {Boolean(issue.metadata_context.url) && (
                  <div>
                    <span style={{ color: 'var(--muted-color)' }}>URL: </span>
                    <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                      {String(issue.metadata_context.url)}
                    </span>
                  </div>
                )}
                {Boolean(issue.metadata_context.release_sha) && (
                  <div>
                    <span style={{ color: 'var(--muted-color)' }}>Release SHA: </span>
                    <code style={{ color: '#A5B4FC', fontFamily: 'monospace' }}>
                      {String(issue.metadata_context.release_sha).slice(0, 12)}
                    </code>
                  </div>
                )}
                {Boolean(issue.metadata_context.error_id) && (
                  <div>
                    <span style={{ color: 'var(--muted-color)' }}>Error ID: </span>
                    <code style={{ color: 'var(--danger-text)', fontFamily: 'monospace' }}>
                      {String(issue.metadata_context.error_id)}
                    </code>
                  </div>
                )}
                {Boolean(issue.metadata_context.request_id) && (
                  <div>
                    <span style={{ color: 'var(--muted-color)' }}>Request ID: </span>
                    <code style={{ color: 'var(--muted-color)', fontFamily: 'monospace' }}>
                      {String(issue.metadata_context.request_id)}
                    </code>
                  </div>
                )}
                {Boolean(issue.metadata_context.user_agent) && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--muted-color)' }}>Trình duyệt: </span>
                    <span style={{ color: 'var(--muted-color)', wordBreak: 'break-all' }}>
                      {String(issue.metadata_context.user_agent)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Screenshot Viewer */}
        {issue.screenshot_url && (
          <div data-testid="screenshot-viewer" style={{ marginTop: '20px' }}>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--muted-color)',
                marginBottom: '8px',
              }}
            >
              Ảnh chụp màn hình sự cố:
            </span>
            <div
              style={{
                display: 'inline-block',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                maxHeight: '260px',
                backgroundColor: 'var(--surface-subtle)',
              }}
              onClick={() => setSelectedImage(issue.screenshot_url || null)}
            >
              <img
                src={issue.screenshot_url}
                alt="Ảnh chụp màn hình lỗi"
                style={{
                  maxHeight: '260px',
                  maxWidth: '100%',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--muted-color)',
                marginTop: '4px',
              }}
            >
              (Bấm vào ảnh để phóng to)
            </span>
          </div>
        )}
      </AppCard>

      {/* Activity Timeline Card */}
      <AppCard style={{ marginBottom: '32px', padding: '24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '8px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: 'var(--text-color)',
              margin: 0,
            }}
          >
            Lịch sử hoạt động (Activity Timeline)
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
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
                    border: '1px solid var(--border-color)',
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
                          color: 'var(--text-color)',
                          fontWeight: 500,
                        }}
                      >
                        bởi {act.actor_name || 'Owner'}
                      </span>
                    </div>

                    <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
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
                        backgroundColor: 'var(--bg-color)',
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        lineHeight: 1.5,
                      }}
                    >
                      {Boolean(meta.previous_status && meta.to_status) && (
                        <div style={{ color: 'var(--text-color)', marginBottom: '2px' }}>
                          Trạng thái:{' '}
                          <span style={{ color: 'var(--muted-color)' }}>
                            {String(meta.previous_status)}
                          </span>{' '}
                          ➔{' '}
                          <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>
                            {String(meta.to_status)}
                          </span>
                        </div>
                      )}

                      {Boolean(meta.reason) && (
                        <div style={{ color: 'var(--text-color)', marginTop: '4px' }}>
                          <span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>
                            Lý do:{' '}
                          </span>
                          <span>{String(meta.reason)}</span>
                        </div>
                      )}

                      {Boolean(meta.comment) && (
                        <div style={{ color: 'var(--text-color)', marginTop: '4px' }}>
                          <span style={{ color: 'var(--success-text)', fontWeight: 600 }}>
                            Ghi chú:{' '}
                          </span>
                          <span>{String(meta.comment)}</span>
                        </div>
                      )}

                      {Boolean(meta.fields_changed) && (
                        <div style={{ color: 'var(--muted-color)', marginTop: '2px' }}>
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
              backgroundColor: 'var(--surface-color)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
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
                borderBottom: '1px solid var(--border-color)',
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
                    color: 'var(--success-text)',
                  }}
                >
                  <CheckIcon size={18} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
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
                  color: 'var(--muted-color)',
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
                  color: 'var(--text-color)',
                  lineHeight: 1.5,
                }}
              >
                Bạn đang thực hiện xác nhận đã khắc phục cho vấn đề:{' '}
                <strong style={{ color: 'var(--accent-text)' }}>{issue.title}</strong> (ID:{' '}
                {issue.id}). Trạng thái sẽ được chuyển sang{' '}
                <strong style={{ color: 'var(--success-text)' }}>Đã đóng (closed)</strong>.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="confirm-fix-comment"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--muted-color)',
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
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--text-color)',
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
                  {actionLoading ? 'Đang xác nhận…' : 'Xác nhận đóng sự cố'}
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
              backgroundColor: 'var(--surface-color)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
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
                borderBottom: '1px solid var(--border-color)',
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
                    color: 'var(--warning-text)',
                  }}
                >
                  <RotateCcwIcon size={18} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
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
                  color: 'var(--muted-color)',
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
                  color: 'var(--text-color)',
                  lineHeight: 1.5,
                }}
              >
                Vui lòng nhập lý do mở lại vấn đề để đội ngũ kỹ thuật tiếp tục
                khắc phục. Trạng thái sẽ được chuyển sang{' '}
                <strong style={{ color: 'var(--warning-text)' }}>Mở (open)</strong>.
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="reopen-reason"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--text-color)',
                    marginBottom: '6px',
                  }}
                >
                  Lý do mở lại <span style={{ color: 'var(--danger-text)' }}>*</span>
                </label>
                <textarea
                  id="reopen-reason"
                  data-testid="input-reopen-reason"
                  rows={3}
                  placeholder="Ví dụ: Vẫn còn lỗi khi thao tác trên màn hình…"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  disabled={actionLoading}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--text-color)',
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
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú bổ sung (Tùy chọn)
                </label>
                <input
                  id="reopen-comment"
                  data-testid="input-reopen-comment"
                  type="text"
                  placeholder="Ghi chú thêm…"
                  value={reopenComment}
                  onChange={(e) => setReopenComment(e.target.value)}
                  disabled={actionLoading}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--text-color)',
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
                    color: 'var(--inverse-text, #0B1220)',
                    fontWeight: 600,
                  }}
                >
                  {actionLoading ? 'Đang mở lại…' : 'Mở lại vấn đề'}
                </AppButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {selectedImage && (
        <div
          data-testid="screenshot-modal"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setSelectedImage(null)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              data-testid="btn-close-screenshot-modal"
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '24px',
                cursor: 'pointer',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
            <img
              src={selectedImage}
              alt="Ảnh phóng to"
              style={{
                maxWidth: '90vw',
                maxHeight: '85vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
