import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  PageHeader,
  AppCard,
  AppButton,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  RotateCcwIcon,
  AlertTriangleIcon,
  CopyIcon,
  CheckIcon,
  ListFooter,
  ActionIconButton,
} from '../../../../packages/ui/src/components/index.js';
import type {
  IssueData,
  IssueActivityData,
  IssueGroupCounts,
  ListIssuesResponseData,
} from '../../../../packages/contracts/src/issues.js';
import { getModuleNameFromPath } from '../components/ReportBugWidget.js';
import {
  formatTimestamp,
  getStatusBadge,
  getSeverityBadge,
  getTestResultBadge,
  getTypeBadge,
} from './helpers/issues-helpers.js';

export interface IssuesScreenProps {
  onNavigate: (path: string) => void;
  workspaceName?: string | undefined;
  workspaceId?: string | undefined;
}

const STATUS_TABS = [
  { id: '', label: 'Tất cả', countKey: 'all' as const },
  { id: 'open', label: 'Mới', countKey: 'open' as const },
  { id: 'in_progress', label: 'Đang sửa', countKey: 'in_progress' as const },
  {
    id: 'awaiting_owner',
    label: 'Đã sửa',
    countKey: 'awaiting_owner' as const,
  },
  { id: 'closed', label: 'Đã đóng', countKey: 'closed' as const },
];

