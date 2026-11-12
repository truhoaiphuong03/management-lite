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
  ActionIconButton,
  Pagination,
  useAutoDismiss,
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

import {
  formatDateTimeDisplay,
  describeWorkDeadline,
  getPriorityBadgeText,
  getPriorityColor,
  getPriorityBg,
  getWorkCardAccentBorder,
  getWorkTypeLabel,
  classifyWorkSection,
  compareWorkItems,
  parseWorkDescriptionChecklist,
  toggleChecklistItemInDescription,
  appendChecklistItemToDescription,
  type WorkSortMode,
  type WorkSectionKey,
} from './helpers/work-helpers.js';

function getAssignmentStatusBadge(status: WorkAssignmentStatus) {
  switch (status) {
    case 'todo':
      return <StatusBadge status="muted" label="Chưa bắt đầu" />;
    case 'in_progress':
      return <StatusBadge status="neutral" label="Đang làm" />;
    case 'in_review':
      return <StatusBadge status="warning" label="Chờ duyệt" />;
    case 'completed':
      return <StatusBadge status="success" label="Hoàn thành" />;
    default:
      return <StatusBadge status="muted" label={status} />;
  }
}

function getWorkItemStatusBadge(status: WorkItemStatus) {
  switch (status) {
    case 'todo':
      return <StatusBadge status="muted" label="Cần làm" />;
    case 'in_progress':
      return <StatusBadge status="neutral" label="Đang làm" />;
    case 'in_review':
      return <StatusBadge status="warning" label="Chờ duyệt" />;
    case 'completed':
      return <StatusBadge status="success" label="Hoàn thành" />;
    case 'cancelled':
      return <StatusBadge status="error" label="Đã hủy" />;
    default:
      return <StatusBadge status="muted" label={status} />;
  }
}

