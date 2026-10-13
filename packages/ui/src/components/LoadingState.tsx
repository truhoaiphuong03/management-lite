import React from 'react';
import { AppCard } from './AppCard.js';
import { Spinner } from './Spinner.js';
import { TOKENS } from '../tokens.js';

export interface LoadingStateProps {
  message?: string;
  minHeight?: string;
  cardVariant?: 'default' | 'subtle' | 'bordered';
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Đang tải dữ liệu...',
  minHeight = '200px',
  cardVariant = 'default',
}) => {
  return (
    <AppCard
      variant={cardVariant}
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
      <Spinner size="lg" color={TOKENS.colors.primary} />
      <p
        style={{
          fontSize: TOKENS.typography.fontSize.md,
          color: TOKENS.colors.muted,
          margin: 0,
        }}
      >
        {message}
      </p>
    </AppCard>
  );
};
