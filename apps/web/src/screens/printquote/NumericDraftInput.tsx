import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  sanitizeNumericDraftInput,
  normalizeNumericDraftOnBlur,
} from '../helpers/printquote-helpers.js';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface NumericDraftInputProps {
  id?: string | undefined;
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  value: string;
  onValueChange: (nextRaw: string) => void;
  allowDecimal?: boolean | undefined;
  placeholder?: string | undefined;
  style?: React.CSSProperties | undefined;
  invalid?: boolean | undefined;
  required?: boolean | undefined;
  onBlurField?: (() => void) | undefined;
}

/**
 * Mobile-safe controlled numeric draft input for iOS Safari / WebKit / Chrome:
 * - Uses type="text" + inputMode="numeric" | "decimal" so clearing to "" never re-injects 0 or 1.
 * - Preserves exact caret offset during mid-string edits and formatted pastes ("5.000 đ" -> "5000").
 * - Normalizes leading zeros ("05000" -> "5000", "0500" -> "500") on blur while keeping "" empty.
 */
export const NumericDraftInput: React.FC<NumericDraftInputProps> = ({
  id,
  ariaLabel,
  dataTestId,
  value,
  onValueChange,
  allowDecimal = false,
  placeholder,
  style,
  invalid = false,
  required,
  onBlurField,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaretRef = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = inputRef.current;
    const caret = pendingCaretRef.current;
    if (
      el &&
      caret !== null &&
      typeof document !== 'undefined' &&
      document.activeElement === el
    ) {
      try {
        const clamped = Math.min(Math.max(0, caret), el.value.length);
        el.setSelectionRange(clamped, clamped);
      } catch {
        // Ignore selection errors on unsupported environments
      }
    }
    pendingCaretRef.current = null;
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const rawCaret = e.target.selectionStart;
    const sanitized = sanitizeNumericDraftInput(raw, allowDecimal);

    if (typeof rawCaret === 'number') {
      const beforeCaret = sanitizeNumericDraftInput(
        raw.slice(0, rawCaret),
        allowDecimal,
      );
      pendingCaretRef.current = beforeCaret.length;
    } else {
      pendingCaretRef.current = null;
    }

    onValueChange(sanitized);
  };

  const handleBlur = () => {
    pendingCaretRef.current = null;
    const normalized = normalizeNumericDraftOnBlur(value, allowDecimal);
    if (normalized !== value) {
      onValueChange(normalized);
    }
    onBlurField?.();
  };

  const mergedStyle: React.CSSProperties = invalid
    ? {
        ...style,
        borderColor: 'var(--danger-text)',
      }
    : { ...style };

  return (
    <input
      ref={inputRef}
      id={id}
      aria-label={ariaLabel}
      aria-invalid={invalid ? 'true' : undefined}
      data-testid={dataTestId}
      className="pq-numeric-input"
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      pattern={allowDecimal ? undefined : '[0-9]*'}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      placeholder={placeholder}
      required={required}
      style={mergedStyle}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
};
