import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  FileTextIcon,
  PlusIcon,
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  UserIcon,
  RotateCcwIcon,
  InfoIcon,
  ListFooter,
  ActionIconButton,
  Pagination,
  PAGINATION_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  clampPage,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import type {
  DailyReportListItem,
  ReportDetailResponseData,
} from '../../../../packages/contracts/src/reports.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

/**
 * Calculates calendar date parts in Asia/Ho_Chi_Minh (UTC+7) timezone.
 * Avoids UTC skew around midnight when using toISOString().
 */
export function getVietnamDateParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
  const month = parseInt(parts.find((p) => p.type === 'month')!.value, 10);
  const day = parseInt(parts.find((p) => p.type === 'day')!.value, 10);
  return { year, month, day };
}

export function getVietnamTodayString(date: Date = new Date()): string {
  const { year, month, day } = getVietnamDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getVietnamYesterdayString(date: Date = new Date()): string {
  const { year, month, day } = getVietnamDateParts(date);
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1));
  const prevY = yesterday.getUTCFullYear();
  const prevM = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const prevD = String(yesterday.getUTCDate()).padStart(2, '0');
  return `${prevY}-${prevM}-${prevD}`;
}

const VN_REPORT_MOJIBAKE_PAIRS: readonly [string, string][] = [
  ['T?p H?a', 'Tạp Hóa'],
  ['T?p h?a', 'Tạp hóa'],
  ['t?p h?a', 'tạp hóa'],
  ['B? Ph?t', 'Bá Phát'],
  ['TR?I G?', 'TRẠI GÀ'],
  ['kh?ng c? l?i', 'không có lời'],
  ['k?nh', 'kênh'],
  ['cho c?c ', 'cho các '],
  ['nh? m?y', 'nhà máy'],
  ['Men r?c', 'Men rắc'],
  ['men r?c', 'men rắc'],
  ['2men r?c', '2men rắc'],
  ['Men s?ng', 'Men sống'],
  ['men s?ng', 'men sống'],
  ['Th?c t?', 'Thực tế'],
  ['th?c t?', 'thực tế'],
  ['gi?i ??c gan', 'giải độc gan'],
  ['1 g? gan', '1 gđ gan'],
  ['1 ??n', '1 đơn'],
  ['ti?u ph?n-kh? m?i', 'tiêu phân - khử mùi'],
  ['ti?u ph?n - kh? m?i', 'tiêu phân - khử mùi'],
  ['ti?u ph?n', 'tiêu phân'],
  ['kh? m?i', 'khử mùi'],
  ['th?o d??c', 'thảo dược'],
  ['m?u m?nh', 'màu mệnh'],
  ['m?nh g?', 'mệnh gà'],
  ['Nu?i g? theo m?nh', 'Nuôi gà theo mệnh'],
  ['Ch?n nh?c v?o', 'Chèn nhạc vào'],
  ['30 ph?t( t?i nh?)', '30 phút (tại nhà)'],
  ['n?a k?', 'nửa ký'],
  ['k?ch l?ng', 'kích lông'],
  ['b? gan th?n', 'bổ gan thận'],
  ['Ph? Live', 'Phụ Live'],
  ['Ph? live', 'Phụ live'],
];

export function repairVnReportText(raw: string | null | undefined): string {
  if (!raw) return '';
  let out = raw;
  if (!out.includes('?')) return out;
  for (const [bad, good] of VN_REPORT_MOJIBAKE_PAIRS) {
    if (out.includes(bad)) {
      out = out.split(bad).join(good);
    }
  }
  return out;
}

export function formatVnReportDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return dateStr;
}

export function formatWorkTypeLabel(
  workType: string | null | undefined,
): string {
  if (!workType) return 'Công việc chung';
  const map: Record<string, string> = {
    video_editing: 'Dựng video / Clip',
    timesheet: 'Bảng công Excel',
    content: 'Viết kịch bản / Nội dung',
    livestream: 'Phụ Live / Livestream',
    support: 'Hỗ trợ vận hành',
    general: 'Công việc chung',
  };
  return map[workType.trim().toLowerCase()] || workType;
}

export interface ReportsScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
}

interface EntryFormItem {
  work_item_id?: string;
  work_type: string;
  reported_count: number;
  notes: string;
}

