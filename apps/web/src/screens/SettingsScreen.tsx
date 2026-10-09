import React, { useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

export interface SettingsScreenProps {
  role: UserRole;
  onChangeRole: (newRole: UserRole) => void;
  onLogout: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  role,
  onLogout,
}) => {
  const [profile, setProfile] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/v1/employees/me', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setProfile(data.data);
        }
      } catch {
        // Silently ignore if employee profile doesn't exist
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  return (
    <div>
      <PageHeader
        title="Cài đặt & Hồ sơ cá nhân"
        subtitle="Thông tin cá nhân, không gian làm việc và phiên đăng nhập bảo mật (UI20)"
        badge={
          <StatusBadge
            status={role === 'owner' ? 'neutral' : 'success'}
            label={role === 'owner' ? '👑 Chủ sở hữu' : '👤 Nhân viên'}
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
