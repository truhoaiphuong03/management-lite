import React from 'react';
import { THEME_COLORS } from '../tokens.js';
import { AppButton } from './AppButton.js';
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  PencilIcon,
  PowerIcon,
  RotateCcwIcon,
  Trash2Icon,
} from './Icons.js';

export type ActionIconKind =
  | 'view'
  | 'edit'
  | 'deactivate'
  | 'reactivate'
  | 'delete'
  | 'download'
  | 'copy';

const KINDS: Record<
  ActionIconKind,
  { icon: React.ReactNode; label: string; style: React.CSSProperties }
> = {
  view: { icon: <EyeIcon size={18} />, label: 'Xem chi tiết', style: {} },
  edit: { icon: <PencilIcon size={18} />, label: 'Sửa', style: {} },
  deactivate: {
    icon: <PowerIcon size={18} />,
    label: 'Ngừng dùng',
    style: {
      color: THEME_COLORS.warning,
      borderColor: 'rgba(245, 158, 11, 0.45)',
      backgroundColor: 'transparent',
    },
  },
  reactivate: {
    icon: <RotateCcwIcon size={18} />,
    label: 'Kích hoạt lại',
    style: {
      color: THEME_COLORS.success,
      borderColor: 'rgba(16, 185, 129, 0.45)',
      backgroundColor: 'transparent',
    },
  },
  delete: {
    icon: <Trash2Icon size={18} />,
    label: 'Xóa',
    style: {
      color: THEME_COLORS.error,
      borderColor: 'rgba(239, 68, 68, 0.45)',
      backgroundColor: 'transparent',
    },
  },
  download: { icon: <DownloadIcon size={18} />, label: 'Tải xuống', style: {} },
  copy: { icon: <CopyIcon size={18} />, label: 'Sao chép', style: {} },
};

/** Label shown in tooltip for `kind` (exported for tests and callers that build dialogs). */
export const ACTION_ICON_LABELS: Record<ActionIconKind, string> = {
  view: KINDS.view.label,
  edit: KINDS.edit.label,
  deactivate: KINDS.deactivate.label,
  reactivate: KINDS.reactivate.label,
  delete: KINDS.delete.label,
  download: KINDS.download.label,
  copy: KINDS.copy.label,
};

export interface ActionIconButtonProps {
  action: ActionIconKind;
  /** Names the row for assistive tech: aria-label becomes "Sửa: Tiền nhà". */
  target?: string;
  /** Override the default Vietnamese tooltip. */
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}

/**
 * Unified secondary row action: 40x40 icon-only AppButton with Vietnamese tooltip + aria-label.
 * Destructive kinds (deactivate, delete) only open the caller's confirmation; they never act directly.
 * Primary actions (Thêm, Lưu, Tạo, Xác nhận) must stay text AppButtons.
 */
export const ActionIconButton: React.FC<ActionIconButtonProps> = ({
  action,
  target,
  label,
  disabled,
  onClick,
  testId,
}) => {
  const k = KINDS[action];
  const title = label ?? k.label;
  return (
    <AppButton
      variant="secondary"
      size="sm"
      icon={k.icon}
      title={title}
      aria-label={target ? `${title}: ${target}` : title}
      data-testid={testId}
      data-action={action}
      disabled={disabled}
      onClick={onClick}
      style={{ minWidth: 40, minHeight: 40, width: 40, height: 40, ...k.style }}
    />
  );
};

/** Row of action icons: 8px gap, never wraps or overlaps. */
export const actionIconsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};
