import React, { useState } from 'react';
import { TOKENS } from '../tokens.js';

export interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: '16px' | '20px' | '24px' | '32px' | '48px 24px' | string;
  interactive?: boolean;
  variant?: 'default' | 'subtle' | 'bordered';
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

export const AppCard: React.FC<AppCardProps> = ({
  children,
  padding = '24px',
  interactive = false,
  variant = 'default',
  header,
  footer,
  style,
  onMouseEnter,
  onMouseLeave,
  ...props
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getVariantStyles = () => {
    switch (variant) {
      case 'subtle':
        return {
          bg: TOKENS.colors.surfaceSubtle, // #0F172A
          border: TOKENS.colors.borderSubtle, // #1E293B
        };
      case 'bordered':
        return {
          bg: 'transparent',
          border: TOKENS.colors.border, // #334155
        };
      case 'default':
      default:
        return {
          bg: TOKENS.colors.surface, // #151F30
          border: TOKENS.colors.border, // #334155
        };
    }
  };

  const vStyles = getVariantStyles();

  return (
    <div
      onMouseEnter={(e) => {
        if (interactive) setIsHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (interactive) setIsHovered(false);
        onMouseLeave?.(e);
      }}
      style={{
        boxSizing: 'border-box',
        backgroundColor: vStyles.bg,
        border: `1px solid ${
          interactive && isHovered ? 'rgba(20, 184, 166, 0.4)' : vStyles.border
        }`,
        borderRadius: TOKENS.radii.md, // 12px
        padding,
        color: TOKENS.colors.text,
        boxShadow:
          interactive && isHovered ? TOKENS.shadows.md : TOKENS.shadows.sm,
        transform: interactive && isHovered ? 'translateY(-1px)' : 'none',
        transition: interactive
          ? 'border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease'
          : 'none',
        cursor: interactive ? 'pointer' : 'default',
        ...style,
      }}
      {...props}
    >
      {header && (
        <div
          style={{
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: `1px solid ${TOKENS.colors.borderSubtle}`,
          }}
        >
          {header}
        </div>
      )}
      {children}
      {footer && (
        <div
          style={{
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: `1px solid ${TOKENS.colors.borderSubtle}`,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
};
