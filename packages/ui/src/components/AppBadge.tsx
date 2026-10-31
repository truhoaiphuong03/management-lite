import React from 'react';
import { TOKENS, THEME_COLORS } from '../tokens.js';

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
          bg: THEME_COLORS.successSubtle,
          text: THEME_COLORS.success,
          border: 'rgba(16, 185, 129, 0.3)',
        };
      case 'warning':
        return {
          bg: THEME_COLORS.warningSubtle,
          text: THEME_COLORS.warning,
          border: 'rgba(245, 158, 11, 0.3)',
        };
      case 'danger':
      case 'error':
        return {
          bg: THEME_COLORS.dangerSubtle,
          text: THEME_COLORS.error,
          border: 'rgba(239, 68, 68, 0.3)',
        };
      case 'primary':
        return {
          bg: THEME_COLORS.primarySubtle,
          text: THEME_COLORS.primary,
          border: 'rgba(20, 184, 166, 0.35)',
        };
      case 'info':
        return {
          bg: THEME_COLORS.infoSubtle,
          text: THEME_COLORS.info,
          border: 'rgba(56, 189, 248, 0.3)',
        };
      case 'muted':
        return {
          bg: 'rgba(148, 163, 184, 0.15)',
          text: THEME_COLORS.muted,
          border: 'rgba(148, 163, 184, 0.3)',
        };
      case 'secondary':
        return {
          bg: THEME_COLORS.surfaceSubtle,
          text: THEME_COLORS.textSecondary,
          border: THEME_COLORS.border,
        };
      case 'neutral':
      default:
        return {
          bg: THEME_COLORS.primarySubtle,
          text: THEME_COLORS.primary,
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
