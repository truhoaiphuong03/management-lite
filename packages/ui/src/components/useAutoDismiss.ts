import { useEffect, useRef } from 'react';

function hasActiveNotificationValue(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('message' in obj && typeof obj.message === 'string') {
      return obj.message.trim().length > 0;
    }
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text.trim().length > 0;
    }
    return Object.values(obj).some((v) =>
      typeof v === 'string' ? v.trim().length > 0 : Boolean(v),
    );
  }
  return true;
}

/**
 * Automatically clears a notification/banner/toast state after `durationMs`
 * without resetting the timer when the parent re-renders with a new inline callback.
 */
export function useAutoDismiss<T>(
  value: T,
  onClear: () => void,
  durationMs = 4000,
): void {
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;

  useEffect(() => {
    if (!hasActiveNotificationValue(value) || durationMs <= 0) return;
    const timer = setTimeout(() => {
      onClearRef.current();
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
  }, [value, durationMs]);
}
