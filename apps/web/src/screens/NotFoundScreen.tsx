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
            color: isForbidden ? '#EF4444' : '#64748B',
          }}
        >
          {isForbidden ? (
            <ShieldAlertIcon size={48} />
          ) : (
            <SearchIcon size={48} />
          )}
        </div>
        <h2
          style={{
            fontSize: '22px',
            fontWeight: 700,
            color: isForbidden ? '#EF4444' : '#F8FAFC',
            marginBottom: '8px',
          }}
        >
          {isForbidden
            ? '403 — Quyền truy cập bị từ chối'
            : '404 — Không tìm thấy trang'}
        </h2>
        <p
          style={{
            fontSize: '14px',
            color: '#94A3B8',
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
