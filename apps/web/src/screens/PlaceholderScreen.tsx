import React from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
} from '@management-lite/ui/components';
import type { RouteMeta } from '../types.js';

export interface PlaceholderScreenProps {
  route: RouteMeta;
  onGoHome: () => void;
}

export const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({
  route,
  onGoHome,
}) => {
  return (
    <div>
      <PageHeader
        title={route.title}
        subtitle={`Đường dẫn: ${route.path} | Mã chuẩn hóa: ${route.id}`}
        badge={<StatusBadge status="warning" label="CHƯA TRIỂN KHAI" />}
      />

      <AppCard padding="32px" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '44px', marginBottom: '16px' }}>🚧</div>
        <h3
          style={{
            fontSize: '20px',
            fontWeight: 700,
            color: '#F8FAFC',
            marginBottom: '8px',
          }}
        >
          {route.id} — {route.title}
        </h3>
        <p
          style={{
            fontSize: '14px',
            color: '#F59E0B',
            fontWeight: 600,
            marginBottom: '12px',
          }}
        >
          Trạng thái: Chưa triển khai code (Chờ packet nghiệp vụ tương ứng)
        </p>
        <p
          style={{
            fontSize: '14px',
            color: '#94A3B8',
            maxWidth: '560px',
            margin: '0 auto 24px auto',
            lineHeight: 1.6,
          }}
        >
          Màn hình này thuộc danh mục{' '}
          <strong>{route.category.toUpperCase()}</strong> trong ma trận tài liệu
          canonical V0.1. Mọi nghiệp vụ liên quan (cơ sở dữ liệu, API, kiểm thử)
          đang ở trạng thái HOLD và sẽ được triển khai trong các packet kế tiếp
          sau khi hoàn thành nền tảng PK-01.
        </p>

        <AppButton variant="secondary" onClick={onGoHome}>
          Quay lại Trang tổng quan
        </AppButton>
      </AppCard>
    </div>
  );
};
