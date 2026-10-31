import React from 'react';
import { AppCard } from './AppCard.js';
import { Spinner } from './Spinner.js';
import { TOKENS, THEME_COLORS } from '../tokens.js';

export interface LoadingStateProps {
  message?: string;
  minHeight?: string;
  cardVariant?: 'default' | 'subtle' | 'bordered';
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Đang tải dữ liệu…',
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
      <Spinner size="lg" color={THEME_COLORS.primary} />
      <p
        style={{
          fontSize: TOKENS.typography.fontSize.md,
          color: THEME_COLORS.muted,
          margin: 0,
        }}
      >
        {message}
      </p>
    </AppCard>
  );
};
