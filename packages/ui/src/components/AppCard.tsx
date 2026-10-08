import React from 'react';

export interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: '16px' | '20px' | '24px' | '32px' | '48px 24px' | string;
  interactive?: boolean;
}

export const AppCard: React.FC<AppCardProps> = ({
  children,
  padding = '24px',
  interactive = false,
  style,
  ...props
}) => {
  return (
    <div
      style={{
        backgroundColor: '#151F30',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding,
        color: '#F8FAFC',
        transition: interactive
          ? 'border-color 0.2s ease, transform 0.15s ease'
          : 'none',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
};
