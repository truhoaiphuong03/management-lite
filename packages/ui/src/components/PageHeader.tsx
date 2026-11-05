import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  style,
}) => {
  return (
    <div
      className="page-header-root"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '20px',
        ...style,
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 180px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <h1
            className="page-header-title"
            title={title}
            style={{
              fontSize: 'var(--heading-page-size, 22px)',
              fontWeight: 700,
              lineHeight: 'var(--heading-page-lh, 1.3)',
              color: 'var(--text-color, #F8FAFC)',
              letterSpacing: 'var(--heading-tracking, -0.015em)',
              overflowWrap: 'break-word',
              minWidth: 0,
              margin: 0,
            }}
          >
            {title}
          </h1>
          {badge && <span className="page-header-badge">{badge}</span>}
        </div>
        {subtitle && (
          <p
            className="page-header-subtitle"
            style={{
              margin: '4px 0 0 0',
              fontSize: 'var(--subtitle-size, 13.5px)',
              lineHeight: 'var(--subtitle-lh, 1.45)',
              color: 'var(--muted-color, #94A3B8)',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div
          className="page-header-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
};
