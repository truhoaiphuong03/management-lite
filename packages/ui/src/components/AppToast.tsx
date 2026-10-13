import React, { useEffect } from 'react';
import { TOKENS } from '../tokens.js';
import {
  CheckCircleIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  CloseIcon,
} from './Icons.js';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface AppToastProps {
  message: string;
  variant?: ToastVariant | undefined;
  durationMs?: number | undefined;
  onClose?: (() => void) | undefined;
  action?:
    | {
        label: string;
        onClick: () => void;
      }
    | undefined;
  testId?: string | undefined;
}

export const AppToast: React.FC<AppToastProps> = ({
  message,
  variant = 'info',
  durationMs = 4000,
  onClose,
  action,
  testId = 'app-toast',
}) => {
  useEffect(() => {
    if (!durationMs || durationMs <= 0 || !onClose) return;
    const timer = setTimeout(() => {
      onClose();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onClose]);

  const variantStyles = {
    success: {
      color: TOKENS.colors.success,
      subtle: TOKENS.colors.successSubtle,
      icon: (
        <CheckCircleIcon size={18} style={{ color: TOKENS.colors.success }} />
      ),
    },
    error: {
      color: TOKENS.colors.danger,
      subtle: TOKENS.colors.dangerSubtle,
      icon: (
        <AlertCircleIcon size={18} style={{ color: TOKENS.colors.danger }} />
      ),
    },
    warning: {
      color: TOKENS.colors.warning,
      subtle: TOKENS.colors.warningSubtle,
      icon: (
        <AlertTriangleIcon size={18} style={{ color: TOKENS.colors.warning }} />
      ),
    },
    info: {
      color: TOKENS.colors.info,
      subtle: TOKENS.colors.infoSubtle,
      icon: <InfoIcon size={18} style={{ color: TOKENS.colors.info }} />,
    },
  }[variant];

  return (
    <div
      data-testid={testId}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        maxWidth: '420px',
        width: 'calc(100vw - 32px)',
        zIndex: 1000,
        backgroundColor: TOKENS.colors.surface,
        border: `1px solid ${variantStyles.color}40`,
        borderLeft: `4px solid ${variantStyles.color}`,
        borderRadius: TOKENS.radii.md,
        boxShadow:
          '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${TOKENS.spacing[3]} ${TOKENS.spacing[4]}`,
        gap: TOKENS.spacing[3],
        color: TOKENS.colors.text,
        fontSize: '14px',
        lineHeight: 1.5,
        wordBreak: 'break-word',
        animation: 'toastFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: TOKENS.spacing[3],
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {variantStyles.icon}
        </div>
        <div
          style={{
            flex: 1,
            color: TOKENS.colors.text,
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          {message}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: TOKENS.spacing[2],
          flexShrink: 0,
        }}
      >
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            style={{
              background: 'transparent',
              border: `1px solid ${variantStyles.color}`,
              color: variantStyles.color,
              padding: '6px 12px',
              borderRadius: TOKENS.radii.sm,
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '44px',
              minWidth: '44px',
              boxSizing: 'border-box',
            }}
          >
            {action.label}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thông báo"
            data-testid="btn-close-toast"
            style={{
              background: 'transparent',
              border: 'none',
              color: TOKENS.colors.muted,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '44px',
              minHeight: '44px',
              padding: '6px',
              borderRadius: TOKENS.radii.sm,
              transition: 'color 0.15s ease',
            }}
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
