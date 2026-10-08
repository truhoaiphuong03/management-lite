import React from 'react';

export interface StatusBadgeProps {
  status: 'success' | 'warning' | 'error' | 'muted' | 'neutral';
  label: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const getStyle = () => {
    switch (status) {
      case 'success':
        return {
          bg: 'rgba(16, 185, 129, 0.15)',
          text: '#10B981',
          border: 'rgba(16, 185, 129, 0.3)',
        };
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          text: '#F59E0B',
          border: 'rgba(245, 158, 11, 0.3)',
        };
      case 'error':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          text: '#EF4444',
          border: 'rgba(239, 68, 68, 0.3)',
        };
      case 'muted':
        return {
          bg: 'rgba(148, 163, 184, 0.15)',
          text: '#94A3B8',
          border: 'rgba(148, 163, 184, 0.3)',
        };
      case 'neutral':
      default:
        return {
          bg: 'rgba(20, 184, 166, 0.15)',
          text: '#14B8A6',
          border: 'rgba(20, 184, 166, 0.3)',
        };
    }
  };

  const currentStyle = getStyle();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: currentStyle.bg,
        color: currentStyle.text,
        border: `1px solid ${currentStyle.border}`,
        lineHeight: 1.2,
      }}
    >
      {label}
    </span>
  );
};
