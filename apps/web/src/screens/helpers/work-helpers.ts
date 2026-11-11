import type {
  WorkItemData,
  WorkItemStatus,
  WorkPriority,
  WorkType,
} from '../../../../../packages/contracts/src/work.js';

export type WorkSortMode = 'smart' | 'due_asc' | 'priority_desc' | 'newest';
export type WorkSectionKey = 'attention' | 'active' | 'closed';

export interface ParsedChecklistItem {
  index: number;
  lineIndex: number;
  text: string;
  checked: boolean;
}

export interface ParsedWorkDescription {
  checklistItems: ParsedChecklistItem[];
  cleanNotes: string;
  atlasRef: string | null;
  completedCount: number;
  totalCount: number;
}

export interface WorkDeadlineInfo {
  hasDeadline: boolean;
  isOverdue: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  tone: 'danger' | 'warning' | 'info' | 'muted' | 'success';
  shortLabel: string;
  relativeLabel: string;
  formattedDateTime: string;
}

function getVnDateParts(date: Date): {
  ymd: string;
  ddmmyyyy: string;
  ddmm: string;
  hhmm: string;
  weekday: string;
} {
  try {
    const parts = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const yyyy = get('year');
    const mm = get('month').padStart(2, '0');
    const dd = get('day').padStart(2, '0');
    const hh = get('hour').padStart(2, '0');
    const min = get('minute').padStart(2, '0');
    const wk = get('weekday');
    if (yyyy && mm && dd) {
      return {
        ymd: `${yyyy}-${mm}-${dd}`,
        ddmmyyyy: `${dd}/${mm}/${yyyy}`,
        ddmm: `${dd}/${mm}`,
        hhmm: `${hh}:${min}`,
        weekday: wk,
      };
    }
  } catch {
    // Fallback below
  }
  const iso = date.toISOString();
  const ymd = iso.slice(0, 10);
  const [yyyy, mm, dd] = ymd.split('-');
  return {
    ymd,
    ddmmyyyy: `${dd}/${mm}/${yyyy}`,
    ddmm: `${dd}/${mm}`,
    hhmm: iso.slice(11, 16),
    weekday: '',
  };
}

export function formatDateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return 'Chưa đặt hạn';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const p = getVnDateParts(new Date(ms));
  return `${p.hhmm} · ${p.ddmmyyyy}`;
}

