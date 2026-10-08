import React, { useState } from 'react';
import {
  AppButton,
  AppCard,
  StatusBadge,
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';

export interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('owner');
  const [username, setUsername] = useState('demo_owner');

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setUsername(role === 'owner' ? 'demo_owner' : 'demo_staff');
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '80vh',
        padding: '16px',
      }}
    >
      <AppCard style={{ maxWidth: '440px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏢</div>
          <h2
            style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}
          >
            Đăng nhập hệ thống
          </h2>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <StatusBadge status="warning" label="UI01 DEMO" />
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Management Lite V0.1
            </span>
          </div>
        </div>

        <div
          style={{
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            marginBottom: '20px',
            fontSize: '13px',
            color: '#F59E0B',
            lineHeight: 1.4,
          }}
        >
          ⚠️ <strong>LƯU Ý DEMO:</strong> Không nhập mật khẩu thật. Đây là giao
          diện trình diễn độc lập trên localhost, không gửi dữ liệu tới server
          production.
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '14px',
              marginBottom: '6px',
              color: '#94A3B8',
            }}
          >
            Chọn vai trò xem trước:
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            <button
              type="button"
              onClick={() => handleRoleSelect('owner')}
              style={{
                minHeight: '44px',
                borderRadius: '8px',
                border: `1px solid ${selectedRole === 'owner' ? '#14B8A6' : '#334155'}`,
                backgroundColor:
                  selectedRole === 'owner'
                    ? 'rgba(20, 184, 166, 0.15)'
                    : '#0B1220',
                color: selectedRole === 'owner' ? '#14B8A6' : '#94A3B8',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              👑 Chủ sở hữu (Owner)
            </button>
            <button
              type="button"
              onClick={() => handleRoleSelect('staff')}
              style={{
                minHeight: '44px',
                borderRadius: '8px',
                border: `1px solid ${selectedRole === 'staff' ? '#14B8A6' : '#334155'}`,
                backgroundColor:
                  selectedRole === 'staff'
                    ? 'rgba(20, 184, 166, 0.15)'
                    : '#0B1220',
                color: selectedRole === 'staff' ? '#14B8A6' : '#94A3B8',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              👤 Nhân viên (Staff)
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '14px',
              marginBottom: '6px',
              color: '#94A3B8',
            }}
          >
            Tên người dùng demo:
          </label>
          <input
            type="text"
            readOnly
            value={username}
            style={{
              width: '100%',
              minHeight: '44px',
              padding: '0 12px',
              borderRadius: '8px',
              border: '1px solid #334155',
              backgroundColor: '#0B1220',
              color: '#F8FAFC',
              fontSize: '14px',
            }}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '14px',
              marginBottom: '6px',
              color: '#94A3B8',
            }}
          >
            Mật khẩu mô phỏng:
          </label>
          <input
            type="password"
            readOnly
            value="••••••••••••"
            style={{
              width: '100%',
              minHeight: '44px',
              padding: '0 12px',
              borderRadius: '8px',
              border: '1px solid #334155',
              backgroundColor: '#0B1220',
              color: '#94A3B8',
              fontSize: '14px',
            }}
          />
        </div>

        <AppButton
          variant="primary"
          fullWidth
          onClick={() => onLogin(selectedRole)}
        >
          Vào xem Dashboard ({selectedRole === 'owner' ? 'Owner' : 'Staff'})
        </AppButton>
      </AppCard>
    </div>
  );
};
