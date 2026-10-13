import React from 'react';
import { TOKENS } from '../tokens.js';

export type BadgeVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'error'
  | 'neutral'
  | 'muted'
  | 'info';

export interface AppBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  label?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export const AppBadge: React.FC<AppBadgeProps> = ({
  variant = 'neutral',
  size = 'md',
  label,
  icon,
  children,
  style,
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return {
          bg: TOKENS.colors.successSubtle,
          text: TOKENS.colors.success,
          border: 'rgba(16, 185, 129, 0.3)',
        };
      case 'warning':
        return {
          bg: TOKENS.colors.warningSubtle,
          text: TOKENS.colors.warning,
          border: 'rgba(245, 158, 11, 0.3)',
        };
      case 'danger':
      case 'error':
        return {
          bg: TOKENS.colors.dangerSubtle,
          text: TOKENS.colors.error,
          border: 'rgba(239, 68, 68, 0.3)',
        };
      case 'primary':
        return {
          bg: TOKENS.colors.primarySubtle,
          text: TOKENS.colors.primary,
          border: 'rgba(20, 184, 166, 0.35)',
        };
      case 'info':
        return {
          bg: TOKENS.colors.infoSubtle,
          text: TOKENS.colors.info,
          border: 'rgba(56, 189, 248, 0.3)',
        };
      case 'muted':
        return {
          bg: 'rgba(148, 163, 184, 0.15)',
          text: TOKENS.colors.muted,
          border: 'rgba(148, 163, 184, 0.3)',
        };
      case 'secondary':
        return {
          bg: TOKENS.colors.surfaceSubtle,
          text: TOKENS.colors.textSecondary,
          border: TOKENS.colors.border,
        };
      case 'neutral':
      default:
        return {
          bg: TOKENS.colors.primarySubtle,
          text: TOKENS.colors.primary,
          border: 'rgba(20, 184, 166, 0.3)',
        };
    }
  };

  const vStyles = getVariantStyles();
  const isSmall = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: isSmall ? '2px 8px' : '3px 10px',
        borderRadius: TOKENS.radii.full, // 9999px
        fontSize: isSmall
          ? TOKENS.typography.fontSize.xs
          : TOKENS.typography.fontSize.sm,
        fontWeight: TOKENS.typography.fontWeight.semibold,
        lineHeight: TOKENS.typography.lineHeight.tight,
        backgroundColor: vStyles.bg,
        color: vStyles.text,
        border: `1px solid ${vStyles.border}`,
        boxSizing: 'border-box',
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...props}
    >
      {icon && (
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
      )}
      {label || children}
    </span>
  );
};