export function describeWorkDeadline(
  dueAtIso: string | null | undefined,
  status: WorkItemStatus,
  nowMs: number = Date.now(),
): WorkDeadlineInfo {
  if (!dueAtIso) {
    return {
      hasDeadline: false,
      isOverdue: false,
      isToday: false,
      isTomorrow: false,
      tone: 'muted',
      shortLabel: 'Chưa đặt hạn',
      relativeLabel: 'Linh hoạt thời gian',
      formattedDateTime: 'Chưa đặt hạn',
    };
  }

  const dueMs = Date.parse(dueAtIso);
  if (!Number.isFinite(dueMs)) {
    return {
      hasDeadline: false,
      isOverdue: false,
      isToday: false,
      isTomorrow: false,
      tone: 'muted',
      shortLabel: dueAtIso,
      relativeLabel: '',
      formattedDateTime: dueAtIso,
    };
  }

  const dueParts = getVnDateParts(new Date(dueMs));
  const nowParts = getVnDateParts(new Date(nowMs));
  const tomorrowParts = getVnDateParts(new Date(nowMs + 86_400_000));
  const formattedDateTime = `${dueParts.hhmm} · ${dueParts.ddmmyyyy}`;
  const isToday = dueParts.ymd === nowParts.ymd;
  const isTomorrow = dueParts.ymd === tomorrowParts.ymd;

  if (status === 'completed') {
    return {
      hasDeadline: true,
      isOverdue: false,
      isToday,
      isTomorrow,
      tone: 'success',
      shortLabel: `Hạn: ${dueParts.hhmm} · ${dueParts.ddmm}`,
      relativeLabel: 'Đã hoàn thành',
      formattedDateTime,
    };
  }

  if (status === 'cancelled') {
    return {
      hasDeadline: true,
      isOverdue: false,
      isToday,
      isTomorrow,
      tone: 'muted',
      shortLabel: `Hạn cũ: ${dueParts.hhmm} · ${dueParts.ddmm}`,
      relativeLabel: 'Đã hủy',
      formattedDateTime,
    };
  }

  const diffMin = Math.round((dueMs - nowMs) / 60_000);
  if (diffMin < 0) {
    const lateMin = Math.abs(diffMin);
    let lateText = '';
    if (lateMin < 60) {
      lateText = `Trễ ${Math.max(1, lateMin)} phút`;
    } else if (lateMin < 24 * 60) {
      lateText = `Trễ ${Math.round(lateMin / 60)} giờ`;
    } else {
      lateText = `Quá hạn ${Math.max(1, Math.round(lateMin / (24 * 60)))} ngày`;
    }
    return {
      hasDeadline: true,
      isOverdue: true,
      isToday,
      isTomorrow,
      tone: 'danger',
      shortLabel: `${lateText} (${dueParts.hhmm} · ${dueParts.ddmm})`,
      relativeLabel: lateText,
      formattedDateTime,
    };
  }

  if (isToday) {
    const remainText =
      diffMin < 60
        ? `còn ${Math.max(1, diffMin)} phút`
        : `còn ${Math.round(diffMin / 60)} giờ`;
    return {
      hasDeadline: true,
      isOverdue: false,
      isToday: true,
      isTomorrow: false,
      tone: 'warning',
      shortLabel: `Hôm nay · ${dueParts.hhmm} (${remainText})`,
      relativeLabel: `Còn ${diffMin < 60 ? `${Math.max(1, diffMin)} phút` : `${Math.round(diffMin / 60)} giờ`}`,
      formattedDateTime,
    };
  }

  if (isTomorrow) {
    return {
      hasDeadline: true,
      isOverdue: false,
      isToday: false,
      isTomorrow: true,
      tone: 'info',
      shortLabel: `Ngày mai · ${dueParts.hhmm} (${dueParts.ddmm})`,
      relativeLabel: 'Ngày mai',
      formattedDateTime,
    };
  }

  const daysAhead = Math.max(1, Math.ceil(diffMin / (24 * 60)));
  const prefix =
    daysAhead <= 6 && dueParts.weekday ? `${dueParts.weekday} · ` : '';
  return {
    hasDeadline: true,
    isOverdue: false,
    isToday: false,
    isTomorrow: false,
    tone: 'muted',
    shortLabel: `${prefix}${dueParts.hhmm} · ${dueParts.ddmmyyyy}`,
    relativeLabel: `Còn ${daysAhead} ngày`,
    formattedDateTime,
  };
}

