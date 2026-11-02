import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

const baseSvgProps = (
  size: number | string = 18,
): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.75',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true' as const,
  focusable: 'false' as const,
  style: { flexShrink: 0 },
});

export function BuildingIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function CrownIcon({ size = 14, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M3 18h18" />
      <path d="m4 15 2-9 6 4 6-4 2 9H4Z" />
    </svg>
  );
}

export function UserIcon({ size = 14, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

export function LayoutGridIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    </svg>
  );
}

export function ClockIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

export function CalendarIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <line x1="16" y1="3" x2="16" y2="6" />
      <line x1="8" y1="3" x2="8" y2="6" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
    </svg>
  );
}

export function CalendarClockIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M21 10.5V6.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4.5" />
      <line x1="16" y1="3" x2="16" y2="6" />
      <line x1="8" y1="3" x2="8" y2="6" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <circle cx="16.5" cy="16.5" r="4.5" />
      <polyline points="16.5 14.5 16.5 16.5 18 17.5" />
    </svg>
  );
}

export function UserCheckIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M3 19.5a6.5 6.5 0 0 1 13 0" />
      <polyline points="16.5 11.5 18.5 13.5 22 10" />
    </svg>
  );
}

export function CheckSquareIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8.5 12 2.5 2.5 5-5" />
    </svg>
  );
}

export function ClipboardListIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8.5 9h7" />
      <path d="M8.5 13h7" />
      <path d="M8.5 17h4.5" />
    </svg>
  );
}

export function UsersIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 4.3a3.5 3.5 0 0 1 0 6.4" />
      <path d="M21.5 19.5a6.5 6.5 0 0 0-4.5-6" />
    </svg>
  );
}

export function BanknoteIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

export function CreditCardIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <line x1="2.5" y1="10" x2="21.5" y2="10" />
      <line x1="6.5" y1="15" x2="10.5" y2="15" />
    </svg>
  );
}

export function LockIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="4.5" y="11" width="15" height="10" rx="2.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function ShieldCheckIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M12 21c6-3 8-6.5 8-12V5l-8-2.5L4 5v4c0 5.5 2 9 8 12Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ShieldAlertIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M12 21c6-3 8-6.5 8-12V5l-8-2.5L4 5v4c0 5.5 2 9 8 12Z" />
      <path d="M12 8.5v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function AlertTriangleIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M10.4 4.2 2.8 17.5a1.8 1.8 0 0 0 1.6 2.7h15.2a1.8 1.8 0 0 0 1.6-2.7L13.6 4.2a1.8 1.8 0 0 0-3.2 0Z" />
      <line x1="12" y1="9.5" x2="12" y2="13.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function SlidersIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <line x1="4" y1="6" x2="10" y2="6" />
      <line x1="14" y1="6" x2="20" y2="6" />
      <circle cx="12" cy="6" r="2" />
      <line x1="4" y1="12" x2="6" y2="12" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <circle cx="8" cy="12" r="2" />
      <line x1="4" y1="18" x2="14" y2="18" />
      <line x1="18" y1="18" x2="20" y2="18" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}

export function SettingsIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 14, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 14, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function LogOutIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function CheckIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function XIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function AlertCircleIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function InfoIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function InboxIcon({ size = 32, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

export function PlusIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function SearchIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="11" cy="11" r="7.5" />
      <line x1="20" y1="20" x2="16.35" y2="16.35" />
    </svg>
  );
}

export function FilterIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M21 12a9 9 0 0 0-15.5-6.36L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <path d="M3 12a9 9 0 0 0 15.5 6.36L21 16" />
      <polyline points="16 16 21 16 21 21" />
    </svg>
  );
}

export function FileTextIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M14 2.5H6.5A2.5 2.5 0 0 0 4 5v14a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 19V8.5L14 2.5Z" />
      <polyline points="14 2.5 14 8.5 20 8.5" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

export function EyeIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export function KeyIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3" />
      <path d="m16 7 3 3" />
      <path d="m18.5 4.5 2.5 2.5" />
    </svg>
  );
}

export function CopyIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export function TrashIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v13.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function EditIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M18 13v5.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H11" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function FolderIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M21 18.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4.5l2 2.5H19a2 2 0 0 1 2 2v10.5z" />
    </svg>
  );
}

export function UploadIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M21 15v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V15" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function DownloadIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M21 15v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V15" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function BarChartIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M4 20V11" />
      <path d="M9.5 20V5" />
      <path d="M15 20v-7" />
      <path d="M20.5 20V8" />
    </svg>
  );
}

export function WalletIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M19.5 7V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5a2 2 0 0 0 0 4H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 17.5v-11" />
      <circle cx="17" cy="14" r="1" />
    </svg>
  );
}

export function TerminalIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <polyline points="7.5 10 10.5 12.5 7.5 15" />
      <line x1="12.5" y1="15" x2="16.5" y2="15" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return <XIcon {...props} />;
}

export function RotateCcwIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function PlayIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export function PauseIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function StopIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

export function LinkIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function ConstructionIcon({ size = 18, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <rect x="2" y="6" width="20" height="8" rx="1.5" />
      <path d="M17 14v7M7 14v7M17 3v3M7 3v3" />
      <path d="m10 14 2.3-8M14 14l2.3-8M6 14l2.3-8" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return <EditIcon {...props} />;
}

export function PowerIcon({ size = 16, style, ...props }: IconProps) {
  const base = baseSvgProps(size);
  return (
    <svg {...base} {...props} style={{ ...base.style, ...style }}>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

export function Trash2Icon(props: IconProps) {
  return <TrashIcon {...props} />;
}

export function NavIcon({
  name,
  id,
  size = 18,
}: {
  name?: string;
  id?: string;
  size?: number;
}) {
  switch (name || id) {
    case 'dashboard':
      return <LayoutGridIcon size={size} />;
    case 'clock':
      return <ClockIcon size={size} />;
    case 'schedule':
      return <CalendarIcon size={size} />;
    case 'attendance':
      return <CalendarClockIcon size={size} />;
    case 'attendance-review':
      return <UserCheckIcon size={size} />;
    case 'work':
      return <CheckSquareIcon size={size} />;
    case 'reports':
      return <BarChartIcon size={size} />;
    case 'storage':
      return <FolderIcon size={size} />;
    case 'employees':
      return <UsersIcon size={size} />;
    case 'payroll':
      return <BanknoteIcon size={size} />;
    case 'my-pay':
      return <CreditCardIcon size={size} />;
    case 'finance':
      return <WalletIcon size={size} />;
    case 'accounts':
      return <KeyIcon size={size} />;
    case 'print-quotes':
      return <ClipboardListIcon size={size} />;
    case 'audit':
      return <ShieldCheckIcon size={size} />;
    case 'system-logs':
      return <TerminalIcon size={size} />;
    case 'issues':
      return <AlertCircleIcon size={size} />;
    case 'settings':
      return <SlidersIcon size={size} />;
    default:
      return <LayoutGridIcon size={size} />;
  }
}
