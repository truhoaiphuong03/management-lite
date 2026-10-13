import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  PageHeader,
  AppCard,
  AppButton,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  PlusIcon,
  SearchIcon,
  AlertTriangleIcon,
  CheckIcon,
  CheckCircleIcon,
  ArrowLeftIcon,
  LinkIcon,
  ShieldAlertIcon,
  UserIcon,
  ActionIconButton,
  Pagination,
  DEFAULT_PAGE_SIZE,
  clampPage,
} from '../../../../packages/ui/src/components/index.js';
import type {
  StorageFolderData,
  StorageFolderDetailData,
  StorageOutputData,
  CreateStorageFolderRequest,
  CreateStorageReceiptRequest,
  CreateTrashRequestResponseData,
} from '@management-lite/contracts';

export interface StorageScreenProps {
  role?: 'owner' | 'staff';
  folderId?: string | undefined;
  onNavigate?: (path: string) => void;
}

interface EmployeeOption {
  id: string;
  employee_code: string;
  full_name: string;
}

export const StorageScreen: React.FC<StorageScreenProps> = ({
  role = 'owner',
  folderId,
  onNavigate,
}) => {
  // Authentication & CSRF
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Data states
  const [folders, setFolders] = useState<StorageFolderData[]>([]);
  const [selectedFolder, setSelectedFolder] =
    useState<StorageFolderDetailData | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter & Search states (List view)
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal 1: Create Source Folder (Owner Only)
  const [showCreateSourceModal, setShowCreateSourceModal] =
    useState<boolean>(false);
  const [newSourceName, setNewSourceName] = useState<string>('');
  const [newSourceDriveUrl, setNewSourceDriveUrl] = useState<string>('');
  const [newSourceEmployeeIds, setNewSourceEmployeeIds] = useState<string[]>(
    [],
  );
  const [newSourceNotes, setNewSourceNotes] = useState<string>('');

  // Modal 2: Create Deliverable Folder (Staff or Owner)
  const [showCreateDeliverableModal, setShowCreateDeliverableModal] =
    useState<boolean>(false);
  const [deliverableParentFolderId, setDeliverableParentFolderId] =
    useState<string>('');
  const [deliverableAssignmentId, setDeliverableAssignmentId] =
    useState<string>('');
  const [deliverableName, setDeliverableName] = useState<string>('');
  const [deliverableDriveUrl, setDeliverableDriveUrl] = useState<string>('');
  const [deliverableNotes, setDeliverableNotes] = useState<string>('');

  // Modal 3: Two-step Google Drive Trash Confirmation (Owner Only)
  const [showTrashModal, setShowTrashModal] = useState<boolean>(false);
  const [trashRequestData, setTrashRequestData] =
    useState<CreateTrashRequestResponseData | null>(null);
  const [trashAcknowledged, setTrashAcknowledged] = useState<boolean>(false);

  // Q65-05: Multi-page employee selector generation and abort management
  const employeesFetchIdRef = useRef<number>(0);
  const employeesAbortControllerRef = useRef<AbortController | null>(null);
  const trashLockRef = useRef<boolean>(false);

  // 1. Fetch CSRF token & Employee List
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const fetchSessionAndEmployees = async () => {
      try {
        const meRes = await fetch('/api/v1/auth/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (meRes.ok) {
          const match = document.cookie.match(/csrf_token=([^;]+)/);
          if (match && match[1] && active) {
            setCsrfToken(decodeURIComponent(match[1]));
          }
        }

        if (role === 'owner' && active) {
          await fetchEmployees(controller.signal);
        }
      } catch {
        // Ignore initialization errors
      }
    };
    fetchSessionAndEmployees();

    return () => {
      active = false;
      controller.abort();
      employeesAbortControllerRef.current?.abort();
    };
  }, [role]);

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

    setEmployeesLoading(true);
    setEmployeesError(null);
    try {
      const allEmps: EmployeeOption[] = [];
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
        const empRes = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (isAborted()) return;
        if (!empRes.ok) {
          throw new Error(
            `Lỗi tải danh sách nhân viên (HTTP ${empRes.status}). Danh sách có thể chưa đầy đủ.`,
          );
        }
        const empData = await empRes.json();
        if (isAborted()) return;
        const items =
          empData.data?.items ||
          (Array.isArray(empData.data) ? empData.data : []);
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
        cursor = empData.data?.next_cursor || null;
        if (cursor) {
          if (seenCursors.has(cursor)) {
            throw new Error(
              'Phát hiện vòng lặp phân trang cursor từ máy chủ. Danh sách có thể chưa đầy đủ.',
            );
          }
          seenCursors.add(cursor);
        }
        if (!cursor || items.length === 0) break;
      }

      if (isAborted()) return;

      if (cursor && page >= maxPages) {
        setEmployees(allEmps);
        setEmployeesError(
          `Đã tải tối đa ${maxPages} trang (${allEmps.length} nhân viên). Danh sách có thể chưa đầy đủ.`,
        );
        return;
      }

      setEmployees(allEmps);
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

  // 2. Fetch Folders list or Selected Folder detail
  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      if (folderId) {
        // Fetch folder detail
        const res = await fetch(`/api/v1/storage/folders/${folderId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data) {
            setSelectedFolder(body.data);
          } else {
            setErrorMessage(
              body.error?.message || 'Không thể tải chi tiết thư mục.',
            );
          }
        } else if (res.status === 404 || res.status === 501) {
          setErrorMessage(
            'API module STORAGE chưa khả dụng trên máy chủ hoặc thư mục không tồn tại.',
          );
        } else {
          setErrorMessage(`Máy chủ trả về mã lỗi: ${res.status}`);
        }
      } else {
        // Fetch folders list
        const res = await fetch('/api/v1/storage/folders', {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && Array.isArray(body.data)) {
            setFolders(body.data);
          } else {
            setErrorMessage(
              body.error?.message || 'Không thể tải danh sách thư mục.',
            );
          }
        } else if (res.status === 404 || res.status === 501) {
          setErrorMessage(
            'API module STORAGE chưa khả dụng trên máy chủ. Vui lòng kiểm tra lại cấu hình backend Codex.',
          );
        } else {
          setErrorMessage(`Máy chủ trả về mã lỗi: ${res.status}`);
        }
      }
    } catch {
      setErrorMessage(
        'Không thể kết nối đến máy chủ API STORAGE. Vui lòng thử lại sau.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [folderId]);

  // Filtered Folders List
  const filteredFolders = useMemo(() => {
    return folders.filter((f) => {
      // Type filter
      if (typeFilter !== 'all' && f.folder_type !== typeFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = f.name.toLowerCase().includes(query);
        const matchesEmployee = (f.assigned_employee_name || '')
          .toLowerCase()
          .includes(query);
        if (!matchesName && !matchesEmployee) return false;
      }
      return true;
    });
  }, [folders, typeFilter, searchQuery]);

  // Client-side pagination over already-loaded arrays (no API change)
  const [folderPage, setFolderPage] = useState<number>(0);
  const [folderPageSize, setFolderPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);
  const folderPageSafe = clampPage(
    folderPage,
    filteredFolders.length,
    folderPageSize,
  );
  const pagedFolders = useMemo(
    () =>
      filteredFolders.slice(
        folderPageSafe * folderPageSize,
        (folderPageSafe + 1) * folderPageSize,
      ),
    [filteredFolders, folderPageSafe, folderPageSize],
  );
  const [outputPage, setOutputPage] = useState<number>(0);
  const [outputPageSize, setOutputPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);
  const outputList = selectedFolder?.outputs ?? [];
  const outputPageSafe = clampPage(
    outputPage,
    outputList.length,
    outputPageSize,
  );
  const pagedOutputs = useMemo(
    () =>
      outputList.slice(
        outputPageSafe * outputPageSize,
        (outputPageSafe + 1) * outputPageSize,
      ),
    [outputList, outputPageSafe, outputPageSize],
  );

  // KPI Metrics
  const metrics = useMemo(() => {
    const total = folders.length;
    let pendingDownload = 0;
    let pendingReview = 0;
    let readyToTrash = 0;

    for (const f of folders) {
      if (f.folder_type === 'source') {
        if (!f.staff_download_confirmed) {
          pendingDownload++;
        } else if (f.deliverable_count > 0 && !f.owner_review_confirmed) {
          pendingReview++;
        } else if (
          f.deliverable_count > 0 &&
          f.staff_download_confirmed &&
          f.owner_review_confirmed
        ) {
          readyToTrash++;
        }
      }
    }
    return { total, pendingDownload, pendingReview, readyToTrash };
  }, [folders]);

  // Handlers
  // Step 1: Owner creates source folder
  const handleCreateSourceFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim() || !newSourceDriveUrl.trim()) {
      setErrorMessage('Vui lòng nhập tên thư mục và liên kết Google Drive.');
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);

    const payload: CreateStorageFolderRequest = {
      name: newSourceName.trim(),
      drive_url: newSourceDriveUrl.trim(),
      folder_type: 'source',
      assigned_employee_ids:
        newSourceEmployeeIds.length > 0 ? newSourceEmployeeIds : undefined,
      assigned_employee_id:
        newSourceEmployeeIds.length > 0 ? newSourceEmployeeIds[0] : null,
      parent_folder_id: null,
      notes: newSourceNotes.trim() || null,
    };

    try {
      const res = await fetch('/api/v1/storage/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          'Đã tạo và giao thư mục gốc Google Drive thành công.',
        );
        setShowCreateSourceModal(false);
        setNewSourceName('');
        setNewSourceDriveUrl('');
        setNewSourceEmployeeIds([]);
        setNewSourceNotes('');
        loadData();
      } else {
        setErrorMessage(
          body.error?.message ||
            'Không thể tạo thư mục gốc. Vui lòng kiểm tra lại.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi kết nối tới API tạo thư mục gốc.');
    } finally {
      setActionLoading(false);
    }
  };

  // Step 2: Staff confirms download receipt
  const handleConfirmDownloadReceipt = async (folder: StorageFolderData) => {
    setActionLoading(true);
    setErrorMessage(null);

    const payload: CreateStorageReceiptRequest = {
      receipt_type: 'download',
      notes: 'Nhân sự đã mở Google Drive và tải toàn bộ tài liệu gốc.',
    };

    try {
      const res = await fetch(`/api/v1/storage/folders/${folder.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'If-Match': `"${folder.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage('Đã ghi nhận biên nhận tải thư mục gốc thành công.');
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể ghi nhận biên nhận tải thư mục.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi gửi biên nhận xác nhận tải.');
    } finally {
      setActionLoading(false);
    }
  };

  // Step 3: Staff creates deliverable folder
  const handleCreateDeliverableFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const parentId = deliverableParentFolderId || folderId;
    if (!parentId) {
      setErrorMessage('Vui lòng chọn thư mục gốc để liên kết thành phẩm.');
      return;
    }
    if (!deliverableName.trim() || !deliverableDriveUrl.trim()) {
      setErrorMessage(
        'Vui lòng nhập tên thư mục và đường dẫn Drive thành phẩm.',
      );
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);

    const payload: CreateStorageFolderRequest = {
      name: deliverableName.trim(),
      drive_url: deliverableDriveUrl.trim(),
      folder_type: 'deliverable',
      parent_folder_id: parentId,
      assignment_id: deliverableAssignmentId || null,
      notes: deliverableNotes.trim() || null,
    };

    try {
      const res = await fetch('/api/v1/storage/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage('Đã liên kết thư mục thành phẩm thành công.');
        setShowCreateDeliverableModal(false);
        setDeliverableName('');
        setDeliverableDriveUrl('');
        setDeliverableNotes('');
        setDeliverableAssignmentId('');
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể liên kết thư mục thành phẩm.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi kết nối tới API lưu thư mục thành phẩm.');
    } finally {
      setActionLoading(false);
    }
  };

  // Step 4: Owner downloads and confirms specific deliverable output at current revision
  const handleConfirmOutputReceipt = async (
    folder: StorageFolderData,
    output: StorageOutputData,
  ) => {
    setActionLoading(true);
    setErrorMessage(null);

    const payload: CreateStorageReceiptRequest = {
      receipt_type: 'deliverable_approval',
      output_id: output.id,
      revision_number: output.current_revision,
      notes: `Chủ sở hữu đã tải và duyệt thành phẩm "${output.name}" tại revision v${output.current_revision}.`,
    };

    try {
      const res = await fetch(`/api/v1/storage/folders/${folder.id}/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'If-Match': `"${folder.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          `Đã xác nhận tải và nghiệm thu thành phẩm "${output.name}" (v${output.current_revision}) thành công.`,
        );
        loadData();
      } else {
        setErrorMessage(
          body.error?.message ||
            'Không thể ghi nhận biên nhận duyệt thành phẩm.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi gửi biên nhận xác nhận thành phẩm.');
    } finally {
      setActionLoading(false);
    }
  };

  // Step 5A: Owner initiates trash request (Backend Delete-Readiness Verification)
  const handleInitiateTrashRequest = async (
    folder: StorageFolderDetailData,
  ) => {
    if (trashLockRef.current) return;

    // Check backend delete-readiness
    const readiness = folder.delete_readiness;
    if (!readiness || readiness.can_verify === false) {
      setErrorMessage(
        'Chưa thể xác minh điều kiện xóa từ máy chủ (Backend Delete-Readiness Unavailable). Nút chuyển vào thùng rác được khóa an toàn để ngăn xóa thiếu hoặc xóa nhầm.',
      );
      return;
    }

    if (!readiness.is_ready) {
      setErrorMessage(
        `Không thể chuyển nhóm thư mục vào thùng rác do vi phạm điều kiện an toàn:\n• ${readiness.block_reasons.join('\n• ')}`,
      );
      return;
    }

    trashLockRef.current = true;
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(
        `/api/v1/storage/folders/${folder.id}/trash-requests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            'If-Match': `"${folder.version}"`,
            'Idempotency-Key': `trash-init-${folder.id}-${folder.version}`,
          },
          credentials: 'include',
          body: JSON.stringify({
            version: folder.version,
            group_snapshot_hash: readiness.group_snapshot_hash,
          }),
        },
      );

      const body = await res.json();
      if (res.ok && body.success && body.data) {
        setTrashRequestData(body.data);
        setTrashAcknowledged(false);
        setShowTrashModal(true);
      } else {
        setErrorMessage(
          body.error?.message ||
            'Không thể tạo yêu cầu chuyển vào thùng rác Google Drive (Có thể do điều kiện an toàn bị chặn hoặc xung đột phiên bản).',
        );
      }
    } catch {
      setErrorMessage(
        'Lỗi mạng khi tạo yêu cầu chuyển vào thùng rác Google Drive.',
      );
    } finally {
      trashLockRef.current = false;
      setActionLoading(false);
    }
  };

  // Step 5B: Owner confirms trash request
  const handleConfirmTrash = async () => {
    if (trashLockRef.current) return;

    if (!trashRequestData || !trashAcknowledged) {
      setErrorMessage(
        'Vui lòng đánh dấu xác nhận cảnh báo rủi ro trước khi chuyển vào thùng rác.',
      );
      return;
    }

    trashLockRef.current = true;
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(
        `/api/v1/storage/trash-requests/${trashRequestData.trash_request_id}/confirm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            'Idempotency-Key': `trash-confirm-${trashRequestData.trash_request_id}`,
          },
          credentials: 'include',
          body: JSON.stringify({
            acknowledged: true,
            group_snapshot_hash: trashRequestData.group_snapshot_hash,
          }),
        },
      );

      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          'Đã chuyển nhóm thư mục vào thùng rác Google Drive thành công.',
        );
        setShowTrashModal(false);
        setTrashRequestData(null);
        if (folderId) {
          onNavigate?.('/storage');
        } else {
          loadData();
        }
      } else {
        setErrorMessage(
          body.error?.message ||
            'Không thể xác nhận chuyển nhóm thư mục vào thùng rác Google Drive.',
        );
      }
    } catch {
      setErrorMessage(
        'Lỗi mạng khi xác nhận chuyển nhóm thư mục vào thùng rác.',
      );
    } finally {
      trashLockRef.current = false;
      setActionLoading(false);
    }
  };

  // ==========================================
  // RENDER: DETAIL VIEW (/storage/:id)
  // ==========================================
  if (folderId) {
    if (loading) {
      return (
        <div
          style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}
        >
          <LoadingState message="Đang tải chi tiết nhóm thư mục..." />
        </div>
      );
    }

    if (!selectedFolder) {
      return (
        <div
          style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}
        >
          <ErrorState
            title="Không tìm thấy nhóm thư mục"
            message={
              errorMessage || 'Nhóm thư mục không tồn tại hoặc đã bị xóa.'
            }
          />
          <div style={{ marginTop: '16px' }}>
            <AppButton onClick={() => onNavigate?.('/storage')}>
              <ArrowLeftIcon size={16} />
              <span>Quay lại danh sách</span>
            </AppButton>
          </div>
        </div>
      );
    }

    // Backend Delete-Readiness state
    const readiness = selectedFolder.delete_readiness;
    const canVerify = Boolean(readiness && readiness.can_verify !== false);
    const isReady = Boolean(canVerify && readiness?.is_ready);

    return (
      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '24px 16px',
          color: '#F8FAFC',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => onNavigate?.('/storage')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: '#1E293B',
              color: '#94A3B8',
              border: '1px solid #334155',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            <ArrowLeftIcon size={14} />
            <span>Danh sách thư mục</span>
          </button>
        </div>

        <PageHeader
          title={`Thư mục: ${selectedFolder.name}`}
          subtitle="Quản lý từng assignment nhân sự, kiểm soát revision thành phẩm và dọn dẹp Google Drive (FILE-01 / STORAGE)"
          actions={
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <a
                href={selectedFolder.drive_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  backgroundColor: '#0284C7',
                  color: '#FFFFFF',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <LinkIcon size={14} />
                <span>Mở Google Drive</span>
              </a>

              {role === 'staff' && (
                <AppButton
                  variant="primary"
                  onClick={() => {
                    setDeliverableParentFolderId(selectedFolder.id);
                    setShowCreateDeliverableModal(true);
                  }}
                >
                  <PlusIcon size={16} />
                  <span>+ Nộp thành phẩm</span>
                </AppButton>
              )}
            </div>
          }
        />

        {/* Alerts */}
        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#F87171',
              marginBottom: '20px',
              fontSize: '13px',
              whiteSpace: 'pre-line',
            }}
          >
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              color: '#34D399',
              marginBottom: '20px',
              fontSize: '13px',
            }}
          >
            {successMessage}
          </div>
        )}

        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}
        >
          {/* 1. Metadata Overview */}
          <AppCard style={{ padding: '24px' }}>
            <h3
              style={{
                margin: '0 0 16px 0',
                fontSize: '16px',
                fontWeight: 700,
                color: '#F8FAFC',
              }}
            >
              Thông tin thư mục gốc
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                padding: '16px',
                backgroundColor: '#0F172A',
                borderRadius: '8px',
                border: '1px solid #1E293B',
                marginBottom: '16px',
                fontSize: '13px',
              }}
            >
              <div>
                <span style={{ color: '#94A3B8' }}>
                  Tổng nhân sự được giao:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <UserIcon size={14} style={{ color: '#38BDF8' }} />
                  <span>
                    {selectedFolder.assignments?.length ||
                      (selectedFolder.assigned_employee_name ? 1 : 0)}{' '}
                    nhân sự
                  </span>
                </div>
              </div>

              <div>
                <span style={{ color: '#94A3B8' }}>Số lượng thành phẩm:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {selectedFolder.outputs?.length ||
                    selectedFolder.deliverable_count ||
                    0}{' '}
                  thư mục
                </div>
              </div>

              <div>
                <span style={{ color: '#94A3B8' }}>
                  Phiên bản nhóm (Version):
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  v{selectedFolder.version}
                </div>
              </div>

              <div>
                <span style={{ color: '#94A3B8' }}>Ngày tạo:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {new Date(selectedFolder.created_at).toLocaleDateString(
                    'vi-VN',
                  )}
                </div>
              </div>
            </div>

            {selectedFolder.notes && (
              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Ghi chú:
                </span>
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: '14px',
                    color: '#CBD5E1',
                    lineHeight: '1.5',
                  }}
                >
                  {selectedFolder.notes}
                </p>
              </div>
            )}
          </AppCard>

          {/* 2. Assignments Tracking Card (Yêu cầu 1 & 2: Từng nhân sự) */}
          <AppCard style={{ padding: '24px' }}>
            <h3
              style={{
                margin: '0 0 16px 0',
                fontSize: '16px',
                fontWeight: 700,
                color: '#F8FAFC',
              }}
            >
              Phân công & Tải nguồn theo từng nhân sự (
              {selectedFolder.assignments?.length || 0})
            </h3>

            {!selectedFolder.assignments ||
            selectedFolder.assignments.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  backgroundColor: '#0F172A',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#94A3B8',
                  fontSize: '13px',
                }}
              >
                Chưa có phân công nhân sự cụ thể cho thư mục gốc này.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {selectedFolder.assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    style={{
                      padding: '12px 16px',
                      backgroundColor: '#0F172A',
                      border: '1px solid #1E293B',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '10px',
                      fontSize: '13px',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#F8FAFC' }}>
                        {assignment.employee_name}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#94A3B8',
                          marginTop: '2px',
                        }}
                      >
                        Trạng thái tải nguồn:{' '}
                        {assignment.source_download_confirmed ? (
                          <span style={{ color: '#34D399' }}>
                            Đã tải (
                            {assignment.source_downloaded_at
                              ? new Date(
                                  assignment.source_downloaded_at,
                                ).toLocaleDateString('vi-VN')
                              : 'Đã xác nhận'}
                            )
                          </span>
                        ) : (
                          <span style={{ color: '#FBBF24' }}>
                            Chưa tải nguồn
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      {assignment.output_delivered ? (
                        <StatusBadge
                          status="success"
                          label="Đã bàn giao output"
                        />
                      ) : (
                        <StatusBadge
                          status="warning"
                          label="Chưa bàn giao output"
                        />
                      )}

                      {!assignment.source_download_confirmed && (
                        <AppButton
                          variant="secondary"
                          onClick={() =>
                            handleConfirmDownloadReceipt(selectedFolder)
                          }
                          disabled={actionLoading}
                        >
                          <CheckCircleIcon size={14} />
                          <span>Xác nhận đã tải</span>
                        </AppButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AppCard>

          {/* 3. Outputs Tracking Card (Yêu cầu 1 & 3: Từng thành phẩm kèm Revision) */}
          <AppCard style={{ padding: '24px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  Danh sách thư mục thành phẩm (
                  {selectedFolder.outputs?.length || 0})
                </h3>
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: '12px',
                    color: '#94A3B8',
                  }}
                >
                  Mỗi thành phẩm bắt buộc có biên nhận Owner receipt đúng
                  revision hiện tại.
                </p>
              </div>

              <AppButton
                variant="secondary"
                onClick={() => {
                  setDeliverableParentFolderId(selectedFolder.id);
                  setShowCreateDeliverableModal(true);
                }}
              >
                <PlusIcon size={14} />
                <span>+ Nộp thành phẩm</span>
              </AppButton>
            </div>

            {!selectedFolder.outputs || selectedFolder.outputs.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  backgroundColor: '#0F172A',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#94A3B8',
                  fontSize: '13px',
                }}
              >
                Chưa có thư mục thành phẩm nào được nộp. Bấm "+ Nộp thành phẩm"
                để thêm liên kết Drive.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {pagedOutputs.map((output) => {
                  const isStale =
                    output.owner_receipt_confirmed &&
                    output.owner_receipt_revision !== output.current_revision;
                  const isApproved = output.owner_receipt_confirmed && !isStale;

                  return (
                    <div
                      key={output.id}
                      style={{
                        padding: '14px 16px',
                        backgroundColor: '#0F172A',
                        border: isStale
                          ? '1px solid #EAB308'
                          : isApproved
                            ? '1px solid rgba(16, 185, 129, 0.3)'
                            : '1px solid #1E293B',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '10px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '14px',
                            color: '#F8FAFC',
                          }}
                        >
                          {output.name} (v{output.current_revision})
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#94A3B8',
                            marginTop: '2px',
                          }}
                        >
                          Người nộp: {output.submitted_by_employee_name} • Ngày
                          tạo:{' '}
                          {new Date(output.created_at).toLocaleDateString(
                            'vi-VN',
                          )}
                        </div>

                        {/* Stale Revision Alert */}
                        {isStale && (
                          <div
                            style={{
                              marginTop: '6px',
                              fontSize: '11px',
                              color: '#FBBF24',
                              fontWeight: 600,
                            }}
                          >
                            ⚠️ Revision đã thay đổi sau khi duyệt (Đã duyệt v
                            {output.owner_receipt_revision}, hiện tại v
                            {output.current_revision}) - Cần duyệt lại!
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {isApproved ? (
                          <StatusBadge
                            status="success"
                            label={`Đã duyệt v${output.current_revision}`}
                          />
                        ) : isStale ? (
                          <StatusBadge
                            status="warning"
                            label="Lạc hậu revision"
                          />
                        ) : (
                          <StatusBadge status="neutral" label="Chưa duyệt" />
                        )}

                        <a
                          href={output.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '6px 10px',
                            backgroundColor: '#1E293B',
                            color: '#38BDF8',
                            border: '1px solid #334155',
                            borderRadius: '6px',
                            textDecoration: 'none',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          <LinkIcon size={12} />
                          <span>Mở Drive</span>
                        </a>

                        {role === 'owner' && !isApproved && (
                          <AppButton
                            variant="primary"
                            onClick={() =>
                              handleConfirmOutputReceipt(selectedFolder, output)
                            }
                            disabled={actionLoading}
                          >
                            <CheckIcon size={14} />
                            <span>Duyệt v{output.current_revision}</span>
                          </AppButton>
                        )}
                      </div>
                    </div>
                  );
                })}
                <Pagination
                  testId="storage-outputs-pager"
                  total={selectedFolder.outputs.length}
                  page={outputPageSafe}
                  pageSize={outputPageSize}
                  onPage={setOutputPage}
                  onPageSize={(n) => {
                    setOutputPageSize(n);
                    setOutputPage(0);
                  }}
                />
              </div>
            )}
          </AppCard>

          {/* 4. Backend Delete-Readiness & Safe Google Drive Trash Card (Yêu cầu 4, 5, 6, 7) */}
          {role === 'owner' && (
            <AppCard
              style={{
                padding: '24px',
                border: isReady ? '1px solid #EF4444' : '1px solid #EAB308',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ color: isReady ? '#EF4444' : '#EAB308' }}>
                  <ShieldAlertIcon size={20} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  Chuyển nhóm thư mục vào thùng rác Google Drive (Google Drive
                  Trash)
                </h3>
              </div>

              <p
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '13px',
                  color: '#94A3B8',
                  lineHeight: '1.5',
                }}
              >
                Theo quy định Doc 26, hệ thống chỉ cho phép chuyển vào thùng rác
                Google Drive khi máy chủ xác minh toàn bộ nhân viên được giao đã
                nộp và Owner đã duyệt từng thành phẩm đúng revision hiện tại.
              </p>

              {/* Status Section based on Backend Delete-Readiness */}
              {!canVerify ? (
                // Case A: Unverifiable / API Unavailable (Yêu cầu 5)
                <div
                  style={{
                    padding: '16px',
                    backgroundColor: 'rgba(100, 116, 139, 0.1)',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '13px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: '#94A3B8',
                      fontWeight: 700,
                      marginBottom: '6px',
                    }}
                  >
                    <AlertTriangleIcon size={16} />
                    <span>Chưa thể xác minh điều kiện xóa từ máy chủ</span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      color: '#CBD5E1',
                      lineHeight: '1.5',
                    }}
                  >
                    Dữ liệu đánh giá sẵn sàng xóa (delete-readiness) chưa được
                    cung cấp bởi API máy chủ. Để đảm bảo an toàn tuyệt đối và
                    ngăn ngừa xóa thiếu hoặc xóa nhầm, nút chuyển vào thùng rác
                    được khóa an toàn.
                  </p>
                </div>
              ) : !isReady ? (
                // Case B: Not ready (Has block reasons)
                <div
                  style={{
                    padding: '16px',
                    backgroundColor: '#0F172A',
                    borderRadius: '8px',
                    border: '1px solid #1E293B',
                    marginBottom: '16px',
                    fontSize: '13px',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      color: '#FBBF24',
                      marginBottom: '10px',
                    }}
                  >
                    Chưa đủ điều kiện chuyển vào thùng rác Google Drive (Khóa an
                    toàn):
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '20px',
                      color: '#F87171',
                      lineHeight: '1.6',
                    }}
                  >
                    {readiness?.block_reasons?.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    )) || <li>Dữ liệu chưa hoàn tất.</li>}
                  </ul>
                </div>
              ) : (
                // Case C: Ready for Trash
                <div
                  style={{
                    padding: '14px 16px',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#34D399',
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                    ✓ Đủ điều kiện chuyển vào thùng rác Google Drive
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: '12px' }}>
                    Tất cả nhân sự ({readiness?.total_assignments}) đã bàn giao
                    output. Tất cả thành phẩm ({readiness?.total_outputs}) đã
                    được Owner nghiệm thu đúng revision hiện hành.
                    <br />
                    Mã bảo vệ Concurrency:{' '}
                    <code>{readiness?.group_snapshot_hash}</code>
                  </div>
                </div>
              )}

              {/* Action Button */}
              {isReady ? (
                <AppButton
                  variant="destructive"
                  onClick={() => handleInitiateTrashRequest(selectedFolder)}
                  disabled={actionLoading}
                >
                  <AlertTriangleIcon size={16} />
                  <span>
                    Chuyển nhóm thư mục vào thùng rác Google Drive (2 bước)
                  </span>
                </AppButton>
              ) : (
                <AppButton variant="destructive" disabled>
                  <AlertTriangleIcon size={16} />
                  <span>
                    Chuyển vào thùng rác Google Drive (Bị khóa an toàn)
                  </span>
                </AppButton>
              )}
            </AppCard>
          )}
        </div>

        {/* Modal 2: Create Deliverable Folder */}
        {showCreateDeliverableModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: '#1E293B',
                borderRadius: '12px',
                border: '1px solid #334155',
                width: '100%',
                maxWidth: '480px',
                padding: '24px',
              }}
            >
              <h3
                style={{
                  margin: '0 0 16px 0',
                  fontSize: '18px',
                  fontWeight: 700,
                }}
              >
                Nộp thư mục thành phẩm
              </h3>

              <form onSubmit={handleCreateDeliverableFolder}>
                {selectedFolder.assignments &&
                  selectedFolder.assignments.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '13px',
                          color: '#94A3B8',
                          marginBottom: '6px',
                        }}
                      >
                        Chọn nhân sự bàn giao *
                      </label>
                      <select
                        value={deliverableAssignmentId}
                        onChange={(e) =>
                          setDeliverableAssignmentId(e.target.value)
                        }
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          backgroundColor: '#0F172A',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          color: '#F8FAFC',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="">-- Chọn nhân sự bàn giao --</option>
                        {selectedFolder.assignments.map((asgn) => (
                          <option key={asgn.id} value={asgn.id}>
                            {asgn.employee_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Tên thư mục thành phẩm *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Video Hoàn Chỉnh - Bản Đã Edit v1"
                    value={deliverableName}
                    onChange={(e) => setDeliverableName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#0F172A',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#F8FAFC',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Đường dẫn Google Drive thành phẩm *
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={deliverableDriveUrl}
                    onChange={(e) => setDeliverableDriveUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#0F172A',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#F8FAFC',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Ghi chú nộp bài
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Ghi chú về file render, định dạng, v.v."
                    value={deliverableNotes}
                    onChange={(e) => setDeliverableNotes(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      backgroundColor: '#0F172A',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#F8FAFC',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '10px',
                  }}
                >
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowCreateDeliverableModal(false)}
                  >
                    Hủy
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="primary"
                    disabled={actionLoading}
                  >
                    Lưu thành phẩm
                  </AppButton>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 3: Two-step Google Drive Trash Confirmation (Yêu cầu 6 & 7) */}
        {showTrashModal && trashRequestData && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: '#1E293B',
                borderRadius: '12px',
                border: '1px solid #EF4444',
                width: '100%',
                maxWidth: '480px',
                padding: '24px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ color: '#EF4444' }}>
                  <AlertTriangleIcon size={24} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#EF4444',
                  }}
                >
                  Chuyển nhóm thư mục vào thùng rác Google Drive (Bước 2/2)
                </h3>
              </div>

              <div
                style={{
                  padding: '14px',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#FCA5A5',
                  lineHeight: '1.5',
                }}
              >
                Cảnh báo: Toàn bộ nhóm thư mục gốc và các thư mục thành phẩm
                liên kết trên Google Drive sẽ được chuyển vào thùng rác Google
                Drive (Google Drive Trash). Thao tác này dọn dẹp các thư mục
                trên bộ nhớ Drive theo chính sách lưu trữ của Google.
              </div>

              <p
                style={{
                  fontSize: '13px',
                  color: '#94A3B8',
                  marginBottom: '16px',
                }}
              >
                Nhóm thư mục: <strong>{trashRequestData.folder_name}</strong>
                <br />
                Số lượng thành phẩm ảnh hưởng:{' '}
                <strong>
                  {trashRequestData.deliverables_affected_count} thư mục
                </strong>
                <br />
                Mã bảo vệ Concurrency:{' '}
                <code>{trashRequestData.group_snapshot_hash}</code>
              </p>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  cursor: 'pointer',
                  marginBottom: '24px',
                  fontSize: '13px',
                  color: '#F8FAFC',
                }}
              >
                <input
                  type="checkbox"
                  checked={trashAcknowledged}
                  onChange={(e) => setTrashAcknowledged(e.target.checked)}
                  style={{ marginTop: '2px' }}
                />
                <span>
                  Tôi đã kiểm tra kỹ lưỡng danh sách thành phẩm và xác nhận
                  chuyển toàn bộ nhóm thư mục này vào thùng rác Google Drive.
                </span>
              </label>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                }}
              >
                <AppButton
                  variant="secondary"
                  onClick={() => setShowTrashModal(false)}
                >
                  Hủy bỏ
                </AppButton>
                <AppButton
                  variant="destructive"
                  onClick={handleConfirmTrash}
                  disabled={!trashAcknowledged || actionLoading}
                >
                  Xác nhận chuyển vào Google Drive Trash
                </AppButton>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: LIST VIEW (/storage)
  // ==========================================
  return (
    <div
      style={{
        maxWidth: '1000px',
        margin: '0 auto',
        padding: '24px 16px',
        color: '#F8FAFC',
      }}
    >
      {/* 1. Page Header */}
      <PageHeader
        title="Quản lý Tệp & Drive (STORAGE)"
        subtitle="Quản lý thư mục gốc Google Drive, bàn giao nhân sự và nghiệm thu thành phẩm (FILE-01)"
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {role === 'owner' && (
              <AppButton
                variant="primary"
                onClick={() => setShowCreateSourceModal(true)}
                disabled={loading}
              >
                <PlusIcon size={16} />
                <span>+ Giao thư mục gốc</span>
              </AppButton>
            )}

            <AppButton
              variant="secondary"
              onClick={() => {
                setDeliverableParentFolderId('');
                setShowCreateDeliverableModal(true);
              }}
              disabled={loading}
            >
              <PlusIcon size={16} />
              <span>+ Nộp thành phẩm</span>
            </AppButton>
          </div>
        }
      />

      {/* 2. KPI Metrics Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '14px',
          marginBottom: '24px',
        }}
      >
        <AppCard style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
            Tổng nhóm thư mục
          </span>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#38BDF8',
              marginTop: '4px',
            }}
          >
            {metrics.total}
          </div>
        </AppCard>

        <AppCard style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
            Chờ tải gốc
          </span>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#FBBF24',
              marginTop: '4px',
            }}
          >
            {metrics.pendingDownload}
          </div>
        </AppCard>

        <AppCard style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
            Chờ duyệt thành phẩm
          </span>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#A855F7',
              marginTop: '4px',
            }}
          >
            {metrics.pendingReview}
          </div>
        </AppCard>

        <AppCard style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>
            Đủ điều kiện dọn dẹp
          </span>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#34D399',
              marginTop: '4px',
            }}
          >
            {metrics.readyToTrash}
          </div>
        </AppCard>
      </div>

      {/* 3. Alerts */}
      {errorMessage && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: '#F87171',
            marginBottom: '20px',
            fontSize: '13px',
            whiteSpace: 'pre-line',
          }}
        >
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            color: '#34D399',
            marginBottom: '20px',
            fontSize: '13px',
          }}
        >
          {successMessage}
        </div>
      )}

      {/* 4. Filter & Search Bar */}
      <AppCard style={{ padding: '16px', marginBottom: '24px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setTypeFilter('all');
                setFolderPage(0);
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: typeFilter === 'all' ? '#14B8A6' : '#1E293B',
                color: typeFilter === 'all' ? '#0F172A' : '#94A3B8',
              }}
            >
              Tất cả
            </button>
            <button
              type="button"
              onClick={() => {
                setTypeFilter('source');
                setFolderPage(0);
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor:
                  typeFilter === 'source' ? '#14B8A6' : '#1E293B',
                color: typeFilter === 'source' ? '#0F172A' : '#94A3B8',
              }}
            >
              Thư mục gốc
            </button>
            <button
              type="button"
              onClick={() => {
                setTypeFilter('deliverable');
                setFolderPage(0);
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor:
                  typeFilter === 'deliverable' ? '#14B8A6' : '#1E293B',
                color: typeFilter === 'deliverable' ? '#0F172A' : '#94A3B8',
              }}
            >
              Thành phẩm
            </button>
          </div>

          <div
            style={{
              position: 'relative',
              minWidth: '220px',
              flex: '1',
              maxWidth: '350px',
            }}
          >
            <input
              type="text"
              data-testid="storage-search-input"
              placeholder="Tìm theo tên thư mục..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setFolderPage(0);
              }}
              style={{
                width: '100%',
                padding: '8px 12px 8px 34px',
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#F8FAFC',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748B',
              }}
            >
              <SearchIcon size={14} />
            </div>
          </div>
        </div>
      </AppCard>

      {/* 5. Folders Table / List View */}
      {loading ? (
        <LoadingState message="Đang tải danh sách thư mục Drive..." />
      ) : folders.length === 0 ? (
        <EmptyState
          title="Chưa có thư mục nào"
          description="Chưa có thư mục Drive nào trong workspace. Hãy bấm '+ Giao thư mục gốc' để bắt đầu."
          action={
            role === 'owner' ? (
              <AppButton
                variant="primary"
                onClick={() => setShowCreateSourceModal(true)}
              >
                <PlusIcon size={16} />
                <span>Giao thư mục gốc ngay</span>
              </AppButton>
            ) : undefined
          }
        />
      ) : filteredFolders.length === 0 ? (
        <div data-testid="storage-empty-search">
          <EmptyState
            title="Không tìm thấy thư mục phù hợp"
            description={`Không có thư mục nào khớp với từ khóa "${searchQuery || 'đang chọn'}" hoặc bộ lọc hiện tại.`}
            action={
              <AppButton
                variant="secondary"
                onClick={() => {
                  setSearchQuery('');
                  setTypeFilter('all');
                  setFolderPage(0);
                }}
              >
                Đặt lại bộ lọc
              </AppButton>
            }
          />
        </div>
      ) : (
        <AppCard style={{ padding: 0, overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid #334155',
                  backgroundColor: '#0F172A',
                }}
              >
                <th style={{ padding: '12px 16px', color: '#94A3B8' }}>
                  Tên thư mục
                </th>
                <th style={{ padding: '12px 16px', color: '#94A3B8' }}>Loại</th>
                <th style={{ padding: '12px 16px', color: '#94A3B8' }}>
                  Nhân sự
                </th>
                <th style={{ padding: '12px 16px', color: '#94A3B8' }}>
                  Tải gốc
                </th>
                <th style={{ padding: '12px 16px', color: '#94A3B8' }}>
                  Thành phẩm
                </th>
                <th style={{ padding: '12px 16px', color: '#94A3B8' }}>
                  Duyệt
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    color: '#94A3B8',
                    textAlign: 'right',
                  }}
                >
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedFolders.map((folder) => {
                return (
                  <tr
                    key={folder.id}
                    style={{
                      borderBottom: '1px solid #334155',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                      <div style={{ color: '#F8FAFC' }}>{folder.name}</div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#64748B',
                          marginTop: '2px',
                        }}
                      >
                        v{folder.version} • Tạo{' '}
                        {new Date(folder.created_at).toLocaleDateString(
                          'vi-VN',
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor:
                            folder.folder_type === 'source'
                              ? 'rgba(56, 189, 248, 0.1)'
                              : 'rgba(168, 85, 247, 0.1)',
                          color:
                            folder.folder_type === 'source'
                              ? '#38BDF8'
                              : '#A855F7',
                          border: `1px solid ${
                            folder.folder_type === 'source'
                              ? 'rgba(56, 189, 248, 0.3)'
                              : 'rgba(168, 85, 247, 0.3)'
                          }`,
                        }}
                      >
                        {folder.folder_type === 'source'
                          ? 'Thư mục gốc'
                          : 'Thành phẩm'}
                      </span>
                    </td>

                    <td style={{ padding: '12px 16px', color: '#E2E8F0' }}>
                      {folder.assigned_employee_name || '-'}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      {folder.staff_download_confirmed ? (
                        <StatusBadge status="success" label="Đã tải" />
                      ) : (
                        <StatusBadge status="warning" label="Chưa tải" />
                      )}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontWeight: 600, color: '#38BDF8' }}>
                        {folder.deliverable_count} thư mục
                      </span>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      {folder.owner_review_confirmed ? (
                        <StatusBadge status="success" label="Đã duyệt" />
                      ) : (
                        <StatusBadge status="neutral" label="Chờ duyệt" />
                      )}
                    </td>

                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div
                        style={{
                          display: 'inline-flex',
                          gap: '6px',
                          alignItems: 'center',
                        }}
                      >
                        <a
                          href={folder.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '4px 8px',
                            backgroundColor: '#1E293B',
                            color: '#38BDF8',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            textDecoration: 'none',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          Drive
                        </a>

                        <ActionIconButton
                          action="view"
                          target={folder.name}
                          testId={`storage-folder-view-${folder.id}`}
                          onClick={() => onNavigate?.(`/storage/${folder.id}`)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px' }}>
            <Pagination
              testId="storage-folders-pager"
              total={filteredFolders.length}
              page={folderPageSafe}
              pageSize={folderPageSize}
              onPage={setFolderPage}
              onPageSize={(n) => {
                setFolderPageSize(n);
                setFolderPage(0);
              }}
            />
          </div>
        </AppCard>
      )}

      {/* Modal 1: Create Source Folder (Owner Only) */}
      {showCreateSourceModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#1E293B',
              borderRadius: '12px',
              border: '1px solid #334155',
              width: '100%',
              maxWidth: '500px',
              padding: '24px',
            }}
          >
            <h3
              style={{
                margin: '0 0 16px 0',
                fontSize: '18px',
                fontWeight: 700,
              }}
            >
              Giao thư mục gốc Google Drive
            </h3>

            <form onSubmit={handleCreateSourceFolder}>
              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Tên nhóm thư mục *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Video Raw Tháng 10 - Gói Quảng Cáo"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Liên kết Google Drive gốc *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={newSourceDriveUrl}
                  onChange={(e) => setNewSourceDriveUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Giao cho nhân sự (có thể chọn nhiều người)
                </label>
                {employeesError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      marginBottom: '8px',
                      backgroundColor: '#451A1A',
                      border: '1px solid #7F1D1D',
                      borderRadius: '6px',
                      color: '#FCA5A5',
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
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        minHeight: '36px',
                        minWidth: '44px',
                      }}
                    >
                      {employeesLoading ? 'Đang tải...' : 'Thử lại'}
                    </button>
                  </div>
                )}
                <select
                  multiple
                  value={newSourceEmployeeIds}
                  onChange={(e) => {
                    const selected = Array.from(
                      e.target.selectedOptions,
                      (opt) => opt.value,
                    );
                    setNewSourceEmployeeIds(selected);
                  }}
                  style={{
                    width: '100%',
                    height: '90px',
                    padding: '8px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#64748B',
                    marginTop: '4px',
                  }}
                >
                  Giữ phím Cmd (Mac) hoặc Ctrl (Windows) để chọn nhiều nhân sự.
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú hướng dẫn
                </label>
                <textarea
                  rows={3}
                  placeholder="Ghi chú yêu cầu tải, định dạng video..."
                  value={newSourceNotes}
                  onChange={(e) => setNewSourceNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                }}
              >
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreateSourceModal(false)}
                >
                  Hủy
                </AppButton>
                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={actionLoading}
                >
                  Tạo & Giao thư mục
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Create Deliverable Folder (when initiated from list view) */}
      {showCreateDeliverableModal && !folderId && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#1E293B',
              borderRadius: '12px',
              border: '1px solid #334155',
              width: '100%',
              maxWidth: '480px',
              padding: '24px',
            }}
          >
            <h3
              style={{
                margin: '0 0 16px 0',
                fontSize: '18px',
                fontWeight: 700,
              }}
            >
              Nộp thư mục thành phẩm
            </h3>

            <form onSubmit={handleCreateDeliverableFolder}>
              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Chọn thư mục gốc liên kết *
                </label>
                <select
                  required
                  value={deliverableParentFolderId}
                  onChange={(e) => setDeliverableParentFolderId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="">-- Chọn thư mục gốc --</option>
                  {folders
                    .filter((f) => f.folder_type === 'source')
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} (v{f.version})
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Tên thư mục thành phẩm *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Video Đã Edit - Hoàn Thiện"
                  value={deliverableName}
                  onChange={(e) => setDeliverableName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Đường dẫn Google Drive thành phẩm *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={deliverableDriveUrl}
                  onChange={(e) => setDeliverableDriveUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú nộp bài
                </label>
                <textarea
                  rows={3}
                  placeholder="Ghi chú về file render..."
                  value={deliverableNotes}
                  onChange={(e) => setDeliverableNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                }}
              >
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreateDeliverableModal(false)}
                >
                  Hủy
                </AppButton>
                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={actionLoading}
                >
                  Lưu thành phẩm
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
