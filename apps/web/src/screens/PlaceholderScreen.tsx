import React from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  ConstructionIcon,
} from '@management-lite/ui/components';
import type { RouteMeta } from '../types.js';

export interface PlaceholderScreenProps {
  route: RouteMeta;
  params?: Record<string, string>;
  currentPath?: string;
  onGoHome: () => void;
}

export const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({
  route,
  params = {},
  currentPath,
  onGoHome,
}) => {
  const displayPath = currentPath || route.path;
  const paramEntries = Object.entries(params);

  return (
    <div>
      <PageHeader
        title={route.title}
        subtitle={`Đường dẫn: ${displayPath} | Mã chuẩn hóa: ${route.id}`}
        badge={<StatusBadge status="warning" label="CHƯA TRIỂN KHAI" />}
      />

      <AppCard padding="32px" style={{ textAlign: 'center' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '16px',
            color: 'var(--warning-text)',
          }}
        >
          <ConstructionIcon size={44} />
        </div>
        <h3
          style={{
            fontSize: '20px',
            fontWeight: 700,
            color: 'var(--text-color)',
            marginBottom: '8px',
          }}
        >
          {route.id} — {route.title}
        </h3>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--warning-text)',
            fontWeight: 600,
            marginBottom: '12px',
          }}
        >
          Trạng thái: Chưa triển khai code (Chờ packet nghiệp vụ tương ứng)
        </p>
        {paramEntries.length > 0 && (
          <div
            style={{
              display: 'inline-flex',
              gap: '12px',
              padding: '8px 16px',
              backgroundColor: 'rgba(20, 184, 166, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(20, 184, 166, 0.3)',
              marginBottom: '16px',
              fontSize: '13px',
              color: 'var(--accent-text)',
            }}
          >
            {paramEntries.map(([key, val]) => (
              <span key={key}>
                Tham số <strong>{key}</strong>: <code>{val}</code>
              </span>
            ))}
          </div>
        )}
        <p
          style={{
            fontSize: '14px',
            color: 'var(--muted-color)',
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
