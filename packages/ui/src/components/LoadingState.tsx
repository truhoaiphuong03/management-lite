import React from 'react';
import { AppCard } from './AppCard.js';

export interface LoadingStateProps {
  message?: string;
  minHeight?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Đang tải dữ liệu...',
  minHeight = '200px',
}) => {
  return (
    <AppCard
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight,
        gap: '16px',
      }}
      aria-live="polite"
      aria-busy="true"
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid #334155',
          borderTopColor: '#14B8A6',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <p style={{ fontSize: '14px', color: '#94A3B8' }}>{message}</p>
    </AppCard>
  );
};