export function getPriorityRank(p: WorkPriority | undefined): number {
  switch (p) {
    case 'urgent':
      return 1;
    case 'high':
      return 2;
    case 'medium':
    case 'normal' as WorkPriority:
      return 3;
    case 'low':
      return 4;
    default:
      return 3;
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

export function getPriorityBadgeText(p: WorkPriority | undefined): string {
  switch (p) {
    case 'urgent':
      return 'P1 · Khẩn cấp';
    case 'high':
      return 'P2 · Cao';
    case 'medium':
    case 'normal' as WorkPriority:
      return 'P3 · Bình thường';
    case 'low':
      return 'P4 · Thấp';
    default:
      return 'P3 · Bình thường';
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

export function getWorkCardAccentBorder(
  item: WorkItemData,
  isOverdue: boolean,
): string {
  if (item.status === 'completed') return '#10B981';
  if (item.status === 'cancelled') return 'var(--border-color)';
  if (isOverdue || item.priority === 'urgent') return '#EF4444';
  if (item.status === 'in_review' || item.priority === 'high') return '#F59E0B';
  if (item.priority === 'low') return '#94A3B8';
  return '#0284C7';
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

export function isWorkItemBlockedOrRework(item: WorkItemData): boolean {
  if (item.status === 'completed' || item.status === 'cancelled') return false;
  const hasChangesRequested = Boolean(
    item.assignments?.some(
      (a) => a.latest_review?.decision === 'request_changes',
    ),
  );
  const isUrgentUnassigned =
    item.priority === 'urgent' &&
    (!item.assignments || item.assignments.length === 0);
  const hasBlockedTag = Boolean(
    item.description && /\[(BLOCKED|HOLD|BỊ CHẶN)\]/i.test(item.description),
  );
  return hasChangesRequested || isUrgentUnassigned || hasBlockedTag;
}

export function classifyWorkSection(
  item: WorkItemData,
  nowMs: number = Date.now(),
): WorkSectionKey {
  if (item.status === 'completed' || item.status === 'cancelled') {
    return 'closed';
  }
  const dueMs = item.due_at ? Date.parse(item.due_at) : NaN;
  const isOverdue = Number.isFinite(dueMs) && dueMs < nowMs;
  if (
    isOverdue ||
    item.status === 'in_review' ||
    item.priority === 'urgent' ||
    isWorkItemBlockedOrRework(item)
  ) {
    return 'attention';
  }
  return 'active';
}

export function compareWorkItems(
  a: WorkItemData,
  b: WorkItemData,
  mode: WorkSortMode = 'smart',
  nowMs: number = Date.now(),
): number {
  const secOrder: Record<WorkSectionKey, number> = {
    attention: 0,
    active: 1,
    closed: 2,
  };
  const aClosed = a.status === 'completed' || a.status === 'cancelled' ? 1 : 0;
  const bClosed = b.status === 'completed' || b.status === 'cancelled' ? 1 : 0;

  // Always keep open work above closed/cancelled work so they never mix!
  if (aClosed !== bClosed) return aClosed - bClosed;

  if (aClosed === 1) {
    // Within closed: completed before cancelled, newest updated first
    const aCancel = a.status === 'cancelled' ? 1 : 0;
    const bCancel = b.status === 'cancelled' ? 1 : 0;
    if (aCancel !== bCancel) return aCancel - bCancel;
    const aUpd = Date.parse(a.updated_at || a.created_at || '') || 0;
    const bUpd = Date.parse(b.updated_at || b.created_at || '') || 0;
    return bUpd - aUpd;
  }

  const aDue = a.due_at ? Date.parse(a.due_at) : NaN;
  const bDue = b.due_at ? Date.parse(b.due_at) : NaN;
  const aHasDue = Number.isFinite(aDue);
  const bHasDue = Number.isFinite(bDue);
  const aPrio = getPriorityRank(a.priority);
  const bPrio = getPriorityRank(b.priority);

  if (mode === 'newest') {
    const aCreated = Date.parse(a.created_at || '') || 0;
    const bCreated = Date.parse(b.created_at || '') || 0;
    return bCreated - aCreated;
  }

  if (mode === 'priority_desc') {
    if (aPrio !== bPrio) return aPrio - bPrio;
    if (aHasDue !== bHasDue) return aHasDue ? -1 : 1;
    if (aHasDue && bHasDue && aDue !== bDue) return aDue - bDue;
    return (
      (Date.parse(b.created_at || '') || 0) -
      (Date.parse(a.created_at || '') || 0)
    );
  }

  if (mode === 'due_asc') {
    if (aHasDue !== bHasDue) return aHasDue ? -1 : 1;
    if (aHasDue && bHasDue && aDue !== bDue) return aDue - bDue;
    if (aPrio !== bPrio) return aPrio - bPrio;
    return (
      (Date.parse(b.created_at || '') || 0) -
      (Date.parse(a.created_at || '') || 0)
    );
  }

  // Default: 'smart' mode
  const aSec = secOrder[classifyWorkSection(a, nowMs)];
  const bSec = secOrder[classifyWorkSection(b, nowMs)];
  if (aSec !== bSec) return aSec - bSec;

  const aOverdue = aHasDue && aDue < nowMs ? 0 : 1;
  const bOverdue = bHasDue && bDue < nowMs ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;

  const aReview = a.status === 'in_review' ? 0 : 1;
  const bReview = b.status === 'in_review' ? 0 : 1;
  if (aReview !== bReview) return aReview - bReview;

  const todayYmd = getVnDateParts(new Date(nowMs)).ymd;
  const aToday =
    aHasDue && getVnDateParts(new Date(aDue)).ymd === todayYmd ? 0 : 1;
  const bToday =
    bHasDue && getVnDateParts(new Date(bDue)).ymd === todayYmd ? 0 : 1;
  if (aToday !== bToday) return aToday - bToday;

  if (aPrio !== bPrio) return aPrio - bPrio;
  if (aHasDue !== bHasDue) return aHasDue ? -1 : 1;
  if (aHasDue && bHasDue && aDue !== bDue) return aDue - bDue;

  const statusRank: Record<string, number> = {
    in_review: 0,
    in_progress: 1,
    todo: 2,
  };
  const aSt = statusRank[a.status] ?? 3;
  const bSt = statusRank[b.status] ?? 3;
  if (aSt !== bSt) return aSt - bSt;

  return (
    (Date.parse(b.created_at || '') || 0) -
    (Date.parse(a.created_at || '') || 0)
  );
}

const CHECKLIST_LINE_RE = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/;
const ATLAS_REF_LINE_RE = /^\s*\[AtlasRef:([^\]]+)\]\s*$/i;
const ATLAS_DONE_BANNER_RE = /^\s*✅\s*\[ĐÃ HOÀN THÀNH TRÊN AI WORK ATLAS/i;

export function parseWorkDescriptionChecklist(
  rawDesc: string | null | undefined,
): ParsedWorkDescription {
  if (!rawDesc) {
    return {
      checklistItems: [],
      cleanNotes: '',
      atlasRef: null,
      completedCount: 0,
      totalCount: 0,
    };
  }

  const lines = rawDesc.split(/\r?\n/);
  const checklistItems: ParsedChecklistItem[] = [];
  const noteLines: string[] = [];
  let atlasRef: string | null = null;

  lines.forEach((line, lineIdx) => {
    const refMatch = line.match(ATLAS_REF_LINE_RE);
    if (refMatch) {
      atlasRef = refMatch[1] ?? null;
      return;
    }
    if (ATLAS_DONE_BANNER_RE.test(line)) {
      return;
    }
    const chkMatch = line.match(CHECKLIST_LINE_RE);
    if (chkMatch) {
      const checked = (chkMatch[1] || '').toLowerCase() === 'x';
      const text = (chkMatch[2] || '').trim();
      if (text) {
        checklistItems.push({
          index: checklistItems.length,
          lineIndex: lineIdx,
          text,
          checked,
        });
        return;
      }
    }
    noteLines.push(line);
  });

  const cleanNotes = noteLines
    .join('\n')
    .replace(/\s*\[AtlasRef:[^\]]+\]\s*/gi, '\n')
    .trim();
  const completedCount = checklistItems.filter((i) => i.checked).length;

  return {
    checklistItems,
    cleanNotes,
    atlasRef,
    completedCount,
    totalCount: checklistItems.length,
  };
}

export function toggleChecklistItemInDescription(
  rawDesc: string | null | undefined,
  checklistIndex: number,
  nextChecked: boolean,
): string {
  if (!rawDesc) return '';
  const lines = rawDesc.split(/\r?\n/);
  let currentChecklistIdx = 0;
  const updated = lines.map((line) => {
    const chkMatch = line.match(CHECKLIST_LINE_RE);
    if (chkMatch && (chkMatch[2] || '').trim()) {
      if (currentChecklistIdx === checklistIndex) {
        currentChecklistIdx++;
        return `- [${nextChecked ? 'x' : ' '}] ${(chkMatch[2] || '').trim()}`;
      }
      currentChecklistIdx++;
    }
    return line;
  });
  return updated.join('\n');
}

export function appendChecklistItemToDescription(
  rawDesc: string | null | undefined,
  stepText: string,
): string {
  const cleanStep = stepText.trim();
  if (!cleanStep) return rawDesc || '';
  const newLine = `- [ ] ${cleanStep}`;
  if (!rawDesc || !rawDesc.trim()) return newLine;

  const lines = rawDesc.split(/\r?\n/);
  let lastChecklistLineIdx = -1;
  let atlasRefLineIdx = -1;

  lines.forEach((line, idx) => {
    if (CHECKLIST_LINE_RE.test(line)) {
      lastChecklistLineIdx = idx;
    }
    if (ATLAS_REF_LINE_RE.test(line)) {
      atlasRefLineIdx = idx;
    }
  });

  if (lastChecklistLineIdx >= 0) {
    lines.splice(lastChecklistLineIdx + 1, 0, newLine);
  } else if (atlasRefLineIdx >= 0) {
    lines.splice(atlasRefLineIdx, 0, newLine);
  } else {
    lines.unshift(newLine);
  }
  return lines.join('\n');
}
