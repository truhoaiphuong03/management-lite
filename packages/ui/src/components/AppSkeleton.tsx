import React, { useState, useEffect } from 'react';

export interface AppSkeletonProps {
  /** Width of the skeleton, e.g. '100%', '200px', or number in px. */
  width?: string | number;
  /** Height of the skeleton, e.g. '16px', '40px', or number in px. */
  height?: string | number;
  /** Border radius: 'text' (4px), 'rect' (8px), 'circle' (50%), or custom. */
  variant?: 'text' | 'rect' | 'circle';
  /** Custom inline style overrides. */
  style?: React.CSSProperties;
  /** Additional CSS class names. */
  className?: string;
  /** Optional test identifier. */
  testId?: string;
}

const SKELETON_KEYFRAMES_STYLE = `
@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-testid*="skeleton"], [data-skeleton="true"] {
    animation: none !important;
  }
}
`;

let styleInjected = false;
function ensureSkeletonStyles() {
  if (styleInjected || typeof document === 'undefined') return;
  if (
    typeof document.getElementById === 'function' &&
    !document.getElementById('app-skeleton-shimmer-styles')
  ) {
    const styleEl = document.createElement('style');
    styleEl.id = 'app-skeleton-shimmer-styles';
    styleEl.textContent = SKELETON_KEYFRAMES_STYLE;
    document.head?.appendChild(styleEl);
  }
  styleInjected = true;
}

/**
 * AppSkeleton provides accessible animated placeholder shapes while asynchronous
 * content is being fetched, preventing layout shifts and improving perceived performance.
 * Respects prefers-reduced-motion for user accessibility.
 */
export const AppSkeleton: React.FC<AppSkeletonProps> = ({
  width = '100%',
  height,
  variant = 'text',
  style,
  className,
  testId = 'app-skeleton',
}) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(
    () => {
      if (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function'
      ) {
        try {
          return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
          return false;
        }
      }
      return false;
    },
  );

  useEffect(() => {
    ensureSkeletonStyles();
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    try {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
        return () => mediaQuery.removeEventListener('change', listener);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(listener);
        return () => mediaQuery.removeListener(listener);
      }
    } catch {
      // Ignored in non-supporting test environments
    }
  }, []);

  const getDefaultHeight = () => {
    switch (variant) {
      case 'text':
        return '16px';
      case 'circle':
        return typeof width === 'number' ? `${width}px` : width || '40px';
      case 'rect':
      default:
        return '48px';
    }
  };

  const getBorderRadius = () => {
    switch (variant) {
      case 'circle':
        return '50%';
      case 'rect':
        return '8px';
      case 'text':
      default:
        return '4px';
    }
  };

  const finalHeight = height ?? getDefaultHeight();
  const borderRadius = getBorderRadius();
  const animationStyle = prefersReducedMotion
    ? 'none'
    : 'skeleton-shimmer 1.6s ease-in-out infinite';

  return (
    <div
      data-testid={testId}
      data-skeleton="true"
      aria-hidden="true"
      role="presentation"
      className={className}
      style={{
        display: 'inline-block',
        width: typeof width === 'number' ? `${width}px` : width,
        height:
          typeof finalHeight === 'number' ? `${finalHeight}px` : finalHeight,
        borderRadius,
        backgroundColor: 'rgba(148, 163, 184, 0.12)',
        backgroundImage:
          'linear-gradient(90deg, rgba(148, 163, 184, 0.08) 0%, rgba(148, 163, 184, 0.2) 50%, rgba(148, 163, 184, 0.08) 100%)',
        backgroundSize: '200% 100%',
        animation: animationStyle,
        boxSizing: 'border-box',
        ...style,
      }}
    />
  );
};
