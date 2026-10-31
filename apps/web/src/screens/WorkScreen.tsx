import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  PlusIcon,
  CalendarIcon,
  UserIcon,
  AlertTriangleIcon,
  InfoIcon,
  CheckCircleIcon,
  RotateCcwIcon,
} from '@management-lite/ui/components';
import {
  ActionIconButton,
  Pagination,
  clampPage,
  PAGINATION_PAGE_SIZES,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import type {
  WorkItemData,
  WorkItemStatus,
  WorkType,
  WorkPriority,
  WorkAssignmentStatus,
  WorkReviewDecision,
  WorkAssignmentData,
} from '../../../../packages/contracts/src/work.js';

export interface WorkScreenProps {
  role?: UserRole;
  workId?: string | undefined;
  isNew?: boolean;
  onNavigate?: (path: string) => void;
}

interface EmployeeOption {
  id: string;
  employee_code: string;
  full_name: string;
}

// Helpers
function formatDateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return 'Không có';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

function getPriorityLabel(p: WorkPriority): string {
  switch (p) {
    case 'urgent':
      return 'Khẩn cấp';
    case 'high':
      return 'Cao';
    case 'medium':
      return 'Bình thường';
    case 'low':
      return 'Thấp';
    default:
      return p;
  }
}

function getPriorityColor(p: WorkPriority): string {
  switch (p) {
    case 'urgent':
      return '#EF4444';
    case 'high':
      return '#F59E0B';
    case 'medium':
      return '#38BDF8';
    case 'low':
      return '#94A3B8';
    default:
      return '#94A3B8';
  }
}

function getWorkTypeLabel(t: WorkType): string {
  switch (t) {
    case 'general':
      return 'Việc chung';
    case 'content':
      return 'Nội dung';
    case 'video':
      return 'Dựng video';
    case 'design':
      return 'Thiết kế';
    case 'other':
      return 'Khác';
    default:
      return t;
  }
}

function getAssignmentStatusBadge(status: WorkAssignmentStatus) {
  switch (status) {
    case 'todo':
      return <StatusBadge status="neutral" label="Chưa làm" />;
    case 'in_progress':
      return <StatusBadge status="warning" label="Đang làm" />;
    case 'in_review':
      return <StatusBadge status="warning" label="Chờ duyệt" />;
    case 'completed':
      return <StatusBadge status="success" label="Hoàn thành" />;
    default:
      return <StatusBadge status="neutral" label={status} />;
  }
}

function getWorkItemStatusBadge(status: WorkItemStatus) {
  switch (status) {
    case 'todo':
      return <StatusBadge status="neutral" label="Cần làm" />;
    case 'in_progress':
      return <StatusBadge status="warning" label="Đang làm" />;
    case 'in_review':
      return <StatusBadge status="warning" label="Chờ duyệt" />;
    case 'completed':
      return <StatusBadge status="success" label="Hoàn thành" />;
    case 'cancelled':
      return <StatusBadge status="error" label="Đã hủy" />;
    default:
      return <StatusBadge status="neutral" label={status} />;
  }
}

export const WorkScreen: React.FC<WorkScreenProps> = ({
  role = 'owner',
  workId,
  isNew = false,
  onNavigate,
}) => {
  // Authentication & CSRF
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>('');

  // Data states
  const [workItems, setWorkItems] = useState<WorkItemData[]>([]);
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItemData | null>(
    null,
  );
  const [scheduleDate, setScheduleDate] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [apiUnavailable, setApiUnavailable] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters (List view)
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [smartFocusFilter, setSmartFocusFilter] = useState<
    'all' | 'today' | 'overdue' | 'blocked' | 'pending_review'
  >('all');

  // Form states (Create view /work/new)
  const [newTitle, setNewTitle] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newWorkType, setNewWorkType] = useState<WorkType>('general');
  const [newPriority, setNewPriority] = useState<WorkPriority>('medium');
  const [newDueAt, setNewDueAt] = useState<string>('');
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Submission Modal state (Staff nộp bài)
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [activeAssignmentId, setActiveAssignmentId] = useState<string>('');
  const [submissionNote, setSubmissionNote] = useState<string>('');
  const [attachmentName, setAttachmentName] = useState<string>('');
  const [attachmentUrl, setAttachmentUrl] = useState<string>('');

  // Review Modal state (Owner yêu cầu sửa / duyệt đạt)
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [reviewAssignmentId, setReviewAssignmentId] = useState<string>('');
  const [reviewSubmissionId, setReviewSubmissionId] = useState<string>('');
  const [reviewDecision, setReviewDecision] =
    useState<WorkReviewDecision>('approved');
  const [reviewFeedback, setReviewFeedback] = useState<string>('');

  // Cancel Modal state (Owner hủy công việc)
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');

  // Q65-05: Multi-page employee selector generation and abort management
  const employeesFetchIdRef = useRef<number>(0);
  const employeesAbortControllerRef = useRef<AbortController | null>(null);

  // Read-only Schedule integration state (Issue #1)
  const [scheduleEntries, setScheduleEntries] = useState<
    Array<{
      id: string;
      work_date: string;
      day_of_week: number;
      start_time: string;
      notes?: string | null;
    }>
  >([]);

  const fetchEmployees = async (externalSignal?: AbortSignal) => {
    if (role !== 'owner') return;
    if (employeesAbortControllerRef.current) {
      employeesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    employeesAbortControllerRef.current = controller;
    const requestId = ++employeesFetchIdRef.current;

    const isAborted = () =>
      controller.signal.aborted ||
      Boolean(externalSignal?.aborted) ||
      requestId !== employeesFetchIdRef.current;

    try {
      const allEmps: EmployeeOption[] = [];
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let page = 0;
      const maxPages = 20;

      const active = !isAborted();
      while (page < maxPages && active) {
        if (isAborted()) return;
        page++;
        const url: string = cursor
          ? `/api/v1/employees?limit=50&cursor=${encodeURIComponent(cursor)}`
          : '/api/v1/employees?limit=50';
        const empRes = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (isAborted()) return;
        if (!empRes.ok) break;
        const empBody = await empRes.json();
        if (isAborted()) return;
        const items = empBody.data?.items || [];
        for (const e of items) {
          if (!seenIds.has(e.id)) {
            seenIds.add(e.id);
            allEmps.push({
              id: e.id,
              employee_code: e.employee_code,
              full_name: e.full_name,
            });
          }
        }
        cursor = empBody.data?.next_cursor || null;
        if (cursor) {
          if (seenCursors.has(cursor)) break;
          seenCursors.add(cursor);
        }
        if (!cursor || items.length === 0) break;
      }

      if (isAborted()) return;
      setEmployees(allEmps);
    } catch {
      // Silently handled
    }
  };

  // 1. Initial Load: Fetch CSRF token, user info & employees
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const initAuth = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.ok) {
          const body = await res.json();
          if (active && body.data) {
            if (body.data.csrf_token) setCsrfToken(body.data.csrf_token);
            if (body.data.employee?.id)
              setCurrentEmployeeId(body.data.employee.id);
          }
        }
      } catch {
        // Silently handled
      }

      // Employee identity belongs to the self HR endpoint, not the auth DTO.
      if (role === 'staff') {
        try {
          const profile = await fetch('/api/v1/employees/me', {
            credentials: 'include',
            signal: controller.signal,
          });
          if (profile.ok) {
            const body = await profile.json();
            if (active && body.data?.id) setCurrentEmployeeId(body.data.id);
          }
        } catch {
          // Keep assignment actions hidden when employee identity is unavailable.
        }
      }

      // Fetch employees for Owner assignment dropdown
      if (role === 'owner') {
        await fetchEmployees(controller.signal);
      }

      // Fetch user's current week schedule (read-only integration - Issue #1)
      try {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(today);
        monday.setDate(diff);
        const yyyy = monday.getFullYear();
        const mm = String(monday.getMonth() + 1).padStart(2, '0');
        const dd = String(monday.getDate()).padStart(2, '0');
        const mondayIso = `${yyyy}-${mm}-${dd}`;

        const schedRes = await fetch(
          `/api/v1/schedules/me?week_start_date=${mondayIso}`,
          { credentials: 'include' },
        );
        if (schedRes.ok) {
          const schedBody = await schedRes.json();
          if (active && schedBody.success && schedBody.data?.entries) {
            setScheduleEntries(schedBody.data.entries);
          }
        }
      } catch {
        // Silently handled: read-only schedule integration
      }
    };

    initAuth();
    return () => {
      active = false;
      controller.abort();
      employeesAbortControllerRef.current?.abort();
    };
  }, [role]);

  // 2. Fetch Work Items or Detail Item
  useEffect(() => {
    fetchData();
  }, [workId, isNew, role]);

  const fetchData = async () => {
    setLoading(true);
    setErrorMessage(null);
    setApiUnavailable(false);

    try {
      if (workId) {
        // Fetch detail
        const res = await fetch(`/api/v1/work-items/${workId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data) {
            setSelectedWorkItem(body.data);
          } else {
            setErrorMessage(body.error?.message || 'Không thể tải chi tiết');
          }
        } else if (res.status === 404 || res.status === 503) {
          setApiUnavailable(true);
        } else {
          setErrorMessage(`Lỗi máy chủ (${res.status})`);
        }
      } else if (!isNew) {
        // Fetch list
        const query = new URLSearchParams(window.location.search);
        const scheduleFilter = new URLSearchParams();
        for (const key of ['schedule_id', 'work_date']) {
          const value = query.get(key);
          if (value) scheduleFilter.set(key, value);
        }
        const res = await fetch(`/api/v1/work-items?${scheduleFilter}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data?.items) {
            setWorkItems(body.data.items);
          }
        } else if (res.status === 404 || res.status === 503) {
          setApiUnavailable(true);
        } else {
          setErrorMessage(`Lỗi kết nối danh sách công việc (${res.status})`);
        }
      }
    } catch {
      setApiUnavailable(true);
    } finally {
      setLoading(false);
    }
  };

  // Helpers for ML-04 (Hôm nay / Quá hạn / Bị chặn / Chờ duyệt & Bằng chứng)
  const todayVnDateStr = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fallback
    }
    return new Date().toISOString().slice(0, 10);
  }, []);

  const isItemToday = (item: WorkItemData): boolean => {
    if (item.status === 'cancelled') return false;
    if (item.due_at) {
      try {
        const dueDateVn = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(item.due_at));
        if (dueDateVn === todayVnDateStr) return true;
      } catch {
        if (item.due_at.slice(0, 10) === todayVnDateStr) return true;
      }
    }
    return Boolean(
      item.assignments?.some((a) =>
        a.schedule_links?.some((l) => l.work_date === todayVnDateStr),
      ),
    );
  };

  const isItemOverdue = (item: WorkItemData): boolean => {
    if (item.status === 'completed' || item.status === 'cancelled')
      return false;
    if (!item.due_at) return false;
    const dueMs = Date.parse(item.due_at);
    return Number.isFinite(dueMs) && dueMs < Date.now();
  };

  const isItemBlocked = (item: WorkItemData): boolean => {
    if (item.status === 'completed' || item.status === 'cancelled')
      return false;
    const hasChangesRequested = Boolean(
      item.assignments?.some(
        (a) => a.latest_review?.decision === 'request_changes',
      ),
    );
    const isUrgentUnassigned =
      item.priority === 'urgent' &&
      (!item.assignments || item.assignments.length === 0);
    const hasBlockedTag = Boolean(
      item.description && /\[(BLOCKED|HOLD|BỊ CHẶN)\]/i.test(item.description),
    );
    return hasChangesRequested || isUrgentUnassigned || hasBlockedTag;
  };

  // 3. Filtered Work Items
  const filteredItems = useMemo(() => {
    return workItems.filter((item) => {
      // Smart Focus filter (ML-04)
      if (smartFocusFilter === 'today' && !isItemToday(item)) return false;
      if (smartFocusFilter === 'overdue' && !isItemOverdue(item)) return false;
      if (smartFocusFilter === 'blocked' && !isItemBlocked(item)) return false;
      if (
        smartFocusFilter === 'pending_review' &&
        item.status !== 'in_review'
      )
        return false;
      // Status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      // Priority filter
      if (priorityFilter !== 'all' && item.priority !== priorityFilter)
        return false;
      // Assignee filter (Owner only)
      if (assigneeFilter !== 'all') {
        const hasAssignee = item.assignments?.some(
          (a) => a.employee_id === assigneeFilter,
        );
        if (!hasAssignee) return false;
      }
      // Staff filter: only show work assigned to current user
      if (role === 'staff' && currentEmployeeId) {
        const isMyWork = item.assignments?.some(
          (a) => a.employee_id === currentEmployeeId,
        );
        if (!isMyWork) return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc) return false;
      }
      return true;
    });
  }, [
    workItems,
    smartFocusFilter,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    searchQuery,
    role,
    currentEmployeeId,
    todayVnDateStr,
  ]);

  // Client-side pagination over the already-loaded list (no API change).
  const [listPage, setListPage] = useState(0);
  const [listPageSize, setListPageSize] = useState(20);
  const safeListPage = clampPage(listPage, filteredItems.length, listPageSize);
  const pagedItems = useMemo(
    () =>
      filteredItems.slice(
        safeListPage * listPageSize,
        (safeListPage + 1) * listPageSize,
      ),
    [filteredItems, safeListPage, listPageSize],
  );

  // KPI stats (including ML-04 Today / Overdue / Blocked / Pending Review)
  const kpiStats = useMemo(() => {
    let todo = 0;
    let inProgress = 0;
    let inReview = 0;
    let completed = 0;
    let todayCount = 0;
    let overdueCount = 0;
    let blockedCount = 0;
    const targetItems =
      role === 'staff' && currentEmployeeId
        ? workItems.filter((i) =>
            i.assignments?.some((a) => a.employee_id === currentEmployeeId),
          )
        : workItems;

    for (const item of targetItems) {
      if (item.status === 'todo') todo++;
      else if (item.status === 'in_progress') inProgress++;
      else if (item.status === 'in_review') inReview++;
      else if (item.status === 'completed') completed++;

      if (isItemToday(item)) todayCount++;
      if (isItemOverdue(item)) overdueCount++;
      if (isItemBlocked(item)) blockedCount++;
    }
    return {
      todo,
      inProgress,
      inReview,
      completed,
      todayCount,
      overdueCount,
      blockedCount,
      total: targetItems.length,
    };
  }, [workItems, role, currentEmployeeId, todayVnDateStr]);

  // Handle Create Work Item (Owner)
  const handleScheduleLink = async (
    assignment: WorkAssignmentData,
    date: string,
    remove = false,
  ) => {
    if (!workId || !selectedWorkItem || !date) {
      setErrorMessage('Chọn ngày làm việc trước.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      let scheduleId: string | null = null;
      if (!remove) {
        const monday = new Date(`${date}T00:00:00Z`);
        monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() || 7) + 1);
        const schedules = await fetch(
          `/api/v1/schedules?week_start_date=${monday.toISOString().slice(0, 10)}`,
          { credentials: 'include' },
        );
        const data = await schedules.json();
        if (!schedules.ok)
          throw new Error(data.error?.message || 'Không tải được lịch');
        const match = data.data?.items?.find(
          (s: {
            id: string;
            employee_id: string;
            entries?: Array<{ work_date: string }>;
          }) =>
            s.employee_id === assignment.employee_id &&
            s.entries?.some((e) => e.work_date === date),
        );
        if (!match)
          throw new Error(
            'Nhân viên chưa đăng ký ca trong ngày này. Hãy đăng ký lịch trước khi xếp việc.',
          );
        scheduleId = match.id;
      }
      const response = await fetch(
        `/api/v1/work-items/${workId}/schedule-links`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            'If-Match': `"${selectedWorkItem.version}"`,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            assignment_id: assignment.id,
            schedule_id: scheduleId,
            work_date: date,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || 'Không lưu được liên kết lịch');
      setSelectedWorkItem(data.data);
      setSuccessMessage(
        remove
          ? 'Đã gỡ công việc khỏi ngày làm việc.'
          : 'Đã xếp công việc vào ca đã đăng ký.',
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Không thể liên kết lịch',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWorkItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setErrorMessage('Vui lòng nhập tiêu đề công việc.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const bodyData = {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        work_type: newWorkType,
        priority: newPriority,
        due_at: newDueAt ? new Date(newDueAt).toISOString() : null,
        assignee_ids:
          selectedAssigneeIds.length > 0 ? selectedAssigneeIds : undefined,
      };

      const res = await fetch('/api/v1/work-items', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(bodyData),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể tạo công việc');
      }

      setSuccessMessage('Tạo và giao công việc thành công!');
      // Reset form
      setNewTitle('');
      setNewDescription('');
      setSelectedAssigneeIds([]);
      setNewDueAt('');

      // Navigate back to list after 1s
      setTimeout(() => {
        onNavigate?.('/work');
      }, 1000);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi gửi yêu cầu lên máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Staff Start Working (todo -> in_progress)
  const handleStartWork = async (assignmentId: string) => {
    if (!workId) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      if (selectedWorkItem?.version)
        headers['If-Match'] = `"${selectedWorkItem.version}"`;

      const res = await fetch(
        `/api/v1/work-items/${workId}/assignments/${assignmentId}/start`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ note: 'Bắt đầu làm việc' }),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể cập nhật trạng thái làm việc',
        );
      }

      setSuccessMessage('Đã bắt đầu thực hiện công việc!');
      fetchData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Staff Submit Work (in_progress -> in_review)
  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workId || !activeAssignmentId || !submissionNote.trim()) {
      setErrorMessage('Vui lòng nhập ghi chú báo cáo kết quả.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      if (selectedWorkItem?.version)
        headers['If-Match'] = `"${selectedWorkItem.version}"`;

      const attachments =
        attachmentName.trim() && attachmentUrl.trim()
          ? [{ name: attachmentName.trim(), url: attachmentUrl.trim() }]
          : [];

      const res = await fetch(
        `/api/v1/work-items/${workId}/assignments/${activeAssignmentId}/submissions`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            submission_note: submissionNote.trim(),
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể nộp báo cáo kết quả');
      }

      setSuccessMessage('Nộp báo cáo thành công, đang chờ Chủ shop duyệt!');
      setShowSubmitModal(false);
      setSubmissionNote('');
      setAttachmentName('');
      setAttachmentUrl('');
      fetchData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Owner Review (approved -> completed, request_changes -> in_progress)
  const handleReviewWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workId || !reviewAssignmentId || !reviewSubmissionId) {
      setErrorMessage(
        'Không thể nghiệm thu khi chưa có bản nộp kết quả (submission) hợp lệ.',
      );
      return;
    }

    if (reviewDecision === 'request_changes' && !reviewFeedback.trim()) {
      setErrorMessage('Vui lòng nhập lý do/phản hồi yêu cầu làm lại.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      if (selectedWorkItem?.version)
        headers['If-Match'] = `"${selectedWorkItem.version}"`;

      const url = `/api/v1/work-items/${workId}/assignments/${reviewAssignmentId}/submissions/${reviewSubmissionId}/reviews`;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          submission_id: reviewSubmissionId,
          decision: reviewDecision,
          feedback: reviewFeedback.trim() || undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể gửi kết quả nghiệm thu',
        );
      }

      setSuccessMessage(
        reviewDecision === 'approved'
          ? 'Đã duyệt đạt công việc!'
          : 'Đã gửi yêu cầu làm lại kèm phản hồi.',
      );
      setShowReviewModal(false);
      setReviewSubmissionId('');
      setReviewFeedback('');
      fetchData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Owner Cancel Work Item (Owner-only, preserves audit history)
  const handleCancelWorkItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workId) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      if (selectedWorkItem?.version)
        headers['If-Match'] = `"${selectedWorkItem.version}"`;

      const res = await fetch(`/api/v1/work-items/${workId}/cancel`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          reason: cancelReason.trim() || undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể hủy bỏ công việc');
      }

      setSuccessMessage(
        'Đã hủy công việc! Toàn bộ lịch sử phân công và báo cáo được bảo toàn.',
      );
      setShowCancelModal(false);
      setCancelReason('');
      fetchData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================
  // RENDER VIEW 1: CREATE VIEW (/work/new)
  // ==========================================
  if (isNew) {
    if (role === 'staff') {
      return (
        <div style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
          <AppCard>
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <AlertTriangleIcon size={40} color="#F59E0B" />
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  marginTop: '12px',
                  color: 'var(--text-color)',
                }}
              >
                Không có quyền truy cập
              </h3>
              <p
                style={{
                  fontSize: '14px',
                  color: 'var(--muted-color)',
                  marginTop: '8px',
                  marginBottom: '20px',
                }}
              >
                Chỉ Chủ sở hữu (Owner) mới có quyền tạo và giao việc mới.
              </p>
              <AppButton onClick={() => onNavigate?.('/work')}>
                Quay lại danh sách công việc
              </AppButton>
            </div>
          </AppCard>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '16px' }}>
        <PageHeader
          title="Giao việc mới"
          subtitle="Tạo công việc và phân công nhân sự thực hiện (WORK-01)"
        />

        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: 'var(--danger-text)',
              fontSize: '14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangleIcon size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              color: 'var(--success-text)',
              fontSize: '14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircleIcon size={18} />
            <span>{successMessage}</span>
          </div>
        )}

        <AppCard style={{ padding: '24px' }}>
          <form onSubmit={handleCreateWorkItem}>
            {/* Title */}
            <div style={{ marginBottom: '18px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-color)',
                }}
              >
                Tiêu đề công việc <span style={{ color: 'var(--danger-text)' }}>*</span>
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="VD: Kiểm kê kho cuối tuần, Dựng video món mới..."
                maxLength={200}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Description + ML-03 Task Packet Presets */}
            <div style={{ marginBottom: '18px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '6px',
                }}
              >
                <label
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                  }}
                >
                  Chi tiết yêu cầu & Mô tả (Chuẩn Task Packet ML-03)
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    {
                      label: '🤖 Anty (Win 1)',
                      tpl: '[EXECUTOR: Anty | MÁY: WIN-1 | MÔI TRƯỜNG: DEV/QA]\n- Mục tiêu:\n- Tiêu chí PASS:\n- Bằng chứng cần nộp (SHA / Test / Link):',
                    },
                    {
                      label: '🖥️ Máy Win 2',
                      tpl: '[EXECUTOR: Anty | MÁY: WIN-2 | MÔI TRƯỜNG: STAGING/PROD]\n- Mục tiêu:\n- Tiêu chí PASS:\n- Kế hoạch Rollback:',
                    },
                    {
                      label: '💻 MacBook',
                      tpl: '[EXECUTOR: AI/Owner | MÁY: MACBOOK | MÔI TRƯỜNG: DEV/iOS]\n- Mục tiêu:\n- Tiêu chí PASS:',
                    },
                    {
                      label: '🎬 Sản xuất Video V4',
                      tpl: '[EXECUTOR: Nhân sự / V4 Lite | KÊNH: Phong Thủy Lão Sư]\n- Kịch bản & Giọng đọc:\n- Link thành phẩm Google Drive (MP4/WAV):',
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        setNewDescription((prev) =>
                          prev.trim()
                            ? `${preset.tpl}\n\n${prev}`
                            : preset.tpl,
                        )
                      }
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(20, 184, 166, 0.14)',
                        border: '1px solid rgba(20, 184, 166, 0.35)',
                        color: 'var(--accent-text)',
                        cursor: 'pointer',
                      }}
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Nêu rõ các bước cần làm, yêu cầu đầu ra..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '14px',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Row: Work Type & Priority */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: '16px',
                marginBottom: '18px',
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '6px',
                    color: 'var(--text-color)',
                  }}
                >
                  Phân loại
                </label>
                <select
                  value={newWorkType}
                  onChange={(e) => setNewWorkType(e.target.value as WorkType)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                >
                  <option value="general">Việc chung</option>
                  <option value="content">Nội dung</option>
                  <option value="video">Dựng video</option>
                  <option value="design">Thiết kế</option>
                  <option value="other">Khác</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '6px',
                    color: 'var(--text-color)',
                  }}
                >
                  Mức độ ưu tiên
                </label>
                <select
                  value={newPriority}
                  onChange={(e) =>
                    setNewPriority(e.target.value as WorkPriority)
                  }
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                >
                  <option value="low">Thấp</option>
                  <option value="medium">Bình thường</option>
                  <option value="high">Cao</option>
                  <option value="urgent">Khẩn cấp</option>
                </select>
              </div>
            </div>

            {/* Due date */}
            <div style={{ marginBottom: '18px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-color)',
                }}
              >
                Hạn chót hoàn thành (Asia/Ho_Chi_Minh)
              </label>
              <input
                type="datetime-local"
                value={newDueAt}
                onChange={(e) => setNewDueAt(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Assignee multi-select */}
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-color)',
                }}
              >
                Giao cho nhân viên (có thể chọn nhiều người)
              </label>
              {employees.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Chưa có danh sách nhân sự hoặc đang tải...
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
                    gap: '8px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    padding: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                  }}
                >
                  {employees.map((emp) => {
                    const isChecked = selectedAssigneeIds.includes(emp.id);
                    return (
                      <label
                        key={emp.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: isChecked
                            ? 'rgba(20, 184, 166, 0.15)'
                            : 'var(--surface-subtle)',
                          border: isChecked
                            ? '1px solid #14B8A6'
                            : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAssigneeIds([
                                ...selectedAssigneeIds,
                                emp.id,
                              ]);
                            } else {
                              setSelectedAssigneeIds(
                                selectedAssigneeIds.filter(
                                  (id) => id !== emp.id,
                                ),
                              );
                            }
                          }}
                        />
                        <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>
                          {emp.employee_code}
                        </span>
                        <span style={{ color: 'var(--muted-color)' }}>
                          {emp.full_name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <AppButton type="submit" variant="primary" disabled={submitting}>
                {submitting ? 'Đang tạo...' : 'Tạo & Giao việc'}
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => onNavigate?.('/work')}
              >
                Hủy bỏ
              </AppButton>
            </div>
          </form>
        </AppCard>
      </div>
    );
  }

  // ==========================================
  // RENDER VIEW 2: DETAIL VIEW (/work/:id)
  // ==========================================
  if (workId) {
    if (loading) {
      return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px' }}>
          <LoadingState message="Đang tải chi tiết công việc..." />
        </div>
      );
    }

    if (apiUnavailable || !selectedWorkItem) {
      return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '16px' }}>
          <AppCard>
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <InfoIcon size={44} color="#38BDF8" />
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  marginTop: '12px',
                  color: 'var(--text-color)',
                }}
              >
                Chi tiết công việc chưa sẵn sàng
              </h3>
              <p
                style={{
                  fontSize: '14px',
                  color: 'var(--muted-color)',
                  marginTop: '8px',
                  marginBottom: '20px',
                }}
              >
                {apiUnavailable
                  ? 'Máy chủ API WORK-01 đang trong quá trình phát triển bởi Codex. Vui lòng thử lại sau.'
                  : errorMessage || 'Không tìm thấy công việc này.'}
              </p>
              <AppButton onClick={() => onNavigate?.('/work')}>
                Quay lại danh sách
              </AppButton>
            </div>
          </AppCard>
        </div>
      );
    }

    const item = selectedWorkItem;

    return (
      <div style={{ maxWidth: '840px', margin: '0 auto', padding: '0' }}>
        {/* Back navigation */}
        <div style={{ marginBottom: '16px' }}>
          <AppButton variant="secondary" onClick={() => onNavigate?.('/work')}>
            ← Quay lại danh sách
          </AppButton>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: 'var(--danger-text)',
              fontSize: '14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangleIcon size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              color: 'var(--success-text)',
              fontSize: '14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircleIcon size={18} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Work Item Header */}
        <AppCard style={{ padding: '24px', marginBottom: '20px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '12px',
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                    color: 'var(--info-text)',
                  }}
                >
                  {getWorkTypeLabel(item.work_type)}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: `${getPriorityColor(item.priority)}22`,
                    color: getPriorityColor(item.priority),
                  }}
                >
                  Ưu tiên: {getPriorityLabel(item.priority)}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Hạn chót: {formatDateTimeDisplay(item.due_at)}
                </span>
              </div>
              <h2
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                  margin: 0,
                }}
              >
                {item.title}
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {getWorkItemStatusBadge(item.status)}
              {role === 'owner' && item.status !== 'cancelled' && (
                <AppButton
                  variant="destructive"
                  disabled={submitting}
                  onClick={() => setShowCancelModal(true)}
                >
                  Hủy công việc
                </AppButton>
              )}
            </div>
          </div>

          {item.description && (
            <div
              style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                padding: '12px 14px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                marginTop: '12px',
                whiteSpace: 'pre-wrap',
              }}
            >
              {item.description}
            </div>
          )}
        </AppCard>

        {/* Section: Assignments & Progress */}
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-color)',
            marginBottom: '12px',
          }}
        >
          Phân công & Tiến độ thực hiện
        </h3>

        {(!item.assignments || item.assignments.length === 0) && (
          <AppCard style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted-color)', fontSize: '14px', margin: 0 }}>
              Công việc này chưa được phân công cho nhân viên nào.
            </p>
          </AppCard>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {item.assignments?.map((assignment) => {
            const isMyAssignment =
              role === 'staff' && assignment.employee_id === currentEmployeeId;
            const canStart = isMyAssignment && assignment.status === 'todo';
            const canSubmit =
              isMyAssignment && assignment.status === 'in_progress';
            const hasValidSubmission = Boolean(
              assignment.submissions && assignment.submissions.length > 0,
            );
            const canReview =
              role === 'owner' &&
              assignment.status === 'in_review' &&
              hasValidSubmission;

            return (
              <AppCard key={assignment.id} style={{ padding: '20px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--surface-hover)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-text)',
                      }}
                    >
                      <UserIcon size={20} />
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          color: 'var(--text-color)',
                        }}
                      >
                        {assignment.full_name || 'Nhân viên'} (
                        {assignment.employee_code || 'NV'})
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                        Giao lúc:{' '}
                        {formatDateTimeDisplay(assignment.assigned_at)}
                      </div>
                    </div>
                  </div>
                  <div>{getAssignmentStatusBadge(assignment.status)}</div>
                </div>

                <div style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                  <strong>Lịch thực hiện</strong>
                  {(assignment.schedule_links || []).map((link) => (
                    <div
                      key={link.work_date}
                      style={{
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        marginTop: '8px',
                      }}
                    >
                      <a href="/schedule" style={{ color: 'var(--accent-text)' }}>
                        {link.work_date} · {link.start_time} ·{' '}
                        {link.status === 'registered'
                          ? 'Ca đã đăng ký'
                          : 'Lịch đã hủy'}
                      </a>
                      {role === 'owner' &&
                        item.status !== 'completed' &&
                        item.status !== 'cancelled' && (
                          <AppButton
                            disabled={submitting}
                            onClick={() =>
                              handleScheduleLink(
                                assignment,
                                link.work_date,
                                true,
                              )
                            }
                          >
                            Gỡ khỏi lịch
                          </AppButton>
                        )}
                    </div>
                  ))}
                  {role === 'owner' &&
                    item.status !== 'completed' &&
                    item.status !== 'cancelled' && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '10px',
                          flexWrap: 'wrap',
                          marginTop: '10px',
                        }}
                      >
                        <input
                          aria-label={`Ngày xếp việc ${assignment.full_name || assignment.employee_id}`}
                          type="date"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                        />
                        <AppButton
                          disabled={submitting || !scheduleDate}
                          onClick={() =>
                            handleScheduleLink(assignment, scheduleDate)
                          }
                        >
                          Xếp vào lịch làm việc
                        </AppButton>
                      </div>
                    )}
                </div>

                {/* Latest Review Feedback if changes requested */}
                {assignment.latest_review &&
                  assignment.latest_review.decision === 'request_changes' && (
                    <div
                      style={{
                        padding: '12px 14px',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '6px',
                        color: 'var(--warning-text)',
                        fontSize: '13px',
                        marginBottom: '14px',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <RotateCcwIcon size={16} />
                        <span>Owner yêu cầu làm lại:</span>
                      </div>
                      <div style={{ marginTop: '4px', color: 'var(--text-color)' }}>
                        {assignment.latest_review.feedback}
                      </div>
                    </div>
                  )}

                {/* Submissions list */}
                {assignment.submissions &&
                  assignment.submissions.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: 'var(--muted-color)',
                          marginBottom: '8px',
                        }}
                      >
                        Lịch sử nộp kết quả ({assignment.submissions.length}{' '}
                        lần):
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        {assignment.submissions.map((sub) => (
                          <div
                            key={sub.id}
                            style={{
                              padding: '10px 12px',
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '6px',
                              fontSize: '13px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                color: 'var(--muted-color)',
                                marginBottom: '4px',
                              }}
                            >
                              <span>Lần nộp #{sub.revision_number}</span>
                              <span>
                                {formatDateTimeDisplay(sub.submitted_at)}
                              </span>
                            </div>
                            <div style={{ color: 'var(--text-color)' }}>
                              {sub.submission_note}
                            </div>
                            {sub.attachments && sub.attachments.length > 0 && (
                              <div
                                style={{
                                  marginTop: '6px',
                                  display: 'flex',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                {sub.attachments.map((att, idx) => (
                                  <a
                                    key={idx}
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      color: 'var(--accent-text)',
                                      textDecoration: 'underline',
                                      fontSize: '12px',
                                    }}
                                  >
                                    📎 {att.name}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Actions per assignment */}
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap: 'wrap',
                    paddingTop: '10px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  {canStart && (
                    <AppButton
                      variant="primary"
                      disabled={submitting}
                      onClick={() => handleStartWork(assignment.id)}
                    >
                      Bắt đầu làm việc
                    </AppButton>
                  )}

                  {canSubmit && (
                    <AppButton
                      variant="primary"
                      disabled={submitting}
                      onClick={() => {
                        setActiveAssignmentId(assignment.id);
                        setShowSubmitModal(true);
                      }}
                    >
                      Báo cáo hoàn thành (Nộp bài)
                    </AppButton>
                  )}

                  {canReview && (
                    <>
                      <AppButton
                        variant="primary"
                        disabled={submitting}
                        onClick={() => {
                          const latestSub =
                            assignment.submissions &&
                            assignment.submissions.length > 0
                              ? assignment.submissions[
                                  assignment.submissions.length - 1
                                ]
                              : undefined;
                          if (!latestSub) {
                            setErrorMessage(
                              'Không thể nghiệm thu khi chưa có bản nộp kết quả hợp lệ.',
                            );
                            return;
                          }
                          setReviewAssignmentId(assignment.id);
                          setReviewSubmissionId(latestSub.id);
                          setReviewDecision('approved');
                          setShowReviewModal(true);
                        }}
                      >
                        ✓ Duyệt đạt
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => {
                          const latestSub =
                            assignment.submissions &&
                            assignment.submissions.length > 0
                              ? assignment.submissions[
                                  assignment.submissions.length - 1
                                ]
                              : undefined;
                          if (!latestSub) {
                            setErrorMessage(
                              'Không thể nghiệm thu khi chưa có bản nộp kết quả hợp lệ.',
                            );
                            return;
                          }
                          setReviewAssignmentId(assignment.id);
                          setReviewSubmissionId(latestSub.id);
                          setReviewDecision('request_changes');
                          setShowReviewModal(true);
                        }}
                      >
                        ↻ Yêu cầu sửa lại
                      </AppButton>
                    </>
                  )}
                </div>
              </AppCard>
            );
          })}
        </div>

        {/* Modal: Staff Submit Work */}
        {showSubmitModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                maxWidth: '500px',
                width: '100%',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '24px',
              }}
            >
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                  marginBottom: '12px',
                }}
              >
                Báo cáo kết quả công việc
              </h3>
              <form onSubmit={handleSubmitWork}>
                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Ghi chú kết quả thực hiện{' '}
                    <span style={{ color: 'var(--danger-text)' }}>*</span>
                  </label>
                  <textarea
                    value={submissionNote}
                    onChange={(e) => setSubmissionNote(e.target.value)}
                    rows={4}
                    placeholder="Mô tả kết quả đã làm, số lượng hoàn thành, các vấn đề gặp phải..."
                    required
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '18px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Đính kèm tài liệu / Link Drive (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={attachmentName}
                    onChange={(e) => setAttachmentName(e.target.value)}
                    placeholder="Tên tài liệu (VD: BienBan.pdf)"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                      marginBottom: '8px',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="url"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    placeholder="https://..."
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowSubmitModal(false)}
                  >
                    Hủy
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Đang gửi...' : 'Gửi báo cáo'}
                  </AppButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Owner Review */}
        {showReviewModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                maxWidth: '500px',
                width: '100%',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '24px',
              }}
            >
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                  marginBottom: '12px',
                }}
              >
                {reviewDecision === 'approved'
                  ? 'Nghiệm thu hoàn thành công việc'
                  : 'Yêu cầu nhân viên làm lại'}
              </h3>
              <form onSubmit={handleReviewWork}>
                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Quyết định
                  </label>
                  <select
                    value={reviewDecision}
                    onChange={(e) =>
                      setReviewDecision(e.target.value as WorkReviewDecision)
                    }
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  >
                    <option value="approved">
                      Duyệt đạt (Hoàn thành - Done)
                    </option>
                    <option value="request_changes">
                      Yêu cầu sửa lại (Quay về Đang làm - In Progress)
                    </option>
                  </select>
                </div>

                <div style={{ marginBottom: '18px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Nhận xét / Phản hồi cho nhân viên{' '}
                    {reviewDecision === 'request_changes' && (
                      <span style={{ color: 'var(--danger-text)' }}>*</span>
                    )}
                  </label>
                  <textarea
                    value={reviewFeedback}
                    onChange={(e) => setReviewFeedback(e.target.value)}
                    rows={4}
                    placeholder={
                      reviewDecision === 'approved'
                        ? 'Nhận xét khen ngợi (tùy chọn)...'
                        : 'Nêu rõ điểm chưa đạt, yêu cầu sửa đổi cụ thể...'
                    }
                    required={reviewDecision === 'request_changes'}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowReviewModal(false)}
                  >
                    Hủy
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Đang xử lý...' : 'Xác nhận'}
                  </AppButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Owner Cancel Work Item */}
        {showCancelModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 9999,
            }}
          >
            <div
              style={{
                maxWidth: '480px',
                width: '100%',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '24px',
              }}
            >
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--danger-text)',
                  marginBottom: '12px',
                }}
              >
                Xác nhận hủy công việc
              </h3>
              <p
                style={{
                  fontSize: '14px',
                  color: 'var(--muted-color)',
                  marginBottom: '16px',
                  lineHeight: 1.5,
                }}
              >
                Hành động này sẽ chuyển trạng thái công việc sang "Đã hủy". Toàn
                bộ lịch sử phân công và báo cáo kết quả của nhân viên sẽ được
                bảo toàn nguyên vẹn.
              </p>
              <form onSubmit={handleCancelWorkItem}>
                <div style={{ marginBottom: '16px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Lý do hủy (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Nhập lý do hủy công việc..."
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowCancelModal(false)}
                  >
                    Đóng
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="destructive"
                    disabled={submitting}
                  >
                    {submitting ? 'Đang hủy...' : 'Xác nhận hủy'}
                  </AppButton>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER VIEW 3: LIST VIEW (/work)
  // ==========================================
  return (
    <div style={{ width: '100%' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--text-color)',
              margin: '0 0 4px 0',
            }}
          >
            Quản lý công việc
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--muted-color)', margin: 0 }}>
            {role === 'owner'
              ? 'Giao việc, theo dõi tiến độ và nghiệm thu kết quả cửa hàng'
              : 'Danh sách nhiệm vụ & công việc được phân công cho bạn'}
          </p>
        </div>

        {role === 'owner' && (
          <AppButton
            variant="primary"
            onClick={() => onNavigate?.('/work/new')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <PlusIcon size={16} />
            <span>Giao việc mới</span>
          </AppButton>
        )}
      </div>

      {/* Backend API Unavailable Notice */}
      {apiUnavailable && (
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '8px',
            color: 'var(--info-text)',
            fontSize: '13px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <InfoIcon size={20} />
          <div>
            <strong>Thông báo trạng thái hệ thống:</strong> API WORK-01 đang
            được triển khai song song ở tầng cơ sở dữ liệu và backend. Giao diện
            đang ở chế độ chờ kết nối máy chủ.
          </div>
        </div>
      )}

      {/* Error Notice */}
      {errorMessage && (
        <div style={{ marginBottom: '20px' }}>
          <ErrorState message={errorMessage} onRetry={fetchData} />
        </div>
      )}

      {/* KPI Cards */}
      <div
        className="kpi-grid-4"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <AppCard style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}>
            CẦN LÀM
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--text-color)',
              marginTop: '4px',
            }}
          >
            {kpiStats.todo}
          </div>
        </AppCard>

        <AppCard style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--info-text)', fontWeight: 600 }}>
            ĐANG LÀM
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--info-text)',
              marginTop: '4px',
            }}
          >
            {kpiStats.inProgress}
          </div>
        </AppCard>

        <AppCard style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--warning-text)', fontWeight: 600 }}>
            CHỜ DUYỆT
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--warning-text)',
              marginTop: '4px',
            }}
          >
            {kpiStats.inReview}
          </div>
        </AppCard>

        <AppCard style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--success-text)', fontWeight: 600 }}>
            HOÀN THÀNH
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--success-text)',
              marginTop: '4px',
            }}
          >
            {kpiStats.completed}
          </div>
        </AppCard>
      </div>

      {/* ML-04 Smart Focus Filter Chips: Hôm nay / Quá hạn / Bị chặn / Chờ duyệt */}
      <div
        data-testid="work-ml04-focus-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '16px',
          alignItems: 'center',
        }}
      >
        {(
          [
            {
              key: 'all',
              label: `Tất cả (${kpiStats.total})`,
              activeColor: '#38BDF8',
            },
            {
              key: 'today',
              label: `📅 Hôm nay (${kpiStats.todayCount})`,
              activeColor: '#14B8A6',
            },
            {
              key: 'overdue',
              label: `🚨 Quá hạn (${kpiStats.overdueCount})`,
              activeColor: '#EF4444',
            },
            {
              key: 'blocked',
              label: `⛔ Cần sửa / Bị chặn (${kpiStats.blockedCount})`,
              activeColor: '#F97316',
            },
            {
              key: 'pending_review',
              label: `⏳ Chờ duyệt (${kpiStats.inReview})`,
              activeColor: '#F59E0B',
            },
          ] as const
        ).map((chip) => {
          const isActive = smartFocusFilter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              data-testid={`work-focus-${chip.key}`}
              onClick={() => {
                setSmartFocusFilter(chip.key);
                setListPage(0);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: isActive
                  ? `${chip.activeColor}22`
                  : 'var(--surface-subtle)',
                border: isActive
                  ? `1px solid ${chip.activeColor}`
                  : '1px solid var(--border-subtle)',
                color: isActive ? chip.activeColor : 'var(--muted-color)',
                transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Read-Only Schedule Connection (SCHEDULE + WORK - ISSUE #1) */}
      <AppCard
        style={{
          padding: '14px 18px',
          marginBottom: '20px',
          backgroundColor: 'var(--bg-color)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={18} color="#38BDF8" />
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text-color)',
              }}
            >
              Lịch trực tuần này (Chỉ đọc)
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--surface-hover)',
                color: 'var(--muted-color)',
              }}
            >
              Đồng bộ lịch cá nhân
            </span>
          </div>
          {onNavigate && (
            <AppButton
              variant="secondary"
              onClick={() => onNavigate('/schedule')}
              style={{
                fontSize: '12px',
                padding: '4px 10px',
                height: 'auto',
              }}
            >
              Xem toàn bộ lịch →
            </AppButton>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            fontSize: '13px',
          }}
        >
          {(() => {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const todayIso = `${yyyy}-${mm}-${dd}`;
            const todayShift = scheduleEntries.find(
              (e) => e.work_date === todayIso,
            );

            return (
              <>
                <div
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: todayShift
                      ? 'rgba(56, 189, 248, 0.15)'
                      : 'var(--surface-hover)',
                    border: todayShift
                      ? '1px solid #38BDF8'
                      : '1px solid transparent',
                    color: todayShift ? 'var(--info-text)' : 'var(--muted-color)',
                  }}
                >
                  <strong>Ca trực hôm nay:</strong>{' '}
                  {todayShift ? (
                    <span>
                      Bắt đầu lúc <strong>{todayShift.start_time}</strong>
                      {todayShift.notes ? ` — ${todayShift.notes}` : ''}
                    </span>
                  ) : (
                    <span>Không có ca trực</span>
                  )}
                </div>

                <div style={{ color: 'var(--muted-color)', fontSize: '12px' }}>
                  {scheduleEntries.length > 0
                    ? `Tuần này bạn có ${scheduleEntries.length} ca trực được xếp lịch.`
                    : 'Chưa có lịch trực trong tuần này.'}
                </div>
              </>
            );
          })()}
        </div>
      </AppCard>

      {/* Search & Filter Bar */}
      <AppCard style={{ padding: '16px', marginBottom: '20px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              data-testid="work-search-input"
              aria-label="Tìm kiếm công việc"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm công việc..."
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          {/* Status filter */}
          <div>
            <select
              data-testid="work-status-filter"
              aria-label="Lọc theo trạng thái"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="todo">Cần làm</option>
              <option value="in_progress">Đang làm</option>
              <option value="in_review">Chờ duyệt</option>
              <option value="completed">Hoàn thành</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>

          {/* Priority filter */}
          <div>
            <select
              data-testid="work-priority-filter"
              aria-label="Lọc theo độ ưu tiên"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              <option value="all">Tất cả độ ưu tiên</option>
              <option value="urgent">Khẩn cấp</option>
              <option value="high">Cao</option>
              <option value="medium">Bình thường</option>
              <option value="low">Thấp</option>
            </select>
          </div>

          {/* Assignee filter (Owner only) */}
          {role === 'owner' && (
            <div>
              <select
                data-testid="work-assignee-filter"
                aria-label="Lọc theo nhân sự"
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              >
                <option value="all">Tất cả nhân sự</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_code} - {emp.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </AppCard>

      {/* Work Items List */}
      {loading ? (
        <LoadingState message="Đang tải danh sách công việc..." />
      ) : workItems.length === 0 ? (
        <AppCard style={{ padding: '32px' }}>
          <EmptyState
            title="Chưa có công việc nào"
            description={
              role === 'owner'
                ? 'Hãy bấm nút "Giao việc mới" để tạo công việc đầu tiên cho nhân viên.'
                : 'Hiện tại bạn chưa được phân công công việc nào.'
            }
          />
        </AppCard>
      ) : filteredItems.length === 0 ? (
        <AppCard style={{ padding: '32px' }} data-testid="work-empty-search">
          <EmptyState
            title="Không tìm thấy công việc phù hợp"
            description="Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái/ưu tiên."
          />
        </AppCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pagedItems.map((item) => (
            <div
              key={item.id}
              onClick={() => onNavigate?.(`/work/${item.id}`)}
              style={{
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '16px',
                cursor: 'pointer',
                transition:
                  'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                  flexWrap: 'wrap',
                  marginBottom: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px',
                      alignItems: 'center',
                      marginBottom: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(56, 189, 248, 0.12)',
                        color: 'var(--info-text)',
                      }}
                    >
                      {getWorkTypeLabel(item.work_type)}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: `${getPriorityColor(item.priority)}22`,
                        color: getPriorityColor(item.priority),
                      }}
                    >
                      {getPriorityLabel(item.priority)}
                    </span>
                    {item.due_at && (
                      <span
                        style={{
                          fontSize: '12px',
                          color: isItemOverdue(item) ? 'var(--danger-text)' : 'var(--muted-color)',
                          fontWeight: isItemOverdue(item) ? 700 : 400,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <CalendarIcon size={13} />
                        {formatDateTimeDisplay(item.due_at)}
                        {isItemOverdue(item) ? ' (Quá hạn)' : ''}
                      </span>
                    )}
                    {isItemBlocked(item) && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(249, 115, 22, 0.16)',
                          color: '#FB923C',
                        }}
                      >
                        ⛔ Cần sửa / Bị chặn
                      </span>
                    )}
                    {item.description &&
                      /\[EXECUTOR:\s*([^\]]+)\]/i.test(item.description) && (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(20, 184, 166, 0.14)',
                            color: 'var(--accent-text)',
                          }}
                        >
                          🤖{' '}
                          {
                            item.description.match(
                              /\[EXECUTOR:\s*([^\]]+)\]/i,
                            )?.[1]
                          }
                        </span>
                      )}
                  </div>
                  <h4
                    style={{
                      fontSize: '16px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      margin: '0 0 4px 0',
                    }}
                  >
                    {item.title}
                  </h4>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {getWorkItemStatusBadge(item.status)}
                  <ActionIconButton
                    action="view"
                    target={item.title}
                    testId={`work-view-${item.id}`}
                    onClick={() => onNavigate?.(`/work/${item.id}`)}
                  />
                </div>
              </div>

              {item.description && (
                <p
                  style={{
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    margin: '0 0 10px 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.description}
                </p>
              )}

              {/* Assignees & Evidence Drill-down (ML-04) */}
              {(() => {
                const allSubmissions =
                  item.assignments?.flatMap((a) => a.submissions || []) || [];
                const allAttachments = allSubmissions.flatMap(
                  (s) => s.attachments || [],
                );
                const hasAssignees = Boolean(
                  item.assignments && item.assignments.length > 0,
                );
                if (!hasAssignees && allSubmissions.length === 0) return null;
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      flexWrap: 'wrap',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                        Phân công:
                      </span>
                      {hasAssignees ? (
                        item.assignments!.map((a) => (
                          <span
                            key={a.id}
                            style={{
                              fontSize: '12px',
                              backgroundColor: 'var(--surface-hover)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              color: 'var(--text-color)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <UserIcon size={12} color="#14B8A6" />
                            {a.full_name || a.employee_code}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                          Chưa gán nhân viên
                        </span>
                      )}
                    </div>

                    {allSubmissions.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          onClick={() => onNavigate?.(`/work/${item.id}`)}
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(16, 185, 129, 0.14)',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            color: 'var(--success-text)',
                            cursor: 'pointer',
                          }}
                        >
                          📋 {allSubmissions.length} báo cáo nộp → Xem bằng chứng
                        </span>
                        {allAttachments.slice(0, 2).map((att, idx) => (
                          <a
                            key={`${att.url}-${idx}`}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(56, 189, 248, 0.14)',
                              color: 'var(--info-text)',
                              textDecoration: 'none',
                            }}
                          >
                            📎 {att.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
          <Pagination
            testId="work-pager"
            total={filteredItems.length}
            page={safeListPage}
            pageSize={listPageSize}
            pageSizes={PAGINATION_PAGE_SIZES}
            onPage={setListPage}
            onPageSize={(n) => {
              setListPageSize(n);
              setListPage(0);
            }}
          />
        </div>
      )}
    </div>
  );
};
