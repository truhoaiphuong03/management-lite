import React from 'react';

export interface PqIconProps {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

const baseSvg = (
  size: number,
  children: React.ReactNode,
  style?: React.CSSProperties,
  className?: string,
) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
    style={{ flexShrink: 0, display: 'inline-block', ...style }}
  >
    {children}
  </svg>
);

export const PqPlusIcon: React.FC<PqIconProps> = ({
  size = 16,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    style,
    className,
  );

export const PqSearchIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    style,
    className,
  );

export const PqFileTextIcon: React.FC<PqIconProps> = ({
  size = 16,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h6" />
    </>,
    style,
    className,
  );

export const PqDownloadIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>,
    style,
    className,
  );

export const PqEyeIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
    style,
    className,
  );

export const PqEditIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>,
    style,
    className,
  );

export const PqCopyIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    style,
    className,
  );

export const PqLockIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
    style,
    className,
  );

export const PqPackageIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="m16.5 9.4-9-5.19" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </>,
    style,
    className,
  );

export const PqHistoryIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>,
    style,
    className,
  );

export const PqSlidersIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="2" y1="14" x2="6" y2="14" />
      <line x1="10" y1="8" x2="14" y2="8" />
      <line x1="18" y1="16" x2="22" y2="16" />
    </>,
    style,
    className,
  );

export const PqPrinterIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>,
    style,
    className,
  );

export const PqArrowLeftIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>,
    style,
    className,
  );

export const PqTagIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42Z" />
      <circle cx="7" cy="7" r="1.5" />
    </>,
    style,
    className,
  );

export const PqUsersIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
    style,
    className,
  );

export const PqStoreIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
    </>,
    style,
    className,
  );

export const PqChartIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>,
    style,
    className,
  );

export const PqCheckIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <polyline points="20 6 9 17 4 12" />
    </>,
    style,
    className,
  );

export const PqTrashIcon: React.FC<PqIconProps> = ({
  size = 14,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>,
    style,
    className,
  );

export const PqChevronIcon: React.FC<PqIconProps & { up?: boolean }> = ({
  size = 14,
  up = false,
  style,
  className,
}) =>
  baseSvg(
    size,
    up ? (
      <polyline points="18 15 12 9 6 15" />
    ) : (
      <polyline points="6 9 12 15 18 9" />
    ),
    style,
    className,
  );

export const PqWalletIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </>,
    style,
    className,
  );

export const PqShieldIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>,
    style,
    className,
  );

export const PqSaveIcon: React.FC<PqIconProps> = ({
  size = 16,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>,
    style,
    className,
  );

export const PqTruckIcon: React.FC<PqIconProps> = ({
  size = 15,
  style,
  className,
}) =>
  baseSvg(
    size,
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>,
    style,
    className,
  );
