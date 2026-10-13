import React from 'react';
import { AppCard } from './AppCard.js';
import { InboxIcon } from './Icons.js';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
}) => {
  const renderedIcon =
    icon === undefined ? (
      <InboxIcon size={40} />
    ) : typeof icon === 'string' ? (
      <span style={{ fontSize: '32px' }}>{icon}</span>
    ) : (
      icon
    );

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
        style={{
          color: '#64748B',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'center',
        }}
        aria-hidden="true"
      >
        {renderedIcon}
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
