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
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import {
  SYSTEM_VERSION,
  SYSTEM_COMMIT,
  SYSTEM_ENV,
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
      try {
        const [empRes, meRes] = await Promise.all([
          fetch('/api/v1/employees/me', { credentials: 'include' }),
          fetch('/api/v1/auth/me', { credentials: 'include' }),
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
      } catch {
        // Silently ignore if profile fails to load
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchInitialData();
    return () => {
      active = false;
    };
  }, []);

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
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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

        {/* System Information card */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              marginBottom: '8px',
            }}
          >
            Thông tin hệ thống
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Thông tin phát hành và môi trường hoạt động của hệ thống Management
            Lite.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              backgroundColor: '#0B1220',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #334155',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Phiên bản hệ thống
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#14B8A6',
                  marginTop: '2px',
                }}
              >
                v{SYSTEM_VERSION}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Môi trường
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#38BDF8',
                  marginTop: '2px',
                  textTransform: 'capitalize',
                }}
              >
                {SYSTEM_ENV}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Mã định danh bản dựng (Git Commit)
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#F8FAFC',
                  fontFamily: 'monospace',
                  marginTop: '2px',
                }}
              >
                {SYSTEM_COMMIT}
              </div>
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
