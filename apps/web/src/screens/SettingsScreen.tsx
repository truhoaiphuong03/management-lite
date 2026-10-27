import React, { useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LockIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  SettingsIcon,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import {
  SYSTEM_VERSION,
  SYSTEM_COMMIT,
  SYSTEM_ENV,
  RELEASE_NOTES_CATALOG,
  type ReleaseHistoryEntry,
} from '../../../../packages/contracts/src/version.js';

export interface SettingsScreenProps {
  role: UserRole;
  onChangeRole: (newRole: UserRole) => void;
  onLogout: () => void;
}

let activeMediaQuery: MediaQueryList | null = null;
let activeMediaListener:
  ((e: MediaQueryListEvent | MediaQueryList) => void) | null = null;

export function removeThemeListener(): void {
  if (activeMediaQuery && activeMediaListener) {
    if (typeof activeMediaQuery.removeEventListener === 'function') {
      activeMediaQuery.removeEventListener('change', activeMediaListener);
    } else {
      const legacyMq = activeMediaQuery as {
        removeListener?: (
          listener: (e: MediaQueryListEvent | MediaQueryList) => void,
        ) => void;
      };
      if (typeof legacyMq.removeListener === 'function') {
        legacyMq.removeListener(activeMediaListener);
      }
    }
  }
  activeMediaQuery = null;
  activeMediaListener = null;
}

export function applyTheme(selectedTheme: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', selectedTheme);

  // Clean up any existing system theme listener before applying new state
  removeThemeListener();

  if (selectedTheme === 'light') {
    root.style.colorScheme = 'light';
    if (document.body) {
      document.body.style.backgroundColor = '#F8FAFC';
      document.body.style.color = '#0F172A';
    }
  } else if (selectedTheme === 'dark') {
    root.style.colorScheme = 'dark';
    if (document.body) {
      document.body.style.backgroundColor = '#0B1220';
      document.body.style.color = '#F8FAFC';
    }
  } else {
    root.style.colorScheme = 'light dark';

    const updateSystemVisuals = (matchesDark: boolean) => {
      if (document.body) {
        document.body.style.backgroundColor = matchesDark
          ? '#0B1220'
          : '#F8FAFC';
        document.body.style.color = matchesDark ? '#F8FAFC' : '#0F172A';
      }
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      activeMediaQuery = mq;
      updateSystemVisuals(mq.matches);

      activeMediaListener = (e: MediaQueryListEvent | MediaQueryList) => {
        if (
          typeof document !== 'undefined' &&
          document.documentElement.getAttribute('data-theme') === 'system'
        ) {
          const matchesDark =
            typeof e.matches === 'boolean'
              ? e.matches
              : activeMediaQuery
                ? activeMediaQuery.matches
                : false;
          updateSystemVisuals(matchesDark);
        }
      };

      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', activeMediaListener);
      } else {
        const legacyMq = mq as {
          addListener?: (
            listener: (e: MediaQueryListEvent | MediaQueryList) => void,
          ) => void;
        };
        if (typeof legacyMq.addListener === 'function') {
          legacyMq.addListener(activeMediaListener);
        }
      }
    } else if (document.body) {
      document.body.style.backgroundColor = '#0B1220';
      document.body.style.color = '#F8FAFC';
    }
  }
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  role,
  onLogout,
}) => {
  const [profile, setProfile] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Profile edit states
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDateOfBirth, setEditDateOfBirth] = useState('');
  const [editGender, setEditGender] = useState('');
  const [editNationalId, setEditNationalId] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPositionTitle, setEditPositionTitle] = useState('');
  const [editEmergencyContact, setEditEmergencyContact] = useState('');
  const [editBankName, setEditBankName] = useState('');
  const [editBankAccountNumber, setEditBankAccountNumber] = useState('');
  const [editBankAccountHolder, setEditBankAccountHolder] = useState('');
  const [editEmailPassword, setEditEmailPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (profile) {
      setEditName(profile.full_name || '');
      setEditPhone(profile.phone || '');
      setEditEmail(profile.user?.email || '');
      setEditDateOfBirth(profile.date_of_birth || '');
      setEditGender(profile.gender || '');
      setEditNationalId(profile.national_id || '');
      setEditAddress(profile.address || '');
      setEditPositionTitle(profile.position_title || '');
      setEditEmergencyContact(profile.emergency_contact || '');
      setEditBankName(profile.bank_name || '');
      setEditBankAccountNumber(profile.bank_account_number || '');
      setEditBankAccountHolder(profile.bank_account_holder || '');
    }
  }, [profile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setProfileMsg(null);
    const emailChanged =
      editEmail.trim().toLowerCase() !==
      (profile.user?.email || '').toLowerCase();
    if (emailChanged && !editEmailPassword) {
      setProfileMsg({
        type: 'error',
        text: 'Vui lòng nhập mật khẩu hiện tại để đổi email.',
      });
      return;
    }
    setProfileSaving(true);
    try {
      let token = csrfToken;
      if (!token) {
        const meRes = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });
        if (meRes.ok) {
          token = (await meRes.json()).data?.csrf_token || '';
          setCsrfToken(token);
        }
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['X-CSRF-Token'] = token;
      const payload: Record<string, unknown> = {
        full_name: editName,
        phone: editPhone,
        date_of_birth: editDateOfBirth,
        gender: editGender,
        national_id: editNationalId,
        address: editAddress,
        position_title: editPositionTitle,
        emergency_contact: editEmergencyContact,
        bank_name: editBankName,
        bank_account_number: editBankAccountNumber,
        bank_account_holder: editBankAccountHolder.toUpperCase(),
      };
      if (emailChanged) {
        payload['email'] = editEmail;
        payload['current_password'] = editEmailPassword;
      }
      const res = await fetch('/api/v1/auth/profile', {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const code = data?.error?.code;
        setProfileMsg({
          type: 'error',
          text:
            code === 'INVALID_CREDENTIALS'
              ? 'Mật khẩu hiện tại không đúng.'
              : data?.error?.message ||
                'Không thể cập nhật thông tin. Vui lòng thử lại.',
        });
        return;
      }
      setEditEmailPassword('');
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: data.data.full_name ?? prev.full_name,
              phone: data.data.phone,
              date_of_birth: data.data.date_of_birth ?? editDateOfBirth,
              gender: data.data.gender ?? editGender,
              national_id: data.data.national_id ?? editNationalId,
              address: data.data.address ?? editAddress,
              position_title: data.data.position_title ?? editPositionTitle,
              emergency_contact:
                data.data.emergency_contact ?? editEmergencyContact,
              bank_name: data.data.bank_name ?? editBankName,
              bank_account_number:
                data.data.bank_account_number ?? editBankAccountNumber,
              bank_account_holder:
                data.data.bank_account_holder ??
                editBankAccountHolder.toUpperCase(),
              user: prev.user
                ? {
                    ...prev.user,
                    email: data.data.email,
                    email_verified: data.data.email_verified,
                  }
                : null,
            }
          : prev,
      );
      setProfileMsg({
        type: 'success',
        text:
          data.data.message +
          (data.data.email_changed
            ? ' Hãy bấm "Gửi lại email xác minh" ở banner phía trên.'
            : ''),
      });
      if (data.data.email_changed) {
        setTimeout(() => window.location.reload(), 2500);
      }
    } catch {
      setProfileMsg({
        type: 'error',
        text: 'Lỗi kết nối máy chủ. Vui lòng thử lại.',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  // Password change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Preferences states (SET-002, SET-003)
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('mglite_theme') || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [timezone, setTimezone] = useState<string>(() => {
    try {
      return localStorage.getItem('mglite_timezone') || 'Asia/Ho_Chi_Minh';
    } catch {
      return 'Asia/Ho_Chi_Minh';
    }
  });
  const [currency, setCurrency] = useState<string>(() => {
    try {
      return localStorage.getItem('mglite_currency') || 'VND';
    } catch {
      return 'VND';
    }
  });
  const [prefSavedMessage, setPrefSavedMessage] = useState<string | null>(null);
  const [runtimeSystemInfo, setRuntimeSystemInfo] = useState<{
    version: string;
    commit: string;
    releasedAt: string | null;
    environment: string;
    productionStatus: string;
  }>({
    version: SYSTEM_VERSION.replace(/^v/i, ''),
    commit: SYSTEM_COMMIT.slice(0, 7),
    releasedAt: null,
    environment: SYSTEM_ENV,
    productionStatus:
      SYSTEM_ENV.toLowerCase() === 'production'
        ? 'Production — Đang hoạt động'
        : 'Đang kiểm tra trạng thái...',
  });
  const [releaseHistory, setReleaseHistory] = useState<ReleaseHistoryEntry[]>(
    [],
  );
  const [releaseHistoryLoading, setReleaseHistoryLoading] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleSavePreferences = (
    newTheme: string,
    newTimezone: string,
    newCurrency: string,
  ) => {
    setTheme(newTheme);
    setTimezone(newTimezone);
    setCurrency(newCurrency);
    applyTheme(newTheme);
    try {
      localStorage.setItem('mglite_theme', newTheme);
      localStorage.setItem('mglite_timezone', newTimezone);
      localStorage.setItem('mglite_currency', newCurrency);
    } catch {
      // Ignored: fallback to memory state
    }
    setPrefSavedMessage(
      'Đã lưu tùy chọn giao diện, múi giờ và tiền tệ thành công.',
    );
    setTimeout(() => setPrefSavedMessage(null), 3000);
  };

  useEffect(() => {
    let active = true;
    const fetchInitialData = async () => {
      if (role === 'owner') {
        setReleaseHistoryLoading(true);
      } else {
        setReleaseHistory([]);
      }
      try {
        const [empRes, meRes, healthRes, relVerRes, releasesRes] =
          await Promise.all([
            fetch('/api/v1/employees/me', { credentials: 'include' }),
            fetch('/api/v1/auth/me', { credentials: 'include' }),
            fetch('/api/v1/health', { cache: 'no-store' }).catch(() => null),
            fetch('/release-version.json', { cache: 'no-store' }).catch(
              () => null,
            ),
            role === 'owner'
              ? fetch('/api/v1/system/releases', {
                  credentials: 'include',
                  cache: 'no-store',
                }).catch(() => null)
              : Promise.resolve(null),
          ]);

        if (active && empRes.ok) {
          const data = await empRes.json();
          setProfile(data.data);
        }
        if (active && meRes.ok) {
          const meData = await meRes.json();
          if (meData.data?.csrf_token) {
            setCsrfToken(meData.data.csrf_token);
          }
        }
        if (active) {
          const healthBody =
            healthRes && healthRes.ok
              ? await healthRes.json().catch(() => null)
              : null;
          const relVerBody =
            relVerRes && relVerRes.ok
              ? await relVerRes.json().catch(() => null)
              : null;
          const releasesBody =
            releasesRes && releasesRes.ok
              ? await releasesRes.json().catch(() => null)
              : null;
          const hData = healthBody?.data || {};
          const rCurrent = releasesBody?.data?.current || {};
          const resolvedVer = String(
            rCurrent.version ||
              hData.version ||
              relVerBody?.version ||
              SYSTEM_VERSION,
          ).replace(/^v/i, '');
          const rawSha = String(
            rCurrent.commit ||
              hData.commit ||
              hData.sha ||
              relVerBody?.shortSha ||
              relVerBody?.sha ||
              SYSTEM_COMMIT,
          ).trim();
          const resolvedCommit = rawSha.slice(0, 7);
          const resolvedReleasedAt =
            rCurrent.released_at ||
            hData.released_at ||
            relVerBody?.releasedAt ||
            relVerBody?.builtAt ||
            null;
          const isProdHost =
            typeof window !== 'undefined' &&
            window.location?.hostname === 'ql.hoaiphuong.click';
          const resolvedEnv = String(
            rCurrent.environment ||
              hData.environment ||
              relVerBody?.environment ||
              (isProdHost ? 'production' : SYSTEM_ENV),
          );
          const isHealthy = hData.status === 'pass';
          const isProd =
            isProdHost || resolvedEnv.toLowerCase() === 'production';
          const resolvedProdStatus = isProd
            ? isHealthy
              ? 'Production — Đang hoạt động'
              : 'Production — Đang kiểm tra'
            : isHealthy
              ? `Hoạt động (${resolvedEnv})`
              : `Chờ kết nối (${resolvedEnv})`;

          setRuntimeSystemInfo({
            version: resolvedVer,
            commit: resolvedCommit,
            releasedAt: resolvedReleasedAt ? String(resolvedReleasedAt) : null,
            environment: resolvedEnv,
            productionStatus:
              (rCurrent.production_status || hData.production_status) && isProd
                ? String(rCurrent.production_status || hData.production_status)
                : resolvedProdStatus,
          });

          if (role === 'owner') {
            if (Array.isArray(releasesBody?.data?.releases)) {
              setReleaseHistory(releasesBody.data.releases);
            } else {
              const fallbackHistory: ReleaseHistoryEntry[] =
                RELEASE_NOTES_CATALOG.map((item) => {
                  const itemCommit =
                    item.commit === 'latest'
                      ? resolvedCommit
                      : item.commit.slice(0, 7);
                  return {
                    ...item,
                    commit: itemCommit,
                    released_at:
                      item.commit === 'latest' && resolvedReleasedAt
                        ? String(resolvedReleasedAt)
                        : item.released_at,
                    is_current:
                      itemCommit.toLowerCase() === resolvedCommit.toLowerCase(),
                  };
                });
              setReleaseHistory(fallbackHistory);
            }
          }
        }
      } catch {
        // Silently ignore if profile fails to load
      } finally {
        if (active) {
          setLoading(false);
          setReleaseHistoryLoading(false);
        }
      }
    };
    fetchInitialData();
    return () => {
      active = false;
    };
  }, [role]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword) {
      setPasswordError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (!newPassword) {
      setPasswordError('Vui lòng nhập mật khẩu mới.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Mật khẩu mới phải có độ dài tối thiểu 8 ký tự.');
      return;
    }
    if (newPassword.length > 128) {
      setPasswordError('Mật khẩu mới không được vượt quá 128 ký tự.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('Mật khẩu mới không được trùng với mật khẩu hiện tại.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    setPasswordLoading(true);
    try {
      let token = csrfToken;
      if (!token) {
        const meRes = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          token = meData.data?.csrf_token || '';
          setCsrfToken(token);
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['X-CSRF-Token'] = token;

      const res = await fetch('/api/v1/auth/password/change', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.error?.code === 'INVALID_CREDENTIALS') {
          setPasswordError('Mật khẩu hiện tại không chính xác.');
        } else if (data.error?.code === 'RATE_LIMITED') {
          setPasswordError(
            data.error?.message ||
              'Quá nhiều lần thử thay đổi mật khẩu. Vui lòng thử lại sau.',
          );
        } else if (
          data.error?.code === 'WEAK_PASSWORD' ||
          data.error?.code === 'VALIDATION_ERROR'
        ) {
          setPasswordError(
            data.error?.message ||
              'Mật khẩu mới chưa đạt chuẩn bảo mật (tối thiểu 8 ký tự).',
          );
        } else {
          setPasswordError(
            data.error?.message || 'Đổi mật khẩu thất bại. Vui lòng thử lại.',
          );
        }
        return;
      }

      setPasswordSuccess(
        'Đổi mật khẩu thành công! Các phiên làm việc khác đã được thu hồi bảo mật.',
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Refresh CSRF token for the rotated session from response or /auth/me
      if (data.data?.csrf_token) {
        setCsrfToken(data.data.csrf_token);
      } else {
        try {
          const refreshMe = await fetch('/api/v1/auth/me', {
            credentials: 'include',
          });
          if (refreshMe.ok) {
            const meData = await refreshMe.json();
            if (meData.data?.csrf_token) {
              setCsrfToken(meData.data.csrf_token);
            }
          }
        } catch {
          // Silently continue
        }
      }
    } catch (err: unknown) {
      setPasswordError(
        err instanceof Error ? err.message : 'Lỗi kết nối máy chủ.',
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cài đặt & Hồ sơ cá nhân"
        subtitle="Thông tin cá nhân, không gian làm việc và phiên đăng nhập bảo mật (UI20)"
        badge={
          <StatusBadge
            status={role === 'owner' ? 'neutral' : 'success'}
            label={role === 'owner' ? 'Chủ sở hữu' : 'Nhân viên'}
          />
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Real Profile Card */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              marginBottom: '8px',
            }}
          >
            Hồ sơ nhân sự của tôi
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Thông tin nhân sự gắn liền với tài khoản của bạn trong không gian
            làm việc hiện tại.
          </p>

          {loading ? (
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>
              Đang tải thông tin cá nhân...
            </div>
          ) : profile ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: '12px',
                backgroundColor: '#0B1220',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid #334155',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Mã nhân viên
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#14B8A6',
                    marginTop: '2px',
                  }}
                >
                  {profile.employee_code}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Họ và tên
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {profile.full_name}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Email tài khoản
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#F8FAFC',
                    marginTop: '2px',
                  }}
                >
                  {profile.user?.email || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Trạng thái hồ sơ
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#10B981',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  {profile.employment_status === 'active'
                    ? 'Đang hoạt động'
                    : profile.employment_status}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: '#94A3B8', fontSize: '13px' }}>
              Tài khoản đang đăng nhập với vai trò Quản trị viên (Chủ sở hữu).
            </div>
          )}
        </AppCard>

        {/* Workspace context card (C06 invariant) */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              marginBottom: '8px',
            }}
          >
            Không gian làm việc (Workspace Context — C06)
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Quy tắc C06: Hệ thống ràng buộc ngữ cảnh không gian làm việc duy
            nhất trong phiên; không có bộ chuyển đổi workspace tự động.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '12px',
              backgroundColor: '#0B1220',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Múi giờ chuẩn (IANA)
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#14B8A6',
                  marginTop: '2px',
                }}
              >
                Asia/Ho_Chi_Minh (+07:00)
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Tiêu chuẩn bảo mật
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#10B981',
                  marginTop: '2px',
                }}
              >
                C06 Multi-Tenant Isolated
              </div>
            </div>
          </div>
        </AppCard>

        {/* Edit Profile Card */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              margin: '0 0 8px',
            }}
          >
            Chỉnh sửa thông tin cá nhân
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Cập nhật họ tên, số điện thoại và email đăng nhập. Đổi mật khẩu ở
            mục bên dưới.
          </p>
          {profile ? (
            <form
              onSubmit={handleSaveProfile}
              data-testid="edit-profile-form"
              style={{ maxWidth: '480px' }}
            >
              <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                Họ và tên
                <input
                  data-testid="edit-profile-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={120}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: '4px',
                    padding: '10px 12px',
                    fontSize: '16px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    backgroundColor: '#1E293B',
                    color: '#F8FAFC',
                  }}
                />
              </label>
              <div style={{ height: '12px' }} />
              <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                Số điện thoại
                <input
                  data-testid="edit-profile-phone"
                  type="tel"
                  inputMode="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="VD: 0901234567"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: '4px',
                    padding: '10px 12px',
                    fontSize: '16px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    backgroundColor: '#1E293B',
                    color: '#F8FAFC',
                  }}
                />
              </label>
              <div style={{ height: '12px' }} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                  gap: '12px',
                }}
              >
                <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Ngày sinh
                  <input
                    data-testid="edit-profile-dob"
                    type="date"
                    value={editDateOfBirth}
                    onChange={(e) => setEditDateOfBirth(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Giới tính
                  <select
                    data-testid="edit-profile-gender"
                    value={editGender}
                    onChange={(e) => setEditGender(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  >
                    <option value="">-- Chọn --</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </label>
                <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Số CCCD / CMND
                  <input
                    data-testid="edit-profile-national-id"
                    type="text"
                    value={editNationalId}
                    onChange={(e) => setEditNationalId(e.target.value)}
                    placeholder="VD: 079200012345"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </label>
                <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Chức danh / Vị trí
                  <input
                    data-testid="edit-profile-position"
                    type="text"
                    value={editPositionTitle}
                    onChange={(e) => setEditPositionTitle(e.target.value)}
                    placeholder="VD: Editor, Kịch bản..."
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '4px',
                      padding: '10px 12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: '1px solid #475569',
                      backgroundColor: '#1E293B',
                      color: '#F8FAFC',
                    }}
                  />
                </label>
              </div>
              <div style={{ height: '12px' }} />
              <label
                style={{ fontSize: '12px', color: '#94A3B8', display: 'block' }}
              >
                Địa chỉ nơi ở hiện tại
                <input
                  data-testid="edit-profile-address"
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: '4px',
                    padding: '10px 12px',
                    fontSize: '15px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    backgroundColor: '#1E293B',
                    color: '#F8FAFC',
                  }}
                />
              </label>
              <div style={{ height: '12px' }} />
              <label
                style={{ fontSize: '12px', color: '#94A3B8', display: 'block' }}
              >
                Liên hệ khẩn cấp (Họ tên & SĐT người thân)
                <input
                  data-testid="edit-profile-emergency"
                  type="text"
                  value={editEmergencyContact}
                  onChange={(e) => setEditEmergencyContact(e.target.value)}
                  placeholder="VD: Nguyễn Thị B (Mẹ) - 0912345678"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: '4px',
                    padding: '10px 12px',
                    fontSize: '15px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    backgroundColor: '#1E293B',
                    color: '#F8FAFC',
                  }}
                />
              </label>
              <div
                style={{
                  marginTop: '14px',
                  padding: '14px',
                  borderRadius: '8px',
                  backgroundColor: '#0B1220',
                  border: '1px solid #334155',
                }}
              >
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#14B8A6',
                    marginBottom: '10px',
                  }}
                >
                  🏦 Thông tin ngân hàng nhận lương
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                    gap: '10px',
                  }}
                >
                  <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                    Ngân hàng
                    <input
                      data-testid="edit-profile-bank-name"
                      type="text"
                      value={editBankName}
                      onChange={(e) => setEditBankName(e.target.value)}
                      placeholder="VD: Vietcombank, MB Bank..."
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        marginTop: '4px',
                        padding: '9px 10px',
                        fontSize: '14px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        backgroundColor: '#1E293B',
                        color: '#F8FAFC',
                      }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                    Số tài khoản
                    <input
                      data-testid="edit-profile-bank-number"
                      type="text"
                      value={editBankAccountNumber}
                      onChange={(e) => setEditBankAccountNumber(e.target.value)}
                      placeholder="VD: 1023456789"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        marginTop: '4px',
                        padding: '9px 10px',
                        fontSize: '14px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        backgroundColor: '#1E293B',
                        color: '#F8FAFC',
                      }}
                    />
                  </label>
                  <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                    Chủ tài khoản (in hoa)
                    <input
                      data-testid="edit-profile-bank-holder"
                      type="text"
                      value={editBankAccountHolder}
                      onChange={(e) =>
                        setEditBankAccountHolder(e.target.value.toUpperCase())
                      }
                      placeholder="VD: NGUYEN VAN A"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        marginTop: '4px',
                        padding: '9px 10px',
                        fontSize: '14px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        backgroundColor: '#1E293B',
                        color: '#F8FAFC',
                      }}
                    />
                  </label>
                </div>
              </div>
              <div style={{ height: '12px' }} />
              <label style={{ fontSize: '12px', color: '#94A3B8' }}>
                Email tài khoản
                <input
                  data-testid="edit-profile-email"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: '4px',
                    padding: '10px 12px',
                    fontSize: '16px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    backgroundColor: '#1E293B',
                    color: '#F8FAFC',
                  }}
                />
              </label>
              {editEmail.trim().toLowerCase() !==
                (profile.user?.email || '').toLowerCase() && (
                <>
                  <div style={{ height: '12px' }} />
                  <label style={{ fontSize: '12px', color: '#FBBF24' }}>
                    Mật khẩu hiện tại (bắt buộc khi đổi email — email mới sẽ cần
                    xác minh lại)
                    <input
                      data-testid="edit-profile-email-password"
                      type="password"
                      autoComplete="current-password"
                      value={editEmailPassword}
                      onChange={(e) => setEditEmailPassword(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        marginTop: '4px',
                        padding: '10px 12px',
                        fontSize: '16px',
                        borderRadius: '8px',
                        border: '1px solid #475569',
                        backgroundColor: '#1E293B',
                        color: '#F8FAFC',
                      }}
                    />
                  </label>
                </>
              )}
              {profileMsg && (
                <div
                  role={profileMsg.type === 'error' ? 'alert' : 'status'}
                  style={{
                    marginTop: '12px',
                    fontSize: '13px',
                    color: profileMsg.type === 'error' ? '#FCA5A5' : '#6EE7B7',
                  }}
                >
                  {profileMsg.text}
                </div>
              )}
              <div style={{ marginTop: '16px' }}>
                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={profileSaving}
                  data-testid="btn-save-profile"
                >
                  {profileSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                </AppButton>
              </div>
            </form>
          ) : (
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>
              Không có hồ sơ nhân sự để chỉnh sửa.
            </div>
          )}
        </AppCard>

        {/* Change Password Card (UI20) */}
        <AppCard padding="20px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <LockIcon size={18} style={{ color: '#14B8A6' }} />
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#F8FAFC',
                margin: 0,
              }}
            >
              Đổi mật khẩu tài khoản (UI20)
            </h3>
          </div>
          <p
            style={{
              fontSize: '13px',
              color: '#94A3B8',
              marginBottom: '16px',
              lineHeight: 1.5,
            }}
          >
            Yêu cầu mật khẩu mới tối thiểu 8 ký tự. Khi đổi mật khẩu thành công,
            toàn bộ phiên đăng nhập cũ trên các thiết bị khác sẽ được tự động
            thu hồi theo chuẩn SEC-02.
          </p>

          {passwordSuccess && (
            <div
              data-testid="alert-password-success"
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#10B981',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircleIcon size={18} />
              <span>{passwordSuccess}</span>
            </div>
          )}

          {passwordError && (
            <div
              data-testid="alert-password-error"
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#EF4444',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangleIcon size={18} />
              <span>{passwordError}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ maxWidth: '480px' }}>
            <div style={{ marginBottom: '14px' }}>
              <label
                htmlFor="currentPassword"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  marginBottom: '6px',
                  color: '#94A3B8',
                }}
              >
                Mật khẩu hiện tại <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                id="currentPassword"
                data-testid="input-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                disabled={passwordLoading}
                autoComplete="current-password"
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label
                htmlFor="newPassword"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  marginBottom: '6px',
                  color: '#94A3B8',
                }}
              >
                Mật khẩu mới (tối thiểu 8 ký tự){' '}
                <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                id="newPassword"
                data-testid="input-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nhập mật khẩu mới"
                disabled={passwordLoading}
                autoComplete="new-password"
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label
                htmlFor="confirmPassword"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  marginBottom: '6px',
                  color: '#94A3B8',
                }}
              >
                Xác nhận mật khẩu mới{' '}
                <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                id="confirmPassword"
                data-testid="input-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                disabled={passwordLoading}
                autoComplete="new-password"
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ maxWidth: '200px' }}>
              <AppButton
                type="submit"
                variant="primary"
                fullWidth
                disabled={passwordLoading}
                data-testid="btn-change-password"
              >
                {passwordLoading ? 'Đang cập nhật...' : 'Đổi mật khẩu'}
              </AppButton>
            </div>
          </form>
        </AppCard>

        {/* Interface & Localization Preferences Card (SET-002, SET-003) */}
        <AppCard padding="20px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <SettingsIcon size={18} style={{ color: '#14B8A6' }} />
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#F8FAFC',
                margin: 0,
              }}
            >
              Tùy chọn giao diện & Vùng (SET-002, SET-003)
            </h3>
          </div>
          <p
            style={{
              fontSize: '13px',
              color: '#94A3B8',
              marginBottom: '16px',
              lineHeight: 1.5,
            }}
          >
            Cấu hình chủ đề hiển thị (Sáng/Tối), định dạng múi giờ làm việc và
            đơn vị tiền tệ cho toàn bộ ứng dụng.
          </p>

          {prefSavedMessage && (
            <div
              data-testid="alert-pref-success"
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#10B981',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircleIcon size={18} />
              <span>{prefSavedMessage}</span>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
              gap: '16px',
              maxWidth: '800px',
            }}
          >
            {/* SET-002: Theme Configuration */}
            <div>
              <label
                htmlFor="select-theme"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  marginBottom: '6px',
                  color: '#94A3B8',
                }}
              >
                Chủ đề giao diện (SET-002)
              </label>
              <select
                id="select-theme"
                data-testid="select-theme"
                value={theme}
                onChange={(e) =>
                  handleSavePreferences(e.target.value, timezone, currency)
                }
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="dark">
                  Giao diện tối (Mặc định doanh nghiệp)
                </option>
                <option value="light">Giao diện sáng (Thử nghiệm)</option>
                <option value="system">Theo cấu hình hệ điều hành</option>
              </select>
            </div>

            {/* SET-003: Timezone Configuration */}
            <div>
              <label
                htmlFor="select-timezone"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  marginBottom: '6px',
                  color: '#94A3B8',
                }}
              >
                Múi giờ chuẩn (SET-003)
              </label>
              <select
                id="select-timezone"
                data-testid="select-timezone"
                value={timezone}
                onChange={(e) =>
                  handleSavePreferences(theme, e.target.value, currency)
                }
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="Asia/Ho_Chi_Minh">
                  Giờ chuẩn Việt Nam (GMT+7 - Asia/Ho_Chi_Minh)
                </option>
                <option value="UTC">Giờ quốc tế (UTC - GMT+0)</option>
              </select>
            </div>

            {/* SET-003: Currency Configuration */}
            <div>
              <label
                htmlFor="select-currency"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  marginBottom: '6px',
                  color: '#94A3B8',
                }}
              >
                Đơn vị tiền tệ (SET-003)
              </label>
              <select
                id="select-currency"
                data-testid="select-currency"
                value={currency}
                onChange={(e) =>
                  handleSavePreferences(theme, timezone, e.target.value)
                }
                style={{
                  width: '100%',
                  minHeight: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  backgroundColor: '#0B1220',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="VND">Việt Nam Đồng (₫ - VNĐ)</option>
                <option value="USD">Đô la Mỹ ($ - USD)</option>
              </select>
            </div>
          </div>
        </AppCard>

        {/* System Information & Release History card */}
        <AppCard padding="20px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#F8FAFC',
                margin: 0,
              }}
            >
              Phiên bản và Lịch sử cập nhật (Thông tin hệ thống)
            </h3>
            <StatusBadge
              status="success"
              label={`v${runtimeSystemInfo.version || SYSTEM_VERSION}`}
            />
          </div>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Thông tin phát hành và môi trường hoạt động thực tế của hệ thống
            Management Lite (tự động cập nhật từ bản dựng đang chạy).
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '12px',
              backgroundColor: '#0B1220',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Phiên bản ứng dụng (Version)
              </div>
              <div
                data-testid="system-info-version"
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#14B8A6',
                  marginTop: '2px',
                }}
              >
                v{runtimeSystemInfo.version || SYSTEM_VERSION}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Commit đang chạy (Git commit)
              </div>
              <div
                data-testid="system-info-commit"
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#F8FAFC',
                  fontFamily: 'monospace',
                  marginTop: '2px',
                }}
              >
                {(runtimeSystemInfo.commit || SYSTEM_COMMIT).slice(0, 7)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Thời gian phát hành (Ngày giờ phát hành)
              </div>
              <div
                data-testid="system-info-released-at"
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#E2E8F0',
                  marginTop: '2px',
                }}
              >
                {runtimeSystemInfo.releasedAt
                  ? (() => {
                      const d = new Date(runtimeSystemInfo.releasedAt);
                      return Number.isNaN(d.getTime())
                        ? runtimeSystemInfo.releasedAt
                        : d.toLocaleString('vi-VN', {
                            timeZone: timezone || 'Asia/Ho_Chi_Minh',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false,
                          });
                    })()
                  : 'Đang đồng bộ từ máy chủ'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Trạng thái Production (Môi trường Production)
              </div>
              <div
                data-testid="system-info-production-status"
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#38BDF8',
                  marginTop: '2px',
                }}
              >
                {runtimeSystemInfo.productionStatus || SYSTEM_ENV}
              </div>
            </div>
          </div>

          {role === 'owner' && (
            <div
              data-testid="admin-release-history"
              style={{
                marginTop: '20px',
                paddingTop: '18px',
                borderTop: '1px solid #334155',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <h4
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: '#F8FAFC',
                      margin: 0,
                    }}
                  >
                    Lịch sử cập nhật
                  </h4>
                  <p
                    style={{
                      fontSize: '12px',
                      color: '#94A3B8',
                      margin: '4px 0 0 0',
                    }}
                  >
                    Danh sách các phiên bản đã phát hành thành công (chỉ hiển
                    thị đối với tài khoản Admin).
                  </p>
                </div>
                <StatusBadge status="neutral" label="Chỉ dành cho Admin" />
              </div>

              {releaseHistoryLoading && releaseHistory.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Đang tải lịch sử cập nhật...
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {releaseHistory.map((item) => {
                    const formattedDate = (() => {
                      const d = new Date(item.released_at);
                      return Number.isNaN(d.getTime())
                        ? item.released_at
                        : d.toLocaleString('vi-VN', {
                            timeZone: timezone || 'Asia/Ho_Chi_Minh',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false,
                          });
                    })();
                    return (
                      <div
                        key={`${item.version}-${item.commit}`}
                        data-testid={`release-history-item-${item.commit.slice(0, 7)}`}
                        style={{
                          backgroundColor: '#0B1220',
                          border: item.is_current
                            ? '1px solid rgba(20, 184, 166, 0.55)'
                            : '1px solid #334155',
                          borderRadius: '8px',
                          padding: '14px 16px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '8px',
                            marginBottom: '8px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '14px',
                                fontWeight: 700,
                                color: '#14B8A6',
                              }}
                            >
                              v{String(item.version).replace(/^v/i, '')}
                            </span>
                            <span
                              style={{
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                color: '#E2E8F0',
                                backgroundColor: '#1E293B',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                border: '1px solid #334155',
                              }}
                            >
                              Commit: {String(item.commit).slice(0, 7)}
                            </span>
                            {item.is_current && (
                              <StatusBadge
                                status="success"
                                label="Phiên bản đang chạy"
                              />
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                            Ngày giờ triển khai:{' '}
                            <strong style={{ color: '#E2E8F0' }}>
                              {formattedDate}
                            </strong>
                          </div>
                        </div>

                        <div
                          style={{
                            fontSize: '13px',
                            color: '#F8FAFC',
                            lineHeight: 1.5,
                            marginBottom: '10px',
                          }}
                        >
                          {item.summary}
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                            gap: '10px',
                            fontSize: '12px',
                          }}
                        >
                          {item.added && item.added.length > 0 && (
                            <div
                              style={{
                                backgroundColor: 'rgba(16, 185, 129, 0.06)',
                                border: '1px solid rgba(16, 185, 129, 0.2)',
                                borderRadius: '6px',
                                padding: '10px 12px',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: '#10B981',
                                  marginBottom: '6px',
                                }}
                              >
                                Chức năng đã thêm
                              </div>
                              <ul
                                style={{
                                  margin: 0,
                                  paddingLeft: '16px',
                                  color: '#CBD5E1',
                                  lineHeight: 1.5,
                                }}
                              >
                                {item.added.map((line, idx) => (
                                  <li key={idx}>{line}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {item.improved && item.improved.length > 0 && (
                            <div
                              style={{
                                backgroundColor: 'rgba(56, 189, 248, 0.06)',
                                border: '1px solid rgba(56, 189, 248, 0.2)',
                                borderRadius: '6px',
                                padding: '10px 12px',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: '#38BDF8',
                                  marginBottom: '6px',
                                }}
                              >
                                Chức năng đã cải tiến
                              </div>
                              <ul
                                style={{
                                  margin: 0,
                                  paddingLeft: '16px',
                                  color: '#CBD5E1',
                                  lineHeight: 1.5,
                                }}
                              >
                                {item.improved.map((line, idx) => (
                                  <li key={idx}>{line}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {item.fixed && item.fixed.length > 0 && (
                            <div
                              style={{
                                backgroundColor: 'rgba(245, 158, 11, 0.06)',
                                border: '1px solid rgba(245, 158, 11, 0.2)',
                                borderRadius: '6px',
                                padding: '10px 12px',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: '#F59E0B',
                                  marginBottom: '6px',
                                }}
                              >
                                Lỗi đã sửa
                              </div>
                              <ul
                                style={{
                                  margin: 0,
                                  paddingLeft: '16px',
                                  color: '#CBD5E1',
                                  lineHeight: 1.5,
                                }}
                              >
                                {item.fixed.map((line, idx) => (
                                  <li key={idx}>{line}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </AppCard>

        {/* CP22-04: 3-Role RBAC Matrix & MFA / TOTP Authenticator */}
        <AppCard padding="20px">
          <div data-testid="rbac-and-mfa-section">
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#F8FAFC',
                marginBottom: '8px',
              }}
            >
              Vai trò hệ thống & Trạng thái bảo mật 2 lớp (MFA / TOTP)
            </h3>
            <p
              style={{
                fontSize: '13px',
                color: '#94A3B8',
                marginBottom: '14px',
              }}
            >
              Vai trò hiện tại của tài khoản:{' '}
              <strong style={{ color: '#38BDF8', textTransform: 'uppercase' }}>
                {role}
              </strong>{' '}
              — Ma trận quyền hạn theo chuẩn bảo mật Workspace:
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
                gap: '10px',
                marginBottom: '16px',
                fontSize: '12px',
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                }}
              >
                <strong style={{ color: '#10B981' }}>
                  👑 OWNER (Chủ sở hữu)
                </strong>
                <div style={{ color: '#CBD5E1', marginTop: '4px' }}>
                  Toàn quyền hệ thống, Kho bí mật ACC, Thu chi, Lương, Nhật ký
                  kiểm toán & Bảo vệ Owner cuối cùng.
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                }}
              >
                <strong style={{ color: '#38BDF8' }}>
                  🛡️ ADMIN (Quản lý vận hành)
                </strong>
                <div style={{ color: '#CBD5E1', marginTop: '4px' }}>
                  Đề xuất chưa bật trong hệ thống hiện tại. Quyền quản lý vận
                  hành đang chờ hoàn thiện và nghiệm thu; không tự cấp quyền từ
                  chức vụ.
                </div>
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(148, 163, 184, 0.08)',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                }}
              >
                <strong style={{ color: '#E2E8F0' }}>
                  👤 STAFF (Nhân viên)
                </strong>
                <div style={{ color: '#CBD5E1', marginTop: '4px' }}>
                  Chấm công cá nhân, đăng ký lịch ca, nhận & nộp báo cáo công
                  việc được giao.
                </div>
              </div>
            </div>

            <div
              data-testid="mfa-totp-panel"
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#F8FAFC',
                  }}
                >
                  🔐 Xác thực 2 lớp (MFA / TOTP Authenticator)
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#94A3B8',
                    marginTop: '2px',
                  }}
                >
                  Chưa triển khai xác thực 2 lớp. Các thao tác yêu cầu xác minh
                  lại mật khẩu hiện tại chưa tương đương với MFA.
                </div>
              </div>
              <StatusBadge status="warning" label="MFA chưa triển khai" />
            </div>
          </div>
        </AppCard>

        {/* Security & Logout card */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              marginBottom: '8px',
            }}
          >
            Phiên làm việc & Đăng xuất
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Đăng xuất sẽ hủy phiên làm việc hiện tại trên máy chủ và xóa cookie
            phiên bảo mật.
          </p>
          <div style={{ maxWidth: '200px' }}>
            <AppButton variant="destructive" fullWidth onClick={onLogout}>
              Đăng xuất tài khoản
            </AppButton>
          </div>
        </AppCard>
      </div>
    </div>
  );
};
