import React from 'react';
import {
  AppCard,
  AppButton,
  SearchIcon,
  ShieldAlertIcon,
} from '@management-lite/ui/components';

export interface NotFoundScreenProps {
  isForbidden?: boolean;
  message?: string;
  onGoHome: () => void;
}

export const NotFoundScreen: React.FC<NotFoundScreenProps> = ({
  isForbidden = false,
  message,
  onGoHome,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '16px',
      }}
    >
      <AppCard
        style={{
          maxWidth: '500px',
          width: '100%',
          textAlign: 'center',
          padding: '40px 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '16px',
            color: isForbidden ? 'var(--danger-text)' : 'var(--muted-color)',
          }}
        >
          {isForbidden ? (
            <ShieldAlertIcon size={48} />
          ) : (
            <SearchIcon size={48} />
          )}
        </div>
        <h1
          style={{
            fontSize: '22px',
            fontWeight: 700,
            color: isForbidden ? 'var(--danger-text)' : 'var(--text-color)',
            marginBottom: '8px',
          }}
        >
          {isForbidden
            ? '403 — Quyền truy cập bị từ chối'
            : '404 — Không tìm thấy trang'}
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--muted-color)',
            lineHeight: 1.5,
            marginBottom: '24px',
          }}
        >
          {message ||
            (isForbidden
              ? 'Theo quy định bảo vệ phân quyền (RBAC), vai trò hiện tại không được phép truy cập tuyến đường này.'
              : 'Đường dẫn bạn yêu cầu không tồn tại trong hệ thống hoặc đã được di chuyển.')}
        </p>
        <AppButton variant="primary" onClick={onGoHome}>
          Quay lại Trang tổng quan (Dashboard)
        </AppButton>
      </AppCard>
    </div>
  );
};
