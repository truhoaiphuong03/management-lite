import type {
  WorkPriority,
  WorkType,
} from '../../../../../packages/contracts/src/work.js';

export function formatDateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return 'Không có';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

export function getPriorityLabel(p: WorkPriority | undefined): string {
  switch (p) {
    case 'urgent':
      return 'Khẩn cấp';
    case 'high':
      return 'Cao';
    case 'medium':
    case 'normal' as WorkPriority:
      return 'Bình thường';
    case 'low':
      return 'Thấp';
    default:
      return p || 'Bình thường';
  }
}

export function getPriorityColor(p: WorkPriority | undefined): string {
  switch (p) {
    case 'urgent':
      return 'var(--danger-text)';
    case 'high':
      return 'var(--warning-text)';
    case 'medium':
    case 'normal' as WorkPriority:
      return 'var(--info-text)';
    case 'low':
      return 'var(--muted-color)';
    default:
      return 'var(--muted-color)';
  }
}

export function getPriorityBg(p: WorkPriority | undefined): string {
  switch (p) {
    case 'urgent':
      return 'var(--danger-subtle)';
    case 'high':
      return 'var(--warning-subtle)';
    case 'medium':
    case 'normal' as WorkPriority:
      return 'var(--info-subtle)';
    case 'low':
    default:
      return 'var(--surface-hover)';
  }
}

export function getWorkTypeLabel(t: WorkType | undefined): string {
  switch (t) {
    case 'general':
      return 'Việc chung';
    case 'content':
      return 'Nội dung';
    case 'video':
      return 'Dựng video';
    case 'design':
      return 'Thiết kế';
    case 'other':
      return 'Khác';
    default:
      return t || 'Việc chung';
  }
}
