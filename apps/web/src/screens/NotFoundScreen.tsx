import React from 'react';
import { AppCard, AppButton } from '@management-lite/ui/components';

export interface NotFoundScreenProps {
  isForbidden?: boolean;
  onGoHome: () => void;
}

export const NotFoundScreen: React.FC<NotFoundScreenProps> = ({
  isForbidden = false,
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
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {isForbidden ? '🚫' : '🔍'}
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
          {isForbidden
            ? 'Bạn đang ở chế độ xem Nhân viên (Staff). Theo quy tắc RBAC-02, tuyến đường này chỉ dành riêng cho Chủ sở hữu (Owner) của workspace.'
            : 'Đường dẫn bạn yêu cầu không tồn tại trong hệ thống hoặc đã được di chuyển.'}
        </p>
        <AppButton variant="primary" onClick={onGoHome}>
          Quay lại Trang tổng quan (Dashboard)
        </AppButton>
      </AppCard>
    </div>
  );
};
