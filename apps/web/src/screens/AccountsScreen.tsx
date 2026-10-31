import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import {
  PageHeader,
  AppCard,
  AppButton,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  LockIcon,
  EyeIcon,
  PlusIcon,
  CopyIcon,
  CloseIcon,
  SearchIcon,
  RotateCcwIcon,
  AlertTriangleIcon,
  CheckIcon,
  ShieldAlertIcon,
  ArrowLeftIcon,
  ActionIconButton,
  Pagination,
  DEFAULT_PAGE_SIZE,
  clampPage,
} from '../../../../packages/ui/src/components/index.js';
import type {
  ManagedAccountData,
  ManagedAccountDetailData,
  CreateAccountRequest,
  UpdateAccountRequest,
  AccountPlatform,
  AccountStatus,
  AccountSecretType,
} from '../../../../packages/contracts/src/accounts.js';
import type { UserRole } from '../types.js';

export interface AccountsScreenProps {
  role?: UserRole;
  accountId?: string | undefined;
  onNavigate?: (path: string) => void;
}

import {
  getPlatformConfig,
  sanitizeUiError,
  type PlatformConfig,
} from './helpers/accounts-helpers.js';

export { sanitizeUiError, type PlatformConfig };

export const AccountsScreen: React.FC<AccountsScreenProps> = ({
  role = 'owner',
  accountId,
  onNavigate,
}) => {
  // 1. RBAC Guard: Staff is strictly forbidden
  if (role !== 'owner') {
    return (
      <div style={{ maxWidth: '640px', margin: '40px auto', padding: '16px' }}>
        <ErrorState
          title="Không có quyền truy cập (403 Forbidden)"
          message="Chỉ Chủ sở hữu (Owner) mới có quyền truy cập và quản lý tài khoản dịch vụ (ACC). Nhân viên không được cấp quyền xem thông tin này."
        />
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <AppButton onClick={() => onNavigate?.('/')}>Về trang chủ</AppButton>
        </div>
      </div>
    );
  }

  // Authentication & CSRF
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Data states
  const [accounts, setAccounts] = useState<ManagedAccountData[]>([]);
  const [selectedAccount, setSelectedAccount] =
    useState<ManagedAccountDetailData | null>(null);
  const [employeesList, setEmployeesList] = useState<
    Array<{ id: string; full_name: string; employee_code: string }>
  >([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters (List view)
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Client-side paging: GET /api/v1/accounts has no cursor/limit, so slice locally.
  const [page, setPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newPlatform, setNewPlatform] = useState<AccountPlatform>('tiktok');
  const [newUsername, setNewUsername] = useState<string>('');
  const [newPlatformAccountId, setNewPlatformAccountId] = useState<string>('');
  const [newRecoveryEmail, setNewRecoveryEmail] = useState<string>('');
  const [newAccountGroup, setNewAccountGroup] = useState<string>('');
  const [newAssignedEmployeeId, setNewAssignedEmployeeId] =
    useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');
  const [newInitPassword, setNewInitPassword] = useState<string>('');
  const [newInitTwoFa, setNewInitTwoFa] = useState<string>('');
  const [newInitEmailPassword, setNewInitEmailPassword] = useState<string>('');

  // Edit Modal
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editAccount, setEditAccount] = useState<ManagedAccountData | null>(
    null,
  );
  const [editUsername, setEditUsername] = useState<string>('');
  const [editPlatformAccountId, setEditPlatformAccountId] =
    useState<string>('');
  const [editRecoveryEmail, setEditRecoveryEmail] = useState<string>('');
  const [editAccountGroup, setEditAccountGroup] = useState<string>('');
  const [editAssignedEmployeeId, setEditAssignedEmployeeId] =
    useState<string>('');
  const [editStatus, setEditStatus] = useState<'active' | 'archived'>('active');
  const [editNotes, setEditNotes] = useState<string>('');

  // Archive Modal
  const [showArchiveModal, setShowArchiveModal] = useState<boolean>(false);
  const [archiveTargetAccount, setArchiveTargetAccount] =
    useState<ManagedAccountData | null>(null);
  const [archiveReason, setArchiveReason] = useState<string>('');

  // Reauth & Secret Reveal Modal
  const [showRevealReauthModal, setShowRevealReauthModal] =
    useState<boolean>(false);
  const [revealTargetAccount, setRevealTargetAccount] =
    useState<ManagedAccountData | null>(null);
  const [revealSecretType, setRevealSecretType] =
    useState<AccountSecretType>('password');
  const [revealReauthPassword, setRevealReauthPassword] = useState<string>('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealedSecretAccountId, setRevealedSecretAccountId] = useState<
    string | null
  >(null);
  const [revealCountdown, setRevealCountdown] = useState<number>(0);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);
  const revealDeadlineRef = useRef<number | null>(null);
  const revealGenerationRef = useRef<number>(0);
  const modalGenerationRef = useRef<number>(0);
  const currentModalAccountIdRef = useRef<string | null>(null);
  const revealAbortControllerRef = useRef<AbortController | null>(null);
  const loadingGenerationRef = useRef<number | null>(null);
  const showRevealReauthModalRef = useRef<boolean>(false);

  const clearRevealedSecret = useCallback(() => {
    revealGenerationRef.current++;
    modalGenerationRef.current++;
    currentModalAccountIdRef.current = null;
    showRevealReauthModalRef.current = false;
    if (revealAbortControllerRef.current) {
      revealAbortControllerRef.current.abort();
      revealAbortControllerRef.current = null;
    }
    if (loadingGenerationRef.current !== null) {
      setActionLoading(false);
      loadingGenerationRef.current = null;
    }
    setRevealedSecret(null);
    setRevealedSecretAccountId(null);
    setRevealCountdown(0);
    setCopiedSecret(false);
    revealDeadlineRef.current = null;
  }, []);

  const openRevealModal = useCallback(
    (
      account: ManagedAccountData,
      secretType: AccountSecretType = 'password',
    ) => {
      // Invalidate previous generations and abort pending request
      revealGenerationRef.current++;
      modalGenerationRef.current++;
      currentModalAccountIdRef.current = account.id;

      if (revealAbortControllerRef.current) {
        revealAbortControllerRef.current.abort();
        revealAbortControllerRef.current = null;
      }

      if (loadingGenerationRef.current !== null) {
        setActionLoading(false);
        loadingGenerationRef.current = null;
      }

      setRevealTargetAccount(account);
      setRevealSecretType(secretType);
      setRevealReauthPassword('');
      setRevealedSecret(null);
      setRevealedSecretAccountId(null);
      setErrorMessage(null);
      showRevealReauthModalRef.current = true;
      setShowRevealReauthModal(true);
    },
    [],
  );

  // Reauth & Secret Update (Write) Modal
  const [showUpdateSecretModal, setShowUpdateSecretModal] =
    useState<boolean>(false);
  const [updateSecretTargetAccount, setUpdateSecretTargetAccount] =
    useState<ManagedAccountData | null>(null);
  const [newSecretType, setNewSecretType] =
    useState<AccountSecretType>('password');
  const [newSecretValue, setNewSecretValue] = useState<string>('');
  const [updateSecretReauthPassword, setUpdateSecretReauthPassword] =
    useState<string>('');

  // 1. Fetch Session, CSRF token & Active Employees
  useEffect(() => {
    let active = true;
    const fetchSessionAndEmployees = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (res.ok) {
          const body = await res.json();
          if (active && body.data?.csrf_token) {
            setCsrfToken(body.data.csrf_token);
          }
        }
      } catch {
        // Ignored
      }

      try {
        const empRes = await fetch('/api/v1/employees?limit=50', {
          credentials: 'include',
        });
        if (empRes.ok) {
          const empBody = await empRes.json();
          const items = empBody.data?.items || [];
          if (active && Array.isArray(items)) {
            setEmployeesList(
              items.filter(
                (e: Record<string, unknown>) =>
                  typeof e.id === 'string' && typeof e.full_name === 'string',
              ),
            );
          }
        }
      } catch {
        // Ignored
      }
    };
    fetchSessionAndEmployees();
    return () => {
      active = false;
    };
  }, []);

  // 2. Fetch Accounts list or Detail
  const loadData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      if (accountId) {
        // Fetch single account detail
        const res = await fetch(`/api/v1/accounts/${accountId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data) {
            setSelectedAccount(body.data);
          }
        } else {
          const err = await res.json().catch(() => ({}));
          setErrorMessage(
            err.error?.message ||
              'Không thể tải chi tiết tài khoản hoặc tài khoản không tồn tại.',
          );
          setSelectedAccount(null);
        }
      } else {
        // Fetch accounts list
        const params = new URLSearchParams();
        if (platformFilter !== 'all') params.append('platform', platformFilter);
        if (statusFilter !== 'all') params.append('status', statusFilter);
        if (groupFilter !== 'all') params.append('account_group', groupFilter);
        if (assigneeFilter !== 'all')
          params.append('assigned_employee_id', assigneeFilter);
        if (searchQuery.trim()) params.append('search', searchQuery.trim());

        const res = await fetch(`/api/v1/accounts?${params.toString()}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json();
          if (body.success && body.data) {
            setAccounts(body.data.items || []);
          }
        } else {
          const err = await res.json().catch(() => ({}));
          setErrorMessage(
            err.error?.message ||
              'Đang kết nối API Quản lý tài khoản (ACC)... Vui lòng thử lại sau.',
          );
          setAccounts([]);
        }
      }
    } catch {
      setErrorMessage('Lỗi mạng khi kết nối máy chủ API Quản lý tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    clearRevealedSecret();
    setRevealTargetAccount(null);
    setRevealReauthPassword('');
    setShowRevealReauthModal(false);
    setSelectedAccount(null);
    loadData();
  }, [accountId, platformFilter, statusFilter, groupFilter, assigneeFilter]);

  // 3a. Dedicated lifecycle visibility listener (ACC-005):
  // Active THROUGHOUT component lifecycle, regardless of whether revealedSecret is null,
  // to permanently invalidate in-flight reveal requests, abort controllers, and purge secrets
  // upon transition to hidden (prevents hidden -> visible race during reveal request).
  useEffect(() => {
    const handleGlobalVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        clearRevealedSecret();
      }
    };
    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'hidden') {
        clearRevealedSecret();
      }
      document.addEventListener('visibilitychange', handleGlobalVisibility);
      return () => {
        document.removeEventListener(
          'visibilitychange',
          handleGlobalVisibility,
        );
      };
    }
  }, [clearRevealedSecret]);

  // 3b. Real-time deadline-based countdown timer for revealed secret (ACC-005)
  // Auto-clears secret when deadline expires, on tab hide, or on unmount
  useEffect(() => {
    // Security policy: Immediately check visibility state when effect runs / registers listener
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      clearRevealedSecret();
      return;
    }

    if (!revealedSecret) {
      revealDeadlineRef.current = null;
      return;
    }

    if (!revealDeadlineRef.current) {
      revealDeadlineRef.current = Date.now() + 30000;
    }

    const checkExpiry = () => {
      if (!revealDeadlineRef.current) return;
      const remainingMs = revealDeadlineRef.current - Date.now();
      if (remainingMs <= 0) {
        clearRevealedSecret();
      } else {
        setRevealCountdown(Math.ceil(remainingMs / 1000));
      }
    };

    // Run check immediately
    checkExpiry();

    const timer = setInterval(checkExpiry, 500);

    // Security policy: Immediately clear sensitive secret when tab becomes hidden (background tab)
    // or re-verify deadline when window resumes/focuses
    const handleVisibilityChange = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        clearRevealedSecret();
      } else {
        checkExpiry();
      }
    };

    const handleFocus = () => {
      checkExpiry();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange,
        );
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [revealedSecret, clearRevealedSecret]);

  // 4. Cleanup on unmount or navigation: clear sensitive state
  useEffect(() => {
    return () => {
      clearRevealedSecret();
      setRevealReauthPassword('');
      setUpdateSecretReauthPassword('');
      setNewSecretValue('');
    };
  }, [clearRevealedSecret]);

  // 5. Keyboard accessibility: Close modals on Escape key
  useEffect(() => {
    if (!showRevealReauthModal && !showUpdateSecretModal && !showArchiveModal) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showRevealReauthModal) closeRevealModal();
        if (showUpdateSecretModal) closeUpdateSecretModal();
        if (showArchiveModal) setShowArchiveModal(false);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showRevealReauthModal, showUpdateSecretModal, showArchiveModal]);

  // Filtered accounts for display
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (platformFilter !== 'all' && acc.platform !== platformFilter)
        return false;
      if (statusFilter !== 'all' && acc.status !== statusFilter) return false;
      if (groupFilter !== 'all' && acc.account_group !== groupFilter)
        return false;
      if (
        assigneeFilter !== 'all' &&
        acc.assigned_employee_id !== assigneeFilter
      )
        return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const u = (acc.username || '').toLowerCase();
        const p = (acc.platform || '').toLowerCase();
        const pid = (acc.platform_account_id || '').toLowerCase();
        const rec = (acc.recovery_email || '').toLowerCase();
        const grp = (acc.account_group || '').toLowerCase();
        const emp = (acc.assigned_employee_name || '').toLowerCase();
        const n = (acc.notes || '').toLowerCase();
        if (
          !u.includes(q) &&
          !p.includes(q) &&
          !pid.includes(q) &&
          !rec.includes(q) &&
          !grp.includes(q) &&
          !emp.includes(q) &&
          !n.includes(q)
        )
          return false;
      }
      return true;
    });
  }, [
    accounts,
    platformFilter,
    statusFilter,
    groupFilter,
    assigneeFilter,
    searchQuery,
  ]);

  const safePage = clampPage(page, filteredAccounts.length, pageSize);
  const pagedAccounts = useMemo(
    () =>
      filteredAccounts.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filteredAccounts, safePage, pageSize],
  );

  // KPI Metrics
  const metrics = useMemo(() => {
    const total = accounts.length;
    let active = 0;
    let archived = 0;
    for (const a of accounts) {
      if (a.status === 'active') active++;
      else if (a.status === 'archived') archived++;
    }
    return { total, active, archived };
  }, [accounts]);

  // Handler: Create Account (POST /api/v1/accounts)
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const initialSecrets: Array<{
        secret_type: AccountSecretType;
        secret_value: string;
      }> = [];
      if (newInitPassword.trim()) {
        initialSecrets.push({
          secret_type: 'password',
          secret_value: newInitPassword,
        });
      }
      if (newInitTwoFa.trim()) {
        initialSecrets.push({
          secret_type: 'totp_secret',
          secret_value: newInitTwoFa,
        });
      }
      if (newInitEmailPassword.trim()) {
        initialSecrets.push({
          secret_type: 'email_password',
          secret_value: newInitEmailPassword,
        });
      }

      const payload: CreateAccountRequest = {
        platform: newPlatform,
        username: newUsername.trim() || undefined,
        platform_account_id: newPlatformAccountId.trim() || undefined,
        recovery_email: newRecoveryEmail.trim() || undefined,
        account_group: newAccountGroup.trim() || undefined,
        assigned_employee_id: newAssignedEmployeeId || undefined,
        notes: newNotes.trim() || undefined,
        initial_secrets: initialSecrets.length > 0 ? initialSecrets : undefined,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể tạo mới tài khoản');
      }

      setSuccessMessage('Đã thêm mới tài khoản thành công!');
      setShowCreateModal(false);
      setNewUsername('');
      setNewPlatformAccountId('');
      setNewRecoveryEmail('');
      setNewAccountGroup('');
      setNewAssignedEmployeeId('');
      setNewNotes('');
      setNewInitPassword('');
      setNewInitTwoFa('');
      setNewInitEmailPassword('');
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Update Account (PATCH /api/v1/accounts/:id)
  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccount) return;
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const payload: UpdateAccountRequest = {
        username: editUsername.trim() || undefined,
        platform_account_id: editPlatformAccountId.trim() || undefined,
        recovery_email: editRecoveryEmail.trim() || null,
        account_group: editAccountGroup.trim() || null,
        assigned_employee_id: editAssignedEmployeeId || null,
        status: editStatus,
        notes: editNotes.trim() || undefined,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${editAccount.version}"`,
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`/api/v1/accounts/${editAccount.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể cập nhật thông tin tài khoản',
        );
      }

      setSuccessMessage('Đã cập nhật thông tin tài khoản!');
      setShowEditModal(false);
      setEditAccount(null);
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Archive Account (POST /api/v1/accounts/:id/archive)
  const handleArchiveAccount = async () => {
    if (!archiveTargetAccount) return;
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${archiveTargetAccount.version}"`,
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(
        `/api/v1/accounts/${archiveTargetAccount.id}/archive`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ reason: archiveReason.trim() || undefined }),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể lưu trữ tài khoản');
      }

      setSuccessMessage('Đã chuyển tài khoản sang trạng thái lưu trữ!');
      setShowArchiveModal(false);
      setArchiveTargetAccount(null);
      setArchiveReason('');
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Restore Account (POST /api/v1/accounts/:id/restore)
  const handleRestoreAccount = async (account: ManagedAccountData) => {
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'If-Match': `"${account.version}"`,
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`/api/v1/accounts/${account.id}/restore`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể khôi phục tài khoản');
      }

      setSuccessMessage('Đã khôi phục tài khoản về trạng thái hoạt động!');
      await loadData();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Reauth & Reveal Secret (POST /api/v1/auth/reauth then POST /api/v1/accounts/:id/secrets/reveal)
  const handleRevealSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revealTargetAccount || !revealReauthPassword) {
      setErrorMessage('Vui lòng nhập mật khẩu xác thực lại.');
      return;
    }

    const targetAccountId = revealTargetAccount.id;
    const initialModalGen = modalGenerationRef.current;

    // Cancel any previous in-flight reveal requests
    if (revealAbortControllerRef.current) {
      revealAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    revealAbortControllerRef.current = abortController;
    const currentGeneration = ++revealGenerationRef.current;
    loadingGenerationRef.current = currentGeneration;

    setActionLoading(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      // Bước 1: Gọi Reauth endpoint để lấy single-use proof có thời hạn ngắn
      const reauthRes = await fetch('/api/v1/auth/reauth', {
        method: 'POST',
        headers,
        credentials: 'include',
        signal: abortController.signal,
        body: JSON.stringify({
          password: revealReauthPassword,
          action: 'secret_reveal',
          account_id: targetAccountId,
        }),
      });

      const reauthBody = await reauthRes.json();
      if (!reauthRes.ok || !reauthBody.success) {
        throw new Error(
          reauthBody.error?.message ||
            'Mật khẩu xác thực lại không chính xác. Không thể xem mật khẩu.',
        );
      }

      // Stale response / cancellation guard: Abort if request is superseded, modal reopened, or cancelled
      if (
        revealGenerationRef.current !== currentGeneration ||
        modalGenerationRef.current !== initialModalGen ||
        currentModalAccountIdRef.current !== targetAccountId ||
        abortController.signal.aborted ||
        !showRevealReauthModalRef.current
      ) {
        return;
      }

      const reauthProof = reauthBody.data?.reauth_proof;
      if (!reauthProof) {
        throw new Error('Máy chủ không trả về bằng chứng xác thực hợp lệ.');
      }

      // Bước 2: Gọi Reveal endpoint kèm bằng chứng xác thực vừa nhận
      const revealRes = await fetch(
        `/api/v1/accounts/${targetAccountId}/secrets/reveal`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          signal: abortController.signal,
          body: JSON.stringify({
            secret_type: revealSecretType,
            reauth_proof: reauthProof,
          }),
        },
      );

      const revealBody = await revealRes.json();
      if (!revealRes.ok || !revealBody.success) {
        throw new Error(
          revealBody.error?.message ||
            'Không thể giải mã hoặc hiển thị mật khẩu tài khoản.',
        );
      }

      // Stale response / modal close / unmount guard: Check generation, modal gen, account ID, and modal open state
      if (
        revealGenerationRef.current !== currentGeneration ||
        modalGenerationRef.current !== initialModalGen ||
        currentModalAccountIdRef.current !== targetAccountId ||
        revealTargetAccount?.id !== targetAccountId ||
        abortController.signal.aborted ||
        !showRevealReauthModalRef.current
      ) {
        return;
      }

      // ACC-005 Security Race: Check document.visibilityState immediately before accepting secret.
      // If tab has become hidden while response was in flight, DO NOT store secret into React state!
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        clearRevealedSecret();
        setRevealReauthPassword('');
        setErrorMessage(
          'Tab trình duyệt đã bị ẩn trong khi xử lý. Yêu cầu xem mật khẩu đã bị hủy vì lý do an toàn.',
        );
        return;
      }

      // Thành công: Hiển thị tạm thời trong UI, bật đếm lùi 30 giây (ACC-005) và xóa password reauth
      revealDeadlineRef.current = Date.now() + 30000;
      setRevealedSecret(revealBody.data.secret_value);
      setRevealedSecretAccountId(targetAccountId);
      setRevealCountdown(30);
      setRevealReauthPassword('');
      setSuccessMessage(
        'Xác thực thành công. Mật khẩu sẽ tự động ẩn sau 30 giây.',
      );
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted'))
      ) {
        return;
      }
      if (
        revealGenerationRef.current !== currentGeneration ||
        modalGenerationRef.current !== initialModalGen ||
        currentModalAccountIdRef.current !== targetAccountId ||
        abortController.signal.aborted ||
        !showRevealReauthModalRef.current
      ) {
        return;
      }
      setErrorMessage(
        sanitizeUiError(
          err instanceof Error
            ? err.message
            : 'Lỗi kết nối khi xác thực bí mật',
        ),
      );
    } finally {
      if (
        loadingGenerationRef.current === currentGeneration &&
        modalGenerationRef.current === initialModalGen
      ) {
        setActionLoading(false);
        loadingGenerationRef.current = null;
      }
    }
  };

  // Handler: Reauth & Write/Update Secret (POST /api/v1/auth/reauth then PUT /api/v1/accounts/:id/secrets)
  const handleWriteSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updateSecretTargetAccount) return;
    if (!newSecretValue.trim()) {
      setErrorMessage('Vui lòng nhập mật khẩu / secret mới.');
      return;
    }
    if (!updateSecretReauthPassword) {
      setErrorMessage('Vui lòng nhập mật khẩu xác thực lại của Chủ sở hữu.');
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      // Bước 1: Reauth lấy single-use proof cho action secret_write
      const reauthRes = await fetch('/api/v1/auth/reauth', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          password: updateSecretReauthPassword,
          action: 'secret_write',
          account_id: updateSecretTargetAccount.id,
        }),
      });

      const reauthBody = await reauthRes.json();
      if (!reauthRes.ok || !reauthBody.success) {
        throw new Error(
          reauthBody.error?.message ||
            'Mật khẩu xác thực không đúng. Cập nhật secret thất bại.',
        );
      }

      const reauthProof = reauthBody.data?.reauth_proof;
      if (!reauthProof) {
        throw new Error('Máy chủ không cấp quyền cập nhật mật khẩu.');
      }

      // Bước 2: Cập nhật secret mới qua PUT /api/v1/accounts/:id/secrets
      const putRes = await fetch(
        `/api/v1/accounts/${updateSecretTargetAccount.id}/secrets`,
        {
          method: 'PUT',
          headers: {
            ...headers,
            'If-Match': `"${updateSecretTargetAccount.version}"`,
          },
          credentials: 'include',
          body: JSON.stringify({
            secret_type: newSecretType,
            secret_value: newSecretValue,
            reauth_proof: reauthProof,
          }),
        },
      );

      const putBody = await putRes.json();
      if (!putRes.ok || !putBody.success) {
        throw new Error(
          putBody.error?.message || 'Không thể lưu mật khẩu / secret mới.',
        );
      }

      setSuccessMessage('Đã cập nhật mật khẩu / secret thành công!');
      setShowUpdateSecretModal(false);
      setUpdateSecretTargetAccount(null);
      setNewSecretValue('');
      setUpdateSecretReauthPassword('');
      await loadData();
    } catch (err) {
      setErrorMessage(
        sanitizeUiError(
          err instanceof Error
            ? err.message
            : 'Lỗi kết nối khi cập nhật bí mật',
        ),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const closeRevealModal = () => {
    setShowRevealReauthModal(false);
    setRevealTargetAccount(null);
    setRevealReauthPassword('');
    clearRevealedSecret();
  };

  const closeUpdateSecretModal = () => {
    setShowUpdateSecretModal(false);
    setUpdateSecretTargetAccount(null);
    setNewSecretValue('');
    setUpdateSecretReauthPassword('');
  };

  // Helper copy to clipboard
  const handleCopySecret = async () => {
    if (!revealedSecret || revealedSecretAccountId !== revealTargetAccount?.id)
      return;
    try {
      await navigator.clipboard.writeText(revealedSecret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // Ignored
    }
  };

  // ==========================================
  // RENDER VIEW: DETAIL VIEW (/accounts/:id)
  // ==========================================
  const renderDetailView = () => {
    if (loading) {
      return (
        <div
          style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}
        >
          <LoadingState message="Đang tải chi tiết tài khoản…" />
        </div>
      );
    }

    if (!selectedAccount) {
      return (
        <div
          style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}
        >
          <ErrorState
            title="Không tìm thấy tài khoản"
            message={
              errorMessage || 'Tài khoản không tồn tại hoặc đã bị gỡ bỏ.'
            }
          />
          <div style={{ marginTop: '16px' }}>
            <AppButton onClick={() => onNavigate?.('/accounts')}>
              <ArrowLeftIcon size={16} />
              <span>Quay lại danh sách</span>
            </AppButton>
          </div>
        </div>
      );
    }

    const platformInfo = getPlatformConfig(selectedAccount.platform);

    return (
      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '24px 16px',
          color: 'var(--text-color)',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => onNavigate?.('/accounts')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted-color)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              padding: 0,
            }}
          >
            <ArrowLeftIcon size={14} />
            <span>Danh sách tài khoản</span>
          </button>
        </div>

        <PageHeader
          title={`Chi tiết tài khoản: ${selectedAccount.username || selectedAccount.platform}`}
          subtitle="Quản lý thông tin định danh và bảo mật bí mật (C05 / SEC-02)"
        />

        {/* Alerts */}
        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: 'var(--danger-text)',
              marginBottom: '20px',
              fontSize: '13px',
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
              color: 'var(--success-text)',
              marginBottom: '20px',
              fontSize: '13px',
            }}
          >
            {successMessage}
          </div>
        )}

        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}
        >
          {/* Metadata Card */}
          <AppCard style={{ padding: '24px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '12px',
                marginBottom: '20px',
              }}
            >
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: platformInfo.color,
                    backgroundColor: platformInfo.bg,
                    border: `1px solid ${platformInfo.border}`,
                    marginBottom: '8px',
                  }}
                >
                  {platformInfo.label}
                </span>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '20px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                  }}
                >
                  {selectedAccount.username || '(Chưa đặt Username)'}
                </h2>
              </div>

              <div>
                {selectedAccount.status === 'active' ? (
                  <StatusBadge status="success" label="Đang hoạt động" />
                ) : (
                  <StatusBadge status="neutral" label="Đã lưu trữ" />
                )}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: '16px',
                padding: '16px',
                backgroundColor: 'var(--surface-subtle)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                marginBottom: '20px',
                fontSize: '13px',
              }}
            >
              <div>
                <span style={{ color: 'var(--muted-color)' }}>
                  Platform Account ID / UID:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.platform_account_id || 'Chưa cung cấp'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>
                  Email khôi phục (Recovery Email):
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.recovery_email || 'Chưa thiết lập'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>Nhóm phân loại:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--accent-text)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.account_group || 'Chưa phân nhóm'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>Người phụ trách:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.assigned_employee_name
                    ? `${selectedAccount.assigned_employee_name}${selectedAccount.assigned_employee_code ? ` (${selectedAccount.assigned_employee_code})` : ''}`
                    : 'Chưa phân công'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>Phiên bản (Version):</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  v{selectedAccount.version}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>Ngày tạo:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {new Date(selectedAccount.created_at).toLocaleDateString(
                    'vi-VN',
                  )}
                </div>
              </div>
            </div>

            {selectedAccount.notes && (
              <div style={{ marginBottom: '20px' }}>
                <span style={{ fontSize: '13px', color: 'var(--muted-color)' }}>
                  Ghi chú:
                </span>
                <div
                  style={{
                    marginTop: '4px',
                    fontSize: '14px',
                    color: 'var(--text-color)',
                    lineHeight: '1.5',
                  }}
                >
                  {selectedAccount.notes}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <ActionIconButton
                action="edit"
                target={selectedAccount.username || selectedAccount.platform}
                testId="account-detail-edit"
                onClick={() => {
                  setEditAccount(selectedAccount);
                  setEditUsername(selectedAccount.username || '');
                  setEditPlatformAccountId(
                    selectedAccount.platform_account_id || '',
                  );
                  setEditRecoveryEmail(selectedAccount.recovery_email || '');
                  setEditAccountGroup(selectedAccount.account_group || '');
                  setEditAssignedEmployeeId(
                    selectedAccount.assigned_employee_id || '',
                  );
                  setEditStatus(selectedAccount.status);
                  setEditNotes(selectedAccount.notes || '');
                  setShowEditModal(true);
                }}
              />

              {selectedAccount.status === 'active' ? (
                <ActionIconButton
                  action="deactivate"
                  target={selectedAccount.username || selectedAccount.platform}
                  testId="account-detail-archive"
                  onClick={() => {
                    setArchiveTargetAccount(selectedAccount);
                    setShowArchiveModal(true);
                  }}
                />
              ) : (
                <ActionIconButton
                  action="reactivate"
                  target={selectedAccount.username || selectedAccount.platform}
                  testId="account-detail-restore"
                  onClick={() => handleRestoreAccount(selectedAccount)}
                  disabled={actionLoading}
                />
              )}
            </div>
          </AppCard>

          {/* Secret & Credentials Management (SEC-02 / C05) */}
          <AppCard style={{ padding: '24px', border: '1px solid #14B8A6' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
              }}
            >
              <div style={{ color: 'var(--accent-text)' }}>
                <ShieldAlertIcon size={20} />
              </div>
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Quản lý Mật khẩu & Bí mật (C05 Secret Vault)
              </h3>
            </div>
            <p
              style={{
                margin: '0 0 20px 0',
                fontSize: '13px',
                color: 'var(--muted-color)',
                lineHeight: '1.5',
              }}
            >
              Mật khẩu, mã 2FA và mật khẩu email được mã hóa AEAD (AES-256-GCM)
              độc lập. Mật khẩu không bao giờ lưu plaintext và chỉ được giải mã
              tạm thời khi Chủ sở hữu xác thực lại danh tính (Reauthentication).
            </p>

            {/* 1. Login Password */}
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                  }}
                >
                  Mật khẩu đăng nhập (Login Password)
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.secret_types?.includes('password') ||
                  selectedAccount.has_secret
                    ? 'Đã cấu hình mật khẩu bí mật trong vault'
                    : 'Chưa có mật khẩu nào được thiết lập'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <AppButton
                  variant="primary"
                  onClick={() => {
                    if (selectedAccount)
                      openRevealModal(selectedAccount, 'password');
                  }}
                >
                  <EyeIcon size={16} />
                  <span>Xem mật khẩu</span>
                </AppButton>

                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setUpdateSecretTargetAccount(selectedAccount);
                    setNewSecretType('password');
                    setShowUpdateSecretModal(true);
                  }}
                >
                  <LockIcon size={16} />
                  <span>Cập nhật mật khẩu</span>
                </AppButton>
              </div>
            </div>

            {/* 2. Two-factor Secret (2FA / TOTP) */}
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                  }}
                >
                  Mã xác thực 2 lớp (Two-Factor / 2FA Secret)
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.secret_types?.includes('totp_secret') ||
                  selectedAccount.secret_types?.includes('two_fa_secret')
                    ? 'Đã lưu mã bí mật 2FA trong vault'
                    : 'Chưa thiết lập mã xác thực 2 lớp'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    if (selectedAccount) {
                      const typeToReveal: AccountSecretType =
                        selectedAccount.secret_types?.includes('two_fa_secret')
                          ? 'two_fa_secret'
                          : 'totp_secret';
                      openRevealModal(selectedAccount, typeToReveal);
                    }
                  }}
                >
                  <EyeIcon size={16} />
                  <span>Xem mã 2FA</span>
                </AppButton>

                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setUpdateSecretTargetAccount(selectedAccount);
                    setNewSecretType('totp_secret');
                    setShowUpdateSecretModal(true);
                  }}
                >
                  <LockIcon size={16} />
                  <span>Cập nhật 2FA</span>
                </AppButton>
              </div>
            </div>

            {/* 3. Recovery Email Password */}
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                  }}
                >
                  Mật khẩu Email khôi phục (Email Password)
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.secret_types?.includes('email_password')
                    ? 'Đã lưu mật khẩu email khôi phục trong vault'
                    : 'Chưa thiết lập mật khẩu email khôi phục'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    if (selectedAccount)
                      openRevealModal(selectedAccount, 'email_password');
                  }}
                >
                  <EyeIcon size={16} />
                  <span>Xem pass Email</span>
                </AppButton>

                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setUpdateSecretTargetAccount(selectedAccount);
                    setNewSecretType('email_password');
                    setShowUpdateSecretModal(true);
                  }}
                >
                  <LockIcon size={16} />
                  <span>Cập nhật pass Email</span>
                </AppButton>
              </div>
            </div>
          </AppCard>
        </div>
      </div>
    );
  };

  // ==========================================
  // RENDER VIEW: (/accounts or /accounts/:id)
  // ==========================================
  return (
    <div
      style={{
        maxWidth: accountId ? '900px' : '1200px',
        margin: '0 auto',
        padding: '24px 16px',
        color: 'var(--text-color)',
      }}
    >
      {accountId ? (
        renderDetailView()
      ) : (
        <>
          {/* 1. Page Header */}
          <PageHeader
            title="Tài khoản quản lý (ACC)"
            subtitle="Quản lý tập trung tài khoản TikTok, Gmail, AI, PM và lưu trữ bí mật an toàn (C05 / SEC-02)"
            actions={
              <AppButton
                variant="primary"
                onClick={() => setShowCreateModal(true)}
                disabled={loading}
              >
                <PlusIcon size={16} />
                <span>Thêm tài khoản</span>
              </AppButton>
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
                color: 'var(--danger-text)',
                marginBottom: '20px',
                fontSize: '13px',
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
                color: 'var(--success-text)',
                marginBottom: '20px',
                fontSize: '13px',
              }}
            >
              {successMessage}
            </div>
          )}

          {/* Shortcut: Personal Account Password Change (UI20) */}
          <div
            data-testid="banner-personal-password-change"
            style={{
              padding: '14px 18px',
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid rgba(51, 65, 85, 0.8)',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(20, 184, 166, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-text)',
                  flexShrink: 0,
                }}
              >
                <LockIcon size={18} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                  }}
                >
                  Bảo mật tài khoản đăng nhập của bạn
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  Đổi mật khẩu tài khoản đăng nhập hệ thống trong Cài đặt & Hồ
                  sơ.
                </div>
              </div>
            </div>
            <AppButton
              variant="secondary"
              data-testid="btn-nav-change-password"
              onClick={() => onNavigate?.('/settings')}
            >
              <LockIcon size={14} />
              <span>Đổi mật khẩu tài khoản</span>
            </AppButton>
          </div>

          {/* 2. KPI Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            <AppCard style={{ padding: '16px' }}>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}
              >
                TỔNG SỐ TÀI KHOẢN
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                  marginTop: '6px',
                }}
              >
                {metrics.total}
              </div>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', marginTop: '4px' }}
              >
                Tất cả dịch vụ được kết nối
              </div>
            </AppCard>

            <AppCard style={{ padding: '16px' }}>
              <div
                style={{ fontSize: '12px', color: 'var(--success-text)', fontWeight: 600 }}
              >
                ĐANG HOẠT ĐỘNG
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: 'var(--success-text)',
                  marginTop: '6px',
                }}
              >
                {metrics.active}
              </div>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', marginTop: '4px' }}
              >
                Khả dụng cho vận hành
              </div>
            </AppCard>

            <AppCard style={{ padding: '16px' }}>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}
              >
                ĐÃ LƯU TRỮ (ARCHIVED)
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: 'var(--muted-color)',
                  marginTop: '6px',
                }}
              >
                {metrics.archived}
              </div>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', marginTop: '4px' }}
              >
                Bảo toàn lịch sử kiểm toán
              </div>
            </AppCard>
          </div>

          {/* 3. Filter Bar */}
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
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px',
                  alignItems: 'center',
                  flex: 1,
                }}
              >
                {/* Search Box */}
                <div
                  style={{
                    position: 'relative',
                    minWidth: '220px',
                    flex: 1,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Tìm theo Username, UID, Email khôi phục, Nhóm…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px 8px 36px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--muted-color)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <SearchIcon size={16} />
                  </div>
                </div>

                {/* Platform Filter */}
                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value)}
                  style={{
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                  }}
                >
                  <option value="all">Tất cả nền tảng</option>
                  <option value="tiktok">TikTok</option>
                  <option value="gmail">Gmail / Google</option>
                  <option value="ai">AI / LLM</option>
                  <option value="pm">PM / Quản lý dự án</option>
                  <option value="other">Khác</option>
                </select>

                {/* Group Filter */}
                <select
                  data-testid="filter-account-group"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  style={{
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                  }}
                >
                  <option value="all">Tất cả nhóm</option>
                  <option value="Marketing">Marketing / Kênh</option>
                  <option value="Production">Sản xuất / AI</option>
                  <option value="Operations">Vận hành / Quản trị</option>
                  <option value="Sales">Bán hàng / Shop</option>
                </select>

                {/* Assignee Filter */}
                <select
                  data-testid="filter-account-assignee"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  style={{
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                  }}
                >
                  <option value="all">Tất cả người phụ trách</option>
                  {employeesList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                  }}
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="locked">Tạm khóa</option>
                  <option value="archived">Đã lưu trữ</option>
                </select>
              </div>

              <button
                type="button"
                onClick={loadData}
                disabled={loading || actionLoading}
                style={{
                  boxSizing: 'border-box',
                  minHeight: '36px',
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                }}
              >
                <RotateCcwIcon size={14} />
                <span>Làm mới</span>
              </button>
            </div>
          </AppCard>

          {/* 4. Accounts List Table */}
          {loading ? (
            <LoadingState message="Đang tải danh sách tài khoản…" />
          ) : filteredAccounts.length === 0 ? (
            <EmptyState
              title="Chưa có tài khoản nào"
              description={
                searchQuery ||
                platformFilter !== 'all' ||
                statusFilter !== 'all' ||
                groupFilter !== 'all' ||
                assigneeFilter !== 'all'
                  ? 'Không tìm thấy tài khoản phù hợp với bộ lọc hiện tại.'
                  : 'Chưa có tài khoản quản lý nào được tạo trong cửa hàng. Hãy bấm "+ Thêm tài khoản" để bắt đầu.'
              }
              action={
                <AppButton
                  variant="primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  <PlusIcon size={16} />
                  <span>Thêm tài khoản mới</span>
                </AppButton>
              }
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px',
                  backgroundColor: 'var(--surface-hover)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px', color: 'var(--muted-color)' }}>
                      Nền tảng
                    </th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted-color)' }}>
                      Username / UID
                    </th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted-color)' }}>
                      Email khôi phục
                    </th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted-color)' }}>
                      Nhóm & Phụ trách
                    </th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted-color)' }}>
                      Trạng thái
                    </th>
                    <th style={{ padding: '12px 16px', color: 'var(--muted-color)' }}>
                      Ghi chú
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        color: 'var(--muted-color)',
                        textAlign: 'right',
                      }}
                    >
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAccounts.map((account) => {
                    const pInfo = getPlatformConfig(account.platform);

                    return (
                      <tr
                        key={account.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 700,
                              color: pInfo.color,
                              backgroundColor: pInfo.bg,
                              border: `1px solid ${pInfo.border}`,
                            }}
                          >
                            {pInfo.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-color)' }}>
                            {account.username || (
                              <span style={{ color: 'var(--muted-color)' }}>Chưa đặt</span>
                            )}
                          </div>
                          {account.platform_account_id && (
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                                marginTop: '2px',
                              }}
                            >
                              UID: {account.platform_account_id}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                          {account.recovery_email || '-'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {account.account_group ? (
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 600,
                                backgroundColor: 'rgba(20, 184, 166, 0.12)',
                                color: 'var(--accent-text)',
                                marginBottom: '2px',
                              }}
                            >
                              {account.account_group}
                            </span>
                          ) : null}
                          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                            {account.assigned_employee_name || 'Chưa gán'}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {account.status === 'active' ? (
                            <StatusBadge
                              status="success"
                              label="Đang hoạt động"
                            />
                          ) : (
                            <StatusBadge status="neutral" label="Đã lưu trữ" />
                          )}
                        </td>
                        <td
                          style={{
                            padding: '12px 16px',
                            color: 'var(--muted-color)',
                            maxWidth: '180px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={account.notes || ''}
                        >
                          {account.notes || '-'}
                        </td>
                        <td
                          style={{
                            padding: '12px 16px',
                            textAlign: 'right',
                          }}
                        >
                          <div
                            style={{
                              display: 'inline-flex',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            {/* Detail / Vault */}
                            <ActionIconButton
                              action="view"
                              target={account.username || account.platform}
                              testId={`account-view-${account.id}`}
                              onClick={() =>
                                onNavigate?.(`/accounts/${account.id}`)
                              }
                            />

                            {/* Quick Reveal button */}
                            <button
                              type="button"
                              onClick={() => {
                                openRevealModal(account, 'password');
                              }}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: 'rgba(20, 184, 166, 0.1)',
                                border: '1px solid rgba(20, 184, 166, 0.3)',
                                borderRadius: '4px',
                                color: 'var(--accent-text)',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              title="Xác thực để xem mật khẩu"
                            >
                              <EyeIcon size={12} />
                              <span>Xem pass</span>
                            </button>

                            {/* Edit metadata */}
                            <ActionIconButton
                              action="edit"
                              target={account.username || account.platform}
                              testId={`account-edit-${account.id}`}
                              onClick={() => {
                                setEditAccount(account);
                                setEditUsername(account.username || '');
                                setEditPlatformAccountId(
                                  account.platform_account_id || '',
                                );
                                setEditRecoveryEmail(
                                  account.recovery_email || '',
                                );
                                setEditAccountGroup(
                                  account.account_group || '',
                                );
                                setEditAssignedEmployeeId(
                                  account.assigned_employee_id || '',
                                );
                                setEditStatus(account.status);
                                setEditNotes(account.notes || '');
                                setShowEditModal(true);
                              }}
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
                  testId="accounts-pager"
                  total={filteredAccounts.length}
                  page={safePage}
                  pageSize={pageSize}
                  onPage={setPage}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setPage(0);
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ========================================================
          MODAL 1: THÊM TÀI KHOẢN MỚI
         ======================================================== */}
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
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              width: '100%',
              maxWidth: '540px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Thêm tài khoản quản lý mới
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateAccount}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Nền tảng / Dịch vụ *
                  </label>
                  <select
                    value={newPlatform}
                    onChange={(e) =>
                      setNewPlatform(e.target.value as AccountPlatform)
                    }
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="tiktok">TikTok</option>
                    <option value="gmail">Gmail / Google</option>
                    <option value="ai">AI / LLM (OpenAI, Claude…)</option>
                    <option value="pm">
                      PM / Quản lý dự án (Trello, Jira…)
                    </option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Nhóm phân loại
                  </label>
                  <input
                    type="text"
                    placeholder="VD: Marketing, Production…"
                    value={newAccountGroup}
                    onChange={(e) => setNewAccountGroup(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Username / Email đăng nhập
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: shop_official@gmail.com"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Platform Account ID / UID
                  </label>
                  <input
                    type="text"
                    placeholder="UID hoặc ID định danh nền tảng"
                    value={newPlatformAccountId}
                    onChange={(e) => setNewPlatformAccountId(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Email khôi phục (Recovery Email)
                  </label>
                  <input
                    type="email"
                    placeholder="recovery@domain.com"
                    value={newRecoveryEmail}
                    onChange={(e) => setNewRecoveryEmail(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Người phụ trách
                  </label>
                  <select
                    value={newAssignedEmployeeId}
                    onChange={(e) => setNewAssignedEmployeeId(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="">-- Chưa phân công --</option>
                    {employeesList.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Encrypted Initial Secrets Section */}
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid rgba(20, 184, 166, 0.35)',
                  borderRadius: '6px',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--accent-text)',
                    marginBottom: '8px',
                  }}
                >
                  Bảo mật C05 (Tùy chọn — Tự động mã hóa AES-256-GCM)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '10px',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginBottom: '4px',
                      }}
                    >
                      Mật khẩu tài khoản
                    </label>
                    <input
                      type="password"
                      placeholder="Password…"
                      value={newInitPassword}
                      onChange={(e) => setNewInitPassword(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginBottom: '4px',
                      }}
                    >
                      Mã 2FA / TOTP Secret
                    </label>
                    <input
                      type="password"
                      placeholder="2FA Secret…"
                      value={newInitTwoFa}
                      onChange={(e) => setNewInitTwoFa(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginBottom: '4px',
                      }}
                    >
                      Mật khẩu Email
                    </label>
                    <input
                      type="password"
                      placeholder="Email Password…"
                      value={newInitEmailPassword}
                      onChange={(e) => setNewInitEmailPassword(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú sử dụng
                </label>
                <textarea
                  rows={2}
                  placeholder="Mục đích sử dụng, lưu ý đặc biệt…"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                    resize: 'vertical',
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
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--muted-color)',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Hủy
                </button>
                <AppButton
                  variant="primary"
                  type="submit"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Đang tạo…' : 'Tạo tài khoản'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: SỬA METADATA TÀI KHOẢN
         ======================================================== */}
      {showEditModal && editAccount && (
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
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Sửa thông tin tài khoản
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateAccount}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Tên tài khoản / Email / Username
                  </label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Platform Account ID / UID
                  </label>
                  <input
                    type="text"
                    value={editPlatformAccountId}
                    onChange={(e) => setEditPlatformAccountId(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Email khôi phục (Recovery Email)
                  </label>
                  <input
                    type="email"
                    value={editRecoveryEmail}
                    onChange={(e) => setEditRecoveryEmail(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Nhóm phân loại
                  </label>
                  <input
                    type="text"
                    value={editAccountGroup}
                    onChange={(e) => setEditAccountGroup(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Người phụ trách
                  </label>
                  <select
                    value={editAssignedEmployeeId}
                    onChange={(e) => setEditAssignedEmployeeId(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="">-- Chưa phân công --</option>
                    {employeesList.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Trạng thái
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as AccountStatus)
                    }
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="active">Đang hoạt động</option>
                    <option value="locked">Tạm khóa</option>
                    <option value="archived">Đã lưu trữ</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú
                </label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                    resize: 'vertical',
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
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--muted-color)',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Hủy
                </button>
                <AppButton
                  variant="primary"
                  type="submit"
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Đang lưu…' : 'Lưu thay đổi'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 3: LƯU TRỮ TÀI KHOẢN (ARCHIVE)
         ======================================================== */}
      {showArchiveModal && archiveTargetAccount && (
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
              backgroundColor: 'var(--surface-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              width: '100%',
              maxWidth: '460px',
              padding: '24px',
              boxSizing: 'border-box',
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
              <div style={{ color: 'var(--warning-text)' }}>
                <AlertTriangleIcon size={24} />
              </div>
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Xác nhận lưu trữ tài khoản
              </h3>
            </div>

            <p
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                lineHeight: '1.5',
                marginBottom: '16px',
              }}
            >
              Tài khoản{' '}
              <strong style={{ color: 'var(--text-color)' }}>
                {archiveTargetAccount.username || archiveTargetAccount.platform}
              </strong>{' '}
              sẽ được chuyển sang trạng thái lưu trữ. Dữ liệu và mật khẩu được
              bảo toàn nguyên vẹn và có thể khôi phục lại bất kỳ lúc nào.
            </p>

            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                Lý do lưu trữ (Tùy chọn)
              </label>
              <input
                type="text"
                placeholder="Ví dụ: Tạm ngưng chiến dịch, đổi kênh mới…"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
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
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                disabled={actionLoading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Hủy
              </button>
              <AppButton
                variant="primary"
                onClick={handleArchiveAccount}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang lưu trữ…' : 'Xác nhận lưu trữ'}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 4: XÁC THỰC LẠI & XEM MẬT KHẨU (REAUTH REVEAL)
         ======================================================== */}
      {showRevealReauthModal && revealTargetAccount && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-hover)',
              border: '1px solid #14B8A6',
              borderRadius: '8px',
              width: '100%',
              maxWidth: '460px',
              padding: '24px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <div style={{ color: 'var(--accent-text)' }}>
                  <LockIcon size={20} />
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                  }}
                >
                  Xác thực lại để xem mật khẩu
                </h3>
              </div>
              <button
                type="button"
                onClick={closeRevealModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {/* Revealed Secret Box */}
            {revealedSecret &&
            revealedSecretAccountId === revealTargetAccount?.id ? (
              <div>
                <div
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: 'var(--success-text)',
                  }}
                >
                  Mật khẩu được giải mã an toàn. Tự động ẩn sau{' '}
                  <strong>{revealCountdown}s</strong>.
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <code
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '16px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      letterSpacing: '1px',
                    }}
                  >
                    {revealedSecret}
                  </code>

                  <button
                    type="button"
                    onClick={handleCopySecret}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: copiedSecret ? '#10B981' : 'var(--surface-hover)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: copiedSecret ? 'var(--inverse-text, #0B1220)' : 'var(--info-text)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {copiedSecret ? (
                      <CheckIcon size={14} />
                    ) : (
                      <CopyIcon size={14} />
                    )}
                    <span>{copiedSecret ? 'Đã chép' : 'Sao chép'}</span>
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <AppButton variant="primary" onClick={closeRevealModal}>
                    Đóng bảo mật
                  </AppButton>
                </div>
              </div>
            ) : (
              /* Password Reauth Form */
              <form onSubmit={handleRevealSecret}>
                <p
                  style={{
                    margin: '0 0 16px 0',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    lineHeight: '1.5',
                  }}
                >
                  Theo tiêu chuẩn bảo mật <strong>SEC-02</strong>, bạn cần nhập
                  lại mật khẩu đăng nhập của tài khoản Chủ shop để xem bí mật
                  của{' '}
                  <strong style={{ color: 'var(--text-color)' }}>
                    {revealTargetAccount.username ||
                      revealTargetAccount.platform}
                  </strong>
                  .
                </p>

                <div style={{ marginBottom: '14px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Loại bí mật cần xem
                  </label>
                  <select
                    data-testid="reveal-secret-type-select"
                    value={revealSecretType}
                    onChange={(e) =>
                      setRevealSecretType(e.target.value as AccountSecretType)
                    }
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="password">
                      Mật khẩu đăng nhập (password)
                    </option>
                    <option value="totp_secret">
                      Mã xác thực 2 lớp (totp_secret)
                    </option>
                    <option value="two_fa_secret">
                      Mã xác thực 2 lớp (two_fa_secret)
                    </option>
                    <option value="email_password">
                      Mật khẩu Email khôi phục (email_password)
                    </option>
                    <option value="api_key">API Key (api_key)</option>
                    <option value="recovery_code">
                      Mã khôi phục (recovery_code)
                    </option>
                  </select>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Mật khẩu đăng nhập của bạn *
                  </label>
                  <input
                    type="password"
                    autoFocus
                    placeholder="Nhập mật khẩu Chủ shop…"
                    value={revealReauthPassword}
                    onChange={(e) => setRevealReauthPassword(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-color)',
                      fontSize: '13px',
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
                  <button
                    type="button"
                    onClick={closeRevealModal}
                    disabled={actionLoading}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--muted-color)',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Hủy
                  </button>
                  <AppButton
                    variant="primary"
                    type="submit"
                    disabled={actionLoading || !revealReauthPassword}
                  >
                    {actionLoading ? 'Đang xác thực…' : 'Xác thực & Xem'}
                  </AppButton>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 5: CẬP NHẬT SECRET MỚI (REAUTH WRITE)
         ======================================================== */}
      {showUpdateSecretModal && updateSecretTargetAccount && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              width: '100%',
              maxWidth: '480px',
              padding: '24px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Cập nhật Mật khẩu / Secret mới
              </h3>
              <button
                type="button"
                onClick={closeUpdateSecretModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleWriteSecret}>
              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Loại bí mật
                </label>
                <select
                  value={newSecretType}
                  onChange={(e) =>
                    setNewSecretType(e.target.value as AccountSecretType)
                  }
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                  }}
                >
                  <option value="password">
                    Mật khẩu đăng nhập (password)
                  </option>
                  <option value="totp_secret">
                    TOTP / 2FA Secret (totp_secret)
                  </option>
                  <option value="two_fa_secret">
                    Two-Factor Secret (two_fa_secret)
                  </option>
                  <option value="email_password">
                    Mật khẩu Email khôi phục (email_password)
                  </option>
                  <option value="api_key">API Key (api_key)</option>
                  <option value="recovery_code">
                    Mã khôi phục (recovery_code)
                  </option>
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Giá trị Mật khẩu / Secret mới *
                </label>
                <input
                  type="password"
                  placeholder="Nhập giá trị bí mật mới…"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--warning-text)',
                    marginBottom: '6px',
                  }}
                >
                  Xác thực lại: Mật khẩu Chủ shop hiện tại *
                </label>
                <input
                  type="password"
                  placeholder="Xác thực lại danh tính Chủ shop…"
                  value={updateSecretReauthPassword}
                  onChange={(e) =>
                    setUpdateSecretReauthPassword(e.target.value)
                  }
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid #F59E0B',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    fontSize: '13px',
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
                <button
                  type="button"
                  onClick={closeUpdateSecretModal}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--muted-color)',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Hủy
                </button>
                <AppButton
                  variant="primary"
                  type="submit"
                  disabled={
                    actionLoading ||
                    !newSecretValue ||
                    !updateSecretReauthPassword
                  }
                >
                  {actionLoading ? 'Đang lưu…' : 'Lưu bí mật'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
