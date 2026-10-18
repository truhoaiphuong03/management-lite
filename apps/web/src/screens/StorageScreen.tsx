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
  StorageFileData,
  StorageDriveConnectionData,
  StoragePermissionGrantData,
  DrivePermissionRole,
  CreateStorageFolderRequest,
  CreateStorageReceiptRequest,
  CreateTrashRequestResponseData,
} from '../../../../packages/contracts/src/index.js';
import type { UserRole } from '../types.js';

export interface StorageScreenProps {
  role?: UserRole;
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
  const [driveConnection, setDriveConnection] =
    useState<StorageDriveConnectionData | null>(null);
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

  // Modal 0: Google Drive OAuth 2.0 Connection Modal (Owner Only)
  const [showDriveOAuthModal, setShowDriveOAuthModal] =
    useState<boolean>(false);
  const [oauthUrlPreview, setOauthUrlPreview] = useState<string>('');
  const [oauthState, setOauthState] = useState<string>('');
  const [oauthGoogleEmail, setOauthGoogleEmail] = useState<string>(
    'drive-admin@hoaiphuong.click',
  );
  const [oauthCode, setOauthCode] = useState<string>(
    '4/0AVGzR1-google-oauth-code',
  );
  const [oauthRootFolderName, setOauthRootFolderName] = useState<string>(
    'Management Lite - Google Drive Root',
  );

  // Modal 1: Create Source Folder on Google Drive (Owner Only)
  const [showCreateSourceModal, setShowCreateSourceModal] =
    useState<boolean>(false);
  const [newSourceName, setNewSourceName] = useState<string>('');
  const [newSourceCreateOnDrive, setNewSourceCreateOnDrive] =
    useState<boolean>(true);
  const [newSourceDriveUrl, setNewSourceDriveUrl] = useState<string>('');
  const [newSourceEmployeeIds, setNewSourceEmployeeIds] = useState<string[]>(
    [],
  );
  const [newSourcePermissionRole, setNewSourcePermissionRole] =
    useState<DrivePermissionRole>('reader');
  const [newSourceNotes, setNewSourceNotes] = useState<string>('');

  // Modal 2: Create Deliverable Folder (Staff or Owner)
  const [showCreateDeliverableModal, setShowCreateDeliverableModal] =
    useState<boolean>(false);
  const [deliverableParentFolderId, setDeliverableParentFolderId] =
    useState<string>('');
  const [deliverableAssignmentId, setDeliverableAssignmentId] =
    useState<string>('');
  const [deliverableName, setDeliverableName] = useState<string>('');
  const [deliverableCreateOnDrive, setDeliverableCreateOnDrive] =
    useState<boolean>(true);
  const [deliverableDriveUrl, setDeliverableDriveUrl] = useState<string>('');
  const [deliverableNotes, setDeliverableNotes] = useState<string>('');

  // Modal 3: Two-step Google Drive Trash Confirmation (Owner Only)
  const [showTrashModal, setShowTrashModal] = useState<boolean>(false);
  const [trashRequestData, setTrashRequestData] =
    useState<CreateTrashRequestResponseData | null>(null);
  const [trashAcknowledged, setTrashAcknowledged] = useState<boolean>(false);

