import React, { useState } from 'react';
import { TOKENS, THEME_COLORS } from '../tokens.js';
import { Spinner } from './Spinner.js';

export interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'quiet';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  loadingText?: string;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  children?: React.ReactNode;
}

export const AppButton: React.FC<AppButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loadingText,
  fullWidth = false,
  icon,
  iconPosition = 'left',
  disabled,
  children,
  className,
  style,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  ...props
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const isIconOnly = !children && Boolean(icon);
  const isDisabled = disabled || isLoading;

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          bg: isActive
            ? THEME_COLORS.primaryActive
            : isHovered && !isDisabled
              ? THEME_COLORS.primaryHover
              : THEME_COLORS.primary,
          text: THEME_COLORS.inverse,
          border: isActive
            ? THEME_COLORS.primaryActive
            : isHovered && !isDisabled
              ? THEME_COLORS.primaryHover
              : THEME_COLORS.primary,
          spinnerColor: 'current',
        };
      case 'destructive':
        return {
          bg: isActive
            ? THEME_COLORS.dangerActive
            : isHovered && !isDisabled
              ? THEME_COLORS.dangerHover
              : THEME_COLORS.danger,
          text: '#F8FAFC',
          border: isActive
            ? THEME_COLORS.dangerActive
            : isHovered && !isDisabled
              ? THEME_COLORS.dangerHover
              : THEME_COLORS.danger,
          spinnerColor: 'current',
        };
      case 'quiet':
        return {
          bg: isActive
            ? 'rgba(255, 255, 255, 0.1)'
            : isHovered && !isDisabled
              ? 'rgba(255, 255, 255, 0.06)'
              : 'transparent',
          text:
            isHovered && !isDisabled ? THEME_COLORS.primary : THEME_COLORS.text,
          border: 'transparent',
          spinnerColor: THEME_COLORS.primary,
        };
      case 'secondary':
      default:
        return {
          bg: isActive
            ? THEME_COLORS.surfaceActive
            : isHovered && !isDisabled
              ? THEME_COLORS.surfaceHover
              : THEME_COLORS.surface,
          text: THEME_COLORS.text,
          border:
            isHovered && !isDisabled
              ? THEME_COLORS.borderHover
              : THEME_COLORS.border,
          spinnerColor: THEME_COLORS.primary,
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          minHeight: TOKENS.touchTarget.minHeight, // 44px
          minWidth: isIconOnly
            ? TOKENS.touchTarget.minWidth
            : TOKENS.touchTarget.minWidth, // 44px
          padding: isIconOnly ? '0' : '0 12px',
          fontSize: TOKENS.typography.fontSize.base,
          spinnerSize: 14,
          gap: '6px',
        };
      case 'lg':
        return {
          minHeight: '48px',
          minWidth: isIconOnly ? '48px' : '48px',
          padding: isIconOnly ? '0' : '0 20px',
          fontSize: TOKENS.typography.fontSize.lg,
          spinnerSize: 18,
          gap: '10px',
        };
      case 'md':
      default:
        return {
          minHeight: TOKENS.touchTarget.minHeight, // 44px
          minWidth: isIconOnly
            ? TOKENS.touchTarget.minWidth
            : TOKENS.touchTarget.minWidth,
          padding: isIconOnly ? '0' : '0 16px',
          fontSize: TOKENS.typography.fontSize.md,
          spinnerSize: 16,
          gap: '8px',
        };
    }
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  return (
    <button
      type="button"
      className={className}
      disabled={isDisabled}
      aria-busy={isLoading ? 'true' : undefined}
      onMouseEnter={(e) => {
        setIsHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        setIsActive(false);
        onMouseLeave?.(e);
      }}
      onMouseDown={(e) => {
        if (!isDisabled) setIsActive(true);
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        setIsActive(false);
        onMouseUp?.(e);
      }}
      style={{
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: sizeStyles.minHeight,
        minWidth: sizeStyles.minWidth,
        width: fullWidth ? '100%' : 'auto',
        padding: sizeStyles.padding,
        borderRadius: TOKENS.radii.sm, // 8px
        border: `1px solid ${variantStyles.border}`,
        backgroundColor: variantStyles.bg,
        color: variantStyles.text,
        fontSize: sizeStyles.fontSize,
        fontWeight: TOKENS.typography.fontWeight.semibold,
        lineHeight: TOKENS.typography.lineHeight.tight,
        userSelect: 'none',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition:
          'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
        transform: isActive && !isDisabled ? 'scale(0.98)' : 'none',
        position: 'relative',
        overflow: 'hidden',
        gap: sizeStyles.gap,
        ...style,
      }}
      {...props}
    >
      {/* Zero-jitter loading mechanism:
        When isLoading=true, original content is ALWAYS kept in the layout tree with visibility: hidden.
        This guarantees the button keeps its EXACT original width and avoids UI jumps, even with long loadingText!
      */}
      {isLoading ? (
        <>
          <span
            aria-hidden="true"
            style={{
              visibility: 'hidden',
              display: 'inline-flex',
              alignItems: 'center',
              gap: sizeStyles.gap,
            }}
          >
            {icon && iconPosition === 'left' && icon}
            {children}
            {icon && iconPosition === 'right' && icon}
          </span>
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: sizeStyles.gap,
              padding: '0 8px',
              boxSizing: 'border-box',
              overflow: 'hidden',
              maxWidth: '100%',
              pointerEvents: 'none',
            }}
          >
            {loadingText ? (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Spinner
                    size={sizeStyles.spinnerSize}
                    color={variantStyles.spinnerColor}
                  />
                </span>
                <span
                  role="status"
                  aria-live="polite"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: sizeStyles.fontSize,
                    lineHeight: TOKENS.typography.lineHeight.tight,
                    flexShrink: 1,
                    minWidth: 0,
                  }}
                >
                  {loadingText}
                </span>
              </>
            ) : (
              <Spinner
                size={sizeStyles.spinnerSize}
                color={variantStyles.spinnerColor}
              />
            )}
          </span>
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' && icon}
          {children}
          {icon && iconPosition === 'right' && icon}
        </>
      )}
    </button>
  );
};
