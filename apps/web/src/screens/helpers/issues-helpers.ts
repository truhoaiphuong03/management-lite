import type {
  IssueStatus,
  IssueSeverity,
  IssueTestResult,
  IssueType,
  IssueActivityAction,
} from '../../../../../packages/contracts/src/issues.js';

export function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return isoString;
  }
}

export function getStatusBadge(status: IssueStatus): {
  status: 'success' | 'warning' | 'error' | 'muted' | 'neutral';
  label: string;
} {
  switch (status) {
    case 'open':
      return { status: 'neutral', label: 'Mới (Open)' };
    case 'analyzing':
      return { status: 'warning', label: 'AI đang phân tích' };
    case 'fixing':
      return { status: 'warning', label: 'Đang sửa (Fixing)' };
    case 'testing':
      return { status: 'warning', label: 'Đang test (Testing)' };
    case 'deploying':
      return { status: 'warning', label: 'Đang deploy' };
    case 'verifying':
      return { status: 'warning', label: 'Đang xác minh' };
    case 'fixed':
      return { status: 'success', label: 'Đã sửa (Fixed)' };
    case 'reopened':
      return { status: 'error', label: 'Mở lại (Reopened)' };
    case 'waiting_for_owner':
      return { status: 'warning', label: 'Chờ Owner nghiệm thu' };
    case 'awaiting_owner':
      return { status: 'warning', label: 'Chờ Owner duyệt' };
    case 'closed':
      return { status: 'success', label: 'Đã đóng' };
    default:
      return { status: 'muted', label: status };
  }
}

export function getSeverityBadge(severity?: IssueSeverity): {
  bg: string;
  color: string;
  border: string;
  label: string;
} | null {
  if (!severity) return null;
  switch (severity) {
    case 'P0':
      return {
        bg: 'rgba(239, 68, 68, 0.2)',
        color: 'var(--danger-text)',
        border: '#EF4444',
        label: 'P0 - Khẩn cấp',
      };
    case 'P1':
      return {
        bg: 'rgba(249, 115, 22, 0.2)',
        color: 'var(--warning-text)',
        border: '#F97316',
        label: 'P1 - Cao',
      };
    case 'P2':
      return {
        bg: 'rgba(234, 179, 8, 0.2)',
        color: 'var(--warning-text)',
        border: '#EAB308',
        label: 'P2 - Trung bình',
      };
    case 'P3':
      return {
        bg: 'rgba(100, 116, 139, 0.2)',
        color: 'var(--muted-color)',
        border: '#64748B',
        label: 'P3 - Thấp',
      };
    default:
      return null;
  }
}

export function getTestResultBadge(testResult?: IssueTestResult | null): {
  color: string;
  label: string;
} | null {
  if (!testResult) return null;
  switch (testResult) {
    case 'passed':
      return { color: 'var(--success-text)', label: 'Test: PASS' };
    case 'failed':
      return { color: 'var(--danger-text)', label: 'Test: FAIL' };
    case 'manual':
      return { color: 'var(--accent-text)', label: 'Test: Thủ công' };
    case 'pending':
      return { color: 'var(--warning-text)', label: 'Test: Chờ chạy' };
    default:
      return null;
  }
}

export function getTypeBadge(type: IssueType): {
  status: 'error' | 'neutral';
  label: string;
} {
  switch (type) {
    case 'bug':
      return { status: 'error', label: 'Lỗi (Bug)' };
    case 'improvement':
      return { status: 'neutral', label: 'Cải tiến' };
    default:
      return { status: 'neutral', label: type };
  }
}

export function getActivityActionBadge(action: IssueActivityAction): {
  status: 'success' | 'warning' | 'error' | 'muted' | 'neutral';
  label: string;
} {
  switch (action) {
    case 'created':
      return { status: 'neutral', label: 'Tạo vấn đề' };
    case 'edited':
      return { status: 'warning', label: 'Chỉnh sửa' };
    case 'status_changed':
      return { status: 'warning', label: 'Chuyển trạng thái' };
    case 'fix_confirmed':
      return { status: 'success', label: 'Xác nhận khắc phục (Đóng)' };
    case 'reopened':
      return { status: 'error', label: 'Mở lại vấn đề' };
    case 'gemini_analyzed':
      return { status: 'warning', label: '🤖 Gemini AI phân tích' };
    case 'pr_linked':
      return { status: 'neutral', label: 'Liên kết Pull Request' };
    case 'deploy_linked':
      return { status: 'warning', label: 'Đã deploy commit' };
    case 'test_verified':
      return { status: 'success', label: 'Kiểm thử xác minh' };
    case 'marked_fixed':
      return { status: 'success', label: 'Tự động đánh dấu FIXED' };
    case 'waiting_owner':
      return { status: 'warning', label: 'Chờ Owner nghiệm thu' };
    default:
      return { status: 'muted', label: action };
  }
}
