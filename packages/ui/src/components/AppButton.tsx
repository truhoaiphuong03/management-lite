import React from 'react';

export interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'quiet';
  isLoading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export const AppButton: React.FC<AppButtonProps> = ({
  variant = 'primary',
  isLoading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  ...props
}) => {
  const getColors = () => {
    switch (variant) {
      case 'primary':
        return {
          bg: '#14B8A6',
          text: '#0B1220',
          border: '#14B8A6',
        };
      case 'destructive':
        return {
          bg: '#EF4444',
          text: '#F8FAFC',
          border: '#EF4444',
        };
      case 'quiet':
        return {
          bg: 'transparent',
          text: '#F8FAFC',
          border: 'transparent',
        };
      case 'secondary':
      default:
        return {
          bg: '#151F30',
          text: '#F8FAFC',
          border: '#334155',
        };
    }
  };

  const colors = getColors();
  const isDisabled = disabled || isLoading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '44px',
        minWidth: '44px',
        padding: '0 16px',
        borderRadius: '8px',
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        color: colors.text,
        fontSize: '15px',
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'opacity 0.15s ease, background-color 0.15s ease',
        width: fullWidth ? '100%' : 'auto',
        position: 'relative',
        ...style,
      }}
      {...props}
    >
      {/* Reserved spinner width to prevent layout shifts during loading */}
      {isLoading ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
          aria-live="polite"
        >
          <span
            style={{
              width: '16px',
              height: '16px',
              border: `2px solid currentColor`,
              borderRightColor: 'transparent',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 0.75s linear infinite',
            }}
          />
          <span>Đang xử lý...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
};
