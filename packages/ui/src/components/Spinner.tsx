import React from 'react';
import { TOKENS } from '../tokens.js';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | number;
  color?: 'primary' | 'current' | string;
  style?: React.CSSProperties;
  className?: string;
  ariaLabel?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = 'primary',
  style,
  className,
  ariaLabel = 'Đang tải...',
}) => {
  const getDimension = () => {
    if (typeof size === 'number') return `${size}px`;
    switch (size) {
      case 'sm':
        return '16px';
      case 'lg':
        return '32px';
      case 'md':
      default:
        return '24px';
    }
  };

  const getBorderWidth = () => {
    if (typeof size === 'number') return size < 20 ? '2px' : '3px';
    return size === 'sm' ? '2px' : '3px';
  };

  const getColor = () => {
    if (color === 'primary') return TOKENS.colors.primary;
    if (color === 'current') return 'currentColor';
    return color;
  };

  const dimension = getDimension();
  const borderWidth = getBorderWidth();
  const spinnerColor = getColor();

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={className}
      style={{
        display: 'inline-block',
        width: dimension,
        height: dimension,
        border: `${borderWidth} solid ${
          color === 'current' ? 'currentColor' : TOKENS.colors.border
        }`,
        borderTopColor: spinnerColor,
        borderRadius: TOKENS.radii.full,
        animation: TOKENS.motion.spinKeyframe,
        verticalAlign: 'middle',
        boxSizing: 'border-box',
        flexShrink: 0,
        ...style,
      }}
    />
  );
};
