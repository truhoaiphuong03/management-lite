import React from 'react';
import { AppCard } from './AppCard.js';
import { AppButton } from './AppButton.js';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Có lỗi xảy ra',
  message,
  onRetry,
}) => {
  return (
    <AppCard
      style={{
        border: '1px solid rgba(239, 68, 68, 0.4)',
        backgroundColor: 'rgba(239, 68, 68, 0.05)',
        textAlign: 'center',
        padding: '36px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      role="alert"
    >
      <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
      <h3
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: '#EF4444',
          marginBottom: '8px',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: '14px',
          color: '#F8FAFC',
          maxWidth: '440px',
          marginBottom: onRetry ? '20px' : '0',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
      {onRetry && (
        <AppButton variant="secondary" onClick={onRetry}>
          Thử lại
        </AppButton>
      )}
    </AppCard>
  );
};
