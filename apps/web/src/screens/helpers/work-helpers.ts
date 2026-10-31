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

export function getPriorityLabel(p: WorkPriority): string {
  switch (p) {
    case 'urgent':
      return 'Khẩn cấp';
    case 'high':
      return 'Cao';
    case 'medium':
      return 'Bình thường';
    case 'low':
      return 'Thấp';
    default:
      return p;
  }
}

export function getPriorityColor(p: WorkPriority): string {
  switch (p) {
    case 'urgent':
      return '#EF4444';
    case 'high':
      return '#F59E0B';
    case 'medium':
      return '#38BDF8';
    case 'low':
      return '#94A3B8';
    default:
      return '#94A3B8';
  }
}

export function getWorkTypeLabel(t: WorkType): string {
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
      return t;
  }
}
