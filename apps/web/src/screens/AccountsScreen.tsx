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
  AccountHealthStatus,
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
  getHealthStatusConfig,
  normalizeVnPhone,
  filterAccounts360,
  buildGmailClusters,
  buildPhoneClusters,
  buildProtectionClusters,
  computeTotpCode,
  parseBulkAccountsInput,
  sanitizeUiError,
  type PlatformConfig,
} from './helpers/accounts-helpers.js';

export {
  sanitizeUiError,
  filterAccounts360,
  buildGmailClusters,
  buildPhoneClusters,
  buildProtectionClusters,
  computeTotpCode,
  parseBulkAccountsInput,
  normalizeVnPhone,
  type PlatformConfig,
};

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

  // Filters & View Modes (List view)
  const [viewMode, setViewMode] = useState<
    'all' | 'clusters' | 'phones' | 'protection'
  >('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<string>('all');
  const [phoneFilter, setPhoneFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Client-side paging: GET /api/v1/accounts has no cursor/limit, so slice locally.
  const [page, setPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createMode, setCreateMode] = useState<'single' | 'bulk'>('single');
  const [newPlatform, setNewPlatform] = useState<AccountPlatform>('gmail');
  const [newUsername, setNewUsername] = useState<string>('');
  const [newPlatformAccountId, setNewPlatformAccountId] = useState<string>('');
  const [newRecoveryEmail, setNewRecoveryEmail] = useState<string>('');
  const [newAccountGroup, setNewAccountGroup] = useState<string>('');
  const [newAssignedEmployeeId, setNewAssignedEmployeeId] =
    useState<string>('');
  const [newHealthStatus, setNewHealthStatus] =
    useState<AccountHealthStatus>('healthy');
  const [newPhoneNumber, setNewPhoneNumber] = useState<string>('');
  const [newPhoneNote, setNewPhoneNote] = useState<string>('');
  const [newParentAccountId, setNewParentAccountId] = useState<string>('');
  const [newRecoveryAccountId, setNewRecoveryAccountId] = useState<string>('');
  const [newAuthenticatorAccountId, setNewAuthenticatorAccountId] =
    useState<string>('');
  const [newChildPlatforms, setNewChildPlatforms] = useState<AccountPlatform[]>(
    [],
  );
  const [newNotes, setNewNotes] = useState<string>('');
  const [newInitPassword, setNewInitPassword] = useState<string>('');
  const [newInitTwoFa, setNewInitTwoFa] = useState<string>('');
  const [newInitEmailPassword, setNewInitEmailPassword] = useState<string>('');
  const [newInitRecoveryCode, setNewInitRecoveryCode] = useState<string>('');
  const [bulkPasteText, setBulkPasteText] = useState<string>('');

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
  const [editHealthStatus, setEditHealthStatus] =
    useState<AccountHealthStatus>('healthy');
  const [editPhoneNumber, setEditPhoneNumber] = useState<string>('');
  const [editPhoneNote, setEditPhoneNote] = useState<string>('');
  const [editParentAccountId, setEditParentAccountId] = useState<string>('');
  const [editRecoveryAccountId, setEditRecoveryAccountId] =
    useState<string>('');
  const [editAuthenticatorAccountId, setEditAuthenticatorAccountId] =
    useState<string>('');
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
  const [revealHistoryId, setRevealHistoryId] = useState<string | null>(null);
  const [revealReauthPassword, setRevealReauthPassword] = useState<string>('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealedSecretAccountId, setRevealedSecretAccountId] = useState<
    string | null
  >(null);
  const [liveTotp, setLiveTotp] = useState<{
    code: string;
    formattedCode: string;
    remainingSeconds: number;
  } | null>(null);
  const [copiedTotp, setCopiedTotp] = useState<boolean>(false);
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
    setRevealHistoryId(null);
    setLiveTotp(null);
    setCopiedTotp(false);
    setRevealCountdown(0);
    setCopiedSecret(false);
    revealDeadlineRef.current = null;
  }, []);

  const openRevealModal = useCallback(
    (
      account: ManagedAccountData,
      secretType: AccountSecretType = 'password',
      historyId: string | null = null,
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
      setRevealHistoryId(historyId);
      setRevealReauthPassword('');
      setRevealedSecret(null);
      setRevealedSecretAccountId(null);
      setLiveTotp(null);
      setCopiedTotp(false);
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
        // Fetch full workspace accounts list (up to 200) so 360° graph traversal & cluster views have complete parent/child/phone links
        const params = new URLSearchParams();
        params.append('limit', '200');

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
  }, [accountId]);

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

  // 360° Bidirectional Lookup + Filtered accounts for display
  const lookup360Result = useMemo(
    () => filterAccounts360(accounts, searchQuery),
    [accounts, searchQuery],
  );

  const filteredAccounts = useMemo(() => {
    const normalizedSearch = searchQuery.toLowerCase().trim();
    const baseList = normalizedSearch
      ? lookup360Result.visibleAccounts
      : accounts;
    return baseList.filter((acc) => {
      const normalizedUser = (acc.username || '').toLowerCase();
      void normalizedUser;
      if (platformFilter !== 'all' && acc.platform !== platformFilter)
        return false;
      if (statusFilter !== 'all' && acc.status !== statusFilter) return false;
      if (
        healthFilter !== 'all' &&
        (acc.health_status || 'healthy') !== healthFilter
      )
        return false;
      if (
        phoneFilter !== 'all' &&
        normalizeVnPhone(acc.phone_number) !== normalizeVnPhone(phoneFilter)
      )
        return false;
      if (groupFilter !== 'all' && acc.account_group !== groupFilter)
        return false;
      if (
        assigneeFilter !== 'all' &&
        acc.assigned_employee_id !== assigneeFilter
      )
        return false;
      return true;
    });
  }, [
    accounts,
    lookup360Result,
    platformFilter,
    statusFilter,
    healthFilter,
    phoneFilter,
    groupFilter,
    assigneeFilter,
    searchQuery,
  ]);

  const gmailClustersData = useMemo(
    () => buildGmailClusters(filteredAccounts),
    [filteredAccounts],
  );

  const phoneClustersData = useMemo(
    () => buildPhoneClusters(filteredAccounts),
    [filteredAccounts],
  );

  const allPhoneClusters = useMemo(
    () => buildPhoneClusters(accounts),
    [accounts],
  );

  const protectionClustersData = useMemo(
    () => buildProtectionClusters(filteredAccounts),
    [filteredAccounts],
  );

  const gmailAccountsList = useMemo(
    () => accounts.filter((a) => a.platform === 'gmail'),
    [accounts],
  );

  const authenticatorAccountsList = useMemo(
    () =>
      accounts.filter(
        (a) => a.platform === 'authenticator' || a.platform === 'gmail',
      ),
    [accounts],
  );

  const recoveryAccountsList = useMemo(
    () =>
      accounts.filter(
        (a) => a.platform === 'recovery' || a.platform === 'gmail',
      ),
    [accounts],
  );

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
    let verifyRequired = 0;
    let gmailCount = 0;
    let socialCount = 0;
    for (const a of accounts) {
      if (a.status === 'active') active++;
      else if (a.status === 'archived') archived++;
      if (a.health_status === 'verify_required' || a.health_status === 'locked')
        verifyRequired++;
      if (a.platform === 'gmail') gmailCount++;
      if (
        a.platform === 'tiktok' ||
        a.platform === 'facebook' ||
        a.platform === 'youtube'
      )
        socialCount++;
    }
    return {
      total,
      active,
      archived,
      verifyRequired,
      attentionCount: verifyRequired,
      gmailCount,
      socialCount,
      phoneCount: allPhoneClusters.phones.length,
    };
  }, [accounts, allPhoneClusters]);

  const openEditModalForAccount = (account: ManagedAccountData) => {
    setEditAccount(account);
    setEditUsername(account.username || '');
    setEditPlatformAccountId(account.platform_account_id || '');
    setEditRecoveryEmail(account.recovery_email || '');
    setEditAccountGroup(account.account_group || '');
    setEditAssignedEmployeeId(account.assigned_employee_id || '');
    setEditStatus(account.status);
    setEditHealthStatus(account.health_status || 'healthy');
    setEditPhoneNumber(account.phone_number || '');
    setEditPhoneNote(account.phone_note || '');
    setEditParentAccountId(account.parent_account_id || '');
    setEditRecoveryAccountId(account.recovery_account_id || '');
    setEditAuthenticatorAccountId(account.authenticator_account_id || '');
    setEditNotes(account.notes || '');
    setShowEditModal(true);
  };

  const openQuickAddChildModal = (
    parentAcc: ManagedAccountData,
    childPlatform: AccountPlatform = 'tiktok',
  ) => {
    setCreateMode('single');
    setNewPlatform(childPlatform);
    setNewParentAccountId(parentAcc.id);
    setNewUsername(parentAcc.username || '');
    setNewPhoneNumber(parentAcc.phone_number || '');
    setNewPhoneNote(parentAcc.phone_note || '');
    setNewRecoveryEmail(parentAcc.recovery_email || '');
    setNewRecoveryAccountId(parentAcc.recovery_account_id || '');
    setNewAuthenticatorAccountId(parentAcc.authenticator_account_id || '');
    setNewAccountGroup(parentAcc.account_group || '');
    setNewAssignedEmployeeId(parentAcc.assigned_employee_id || '');
    setNewChildPlatforms([]);
    setShowCreateModal(true);
  };

  // Handler: Create Account (POST /api/v1/accounts — single or bulk paste)
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setErrorMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      if (createMode === 'bulk') {
        const parsedRows = parseBulkAccountsInput(bulkPasteText, newPlatform);
        if (parsedRows.length === 0) {
          throw new Error(
            'Vui lòng dán ít nhất 1 dòng tài khoản hợp lệ (email|mật_khẩu|mail_khôi_phục|2fa|sđt).',
          );
        }
        let createdCount = 0;
        for (const row of parsedRows) {
          const rowSecrets: Array<{
            secret_type: AccountSecretType;
            secret_value: string;
          }> = [];
          if (row.password) {
            rowSecrets.push({
              secret_type: 'password',
              secret_value: row.password,
            });
          }
          if (row.two_fa_secret) {
            rowSecrets.push({
              secret_type: 'totp_secret',
              secret_value: row.two_fa_secret,
            });
          }
          const bulkPayload: CreateAccountRequest = {
            platform: row.platform,
            username: row.username,
            recovery_email:
              row.recovery_email || newRecoveryEmail.trim() || undefined,
            phone_number:
              row.phone_number ||
              normalizeVnPhone(newPhoneNumber) ||
              undefined,
            phone_note: row.phone_note || newPhoneNote.trim() || undefined,
            parent_account_id: newParentAccountId || undefined,
            recovery_account_id: newRecoveryAccountId || undefined,
            authenticator_account_id: newAuthenticatorAccountId || undefined,
            account_group: newAccountGroup.trim() || undefined,
            assigned_employee_id: newAssignedEmployeeId || undefined,
            initial_secrets: rowSecrets.length > 0 ? rowSecrets : undefined,
          };
          const res = await fetch('/api/v1/accounts', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(bulkPayload),
          });
          const body = await res.json();
          if (!res.ok || !body.success) {
            throw new Error(
              body.error?.message ||
                `Không thể tạo tài khoản dòng "${row.username}"`,
            );
          }
          createdCount++;
        }
        setSuccessMessage(
          `Đã nhập hàng loạt thành công ${createdCount} tài khoản!`,
        );
        setShowCreateModal(false);
        setBulkPasteText('');
        await loadData();
        return;
      }

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
      if (newInitRecoveryCode.trim()) {
        initialSecrets.push({
          secret_type: 'recovery_code',
          secret_value: newInitRecoveryCode,
        });
      }

      const payload: CreateAccountRequest = {
        platform: newPlatform,
        username: newUsername.trim() || undefined,
        platform_account_id: newPlatformAccountId.trim() || undefined,
        recovery_email: newRecoveryEmail.trim() || undefined,
        account_group: newAccountGroup.trim() || undefined,
        assigned_employee_id: newAssignedEmployeeId || undefined,
        health_status: newHealthStatus,
        phone_number: normalizeVnPhone(newPhoneNumber) || undefined,
        phone_note: newPhoneNote.trim() || undefined,
        parent_account_id: newParentAccountId || undefined,
        recovery_account_id: newRecoveryAccountId || undefined,
        authenticator_account_id: newAuthenticatorAccountId || undefined,
        create_child_platforms:
          newPlatform === 'gmail' && newChildPlatforms.length > 0
            ? newChildPlatforms
            : undefined,
        notes: newNotes.trim() || undefined,
        initial_secrets: initialSecrets.length > 0 ? initialSecrets : undefined,
      };

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
      setNewHealthStatus('healthy');
      setNewPhoneNumber('');
      setNewPhoneNote('');
      setNewParentAccountId('');
      setNewRecoveryAccountId('');
      setNewAuthenticatorAccountId('');
      setNewChildPlatforms([]);
      setNewNotes('');
      setNewInitPassword('');
      setNewInitTwoFa('');
      setNewInitEmailPassword('');
      setNewInitRecoveryCode('');
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
        health_status: editHealthStatus,
        phone_number: normalizeVnPhone(editPhoneNumber) || null,
        phone_note: editPhoneNote.trim() || null,
        parent_account_id: editParentAccountId || null,
        recovery_account_id: editRecoveryAccountId || null,
        authenticator_account_id: editAuthenticatorAccountId || null,
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
            history_id: revealHistoryId || undefined,
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
      const rawSecretVal = String(revealBody.data.secret_value || '');
      revealDeadlineRef.current = Date.now() + 30000;
      setRevealedSecret(rawSecretVal);
      setRevealedSecretAccountId(targetAccountId);
      setRevealCountdown(30);
      setRevealReauthPassword('');
      if (
        revealSecretType === 'totp_secret' ||
        revealSecretType === 'two_fa_secret'
      ) {
        computeTotpCode(rawSecretVal)
          .then((totp) => {
            if (totp && showRevealReauthModalRef.current) {
              setLiveTotp(totp);
            }
          })
          .catch(() => {});
      } else {
        setLiveTotp(null);
      }
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

  const handleCopyTotp = async () => {
    if (!liveTotp?.code || revealedSecretAccountId !== revealTargetAccount?.id)
      return;
    try {
      await navigator.clipboard.writeText(liveTotp.code);
      setCopiedTotp(true);
      setTimeout(() => setCopiedTotp(false), 2000);
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
    const healthInfo = getHealthStatusConfig(selectedAccount.health_status);

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
          subtitle="Quản lý thông tin định danh, liên kết hệ sinh thái 4 tầng và bảo mật bí mật (C05 / SEC-02)"
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
                  {platformInfo.icon} {platformInfo.label}
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

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: healthInfo.color,
                    backgroundColor: healthInfo.bg,
                    border: `1px solid ${healthInfo.border}`,
                  }}
                >
                  {healthInfo.label}
                </span>
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
                  Số điện thoại & SIM:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.phone_number ? (
                    <>
                      📱 {selectedAccount.phone_number}{' '}
                      <span
                        style={{
                          fontSize: '12px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(59, 130, 246, 0.14)',
                          color: 'var(--info-text, #60A5FA)',
                        }}
                      >
                        {selectedAccount.phone_gmail_count || 0} Gmail
                      </span>
                      {selectedAccount.phone_note ? (
                        <div style={{ fontSize: '12px', color: 'var(--muted-color)', marginTop: '2px' }}>
                          {selectedAccount.phone_note}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    'Chưa gắn SĐT'
                  )}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>
                  Tài khoản Gmail gốc:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.parent_account_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate?.(`/accounts/${selectedAccount.parent_account_id}`)
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--accent-text)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: '13px',
                      }}
                    >
                      📧 {selectedAccount.parent_account_username || 'Xem Gmail gốc'}
                    </button>
                  ) : (
                    'Tài khoản độc lập / Gmail gốc'
                  )}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>
                  TK GG Authenticator bảo vệ:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.authenticator_account_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate?.(
                          `/accounts/${selectedAccount.authenticator_account_id}`,
                        )
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--accent-text)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: '13px',
                      }}
                    >
                      🔐 {selectedAccount.authenticator_account_username || 'Xem TK 2FA'}
                    </button>
                  ) : (
                    'Chưa liên kết'
                  )}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--muted-color)' }}>
                  TK / Email Khôi phục:
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.recovery_account_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate?.(`/accounts/${selectedAccount.recovery_account_id}`)
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--accent-text)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: '13px',
                      }}
                    >
                      🛡️ {selectedAccount.recovery_account_username}
                    </button>
                  ) : (
                    selectedAccount.recovery_email || 'Chưa thiết lập'
                  )}
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
                <span style={{ color: 'var(--muted-color)' }}>Phiên bản & Ngày tạo:</span>
                <div
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginTop: '2px',
                  }}
                >
                  v{selectedAccount.version} •{' '}
                  {new Date(selectedAccount.created_at).toLocaleDateString(
                    'vi-VN',
                  )}
                </div>
              </div>
            </div>

            {/* Child Channels / Protected Accounts / Same Phone Accounts */}
            {(selectedAccount.child_accounts?.length ||
              selectedAccount.protected_accounts?.length ||
              selectedAccount.same_phone_accounts?.length) ? (
              <div
                style={{
                  padding: '14px 16px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  marginBottom: '20px',
                }}
              >
                {selectedAccount.child_accounts &&
                selectedAccount.child_accounts.length > 0 ? (
                  <div style={{ marginBottom: '10px' }}>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      🌳 CÁC KÊNH MXH GẮN VỚI GMAIL NÀY (
                      {selectedAccount.child_accounts.length}):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedAccount.child_accounts.map((ch) => {
                        const chCfg = getPlatformConfig(ch.platform);
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => onNavigate?.(`/accounts/${ch.id}`)}
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              backgroundColor: chCfg.bg,
                              border: `1px solid ${chCfg.border}`,
                              color: chCfg.color,
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {chCfg.icon} {chCfg.shortLabel}:{' '}
                            {ch.username || ch.platform_account_id || ch.id.slice(0, 6)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedAccount.protected_accounts &&
                selectedAccount.protected_accounts.length > 0 ? (
                  <div style={{ marginBottom: '10px' }}>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      🔐 CÁC TÀI KHOẢN ĐANG ĐƯỢC BẢO VỆ / KHÔI PHỤC BỞI TK NÀY (
                      {selectedAccount.protected_accounts.length}):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedAccount.protected_accounts.map((pa) => {
                        const paCfg = getPlatformConfig(pa.platform);
                        return (
                          <button
                            key={pa.id}
                            type="button"
                            onClick={() => onNavigate?.(`/accounts/${pa.id}`)}
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              backgroundColor: paCfg.bg,
                              border: `1px solid ${paCfg.border}`,
                              color: paCfg.color,
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {paCfg.icon} {paCfg.shortLabel}:{' '}
                            {pa.username || pa.platform_account_id || pa.id.slice(0, 6)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedAccount.same_phone_accounts &&
                selectedAccount.same_phone_accounts.length > 0 ? (
                  <div>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      📱 TÀI KHOẢN KHÁC CÙNG SỐ ĐIỆN THOẠI{' '}
                      {selectedAccount.phone_number} (
                      {selectedAccount.same_phone_accounts.length}):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedAccount.same_phone_accounts.map((sp) => {
                        const spCfg = getPlatformConfig(sp.platform);
                        return (
                          <button
                            key={sp.id}
                            type="button"
                            onClick={() => onNavigate?.(`/accounts/${sp.id}`)}
                            style={{
                              padding: '4px 9px',
                              borderRadius: '6px',
                              backgroundColor: 'var(--surface-hover)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-color)',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {spCfg.icon} {sp.username || sp.platform_account_id}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

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
                onClick={() => openEditModalForAccount(selectedAccount)}
              />

              {selectedAccount.platform === 'gmail' && (
                <AppButton
                  variant="secondary"
                  onClick={() => openQuickAddChildModal(selectedAccount, 'tiktok')}
                >
                  <PlusIcon size={14} />
                  <span>Thêm kênh con (TikTok/FB/YTB)</span>
                </AppButton>
              )}

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
              Mật khẩu, mã 2FA (tự sinh mã 6 số trực tiếp) và mật khẩu email được mã hóa AEAD (AES-256-GCM)
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
                  Mã xác thực 2 lớp (Two-Factor / 2FA Secret + Tự sinh 6 số)
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
                    ? 'Đã lưu mã bí mật 2FA trong vault (Bấm Xem để lấy ngay mã 6 số)'
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

            {/* 4. Backup / Recovery Codes */}
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
                  Mã khôi phục dự phòng (Backup / Recovery Codes)
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginTop: '2px',
                  }}
                >
                  {selectedAccount.secret_types?.includes('recovery_code')
                    ? 'Đã lưu mã dự phòng 8 số trong vault'
                    : 'Chưa lưu mã khôi phục dự phòng'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    if (selectedAccount)
                      openRevealModal(selectedAccount, 'recovery_code');
                  }}
                >
                  <EyeIcon size={16} />
                  <span>Xem mã dự phòng</span>
                </AppButton>

                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setUpdateSecretTargetAccount(selectedAccount);
                    setNewSecretType('recovery_code');
                    setShowUpdateSecretModal(true);
                  }}
                >
                  <LockIcon size={16} />
                  <span>Cập nhật mã dự phòng</span>
                </AppButton>
              </div>
            </div>

            {/* 5. Secret History (Old Passwords for Account Recovery) */}
            {selectedAccount.secret_history &&
            selectedAccount.secret_history.length > 0 ? (
              <div
                style={{
                  marginTop: '20px',
                  paddingTop: '16px',
                  borderTop: '1px dashed var(--border-color)',
                }}
              >
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                    marginBottom: '6px',
                  }}
                >
                  🕒 Lịch sử mật khẩu / bí mật cũ ({selectedAccount.secret_history.length} bản lưu)
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '10px',
                  }}
                >
                  Dùng khi Google / Facebook / TikTok hỏi &ldquo;Nhập mật khẩu gần nhất bạn nhớ&rdquo; lúc kháng nghị hoặc khôi phục tài khoản.
                </div>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {selectedAccount.secret_history.map((hist) => (
                    <div
                      key={hist.id}
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        fontSize: '12px',
                      }}
                    >
                      <div>
                        <strong style={{ color: 'var(--text-color)' }}>
                          {hist.secret_type}
                        </strong>{' '}
                        <span style={{ color: 'var(--muted-color)' }}>
                          (v{hist.secret_version} • Lưu trữ ngày{' '}
                          {new Date(hist.archived_at).toLocaleString('vi-VN')})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          openRevealModal(
                            selectedAccount,
                            hist.secret_type,
                            hist.id,
                          )
                        }
                        style={{
                          padding: '4px 10px',
                          backgroundColor: 'rgba(20, 184, 166, 0.12)',
                          border: '1px solid rgba(20, 184, 166, 0.35)',
                          borderRadius: '6px',
                          color: 'var(--accent-text)',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Xem mật khẩu cũ này
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
          {/* 1. Page Header — Gọn gàng, thân thiện với người dùng */}
          <PageHeader
            title="Quản lý Tài khoản"
            subtitle="Lưu trữ tập trung tài khoản Gmail, TikTok, Facebook, YouTube, SĐT và mật khẩu bảo mật"
            actions={
              <div
                data-testid="banner-personal-password-change"
                style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
              >
                <AppButton
                  variant="secondary"
                  data-testid="btn-nav-change-password"
                  onClick={() => onNavigate?.('/settings')}
                >
                  <LockIcon size={14} />
                  <span>Đổi mật khẩu cá nhân</span>
                </AppButton>
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setCreateMode('bulk');
                    setShowCreateModal(true);
                  }}
                  disabled={loading}
                >
                  <PlusIcon size={16} />
                  <span>Nhập nhanh danh sách</span>
                </AppButton>
                <AppButton
                  variant="primary"
                  onClick={() => {
                    setCreateMode('single');
                    setShowCreateAdvanced(false);
                    setShowCreateModal(true);
                  }}
                  disabled={loading}
                >
                  <PlusIcon size={16} />
                  <span>Thêm tài khoản</span>
                </AppButton>
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
                color: 'var(--danger-text)',
                marginBottom: '16px',
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
                marginBottom: '16px',
                fontSize: '13px',
              }}
            >
              {successMessage}
            </div>
          )}

          {/* 2. Compact Summary Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <AppCard style={{ padding: '12px 16px' }}>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}
              >
                Tổng tài khoản
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                  }}
                >
                  {metrics.total}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--success-text)' }}>
                  {metrics.active} đang dùng
                </span>
              </div>
            </AppCard>

            <AppCard style={{ padding: '12px 16px' }}>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}
              >
                Gmail & Kênh MXH
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 700,
                    color: 'var(--accent-text)',
                  }}
                >
                  {metrics.gmailCount}{' '}
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--muted-color)' }}>
                    Gmail
                  </span>
                </span>
                <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  {metrics.socialCount} kênh MXH
                </span>
              </div>
            </AppCard>

            <AppCard style={{ padding: '12px 16px' }}>
              <div
                style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}
              >
                Số điện thoại (SIM)
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                  }}
                >
                  {metrics.phoneCount}{' '}
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--muted-color)' }}>
                    SĐT
                  </span>
                </span>
                <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Theo dõi SIM
                </span>
              </div>
            </AppCard>

            <AppCard style={{ padding: '12px 16px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color:
                    metrics.attentionCount > 0
                      ? 'var(--warning-text)'
                      : 'var(--muted-color)',
                  fontWeight: 600,
                }}
              >
                Cần kiểm tra / Khóa
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 700,
                    color:
                      metrics.attentionCount > 0
                        ? 'var(--warning-text)'
                        : 'var(--text-color)',
                  }}
                >
                  {metrics.attentionCount}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  {metrics.archived} lưu trữ
                </span>
              </div>
            </AppCard>
          </div>

          {/* 3. Unified View Tabs + Search & Filter Toolbar */}
          <AppCard style={{ padding: '14px 16px', marginBottom: '16px' }}>
            {/* Top Row: Clean Segmented View Switcher + Refresh */}
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
                data-testid="accounts-view-tabs"
                style={{
                  display: 'inline-flex',
                  gap: '4px',
                  flexWrap: 'wrap',
                  padding: '3px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {(
                  [
                    {
                      id: 'all',
                      label: `Danh sách (${filteredAccounts.length})`,
                    },
                    {
                      id: 'clusters',
                      label: `Theo Gmail (${gmailClustersData.clusters.length})`,
                    },
                    {
                      id: 'phones',
                      label: `Theo SĐT (${phoneClustersData.phones.length})`,
                    },
                    {
                      id: 'protection',
                      label: `Bảo mật & 2FA (${protectionClustersData.authenticators.length + protectionClustersData.recoveries.length})`,
                    },
                  ] as const
                ).map((tab) => {
                  const active = viewMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-testid={`tab-view-${tab.id}`}
                      onClick={() => setViewMode(tab.id)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: active
                          ? 'rgba(20, 184, 166, 0.16)'
                          : 'transparent',
                        color: active ? 'var(--accent-text)' : 'var(--muted-color)',
                        fontSize: '13px',
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={loadData}
                disabled={loading || actionLoading}
                style={{
                  boxSizing: 'border-box',
                  height: '34px',
                  padding: '0 12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 500,
                }}
              >
                <RotateCcwIcon size={13} />
                <span>Làm mới</span>
              </button>
            </div>

            {/* Bottom Row: Single-line Search + Compact Filters */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'minmax(min(100%, 240px), 2fr) repeat(auto-fit, minmax(140px, 1fr))',
                gap: '8px',
                alignItems: 'center',
              }}
            >
              {/* Search Box (Single Icon, Clean Placeholder) */}
              <div style={{ position: 'relative', width: '100%' }}>
                <input
                  type="text"
                  data-testid="accounts-360-search-input"
                  placeholder="Tìm theo email, tên kênh TikTok/FB/YTB, SĐT…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    height: '36px',
                    boxSizing: 'border-box',
                    padding: '0 30px 0 34px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: searchQuery.trim()
                      ? '1px solid #14B8A6'
                      : '1px solid var(--border-color)',
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
                  <SearchIcon size={15} />
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Xóa từ khóa tìm kiếm"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '6px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-color)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <CloseIcon size={13} />
                  </button>
                )}
              </div>

              {/* Platform Filter */}
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                style={{
                  height: '36px',
                  boxSizing: 'border-box',
                  padding: '0 10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                }}
              >
                <option value="all">Tất cả nền tảng</option>
                <option value="gmail">Gmail / Google</option>
                <option value="tiktok">TikTok</option>
                <option value="facebook">Facebook</option>
                <option value="youtube">YouTube</option>
                <option value="authenticator">Google Authenticator</option>
                <option value="recovery">TK Khôi phục</option>
                <option value="ai">AI / Công cụ</option>
                <option value="pm">Quản lý dự án</option>
                <option value="other">Khác</option>
              </select>

              {/* Health Filter */}
              <select
                data-testid="filter-account-health"
                value={healthFilter}
                onChange={(e) => setHealthFilter(e.target.value)}
                style={{
                  height: '36px',
                  boxSizing: 'border-box',
                  padding: '0 10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                }}
              >
                <option value="all">Mọi tình trạng</option>
                <option value="healthy">Hoạt động tốt</option>
                <option value="verify_required">Cần xác minh</option>
                <option value="locked">Đang bị khóa</option>
              </select>

              {/* Group Filter */}
              <select
                data-testid="filter-account-group"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                style={{
                  height: '36px',
                  boxSizing: 'border-box',
                  padding: '0 10px',
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
                <option value="Operations">Vận hành</option>
                <option value="Sales">Bán hàng / Shop</option>
              </select>

              {/* Assignee Filter */}
              <select
                data-testid="filter-account-assignee"
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                style={{
                  height: '36px',
                  boxSizing: 'border-box',
                  padding: '0 10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                }}
              >
                <option value="all">Mọi người phụ trách</option>
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
                  height: '36px',
                  boxSizing: 'border-box',
                  padding: '0 10px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  fontSize: '13px',
                }}
              >
                <option value="all">Đang dùng & Lưu trữ</option>
                <option value="active">Đang hoạt động</option>
                <option value="archived">Đã lưu trữ</option>
              </select>
            </div>

            {/* Phone Quick Filter Pills (Only when phones exist) */}
            {phoneClustersData.phones.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginTop: '10px',
                  paddingTop: '10px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: '12px', color: 'var(--muted-color)', fontWeight: 600 }}>
                  SĐT:
                </span>
                <button
                  type="button"
                  onClick={() => setPhoneFilter('all')}
                  style={{
                    padding: '3px 9px',
                    borderRadius: '999px',
                    border:
                      phoneFilter === 'all'
                        ? '1px solid #14B8A6'
                        : '1px solid var(--border-color)',
                    backgroundColor:
                      phoneFilter === 'all'
                        ? 'rgba(20, 184, 166, 0.14)'
                        : 'var(--surface-subtle)',
                    color:
                      phoneFilter === 'all'
                        ? 'var(--accent-text)'
                        : 'var(--muted-color)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Tất cả ({phoneClustersData.phones.length})
                </button>
                {phoneClustersData.phones.map((ph) => {
                  const isSelected = phoneFilter === ph.phone_number;
                  return (
                    <button
                      key={ph.phone_number}
                      type="button"
                      onClick={() =>
                        setPhoneFilter(isSelected ? 'all' : ph.phone_number)
                      }
                      style={{
                        padding: '3px 9px',
                        borderRadius: '999px',
                        border: isSelected
                          ? '1px solid #14B8A6'
                          : '1px solid var(--border-color)',
                        backgroundColor: isSelected
                          ? 'rgba(20, 184, 166, 0.14)'
                          : 'var(--surface-subtle)',
                        color: isSelected
                          ? 'var(--accent-text)'
                          : 'var(--text-color)',
                        fontSize: '12px',
                        fontWeight: isSelected ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {ph.phone_number}{' '}
                      <strong
                        style={{
                          color:
                            ph.gmail_count >= 4
                              ? 'var(--warning-text)'
                              : 'var(--accent-text)',
                        }}
                      >
                        ({ph.gmail_count} Gmail)
                      </strong>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Search Result Banner — ONLY shown when user actually typed a search query! */}
            {searchQuery.toLowerCase().trim().length > 0 && (
              <div
                data-testid="banner-360-lookup-result"
                style={{
                  marginTop: '10px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(20, 184, 166, 0.08)',
                  border: '1px solid rgba(20, 184, 166, 0.3)',
                  fontSize: '12px',
                  color: 'var(--text-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  Kết quả tìm kiếm cho <strong>&ldquo;{searchQuery.trim()}&rdquo;</strong>: Tìm thấy{' '}
                  <strong style={{ color: 'var(--accent-text)' }}>
                    {lookup360Result.directMatchIds.size}
                  </strong>{' '}
                  tài khoản khớp trực tiếp và{' '}
                  <strong style={{ color: 'var(--accent-text)' }}>
                    {lookup360Result.matchedAccounts.length}
                  </strong>{' '}
                  tài khoản liên kết (cùng Gmail hoặc SĐT).
                </div>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-hover)',
                    color: 'var(--muted-color)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Xóa tìm kiếm
                </button>
              </div>
            )}
          </AppCard>

          {/* 4. Accounts Content by View Mode */}
          {loading ? (
            <LoadingState message="Đang tải hệ sinh thái tài khoản…" />
          ) : filteredAccounts.length === 0 ? (
            <EmptyState
              title="Chưa có tài khoản nào"
              description={
                searchQuery ||
                platformFilter !== 'all' ||
                statusFilter !== 'all' ||
                healthFilter !== 'all' ||
                phoneFilter !== 'all' ||
                groupFilter !== 'all' ||
                assigneeFilter !== 'all'
                  ? 'Không tìm thấy tài khoản hoặc cụm liên kết nào phù hợp với bộ lọc hiện tại.'
                  : 'Chưa có tài khoản quản lý nào được tạo. Hãy bấm "+ Thêm tài khoản" hoặc "Dán hàng loạt" để bắt đầu.'
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
          ) : viewMode === 'clusters' ? (
            /* ==========================================
               VIEW MODE 2: THEO CỤM GMAIL GỐC (TREE)
               ========================================== */
            <div style={{ display: 'grid', gap: '16px' }}>
              {gmailClustersData.clusters.map(({ gmail, children }) => {
                const hCfg = getHealthStatusConfig(gmail.health_status);
                return (
                  <AppCard
                    key={gmail.id}
                    style={{
                      padding: '18px 20px',
                      borderLeft: '4px solid #EF4444',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#F87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                            }}
                          >
                            📧 Gmail gốc
                          </span>
                          <strong style={{ fontSize: '16px', color: 'var(--text-color)' }}>
                            {gmail.username || '(Chưa đặt email)'}
                          </strong>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: hCfg.color,
                              backgroundColor: hCfg.bg,
                              border: `1px solid ${hCfg.border}`,
                            }}
                          >
                            {hCfg.label}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            gap: '14px',
                            flexWrap: 'wrap',
                            marginTop: '8px',
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                          }}
                        >
                          <span>
                            📱 SĐT:{' '}
                            <strong style={{ color: 'var(--text-color)' }}>
                              {gmail.phone_number || 'Chưa gắn'}
                            </strong>
                            {gmail.phone_gmail_count ? ` (${gmail.phone_gmail_count} Gmail)` : ''}
                            {gmail.phone_note ? ` • ${gmail.phone_note}` : ''}
                          </span>
                          <span>
                            🔐 2FA:{' '}
                            <strong style={{ color: 'var(--text-color)' }}>
                              {gmail.authenticator_account_username || 'Chưa gắn TK 2FA'}
                            </strong>
                          </span>
                          <span>
                            🛡️ Khôi phục:{' '}
                            <strong style={{ color: 'var(--text-color)' }}>
                              {gmail.recovery_account_username ||
                                gmail.recovery_email ||
                                'Chưa gắn'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => openQuickAddChildModal(gmail, 'tiktok')}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid rgba(20, 184, 166, 0.35)',
                            backgroundColor: 'rgba(20, 184, 166, 0.12)',
                            color: 'var(--accent-text)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          + Thêm kênh con
                        </button>
                        <button
                          type="button"
                          onClick={() => openRevealModal(gmail, 'password')}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--text-color)',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Xem pass
                        </button>
                        <ActionIconButton
                          action="view"
                          target={gmail.username || 'gmail'}
                          onClick={() => onNavigate?.(`/accounts/${gmail.id}`)}
                        />
                        <ActionIconButton
                          action="edit"
                          target={gmail.username || 'gmail'}
                          onClick={() => openEditModalForAccount(gmail)}
                        />
                      </div>
                    </div>

                    {/* Child Channels under this Gmail */}
                    <div
                      style={{
                        marginTop: '14px',
                        paddingTop: '12px',
                        borderTop: '1px dashed var(--border-color)',
                      }}
                    >
                      {children.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                          Chưa có kênh TikTok / Facebook / YouTube nào gắn dưới Gmail này.
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
                            gap: '10px',
                          }}
                        >
                          {children.map((ch) => {
                            const chInfo = getPlatformConfig(ch.platform);
                            const chHealth = getHealthStatusConfig(ch.health_status);
                            return (
                              <div
                                key={ch.id}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  backgroundColor: 'var(--surface-subtle)',
                                  border: `1px solid ${chInfo.border}`,
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: '8px',
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        fontWeight: 700,
                                        color: chInfo.color,
                                      }}
                                    >
                                      {chInfo.icon} {chInfo.shortLabel}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        color: chHealth.color,
                                      }}
                                    >
                                      ●
                                    </span>
                                  </div>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      fontSize: '13px',
                                      color: 'var(--text-color)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {ch.username || ch.platform_account_id || 'Chưa đặt tên'}
                                  </div>
                                  {ch.platform_account_id && (
                                    <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                                      ID: {ch.platform_account_id}
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    onClick={() => openRevealModal(ch, 'password')}
                                    style={{
                                      padding: '4px 7px',
                                      borderRadius: '4px',
                                      border: '1px solid rgba(20, 184, 166, 0.3)',
                                      backgroundColor: 'rgba(20, 184, 166, 0.1)',
                                      color: 'var(--accent-text)',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Pass
                                  </button>
                                  <ActionIconButton
                                    action="view"
                                    target={ch.username || ch.platform}
                                    onClick={() => onNavigate?.(`/accounts/${ch.id}`)}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </AppCard>
                );
              })}

              {gmailClustersData.unlinkedAccounts.length > 0 && (
                <AppCard style={{ padding: '18px 20px' }}>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      marginBottom: '12px',
                    }}
                  >
                    🌐 Các tài khoản độc lập / Chưa gắn Gmail gốc (
                    {gmailClustersData.unlinkedAccounts.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {gmailClustersData.unlinkedAccounts.map((ua) => {
                      const pCfg = getPlatformConfig(ua.platform);
                      return (
                        <button
                          key={ua.id}
                          type="button"
                          onClick={() => openEditModalForAccount(ua)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: `1px solid ${pCfg.border}`,
                            backgroundColor: pCfg.bg,
                            color: pCfg.color,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {pCfg.icon} {pCfg.shortLabel}: {ua.username || ua.platform_account_id} (Bấm để gắn Gmail)
                        </button>
                      );
                    })}
                  </div>
                </AppCard>
              )}
            </div>
          ) : viewMode === 'phones' ? (
            /* ==========================================
               VIEW MODE 3: THEO SỐ ĐIỆN THOẠI (1 SĐT -> N GMAIL)
               ========================================== */
            <div style={{ display: 'grid', gap: '16px' }}>
              {phoneClustersData.phones.length === 0 ? (
                <AppCard style={{ padding: '24px', textAlign: 'center', color: 'var(--muted-color)' }}>
                  Chưa có tài khoản nào được gắn Số điện thoại. Hãy bấm biểu tượng Sửa (✏️) trên tài khoản để gắn SĐT và ghi chú vị trí SIM.
                </AppCard>
              ) : (
                phoneClustersData.phones.map((ph) => (
                  <AppCard
                    key={ph.phone_number}
                    style={{
                      padding: '18px 20px',
                      borderLeft:
                        ph.gmail_count >= 4
                          ? '4px solid #F59E0B'
                          : '4px solid #3B82F6',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                        marginBottom: '12px',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '17px', color: 'var(--text-color)' }}>
                            📱 {ph.phone_number}
                          </strong>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: 700,
                              backgroundColor:
                                ph.gmail_count >= 4
                                  ? 'rgba(245, 158, 11, 0.16)'
                                  : 'rgba(16, 185, 129, 0.15)',
                              color:
                                ph.gmail_count >= 4
                                  ? 'var(--warning-text)'
                                  : 'var(--success-text)',
                            }}
                          >
                            Đã tạo {ph.gmail_count} Gmail • Tổng {ph.total_count} TK
                            {ph.gmail_count >= 4 ? ' (Sắp chạm ngưỡng SIM)' : ''}
                          </span>
                        </div>
                        {ph.phone_note && (
                          <div style={{ fontSize: '12px', color: 'var(--muted-color)', marginTop: '4px' }}>
                            📍 Ghi chú vị trí SIM / Máy giữ SIM: <strong style={{ color: 'var(--text-color)' }}>{ph.phone_note}</strong>
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                        gap: '10px',
                      }}
                    >
                      {ph.accounts.map((acc) => {
                        const pCfg = getPlatformConfig(acc.platform);
                        return (
                          <div
                            key={acc.id}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border-color)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: pCfg.color }}>
                                {pCfg.icon} {pCfg.shortLabel}
                              </div>
                              <div
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: 'var(--text-color)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {acc.username || acc.platform_account_id}
                              </div>
                            </div>
                            <ActionIconButton
                              action="view"
                              target={acc.username || acc.platform}
                              onClick={() => onNavigate?.(`/accounts/${acc.id}`)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </AppCard>
                ))
              )}
            </div>
          ) : viewMode === 'protection' ? (
            /* ==========================================
               VIEW MODE 4: THEO GG AUTHENTICATOR & TK KHÔI PHỤC
               ========================================== */
            <div style={{ display: 'grid', gap: '16px' }}>
              {protectionClustersData.authenticators.length === 0 &&
              protectionClustersData.recoveries.length === 0 ? (
                <AppCard style={{ padding: '24px', textAlign: 'center', color: 'var(--muted-color)' }}>
                  Chưa có tài khoản Google Authenticator hoặc Tài khoản Khôi phục chuyên dụng nào. Hãy bấm &ldquo;+ Thêm tài khoản&rdquo; và chọn nền tảng <strong>Google Authenticator</strong> hoặc <strong>Tài khoản Khôi phục</strong>.
                </AppCard>
              ) : (
                <>
                  {protectionClustersData.authenticators.map(
                    ({ account, protectedAccounts }) => (
                      <AppCard
                        key={account.id}
                        style={{
                          padding: '18px 20px',
                          borderLeft: '4px solid #F59E0B',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '12px',
                            marginBottom: '12px',
                          }}
                        >
                          <div>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 700,
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                color: '#FBBF24',
                                marginRight: '8px',
                              }}
                            >
                              🔐 Google Authenticator
                            </span>
                            <strong style={{ fontSize: '16px', color: 'var(--text-color)' }}>
                              {account.username || account.platform_account_id}
                            </strong>
                            <span style={{ fontSize: '12px', color: 'var(--muted-color)', marginLeft: '8px' }}>
                              (Đang giữ 2FA cho {protectedAccounts.length} tài khoản)
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <ActionIconButton
                              action="view"
                              target={account.username || 'authenticator'}
                              onClick={() => onNavigate?.(`/accounts/${account.id}`)}
                            />
                            <ActionIconButton
                              action="edit"
                              target={account.username || 'authenticator'}
                              onClick={() => openEditModalForAccount(account)}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {protectedAccounts.map((pa) => {
                            const pCfg = getPlatformConfig(pa.platform);
                            return (
                              <button
                                key={pa.id}
                                type="button"
                                onClick={() => onNavigate?.(`/accounts/${pa.id}`)}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: '6px',
                                  backgroundColor: pCfg.bg,
                                  border: `1px solid ${pCfg.border}`,
                                  color: pCfg.color,
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {pCfg.icon} {pa.username || pa.platform_account_id}
                              </button>
                            );
                          })}
                        </div>
                      </AppCard>
                    ),
                  )}

                  {protectionClustersData.recoveries.map(
                    ({ account, protectedAccounts }) => (
                      <AppCard
                        key={account.id}
                        style={{
                          padding: '18px 20px',
                          borderLeft: '4px solid #38BDF8',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '12px',
                            marginBottom: '12px',
                          }}
                        >
                          <div>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 700,
                                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                                color: '#38BDF8',
                                marginRight: '8px',
                              }}
                            >
                              🛡️ TK Khôi phục (Recovery)
                            </span>
                            <strong style={{ fontSize: '16px', color: 'var(--text-color)' }}>
                              {account.username || account.platform_account_id}
                            </strong>
                            <span style={{ fontSize: '12px', color: 'var(--muted-color)', marginLeft: '8px' }}>
                              (Đang bảo vệ khôi phục cho {protectedAccounts.length} tài khoản)
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <ActionIconButton
                              action="view"
                              target={account.username || 'recovery'}
                              onClick={() => onNavigate?.(`/accounts/${account.id}`)}
                            />
                            <ActionIconButton
                              action="edit"
                              target={account.username || 'recovery'}
                              onClick={() => openEditModalForAccount(account)}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {protectedAccounts.map((pa) => {
                            const pCfg = getPlatformConfig(pa.platform);
                            return (
                              <button
                                key={pa.id}
                                type="button"
                                onClick={() => onNavigate?.(`/accounts/${pa.id}`)}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: '6px',
                                  backgroundColor: pCfg.bg,
                                  border: `1px solid ${pCfg.border}`,
                                  color: pCfg.color,
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {pCfg.icon} {pa.username || pa.platform_account_id}
                              </button>
                            );
                          })}
                        </div>
                      </AppCard>
                    ),
                  )}
                </>
              )}
            </div>
          ) : (
            /* ==========================================
               VIEW MODE 1: BẢNG TẤT CẢ & TRA CỨU 360°
               ========================================== */
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
                    <th style={{ padding: '12px 14px', color: 'var(--muted-color)' }}>
                      Nền tảng
                    </th>
                    <th style={{ padding: '12px 14px', color: 'var(--muted-color)' }}>
                      Tài khoản
                    </th>
                    <th style={{ padding: '12px 14px', color: 'var(--muted-color)' }}>
                      Liên kết (Gmail • SĐT)
                    </th>
                    <th style={{ padding: '12px 14px', color: 'var(--muted-color)' }}>
                      Nhóm & Phụ trách
                    </th>
                    <th style={{ padding: '12px 14px', color: 'var(--muted-color)' }}>
                      Trạng thái
                    </th>
                    <th
                      style={{
                        padding: '12px 14px',
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
                    const hInfo = getHealthStatusConfig(account.health_status);
                    const isDirectMatch =
                      lookup360Result?.directMatchIds.has(account.id) ?? false;

                    return (
                      <tr
                        key={account.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: isDirectMatch
                            ? 'rgba(20, 184, 166, 0.08)'
                            : undefined,
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        <td style={{ padding: '12px 14px' }}>
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
                            {pInfo.icon} {pInfo.shortLabel}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
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
                          {account.notes && (
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                                marginTop: '2px',
                                maxWidth: '220px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={account.notes}
                            >
                              📝 {account.notes}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'grid', gap: '3px', fontSize: '12px' }}>
                            {/* Parent Gmail or Child count */}
                            {account.parent_account_username ? (
                              <div>
                                <span style={{ color: 'var(--muted-color)' }}>Thuộc Gmail:</span>{' '}
                                <button
                                  type="button"
                                  onClick={() => setSearchQuery(account.parent_account_username || '')}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    color: 'var(--accent-text)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                  }}
                                >
                                  📧 {account.parent_account_username}
                                </button>
                              </div>
                            ) : account.platform === 'gmail' &&
                              (account.child_count || 0) > 0 ? (
                              <div style={{ color: 'var(--accent-text)', fontWeight: 600 }}>
                                🌳 Nuôi {account.child_count} kênh con (
                                {(account.child_platforms || []).join(', ')})
                              </div>
                            ) : null}

                            {/* Phone number + Gmail counter */}
                            {account.phone_number && (
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setSearchQuery(account.phone_number || '')}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    color: 'var(--text-color)',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                  }}
                                >
                                  📱 <strong>{account.phone_number}</strong>{' '}
                                  <span
                                    style={{
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                      color: 'var(--info-text, #60A5FA)',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {account.phone_gmail_count || 0} Gmail
                                  </span>
                                </button>
                                {account.phone_note && (
                                  <span style={{ color: 'var(--muted-color)', marginLeft: '4px' }}>
                                    ({account.phone_note})
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Authenticator & Recovery */}
                            {(account.authenticator_account_username ||
                              account.recovery_account_username ||
                              account.recovery_email) && (
                              <div style={{ color: 'var(--muted-color)' }}>
                                {account.authenticator_account_username && (
                                  <span style={{ marginRight: '8px' }}>
                                    🔐 {account.authenticator_account_username}
                                  </span>
                                )}
                                {(account.recovery_account_username ||
                                  account.recovery_email) && (
                                  <span>
                                    🛡️{' '}
                                    {account.recovery_account_username ||
                                      account.recovery_email}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
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
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: hInfo.color,
                                backgroundColor: hInfo.bg,
                                border: `1px solid ${hInfo.border}`,
                              }}
                            >
                              {hInfo.label}
                            </span>
                            {account.status === 'active' ? (
                              <StatusBadge
                                status="success"
                                label="Đang hoạt động"
                              />
                            ) : (
                              <StatusBadge status="neutral" label="Đã lưu trữ" />
                            )}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: '12px 14px',
                            textAlign: 'right',
                          }}
                        >
                          <div
                            style={{
                              display: 'inline-flex',
                              gap: '6px',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              justifyContent: 'flex-end',
                            }}
                          >
                            {account.platform === 'gmail' && (
                              <button
                                type="button"
                                onClick={() =>
                                  openQuickAddChildModal(account, 'tiktok')
                                }
                                style={{
                                  padding: '4px 7px',
                                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                  borderRadius: '4px',
                                  color: 'var(--info-text, #60A5FA)',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                                title="Thêm kênh TikTok / FB / YTB gắn vào Gmail này"
                              >
                                +Kênh con
                              </button>
                            )}

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
                              onClick={() => openEditModalForAccount(account)}
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
          MODAL 1: THÊM TÀI KHOẢN MỚI (ĐƠN LẺ / CỤM / DÁN HÀNG LOẠT)
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
              borderRadius: '10px',
              width: '100%',
              maxWidth: '640px',
              maxHeight: '92vh',
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
                marginBottom: '12px',
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

            {/* Mode Switch: Single vs Bulk Paste */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '14px',
                padding: '4px',
                backgroundColor: 'var(--surface-subtle)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                onClick={() => setCreateMode('single')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor:
                    createMode === 'single'
                      ? 'rgba(20, 184, 166, 0.18)'
                      : 'transparent',
                  color:
                    createMode === 'single'
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                  fontWeight: createMode === 'single' ? 700 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ➕ Thêm 1 tài khoản / Cụm kênh
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('bulk')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor:
                    createMode === 'bulk'
                      ? 'rgba(20, 184, 166, 0.18)'
                      : 'transparent',
                  color:
                    createMode === 'bulk'
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                  fontWeight: createMode === 'bulk' ? 700 : 500,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ⚡ Dán hàng loạt (email|pass|recovery|2fa|sdt)
              </button>
            </div>

            {/* Visual Platform Selector Pills */}
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
                Chọn nhanh loại Tài khoản / Nền tảng *
              </label>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  marginBottom: '8px',
                }}
              >
                {(
                  [
                    'gmail',
                    'tiktok',
                    'facebook',
                    'youtube',
                    'authenticator',
                    'recovery',
                    'ai',
                    'pm',
                    'other',
                  ] as AccountPlatform[]
                ).map((plat) => {
                  const cfg = getPlatformConfig(plat);
                  const selected = newPlatform === plat;
                  return (
                    <button
                      key={plat}
                      type="button"
                      onClick={() => setNewPlatform(plat)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: selected
                          ? `1px solid ${cfg.color}`
                          : '1px solid var(--border-color)',
                        backgroundColor: selected ? cfg.bg : 'var(--surface-subtle)',
                        color: selected ? cfg.color : 'var(--text-color)',
                        fontSize: '12px',
                        fontWeight: selected ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {cfg.icon} {cfg.shortLabel}
                    </button>
                  );
                })}
              </div>
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
                <option value="gmail">📧 Gmail / Google (Tài khoản gốc)</option>
                <option value="tiktok">🎵 TikTok (Gắn với Gmail)</option>
                <option value="facebook">📘 Facebook / FB (Gắn với Gmail)</option>
                <option value="youtube">▶️ YouTube / YTB (Gắn với Gmail)</option>
                <option value="authenticator">🔐 Google Authenticator (Giữ mã 2FA)</option>
                <option value="recovery">🛡️ Tài khoản Khôi phục (Recovery)</option>
                <option value="ai">🤖 AI / LLM (OpenAI, Claude…)</option>
                <option value="pm">📋 PM / Quản lý dự án (Trello, Jira…)</option>
                <option value="other">🌐 Khác</option>
              </select>
            </div>

            <form onSubmit={handleCreateAccount}>
              {createMode === 'bulk' ? (
                <div>
                  <div style={{ marginBottom: '12px' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--muted-color)',
                        marginBottom: '6px',
                      }}
                    >
                      Dán danh sách tài khoản (Mỗi dòng 1 tài khoản — định dạng:{' '}
                      <code>email|pass|recovery_email|2fa_secret|sdt</code>) *
                    </label>
                    <textarea
                      rows={6}
                      placeholder={
                        'shop01@gmail.com|MatKhau123|khoiphuc@gmail.com|JBSWY3DPEHPK3PXP|0901234567\nshop02@gmail.com|MatKhau456|khoiphuc@gmail.com||0901234567'
                      }
                      value={bulkPasteText}
                      onChange={(e) => setBulkPasteText(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                      gap: '10px',
                      marginBottom: '14px',
                    }}
                  >
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                        SĐT mặc định (nếu dòng không ghi SĐT)
                      </label>
                      <input
                        type="text"
                        placeholder="VD: 0901234567"
                        value={newPhoneNumber}
                        onChange={(e) => setNewPhoneNumber(e.target.value)}
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
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                        Ghi chú vị trí SIM / Máy giữ SIM
                      </label>
                      <input
                        type="text"
                        placeholder="VD: SIM Viettel số 1 - Máy iPhone X"
                        value={newPhoneNote}
                        onChange={(e) => setNewPhoneNote(e.target.value)}
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
              ) : (
                <>
                  {/* Parent Gmail Link (Highlighted when creating TikTok / FB / YTB) */}
                  {newPlatform !== 'gmail' && (
                    <div
                      style={{
                        padding: '12px',
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      <label
                        style={{
                          display: 'block',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#F87171',
                          marginBottom: '6px',
                        }}
                      >
                        📧 Gắn với Tài khoản Gmail gốc (Tự động kế thừa SĐT, GG Authenticator & TK Khôi phục)
                      </label>
                      <select
                        value={newParentAccountId}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setNewParentAccountId(pid);
                          const parentAcc = gmailAccountsList.find(
                            (g) => g.id === pid,
                          );
                          if (parentAcc) {
                            if (!newUsername && parentAcc.username) {
                              setNewUsername(parentAcc.username);
                            }
                            if (parentAcc.phone_number) {
                              setNewPhoneNumber(parentAcc.phone_number);
                            }
                            if (parentAcc.phone_note) {
                              setNewPhoneNote(parentAcc.phone_note);
                            }
                            if (parentAcc.recovery_email) {
                              setNewRecoveryEmail(parentAcc.recovery_email);
                            }
                            if (parentAcc.recovery_account_id) {
                              setNewRecoveryAccountId(
                                parentAcc.recovery_account_id,
                              );
                            }
                            if (parentAcc.authenticator_account_id) {
                              setNewAuthenticatorAccountId(
                                parentAcc.authenticator_account_id,
                              );
                            }
                            if (parentAcc.account_group) {
                              setNewAccountGroup(parentAcc.account_group);
                            }
                          }
                        }}
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
                        <option value="">-- Không gắn / Tài khoản độc lập --</option>
                        {gmailAccountsList.map((g) => (
                          <option key={g.id} value={g.id}>
                            📧 {g.username || g.platform_account_id}{' '}
                            {g.phone_number ? `(📱 ${g.phone_number})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

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
                        Platform Account ID / UID / @Handle
                      </label>
                      <input
                        type="text"
                        placeholder="VD: @tiktok_id hoặc UID FB/YTB"
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

                  {/* Phone Number + SIM Note + Live Gmail Counter */}
                  <div
                    style={{
                      padding: '12px',
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '10px',
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--muted-color)',
                            marginBottom: '6px',
                          }}
                        >
                          <span>📱 Số điện thoại đăng ký (SĐT)</span>
                          {normalizeVnPhone(newPhoneNumber) && (
                            <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>
                              Đang gắn{' '}
                              {phoneClustersData.phones.find(
                                (p) =>
                                  p.phone_number ===
                                  normalizeVnPhone(newPhoneNumber),
                              )?.gmail_count || 0}{' '}
                              Gmail
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          placeholder="VD: 0901234567"
                          value={newPhoneNumber}
                          onChange={(e) => setNewPhoneNumber(e.target.value)}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '8px 12px',
                            backgroundColor: 'var(--surface-hover)',
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
                          📍 Vị trí SIM / Máy giữ SIM (Lấy OTP)
                        </label>
                        <input
                          type="text"
                          placeholder="VD: SIM Viettel 01 - Máy Samsung A50"
                          value={newPhoneNote}
                          onChange={(e) => setNewPhoneNote(e.target.value)}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '8px 12px',
                            backgroundColor: 'var(--surface-hover)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: 'var(--text-color)',
                            fontSize: '13px',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Protection Links: GG Authenticator & Recovery Account */}
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
                        🔐 TK Google Authenticator bảo vệ
                      </label>
                      <select
                        value={newAuthenticatorAccountId}
                        onChange={(e) =>
                          setNewAuthenticatorAccountId(e.target.value)
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
                        <option value="">-- Chưa liên kết TK Authenticator --</option>
                        {authenticatorAccountsList.map((a) => (
                          <option key={a.id} value={a.id}>
                            🔐 {a.username || a.platform_account_id}
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
                        🛡️ Chọn TK Khôi phục (hoặc nhập Email dưới)
                      </label>
                      <select
                        value={newRecoveryAccountId}
                        onChange={(e) => {
                          const rid = e.target.value;
                          setNewRecoveryAccountId(rid);
                          const recAcc = recoveryAccountsList.find(
                            (r) => r.id === rid,
                          );
                          if (recAcc?.username && !newRecoveryEmail) {
                            setNewRecoveryEmail(recAcc.username);
                          }
                        }}
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
                        <option value="">-- Chọn từ danh sách TK Khôi phục --</option>
                        {recoveryAccountsList.map((r) => (
                          <option key={r.id} value={r.id}>
                            🛡️ {r.username || r.platform_account_id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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

                  {/* Quick Cluster Creation when platform === 'gmail' */}
                  {newPlatform === 'gmail' && (
                    <div
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: 'var(--info-text, #60A5FA)',
                          marginBottom: '6px',
                        }}
                      >
                        ⚡ Tạo nhanh Cụm kênh con gắn với Gmail này (Tùy chọn):
                      </div>
                      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                        {(
                          [
                            { id: 'tiktok', label: '🎵 Kênh TikTok' },
                            { id: 'facebook', label: '📘 Tài khoản Facebook' },
                            { id: 'youtube', label: '▶️ Kênh YouTube' },
                          ] as const
                        ).map((ch) => {
                          const checked = newChildPlatforms.includes(ch.id);
                          return (
                            <label
                              key={ch.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '12px',
                                color: 'var(--text-color)',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewChildPlatforms((prev) => [
                                      ...prev,
                                      ch.id,
                                    ]);
                                  } else {
                                    setNewChildPlatforms((prev) =>
                                      prev.filter((x) => x !== ch.id),
                                    );
                                  }
                                }}
                              />
                              <span>{ch.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                      Bảo mật C05 (Tùy chọn — Tự động mã hóa AES-256-GCM & Tự sinh mã 6 số 2FA)
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(140px, 1fr))',
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
                          placeholder="Base32 2FA Secret…"
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
                          onChange={(e) =>
                            setNewInitEmailPassword(e.target.value)
                          }
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
                          Mã dự phòng (Backup)
                        </label>
                        <input
                          type="password"
                          placeholder="Mã 8 số…"
                          value={newInitRecoveryCode}
                          onChange={(e) =>
                            setNewInitRecoveryCode(e.target.value)
                          }
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
                </>
              )}

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
                  {actionLoading
                    ? 'Đang tạo…'
                    : createMode === 'bulk'
                      ? 'Nhập hàng loạt'
                      : 'Tạo tài khoản'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: SỬA METADATA & LIÊN KẾT HỆ SINH THÁI TÀI KHOẢN
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
              borderRadius: '10px',
              width: '100%',
              maxWidth: '600px',
              maxHeight: '92vh',
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
                Sửa thông tin & Liên kết hệ sinh thái tài khoản
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

              {/* Ecosystem Links in Edit Modal */}
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
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
                  🔗 Liên kết Hệ sinh thái 4 Tầng (SĐT ➔ Gmail gốc ➔ Kênh con • 2FA • Khôi phục)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '10px',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                      📧 Thuộc Tài khoản Gmail gốc
                    </label>
                    <select
                      value={editParentAccountId}
                      onChange={(e) => setEditParentAccountId(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    >
                      <option value="">-- Không gắn / Gmail gốc độc lập --</option>
                      {gmailAccountsList
                        .filter((g) => g.id !== editAccount.id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            📧 {g.username || g.platform_account_id}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                      📱 Số điện thoại liên kết (SĐT)
                    </label>
                    <input
                      type="text"
                      placeholder="VD: 0901234567"
                      value={editPhoneNumber}
                      onChange={(e) => setEditPhoneNumber(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                    gap: '10px',
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                      📍 Ghi chú SIM / Máy giữ SIM
                    </label>
                    <input
                      type="text"
                      placeholder="VD: SIM số 2 - Máy phụ"
                      value={editPhoneNote}
                      onChange={(e) => setEditPhoneNote(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                      🔐 TK GG Authenticator
                    </label>
                    <select
                      value={editAuthenticatorAccountId}
                      onChange={(e) =>
                        setEditAuthenticatorAccountId(e.target.value)
                      }
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    >
                      <option value="">-- Chưa liên kết --</option>
                      {authenticatorAccountsList
                        .filter((a) => a.id !== editAccount.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            🔐 {a.username || a.platform_account_id}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted-color)', marginBottom: '4px' }}>
                      🛡️ TK Khôi phục
                    </label>
                    <select
                      value={editRecoveryAccountId}
                      onChange={(e) => setEditRecoveryAccountId(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-color)',
                        fontSize: '12px',
                      }}
                    >
                      <option value="">-- Chưa liên kết --</option>
                      {recoveryAccountsList
                        .filter((r) => r.id !== editAccount.id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            🛡️ {r.username || r.platform_account_id}
                          </option>
                        ))}
                    </select>
                  </div>
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
                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
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
                    Sức khỏe tài khoản
                  </label>
                  <select
                    value={editHealthStatus}
                    onChange={(e) =>
                      setEditHealthStatus(e.target.value as AccountHealthStatus)
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
                    <option value="healthy">🟢 Hoạt động tốt</option>
                    <option value="verify_required">🟡 Cần xác minh / Checkpoint</option>
                    <option value="locked">🔴 Bị khóa / Die</option>
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
                    Trạng thái lưu trữ
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
          MODAL 4: XÁC THỰC LẠI & XEM MẬT KHẨU (REAUTH REVEAL + 2FA 6 SỐ)
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
                  {revealHistoryId ? (
                    <strong>🕒 Mật khẩu lịch sử cũ </strong>
                  ) : (
                    <span>Mật khẩu </span>
                  )}
                  được giải mã an toàn. Tự động ẩn sau{' '}
                  <strong>{revealCountdown}s</strong>.
                </div>

                {/* Live 6-Digit 2FA Code Box (when revealing totp_secret / two_fa_secret) */}
                {liveTotp && (
                  <div
                    data-testid="live-totp-code-box"
                    style={{
                      padding: '14px 16px',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: 'var(--warning-text)',
                        }}
                      >
                        🔐 MÃ 6 SỐ 2FA HIỆN TẠI (Đổi sau {liveTotp.remainingSeconds}s):
                      </div>
                      <div
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '26px',
                          fontWeight: 800,
                          color: 'var(--text-color)',
                          letterSpacing: '3px',
                          marginTop: '4px',
                        }}
                      >
                        {liveTotp.formattedCode}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyTotp}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: copiedTotp ? '#10B981' : '#F59E0B',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#0B1220',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {copiedTotp ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                      <span>{copiedTotp ? 'Đã chép 6 số' : 'Chép 6 số'}</span>
                    </button>
                  </div>
                )}

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
                      wordBreak: 'break-all',
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
                      flexShrink: 0,
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