export const ReportsScreen: React.FC<ReportsScreenProps> = ({
  role = 'owner',
  onNavigate,
}) => {
  // Work items the user can link a report entry to (nhận việc ↔ báo cáo).
  const [workOptions, setWorkOptions] = useState<
    { id: string; title: string; status: string }[]
  >([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/v1/work-items?limit=100', {
          credentials: 'include',
        });
        if (!res.ok) return;
        const body = await res.json();
        const items = (body?.data?.items ?? []) as {
          id: string;
          title: string;
          status: string;
        }[];
        if (alive)
          setWorkOptions(items.filter((w) => w.status !== 'cancelled'));
      } catch {
        /* linking is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [activeTab, setActiveTab] = useState<'my_reports' | 'all_reports'>(
    role === 'owner' ? 'all_reports' : 'my_reports',
  );

  // Auth / CSRF State
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Data states
  const [myReports, setMyReports] = useState<DailyReportListItem[]>([]);
  const [allReports, setAllReports] = useState<DailyReportListItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState<boolean>(false);

  // Pagination states
  const [myReportsNextCursor, setMyReportsNextCursor] = useState<string | null>(
    null,
  );
  const [loadingMoreMyReports, setLoadingMoreMyReports] = useState(false);
  const [myReportsLoadMoreError, setMyReportsLoadMoreError] = useState<
    string | null
  >(null);
  const myReportsSeqRef = useRef<number>(0);

  const [allReportsNextCursor, setAllReportsNextCursor] = useState<
    string | null
  >(null);
  const [loadingMoreAllReports, setLoadingMoreAllReports] = useState(false);
  const [allReportsLoadMoreError, setAllReportsLoadMoreError] = useState<
    string | null
  >(null);
  const allReportsSeqRef = useRef<number>(0);

  // Pagination states (REP-006)
  const [reportsPage, setReportsPage] = useState<number>(0);
  const [reportsPageSize, setReportsPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);

  // Q65-05: Multi-page employee selector generation and abort management
  const employeesFetchIdRef = useRef<number>(0);
  const employeesAbortControllerRef = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters for Owner
  // Deep-link from payroll statistics: /reports?employee=<uuid>&date=YYYY-MM-DD
  const deepLink =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const deepEmployee = deepLink.get('employee') ?? '';
  const deepDate = deepLink.get('date') ?? '';
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>(
    /^[0-9a-f-]{36}$/i.test(deepEmployee) ? deepEmployee : 'all',
  );
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>(
    /^\d{4}-\d{2}-\d{2}$/.test(deepDate) ? deepDate : '',
  );
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [ownerReportViewMode, setOwnerReportViewMode] = useState<
    'by_employee' | 'by_report'
  >(deepDate ? 'by_report' : 'by_employee');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(
    Boolean(deepDate),
  );
  const [employeeSelectedMonths, setEmployeeSelectedMonths] = useState<
    Record<string, string>
  >({});
  const [expandedEmployeeCards, setExpandedEmployeeCards] = useState<
    Record<string, boolean>
  >({});

  // Modal: Create Draft Report
  const [showCreateModal, setShowCreateModal] = useState(
    typeof window !== 'undefined' &&
      window.location.pathname === '/reports/new',
  );
  const [newReportDate, setNewReportDate] = useState<string>(
    getVietnamTodayString(),
  );
  const [newReportNotes, setNewReportNotes] = useState<string>('');
  const [newReportEntries, setNewReportEntries] = useState<EntryFormItem[]>([
    { work_type: 'video_editing', reported_count: 1, notes: '' },
  ]);

  // Modal: Edit Draft Report
  const [showEditDraftModal, setShowEditDraftModal] = useState(false);
  const [editingReport, setEditingReport] =
    useState<DailyReportListItem | null>(null);
  const [editNotes, setEditNotes] = useState<string>('');
  const [editEntries, setEditEntries] = useState<EntryFormItem[]>([]);

  // Modal: Revise Submitted Report (REP C02)
  const [showReviseModal, setShowReviseModal] = useState(false);
  const [revisingReport, setRevisingReport] =
    useState<DailyReportListItem | null>(null);
  const [reviseNotes, setReviseNotes] = useState<string>('');
  const [reviseReason, setReviseReason] = useState<string>('');
  const [reviseEntries, setReviseEntries] = useState<EntryFormItem[]>([]);

  // Modal: Report Detail & Revision History
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reportDetail, setReportDetail] =
    useState<ReportDetailResponseData | null>(null);

  const baseReportsList = activeTab === 'all_reports' ? allReports : myReports;
  const availableReportMonths = useMemo(() => {
    const map = new Map<
      string,
      { ym: string; label: string; count: number; totalOutput: number }
    >();
    for (const r of baseReportsList) {
      const ym = (r.report_date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const [y, m] = ym.split('-');
      let entry = map.get(ym);
      if (!entry) {
        entry = {
          ym,
          label: `Tháng ${m}/${y}`,
          count: 0,
          totalOutput: 0,
        };
        map.set(ym, entry);
      }
      entry.count += 1;
      entry.totalOutput += Number(r.total_reported_count) || 0;
    }
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [baseReportsList]);

  const reportsToRender = useMemo(() => {
    if (filterMonth === 'all') return baseReportsList;
    return baseReportsList.filter((r) =>
      (r.report_date || '').startsWith(filterMonth),
    );
  }, [baseReportsList, filterMonth]);

  const groupedByEmployeeReports = useMemo(() => {
    const empCodeMap = new Map<string, string>();
    for (const e of employees) {
      empCodeMap.set(e.id, e.employee_code || '');
    }
    const groups = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        employeeCode: string;
        reports: DailyReportListItem[];
        monthsBreakdown: {
          ym: string;
          label: string;
          count: number;
          totalOutput: number;
        }[];
      }
    >();
    for (const r of reportsToRender) {
      const empId = r.employee_id || 'self';
      let g = groups.get(empId);
      if (!g) {
        g = {
          employeeId: empId,
          employeeName: r.employee_name || 'Nhân sự',
          employeeCode: empCodeMap.get(empId) || 'NV',
          reports: [],
          monthsBreakdown: [],
        };
        groups.set(empId, g);
      }
      g.reports.push(r);
    }
    for (const g of groups.values()) {
      const mMap = new Map<
        string,
        { ym: string; label: string; count: number; totalOutput: number }
      >();
      for (const r of g.reports) {
        const ym = (r.report_date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const [y, m] = ym.split('-');
        let item = mMap.get(ym);
        if (!item) {
          item = {
            ym,
            label: `Tháng ${m}/${y}`,
            count: 0,
            totalOutput: 0,
          };
          mMap.set(ym, item);
        }
        item.count += 1;
        item.totalOutput += Number(r.total_reported_count) || 0;
      }
      g.monthsBreakdown = Array.from(mMap.values()).sort((a, b) =>
        b.ym.localeCompare(a.ym),
      );
    }
    return Array.from(groups.values());
  }, [reportsToRender, employees]);

  const safeReportsPage = clampPage(
    reportsPage,
    reportsToRender.length,
    reportsPageSize,
  );
  const pagedReports = useMemo(
    () =>
      reportsToRender.slice(
        safeReportsPage * reportsPageSize,
        (safeReportsPage + 1) * reportsPageSize,
      ),
    [reportsToRender, safeReportsPage, reportsPageSize],
  );

  // Fetch CSRF token and data on mount
  useEffect(() => {
    if (role !== 'owner') {
      setActiveTab('my_reports');
    }
    const controller = new AbortController();
    initData(controller.signal);
    return () => {
      controller.abort();
      employeesAbortControllerRef.current?.abort();
    };
  }, [role]);

  const initData = async (signal?: AbortSignal) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const authInit: RequestInit = { credentials: 'include' };
      if (signal) authInit.signal = signal;
      const authRes = await fetch('/api/v1/auth/me', authInit);
      if (authRes.ok) {
        const authData = await authRes.json();
        if (signal?.aborted) return;
        if (authData.data?.csrf_token) {
          setCsrfToken(authData.data.csrf_token);
        }
      }

      await fetchMyReports(undefined, false);

      if (role === 'owner') {
        await fetchEmployees(signal);
        await fetchAllReports();
      }
    } catch (err: unknown) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
      setErrorMessage('Không thể kết nối đến máy chủ.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const fetchMyReports = async (cursor?: string, append = false) => {
    const currentSeq = ++myReportsSeqRef.current;
    setMyReportsLoadMoreError(null);
    if (append) {
      setLoadingMoreMyReports(true);
    } else {
      setMyReportsNextCursor(null);
    }
    try {
      const url = cursor
        ? `/api/v1/reports/me?cursor=${encodeURIComponent(cursor)}`
        : '/api/v1/reports/me';
      const res = await fetch(url, {
        credentials: 'include',
      });
      if (currentSeq !== myReportsSeqRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (currentSeq !== myReportsSeqRef.current) return;
        const newItems: DailyReportListItem[] = data.data?.items || [];
        setMyReports((prev) =>
          append
            ? [
                ...prev,
                ...newItems.filter(
                  (item) => !prev.some((p) => p.id === item.id),
                ),
              ]
            : newItems,
        );
        setMyReportsNextCursor(data.data?.next_cursor || null);
      } else if (append) {
        setMyReportsLoadMoreError(
          `Không thể tải thêm báo cáo (HTTP ${res.status}). Vui lòng thử lại.`,
        );
      }
    } catch {
      if (currentSeq !== myReportsSeqRef.current) return;
      if (append) {
        setMyReportsLoadMoreError(
          'Không thể kết nối máy chủ khi tải thêm báo cáo. Vui lòng thử lại.',
        );
      }
    } finally {
      if (currentSeq === myReportsSeqRef.current) {
        setLoadingMoreMyReports(false);
      }
    }
  };

  const fetchEmployees = async (externalSignal?: AbortSignal) => {
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

    setEmployeesLoading(true);
    setEmployeesError(null);
    try {
      const all: EmployeeData[] = [];
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let page = 0;
      const maxPages = 20;

      while (page < maxPages) {
        if (isAborted()) return;
        page++;
        const url: string = cursor
          ? `/api/v1/employees?limit=50&cursor=${encodeURIComponent(cursor)}`
          : '/api/v1/employees?limit=50';
        const res = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (isAborted()) return;
        if (!res.ok) {
          throw new Error(
            `Lỗi tải danh sách nhân viên (HTTP ${res.status}). Danh sách có thể chưa đầy đủ.`,
          );
        }
        const data = await res.json();
        if (isAborted()) return;
        const items: EmployeeData[] = data.data?.items || [];
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            all.push(item);
          }
        }
        const nextCursor = data.data?.next_cursor || null;
        if (nextCursor) {
          if (seenCursors.has(nextCursor)) {
            throw new Error(
              'Phát hiện vòng lặp phân trang cursor từ máy chủ. Danh sách có thể chưa đầy đủ.',
            );
          }
          seenCursors.add(nextCursor);
        }
        cursor = nextCursor;
        if (!cursor || items.length === 0) break;
      }

      if (isAborted()) return;

      if (cursor && page >= maxPages) {
        setEmployees(all);
        setEmployeesError(
          `Đã tải tối đa ${maxPages} trang (${all.length} nhân viên). Danh sách có thể chưa đầy đủ.`,
        );
        return;
      }

      setEmployees(all);
      setEmployeesError(null);
    } catch (err: unknown) {
      if (isAborted()) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setEmployeesError(
        err instanceof Error ? err.message : 'Lỗi tải danh sách nhân viên',
      );
    } finally {
      if (!isAborted()) {
        setEmployeesLoading(false);
      }
    }
  };

  const fetchAllReports = async (cursor?: string, append = false) => {
    const currentSeq = ++allReportsSeqRef.current;
    setAllReportsLoadMoreError(null);
    if (append) {
      setLoadingMoreAllReports(true);
    } else {
      setAllReportsNextCursor(null);
    }
    try {
      const params = new URLSearchParams();
      params.append('limit', '100');
      if (filterEmployeeId !== 'all') {
        params.append('employee_id', filterEmployeeId);
      }
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }
      if (filterDate) {
        params.append('start_date', filterDate);
        params.append('end_date', filterDate);
      }
      if (cursor) {
        params.append('cursor', cursor);
      }

      const queryString = params.toString();
      const url = `/api/v1/reports/daily${queryString ? `?${queryString}` : ''}`;

      const res = await fetch(url, {
        credentials: 'include',
      });
      if (currentSeq !== allReportsSeqRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (currentSeq !== allReportsSeqRef.current) return;
        const newItems: DailyReportListItem[] = data.data?.items || [];
        setAllReports((prev) =>
          append
            ? [
                ...prev,
                ...newItems.filter(
                  (item) => !prev.some((p) => p.id === item.id),
                ),
              ]
            : newItems,
        );
        setAllReportsNextCursor(data.data?.next_cursor || null);
      } else if (append) {
        setAllReportsLoadMoreError(
          `Không thể tải thêm báo cáo (HTTP ${res.status}). Vui lòng thử lại.`,
        );
      }
    } catch {
      if (currentSeq !== allReportsSeqRef.current) return;
      if (append) {
        setAllReportsLoadMoreError(
          'Không thể kết nối máy chủ khi tải thêm báo cáo. Vui lòng thử lại.',
        );
      }
    } finally {
      if (currentSeq === allReportsSeqRef.current) {
        setLoadingMoreAllReports(false);
      }
    }
  };

  // Re-fetch when Owner filters change
  useEffect(() => {
    if (role === 'owner') {
      fetchAllReports();
    }
  }, [filterEmployeeId, filterStatus, filterDate]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setNewReportDate(getVietnamTodayString());
    setNewReportNotes('');
    setNewReportEntries([
      { work_type: 'video_editing', reported_count: 1, notes: '' },
    ]);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowCreateModal(true);
  };

  // Add entry row in modal
  const handleAddEntryRow = (
    setter: React.Dispatch<React.SetStateAction<EntryFormItem[]>>,
  ) => {
    setter((prev) => [
      ...prev,
      { work_type: 'video_editing', reported_count: 1, notes: '' },
    ]);
  };

  // Remove entry row in modal
  const handleRemoveEntryRow = (
    index: number,
    setter: React.Dispatch<React.SetStateAction<EntryFormItem[]>>,
  ) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  // Update entry row in modal
  const handleUpdateEntryRow = (
    index: number,
    field: keyof EntryFormItem,
    val: string | number,
    setter: React.Dispatch<React.SetStateAction<EntryFormItem[]>>,
  ) => {
    setter((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item)),
    );
  };

  // Create Draft Report
  const handleCreateReport = async () => {
    if (!newReportDate) {
      setErrorMessage('Vui lòng chọn ngày báo cáo');
      return;
    }
    if (newReportEntries.length === 0) {
      setErrorMessage('Báo cáo phải có ít nhất một đầu mục công việc');
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/v1/reports/daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          report_date: newReportDate,
          entries: newReportEntries.map((e) => ({
            work_type: e.work_type,
            reported_count: Number(e.reported_count) || 0,
            notes: e.notes || undefined,
            work_item_id: e.work_item_id || null,
          })),
          notes: newReportNotes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error?.message || 'Không thể tạo bản nháp báo cáo',
        );
      }

      setSuccessMessage('Đã tạo bản nháp báo cáo thành công!');
      setShowCreateModal(false);
      await fetchMyReports();
      if (role === 'owner') await fetchAllReports();
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi tạo bản nháp báo cáo',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Open Edit Draft Modal
  const handleOpenEditDraft = async (report: DailyReportListItem) => {
    setEditingReport(report);
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/reports/daily/${report.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const detail: ReportDetailResponseData = data.data;
        setEditNotes(detail.notes || '');
        setEditEntries(
          detail.entries.map((e) => ({
            work_type: e.work_type,
            reported_count: e.reported_count,
            notes: e.notes || '',
            work_item_id: e.work_item_id || '',
          })),
        );
        setShowEditDraftModal(true);
      } else {
        const err = await res.json();
        setErrorMessage(
          err.error?.message || 'Không thể tải chi tiết bản nháp',
        );
      }
    } catch {
      setErrorMessage('Không thể tải chi tiết bản nháp');
    } finally {
      setActionLoading(false);
    }
  };

  // Save Draft Changes
  const handleSaveDraft = async () => {
    if (!editingReport) return;
    if (editEntries.length === 0) {
      setErrorMessage('Báo cáo phải có ít nhất một đầu mục công việc');
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/reports/daily/${editingReport.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'If-Match': `"${editingReport.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({
          entries: editEntries.map((e) => ({
            work_type: e.work_type,
            reported_count: Number(e.reported_count) || 0,
            notes: e.notes || undefined,
            work_item_id: e.work_item_id || null,
          })),
          notes: editNotes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể cập nhật bản nháp');
      }

      setSuccessMessage('Đã cập nhật bản nháp thành công!');
      setShowEditDraftModal(false);
      await fetchMyReports();
      if (role === 'owner') await fetchAllReports();
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi cập nhật bản nháp',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Draft Report
  const handleSubmitReport = async (report: DailyReportListItem) => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/reports/daily/${report.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'If-Match': `"${report.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể nộp báo cáo');
      }

      setSuccessMessage('Đã nộp báo cáo công việc thành công (v1)!');
      await fetchMyReports();
      if (role === 'owner') await fetchAllReports();
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi nộp báo cáo',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Open Revise Modal (C02)
  const handleOpenReviseModal = async (report: DailyReportListItem) => {
    setRevisingReport(report);
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/reports/daily/${report.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const detail: ReportDetailResponseData = data.data;
        setReviseNotes(detail.notes || '');
        setReviseReason('');
        setReviseEntries(
          detail.entries.map((e) => ({
            work_type: e.work_type,
            reported_count: e.reported_count,
            notes: e.notes || '',
            work_item_id: e.work_item_id || '',
          })),
        );
        setShowReviseModal(true);
      } else {
        const err = await res.json();
        setErrorMessage(
          err.error?.message || 'Không thể tải chi tiết để chỉnh sửa',
        );
      }
    } catch {
      setErrorMessage('Không thể tải chi tiết để chỉnh sửa');
    } finally {
      setActionLoading(false);
    }
  };

  // Revise Submitted Report (REP C02)
  const handleReviseReport = async () => {
    if (!revisingReport) return;
    if (reviseEntries.length === 0) {
      setErrorMessage('Báo cáo phải có ít nhất một đầu mục công việc');
      return;
    }
    if (!reviseReason.trim()) {
      setErrorMessage('Vui lòng nêu rõ lý do chỉnh sửa báo cáo đã nộp');
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/reports/daily/${revisingReport.id}/revisions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            'If-Match': `"${revisingReport.version}"`,
          },
          credentials: 'include',
          body: JSON.stringify({
            entries: reviseEntries.map((e) => ({
              work_type: e.work_type,
              reported_count: Number(e.reported_count) || 0,
              notes: e.notes || undefined,
              work_item_id: e.work_item_id || null,
            })),
            notes: reviseNotes || undefined,
            reason: reviseReason.trim(),
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error?.message || 'Không thể nộp bản chỉnh sửa báo cáo',
        );
      }

      setSuccessMessage(
        `Đã nộp phiên bản chỉnh sửa v${data.data?.revision_number || revisingReport.current_revision + 1} thành công!`,
      );
      setShowReviseModal(false);
      await fetchMyReports();
      if (role === 'owner') await fetchAllReports();
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi chỉnh sửa báo cáo',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Open Detail & History Modal
  const handleOpenDetailModal = async (reportId: string) => {
    setShowDetailModal(true);
    setDetailLoading(true);
    setReportDetail(null);
    try {
      const res = await fetch(`/api/v1/reports/daily/${reportId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setReportDetail(data.data);
      } else {
        const err = await res.json();
        setErrorMessage(err.error?.message || 'Không thể tải chi tiết báo cáo');
        setShowDetailModal(false);
      }
    } catch {
      setErrorMessage('Không thể tải chi tiết báo cáo');
      setShowDetailModal(false);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Đang tải dữ liệu báo cáo…" />;
  }

  return (
    <div
      style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '40px' }}
    >
      {/* Header */}
      <PageHeader
        title={
          role === 'owner' && activeTab === 'all_reports'
            ? 'Báo cáo công việc nhân viên'
            : 'Báo cáo công việc hàng ngày'
        }
        subtitle={
          role === 'owner' && activeTab === 'all_reports'
            ? 'Xem toàn bộ báo cáo công việc của các nhân sự trong workspace'
            : 'Ghi nhận và gửi báo cáo tiến độ công việc hàng ngày'
        }
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <AppButton
              variant="primary"
              onClick={handleOpenCreateModal}
              disabled={actionLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                minHeight: '44px',
              }}
            >
              <PlusIcon size={16} />
              <span>Tạo báo cáo ngày</span>
            </AppButton>
          </div>
        }
      />

      {/* Tabs (if Owner) */}
      {role === 'owner' && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '20px',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('all_reports')}
            style={{
              padding: '10px 16px',
              borderRadius: '6px',
              backgroundColor:
                activeTab === 'all_reports'
                  ? 'var(--primary-color)'
                  : 'transparent',
              color:
                activeTab === 'all_reports'
                  ? 'var(--inverse-text, #0B1220)'
                  : 'var(--muted-color)',
              fontWeight: 600,
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <UserIcon size={16} />
            <span>Tất cả báo cáo nhân sự</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('my_reports')}
            style={{
              padding: '10px 16px',
              borderRadius: '6px',
              backgroundColor:
                activeTab === 'my_reports'
                  ? 'var(--primary-color)'
                  : 'transparent',
              color:
                activeTab === 'my_reports'
                  ? 'var(--inverse-text, #0B1220)'
                  : 'var(--muted-color)',
              fontWeight: 600,
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileTextIcon size={16} />
            <span>Báo cáo của tôi</span>
          </button>
        </div>
      )}

      {/* Information Banner (C02 Normative) - Only shown on Staff my_reports tab */}
      {activeTab === 'my_reports' && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            backgroundColor: 'rgba(20, 184, 166, 0.08)',
            border: '1px solid rgba(20, 184, 166, 0.25)',
            marginBottom: '16px',
            fontSize: '12px',
            color: 'var(--text-color)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <InfoIcon
            size={18}
            style={{ color: 'var(--accent-text)', marginTop: '2px' }}
          />
          <div style={{ lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--accent-text)' }}>
              QUY TẮC BÁO CÁO:
            </strong>{' '}
            Bản nháp có thể sửa tự do. Sau khi nộp, nếu cần điều chỉnh hệ thống
            sẽ lưu phiên bản mới (v2, v3) kèm lý do.
          </div>
        </div>
      )}

      {/* Feedback Messages */}
      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <ErrorState
            message={errorMessage}
            onRetry={() => setErrorMessage(null)}
          />
        </div>
      )}

      {successMessage && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            marginBottom: '16px',
            color: '#4ADE80',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckIcon size={18} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Owner Compact Toolbar & Filter Controls */}
      {role === 'owner' && activeTab === 'all_reports' && (
        <div style={{ marginBottom: '16px' }}>
          <div
            data-testid="reports-owner-toolbar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
              padding: '8px 10px',
              borderRadius: '10px',
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid var(--border-subtle)',
              marginBottom: showAdvancedFilters ? '10px' : '0',
            }}
          >
            {/* View Mode Toggle: Theo từng nhân viên vs Theo từng báo cáo */}
            <div
              style={{
                display: 'inline-flex',
                gap: '4px',
                padding: '3px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                data-testid="reports-view-by-employee"
                onClick={() => setOwnerReportViewMode('by_employee')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor:
                    ownerReportViewMode === 'by_employee'
                      ? 'rgba(20, 184, 166, 0.16)'
                      : 'transparent',
                  color:
                    ownerReportViewMode === 'by_employee'
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                }}
              >
                Theo từng nhân viên ({groupedByEmployeeReports.length})
              </button>
              <button
                type="button"
                data-testid="reports-view-by-report"
                onClick={() => setOwnerReportViewMode('by_report')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor:
                    ownerReportViewMode === 'by_report'
                      ? 'rgba(20, 184, 166, 0.16)'
                      : 'transparent',
                  color:
                    ownerReportViewMode === 'by_report'
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                }}
              >
                Theo từng ngày ({reportsToRender.length})
              </button>
            </div>

            {/* Right Controls: Month Dropdown + Filter Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <select
                aria-label="Chọn tháng báo cáo"
                data-testid="reports-month-select"
                value={filterMonth}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterMonth(val);
                  setReportsPage(0);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: 'var(--bg-color)',
                  color:
                    filterMonth !== 'all'
                      ? 'var(--accent-text)'
                      : 'var(--text-color)',
                  border:
                    filterMonth !== 'all'
                      ? '1px solid var(--accent-text)'
                      : '1px solid var(--border-color)',
                  minHeight: '36px',
                  cursor: 'pointer',
                }}
              >
                <option value="all">
                  Tất cả các tháng ({baseReportsList.length} báo cáo)
                </option>
                {availableReportMonths.map((m) => (
                  <option key={m.ym} value={m.ym}>
                    {m.label} ({m.count} báo cáo • {m.totalOutput} SL)
                  </option>
                ))}
              </select>

              <button
                type="button"
                data-testid="toggle-reports-advanced-filters"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: showAdvancedFilters
                    ? 'rgba(20, 184, 166, 0.14)'
                    : 'var(--bg-color)',
                  color: showAdvancedFilters
                    ? 'var(--accent-text)'
                    : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  minHeight: '36px',
                  cursor: 'pointer',
                }}
              >
                {showAdvancedFilters ? '▴ Ẩn bộ lọc' : '▾ Bộ lọc'}
              </button>
            </div>
          </div>

          <div style={{ display: showAdvancedFilters ? 'block' : 'none' }}>
            <AppCard padding="16px" style={{ marginBottom: '12px' }}>
              {employeesError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: '#451A1A',
                    border: '1px solid #7F1D1D',
                    borderRadius: '6px',
                    color: 'var(--danger-text)',
                    fontSize: '12px',
                    gap: '8px',
                  }}
                >
                  <span>⚠️ {employeesError}</span>
                  <button
                    type="button"
                    onClick={() => fetchEmployees()}
                    disabled={employeesLoading}
                    style={{
                      backgroundColor: '#DC2626',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      minHeight: '36px',
                      minWidth: '44px',
                    }}
                  >
                    {employeesLoading ? 'Đang tải…' : 'Thử lại'}
                  </button>
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: '1 1 200px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginBottom: '4px',
                    }}
                  >
                    Nhân viên
                  </label>
                  <select
                    value={filterEmployeeId}
                    onChange={(e) => setFilterEmployeeId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      minHeight: '44px',
                    }}
                  >
                    <option value="all">Tất cả nhân viên</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.employee_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: '1 1 150px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginBottom: '4px',
                    }}
                  >
                    Trạng thái
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      minHeight: '44px',
                    }}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="draft">Bản nháp (Draft)</option>
                    <option value="submitted">Đã nộp (Submitted)</option>
                  </select>
                </div>

                <div style={{ flex: '1 1 150px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginBottom: '4px',
                    }}
                  >
                    Ngày báo cáo
                  </label>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      minHeight: '44px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div
                    style={{ display: 'flex', gap: '8px', marginTop: '6px' }}
                  >
                    <button
                      type="button"
                      data-testid="report-preset-today"
                      onClick={() => {
                        setFilterDate(getVietnamTodayString());
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--muted-color)',
                        cursor: 'pointer',
                      }}
                    >
                      Hôm nay
                    </button>
                    <button
                      type="button"
                      data-testid="report-preset-yesterday"
                      onClick={() => {
                        setFilterDate(getVietnamYesterdayString());
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--muted-color)',
                        cursor: 'pointer',
                      }}
                    >
                      Hôm qua
                    </button>
                  </div>
                </div>

                {(filterEmployeeId !== 'all' ||
                  filterStatus !== 'all' ||
                  filterMonth !== 'all' ||
                  Boolean(filterDate)) && (
                  <div style={{ alignSelf: 'flex-end' }}>
                    <AppButton
                      variant="secondary"
                      onClick={() => {
                        setFilterEmployeeId('all');
                        setFilterStatus('all');
                        setFilterMonth('all');
                        setFilterDate('');
                      }}
                      style={{ minHeight: '44px' }}
                    >
                      Xóa tất cả bộ lọc
                    </AppButton>
                  </div>
                )}
              </div>
            </AppCard>
          </div>
        </div>
      )}

      {/* Reports List */}
      {reportsToRender.length === 0 ? (
        activeTab === 'all_reports' &&
        (filterEmployeeId !== 'all' ||
          filterStatus !== 'all' ||
          Boolean(filterDate)) ? (
          <div
            data-testid="reports-empty-filter"
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              backgroundColor: 'var(--surface-hover)',
              borderRadius: '8px',
              border: '1px dashed var(--border-color)',
            }}
          >
            <p
              style={{
                color: 'var(--muted-color)',
                fontSize: '14px',
                marginBottom: '16px',
              }}
            >
              Không tìm thấy báo cáo công việc nào theo bộ lọc đã chọn.
            </p>
            <AppButton
              variant="secondary"
              onClick={() => {
                setFilterEmployeeId('all');
                setFilterStatus('all');
                setFilterDate('');
              }}
            >
              Xóa tất cả bộ lọc
            </AppButton>
          </div>
        ) : (
          <EmptyState
            title="Chưa có báo cáo công việc nào"
            description={
              activeTab === 'all_reports'
                ? 'Không tìm thấy báo cáo nào theo bộ lọc đã chọn.'
                : 'Bạn chưa tạo báo cáo công việc nào. Bấm nút dưới để tạo bản nháp đầu tiên.'
            }
            icon={<FileTextIcon size={40} />}
            action={
              <AppButton
                variant="primary"
                onClick={handleOpenCreateModal}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  minHeight: '44px',
                }}
              >
                <PlusIcon size={16} />
                <span>Tạo báo cáo ngày</span>
              </AppButton>
            }
          />
        )
      ) : role === 'owner' &&
        activeTab === 'all_reports' &&
        ownerReportViewMode === 'by_employee' ? (
        <div
          data-testid="reports-grouped-by-employee"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {groupedByEmployeeReports.map((group) => {
            const defaultEmpMonth =
              filterMonth !== 'all'
                ? filterMonth
                : group.monthsBreakdown.length > 0
                  ? group.monthsBreakdown[0]?.ym || 'all'
                  : 'all';
            const selectedEmpMonth =
              employeeSelectedMonths[group.employeeId] || defaultEmpMonth;
            const activeReports =
              selectedEmpMonth === 'all'
                ? group.reports
                : group.reports.filter((r) =>
                    (r.report_date || '').startsWith(selectedEmpMonth),
                  );
            const activeTotalOutput = activeReports.reduce(
              (sum, r) => sum + (Number(r.total_reported_count) || 0),
              0,
            );
            const isExpandedAll = Boolean(
              expandedEmployeeCards[group.employeeId],
            );
            const visibleReports = isExpandedAll
              ? activeReports
              : activeReports.slice(0, 5);
            const hiddenCount = Math.max(
              0,
              activeReports.length - visibleReports.length,
            );

            return (
              <AppCard key={group.employeeId} padding="16px">
                {/* Employee Header + Per-Employee Month Selector */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px',
                    paddingBottom: '12px',
                    marginBottom: '12px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        minWidth: '54px',
                        height: '38px',
                        padding: '0 10px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(20, 184, 166, 0.14)',
                        border: '1px solid rgba(20, 184, 166, 0.35)',
                        color: 'var(--accent-text)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '12px',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.employeeCode}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '16px',
                          color: 'var(--text-color)',
                        }}
                      >
                        {group.employeeName}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          flexWrap: 'wrap',
                          fontSize: '13px',
                          color: 'var(--muted-color)',
                          marginTop: '2px',
                        }}
                      >
                        <span>
                          <strong style={{ color: 'var(--text-color)' }}>
                            {activeReports.length} báo cáo
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Tổng sản lượng:{' '}
                          <strong style={{ color: 'var(--accent-text)' }}>
                            {activeTotalOutput}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Per-Employee Month Dropdown */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    {group.monthsBreakdown.length > 0 && (
                      <select
                        aria-label={`Chọn tháng báo cáo của ${group.employeeName}`}
                        data-testid={`report-employee-month-${group.employeeId}`}
                        value={selectedEmpMonth}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEmployeeSelectedMonths((prev) => ({
                            ...prev,
                            [group.employeeId]: val,
                          }));
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          backgroundColor: 'var(--surface-subtle)',
                          color: 'var(--accent-text)',
                          border: '1px solid rgba(20, 184, 166, 0.45)',
                          minHeight: '34px',
                          cursor: 'pointer',
                        }}
                      >
                        {group.monthsBreakdown.map((mb) => (
                          <option key={mb.ym} value={mb.ym}>
                            {mb.label} ({mb.count} báo cáo • {mb.totalOutput}{' '}
                            SL)
                          </option>
                        ))}
                        <option value="all">
                          Tất cả ({group.reports.length} báo cáo)
                        </option>
                      </select>
                    )}
                  </div>
                </div>

                {/* Reports inside Employee Card */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {visibleReports.map((report) => {
                    const isDraft = report.status === 'draft';
                    const cleanNotes = repairVnReportText(report.notes);
                    return (
                      <div
                        key={report.id}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
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
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: '14px',
                                color: 'var(--text-color)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <CalendarIcon
                                size={15}
                                style={{ color: 'var(--accent-text)' }}
                              />
                              <span>
                                Ngày {formatVnReportDate(report.report_date)}
                              </span>
                            </span>

                            <StatusBadge
                              status={isDraft ? 'warning' : 'success'}
                              label={isDraft ? 'Bản nháp' : 'Đã nộp'}
                            />

                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(20, 184, 166, 0.14)',
                                color: 'var(--accent-text)',
                              }}
                            >
                              Sản lượng: {report.total_reported_count} (
                              {report.entries_count} mục)
                            </span>

                            {report.submitted_at && (
                              <span
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--muted-color)',
                                }}
                              >
                                • Nộp{' '}
                                {new Date(
                                  report.submitted_at,
                                ).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>

                          <ActionIconButton
                            action="view"
                            target={`Báo cáo ngày ${formatVnReportDate(report.report_date)}`}
                            label="Chi tiết & Lịch sử"
                            onClick={() => handleOpenDetailModal(report.id)}
                          />
                        </div>

                        {cleanNotes && (
                          <div
                            style={{
                              fontSize: '13px',
                              color: 'var(--text-secondary)',
                              lineHeight: 1.5,
                              backgroundColor: 'var(--surface-subtle)',
                              padding: '7px 12px',
                              borderRadius: '6px',
                              borderLeft: '3px solid #14B8A6',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {cleanNotes}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(hiddenCount > 0 ||
                    (isExpandedAll && activeReports.length > 5)) && (
                    <button
                      type="button"
                      data-testid={`toggle-more-reports-${group.employeeId}`}
                      onClick={() =>
                        setExpandedEmployeeCards((prev) => ({
                          ...prev,
                          [group.employeeId]: !prev[group.employeeId],
                        }))
                      }
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px dashed var(--border-color)',
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--accent-text)',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {isExpandedAll
                        ? '▴ Thu gọn bớt (chỉ hiện 5 báo cáo mới nhất)'
                        : `▾ Xem thêm ${hiddenCount} báo cáo trong tháng này`}
                    </button>
                  )}
                </div>
              </AppCard>
            );
          })}
          <ListFooter
            itemCount={allReports.length}
            hasNextPage={Boolean(allReportsNextCursor)}
            onLoadMore={() =>
              allReportsNextCursor &&
              fetchAllReports(allReportsNextCursor, true)
            }
            isLoadingMore={loadingMoreAllReports}
            loadMoreLabel="Tải thêm báo cáo"
            error={allReportsLoadMoreError}
            onRetry={() =>
              allReportsNextCursor &&
              fetchAllReports(allReportsNextCursor, true)
            }
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {pagedReports.map((report) => {
            const isDraft = report.status === 'draft';
            const cleanNotes = repairVnReportText(report.notes);
            return (
              <AppCard key={report.id} padding="20px">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '10px',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '16px',
                          color: 'var(--text-color)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <CalendarIcon
                          size={16}
                          style={{ color: 'var(--accent-text)' }}
                        />
                        <span>
                          Ngày {formatVnReportDate(report.report_date)}
                        </span>
                      </span>

                      <StatusBadge
                        status={isDraft ? 'warning' : 'success'}
                        label={isDraft ? 'Bản nháp' : 'Đã nộp'}
                      />

                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'var(--surface-hover)',
                          color: 'var(--accent-text)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        v{report.current_revision}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        marginTop: '4px',
                      }}
                    >
                      {report.employee_name && (
                        <span>
                          Nhân viên:{' '}
                          <strong style={{ color: 'var(--text-color)' }}>
                            {report.employee_name}
                          </strong>{' '}
                          |{' '}
                        </span>
                      )}
                      <span>
                        Tổng sản lượng:{' '}
                        <strong style={{ color: 'var(--accent-text)' }}>
                          {report.total_reported_count}
                        </strong>{' '}
                        ({report.entries_count} đầu mục)
                      </span>
                      {report.submitted_at && (
                        <span>
                          {' '}
                          | Nộp lúc:{' '}
                          {new Date(report.submitted_at).toLocaleTimeString(
                            'vi-VN',
                            { hour: '2-digit', minute: '2-digit' },
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions for this report */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    {/* View details & revisions */}
                    <ActionIconButton
                      action="view"
                      target={`Báo cáo ngày ${report.report_date}`}
                      label="Chi tiết & Lịch sử"
                      onClick={() => handleOpenDetailModal(report.id)}
                    />

                    {/* Staff actions on draft */}
                    {isDraft && activeTab === 'my_reports' && (
                      <>
                        <ActionIconButton
                          action="edit"
                          target={`Nháp ngày ${report.report_date}`}
                          label="Sửa nháp"
                          onClick={() => handleOpenEditDraft(report)}
                          disabled={actionLoading}
                        />

                        <AppButton
                          variant="primary"
                          onClick={() => handleSubmitReport(report)}
                          disabled={actionLoading}
                          style={{
                            fontSize: '13px',
                            minHeight: '38px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <CheckIcon size={14} />
                          <span>Nộp báo cáo</span>
                        </AppButton>
                      </>
                    )}

                    {/* Staff action on submitted (C02 Revise) */}
                    {!isDraft && activeTab === 'my_reports' && (
                      <AppButton
                        data-testid="revise-report-btn"
                        variant="secondary"
                        onClick={() => handleOpenReviseModal(report)}
                        disabled={actionLoading}
                        style={{
                          fontSize: '13px',
                          minHeight: '38px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: 'var(--warning-text)',
                          borderColor: 'rgba(245, 158, 11, 0.4)',
                        }}
                      >
                        <RotateCcwIcon size={14} />
                        <span>Chỉnh sửa (C02)</span>
                      </AppButton>
                    )}
                  </div>
                </div>

                {cleanNotes && (
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      margin: '8px 0 0 0',
                      lineHeight: 1.5,
                      backgroundColor: 'var(--surface-subtle)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      borderLeft: '3px solid #14B8A6',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {cleanNotes}
                  </p>
                )}
              </AppCard>
            );
          })}

          {/* Unified Pagination (REP-006) */}
          <div
            data-testid="reports-pagination-container"
            style={{ marginTop: '16px' }}
          >
            <Pagination
              testId="reports-pager"
              total={reportsToRender.length}
              page={safeReportsPage}
              pageSize={reportsPageSize}
              onPage={setReportsPage}
              onPageSize={(s) => {
                setReportsPageSize(s);
                setReportsPage(0);
              }}
              pageSizes={PAGINATION_PAGE_SIZES}
            />
          </div>

          {activeTab === 'all_reports' && (
            <ListFooter
              itemCount={allReports.length}
              hasNextPage={Boolean(allReportsNextCursor)}
              onLoadMore={() =>
                allReportsNextCursor &&
                fetchAllReports(allReportsNextCursor, true)
              }
              isLoadingMore={loadingMoreAllReports}
              loadMoreLabel="Tải thêm báo cáo"
              error={allReportsLoadMoreError}
              onRetry={() =>
                allReportsNextCursor &&
                fetchAllReports(allReportsNextCursor, true)
              }
            />
          )}
          {activeTab === 'my_reports' && (
            <ListFooter
              itemCount={myReports.length}
              hasNextPage={Boolean(myReportsNextCursor)}
              onLoadMore={() =>
                myReportsNextCursor && fetchMyReports(myReportsNextCursor, true)
              }
              isLoadingMore={loadingMoreMyReports}
              loadMoreLabel="Tải thêm báo cáo"
              error={myReportsLoadMoreError}
              onRetry={() =>
                myReportsNextCursor && fetchMyReports(myReportsNextCursor, true)
              }
            />
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE DRAFT REPORT                                              */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '12px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '18px',
                  color: 'var(--text-color)',
                }}
              >
                Tạo báo cáo công việc ngày
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Ngày báo cáo *
              </label>
              <input
                type="date"
                value={newReportDate}
                onChange={(e) => setNewReportDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '14px',
                  minHeight: '44px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Entries Form List */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <label
                  style={{ fontSize: '13px', color: 'var(--muted-color)' }}
                >
                  Đầu mục công việc *
                </label>
                <button
                  type="button"
                  onClick={() => handleAddEntryRow(setNewReportEntries)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <PlusIcon size={14} />
                  <span>Thêm đầu mục</span>
                </button>
              </div>

              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {newReportEntries.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      backgroundColor: 'var(--surface-subtle)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Loại công việc (vd: video_editing, support)"
                      value={item.work_type}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'work_type',
                          e.target.value,
                          setNewReportEntries,
                        )
                      }
                      style={{
                        flex: '2 1 140px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                      }}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="SL"
                      value={item.reported_count}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'reported_count',
                          Number(e.target.value),
                          setNewReportEntries,
                        )
                      }
                      style={{
                        width: '70px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                        textAlign: 'right',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Ghi chú (tùy chọn)"
                      value={item.notes}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'notes',
                          e.target.value,
                          setNewReportEntries,
                        )
                      }
                      style={{
                        flex: '3 1 160px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                      }}
                    />
                    {workOptions.length > 0 && (
                      <select
                        aria-label="Công việc liên quan"
                        value={item.work_item_id ?? ''}
                        onChange={(e) =>
                          handleUpdateEntryRow(
                            index,
                            'work_item_id',
                            e.target.value,
                            setNewReportEntries,
                          )
                        }
                        style={{
                          flex: '2 1 150px',
                          minWidth: 0,
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--text-color)',
                          fontSize: '13px',
                        }}
                      >
                        <option value="">Công việc liên quan (tùy chọn)</option>
                        {workOptions.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {newReportEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveEntryRow(index, setNewReportEntries)
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger-text)',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        <CloseIcon size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Ghi chú chung
              </label>
              <textarea
                rows={2}
                placeholder="Tóm tắt tình hình hoàn thành công việc hôm nay…"
                value={newReportNotes}
                onChange={(e) => setNewReportNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-end',
                marginTop: '10px',
              }}
            >
              <AppButton
                variant="secondary"
                onClick={() => setShowCreateModal(false)}
                disabled={actionLoading}
                style={{ minHeight: '44px' }}
              >
                Hủy bỏ
              </AppButton>
              <AppButton
                variant="primary"
                onClick={handleCreateReport}
                disabled={actionLoading}
                style={{ minHeight: '44px' }}
              >
                {actionLoading ? 'Đang lưu…' : 'Lưu bản nháp'}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT DRAFT REPORT                                                */}
      {/* ========================================================================= */}
      {showEditDraftModal && editingReport && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '12px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '18px',
                  color: 'var(--text-color)',
                }}
              >
                Chỉnh sửa bản nháp ngày {editingReport.report_date}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditDraftModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {/* Entries Form List */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <label
                  style={{ fontSize: '13px', color: 'var(--muted-color)' }}
                >
                  Đầu mục công việc *
                </label>
                <button
                  type="button"
                  onClick={() => handleAddEntryRow(setEditEntries)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <PlusIcon size={14} />
                  <span>Thêm đầu mục</span>
                </button>
              </div>

              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {editEntries.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      backgroundColor: 'var(--surface-subtle)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Loại công việc"
                      value={item.work_type}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'work_type',
                          e.target.value,
                          setEditEntries,
                        )
                      }
                      style={{
                        flex: '2 1 140px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                      }}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="SL"
                      value={item.reported_count}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'reported_count',
                          Number(e.target.value),
                          setEditEntries,
                        )
                      }
                      style={{
                        width: '70px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                        textAlign: 'right',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Ghi chú"
                      value={item.notes}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'notes',
                          e.target.value,
                          setEditEntries,
                        )
                      }
                      style={{
                        flex: '3 1 160px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                      }}
                    />
                    {workOptions.length > 0 && (
                      <select
                        aria-label="Công việc liên quan"
                        value={item.work_item_id ?? ''}
                        onChange={(e) =>
                          handleUpdateEntryRow(
                            index,
                            'work_item_id',
                            e.target.value,
                            setEditEntries,
                          )
                        }
                        style={{
                          flex: '2 1 150px',
                          minWidth: 0,
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--text-color)',
                          fontSize: '13px',
                        }}
                      >
                        <option value="">Công việc liên quan (tùy chọn)</option>
                        {workOptions.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {editEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveEntryRow(index, setEditEntries)
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger-text)',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        <CloseIcon size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Ghi chú chung
              </label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-end',
                marginTop: '10px',
              }}
            >
              <AppButton
                variant="secondary"
                onClick={() => setShowEditDraftModal(false)}
                disabled={actionLoading}
                style={{ minHeight: '44px' }}
              >
                Hủy bỏ
              </AppButton>
              <AppButton
                variant="primary"
                onClick={handleSaveDraft}
                disabled={actionLoading}
                style={{ minHeight: '44px' }}
              >
                {actionLoading ? 'Đang lưu…' : 'Cập nhật bản nháp'}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: REVISE SUBMITTED REPORT (REP C02)                                */}
      {/* ========================================================================= */}
      {showReviseModal && revisingReport && (
        <div
          data-testid="revise-report-modal"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '620px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '12px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '18px',
                    color: 'var(--text-color)',
                  }}
                >
                  Chỉnh sửa báo cáo đã nộp (Quy tắc C02)
                </h3>
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  Ngày {revisingReport.report_date} — Phiên bản mới:{' '}
                  <strong style={{ color: 'var(--accent-text)' }}>
                    v{revisingReport.current_revision + 1}
                  </strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowReviseModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                fontSize: '12px',
                color: '#FDE047',
                lineHeight: 1.5,
              }}
            >
              <strong>Lưu ý:</strong> Báo cáo này đã được nộp trước đó. Khi bạn
              nộp phiên bản chỉnh sửa mới, phiên bản cũ sẽ được lưu trữ bất biến
              để đối chiếu, và lịch sử sửa đổi sẽ ghi nhận lý do bạn cung cấp.
            </div>

            {/* Mandatory Reason */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--text-color)',
                  fontWeight: 600,
                  marginBottom: '6px',
                }}
              >
                Lý do điều chỉnh số liệu *
              </label>
              <input
                data-testid="revise-reason-input"
                type="text"
                placeholder="Ví dụ: Bổ sung 2 video dựng ban đêm, kiểm tra lại số liệu"
                value={reviseReason}
                onChange={(e) => setReviseReason(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid #F59E0B',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '14px',
                  minHeight: '44px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Entries Form List */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <label
                  style={{ fontSize: '13px', color: 'var(--muted-color)' }}
                >
                  Đầu mục công việc *
                </label>
                <button
                  type="button"
                  onClick={() => handleAddEntryRow(setReviseEntries)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <PlusIcon size={14} />
                  <span>Thêm đầu mục</span>
                </button>
              </div>

              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
              >
                {reviseEntries.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      backgroundColor: 'var(--surface-subtle)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Loại công việc"
                      value={item.work_type}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'work_type',
                          e.target.value,
                          setReviseEntries,
                        )
                      }
                      style={{
                        flex: '2 1 140px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                      }}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="SL"
                      value={item.reported_count}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'reported_count',
                          Number(e.target.value),
                          setReviseEntries,
                        )
                      }
                      style={{
                        width: '70px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                        textAlign: 'right',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Ghi chú"
                      value={item.notes}
                      onChange={(e) =>
                        handleUpdateEntryRow(
                          index,
                          'notes',
                          e.target.value,
                          setReviseEntries,
                        )
                      }
                      style={{
                        flex: '3 1 160px',
                        padding: '8px 10px',
                        backgroundColor: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                      }}
                    />
                    {workOptions.length > 0 && (
                      <select
                        aria-label="Công việc liên quan"
                        value={item.work_item_id ?? ''}
                        onChange={(e) =>
                          handleUpdateEntryRow(
                            index,
                            'work_item_id',
                            e.target.value,
                            setReviseEntries,
                          )
                        }
                        style={{
                          flex: '2 1 150px',
                          minWidth: 0,
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--text-color)',
                          fontSize: '13px',
                        }}
                      >
                        <option value="">Công việc liên quan (tùy chọn)</option>
                        {workOptions.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {reviseEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveEntryRow(index, setReviseEntries)
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger-text)',
                          cursor: 'pointer',
                          padding: '4px',
                        }}
                      >
                        <CloseIcon size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Ghi chú chung
              </label>
              <textarea
                rows={2}
                value={reviseNotes}
                onChange={(e) => setReviseNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'flex-end',
                marginTop: '10px',
              }}
            >
              <AppButton
                data-testid="revise-cancel-btn"
                variant="secondary"
                onClick={() => setShowReviseModal(false)}
                disabled={actionLoading}
                style={{ minHeight: '44px' }}
              >
                Hủy bỏ
              </AppButton>
              <AppButton
                data-testid="revise-submit-btn"
                variant="primary"
                onClick={handleReviseReport}
                disabled={actionLoading}
                style={{ minHeight: '44px' }}
              >
                {actionLoading
                  ? 'Đang nộp…'
                  : `Nộp phiên bản v${revisingReport.current_revision + 1}`}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: REPORT DETAIL & IMMUTABLE REVISION HISTORY (UI10)                */}
      {/* ========================================================================= */}
      {showDetailModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '650px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: '12px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '18px',
                    color: 'var(--text-color)',
                  }}
                >
                  Chi tiết báo cáo công việc
                </h3>
                {reportDetail && (
                  <div
                    style={{
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                    }}
                  >
                    Ngày {formatVnReportDate(reportDetail.report_date)}
                    {reportDetail.employee_name &&
                      ` — ${reportDetail.employee_name}`}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDetailModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {detailLoading || !reportDetail ? (
              <LoadingState message="Đang tải dữ liệu chi tiết…" />
            ) : (
              <>
                {/* Status Badges */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <StatusBadge
                    status={
                      reportDetail.status === 'draft' ? 'warning' : 'success'
                    }
                    label={
                      reportDetail.status === 'draft'
                        ? 'Bản nháp'
                        : 'Đã nộp chính thức'
                    }
                  />
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--surface-hover)',
                      color: 'var(--accent-text)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    Phiên bản hiện tại: v{reportDetail.current_revision}
                  </span>
                  {reportDetail.submitted_at && (
                    <span
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Nộp lúc:{' '}
                      {new Date(reportDetail.submitted_at).toLocaleString(
                        'vi-VN',
                      )}
                    </span>
                  )}
                </div>

                {/* Entries Table */}
                <div>
                  <h4
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: '14px',
                      color: 'var(--text-color)',
                    }}
                  >
                    Nội dung công việc hiện hành
                  </h4>
                  <div
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      overflowX: 'auto',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '13px',
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            color: 'var(--muted-color)',
                            textAlign: 'left',
                          }}
                        >
                          <th style={{ padding: '10px 12px' }}>Công việc</th>
                          <th
                            style={{ padding: '10px 12px', textAlign: 'right' }}
                          >
                            Số lượng
                          </th>
                          <th style={{ padding: '10px 12px' }}>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportDetail.entries.map((entry, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom:
                                idx < reportDetail.entries.length - 1
                                  ? '1px solid var(--border-subtle)'
                                  : 'none',
                              color: 'var(--text-color)',
                            }}
                          >
                            <td
                              style={{
                                padding: '10px 12px',
                                fontWeight: 500,
                              }}
                            >
                              {formatWorkTypeLabel(entry.work_type)}
                            </td>
                            <td
                              style={{
                                padding: '10px 12px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: 'var(--accent-text)',
                              }}
                            >
                              {entry.reported_count}
                            </td>
                            <td
                              style={{
                                padding: '10px 12px',
                                color: 'var(--muted-color)',
                              }}
                            >
                              {entry.work_item_title && entry.work_item_id && (
                                <a
                                  href={`/work/${entry.work_item_id}`}
                                  onClick={(ev) => {
                                    ev.preventDefault();
                                    onNavigate?.(`/work/${entry.work_item_id}`);
                                  }}
                                  style={{
                                    color: 'var(--accent-text)',
                                    marginRight: 8,
                                  }}
                                >
                                  🔗 {entry.work_item_title}
                                </a>
                              )}
                              {repairVnReportText(entry.notes) || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {reportDetail.notes && (
                  <div>
                    <h4
                      style={{
                        margin: '0 0 6px 0',
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                      }}
                    >
                      Ghi chú báo cáo
                    </h4>
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        fontSize: '13px',
                        lineHeight: 1.5,
                      }}
                    >
                      {repairVnReportText(reportDetail.notes)}
                    </div>
                  </div>
                )}

                {/* Revision History Section */}
                <div>
                  <h4
                    style={{
                      margin: '12px 0 8px 0',
                      fontSize: '14px',
                      color: 'var(--text-color)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <RotateCcwIcon
                      size={15}
                      style={{ color: 'var(--accent-text)' }}
                    />
                    <span>Lịch sử các phiên bản (C02 Revisions)</span>
                  </h4>

                  {reportDetail.revisions.length === 0 ? (
                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        fontStyle: 'italic',
                        padding: '8px 0',
                      }}
                    >
                      Bản nháp chưa có phiên bản nộp chính thức.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      {reportDetail.revisions.map((rev) => (
                        <div
                          key={rev.id}
                          style={{
                            padding: '12px 14px',
                            borderRadius: '8px',
                            backgroundColor: 'var(--surface-subtle)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '6px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: '13px',
                                  color: 'var(--accent-text)',
                                }}
                              >
                                v{rev.revision_number}{' '}
                                {rev.revision_number === 1
                                  ? '(Gốc)'
                                  : '(Chỉnh sửa)'}
                              </span>
                              <span
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--muted-color)',
                                }}
                              >
                                Bởi {rev.edited_by_name || 'Nhân viên'}
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                              }}
                            >
                              {new Date(rev.edited_at).toLocaleString('vi-VN')}
                            </span>
                          </div>

                          {rev.reason && (
                            <div
                              style={{
                                fontSize: '13px',
                                color: '#FDE047',
                                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                padding: '6px 10px',
                                borderRadius: '4px',
                                marginBottom: '8px',
                              }}
                            >
                              Lý do: {rev.reason}
                            </div>
                          )}

                          {rev.snapshot?.entries && (
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '8px',
                              }}
                            >
                              {rev.snapshot.entries.map((item, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    backgroundColor: 'var(--bg-color)',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                  }}
                                >
                                  {formatWorkTypeLabel(item.work_type)}:{' '}
                                  <strong
                                    style={{ color: 'var(--text-color)' }}
                                  >
                                    {item.reported_count}
                                  </strong>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: '10px',
                  }}
                >
                  <AppButton
                    variant="secondary"
                    onClick={() => setShowDetailModal(false)}
                    style={{ minHeight: '44px' }}
                  >
                    Đóng
                  </AppButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