export const IssuesScreen: React.FC<IssuesScreenProps> = ({
  onNavigate,
  workspaceName,
  workspaceId,
}) => {
  const [currentWorkspaceName, setCurrentWorkspaceName] = useState<
    string | undefined
  >(workspaceName);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<
    string | undefined
  >(workspaceId);

  useEffect(() => {
    if (workspaceName !== undefined) setCurrentWorkspaceName(workspaceName);
    if (workspaceId !== undefined) setCurrentWorkspaceId(workspaceId);
  }, [workspaceName, workspaceId]);

  useEffect(() => {
    if (currentWorkspaceName || currentWorkspaceId) return;
    let active = true;
    fetch('/api/v1/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!active || !body?.success || !body?.data) return;
        const name = body.data.active_workspace?.name;
        const id = body.data.active_workspace?.id;
        if (typeof name === 'string' && name.trim())
          setCurrentWorkspaceName(name.trim());
        if (typeof id === 'string' && id.trim())
          setCurrentWorkspaceId(id.trim());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentWorkspaceName, currentWorkspaceId]);

  const [issues, setIssues] = useState<IssueData[]>([]);
  const [counts, setCounts] = useState<IssueGroupCounts | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<{
    title?: string;
    message: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Selection & Copy state (persisted across pages/filters)
  const [selectedIssuesMap, setSelectedIssuesMap] = useState<
    Map<string, IssueData>
  >(new Map());
  const [copying, setCopying] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState<boolean>(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const requestSeqRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchIssues = useCallback(
    async (cursor?: string, append = false) => {
      const currentSeq = ++requestSeqRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        // Abort previous in-flight fresh request
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        setLoading(true);
        // Clear previous filter results immediately so old data is not displayed
        setIssues([]);
        setNextCursor(null);
        setHasMore(false);
      }
      setError(null);

      const controller = new AbortController();
      if (!append) {
        abortControllerRef.current = controller;
      }

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('limit', '20');
        if (cursor) queryParams.set('cursor', cursor);
        if (statusFilter) queryParams.set('status', statusFilter);
        if (typeFilter) queryParams.set('type', typeFilter);

        const res = await fetch(`/api/v1/issues?${queryParams.toString()}`, {
          credentials: 'include',
          signal: controller.signal,
        });

        // Prevent stale responses if filters or retry changed in flight
        if (currentSeq !== requestSeqRef.current) return;

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
            message: 'Chỉ Chủ sở hữu (Owner) mới có quyền truy cập Sổ tay lỗi.',
          });
          return;
        }

        if (res.status === 400) {
          const body = await res.json().catch(() => null);
          setError({
            title: 'Tham số không hợp lệ (400)',
            message:
              body?.error?.message ||
              'Cursor phân trang hoặc tham số lọc không hợp lệ.',
          });
          return;
        }

        if (res.status === 429) {
          setError({
            title: 'Yêu cầu quá giới hạn (429)',
            message:
              'Hệ thống đang quá tải yêu cầu. Vui lòng đợi trong giây lát rồi thử lại.',
          });
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            body?.error?.message || `Lỗi tải danh sách vấn đề (${res.status})`,
          );
        }

        const json = (await res.json()) as {
          success: boolean;
          data: ListIssuesResponseData;
        };

        if (currentSeq !== requestSeqRef.current) return;

        if (json.success && json.data) {
          if (append) {
            setIssues((prev) => [
              ...prev,
              ...(Array.isArray(json.data.items) ? json.data.items : []),
            ]);
          } else {
            setIssues(Array.isArray(json.data.items) ? json.data.items : []);
          }
          if (json.data.counts) {
            setCounts(json.data.counts);
          }
          setNextCursor(json.data.next_cursor);
          setHasMore(json.data.has_more);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (currentSeq !== requestSeqRef.current) return;
        setError({
          title: 'Lỗi kết nối máy chủ',
          message:
            err instanceof Error
              ? err.message
              : 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.',
        });
      } finally {
        if (currentSeq === requestSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [statusFilter, typeFilter],
  );

  useEffect(() => {
    fetchIssues();
    const handleIssuesUpdated = () => {
      fetchIssues();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('issues-updated', handleIssuesUpdated);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('issues-updated', handleIssuesUpdated);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchIssues]);

  const handleLoadMore = () => {
    if (nextCursor && !loadingMore && !loading) {
      fetchIssues(nextCursor, true);
    }
  };

  const handleRefresh = () => {
    fetchIssues();
  };

  // Filtered issues by search query
  const filteredIssues: IssueData[] = useMemo(() => {
    if (!searchQuery.trim()) return issues;
    const q = searchQuery.toLowerCase().trim();
    return issues.filter(
      (issue: IssueData) =>
        issue.title.toLowerCase().includes(q) ||
        issue.description?.toLowerCase().includes(q) ||
        issue.route_template?.toLowerCase().includes(q) ||
        issue.reporter_name?.toLowerCase().includes(q),
    );
  }, [issues, searchQuery]);

  // Selection Handlers
  const isAllCurrentSelected =
    filteredIssues.length > 0 &&
    filteredIssues.every((i: IssueData) => selectedIssuesMap.has(i.id));

  const handleToggleSelectAll = () => {
    setSelectedIssuesMap((prev) => {
      const next = new Map(prev);
      if (isAllCurrentSelected) {
        // Deselect all items in current page/view
        filteredIssues.forEach((i: IssueData) => next.delete(i.id));
      } else {
        // Select all items in current page/view
        filteredIssues.forEach((i: IssueData) => next.set(i.id, i));
      }
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectedIssuesMap(new Map());
  };

  const toggleSelectIssue = (issue: IssueData) => {
    setSelectedIssuesMap((prev) => {
      const next = new Map(prev);
      if (next.has(issue.id)) {
        next.delete(issue.id);
      } else {
        next.set(issue.id, issue);
      }
      return next;
    });
  };

  // Format full markdown prompt for ChatGPT coordination
  const formatSelectedIssuesPrompt = (
    itemsWithActivities: Array<{
      issue: IssueData;
      activities: IssueActivityData[];
    }>,
  ): string => {
    const origin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'http://127.0.0.1:3017';
    const now = formatTimestamp(new Date().toISOString());

    const lines: string[] = [];
    lines.push(
      `# DANH SÁCH BÁO CÁO LỖI HỆ THỐNG MANAGEMENT LITE (${itemsWithActivities.length} vấn đề)`,
    );
    const resolvedLabel = currentWorkspaceName
      ? currentWorkspaceName
      : currentWorkspaceId
        ? `ID: ${currentWorkspaceId}`
        : null;
    if (resolvedLabel) {
      lines.push(`- Không gian làm việc (Workspace): ${resolvedLabel}`);
    }
    lines.push(`- Thời điểm xuất danh sách: ${now}`);
    lines.push(`- Nguồn trích xuất: Sổ tay Vấn đề & Lỗi (Issues)`);
    lines.push('');
    lines.push('---');
    lines.push('### CHỈ DẪN DÀNH CHO CHATGPT & ĐIỀU PHỐI ANTIGRAVITY:');
    lines.push(
      '1. **Phân loại và định hướng xử lý theo từng nhóm trạng thái:**',
    );
    lines.push(
      '   - **Mới (`open`):** Phân tích nguyên nhân gốc rễ, sửa triệt để bằng Minimal Diff trên branch `feat/ui-report-01-mvp`, không mở rộng phạm vi ngoài yêu cầu.',
    );
    lines.push(
      '   - **Đang sửa (`analyzing` / `fixing`):** Tiếp tục hoàn thiện phần sửa dở dang, rà soát regression và kiểm tra toàn diện.',
    );
    lines.push(
      '   - **Đã sửa (`awaiting_owner`):** Hướng dẫn Owner các bước kiểm thử lại (re-test) trên localhost. Nếu đạt, Owner bấm "Xác nhận đã sửa"; nếu chưa đạt, bấm "Mở lại vấn đề".',
    );
    lines.push(
      '   - **Đã đóng (`closed`):** Tham khảo làm căn cứ lịch sử xử lý, không tự ý sửa đổi trừ khi có yêu cầu mở lại.',
    );
    lines.push('2. **Quy tắc điều phối kỹ thuật bắt buộc với Antigravity:**');
    lines.push(
      '   - Tuyệt đối không tự động đóng lỗi (chỉ chuyển trạng thái sang `awaiting_owner` theo đúng quy trình để Owner nghiệm thu).',
    );
    lines.push('   - Không tạo migration mới, không thêm thư viện thứ ba.');
    lines.push('   - Không commit, push, merge hoặc deploy.');
    lines.push('   - Giữ nguyên 100% dữ liệu và mã nguồn baseline CP2.2.');
    lines.push('');
    lines.push('---');
    lines.push('## NỘI DUNG CHI TIẾT TỪNG VẤN ĐỀ:');
    lines.push('');

    itemsWithActivities.forEach(({ issue, activities }, index) => {
      const moduleName = getModuleNameFromPath(issue.route_template);
      const statusMeta = getStatusBadge(issue.status);
      const detailUrl = `${origin}/issues/${issue.id}`;

      lines.push(
        `### [Vấn đề #${index + 1}] ${issue.bug_code ? `[${issue.bug_code}] ` : ''}${issue.title}`,
      );
      lines.push(`- **Mã định danh (ID):** \`${issue.id}\``);
      if (issue.bug_code) {
        lines.push(`- **Mã BUG:** \`${issue.bug_code}\``);
      }
      if (issue.severity) {
        lines.push(`- **Mức độ (Severity):** \`${issue.severity}\``);
      }
      lines.push(
        `- **Trạng thái thực tế:** \`${issue.status}\` (${statusMeta.label})`,
      );
      if (issue.test_result) {
        lines.push(`- **Kết quả kiểm thử:** \`${issue.test_result}\``);
      }
      lines.push(
        `- **Phân loại:** ${issue.type === 'bug' ? 'Lỗi (Bug)' : 'Cải tiến (Improvement)'}`,
      );
      lines.push(`- **Phân hệ / Module:** ${moduleName}`);
      lines.push(
        `- **Đường dẫn màn hình (Route):** \`${issue.route_template}\``,
      );
      lines.push(
        `- **Thời gian báo cáo:** ${formatTimestamp(issue.created_at)}`,
      );
      lines.push(
        `- **Thời gian cập nhật:** ${formatTimestamp(issue.updated_at)}`,
      );
      lines.push(`- **Phiên bản dữ liệu:** v${issue.version}`);
      lines.push(`- **Người báo cáo:** ${issue.reporter_name || 'Owner'}`);
      if (issue.github_issue_url) {
        lines.push(`- **GitHub Issue:** ${issue.github_issue_url}`);
      }
      lines.push(`- **Liên kết chi tiết:** ${detailUrl}`);
      lines.push('');
      lines.push(`#### Mô tả nguyên văn:`);
      lines.push(
        issue.description && issue.description.trim()
          ? issue.description
          : '(Không có mô tả chi tiết)',
      );
      if (issue.gemini_analysis) {
        lines.push('');
        lines.push('#### Phân tích từ Gemini AI:');
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
            `- **Đề xuất giải pháp:** ${issue.gemini_analysis.suggested_fix}`,
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
      }
      lines.push('');
      lines.push(`#### Lịch sử xử lý & Ghi chú (Activities):`);
      if (!activities || activities.length === 0) {
        lines.push('- *Chưa có lịch sử hoạt động bổ sung.*');
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
      lines.push('');
    });

    lines.push(
      'ChatGPT: Phân tích từng lỗi theo ID, nội dung gốc và trạng thái. Xác định lỗi cần sửa mới, đang xử lý hoặc cần kiểm tra lại. Kiểm tra trùng lặp, chuẩn bị nhiệm vụ tối thiểu cho Anti và đánh giá kết quả kiểm thử. Không tự kết luận lỗi đã hoàn thành nếu chưa có bằng chứng.',
    );

    return lines.join('\n');
  };

  // Bulk Copy Action
  const handleCopySelectedIssues = async () => {
    if (selectedIssuesMap.size === 0 || copying) return;
    setCopying(true);
    setCopyError(null);

    try {
      const selectedList = Array.from(selectedIssuesMap.values());
      // Fetch full details (including activities) for each selected issue
      const detailPromises = selectedList.map(async (item) => {
        const res = await fetch(
          `/api/v1/issues/${encodeURIComponent(item.id)}`,
          {
            credentials: 'include',
          },
        );
        if (!res.ok) {
          throw new Error(
            `Không thể lấy chi tiết lỗi ID: ${item.id} (${res.status})`,
          );
        }
        const json = await res.json();
        if (!json.success || !json.data?.issue) {
          throw new Error(
            `Dữ liệu phản hồi không hợp lệ cho lỗi ID: ${item.id}`,
          );
        }
        return {
          issue: json.data.issue as IssueData,
          activities: (json.data.activities || []) as IssueActivityData[],
        };
      });

      const fullItems = await Promise.all(detailPromises);

      // Strict validation: must match exact count
      if (fullItems.length !== selectedList.length) {
        throw new Error(
          `Dữ liệu phản hồi (${fullItems.length}) không khớp số lượng lỗi đã chọn (${selectedList.length}).`,
        );
      }

      const promptText = formatSelectedIssuesPrompt(fullItems);

      // Copy to clipboard with fallback
      let copySuccess = false;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(promptText);
          copySuccess = true;
        } catch {
          // Fallback below
        }
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
        setTimeout(() => setCopied(false), 2500);
      } else {
        throw new Error(
          'Không thể sao chép vào bộ nhớ tạm (Clipboard). Vui lòng kiểm tra quyền truy cập của trình duyệt.',
        );
      }
    } catch (err: unknown) {
      setCopyError(
        err instanceof Error
          ? err.message
          : 'Có lỗi xảy ra khi sao chép danh sách vấn đề.',
      );
    } finally {
      setCopying(false);
    }
  };

  const handleBulkConfirm = async () => {
    setBulkConfirming(true);
    setBulkNotice(null);
    try {
      let csrf = '';
      const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (meRes.ok) {
        const meJson = (await meRes.json().catch(() => null)) as {
          data?: { csrf_token?: string };
        } | null;
        csrf = meJson?.data?.csrf_token ?? '';
      }
      const selectedIds = Array.from(selectedIssuesMap.keys());
      const res = await fetch('/api/v1/issues/bulk-confirm', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify({
          issue_ids: selectedIds.length > 0 ? selectedIds : undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { closed_count?: number };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.success) {
        throw new Error(
          json?.error?.message || 'Không thể xác nhận đóng hàng loạt.',
        );
      }
      setSelectedIssuesMap(new Map());
      setBulkNotice(
        `Đã xác nhận và đóng thành công ${json.data?.closed_count ?? 0} phiếu chờ duyệt.`,
      );
      void fetchIssues(undefined, false);
    } catch (err) {
      setCopyError(
        err instanceof Error ? err.message : 'Lỗi xác nhận đóng hàng loạt.',
      );
    } finally {
      setBulkConfirming(false);
    }
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <PageHeader
        title="Sổ tay Vấn đề & Lỗi (Issues)"
        subtitle="Danh sách ghi nhận lỗi và đề xuất cải tiến hệ thống (Owner-only, Read-only)"
        actions={
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {(counts?.awaiting_owner ?? 0) > 0 && (
              <AppButton
                variant="primary"
                onClick={() => void handleBulkConfirm()}
                disabled={bulkConfirming || loading}
                data-testid="btn-bulk-confirm-issues"
                style={{
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckIcon size={16} />
                <span>
                  {bulkConfirming
                    ? 'Đang đóng…'
                    : `Duyệt & Đóng tất cả (${counts?.awaiting_owner ?? 0})`}
                </span>
              </AppButton>
            )}
            <AppButton
              variant="secondary"
              onClick={handleRefresh}
              disabled={loading}
              aria-label="Làm mới danh sách lỗi"
              title="Làm mới danh sách lỗi"
              data-testid="btn-refresh-issues"
              style={{
                minHeight: '44px',
                minWidth: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <RotateCcwIcon size={16} />
              <span className="mobile-hide-label">Làm mới</span>
            </AppButton>
          </div>
        }
      />

      {bulkNotice && (
        <AppCard
          style={{
            marginBottom: '12px',
            padding: '12px 16px',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
          }}
        >
          <div
            role="status"
            style={{
              color: 'var(--success-text, #10b981)',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            ✓ {bulkNotice}
          </div>
        </AppCard>
      )}
      {/* 4 Group Quick Filter Chips (harmonized with /work focus chips) */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
          marginBottom: '12px',
          alignItems: 'center',
          scrollbarWidth: 'none',
        }}
      >
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.id;
          const count = counts ? counts[tab.countKey] : undefined;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`tab-status-${tab.id || 'all'}`}
              onClick={() => setStatusFilter(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                border: isActive
                  ? '1px solid #14B8A6'
                  : '1px solid var(--border-subtle)',
                backgroundColor: isActive
                  ? 'var(--primary-subtle)'
                  : 'var(--surface-subtle)',
                color: isActive ? 'var(--accent-text)' : 'var(--muted-color)',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                minHeight: '34px',
                transition:
                  'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
              }}
            >
              <span>{tab.label}</span>
              {count !== undefined && (
                <span
                  style={{
                    padding: '1px 7px',
                    borderRadius: '999px',
                    backgroundColor: isActive
                      ? 'rgba(20, 184, 166, 0.18)'
                      : 'var(--surface-hover)',
                    color: isActive
                      ? 'var(--accent-text)'
                      : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar */}
      <AppCard style={{ marginBottom: '16px', padding: '16px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              alignItems: 'center',
              width: '100%',
              maxWidth: '680px',
            }}
          >
            {/* Status Filter */}
            <div style={{ flex: '1 1 200px', minWidth: '160px' }}>
              <label
                htmlFor="filter-status"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '4px',
                }}
              >
                Trạng thái:
              </label>
              <select
                id="filter-status"
                data-testid="select-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="open">Mới (Open)</option>
                <option value="analyzing">AI đang phân tích (Analyzing)</option>
                <option value="fixing">Đang sửa (Fixing)</option>
                <option value="testing">Đang kiểm thử (Testing)</option>
                <option value="deploying">Đang deploy (Deploying)</option>
                <option value="verifying">Đang xác minh (Verifying)</option>
                <option value="fixed">Đã sửa (Fixed)</option>
                <option value="reopened">Mở lại (Reopened)</option>
                <option value="waiting_for_owner">
                  Chờ Owner duyệt (Waiting for Owner)
                </option>
                <option value="closed">Đã đóng (Closed)</option>
              </select>
            </div>

            {/* Type Filter */}
            <div style={{ flex: '1 1 200px', minWidth: '160px' }}>
              <label
                htmlFor="filter-type"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '4px',
                }}
              >
                Loại vấn đề:
              </label>
              <select
                id="filter-type"
                data-testid="select-type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Tất cả loại</option>
                <option value="bug">Lỗi (Bug)</option>
                <option value="improvement">Cải tiến (Improvement)</option>
              </select>
            </div>
            {/* Keyword Search */}
            <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
              <label
                htmlFor="filter-search"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '4px',
                }}
              >
                Tìm kiếm từ khóa:
              </label>
              <input
                id="filter-search"
                type="text"
                data-testid="issue-search-input"
                placeholder="Tìm theo tiêu đề, mô tả, module…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {(statusFilter || typeFilter || searchQuery) && (
            <AppButton
              variant="secondary"
              onClick={() => {
                setStatusFilter('');
                setTypeFilter('');
                setSearchQuery('');
              }}
              style={{ minHeight: '44px', fontSize: '13px' }}
            >
              Xóa bộ lọc
            </AppButton>
          )}
        </div>
      </AppCard>

      {/* Selection & Bulk Copy Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 16px',
          backgroundColor:
            selectedIssuesMap.size > 0
              ? 'rgba(20, 184, 166, 0.08)'
              : 'var(--surface-subtle)',
          border:
            selectedIssuesMap.size > 0
              ? '1px solid rgba(20, 184, 166, 0.3)'
              : '1px solid var(--border-subtle)',
          borderRadius: '8px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              cursor: issues.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              color: 'var(--text-color)',
              fontWeight: 500,
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              data-testid="checkbox-select-all"
              checked={isAllCurrentSelected}
              onChange={handleToggleSelectAll}
              disabled={filteredIssues.length === 0}
              style={{
                width: '18px',
                height: '18px',
                cursor: filteredIssues.length === 0 ? 'not-allowed' : 'pointer',
                accentColor: '#14B8A6',
              }}
            />
            <span>Chọn tất cả ({filteredIssues.length} mục trang này)</span>
          </label>

          {selectedIssuesMap.size > 0 && (
            <>
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--accent-text)',
                  fontWeight: 600,
                }}
              >
                • Đã chọn: {selectedIssuesMap.size} lỗi
              </span>
              <button
                type="button"
                data-testid="btn-deselect-all"
                onClick={handleDeselectAll}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '4px 6px',
                }}
              >
                Bỏ chọn
              </button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AppButton
            variant="primary"
            onClick={handleCopySelectedIssues}
            disabled={selectedIssuesMap.size === 0 || copying}
            data-testid="btn-copy-selected-issues"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              ...(copied
                ? { backgroundColor: '#10B981', borderColor: '#10B981' }
                : {}),
            }}
          >
            {copied ? (
              <>
                <CheckIcon size={16} />
                <span>Đã sao chép!</span>
              </>
            ) : (
              <>
                <CopyIcon size={16} />
                <span>
                  {copying
                    ? 'Đang lấy dữ liệu…'
                    : `Sao chép ${selectedIssuesMap.size > 0 ? `(${selectedIssuesMap.size})` : ''} lỗi đã chọn`}
                </span>
              </>
            )}
          </AppButton>
        </div>
      </div>

      {/* Copy Error Notice */}
      {copyError && (
        <div
          data-testid="copy-error-alert"
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--danger-text)',
            fontSize: '13px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{copyError}</span>
          <button
            type="button"
            onClick={() => setCopyError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--danger-text)',
              cursor: 'pointer',
              fontWeight: 600,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <LoadingState message="Đang tải danh sách vấn đề…" />
      ) : error ? (
        <ErrorState
          title={error.title || 'Có lỗi xảy ra'}
          message={error.message}
          onRetry={handleRefresh}
        />
      ) : issues.length === 0 ? (
        <EmptyState
          icon={<AlertTriangleIcon size={40} />}
          title="Không có vấn đề nào"
          description={
            statusFilter || typeFilter
              ? 'Không tìm thấy vấn đề phù hợp với bộ lọc hiện tại.'
              : 'Hiện chưa có vấn đề hay cải tiến nào được ghi nhận trong workspace này.'
          }
        />
      ) : filteredIssues.length === 0 ? (
        <div data-testid="issues-empty-search">
          <EmptyState
            icon={<AlertTriangleIcon size={40} />}
            title="Không tìm thấy vấn đề phù hợp"
            description={`Không có vấn đề nào khớp với từ khóa "${searchQuery}".`}
            action={
              <AppButton variant="secondary" onClick={() => setSearchQuery('')}>
                Xóa tìm kiếm
              </AppButton>
            }
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredIssues.map((issue) => {
            const statusMeta = getStatusBadge(issue.status);
            const typeMeta = getTypeBadge(issue.type);
            const severityMeta = getSeverityBadge(issue.severity);
            const testResultMeta = getTestResultBadge(issue.test_result);
            const isSelected = selectedIssuesMap.has(issue.id);

            return (
              <AppCard
                key={issue.id}
                data-testid={`issue-item-${issue.id}`}
                onClick={() => onNavigate(`/issues/${issue.id}`)}
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  transition:
                    'border-color 0.15s ease, background-color 0.15s ease',
                  border: isSelected
                    ? '1px solid #14B8A6'
                    : '1px solid var(--border-color)',
                  backgroundColor: isSelected
                    ? 'rgba(20, 184, 166, 0.04)'
                    : undefined,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* Checkbox */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'inline-flex', alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        id={`checkbox-issue-${issue.id}`}
                        data-testid={`checkbox-issue-${issue.id}`}
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectIssue(issue);
                        }}
                        style={{
                          width: '18px',
                          height: '18px',
                          cursor: 'pointer',
                          accentColor: '#14B8A6',
                        }}
                      />
                    </div>

                    {/* Bug Code Badge */}
                    {issue.bug_code && (
                      <span
                        data-testid={`badge-bug-code-${issue.id}`}
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(20, 184, 166, 0.15)',
                          color: 'var(--accent-text)',
                          border: '1px solid rgba(20, 184, 166, 0.4)',
                          fontFamily: 'var(--font-sans)',
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: '12px',
                          fontWeight: 700,
                        }}
                      >
                        {issue.bug_code}
                      </span>
                    )}

                    <StatusBadge
                      status={typeMeta.status}
                      label={typeMeta.label}
                    />
                    <StatusBadge
                      status={statusMeta.status}
                      label={statusMeta.label}
                    />

                    {/* Severity Badge */}
                    {severityMeta && (
                      <span
                        data-testid={`badge-severity-${issue.id}`}
                        style={{
                          padding: '2px 8px',
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

                    {/* Test Result Badge */}
                    {testResultMeta && (
                      <span
                        data-testid={`badge-test-result-${issue.id}`}
                        style={{
                          padding: '2px 8px',
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

                    {/* Reopen Count */}
                    {typeof issue.reopen_count === 'number' &&
                      issue.reopen_count > 0 && (
                        <span
                          style={{
                            padding: '2px 6px',
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

                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(51, 65, 85, 0.4)',
                        color: 'var(--muted-color)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                      }}
                    >
                      {issue.route_template}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                      }}
                    >
                      v{issue.version}
                    </span>
                  </div>

                  <span
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Cập nhật: {formatTimestamp(issue.updated_at)}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '16px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 300px' }}>
                    <h3
                      style={{
                        fontSize: '16px',
                        fontWeight: 600,
                        color: 'var(--text-color)',
                        marginBottom: '6px',
                        lineHeight: 1.4,
                      }}
                    >
                      {issue.bug_code ? `[${issue.bug_code}] ` : ''}
                      {issue.title}
                    </h3>
                    <p
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        lineHeight: 1.5,
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {issue.description}
                    </p>

                    {/* Gemini AI summary snippet */}
                    {issue.gemini_analysis?.summary && (
                      <div
                        data-testid={`gemini-summary-${issue.id}`}
                        style={{
                          marginTop: '8px',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(56, 189, 248, 0.08)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          fontSize: '12px',
                          color: 'var(--info-text)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span style={{ fontWeight: 700, flexShrink: 0 }}>
                          🤖 Gemini AI:
                        </span>
                        <span
                          style={{
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {issue.gemini_analysis.summary}
                        </span>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      alignSelf: 'center',
                    }}
                  >
                    <ActionIconButton
                      action="view"
                      target={`Vấn đề ${issue.bug_code || issue.id.slice(0, 8)}`}
                      onClick={() => onNavigate(`/issues/${issue.id}`)}
                      testId={`btn-view-issue-${issue.id}`}
                    />
                  </div>
                </div>
              </AppCard>
            );
          })}

          {/* Unified List Footer */}
          <ListFooter
            testId="issues-list-footer"
            itemCount={issues.length}
            hasNextPage={hasMore && Boolean(nextCursor)}
            onLoadMore={handleLoadMore}
            isLoadingMore={loadingMore}
            loadMoreLabel="Tải thêm vấn đề cũ hơn"
            loadMoreTestId="btn-load-more"
          />
        </div>
      )}
    </div>
  );
};
