import React, { useEffect, useRef, useState } from 'react';
import { TOKENS, THEME_COLORS } from '../tokens.js';
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

export { useAutoDismiss } from './useAutoDismiss.js';

export const AppToast: React.FC<AppToastProps> = ({
  message,
  variant = 'info',
  durationMs = 4000,
  onClose,
  action,
  testId = 'app-toast',
}) => {
  const [dismissed, setDismissed] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setDismissed(false);
    if (!durationMs || durationMs <= 0) return;
    const timer = setTimeout(() => {
      setDismissed(true);
      onCloseRef.current?.();
    }, durationMs);
    if (
      typeof timer === 'object' &&
      timer !== null &&
      'unref' in timer &&
      typeof (timer as { unref?: () => void }).unref === 'function'
    ) {
      (timer as { unref: () => void }).unref();
    }
    return () => clearTimeout(timer);
  }, [durationMs, message, variant]);

  if (dismissed || !message) {
    return null;
  }

  const variantStyles = {
    success: {
      color: THEME_COLORS.success,
      subtle: THEME_COLORS.successSubtle,
      icon: (
        <CheckCircleIcon size={18} style={{ color: THEME_COLORS.success }} />
      ),
    },
    error: {
      color: THEME_COLORS.danger,
      subtle: THEME_COLORS.dangerSubtle,
      icon: (
        <AlertCircleIcon size={18} style={{ color: THEME_COLORS.danger }} />
      ),
    },
    warning: {
      color: THEME_COLORS.warning,
      subtle: THEME_COLORS.warningSubtle,
      icon: (
        <AlertTriangleIcon size={18} style={{ color: THEME_COLORS.warning }} />
      ),
    },
    info: {
      color: THEME_COLORS.info,
      subtle: THEME_COLORS.infoSubtle,
      icon: <InfoIcon size={18} style={{ color: THEME_COLORS.info }} />,
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
        backgroundColor: THEME_COLORS.surface,
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
        color: THEME_COLORS.text,
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
            color: THEME_COLORS.text,
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
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onCloseRef.current?.();
          }}
          aria-label="Đóng thông báo"
          data-testid="btn-close-toast"
          style={{
            background: 'transparent',
            border: 'none',
            color: THEME_COLORS.muted,
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
      </div>
    </div>
  );
};