function getAssigneeInitials(fullName?: string, code?: string): string {
  const source = (fullName || code || 'NV').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] || '';
    const last = parts[parts.length - 1]?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function toLocalDatetimeInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  useAutoDismiss(successMessage, () => setSuccessMessage(null), 4000);
  useAutoDismiss(errorMessage, () => setErrorMessage(null), 5000);

  // Filters & Sorting (List view)
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortMode, setSortMode] = useState<WorkSortMode>('smart');
  const [showClosedSection, setShowClosedSection] = useState<boolean>(false);
  const [smartFocusFilter, setSmartFocusFilter] = useState<
    'all' | 'today' | 'overdue' | 'blocked' | 'pending_review'
  >('all');

  // Detail interactive checklist & schedule-link toggle states
  const [newStepText, setNewStepText] = useState<string>('');
  const [showScheduleLinkerMap, setShowScheduleLinkerMap] = useState<
    Record<string, boolean>
  >({});

  // Owner Edit / Reschedule Modal state (/work/:id)
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editWorkType, setEditWorkType] = useState<WorkType>('general');
  const [editPriority, setEditPriority] = useState<WorkPriority>('medium');
  const [editDueAt, setEditDueAt] = useState<string>('');
  const [editAdditionalAssigneeIds, setEditAdditionalAssigneeIds] = useState<
    string[]
  >([]);

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
        const items = Array.isArray(empBody.data?.items)
          ? empBody.data.items
          : [];
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
          if (
            active &&
            schedBody.success &&
            Array.isArray(schedBody.data?.entries)
          ) {
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
          if (body.success && Array.isArray(body.data?.items)) {
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

  // 3. Filtered & Smart-Sorted Work Items (separating open vs closed work)
  const sortedMatchingItems = useMemo(() => {
    const matched = workItems.filter((item) => {
      // Smart Focus filter (ML-04)
      if (smartFocusFilter === 'today' && !isItemToday(item)) return false;
      if (smartFocusFilter === 'overdue' && !isItemOverdue(item)) return false;
      if (smartFocusFilter === 'blocked' && !isItemBlocked(item)) return false;
      if (smartFocusFilter === 'pending_review' && item.status !== 'in_review')
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

    return [...matched].sort((a, b) => compareWorkItems(a, b, sortMode));
  }, [
    workItems,
    smartFocusFilter,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    searchQuery,
    sortMode,
    role,
    currentEmployeeId,
    todayVnDateStr,
  ]);

  const isExplicitClosedView =
    statusFilter === 'completed' ||
    statusFilter === 'cancelled' ||
    Boolean(searchQuery.trim());

  const hiddenClosedCount = useMemo(() => {
    if (isExplicitClosedView || showClosedSection) return 0;
    return sortedMatchingItems.filter(
      (i) => i.status === 'completed' || i.status === 'cancelled',
    ).length;
  }, [sortedMatchingItems, isExplicitClosedView, showClosedSection]);

  const totalClosedMatchingCount = useMemo(() => {
    return sortedMatchingItems.filter(
      (i) => i.status === 'completed' || i.status === 'cancelled',
    ).length;
  }, [sortedMatchingItems]);

  const filteredItems = useMemo(() => {
    if (isExplicitClosedView || showClosedSection) {
      return sortedMatchingItems;
    }
    return sortedMatchingItems.filter(
      (i) => i.status !== 'completed' && i.status !== 'cancelled',
    );
  }, [sortedMatchingItems, isExplicitClosedView, showClosedSection]);

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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mglite:work-updated'));
      }
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mglite:work-updated'));
      }
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

  const cleanAtlasDisplayDescription = (
    rawDesc: string | null | undefined,
  ): string => {
    if (!rawDesc) return '';
    return rawDesc.replace(/\s*\[AtlasRef:[^\]]+\]\s*/gi, '\n').trim();
  };

  const isAtlasSyncedWorkItem = (
    rawDesc: string | null | undefined,
  ): boolean => {
    return Boolean(rawDesc && /\[AtlasRef:[^\]]+\]/i.test(rawDesc));
  };

  const handleOwnerQuickComplete = async (targetItem: WorkItemData) => {
    if (role !== 'owner' || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${targetItem.version}"`,
        'Idempotency-Key': crypto.randomUUID(),
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`/api/v1/work-items/${targetItem.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ status: 'completed' }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể đánh dấu hoàn thành công việc',
        );
      }
      setSuccessMessage(
        'Đã đánh dấu hoàn thành công việc (tự động đồng bộ với AI Work Atlas)!',
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mglite:work-updated'));
      }
      if (workId && body.data) {
        setSelectedWorkItem(body.data);
      } else {
        fetchData();
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleChecklistStep = async (
    targetItem: WorkItemData,
    checklistIndex: number,
    nextChecked: boolean,
  ) => {
    if (role !== 'owner' || submitting || targetItem.status === 'cancelled') {
      return;
    }
    const previousDesc = targetItem.description;
    const nextDescription = toggleChecklistItemInDescription(
      targetItem.description,
      checklistIndex,
      nextChecked,
    );
    if (selectedWorkItem && selectedWorkItem.id === targetItem.id) {
      setSelectedWorkItem({
        ...selectedWorkItem,
        description: nextDescription,
      });
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${targetItem.version}"`,
        'Idempotency-Key': crypto.randomUUID(),
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const patchPayload: Record<string, unknown> = {
        description: nextDescription,
      };
      if (
        nextChecked &&
        targetItem.status === 'todo' &&
        (targetItem.assignments?.length ?? 0) > 0
      ) {
        patchPayload.status = 'in_progress';
      }

      const res = await fetch(`/api/v1/work-items/${targetItem.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(patchPayload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể lưu tiến độ bước thực hiện',
        );
      }
      if (body.data) {
        setSelectedWorkItem(body.data);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mglite:work-updated'));
      }
    } catch (err) {
      if (selectedWorkItem && selectedWorkItem.id === targetItem.id) {
        setSelectedWorkItem({
          ...selectedWorkItem,
          description: previousDesc,
        });
      }
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddChecklistStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      role !== 'owner' ||
      submitting ||
      !selectedWorkItem ||
      selectedWorkItem.status === 'cancelled' ||
      !newStepText.trim()
    ) {
      return;
    }
    const nextDescription = appendChecklistItemToDescription(
      selectedWorkItem.description,
      newStepText.trim(),
    );
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${selectedWorkItem.version}"`,
        'Idempotency-Key': crypto.randomUUID(),
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`/api/v1/work-items/${selectedWorkItem.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ description: nextDescription }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể thêm bước thực hiện');
      }
      setNewStepText('');
      if (body.data) {
        setSelectedWorkItem(body.data);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (targetItem: WorkItemData) => {
    setEditTitle(targetItem.title);
    setEditDescription(cleanAtlasDisplayDescription(targetItem.description));
    setEditWorkType(targetItem.work_type || 'general');
    setEditPriority(targetItem.priority || 'medium');
    setEditDueAt(toLocalDatetimeInputValue(targetItem.due_at));
    setEditAdditionalAssigneeIds([]);
    setShowEditModal(true);
  };

  const handleSaveEditWorkItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkItem || !editTitle.trim()) {
      setErrorMessage('Vui lòng nhập tiêu đề công việc.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const atlasTagMatch =
        selectedWorkItem.description?.match(/\[AtlasRef:[^\]]+\]/i)?.[0] ??
        null;
      let mergedDescription = editDescription.trim();
      if (atlasTagMatch && !/\[AtlasRef:[^\]]+\]/i.test(mergedDescription)) {
        mergedDescription = mergedDescription
          ? `${mergedDescription}\n\n${atlasTagMatch}`
          : atlasTagMatch;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${selectedWorkItem.version}"`,
        'Idempotency-Key': crypto.randomUUID(),
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const patchRes = await fetch(
        `/api/v1/work-items/${selectedWorkItem.id}`,
        {
          method: 'PATCH',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            title: editTitle.trim(),
            description: mergedDescription || null,
            work_type: editWorkType,
            priority: editPriority,
            due_at: editDueAt ? new Date(editDueAt).toISOString() : null,
          }),
        },
      );
      const patchBody = await patchRes.json();
      if (!patchRes.ok || !patchBody.success) {
        throw new Error(
          patchBody.error?.message || 'Không thể lưu cập nhật công việc',
        );
      }

      let latestItem: WorkItemData = patchBody.data;

      if (editAdditionalAssigneeIds.length > 0) {
        const assignHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'If-Match': `"${latestItem.version}"`,
          'Idempotency-Key': crypto.randomUUID(),
        };
        if (csrfToken) assignHeaders['X-CSRF-Token'] = csrfToken;

        const assignRes = await fetch(
          `/api/v1/work-items/${selectedWorkItem.id}/assignments`,
          {
            method: 'POST',
            headers: assignHeaders,
            credentials: 'include',
            body: JSON.stringify({ employee_ids: editAdditionalAssigneeIds }),
          },
        );
        const assignBody = await assignRes.json();
        if (!assignRes.ok || !assignBody.success) {
          throw new Error(
            assignBody.error?.message ||
              'Đã lưu nội dung nhưng chưa thêm được nhân viên mới',
          );
        }
        latestItem = assignBody.data;
      }

      setSelectedWorkItem(latestItem);
      setShowEditModal(false);
      setEditAdditionalAssigneeIds([]);
      setSuccessMessage('Đã lưu cập nhật công việc thành công!');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mglite:work-updated'));
      }
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

    const applyQuickDueAt = (
      preset: 'today_18' | 'tomorrow_12' | 'tomorrow_18' | 'plus_3d',
    ) => {
      const now = new Date();
      const target = new Date(now);
      if (preset === 'today_18') {
        target.setHours(18, 0, 0, 0);
      } else if (preset === 'tomorrow_12') {
        target.setDate(target.getDate() + 1);
        target.setHours(12, 0, 0, 0);
      } else if (preset === 'tomorrow_18') {
        target.setDate(target.getDate() + 1);
        target.setHours(18, 0, 0, 0);
      } else {
        target.setDate(target.getDate() + 3);
        target.setHours(18, 0, 0, 0);
      }
      const pad = (n: number) => String(n).padStart(2, '0');
      const localIso = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
      setNewDueAt(localIso);
    };

    const assignableEmployees = employees
      .filter((emp, idx, arr) => {
        if (emp.employee_code === 'ADMIN') {
          const hasAdm01 = arr.some((e) => e.employee_code === 'ADM01');
          if (hasAdm01) return false;
        }
        return (
          arr.findIndex(
            (e) =>
              e.id === emp.id ||
              (e.full_name === emp.full_name &&
                e.full_name.toLowerCase().includes('quản trị viên')),
          ) === idx
        );
      })
      .sort((a, b) => {
        const aIsAdmin = /^adm/i.test(a.employee_code) ? 1 : 0;
        const bIsAdmin = /^adm/i.test(b.employee_code) ? 1 : 0;
        if (aIsAdmin !== bIsAdmin) return aIsAdmin - bIsAdmin;
        return a.employee_code.localeCompare(b.employee_code);
      });

    // Legacy [EXECUTOR: compatibility tag retained for existing task badges
    return (
      <div
        className="work-page"
        style={{ maxWidth: '720px', margin: '0 auto' }}
      >
        <PageHeader
          title="Giao việc mới"
          subtitle="Tạo công việc, đặt hạn hoàn thành và phân công cho nhân sự thực hiện"
        />

        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '12px',
              color: 'var(--danger-text)',
              fontSize: '14px',
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
              borderRadius: '12px',
              color: 'var(--success-text)',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <CheckCircleIcon size={18} />
            <span>{successMessage}</span>
          </div>
        )}

        <AppCard className="work-flat-card" style={{ padding: '24px' }}>
          <form onSubmit={handleCreateWorkItem}>
            {/* Quick Human Work Templates */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                  }}
                >
                  Mẫu việc nhanh:
                </span>
                {[
                  {
                    label: 'Dựng Video',
                    type: 'video' as WorkType,
                    titlePrefix: 'Dựng video: ',
                    tpl: '- Kênh / Chủ đề:\n- Số lượng & Thời lượng:\n- Yêu cầu nộp: Link Google Drive video hoàn chỉnh',
                  },
                  {
                    label: 'Viết Kịch bản / Nội dung',
                    type: 'content' as WorkType,
                    titlePrefix: 'Soạn kịch bản: ',
                    tpl: '- Chủ đề nội dung:\n- Số lượng kịch bản:\n- Yêu cầu nộp: Link tài liệu / File kịch bản',
                  },
                  {
                    label: 'Đăng bài & Chăm sóc kênh',
                    type: 'general' as WorkType,
                    titlePrefix: 'Đăng bài & tương tác kênh: ',
                    tpl: '- Kênh thực hiện (TikTok / FB / YTB):\n- Khung giờ đăng:\n- Yêu cầu nộp: Link bài đã đăng hoặc ảnh chụp kết quả',
                  },
                  {
                    label: 'Thiết kế Ảnh / Thumbnail',
                    type: 'design' as WorkType,
                    titlePrefix: 'Thiết kế: ',
                    tpl: '- Nội dung thiết kế:\n- Kích thước / Tỷ lệ:\n- Yêu cầu nộp: Link file ảnh thành phẩm',
                  },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setNewWorkType(preset.type);
                      if (!newTitle.trim()) {
                        setNewTitle(preset.titlePrefix);
                      }
                      setNewDescription((prev) =>
                        prev.trim() ? prev : preset.tpl,
                      );
                    }}
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: '999px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: 'var(--text-color)',
                }}
              >
                Tiêu đề công việc{' '}
                <span style={{ color: 'var(--danger-text)' }}>*</span>
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="VD: Dựng 3 video TikTok kênh Phong Thủy, Đăng bài & tương tác kênh…"
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

            {/* Description */}
            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--text-color)',
                  marginBottom: '6px',
                }}
              >
                Chi tiết yêu cầu & Kết quả cần nộp
              </label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Ghi rõ yêu cầu công việc, link nguyên liệu (nếu có) và kết quả nhân viên cần nộp lại…"
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
                marginBottom: '16px',
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
                  Phân loại công việc
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
                  <option value="general">Việc chung / Vận hành kênh</option>
                  <option value="video">Dựng video</option>
                  <option value="content">Kịch bản / Nội dung</option>
                  <option value="design">Thiết kế ảnh / Thumbnail</option>
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
                  <option value="urgent">Khẩn cấp (Làm ngay)</option>
                </select>
              </div>
            </div>

            {/* Due date + Quick Deadline Chips */}
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
                  Hạn hoàn thành
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    { id: 'today_18' as const, label: 'Hôm nay 18:00' },
                    { id: 'tomorrow_12' as const, label: 'Trưa mai 12:00' },
                    { id: 'tomorrow_18' as const, label: 'Chiều mai 18:00' },
                    { id: 'plus_3d' as const, label: '+3 ngày' },
                  ].map((dPreset) => (
                    <button
                      key={dPreset.id}
                      type="button"
                      onClick={() => applyQuickDueAt(dPreset.id)}
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '999px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--accent-text)',
                        cursor: 'pointer',
                      }}
                    >
                      {dPreset.label}
                    </button>
                  ))}
                  {newDueAt && (
                    <button
                      type="button"
                      onClick={() => setNewDueAt('')}
                      style={{
                        fontSize: '12px',
                        padding: '3px 8px',
                        borderRadius: '999px',
                        backgroundColor: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--muted-color)',
                        cursor: 'pointer',
                      }}
                    >
                      Xóa hạn
                    </button>
                  )}
                </div>
              </div>
              <input
                type="datetime-local"
                aria-label="Hạn hoàn thành công việc"
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
                  Giao cho nhân viên ({selectedAssigneeIds.length} đã chọn)
                </label>
                {assignableEmployees.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const staffOnly = assignableEmployees.filter(
                          (e) => !/^adm/i.test(e.employee_code),
                        );
                        const targetList =
                          staffOnly.length > 0
                            ? staffOnly
                            : assignableEmployees;
                        setSelectedAssigneeIds(targetList.map((e) => e.id));
                      }}
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--accent-text)',
                        cursor: 'pointer',
                      }}
                    >
                      Chọn tất cả NV
                    </button>
                    {selectedAssigneeIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedAssigneeIds([])}
                        style={{
                          fontSize: '12px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-subtle)',
                          backgroundColor: 'transparent',
                          color: 'var(--muted-color)',
                          cursor: 'pointer',
                        }}
                      >
                        Bỏ chọn
                      </button>
                    )}
                  </div>
                )}
              </div>
              {assignableEmployees.length === 0 ? (
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
                  Chưa có danh sách nhân sự hoặc đang tải…
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(min(100%, 210px), 1fr))',
                    gap: '8px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    padding: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                  }}
                >
                  {assignableEmployees.map((emp) => {
                    const isChecked = selectedAssigneeIds.includes(emp.id);
                    return (
                      <label
                        key={emp.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          borderRadius: '10px',
                          backgroundColor: isChecked
                            ? 'var(--primary-subtle)'
                            : 'var(--surface-subtle)',
                          border: isChecked
                            ? '1px solid var(--primary-color, #0f766e)'
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
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '12px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--primary-subtle)',
                            color: 'var(--accent-text)',
                          }}
                        >
                          {emp.employee_code}
                        </span>
                        <span
                          style={{
                            color: 'var(--text-color)',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {emp.full_name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <AppButton
                type="submit"
                variant="primary"
                className="work-primary-btn"
                disabled={submitting}
              >
                {submitting ? 'Đang tạo…' : 'Tạo & Giao việc'}
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                data-testid="btn-copy-work-zalo"
                disabled={!newTitle.trim()}
                onClick={() => {
                  const assigneeLabels = assignableEmployees
                    .filter((e) => selectedAssigneeIds.includes(e.id))
                    .map((e) => `${e.full_name} (${e.employee_code})`)
                    .join(', ');
                  const origin =
                    typeof window !== 'undefined' && window.location?.origin
                      ? window.location.origin
                      : 'https://ql.hoaiphuong.click';
                  const msg = [
                    `📋 [GIAO VIỆC MỚI] ${newTitle.trim()}`,
                    assigneeLabels ? `👤 Người nhận: ${assigneeLabels}` : '',
                    newDueAt
                      ? `⏰ Hạn hoàn thành: ${formatDateTimeDisplay(new Date(newDueAt).toISOString())}`
                      : '',
                    newDescription.trim()
                      ? `📝 Nội dung: ${newDescription.trim()}`
                      : '',
                    `🔗 Xem & báo cáo tiến độ tại: ${origin}/work`,
                  ]
                    .filter(Boolean)
                    .join('\n');
                  if (
                    typeof navigator !== 'undefined' &&
                    navigator.clipboard?.writeText
                  ) {
                    void navigator.clipboard.writeText(msg);
                  }
                  setSuccessMessage(
                    'Đã sao chép tin nhắn giao việc! Bạn có thể dán gửi vào Zalo ngay.',
                  );
                }}
              >
                💬 Copy tin gửi Zalo
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
          <LoadingState message="Đang tải chi tiết công việc…" />
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
    const detailDeadline = describeWorkDeadline(item.due_at, item.status);
    const parsedDetailDesc = parseWorkDescriptionChecklist(item.description);
    const checklistPct =
      parsedDetailDesc.totalCount > 0
        ? Math.round(
            (parsedDetailDesc.completedCount / parsedDetailDesc.totalCount) *
              100,
          )
        : 0;
    const detailAccentBorder = getWorkCardAccentBorder(
      item,
      detailDeadline.isOverdue,
    );

    const existingAssigneeSet = new Set(
      (item.assignments || []).map((a) => a.employee_id),
    );
    const availableExtraEmployees = employees
      .filter((emp, idx, arr) => {
        if (existingAssigneeSet.has(emp.id)) return false;
        if (emp.employee_code === 'ADMIN') {
          const hasAdm01 = arr.some((e) => e.employee_code === 'ADM01');
          if (hasAdm01) return false;
        }
        return arr.findIndex((e) => e.id === emp.id) === idx;
      })
      .sort((a, b) => a.employee_code.localeCompare(b.employee_code));

    const applyEditQuickDueAt = (
      preset: 'today_18' | 'tomorrow_12' | 'tomorrow_18' | 'plus_3d',
    ) => {
      const target = new Date();
      if (preset === 'today_18') {
        target.setHours(18, 0, 0, 0);
      } else if (preset === 'tomorrow_12') {
        target.setDate(target.getDate() + 1);
        target.setHours(12, 0, 0, 0);
      } else if (preset === 'tomorrow_18') {
        target.setDate(target.getDate() + 1);
        target.setHours(18, 0, 0, 0);
      } else {
        target.setDate(target.getDate() + 3);
        target.setHours(18, 0, 0, 0);
      }
      const pad = (n: number) => String(n).padStart(2, '0');
      setEditDueAt(
        `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`,
      );
    };

    return (
      <div
        className="work-page"
        style={{ maxWidth: '880px', margin: '0 auto', padding: '0' }}
      >
        {/* Top Action & Navigation Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <AppButton variant="secondary" onClick={() => onNavigate?.('/work')}>
            ← Quay lại danh sách
          </AppButton>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            {role === 'owner' && item.status !== 'cancelled' && (
              <AppButton
                type="button"
                variant="secondary"
                data-testid="btn-edit-work-item"
                disabled={submitting}
                onClick={() => openEditModal(item)}
              >
                ✎ Sửa việc / Gia hạn
              </AppButton>
            )}

            <AppButton
              type="button"
              variant="secondary"
              data-testid="btn-copy-detail-zalo"
              onClick={() => {
                const assigneeNames = (item.assignments || [])
                  .map(
                    (a) =>
                      `${a.full_name || 'Nhân viên'} (${a.employee_code || 'NV'})`,
                  )
                  .join(', ');
                const origin =
                  typeof window !== 'undefined' && window.location?.origin
                    ? window.location.origin
                    : 'https://ql.hoaiphuong.click';
                const checklistLines = parsedDetailDesc.checklistItems
                  .map((s) => `${s.checked ? '☑' : '☐'} ${s.text}`)
                  .join('\n');
                const msg = [
                  `📋 [CÔNG VIỆC] ${item.title}`,
                  `🔥 Ưu tiên: ${getPriorityBadgeText(item.priority)}`,
                  item.due_at
                    ? `⏰ Hạn hoàn thành: ${formatDateTimeDisplay(item.due_at)}`
                    : '',
                  assigneeNames ? `👤 Phụ trách: ${assigneeNames}` : '',
                  checklistLines ? `📝 Các bước:\n${checklistLines}` : '',
                  parsedDetailDesc.cleanNotes
                    ? `💡 Ghi chú: ${parsedDetailDesc.cleanNotes}`
                    : '',
                  `🔗 Xem chi tiết: ${origin}/work/${item.id}`,
                ]
                  .filter(Boolean)
                  .join('\n');
                if (
                  typeof navigator !== 'undefined' &&
                  navigator.clipboard?.writeText
                ) {
                  void navigator.clipboard.writeText(msg);
                }
                setSuccessMessage(
                  'Đã sao chép nội dung công việc để dán gửi qua Zalo!',
                );
              }}
            >
              💬 Copy Zalo
            </AppButton>

            {role === 'owner' &&
              item.status !== 'completed' &&
              item.status !== 'cancelled' && (
                <AppButton
                  variant="primary"
                  disabled={submitting}
                  onClick={() => handleOwnerQuickComplete(item)}
                >
                  ✓ Hoàn thành
                </AppButton>
              )}

            {role === 'owner' && item.status !== 'cancelled' && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowCancelModal(true)}
                style={{
                  minHeight: '38px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.38)',
                  backgroundColor: 'transparent',
                  color: 'var(--danger-text)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                Hủy công việc
              </button>
            )}
          </div>
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

        {/* Main Work Summary & Checklist Card */}
        <AppCard
          className="work-flat-card"
          style={{
            padding: '24px',
            borderLeft: `4px solid ${detailAccentBorder}`,
          }}
        >
          {/* Category & Sync Pills + Title */}
          <div style={{ marginBottom: '16px' }}>
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
                  padding: '3px 9px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(56, 189, 248, 0.14)',
                  color: 'var(--info-text)',
                }}
              >
                {getWorkTypeLabel(item.work_type)}
              </span>
              {isAtlasSyncedWorkItem(item.description) && (
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--primary-subtle)',
                    color: 'var(--accent-text)',
                  }}
                >
                  🔗 Đồng bộ 2 chiều AI Work Atlas
                </span>
              )}
              {isItemBlocked(item) && (
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--warning-subtle)',
                    color: 'var(--warning-text)',
                  }}
                >
                  ⛔ Cần sửa / Bị chặn
                </span>
              )}
            </div>
            <h2
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: 'var(--text-color)',
                margin: 0,
                lineHeight: 1.35,
                textDecoration:
                  item.status === 'cancelled' ? 'line-through' : 'none',
              }}
            >
              {item.title}
            </h2>
          </div>

          {/* 4-Column Key Metadata Summary Grid */}
          <div
            data-testid="work-detail-summary-grid"
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 175px), 1fr))',
              gap: '10px',
              padding: '12px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-subtle)',
              marginBottom:
                parsedDetailDesc.totalCount > 0 ||
                Boolean(parsedDetailDesc.cleanNotes) ||
                (role === 'owner' && item.status !== 'cancelled')
                  ? '18px'
                  : '0',
            }}
          >
            {/* Col 1: Status */}
            <div style={{ padding: '4px 6px' }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Trạng thái hiện tại
              </div>
              <div>{getWorkItemStatusBadge(item.status)}</div>
            </div>

            {/* Col 2: Priority */}
            <div style={{ padding: '4px 6px' }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Mức độ ưu tiên
              </div>
              <div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: '999px',
                    backgroundColor: getPriorityBg(item.priority),
                    color: getPriorityColor(item.priority),
                  }}
                >
                  {getPriorityBadgeText(item.priority)}
                </span>
              </div>
            </div>

            {/* Col 3: Deadline */}
            <div style={{ padding: '4px 6px' }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Hạn hoàn thành
              </div>
              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 700,
                  color: detailDeadline.isOverdue
                    ? 'var(--danger-text)'
                    : detailDeadline.isToday
                      ? 'var(--warning-text)'
                      : 'var(--text-color)',
                }}
              >
                {detailDeadline.formattedDateTime}
              </div>
              {detailDeadline.relativeLabel && (
                <div
                  style={{
                    fontSize: '12px',
                    marginTop: '2px',
                    fontWeight: detailDeadline.isOverdue ? 700 : 500,
                    color: detailDeadline.isOverdue
                      ? 'var(--danger-text)'
                      : detailDeadline.isToday
                        ? 'var(--warning-text)'
                        : 'var(--muted-color)',
                  }}
                >
                  {detailDeadline.isOverdue ? '⚠️ ' : ''}
                  {detailDeadline.relativeLabel}
                </div>
              )}
            </div>

            {/* Col 4: Assignees */}
            <div style={{ padding: '4px 6px' }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Người phụ trách
              </div>
              {item.assignments && item.assignments.length > 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  {item.assignments.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-color)',
                      }}
                    >
                      {a.full_name || 'Nhân viên'}{' '}
                      <span
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                          fontWeight: 500,
                        }}
                      >
                        ({a.employee_code || 'NV'})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Chưa phân công
                </div>
              )}
            </div>
          </div>

          {/* Interactive Checklist Section */}
          {(parsedDetailDesc.totalCount > 0 ||
            (role === 'owner' && item.status !== 'cancelled')) && (
            <div
              data-testid="work-detail-checklist"
              style={{
                marginBottom: parsedDetailDesc.cleanNotes ? '16px' : '0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                  }}
                >
                  Các bước thực hiện
                </span>
                {parsedDetailDesc.totalCount > 0 && (
                  <span
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 700,
                      color:
                        parsedDetailDesc.completedCount ===
                        parsedDetailDesc.totalCount
                          ? 'var(--success-text)'
                          : 'var(--accent-text)',
                    }}
                  >
                    Đã xong {parsedDetailDesc.completedCount}/
                    {parsedDetailDesc.totalCount} bước ({checklistPct}%)
                  </span>
                )}
              </div>

              {parsedDetailDesc.totalCount > 0 && (
                <>
                  {/* Progress Bar */}
                  <div
                    style={{
                      width: '100%',
                      height: '7px',
                      borderRadius: '999px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        width: `${checklistPct}%`,
                        height: '100%',
                        borderRadius: '999px',
                        backgroundColor:
                          checklistPct === 100
                            ? '#10B981'
                            : 'var(--primary-color, #0f766e)',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>

                  {/* Checklist Items */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      marginBottom:
                        role === 'owner' && item.status !== 'cancelled'
                          ? '10px'
                          : '0',
                    }}
                  >
                    {parsedDetailDesc.checklistItems.map((step) => {
                      const canToggleStep =
                        role === 'owner' && item.status !== 'cancelled';
                      return (
                        <button
                          key={`${step.index}-${step.lineIndex}`}
                          type="button"
                          role="checkbox"
                          aria-checked={step.checked}
                          aria-label={step.text}
                          disabled={!canToggleStep || submitting}
                          onClick={() =>
                            handleToggleChecklistStep(
                              item,
                              step.index,
                              !step.checked,
                            )
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: step.checked
                              ? '1px solid rgba(16, 185, 129, 0.35)'
                              : '1px solid var(--border-subtle)',
                            backgroundColor: step.checked
                              ? 'rgba(16, 185, 129, 0.08)'
                              : 'var(--bg-color)',
                            cursor: canToggleStep ? 'pointer' : 'default',
                            transition:
                              'background-color 0.15s ease, border-color 0.15s ease',
                          }}
                        >
                          <span
                            style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '6px',
                              flexShrink: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 700,
                              backgroundColor: step.checked
                                ? '#10B981'
                                : 'transparent',
                              border: step.checked
                                ? '2px solid #10B981'
                                : '2px solid var(--muted-color)',
                              color: '#FFFFFF',
                            }}
                          >
                            {step.checked ? '✓' : ''}
                          </span>
                          <span
                            style={{
                              fontSize: '14px',
                              fontWeight: step.checked ? 500 : 600,
                              color: step.checked
                                ? 'var(--muted-color)'
                                : 'var(--text-color)',
                              textDecoration: step.checked
                                ? 'line-through'
                                : 'none',
                              lineHeight: 1.45,
                            }}
                          >
                            {step.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Quick Add Checklist Step (Owner only) */}
              {role === 'owner' && item.status !== 'cancelled' && (
                <form
                  onSubmit={handleAddChecklistStep}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="text"
                    aria-label="Thêm bước thực hiện mới"
                    value={newStepText}
                    onChange={(e) => setNewStepText(e.target.value)}
                    placeholder="+ Nhập thêm bước cần làm rồi nhấn Enter…"
                    style={{
                      flex: '1 1 220px',
                      minHeight: '38px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px dashed var(--border-color)',
                      backgroundColor: 'var(--bg-color)',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                  {newStepText.trim() && (
                    <AppButton
                      type="submit"
                      variant="secondary"
                      disabled={submitting}
                    >
                      + Thêm bước
                    </AppButton>
                  )}
                </form>
              )}
            </div>
          )}

          {/* Clean Plain Notes / Instructions */}
          {parsedDetailDesc.cleanNotes && (
            <div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Mô tả & Yêu cầu chi tiết
              </div>
              <div
                style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.65,
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {parsedDetailDesc.cleanNotes}
              </div>
            </div>
          )}
        </AppCard>

        {/* Section: Assignments & Progress */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '12px',
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
            Người thực hiện & Báo cáo kết quả (
            {item.assignments ? item.assignments.length : 0})
          </h3>
          {role === 'owner' &&
            item.status !== 'cancelled' &&
            availableExtraEmployees.length > 0 && (
              <button
                type="button"
                onClick={() => openEditModal(item)}
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '999px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-subtle)',
                  color: 'var(--accent-text)',
                  cursor: 'pointer',
                }}
              >
                + Giao thêm nhân viên
              </button>
            )}
        </div>

        {(!item.assignments || item.assignments.length === 0) && (
          <AppCard
            className="work-flat-card"
            style={{ padding: '24px', textAlign: 'center' }}
          >
            <p
              style={{
                color: 'var(--muted-color)',
                fontSize: '14px',
                margin: '0 0 12px 0',
              }}
            >
              Công việc này chưa được phân công cho nhân viên nào.
            </p>
            {role === 'owner' && item.status !== 'cancelled' && (
              <AppButton
                variant="secondary"
                onClick={() => openEditModal(item)}
              >
                + Chọn nhân viên phụ trách
              </AppButton>
            )}
          </AppCard>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
            const hasScheduleLinks =
              (assignment.schedule_links || []).length > 0;
            const isScheduleExpanded =
              hasScheduleLinks || Boolean(showScheduleLinkerMap[assignment.id]);

            return (
              <AppCard
                key={assignment.id}
                className="work-flat-card"
                style={{ padding: '18px 20px' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    marginBottom:
                      hasValidSubmission ||
                      assignment.latest_review?.decision ===
                        'request_changes' ||
                      isScheduleExpanded ||
                      canStart ||
                      canSubmit ||
                      canReview ||
                      (role === 'owner' &&
                        item.status !== 'completed' &&
                        item.status !== 'cancelled')
                        ? '12px'
                        : '0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--primary-subtle)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-text)',
                        fontSize: '13px',
                        fontWeight: 700,
                      }}
                    >
                      {getAssigneeInitials(
                        assignment.full_name,
                        assignment.employee_code,
                      )}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          color: 'var(--text-color)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>{assignment.full_name || 'Nhân viên'}</span>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--surface-hover)',
                            color: 'var(--muted-color)',
                          }}
                        >
                          {assignment.employee_code || 'NV'}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                          marginTop: '2px',
                        }}
                      >
                        Giao lúc:{' '}
                        {formatDateTimeDisplay(assignment.assigned_at)}
                      </div>
                    </div>
                  </div>
                  <div>{getAssignmentStatusBadge(assignment.status)}</div>
                </div>

                {/* Latest Review Feedback if changes requested */}
                {assignment.latest_review &&
                  assignment.latest_review.decision === 'request_changes' && (
                    <div
                      style={{
                        padding: '12px 14px',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '8px',
                        color: 'var(--warning-text)',
                        fontSize: '13px',
                        marginBottom: '12px',
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
                        <span>Yêu cầu chỉnh sửa lại:</span>
                      </div>
                      <div
                        style={{ marginTop: '4px', color: 'var(--text-color)' }}
                      >
                        {assignment.latest_review.feedback}
                      </div>
                    </div>
                  )}

                {/* Submissions list */}
                {assignment.submissions &&
                  assignment.submissions.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <div
                        style={{
                          fontSize: '12.5px',
                          fontWeight: 600,
                          color: 'var(--muted-color)',
                          marginBottom: '6px',
                        }}
                      >
                        Báo cáo kết quả đã nộp ({assignment.submissions.length}{' '}
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
                              backgroundColor: 'var(--bg-color)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '8px',
                              fontSize: '13px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                color: 'var(--muted-color)',
                                fontSize: '12px',
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

                {/* Optional Schedule Shift Linker (collapsed unless used or toggled) */}
                {isScheduleExpanded ? (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      marginBottom:
                        canStart || canSubmit || canReview ? '12px' : '0',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <strong style={{ fontSize: '12.5px' }}>
                        Ca trực thực hiện trong tuần
                      </strong>
                      {!hasScheduleLinks && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowScheduleLinkerMap((prev) => ({
                              ...prev,
                              [assignment.id]: false,
                            }))
                          }
                          style={{
                            fontSize: '12px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--muted-color)',
                            cursor: 'pointer',
                          }}
                        >
                          Ẩn ▴
                        </button>
                      )}
                    </div>
                    {(assignment.schedule_links || []).map((link) => (
                      <div
                        key={link.work_date}
                        style={{
                          display: 'flex',
                          gap: '10px',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          marginTop: '8px',
                        }}
                      >
                        <a
                          href="/schedule"
                          onClick={(e) => {
                            if (onNavigate) {
                              e.preventDefault();
                              onNavigate('/schedule');
                            }
                          }}
                          style={{ color: 'var(--accent-text)' }}
                        >
                          {link.work_date} · {link.start_time} ·{' '}
                          {link.status === 'registered'
                            ? 'Ca đã đăng ký'
                            : 'Lịch đã hủy'}
                        </a>
                        {role === 'owner' &&
                          item.status !== 'completed' &&
                          item.status !== 'cancelled' && (
                            <AppButton
                              variant="secondary"
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
                            gap: '8px',
                            flexWrap: 'wrap',
                            marginTop: '8px',
                          }}
                        >
                          <input
                            aria-label={`Ngày xếp việc ${assignment.full_name || assignment.employee_id}`}
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            style={{
                              minHeight: '36px',
                              padding: '0 10px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--surface-subtle)',
                              color: 'var(--text-color)',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          />
                          <AppButton
                            variant="secondary"
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
                ) : null}

                {/* Actions per assignment */}
                {(canStart ||
                  canSubmit ||
                  canReview ||
                  (role === 'owner' &&
                    item.status !== 'completed' &&
                    item.status !== 'cancelled' &&
                    !isScheduleExpanded)) && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      paddingTop: '10px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
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

                    {role === 'owner' &&
                      item.status !== 'completed' &&
                      item.status !== 'cancelled' &&
                      !isScheduleExpanded && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowScheduleLinkerMap((prev) => ({
                              ...prev,
                              [assignment.id]: true,
                            }))
                          }
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px dashed var(--border-color)',
                            backgroundColor: 'transparent',
                            color: 'var(--muted-color)',
                            cursor: 'pointer',
                          }}
                        >
                          📅 + Gắn vào ca trực (tùy chọn)
                        </button>
                      )}
                  </div>
                )}
              </AppCard>
            );
          })}
        </div>

        {/* Modal: Owner Edit / Reschedule Work Item */}
        {showEditModal && (
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
                maxWidth: '580px',
                width: '100%',
                maxHeight: '90dvh',
                overflowY: 'auto',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '22px 24px',
              }}
            >
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                  marginTop: 0,
                  marginBottom: '14px',
                }}
              >
                Chỉnh sửa công việc & Gia hạn
              </h3>
              <form onSubmit={handleSaveEditWorkItem}>
                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Tiêu đề công việc{' '}
                    <span style={{ color: 'var(--danger-text)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    aria-label="Tiêu đề công việc"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    maxLength={200}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                    gap: '12px',
                    marginBottom: '14px',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-color)',
                        marginBottom: '6px',
                      }}
                    >
                      Mức độ ưu tiên
                    </label>
                    <select
                      aria-label="Mức độ ưu tiên công việc"
                      value={editPriority}
                      onChange={(e) =>
                        setEditPriority(e.target.value as WorkPriority)
                      }
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        color: 'var(--text-color)',
                        fontSize: '14px',
                        outline: 'none',
                      }}
                    >
                      <option value="urgent">P1 · Khẩn cấp (Làm ngay)</option>
                      <option value="high">P2 · Cao</option>
                      <option value="medium">P3 · Bình thường</option>
                      <option value="low">P4 · Thấp</option>
                    </select>
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-color)',
                        marginBottom: '6px',
                      }}
                    >
                      Phân loại
                    </label>
                    <select
                      aria-label="Phân loại công việc"
                      value={editWorkType}
                      onChange={(e) =>
                        setEditWorkType(e.target.value as WorkType)
                      }
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        color: 'var(--text-color)',
                        fontSize: '14px',
                        outline: 'none',
                      }}
                    >
                      <option value="general">
                        Việc chung / Vận hành kênh
                      </option>
                      <option value="video">Dựng video</option>
                      <option value="content">Kịch bản / Nội dung</option>
                      <option value="design">Thiết kế ảnh / Thumbnail</option>
                      <option value="other">Khác</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginBottom: '6px',
                    }}
                  >
                    <label
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-color)',
                      }}
                    >
                      Hạn hoàn thành
                    </label>
                    <div
                      style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
                    >
                      {[
                        { id: 'today_18' as const, label: 'Hôm nay 18:00' },
                        { id: 'tomorrow_12' as const, label: 'Trưa mai 12:00' },
                        {
                          id: 'tomorrow_18' as const,
                          label: 'Chiều mai 18:00',
                        },
                        { id: 'plus_3d' as const, label: '+3 ngày' },
                      ].map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => applyEditQuickDueAt(chip.id)}
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: 'var(--bg-color)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--accent-text)',
                            cursor: 'pointer',
                          }}
                        >
                          {chip.label}
                        </button>
                      ))}
                      {editDueAt && (
                        <button
                          type="button"
                          onClick={() => setEditDueAt('')}
                          style={{
                            fontSize: '12px',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: 'transparent',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--muted-color)',
                            cursor: 'pointer',
                          }}
                        >
                          Xóa hạn
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="datetime-local"
                    aria-label="Chỉnh sửa hạn hoàn thành"
                    value={editDueAt}
                    onChange={(e) => setEditDueAt(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Các bước thực hiện (`- [ ] Bước 1`) & Ghi chú
                  </label>
                  <textarea
                    aria-label="Mô tả và các bước thực hiện"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={5}
                    placeholder="- [ ] Bước 1&#10;- [ ] Bước 2&#10;Ghi chú thêm…"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      color: 'var(--text-color)',
                      fontSize: '13.5px',
                      lineHeight: 1.5,
                      outline: 'none',
                      resize: 'vertical',
                    }}
                  />
                </div>

                {availableExtraEmployees.length > 0 && (
                  <div style={{ marginBottom: '18px' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-color)',
                        marginBottom: '6px',
                      }}
                    >
                      Giao thêm nhân viên phụ trách (tùy chọn)
                    </label>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
                        gap: '8px',
                        maxHeight: '150px',
                        overflowY: 'auto',
                        padding: '8px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                      }}
                    >
                      {availableExtraEmployees.map((emp) => {
                        const checked = editAdditionalAssigneeIds.includes(
                          emp.id,
                        );
                        return (
                          <label
                            key={emp.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              backgroundColor: checked
                                ? 'rgba(20, 184, 166, 0.14)'
                                : 'var(--surface-subtle)',
                              border: checked
                                ? '1px solid #14B8A6'
                                : '1px solid var(--border-subtle)',
                              fontSize: '13px',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditAdditionalAssigneeIds([
                                    ...editAdditionalAssigneeIds,
                                    emp.id,
                                  ]);
                                } else {
                                  setEditAdditionalAssigneeIds(
                                    editAdditionalAssigneeIds.filter(
                                      (id) => id !== emp.id,
                                    ),
                                  );
                                }
                              }}
                            />
                            <span style={{ fontWeight: 700, fontSize: '12px' }}>
                              {emp.employee_code}
                            </span>
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {emp.full_name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

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
                    onClick={() => setShowEditModal(false)}
                  >
                    Đóng
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Đang lưu…' : 'Lưu thay đổi'}
                  </AppButton>
                </div>
              </form>
            </div>
          </div>
        )}

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
                    placeholder="Mô tả kết quả đã làm, số lượng hoàn thành, các vấn đề gặp phải…"
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
                    {submitting ? 'Đang gửi…' : 'Gửi báo cáo'}
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
                        : 'Nêu rõ điểm chưa đạt, yêu cầu sửa đổi cụ thể…'
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
                    {submitting ? 'Đang xử lý…' : 'Xác nhận'}
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
                    placeholder="Nhập lý do hủy công việc…"
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
                    {submitting ? 'Đang hủy…' : 'Xác nhận hủy'}
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
    <div className="work-page" style={{ width: '100%' }}>
      {/* Page Header */}
      <PageHeader
        title="Quản lý công việc"
        subtitle={
          role === 'owner'
            ? 'Giao việc, theo dõi tiến độ và nghiệm thu kết quả cửa hàng'
            : 'Danh sách nhiệm vụ & công việc được phân công cho bạn'
        }
        actions={
          role === 'owner' ? (
            <AppButton
              variant="primary"
              className="work-primary-btn"
              onClick={() => onNavigate?.('/work/new')}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <PlusIcon size={18} />
              <span>Giao việc mới</span>
            </AppButton>
          ) : undefined
        }
      />

      {/* Backend API Unavailable Notice */}
      {apiUnavailable && (
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '16px',
            color: 'var(--info-text)',
            fontSize: '13px',
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
        <div>
          <ErrorState message={errorMessage} onRetry={fetchData} />
        </div>
      )}

      {/* Success Notice (List View) */}
      {successMessage && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '16px',
            color: 'var(--success-text)',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircleIcon size={18} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Clickable 4-KPI Status Strip */}
      <div
        className="kpi-grid-4 work-kpi-strip"
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
          gap: '16px',
        }}
      >
        {(
          [
            {
              key: 'todo',
              label: 'CẦN LÀM',
              count: kpiStats.todo,
              accent: '#64748B',
              textColor: 'var(--text-color)',
              labelColor: 'var(--muted-color)',
            },
            {
              key: 'in_progress',
              label: 'ĐANG LÀM',
              count: kpiStats.inProgress,
              accent: '#0F766E',
              textColor: 'var(--accent-text)',
              labelColor: 'var(--accent-text)',
            },
            {
              key: 'in_review',
              label: 'CHỜ DUYỆT',
              count: kpiStats.inReview,
              accent: '#F59E0B',
              textColor: 'var(--warning-text)',
              labelColor: 'var(--warning-text)',
            },
            {
              key: 'completed',
              label: 'HOÀN THÀNH',
              count: kpiStats.completed,
              accent: '#10B981',
              textColor: 'var(--success-text)',
              labelColor: 'var(--success-text)',
            },
          ] as const
        ).map((kpi) => {
          const isSelected = statusFilter === kpi.key;
          return (
            <button
              key={kpi.key}
              type="button"
              className="work-kpi-card"
              onClick={() => {
                setStatusFilter((prev) => (prev === kpi.key ? 'all' : kpi.key));
                setSmartFocusFilter('all');
                setListPage(0);
              }}
              style={{
                textAlign: 'left',
                padding: '16px 18px',
                borderRadius: '16px',
                backgroundColor: isSelected
                  ? `${kpi.accent}14`
                  : 'var(--surface-color)',
                border: isSelected
                  ? `1.5px solid ${kpi.accent}`
                  : '1px solid var(--border-subtle)',
                borderLeft: `4px solid ${kpi.accent}`,
                boxShadow: 'none',
                cursor: 'pointer',
                transition:
                  'background-color 0.15s ease, border-color 0.15s ease',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: kpi.labelColor,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                }}
              >
                {kpi.label}
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 800,
                  color: kpi.textColor,
                  marginTop: '4px',
                  lineHeight: 1.2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {kpi.count}
              </div>
            </button>
          );
        })}
      </div>

      {/* Read-Only Schedule Banner — ONLY shown when shifts exist this week */}
      {scheduleEntries.length > 0 && (
        <AppCard
          className="work-flat-card"
          style={{
            padding: '14px 18px',
            backgroundColor: 'var(--surface-color)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '16px',
            boxShadow: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                fontSize: '13px',
              }}
            >
              <CalendarIcon size={16} color="#0284C7" />
              <span style={{ fontWeight: 700, color: 'var(--text-color)' }}>
                Lịch trực tuần này ({scheduleEntries.length} ca):
              </span>
              {(() => {
                const todayShift = scheduleEntries.find(
                  (e) => e.work_date === todayVnDateStr,
                );
                return todayShift ? (
                  <span style={{ color: 'var(--info-text)', fontWeight: 600 }}>
                    Hôm nay bắt đầu lúc {todayShift.start_time}
                    {todayShift.notes ? ` — ${todayShift.notes}` : ''}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted-color)' }}>
                    Hôm nay không có ca trực
                  </span>
                );
              })()}
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
                Xem lịch →
              </AppButton>
            )}
          </div>
        </AppCard>
      )}

      {/* Unified Focus, Search, Filter & Smart Sort Control Card */}
      <AppCard
        className="work-flat-card"
        style={{
          padding: '16px 18px',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          boxShadow: 'none',
        }}
      >
        {/* Top Row: Quick Focus Chips + Sort Selector */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            paddingBottom: '12px',
            marginBottom: '12px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div
            data-testid="work-ml04-focus-bar"
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              overflowX: 'auto',
              gap: '8px',
              alignItems: 'center',
              scrollbarWidth: 'none',
              maxWidth: '100%',
            }}
          >
            {(
              [
                {
                  key: 'all',
                  label: `Đang mở (${Math.max(0, kpiStats.todo + kpiStats.inProgress + kpiStats.inReview)})`,
                  activeColor: '#0284C7',
                  textColor: 'var(--info-text)',
                },
                {
                  key: 'today',
                  label: `⏰ Hôm nay (${kpiStats.todayCount})`,
                  activeColor: '#0F766E',
                  textColor: 'var(--accent-text)',
                },
                {
                  key: 'overdue',
                  label: `⚠️ Quá hạn (${kpiStats.overdueCount})`,
                  activeColor: '#EF4444',
                  textColor: 'var(--danger-text)',
                },
                {
                  key: 'blocked',
                  label: `⛔ Cần sửa (${kpiStats.blockedCount})`,
                  activeColor: '#F97316',
                  textColor: 'var(--warning-text)',
                },
                {
                  key: 'pending_review',
                  label: `⏳ Chờ duyệt (${kpiStats.inReview})`,
                  activeColor: '#F59E0B',
                  textColor: 'var(--warning-text)',
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
                    if (chip.key !== 'all' && statusFilter === 'completed') {
                      setStatusFilter('all');
                    }
                    setListPage(0);
                  }}
                  style={{
                    minHeight: '38px',
                    padding: '6px 14px',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    cursor: 'pointer',
                    backgroundColor: isActive
                      ? `${chip.activeColor}18`
                      : 'var(--bg-color)',
                    border: isActive
                      ? `1px solid ${chip.activeColor}`
                      : '1px solid var(--border-subtle)',
                    color: isActive ? chip.textColor : 'var(--text-secondary)',
                    transition:
                      'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              data-testid="work-sort-select"
              aria-label="Sắp xếp thứ tự công việc"
              value={sortMode}
              onChange={(e) => {
                setSortMode(e.target.value as WorkSortMode);
                setListPage(0);
              }}
              style={{
                minHeight: '38px',
                padding: '6px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                color: 'var(--text-color)',
                fontSize: '13px',
                fontWeight: 600,
                outline: 'none',
              }}
            >
              <option value="smart">⚡ Thứ tự: Khẩn & Gần hạn trước</option>
              <option value="due_asc">📅 Thứ tự: Hạn chót gần nhất</option>
              <option value="priority_desc">
                🔥 Thứ tự: Ưu tiên (P1 → P4)
              </option>
              <option value="newest">🕒 Thứ tự: Mới giao gần đây</option>
            </select>
          </div>
        </div>

        {/* Bottom Row: Search + Dropdown Filters */}
        <div
          className="work-filter-grid"
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
            gap: '10px',
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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setListPage(0);
              }}
              placeholder="Tìm tên việc, nội dung…"
              style={{
                width: '100%',
                minHeight: '42px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
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
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setListPage(0);
              }}
              style={{
                width: '100%',
                minHeight: '42px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                color: 'var(--text-color)',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              <option value="all">Trạng thái: Đang mở (Mặc định)</option>
              <option value="todo">Cần làm (Chưa bắt đầu)</option>
              <option value="in_progress">Đang làm</option>
              <option value="in_review">Chờ duyệt</option>
              <option value="completed">Đã hoàn thành</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>

          {/* Priority filter */}
          <div>
            <select
              data-testid="work-priority-filter"
              aria-label="Lọc theo độ ưu tiên"
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value);
                setListPage(0);
              }}
              style={{
                width: '100%',
                minHeight: '42px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                color: 'var(--text-color)',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              <option value="all">Tất cả mức ưu tiên</option>
              <option value="urgent">P1 · Khẩn cấp</option>
              <option value="high">P2 · Cao</option>
              <option value="medium">P3 · Bình thường</option>
              <option value="low">P4 · Thấp</option>
            </select>
          </div>

          {/* Assignee filter (Owner only) */}
          {role === 'owner' && (
            <div>
              <select
                data-testid="work-assignee-filter"
                aria-label="Lọc theo nhân sự"
                value={assigneeFilter}
                onChange={(e) => {
                  setAssigneeFilter(e.target.value);
                  setListPage(0);
                }}
                style={{
                  width: '100%',
                  minHeight: '42px',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
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

      {/* Work Items List (Grouped into Attention / Active / Closed) */}
      {loading ? (
        <LoadingState message="Đang tải danh sách công việc…" />
      ) : workItems.length === 0 ? (
        <AppCard className="work-flat-card" style={{ padding: '32px' }}>
          <EmptyState
            title="Chưa có công việc nào"
            description={
              role === 'owner'
                ? 'Hãy bấm nút "Giao việc mới" để tạo công việc đầu tiên cho nhân viên.'
                : 'Hiện tại bạn chưa được phân công công việc nào.'
            }
          />
        </AppCard>
      ) : sortedMatchingItems.length === 0 ? (
        <AppCard
          className="work-flat-card"
          style={{ padding: '32px' }}
          data-testid="work-empty-search"
        >
          <EmptyState
            title="Không tìm thấy công việc phù hợp"
            description="Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái/ưu tiên."
          />
        </AppCard>
      ) : filteredItems.length === 0 && hiddenClosedCount > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <AppCard
            className="work-flat-card"
            style={{
              padding: '28px 20px',
              textAlign: 'center',
              borderLeft: '4px solid #10B981',
            }}
          >
            <CheckCircleIcon size={34} color="#10B981" />
            <h3
              style={{
                fontSize: '17px',
                fontWeight: 700,
                color: 'var(--text-color)',
                margin: '10px 0 4px 0',
              }}
            >
              Không còn công việc nào đang tồn đọng!
            </h3>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--muted-color)',
                margin: '0 0 14px 0',
              }}
            >
              Toàn bộ công việc đã hoàn thành hoặc đóng gọn trong lịch sử bên
              dưới.
            </p>
            <AppButton
              variant="secondary"
              data-testid="work-toggle-closed-section"
              onClick={() => setShowClosedSection(true)}
            >
              ✓ Xem {hiddenClosedCount} công việc đã hoàn thành / đã đóng ▾
            </AppButton>
          </AppCard>
        </div>
      ) : (
        <div
          className="work-section-group"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {pagedItems.map((item, idx) => {
            const section: WorkSectionKey = classifyWorkSection(item);
            const prevSection: WorkSectionKey | null =
              idx > 0 ? classifyWorkSection(pagedItems[idx - 1]!) : null;
            const showSectionHeader = section !== prevSection;

            const sectionMeta: Record<
              WorkSectionKey,
              {
                title: string;
                hint: string;
                dotColor: string;
                count: number;
              }
            > = {
              attention: {
                title: 'Cần xử lý ngay',
                hint: 'Quá hạn · Khẩn cấp (P1) · Chờ duyệt · Cần sửa',
                dotColor: '#EF4444',
                count: filteredItems.filter(
                  (x) => classifyWorkSection(x) === 'attention',
                ).length,
              },
              active: {
                title: 'Đang thực hiện & Kế hoạch',
                hint: 'Sắp xếp theo hạn hoàn thành & mức ưu tiên',
                dotColor: '#0284C7',
                count: filteredItems.filter(
                  (x) => classifyWorkSection(x) === 'active',
                ).length,
              },
              closed: {
                title: 'Đã hoàn thành & Đã đóng',
                hint: 'Lịch sử công việc đã hoàn tất',
                dotColor: '#10B981',
                count: totalClosedMatchingCount,
              },
            };

            const deadline = describeWorkDeadline(item.due_at, item.status);
            const parsedDesc = parseWorkDescriptionChecklist(item.description);
            const isClosed =
              item.status === 'completed' || item.status === 'cancelled';
            const cardBorderColor = getWorkCardAccentBorder(
              item,
              deadline.isOverdue,
            );

            return (
              <React.Fragment key={item.id}>
                {showSectionHeader && (
                  <div
                    data-testid={`work-section-${section}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                      marginTop: idx === 0 ? '0px' : '16px',
                      padding: '4px 4px 2px 4px',
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
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '5px',
                          backgroundColor: sectionMeta[section].dotColor,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          color: 'var(--text-color)',
                        }}
                      >
                        {sectionMeta[section].title} (
                        {sectionMeta[section].count})
                      </span>
                      <span
                        className="mobile-hide-label"
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                        }}
                      >
                        — {sectionMeta[section].hint}
                      </span>
                    </div>
                    {section === 'closed' &&
                      !isExplicitClosedView &&
                      showClosedSection && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowClosedSection(false);
                            setListPage(0);
                          }}
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            padding: '4px 12px',
                            borderRadius: '999px',
                            backgroundColor: 'var(--surface-color)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--muted-color)',
                            cursor: 'pointer',
                          }}
                        >
                          Thu gọn lịch sử ▴
                        </button>
                      )}
                  </div>
                )}

                <div
                  className="work-item-card"
                  onClick={() => onNavigate?.(`/work/${item.id}`)}
                  style={{
                    backgroundColor: 'var(--surface-color)',
                    border: '1px solid var(--border-subtle)',
                    borderLeft: `4px solid ${cardBorderColor}`,
                    borderRadius: '16px',
                    boxShadow: 'none',
                    minHeight: '64px',
                    padding: '16px',
                    cursor: 'pointer',
                    opacity: isClosed ? 0.76 : 1,
                    transition:
                      'background-color 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  {/* Top Row: Quick Complete Circle + Title + Status Badge & View Button */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        flex: '1 1 0%',
                        minWidth: 0,
                      }}
                    >
                      {role === 'owner' && item.status !== 'cancelled' && (
                        <button
                          type="button"
                          aria-label={
                            item.status === 'completed'
                              ? `Đã hoàn thành ${item.title}`
                              : `Đánh dấu hoàn thành ${item.title}`
                          }
                          title={
                            item.status === 'completed'
                              ? 'Đã hoàn thành'
                              : 'Bấm để đánh dấu hoàn thành nhanh'
                          }
                          disabled={submitting || item.status === 'completed'}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.status !== 'completed') {
                              void handleOwnerQuickComplete(item);
                            }
                          }}
                          style={{
                            width: '22px',
                            height: '22px',
                            marginTop: '1px',
                            borderRadius: '50%',
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            fontWeight: 700,
                            backgroundColor:
                              item.status === 'completed'
                                ? '#10B981'
                                : 'transparent',
                            border:
                              item.status === 'completed'
                                ? '2px solid #10B981'
                                : '2px solid var(--muted-color)',
                            color: '#FFFFFF',
                            cursor:
                              item.status === 'completed'
                                ? 'default'
                                : 'pointer',
                          }}
                        >
                          {item.status === 'completed' ? '✓' : ''}
                        </button>
                      )}

                      <div style={{ flex: '1 1 0%', minWidth: 0 }}>
                        <h4
                          style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            color: isClosed
                              ? 'var(--muted-color)'
                              : 'var(--text-color)',
                            textDecoration: isClosed ? 'line-through' : 'none',
                            margin: '0 0 6px 0',
                            lineHeight: 1.35,
                          }}
                        >
                          {item.title}
                        </h4>

                        {/* Metadata Pills Row: Priority + Smart Deadline + Checklist Progress + Category */}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                            alignItems: 'center',
                          }}
                        >
                          {/* Priority Pill */}
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '999px',
                              backgroundColor: getPriorityBg(item.priority),
                              color: getPriorityColor(item.priority),
                            }}
                          >
                            {getPriorityBadgeText(item.priority)}
                          </span>

                          {/* Smart Deadline Pill */}
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight:
                                deadline.isOverdue || deadline.isToday
                                  ? 700
                                  : 500,
                              fontVariantNumeric: 'tabular-nums',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              backgroundColor: deadline.isOverdue
                                ? 'rgba(239, 68, 68, 0.12)'
                                : deadline.isToday
                                  ? 'rgba(245, 158, 11, 0.12)'
                                  : 'var(--bg-color)',
                              color: deadline.isOverdue
                                ? 'var(--danger-text)'
                                : deadline.isToday
                                  ? 'var(--warning-text)'
                                  : 'var(--muted-color)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <CalendarIcon size={12} />
                            <span>{deadline.shortLabel}</span>
                          </span>

                          {/* Checklist Mini Progress Pill */}
                          {parsedDesc.totalCount > 0 && (
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '999px',
                                backgroundColor:
                                  parsedDesc.completedCount ===
                                  parsedDesc.totalCount
                                    ? 'rgba(16, 185, 129, 0.14)'
                                    : 'var(--primary-subtle)',
                                color:
                                  parsedDesc.completedCount ===
                                  parsedDesc.totalCount
                                    ? 'var(--success-text)'
                                    : 'var(--accent-text)',
                              }}
                            >
                              ☑ {parsedDesc.completedCount}/
                              {parsedDesc.totalCount} bước
                            </span>
                          )}

                          {/* Work Category */}
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              padding: '2px 7px',
                              borderRadius: '6px',
                              backgroundColor: 'var(--bg-color)',
                              color: 'var(--muted-color)',
                            }}
                          >
                            {getWorkTypeLabel(item.work_type)}
                          </span>

                          {isItemBlocked(item) && (
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: '6px',
                                backgroundColor: 'var(--warning-subtle)',
                                color: 'var(--warning-text)',
                              }}
                            >
                              ⛔ Cần sửa
                            </span>
                          )}

                          {item.description &&
                            /\[EXECUTOR:\s*([^\]]+)\]/i.test(
                              item.description,
                            ) && (
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: '6px',
                                  backgroundColor: 'var(--primary-subtle)',
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

                          {isAtlasSyncedWorkItem(item.description) && (
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 600,
                                padding: '2px 7px',
                                borderRadius: '6px',
                                backgroundColor: 'var(--primary-subtle)',
                                color: 'var(--accent-text)',
                              }}
                            >
                              🔗 Atlas
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexShrink: 0,
                      }}
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

                  {/* Clean Notes Preview (ONLY non-checklist plain text, never raw - [ ] lines) */}
                  {parsedDesc.cleanNotes && (
                    <p
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        margin: '8px 0 0 0',
                        paddingLeft:
                          role === 'owner' && item.status !== 'cancelled'
                            ? '34px'
                            : '0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {parsedDesc.cleanNotes}
                    </p>
                  )}

                  {/* Footer: Assignees & Evidence Drill-down (ML-04) */}
                  {(() => {
                    const allSubmissions =
                      item.assignments?.flatMap((a) => a.submissions || []) ||
                      [];
                    const allAttachments = allSubmissions.flatMap(
                      (s) => s.attachments || [],
                    );
                    const hasAssignees = Boolean(
                      item.assignments && item.assignments.length > 0,
                    );
                    if (!hasAssignees && allSubmissions.length === 0)
                      return null;
                    return (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          flexWrap: 'wrap',
                          marginTop: '10px',
                          paddingTop: '10px',
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
                          {hasAssignees ? (
                            item.assignments!.map((a) => (
                              <span
                                key={a.id}
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  backgroundColor: 'var(--bg-color)',
                                  border: '1px solid var(--border-subtle)',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  color: 'var(--text-color)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                }}
                              >
                                <UserIcon size={12} color="var(--accent-text)" />
                                <span>
                                  {a.full_name || a.employee_code}
                                  {a.full_name && a.employee_code
                                    ? ` (${a.employee_code})`
                                    : ''}
                                </span>
                              </span>
                            ))
                          ) : (
                            <span
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                              }}
                            >
                              Chưa phân công
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
                                fontSize: '12px',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                color: 'var(--success-text)',
                                cursor: 'pointer',
                              }}
                            >
                              {`${allSubmissions.length} báo cáo nộp → Xem bằng chứng`}
                            </span>
                            {allAttachments.slice(0, 2).map((att, attIdx) => (
                              <a
                                key={`${att.url}-${attIdx}`}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
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
              </React.Fragment>
            );
          })}

          {/* Collapsible Closed / Completed History Bar */}
          {hiddenClosedCount > 0 && (
            <button
              type="button"
              data-testid="work-toggle-closed-section"
              onClick={() => setShowClosedSection(true)}
              style={{
                width: '100%',
                marginTop: '4px',
                padding: '14px 16px',
                borderRadius: '16px',
                backgroundColor: 'var(--surface-color)',
                border: '1px dashed var(--border-color)',
                color: 'var(--muted-color)',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <CheckCircleIcon size={16} color="#10B981" />
              <span>
                Đã hoàn thành & Đã đóng ({hiddenClosedCount} công việc) — Bấm để
                xem lịch sử ▾
              </span>
            </button>
          )}

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
