import React, { useState } from 'react';
import {
  AppButton,
  AppCard,
  StatusBadge,
  BuildingIcon,
  AlertTriangleIcon,
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';

export interface LoginScreenProps {
  onLogin: (role: UserRole) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = identifier.trim();
    if (!cleanId || !password) {
      setErrorMessage('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          identifier: cleanId,
          password,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        setErrorMessage(
          body.error?.message ||
            'Đăng nhập không thành công. Vui lòng kiểm tra lại.',
        );
        return;
      }

      const role = body.data?.active_workspace?.role as UserRole;
      onLogin(role || 'staff');
    } catch {
      setErrorMessage(
        'Không thể kết nối đến máy chủ API. Vui lòng thử lại sau.',
      );
    } finally {
      setIsLoading(false);
    }
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '12px',
              color: '#14B8A6',
            }}
          >
            <BuildingIcon size={44} />
          </div>
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
            <StatusBadge status="success" label="V0.1 Live Auth" />
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Management Lite
            </span>
          </div>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              marginBottom: '20px',
              fontSize: '13px',
              color: '#EF4444',
              lineHeight: 1.4,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertTriangleIcon size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="identifier"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Tên đăng nhập hoặc Email:
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="owner hoặc staff@management-lite.local"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
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

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontSize: '14px',
                marginBottom: '6px',
                color: '#94A3B8',
              }}
            >
              Mật khẩu:
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              disabled={isLoading}
              style={{
                width: '100%',
                minHeight: '44px',
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

          <AppButton
            variant="primary"
            fullWidth
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? 'Đang xác thực...' : 'Đăng nhập'}
          </AppButton>
        </form>

        <div
          style={{
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid #1E293B',
            textAlign: 'center',
            fontSize: '12px',
            color: '#64748B',
          }}
        >
          Hệ thống bảo vệ phiên làm việc theo tiêu chuẩn bảo mật C06
        </div>
      </AppCard>
    </div>
  );
};
