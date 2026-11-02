import React, { forwardRef, useState, useId, useRef } from 'react';
import { TOKENS, THEME_COLORS } from '../tokens.js';

export interface AppInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  label?: string;
  error?: string | null;
  helperText?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const AppInput = forwardRef<HTMLInputElement, AppInputProps>(
  (
    {
      label,
      error,
      helperText,
      iconLeft,
      iconRight,
      fullWidth = true,
      size = 'md',
      id,
      disabled,
      style,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const reactId = useId();
    const inputId = id || reactId;
    const hasError = Boolean(error);
    const errorId = hasError ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;
    const describedBy = hasError ? errorId : helperId;

    const innerRef = useRef<HTMLInputElement | null>(null);
    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') {
        ref(el);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
      }
    };

    const getSizeStyles = () => {
      switch (size) {
        case 'sm':
          return {
            minHeight: '36px',
            fontSize: TOKENS.typography.fontSize.base,
            paddingLeft: iconLeft ? '36px' : '10px',
            paddingRight: iconRight ? '36px' : '10px',
          };
        case 'lg':
          return {
            minHeight: '48px',
            fontSize: TOKENS.typography.fontSize.lg,
            paddingLeft: iconLeft ? '44px' : '16px',
            paddingRight: iconRight ? '44px' : '16px',
          };
        case 'md':
        default:
          return {
            minHeight: TOKENS.touchTarget.minHeight, // 44px
            fontSize: TOKENS.typography.fontSize.md,
            paddingLeft: iconLeft ? '40px' : '14px',
            paddingRight: iconRight ? '40px' : '14px',
          };
      }
    };

    const sStyles = getSizeStyles();

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: fullWidth ? '100%' : 'auto',
          boxSizing: 'border-box',
        }}
      >
        {label && (
          <label
            htmlFor={inputId}
            style={{
              display: 'block',
              fontSize: TOKENS.typography.fontSize.base,
              fontWeight: TOKENS.typography.fontWeight.semibold,
              color: hasError ? THEME_COLORS.error : THEME_COLORS.textSecondary,
              marginBottom: '6px',
              userSelect: 'none',
            }}
          >
            {label}
            {props.required && (
              <span style={{ color: THEME_COLORS.error, marginLeft: '4px' }}>
                *
              </span>
            )}
          </label>
        )}

        <div
          data-touch-target={size === 'sm' ? 'true' : undefined}
          data-min-touch-target="44px"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              innerRef.current?.focus();
            }
          }}
          style={{
            position: 'relative',
            width: '100%',
            minHeight: size === 'sm' ? TOKENS.touchTarget.minHeight : undefined,
            display: size === 'sm' ? 'flex' : undefined,
            alignItems: size === 'sm' ? 'center' : undefined,
          }}
        >
          {iconLeft && (
            <div
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: isFocused ? THEME_COLORS.primary : THEME_COLORS.muted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                transition: 'color 0.15s ease',
              }}
            >
              {iconLeft}
            </div>
          )}

          <input
            ref={setRefs}
            id={inputId}
            disabled={disabled}
            aria-invalid={hasError ? 'true' : undefined}
            aria-describedby={describedBy}
            onFocus={(e) => {
              setIsFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              onBlur?.(e);
            }}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              minHeight: sStyles.minHeight,
              paddingTop: '0',
              paddingBottom: '0',
              paddingLeft: sStyles.paddingLeft,
              paddingRight: sStyles.paddingRight,
              borderRadius: TOKENS.radii.sm, // 8px
              border: `1px solid ${
                hasError
                  ? THEME_COLORS.error
                  : isFocused
                    ? THEME_COLORS.primary
                    : THEME_COLORS.border
              }`,
              boxShadow: hasError
                ? `0 0 0 1px ${THEME_COLORS.error}`
                : isFocused
                  ? `0 0 0 1px ${THEME_COLORS.primary}`
                  : 'none',
              backgroundColor: THEME_COLORS.background, // #0B1220
              color: THEME_COLORS.text,
              fontSize: sStyles.fontSize,
              outline: 'none',
              cursor: disabled ? 'not-allowed' : 'text',
              opacity: disabled ? 0.6 : 1,
              transition:
                'border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
              ...style,
            }}
            {...props}
          />

          {iconRight && (
            <div
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: hasError
                  ? THEME_COLORS.error
                  : isFocused
                    ? THEME_COLORS.primary
                    : THEME_COLORS.muted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {iconRight}
            </div>
          )}
        </div>

        {error ? (
          <div
            id={errorId}
            role="alert"
            style={{
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.error,
              marginTop: '5px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {error}
          </div>
        ) : helperText ? (
          <div
            id={helperId}
            style={{
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.muted,
              marginTop: '5px',
            }}
          >
            {helperText}
          </div>
        ) : null}
      </div>
    );
  },
);

AppInput.displayName = 'AppInput';

export interface AppTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
  helperText?: string;
  fullWidth?: boolean;
}

export const AppTextarea = forwardRef<HTMLTextAreaElement, AppTextareaProps>(
  (
    {
      label,
      error,
      helperText,
      fullWidth = true,
      id,
      disabled,
      style,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const reactId = useId();
    const textareaId = id || reactId;
    const hasError = Boolean(error);
    const errorId = hasError ? `${textareaId}-error` : undefined;
    const helperId = helperText ? `${textareaId}-helper` : undefined;
    const describedBy = hasError ? errorId : helperId;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: fullWidth ? '100%' : 'auto',
          boxSizing: 'border-box',
        }}
      >
        {label && (
          <label
            htmlFor={textareaId}
            style={{
              display: 'block',
              fontSize: TOKENS.typography.fontSize.base,
              fontWeight: TOKENS.typography.fontWeight.semibold,
              color: hasError ? THEME_COLORS.error : THEME_COLORS.textSecondary,
              marginBottom: '6px',
            }}
          >
            {label}
            {props.required && (
              <span style={{ color: THEME_COLORS.error, marginLeft: '4px' }}>
                *
              </span>
            )}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          disabled={disabled}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={describedBy}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            minHeight: '88px',
            padding: '10px 14px',
            borderRadius: TOKENS.radii.sm,
            border: `1px solid ${
              hasError
                ? THEME_COLORS.error
                : isFocused
                  ? THEME_COLORS.primary
                  : THEME_COLORS.border
            }`,
            boxShadow: hasError
              ? `0 0 0 1px ${THEME_COLORS.error}`
              : isFocused
                ? `0 0 0 1px ${THEME_COLORS.primary}`
                : 'none',
            backgroundColor: THEME_COLORS.background,
            color: THEME_COLORS.text,
            fontSize: TOKENS.typography.fontSize.md,
            outline: 'none',
            cursor: disabled ? 'not-allowed' : 'text',
            opacity: disabled ? 0.6 : 1,
            lineHeight: TOKENS.typography.lineHeight.normal,
            resize: 'vertical',
            transition:
              'border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
            ...style,
          }}
          {...props}
        />

        {error ? (
          <div
            id={errorId}
            role="alert"
            style={{
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.error,
              marginTop: '5px',
            }}
          >
            {error}
          </div>
        ) : helperText ? (
          <div
            id={helperId}
            style={{
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.muted,
              marginTop: '5px',
            }}
          >
            {helperText}
          </div>
        ) : null}
      </div>
    );
  },
);

AppTextarea.displayName = 'AppTextarea';