  // Modal 4: Resumable Video Upload to Google Drive
  const [showUploadVideoModal, setShowUploadVideoModal] =
    useState<boolean>(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>('');
  const [uploadVideoName, setUploadVideoName] = useState<string>('');
  const [uploadVideoSizeMB, setUploadVideoSizeMB] = useState<string>('25');
  const [uploadVideoMimeType, setUploadVideoMimeType] =
    useState<string>('video/mp4');
  const [uploadAssignedEmployeeId, setUploadAssignedEmployeeId] =
    useState<string>('');
  const [uploadPermissionRole, setUploadPermissionRole] =
    useState<DrivePermissionRole>('reader');
  const [uploadProgressPct, setUploadProgressPct] = useState<number>(0);
  const [uploadStatusText, setUploadStatusText] = useState<string>('');
  const [uploadSelectedFile, setUploadSelectedFile] = useState<File | null>(
    null,
  );

  // Staff Permission Grant form states (in Folder Detail view)
  const [grantEmployeeId, setGrantEmployeeId] = useState<string>('');
  const [grantRole, setGrantRole] = useState<DrivePermissionRole>('reader');

  // Q65-05: Multi-page employee selector generation and abort management
  const employeesFetchIdRef = useRef<number>(0);
  const employeesAbortControllerRef = useRef<AbortController | null>(null);
  const trashLockRef = useRef<boolean>(false);

  // 1. Fetch CSRF token, Google Drive OAuth status & Employee List
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (typeof window !== 'undefined' && role === 'owner') {
      const searchParams = new URLSearchParams(window.location.search);
      const returnedCode =
        searchParams.get('oauth_code') || searchParams.get('code');
      const returnedState =
        searchParams.get('oauth_state') || searchParams.get('state');
      if (returnedCode) {
        setOauthCode(returnedCode);
        if (returnedState) setOauthState(returnedState);
        setShowDriveOAuthModal(true);
      }
    }

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

        const connRes = await fetch('/api/v1/storage/drive/connection', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (connRes.ok && active) {
          const connBody = await connRes.json();
          if (connBody.success && connBody.data) {
            setDriveConnection(connBody.data);
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

  // Normalize V2 folder detail data so both V1 and V2 fields are always populated
  const normalizeFolderDetail = (
    raw: StorageFolderDetailData,
  ): StorageFolderDetailData => {
    const deliverables = raw.deliverables ?? raw.deliverable_folders ?? [];
    const outputs: StorageOutputData[] =
      raw.outputs && raw.outputs.length > 0
        ? raw.outputs
        : deliverables.map((d) => ({
            id: d.id,
            parent_folder_id: d.parent_folder_id ?? raw.id,
            assignment_id: d.assignment_id ?? null,
            submitted_by_employee_id: d.created_by_employee_id ?? '',
            submitted_by_employee_name:
              d.assigned_employee_name ??
              d.created_by_employee_id ??
              'Nhân sự thực hiện',
            name: d.name,
            drive_url: d.drive_url,
            current_revision: d.current_revision_number ?? 1,
            owner_receipt_confirmed: Boolean(d.owner_receipt_confirmed),
            owner_receipt_revision: d.owner_receipt_revision ?? null,
            owner_reviewed_at: d.owner_reviewed_at ?? null,
            notes: d.notes ?? null,
            created_at: d.created_at,
            updated_at: d.updated_at,
          }));

    const readiness = raw.delete_readiness
      ? {
          ...raw.delete_readiness,
          can_verify: raw.delete_readiness.can_verify ?? true,
          block_reasons:
            raw.delete_readiness.block_reasons ??
            raw.delete_readiness.reasons ??
            [],
          total_outputs:
            raw.delete_readiness.total_outputs ??
            raw.delete_readiness.deliverables_total ??
            outputs.length,
          total_assignments:
            raw.delete_readiness.total_assignments ??
            (raw.assignments?.length ||
              raw.assigned_employee_ids?.length ||
              (raw.assigned_employee_id ? 1 : 0)),
        }
      : undefined;

    return {
      ...raw,
      deliverables,
      outputs,
      delete_readiness: readiness,
      deliverable_count:
        raw.deliverable_count ?? deliverables.length ?? outputs.length,
      staff_download_confirmed:
        raw.staff_download_confirmed ??
        Boolean(raw.staff_source_acknowledged),
      owner_review_confirmed:
        raw.owner_review_confirmed ??
        Boolean(
          deliverables.length > 0 &&
            deliverables.every((d) => d.owner_receipt_confirmed),
        ),
    };
  };

  // 2. Fetch Folders list or Selected Folder detail
  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      if (folderId) {
        const res = await fetch(`/api/v1/storage/folders/${folderId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data) {
            setSelectedFolder(normalizeFolderDetail(body.data));
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
        const res = await fetch('/api/v1/storage/folders', {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && Array.isArray(body.data)) {
            setFolders(
              body.data.map((f: StorageFolderDetailData) =>
                normalizeFolderDetail(f),
              ),
            );
          } else {
            setErrorMessage(
              body.error?.message || 'Không thể tải danh sách thư mục.',
            );
          }
        } else if (res.status === 404 || res.status === 501) {
          setErrorMessage(
            'API module STORAGE chưa khả dụng trên máy chủ. Vui lòng kiểm tra lại cấu hình máy chủ API.',
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
      if (typeFilter !== 'all' && f.folder_type !== typeFilter) {
        return false;
      }
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

  // Client-side pagination over already-loaded arrays
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
        const isAck =
          Boolean(f.staff_download_confirmed) ||
          Boolean(f.staff_source_acknowledged);
        const delivCnt =
          f.deliverable_count ?? f.deliverables?.length ?? 0;
        const isReviewed =
          Boolean(f.owner_review_confirmed) ||
          Boolean(f.delete_readiness?.is_ready);
        if (!isAck) {
          pendingDownload++;
        } else if (delivCnt > 0 && !isReviewed) {
          pendingReview++;
        } else if (delivCnt > 0 && isAck && isReviewed) {
          readyToTrash++;
        }
      }
    }
    return { total, pendingDownload, pendingReview, readyToTrash };
  }, [folders]);

  // ==========================================
  // GOOGLE DRIVE OAUTH 2.0 HANDLERS
  // ==========================================
  const handlePreviewOAuthUrl = async () => {
    setErrorMessage(null);
    try {
      const res = await fetch('/api/v1/storage/drive/oauth/url', {
        credentials: 'include',
      });
      const body = await res.json();
      if (res.ok && body.success && body.data?.auth_url) {
        setOauthUrlPreview(body.data.auth_url);
        if (body.data.state) {
          setOauthState(body.data.state);
        }
      }
    } catch {
      setErrorMessage('Không thể khởi tạo URL ủy quyền Google OAuth 2.0.');
    }
  };

  const handleConnectDriveOAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMessage(null);
    try {
      let resolvedState = oauthState.trim();
      if (!resolvedState) {
        const urlRes = await fetch('/api/v1/storage/drive/oauth/url', {
          credentials: 'include',
        });
        const urlBody = await urlRes.json();
        if (urlRes.ok && urlBody.success && urlBody.data?.state) {
          resolvedState = String(urlBody.data.state).trim();
          setOauthState(resolvedState);
        }
      }
      const res = await fetch('/api/v1/storage/drive/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          code: oauthCode.trim() || '4/0AVGzR1-google-oauth-code',
          state: resolvedState,
          google_email: oauthGoogleEmail.trim(),
          root_folder_name: oauthRootFolderName.trim(),
          scopes: ['https://www.googleapis.com/auth/drive.file'],
        }),
      });
      const body = await res.json();
      if (res.ok && body.success && body.data) {
        setDriveConnection(body.data);
        setShowDriveOAuthModal(false);
        setSuccessMessage(
          `Đã kết nối Google Drive (${body.data.google_email}) với quyền tối thiểu drive.file và mã hóa refresh token thành công.`,
        );
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể kết nối Google Drive OAuth 2.0.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi kết nối Google Drive OAuth 2.0.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnectDriveOAuth = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/v1/storage/drive/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
      });
      const body = await res.json();
      if (res.ok && body.success && body.data) {
        setDriveConnection(body.data);
        setShowDriveOAuthModal(false);
        setSuccessMessage('Đã ngắt kết nối Google Drive và xóa khóa phiên.');
      }
    } catch {
      setErrorMessage('Không thể ngắt kết nối Google Drive.');
    } finally {
      setActionLoading(false);
    }
  };

  // ==========================================
  // FOLDER & PERMISSION HANDLERS
  // ==========================================
  const handleCreateSourceFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim()) {
      setErrorMessage('Vui lòng nhập tên thư mục.');
      return;
    }
    if (!newSourceCreateOnDrive && !newSourceDriveUrl.trim()) {
      setErrorMessage(
        'Vui lòng nhập liên kết Google Drive hoặc bật tự động tạo thư mục trên Google Drive.',
      );
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);

    const payload: CreateStorageFolderRequest = {
      name: newSourceName.trim(),
      create_on_drive: newSourceCreateOnDrive,
      ...(newSourceCreateOnDrive
        ? {}
        : { drive_url: newSourceDriveUrl.trim() }),
      folder_type: 'source',
      ...(newSourceEmployeeIds.length > 0
        ? { assigned_employee_ids: newSourceEmployeeIds }
        : {}),
      assigned_employee_id:
        newSourceEmployeeIds.length > 0 ? (newSourceEmployeeIds[0] ?? null) : null,
      permission_role: newSourcePermissionRole,
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
          newSourceCreateOnDrive
            ? 'Đã tự động tạo thư mục trên Google Drive và phân quyền nhân viên thành công.'
            : 'Đã tạo và giao thư mục gốc Google Drive thành công.',
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
      receipt_type: 'staff_source_ack',
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
    if (!deliverableName.trim()) {
      setErrorMessage('Vui lòng nhập tên thư mục thành phẩm.');
      return;
    }
    if (!deliverableCreateOnDrive && !deliverableDriveUrl.trim()) {
      setErrorMessage(
        'Vui lòng nhập đường dẫn Drive thành phẩm hoặc bật tự động tạo trên Google Drive.',
      );
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);

    const payload: CreateStorageFolderRequest = {
      name: deliverableName.trim(),
      create_on_drive: deliverableCreateOnDrive,
      ...(deliverableCreateOnDrive
        ? {}
        : { drive_url: deliverableDriveUrl.trim() }),
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
        setSuccessMessage('Đã tạo và liên kết thư mục thành phẩm thành công.');
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
      receipt_type: 'owner_deliverable_review',
      output_id: output.id,
      revision_number: output.current_revision,
      notes: `Chủ sở hữu đã tải và duyệt thành phẩm "${output.name}" tại revision v${output.current_revision}.`,
    };

    try {
      const res = await fetch(`/api/v1/storage/folders/${output.id}/receipts`, {
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

  // ==========================================
  // RESUMABLE VIDEO UPLOAD & SYNC HANDLERS
  // ==========================================
  const readFileSliceBase64 = async (
    file: File,
    start: number,
    end: number,
  ): Promise<string> => {
    const buf = await file.slice(start, end).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
  };

  const handleUploadVideoToDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetFolder = uploadTargetFolderId || folderId;
    if (!targetFolder) {
      setErrorMessage('Vui lòng chọn thư mục đích để tải video lên Google Drive.');
      return;
    }
    if (!uploadVideoName.trim()) {
      setErrorMessage('Vui lòng nhập tên tệp video.');
      return;
    }
    const sizeMB = Number(uploadVideoSizeMB);
    const sizeBytes =
      uploadSelectedFile && uploadSelectedFile.size > 0
        ? uploadSelectedFile.size
        : Number.isFinite(sizeMB) && sizeMB > 0
          ? Math.round(sizeMB * 1024 * 1024)
          : 10 * 1024 * 1024;

    setActionLoading(true);
    setErrorMessage(null);
    setUploadProgressPct(10);
    setUploadStatusText('Đang khởi tạo phiên Resumable Upload với Google Drive...');

    try {
      const initRes = await fetch(
        `/api/v1/storage/folders/${targetFolder}/files/upload-sessions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            name: uploadVideoName.trim(),
            size_bytes: sizeBytes,
            mime_type: uploadVideoMimeType || 'video/mp4',
            assigned_employee_id: uploadAssignedEmployeeId || null,
            permission_role: uploadPermissionRole,
          }),
        },
      );
      const initBody = await initRes.json();
      if (!initRes.ok || !initBody.success || !initBody.data) {
        setErrorMessage(
          initBody.error?.message ||
            'Không thể khởi tạo phiên Resumable Upload trên Google Drive.',
        );
        setUploadProgressPct(0);
        setUploadStatusText('');
        return;
      }

      const fileRecord: StorageFileData = initBody.data;
      const halfChunk = Math.ceil(sizeBytes / 2);
      setUploadProgressPct(50);
      setUploadStatusText('Đang tải chunk 1/2 lên Google Drive...');

      const chunk1Base64 =
        uploadSelectedFile && uploadSelectedFile.size <= 10 * 1024 * 1024
          ? await readFileSliceBase64(uploadSelectedFile, 0, halfChunk)
          : undefined;

      await fetch(`/api/v1/storage/files/${fileRecord.id}/upload-chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          offset_bytes: 0,
          chunk_size_bytes: halfChunk,
          ...(chunk1Base64 ? { chunk_base64: chunk1Base64 } : {}),
        }),
      });

      setUploadProgressPct(90);
      setUploadStatusText('Đang hoàn tất chunk 2/2 và đồng bộ liên kết Drive...');

      const chunk2Base64 =
        uploadSelectedFile && uploadSelectedFile.size <= 10 * 1024 * 1024
          ? await readFileSliceBase64(uploadSelectedFile, halfChunk, sizeBytes)
          : undefined;

      const finalRes = await fetch(
        `/api/v1/storage/files/${fileRecord.id}/upload-chunk`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            offset_bytes: halfChunk,
            chunk_size_bytes: sizeBytes - halfChunk,
            ...(chunk2Base64 ? { chunk_base64: chunk2Base64 } : {}),
            is_final_chunk: true,
          }),
        },
      );

      const finalBody = await finalRes.json();
      if (finalRes.ok && finalBody.success) {
        setUploadProgressPct(100);
        setUploadStatusText('Hoàn tất tải video lên Google Drive!');
        setSuccessMessage(
          `Đã tải video "${uploadVideoName.trim()}" lên Google Drive thành công.`,
        );
        setShowUploadVideoModal(false);
        setUploadVideoName('');
        setUploadSelectedFile(null);
        setUploadProgressPct(0);
        setUploadStatusText('');
        loadData();
      } else {
        setErrorMessage(
          finalBody.error?.message ||
            'Tải video bị gián đoạn. Bạn có thể bấm Thử lại trong danh sách tệp.',
        );
      }
    } catch {
      setErrorMessage('Lỗi kết nối khi tải video lên Google Drive.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryVideoUpload = async (file: StorageFileData) => {
    setActionLoading(true);
    setErrorMessage(null);
    const total = file.size_bytes ?? 10 * 1024 * 1024;
    const uploaded = file.uploaded_bytes ?? 0;
    const remaining = Math.max(total - uploaded, 1024);

    try {
      const res = await fetch(`/api/v1/storage/files/${file.id}/upload-chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          offset_bytes: uploaded,
          chunk_size_bytes: remaining,
          retry: true,
          is_final_chunk: true,
        }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          `Đã khôi phục và tải hoàn tất video "${file.name}" lên Google Drive.`,
        );
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể tiếp tục tải video lên Drive.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi thử lại tải video.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReviewFile = async (
    file: StorageFileData,
    reviewStatus: 'approved' | 'rejected',
  ) => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/storage/files/${file.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          review_status: reviewStatus,
          notes:
            reviewStatus === 'approved'
              ? 'Đạt yêu cầu nghiệm thu'
              : 'Cần chỉnh sửa lại video',
        }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          `Đã cập nhật trạng thái nghiệm thu video "${file.name}".`,
        );
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể cập nhật trạng thái nghiệm thu.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi duyệt video.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSyncFolderFiles = async (targetFolderId: string) => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/storage/folders/${targetFolderId}/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
        },
      );
      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          'Đã đồng bộ danh sách tệp và trạng thái từ Google Drive.',
        );
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể đồng bộ danh sách tệp từ Drive.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi đồng bộ Google Drive.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDetachFileRecord = async (file: StorageFileData) => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/storage/files/${file.id}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          `Đã gỡ bản ghi "${file.name}" khỏi Management Lite (Dữ liệu trên Google Drive vẫn được giữ nguyên an toàn).`,
        );
        loadData();
      } else {
        setErrorMessage(body.error?.message || 'Không thể gỡ bản ghi tệp.');
      }
    } catch {
      setErrorMessage('Lỗi mạng khi gỡ bản ghi tệp.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleGrantPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFolder || !grantEmployeeId) {
      setErrorMessage('Vui lòng chọn nhân viên để cấp quyền Google Drive.');
      return;
    }
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/storage/folders/${selectedFolder.id}/permissions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            employee_id: grantEmployeeId,
            role: grantRole,
            type: 'user',
          }),
        },
      );
      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          `Đã cấp quyền Google Drive (${grantRole}) theo email nhân viên thành công.`,
        );
        setGrantEmployeeId('');
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể cấp quyền Google Drive.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi cấp quyền Google Drive.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokePermission = async (grant: StoragePermissionGrantData) => {
    if (!selectedFolder) return;
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/storage/folders/${selectedFolder.id}/permissions/revoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            grant_id: grant.id,
            employee_id: grant.employee_id,
          }),
        },
      );
      const body = await res.json();
      if (res.ok && body.success) {
        setSuccessMessage(
          `Đã thu hồi quyền Google Drive của ${grant.google_email || grant.employee_name || 'nhân viên'}.`,
        );
        loadData();
      } else {
        setErrorMessage(
          body.error?.message || 'Không thể thu hồi quyền Google Drive.',
        );
      }
    } catch {
      setErrorMessage('Lỗi mạng khi thu hồi quyền Google Drive.');
    } finally {
      setActionLoading(false);
    }
  };

  // Step 5A: Owner initiates trash request (Backend Delete-Readiness Verification)
  const handleInitiateTrashRequest = async (
    folder: StorageFolderDetailData,
  ) => {
    if (trashLockRef.current) return;

    const readiness = folder.delete_readiness;
    if (!readiness || readiness.can_verify === false) {
      setErrorMessage(
        'Chưa thể xác minh điều kiện xóa từ máy chủ (Backend Delete-Readiness Unavailable). Nút chuyển vào thùng rác được khóa an toàn để ngăn xóa thiếu hoặc xóa nhầm.',
      );
      return;
    }

    if (!readiness.is_ready) {
      const reasonsList = readiness.block_reasons ?? readiness.reasons ?? [];
      setErrorMessage(
        `Không thể chuyển nhóm thư mục vào thùng rác do vi phạm điều kiện an toàn:\n• ${reasonsList.join('\n• ')}`,
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

  // Shared Modals: OAuth 2.0 & Resumable Video Upload
  const renderSharedDriveModals = () => (
    <>
      {showDriveOAuthModal && (
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
              maxWidth: '520px',
              padding: '24px',
            }}
          >
            <h3
              style={{
                margin: '0 0 8px 0',
                fontSize: '18px',
                fontWeight: 700,
                color: '#F8FAFC',
              }}
            >
              Kết nối Google Drive (OAuth 2.0)
            </h3>
            <p
              style={{
                margin: '0 0 16px 0',
                fontSize: '13px',
                color: '#94A3B8',
                lineHeight: '1.5',
              }}
            >
              Sử dụng phạm vi quyền tối thiểu{' '}
              <code>https://www.googleapis.com/auth/drive.file</code> (chỉ quản
              lý thư mục và tệp do Management Lite khởi tạo). Refresh token được
              mã hóa AES-256-GCM trên máy chủ.
            </p>

            <form onSubmit={handleConnectDriveOAuth}>
              <div style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={handlePreviewOAuthUrl}
                  >
                    <LinkIcon size={14} />
                    <span>Lấy URL xác thực Google OAuth 2.0</span>
                  </AppButton>
                  {oauthUrlPreview && (
                    <a
                      href={oauthUrlPreview}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        borderRadius: '6px',
                        color: '#38BDF8',
                        fontSize: '12px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Mở trang ủy quyền Google ↗
                    </a>
                  )}
                </div>
                {oauthUrlPreview && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '8px 10px',
                      backgroundColor: '#0F172A',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      fontSize: '11px',
                      color: '#38BDF8',
                      wordBreak: 'break-all',
                    }}
                  >
                    {oauthUrlPreview}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Email tài khoản Google quản trị *
                </label>
                <input
                  type="email"
                  required
                  value={oauthGoogleEmail}
                  onChange={(e) => setOauthGoogleEmail(e.target.value)}
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

              <div style={{ marginBottom: '12px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Mã ủy quyền OAuth 2.0 (Authorization Code) *
                </label>
                <input
                  type="text"
                  required
                  value={oauthCode}
                  onChange={(e) => setOauthCode(e.target.value)}
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

              <div style={{ marginBottom: '18px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Tên thư mục gốc ứng dụng trên Google Drive
                </label>
                <input
                  type="text"
                  value={oauthRootFolderName}
                  onChange={(e) => setOauthRootFolderName(e.target.value)}
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
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                {driveConnection?.connected ? (
                  <AppButton
                    type="button"
                    variant="destructive"
                    onClick={handleDisconnectDriveOAuth}
                    disabled={actionLoading}
                  >
                    Ngắt kết nối Drive
                  </AppButton>
                ) : (
                  <div />
                )}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowDriveOAuthModal(false)}
                  >
                    Đóng
                  </AppButton>
                  <AppButton
                    type="submit"
                    variant="primary"
                    disabled={actionLoading}
                  >
                    Kết nối Google Drive
                  </AppButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUploadVideoModal && (
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
                margin: '0 0 12px 0',
                fontSize: '18px',
                fontWeight: 700,
                color: '#F8FAFC',
              }}
            >
              Tải video lên Google Drive (Resumable Upload)
            </h3>

            <form onSubmit={handleUploadVideoToDrive}>
              {!folderId && (
                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Chọn thư mục Google Drive đích *
                  </label>
                  <select
                    required
                    value={uploadTargetFolderId}
                    onChange={(e) => setUploadTargetFolderId(e.target.value)}
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
                    <option value="">-- Chọn thư mục đích --</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} (
                        {f.folder_type === 'source'
                          ? 'Thư mục gốc'
                          : 'Thành phẩm'}
                        )
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
                  Chọn tệp video từ máy hoặc nhập tên tệp *
                </label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setUploadSelectedFile(f || null);
                    if (f) {
                      setUploadVideoName(f.name);
                      setUploadVideoSizeMB(
                        Math.max(1, Math.round(f.size / (1024 * 1024))).toString(),
                      );
                      setUploadVideoMimeType(f.type || 'video/mp4');
                    }
                  }}
                  style={{
                    width: '100%',
                    marginBottom: '8px',
                    fontSize: '12px',
                    color: '#94A3B8',
                  }}
                />
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Video_Quang_Cao_TikTok_FullHD.mp4"
                  value={uploadVideoName}
                  onChange={(e) => setUploadVideoName(e.target.value)}
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
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '12px',
                  marginBottom: '14px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Dung lượng (MB)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={uploadVideoSizeMB}
                    onChange={(e) => setUploadVideoSizeMB(e.target.value)}
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
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Quyền Google Drive
                  </label>
                  <select
                    value={uploadPermissionRole}
                    onChange={(e) =>
                      setUploadPermissionRole(
                        e.target.value as DrivePermissionRole,
                      )
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
                    <option value="reader">Reader (Chỉ xem & tải)</option>
                    <option value="writer">Writer (Chỉnh sửa & tải lên)</option>
                  </select>
                </div>
              </div>

              {role === 'owner' && (
                <div style={{ marginBottom: '16px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginBottom: '6px',
                    }}
                  >
                    Giao video & cấp quyền Drive theo email nhân viên
                  </label>
                  <select
                    value={uploadAssignedEmployeeId}
                    onChange={(e) =>
                      setUploadAssignedEmployeeId(e.target.value)
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
                    <option value="">-- Không giao riêng --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {uploadProgressPct > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: '#38BDF8',
                      marginBottom: '4px',
                    }}
                  >
                    <span>{uploadStatusText}</span>
                    <span>{uploadProgressPct}%</span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '8px',
                      backgroundColor: '#0F172A',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${uploadProgressPct}%`,
                        height: '100%',
                        backgroundColor: '#14B8A6',
                        transition: 'width 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              )}

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
                  onClick={() => setShowUploadVideoModal(false)}
                >
                  Hủy
                </AppButton>
                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={actionLoading}
                >
                  Bắt đầu tải video lên Drive
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );

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

    const readiness = selectedFolder.delete_readiness;
    const canVerify = Boolean(readiness && readiness.can_verify !== false);
    const isReady = Boolean(canVerify && readiness?.is_ready);
    const activeGrants = (selectedFolder.permission_grants ?? []).filter(
      (g) => !g.revoked_at,
    );
    const folderFiles = selectedFolder.files ?? [];

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
          subtitle="Quản lý Google Drive trực tiếp, phân quyền nhân viên theo email và nghiệm thu video (FILE-01 / STORAGE)"
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

              <AppButton
                variant="secondary"
                data-testid="storage-detail-upload-video-btn"
                onClick={() => {
                  setUploadTargetFolderId(selectedFolder.id);
                  setShowUploadVideoModal(true);
                }}
              >
                <PlusIcon size={16} />
                <span>Tải video</span>
              </AppButton>

              {role === 'staff' && (
                <AppButton
                  variant="primary"
                  onClick={() => {
                    setDeliverableParentFolderId(selectedFolder.id);
                    setShowCreateDeliverableModal(true);
                  }}
                >
                  <PlusIcon size={16} />
                  <span>Nộp thành phẩm</span>
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
              Thông tin thư mục Google Drive
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
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
                  Google Drive Folder ID:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#38BDF8',
                    marginTop: '2px',
                    wordBreak: 'break-all',
                  }}
                >
                  {selectedFolder.provider_folder_id || 'Chưa đồng bộ'}
                </div>
              </div>

              <div>
                <span style={{ color: '#94A3B8' }}>
                  Parent Folder ID (Drive):
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {selectedFolder.provider_parent_id || 'Root'}
                </div>
              </div>

              <div>
                <span style={{ color: '#94A3B8' }}>Chủ sở hữu Drive:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {selectedFolder.drive_owner_email ||
                    driveConnection?.google_email ||
                    'Workspace Owner'}
                </div>
              </div>

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
                      selectedFolder.assigned_employee_ids?.length ||
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
                <span style={{ color: '#94A3B8' }}>Ngày tạo trên Drive:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {new Date(
                    selectedFolder.drive_created_at ||
                      selectedFolder.created_at,
                  ).toLocaleDateString('vi-VN')}
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

          {/* 1B. Google Drive Permissions Management Card (Requirement 6 & 7) */}
          <AppCard
            style={{ padding: '24px' }}
            data-testid="storage-permissions-card"
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '14px',
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
                  Quyền chia sẻ Google Drive theo Email nhân viên (
                  {activeGrants.length})
                </h3>
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: '12px',
                    color: '#94A3B8',
                  }}
                >
                  Cấp hoặc thu hồi quyền <code>reader</code> /{' '}
                  <code>writer</code> trực tiếp theo email Google của nhân viên
                  (Không bật anyone-with-link mặc định).
                </p>
              </div>
            </div>

            {role === 'owner' && (
              <form
                onSubmit={handleGrantPermission}
                style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  marginBottom: '16px',
                  padding: '12px',
                  backgroundColor: '#0F172A',
                  borderRadius: '8px',
                  border: '1px solid #1E293B',
                }}
              >
                <select
                  value={grantEmployeeId}
                  onChange={(e) => setGrantEmployeeId(e.target.value)}
                  style={{
                    flex: '1',
                    minWidth: '200px',
                    padding: '8px 12px',
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '13px',
                  }}
                >
                  <option value="">-- Chọn nhân viên cấp quyền Drive --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>

                <select
                  value={grantRole}
                  onChange={(e) =>
                    setGrantRole(e.target.value as DrivePermissionRole)
                  }
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '13px',
                  }}
                >
                  <option value="reader">Reader (Xem & tải về)</option>
                  <option value="writer">Writer (Tải lên & chỉnh sửa)</option>
                </select>

                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={actionLoading || !grantEmployeeId}
                >
                  <span>Cấp quyền Drive</span>
                </AppButton>
              </form>
            )}

            {activeGrants.length === 0 ? (
              <div
                style={{
                  padding: '14px',
                  backgroundColor: '#0F172A',
                  borderRadius: '8px',
                  color: '#94A3B8',
                  fontSize: '13px',
                  textAlign: 'center',
                }}
              >
                Chưa có quyền chia sẻ Google Drive nào đang hoạt động trên thư
                mục này.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {activeGrants.map((grant) => (
                  <div
                    key={grant.id}
                    style={{
                      padding: '12px 14px',
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
                        {grant.employee_name || grant.employee_id}{' '}
                        {grant.google_email ? `(${grant.google_email})` : ''}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#94A3B8',
                          marginTop: '2px',
                        }}
                      >
                        Permission ID: {grant.drive_permission_id || 'N/A'}
                        {grant.inherited_from_resource_id
                          ? ' • Kế thừa từ thư mục cha'
                          : ''}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <StatusBadge
                        status={
                          grant.drive_role === 'writer' ? 'warning' : 'success'
                        }
                        label={`Drive: ${grant.drive_role}`}
                      />
                      {role === 'owner' && (
                        <AppButton
                          variant="destructive"
                          onClick={() => handleRevokePermission(grant)}
                          disabled={actionLoading}
                        >
                          <span>Thu hồi quyền</span>
                        </AppButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AppCard>

          {/* 1C. Folder Video & Files List Card (Requirement 5, 8, 9) */}
          <AppCard
            style={{ padding: '24px' }}
            data-testid="storage-files-card"
          >
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
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  Danh sách Video & Tệp trên Google Drive ({folderFiles.length})
                </h3>
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: '12px',
                    color: '#94A3B8',
                  }}
                >
                  Theo dõi trạng thái Resumable Upload, nhân viên phụ trách và
                  nghiệm thu video. Gỡ bản ghi trên Management Lite không làm
                  mất tệp trên Google Drive.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <AppButton
                  variant="secondary"
                  onClick={() => handleSyncFolderFiles(selectedFolder.id)}
                  disabled={actionLoading}
                >
                  <span>Đồng bộ Drive</span>
                </AppButton>
                <AppButton
                  variant="primary"
                  onClick={() => {
                    setUploadTargetFolderId(selectedFolder.id);
                    setShowUploadVideoModal(true);
                  }}
                  disabled={actionLoading}
                >
                  <PlusIcon size={14} />
                  <span>Tải video</span>
                </AppButton>
              </div>
            </div>

            {folderFiles.length === 0 ? (
              <div
                style={{
                  padding: '20px',
                  backgroundColor: '#0F172A',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#94A3B8',
                  fontSize: '13px',
                }}
              >
                Chưa có tệp video nào trong thư mục này. Bấm "Tải video" để tải
                lên Google Drive bằng Resumable Upload.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {folderFiles.map((file) => {
                  const total = file.size_bytes || 1;
                  const uploaded = file.uploaded_bytes ?? total;
                  const pct = Math.min(
                    100,
                    Math.round((uploaded / total) * 100),
                  );
                  const isInterrupted =
                    file.status === 'paused' ||
                    file.upload_status === 'failed' ||
                    file.upload_status === 'paused';

                  return (
                    <div
                      key={file.id}
                      style={{
                        padding: '14px 16px',
                        backgroundColor: '#0F172A',
                        border: '1px solid #1E293B',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                        fontSize: '13px',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#F8FAFC' }}>
                          {file.name}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#94A3B8',
                            marginTop: '2px',
                          }}
                        >
                          Drive File ID: {file.provider_file_id || 'N/A'} • Tiến
                          trình upload: {pct}% • Nhân viên:{' '}
                          {file.assigned_employee_name || 'Chưa giao riêng'}
                        </div>
                        {file.last_error && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#F87171',
                              marginTop: '4px',
                            }}
                          >
                            ⚠️ Gián đoạn tải lên: {file.last_error} (Số lần thử
                            lại: {file.retry_count ?? 0})
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
                        <StatusBadge
                          status={
                            file.upload_status === 'completed'
                              ? 'success'
                              : isInterrupted
                                ? 'warning'
                                : 'neutral'
                          }
                          label={`Upload: ${file.upload_status || file.status}`}
                        />

                        <StatusBadge
                          status={
                            file.review_status === 'approved'
                              ? 'success'
                              : file.review_status === 'rejected'
                                ? 'warning'
                                : 'neutral'
                          }
                          label={
                            file.review_status === 'approved'
                              ? 'Đã nghiệm thu'
                              : file.review_status === 'rejected'
                                ? 'Từ chối'
                                : 'Chờ nghiệm thu'
                          }
                        />

                        {file.web_view_link && (
                          <a
                            href={file.web_view_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '5px 10px',
                              backgroundColor: '#1E293B',
                              color: '#38BDF8',
                              border: '1px solid #334155',
                              borderRadius: '6px',
                              textDecoration: 'none',
                              fontSize: '12px',
                              fontWeight: 600,
                            }}
                          >
                            Xem trên Drive
                          </a>
                        )}

                        {isInterrupted && (
                          <AppButton
                            variant="primary"
                            onClick={() => handleRetryVideoUpload(file)}
                            disabled={actionLoading}
                          >
                            <span>Thử lại Upload</span>
                          </AppButton>
                        )}

                        {role === 'owner' &&
                          file.review_status !== 'approved' && (
                            <AppButton
                              variant="primary"
                              onClick={() => handleReviewFile(file, 'approved')}
                              disabled={actionLoading}
                            >
                              <CheckIcon size={14} />
                              <span>Duyệt video</span>
                            </AppButton>
                          )}

                        {role === 'owner' && (
                          <AppButton
                            variant="secondary"
                            onClick={() => handleDetachFileRecord(file)}
                            disabled={actionLoading}
                          >
                            <span>Gỡ bản ghi Lite</span>
                          </AppButton>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                <span>Nộp thành phẩm</span>
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
                Chưa có thư mục thành phẩm nào được nộp. Bấm "Nộp thành phẩm"
                để tạo trực tiếp hoặc thêm liên kết Drive.
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

          {/* 4. Backend Delete-Readiness & Safe Google Drive Trash Card */}
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

              {!canVerify ? (
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
                    {(readiness?.block_reasons ?? readiness?.reasons)?.map(
                      (reason, idx) => <li key={idx}>{reason}</li>,
                    ) || <li>Dữ liệu chưa hoàn tất.</li>}
                  </ul>
                </div>
              ) : (
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

        {renderSharedDriveModals()}

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

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: '#38BDF8',
                    marginBottom: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={deliverableCreateOnDrive}
                    onChange={(e) =>
                      setDeliverableCreateOnDrive(e.target.checked)
                    }
                  />
                  <span>
                    Tự động tạo thư mục thành phẩm trực tiếp trên Google Drive
                  </span>
                </label>

                {!deliverableCreateOnDrive && (
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
                      required={!deliverableCreateOnDrive}
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
                )}

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

        {/* Modal 3: Two-step Google Drive Trash Confirmation */}
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
                Nhóm thư mục:{' '}
                <strong>
                  {trashRequestData.folder_name || selectedFolder.name}
                </strong>
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
        subtitle="Tích hợp Google Drive API v3 trực tiếp: OAuth 2.0, Tạo thư mục, Tải video Resumable và Phân quyền nhân viên (FILE-01)"
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {role === 'owner' && (
              <AppButton
                variant="secondary"
                data-testid="storage-connect-drive-btn"
                onClick={() => setShowDriveOAuthModal(true)}
                disabled={loading}
              >
                <LinkIcon size={16} />
                <span>
                  {driveConnection?.connected
                    ? `Drive: ${driveConnection.google_email}`
                    : 'Kết nối Google Drive'}
                </span>
              </AppButton>
            )}

            {role === 'owner' && (
              <AppButton
                variant="primary"
                data-testid="storage-create-folder-btn"
                onClick={() => setShowCreateSourceModal(true)}
                disabled={loading}
              >
                <PlusIcon size={16} />
                <span>Tạo thư mục</span>
              </AppButton>
            )}

            <AppButton
              variant="secondary"
              data-testid="storage-upload-video-btn"
              onClick={() => {
                setUploadTargetFolderId(folders[0]?.id || '');
                setShowUploadVideoModal(true);
              }}
              disabled={loading}
            >
              <PlusIcon size={16} />
              <span>Tải video</span>
            </AppButton>

            <AppButton
              variant="secondary"
              onClick={() => {
                setDeliverableParentFolderId('');
                setShowCreateDeliverableModal(true);
              }}
              disabled={loading}
            >
              <PlusIcon size={16} />
              <span>Nộp thành phẩm</span>
            </AppButton>
          </div>
        }
      />

      {/* 1B. Google Drive OAuth 2.0 Connection Bar */}
      <AppCard
        style={{ padding: '14px 18px', marginBottom: '18px' }}
        data-testid="storage-drive-connection-bar"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <StatusBadge
              status={driveConnection?.connected ? 'success' : 'warning'}
              label={
                driveConnection?.connected
                  ? 'Đã kết nối Google Drive'
                  : 'Chưa kết nối OAuth 2.0'
              }
            />
            <span style={{ color: '#CBD5E1' }}>
              {driveConnection?.connected
                ? `Tài khoản: ${driveConnection.google_email} • Scope: drive.file (Least Privilege)`
                : 'Kết nối tài khoản Google quản trị qua OAuth 2.0 để tự động tạo thư mục, tải video và phân quyền nhân viên.'}
            </span>
          </div>

          {role === 'owner' && (
            <AppButton
              variant="secondary"
              onClick={() => setShowDriveOAuthModal(true)}
            >
              <LinkIcon size={14} />
              <span>
                {driveConnection?.connected
                  ? 'Cấu hình kết nối Drive'
                  : 'Kết nối Google Drive'}
              </span>
            </AppButton>
          )}
        </div>
      </AppCard>

      {/* 2. KPI Metrics Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
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
          description="Chưa có thư mục Drive nào trong workspace. Hãy bấm 'Tạo thư mục' để bắt đầu."
          action={
            role === 'owner' ? (
              <AppButton
                variant="primary"
                onClick={() => setShowCreateSourceModal(true)}
              >
                <PlusIcon size={16} />
                <span>Tạo thư mục ngay</span>
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
                  Nhân sự & Quyền Drive
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
                const activeGrants = (folder.permission_grants ?? []).filter(
                  (g) => !g.revoked_at,
                );
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
                        {folder.provider_folder_id
                          ? `Drive ID: ${folder.provider_folder_id} • `
                          : ''}
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
                      <div>{folder.assigned_employee_name || '-'}</div>
                      {activeGrants.length > 0 && (
                        <div
                          style={{
                            fontSize: '11px',
                            color: '#38BDF8',
                            marginTop: '2px',
                          }}
                        >
                          {activeGrants.length} quyền ({activeGrants[0]?.drive_role})
                        </div>
                      )}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      {folder.staff_download_confirmed ||
                      folder.staff_source_acknowledged ? (
                        <StatusBadge status="success" label="Đã tải" />
                      ) : (
                        <StatusBadge status="warning" label="Chưa tải" />
                      )}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontWeight: 600, color: '#38BDF8' }}>
                        {folder.deliverable_count ??
                          folder.deliverables?.length ??
                          0}{' '}
                        thư mục
                      </span>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      {folder.owner_review_confirmed ||
                      folder.delete_readiness?.is_ready ? (
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

      {renderSharedDriveModals()}

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
              Tạo thư mục trên Google Drive & Giao nhân viên
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

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: '#38BDF8',
                  marginBottom: '14px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={newSourceCreateOnDrive}
                  onChange={(e) => setNewSourceCreateOnDrive(e.target.checked)}
                />
                <span>
                  Tự động tạo thư mục mới trên Google Drive (Drive API v3)
                </span>
              </label>

              {!newSourceCreateOnDrive && (
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
                    required={!newSourceCreateOnDrive}
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
                  Giao cho nhân sự & tự cấp quyền Google Drive theo email
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

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Quyền truy cập Google Drive cho nhân viên được chọn
                </label>
                <select
                  value={newSourcePermissionRole}
                  onChange={(e) =>
                    setNewSourcePermissionRole(
                      e.target.value as DrivePermissionRole,
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#F8FAFC',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="reader">
                    Reader (Chỉ xem & tải tệp nguồn)
                  </option>
                  <option value="writer">
                    Writer (Cho phép tải video & chỉnh sửa trong thư mục)
                  </option>
                </select>
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

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: '#38BDF8',
                  marginBottom: '12px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={deliverableCreateOnDrive}
                  onChange={(e) =>
                    setDeliverableCreateOnDrive(e.target.checked)
                  }
                />
                <span>
                  Tự động tạo thư mục thành phẩm trực tiếp trên Google Drive
                </span>
              </label>

              {!deliverableCreateOnDrive && (
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
                    required={!deliverableCreateOnDrive}
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
              )}

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
export default StorageScreen;
