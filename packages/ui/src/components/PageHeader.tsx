import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        marginBottom: '24px',
        paddingBottom: '16px',
        borderBottom: '1px solid #334155',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#F8FAFC',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p
            style={{
              marginTop: '4px',
              fontSize: '14px',
              color: '#94A3B8',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {actions}
        </div>
      )}
    </div>
  );
};
