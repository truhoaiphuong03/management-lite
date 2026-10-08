import React from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';

export interface SettingsScreenProps {
  role: UserRole;
  onChangeRole: (newRole: UserRole) => void;
  onLogout: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  role,
  onChangeRole,
  onLogout,
}) => {
  return (
    <div>
      <PageHeader
        title="Cài đặt hệ thống"
        subtitle="Thông tin cấu hình không gian làm việc và phiên đăng nhập (UI20)"
        badge={<StatusBadge status="neutral" label="UI20 DEMO" />}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                Tên Workspace
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#F8FAFC',
                  marginTop: '2px',
                }}
              >
                Studio Media Lite V0.1
              </div>
            </div>
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
                Trạng thái vận hành
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#10B981',
                  marginTop: '2px',
                }}
              >
                Đang hoạt động (Active)
              </div>
            </div>
          </div>
        </AppCard>

        {/* Demo role switch card */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              marginBottom: '8px',
            }}
          >
            Chuyển đổi góc nhìn Demo (Chỉ áp dụng trong bản trình diễn)
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Bấm chọn để kiểm tra sự khác biệt giữa giao diện Owner và Staff theo
            RBAC-02.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <AppButton
              variant={role === 'owner' ? 'primary' : 'secondary'}
              onClick={() => onChangeRole('owner')}
            >
              👑 Xem với vai trò Chủ sở hữu (Owner)
            </AppButton>
            <AppButton
              variant={role === 'staff' ? 'primary' : 'secondary'}
              onClick={() => onChangeRole('staff')}
            >
              👤 Xem với vai trò Nhân viên (Staff)
            </AppButton>
          </div>
        </AppCard>

        {/* Security & Reauth Card (C05 invariant) */}
        <AppCard padding="20px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: '#F8FAFC',
              marginBottom: '8px',
            }}
          >
            Bảo mật & Quản lý tài khoản (C05 & SEC-02)
          </h3>
          <p
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '16px' }}
          >
            Mọi thao tác nhạy cảm (như xem hoặc cập nhật secret tài khoản mạng
            xã hội ở UI18) đều bắt buộc xác thực lại (reauthentication) một lần
            và có thời hạn tối đa 5 phút.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <AppButton variant="secondary" onClick={onLogout}>
              🔒 Đăng xuất khỏi Demo
            </AppButton>
          </div>
        </AppCard>
      </div>
    </div>
  );
};
