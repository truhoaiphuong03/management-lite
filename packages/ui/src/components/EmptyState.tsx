import React from 'react';
import { AppCard } from './AppCard.js';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon = '📭',
  action,
}) => {
  return (
    <AppCard
      style={{
        textAlign: 'center',
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{ fontSize: '40px', marginBottom: '16px' }}
        role="img"
        aria-label="Icon"
      >
        {icon}
      </div>
      <h3
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: '#F8FAFC',
          marginBottom: '8px',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: '14px',
          color: '#94A3B8',
          maxWidth: '400px',
          marginBottom: action ? '20px' : '0',
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {action && <div>{action}</div>}
    </AppCard>
  );
};
