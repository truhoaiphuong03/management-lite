import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import {
  calculateDays,
  instant,
  localDate,
  monthBounds,
  subtractBreaks,
  type PayInterval,
  type PayRate,
} from './calculation.js';
import type { PayrollService } from './service.js';
import {
  buildTimesheetXlsx,
  parseTimesheetXlsx,
  type TimesheetDay,
  type TimesheetMonth,
} from './timesheet.js';
import {
  aggregateStats,
  sumBuckets,
  GRANULARITIES,
  type Granularity,
  type StatsBucket,
  type StatsDayRow,
  type StatsReportLink,
} from './stats.js';

const OFFSET = 7 * 3600 * 1000;
const DAY = 86400000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STATS_MONTHS = 24;
const IMPORT_SOURCE = 'Imported from timesheet';

export const DEFAULT_PAYROLL_GOOGLE_SHEET_ID =
  '11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw';
export const DEFAULT_PAYROLL_GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_PAYROLL_GOOGLE_SHEET_ID}/edit?usp=drive_link`;

export function extractGoogleSheetId(raw?: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return DEFAULT_PAYROLL_GOOGLE_SHEET_ID;
  const urlMatch = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{15,100})/);
  if (urlMatch?.[1]) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{15,100}$/.test(s)) return s;
  throw new AuthError(
    'VALIDATION_ERROR',
    'Link hoặc mã Google Sheet không hợp lệ.',
    400,
  );
}

export interface GoogleSheetDayReconciliation {
  date: string;
  month: number;
  rate_vnd: number;
  system_start: string | null;
  system_end: string | null;
  system_minutes: number;
  system_hours: number;
  system_wage_vnd: number;
  system_source: 'clock' | 'import' | 'mixed' | null;
  excel_start: string | null;
  excel_end: string | null;
  excel_minutes: number;
  excel_hours: number;
  excel_wage_vnd: number;
  task: string;
  diff_minutes: number;
  diff_wage_vnd: number;
  status: 'matched' | 'diff_hours' | 'only_excel' | 'only_system';
}

export interface GoogleSheetMonthReconciliation {
  month: string;
  rate_vnd: number;
  system_days: number;
  system_minutes: number;
  system_hours: number;
  system_wage_vnd: number;
  excel_days: number;
  excel_minutes: number;
  excel_hours: number;
  excel_wage_vnd: number;
  excel_formula_wage_vnd: number;
  diff_days: number;
  diff_minutes: number;
  diff_hours: number;
  diff_wage_vnd: number;
  matched_days: number;
  diff_hours_days: number;
  only_excel_days: number;
  only_system_days: number;
  status: 'matched' | 'mismatch';
}

export interface GoogleSheetReconciliationSummary {
  months: GoogleSheetMonthReconciliation[];
  days: GoogleSheetDayReconciliation[];
  totals: {
    system_days: number;
    system_minutes: number;
    system_hours: number;
    system_wage_vnd: number;
    excel_days: number;
    excel_minutes: number;
    excel_hours: number;
    excel_wage_vnd: number;
    excel_formula_wage_vnd: number;
    diff_days: number;
    diff_minutes: number;
    diff_hours: number;
    diff_wage_vnd: number;
    matched_days: number;
    diff_hours_days: number;
    only_excel_days: number;
    only_system_days: number;
  };
}

export interface GoogleSheetSyncInput {
  sheet_url?: string;
  file_base64?: string;
  year?: number;
  employee_id?: string;
  remove_nv002_payroll?: boolean;
  preserve_newer_web_clockins?: boolean;
  commit?: boolean;
}

export interface GoogleSheetSyncResult {
  committed: boolean;
  sheet_id: string;
  sheet_url: string;
  source_mode: 'live_google_sheet' | 'uploaded_file' | 'canonical_fallback';
  year: number;
  employee: {
    id: string;
    code: string;
    full_name: string;
    bank_name: string | null;
    bank_account_number: string | null;
  };
  nv002_status: {
    found: boolean;
    removed_from_payroll: boolean;
    shifts_removed: number;
  };
  before_reconciliation: GoogleSheetReconciliationSummary;
  reconciliation: GoogleSheetReconciliationSummary;
  warnings: string[];
}

export const CANONICAL_NV001_MONTHS_2026: ReturnType<
  typeof parseTimesheetXlsx
>['months'] = [
  {
    month: 6,
    rate: 20000,
    days: [
      {
        day: 1,
        start_min: 540,
        end_min: 720,
        task: '',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 2,
        start_min: 540,
        end_min: 780,
        task: '',
        bonus: 0,
        sheet_hours: 4,
      },
      {
        day: 3,
        start_min: 570,
        end_min: 810,
        task: '',
        bonus: 0,
        sheet_hours: 4,
      },
      {
        day: 4,
        start_min: 570,
        end_min: 690,
        task: 'Edit 8 clip kênh LSK',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 8,
        start_min: 570,
        end_min: 930,
        task: 'Edit 8 clip LSK: 4 Tonic, 2 men rắc, 2 tiêu phân-khử mùi; 4 clip LSKMM: 2 men rắc thảo dược, 2 men rắc tiêu phân - khử mùi',
        bonus: 0,
        sheet_hours: 6,
      },
      {
        day: 9,
        start_min: 570,
        end_min: 810,
        task: '6 clip LSK: 2 Linco, 2 bổ gan thận, 2 Canxi B12. Phụ live TikTok',
        bonus: 0,
        sheet_hours: 4,
      },
      {
        day: 10,
        start_min: 630,
        end_min: 900,
        task: '8 clip LSK: 4 Flodoxy, 4 Fensit. Live kênh LSKMM',
        bonus: 0,
        sheet_hours: 4.5,
      },
      {
        day: 15,
        start_min: 630,
        end_min: 840,
        task: '4 Clip LSK: 2 Flodoxy, 2 Fensit. Phụ Live Tiktok',
        bonus: 0,
        sheet_hours: 3.5,
      },
      {
        day: 17,
        start_min: 540,
        end_min: 900,
        task: '10 clip LSK: giải độc gan, Tonic, Flodoxy, Linco, Fensit',
        bonus: 0,
        sheet_hours: 6,
      },
      {
        day: 18,
        start_min: 810,
        end_min: 1020,
        task: '2 clip thực tế Linco, 1 clip thực tế Flodoxy',
        bonus: 0,
        sheet_hours: 3.5,
      },
      {
        day: 19,
        start_min: 630,
        end_min: 900,
        task: '6 clip thực tế: 3 Flodoxy,  3 Fensit',
        bonus: 0,
        sheet_hours: 4.5,
      },
      {
        day: 22,
        start_min: 630,
        end_min: 810,
        task: '8 clip LSKMM: Flodoxy, Fensit, Linco, Flucasol. LIVE',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 23,
        start_min: 630,
        end_min: 900,
        task: '6 clip LSK: linco, 4 fensit, flucasol. LIVE. 4 clip thực tế: 2 fensit, 2 flodoxy',
        bonus: 0,
        sheet_hours: 4.5,
      },
      {
        day: 24,
        start_min: 640,
        end_min: 920,
        task: '5 clip thực tế: 2 flodoxy, 2 tonic, 1 canxi B12',
        bonus: 0,
        sheet_hours: 4.666666667,
      },
    ],
  },
  {
    month: 7,
    rate: 25000,
    days: [
      {
        day: 3,
        start_min: 675,
        end_min: 900,
        task: '8 clip thực tế cho: flodoxy, linco, men rắc tiêu phân, fensit',
        bonus: 0,
        sheet_hours: 3.75,
      },
      {
        day: 7,
        start_min: 680,
        end_min: 910,
        task: '7 clip LSK: 2Tonic, 3 linco, 2men rắc tiêu phân-khử mùi | 7 clip LSKMM',
        bonus: 0,
        sheet_hours: 3.833333333,
      },
      {
        day: 9,
        start_min: 795,
        end_min: 915,
        task: '8 clip LSK: linco, tonic, canxiB12, giải độc gan',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 14,
        start_min: 585,
        end_min: 885,
        task: 'LSK: 10 clip: 2 canxi B12, 2 Gan, 2 Tonic, 4 Men sống| Thực tế: 3 men sống, 3 fensit',
        bonus: 0,
        sheet_hours: 5,
      },
      {
        day: 20,
        start_min: 635,
        end_min: 840,
        task: '9 clip thực tế: Fensit, Linco, Men sống',
        bonus: 0,
        sheet_hours: 3.416666667,
      },
      {
        day: 21,
        start_min: 635,
        end_min: 840,
        task: '17 clip kênh LSK: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit',
        bonus: 0,
        sheet_hours: 3.416666667,
      },
      {
        day: 22,
        start_min: 705,
        end_min: 870,
        task: '17 clip kênh LSKMM: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit',
        bonus: 0,
        sheet_hours: 2.75,
      },
      {
        day: 23,
        start_min: 715,
        end_min: 950,
        task: '8 clip LSK: men sống, flucasol, fensit, linco. 2 clip thực tế linco, men thảo dược.',
        bonus: 0,
        sheet_hours: 3.916666667,
      },
      {
        day: 29,
        start_min: 820,
        end_min: 1000,
        task: 'LSKMM:5 clip Nuôi gà theo mệnh. | Kenh2:15 clip MMG. | COCO: 15 clip MMG.',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 30,
        start_min: 800,
        end_min: 995,
        task: '3 clip thực tế: linco, 3 clip thực tế men sống, 1 clip thực tế fensit.',
        bonus: 0,
        sheet_hours: 3.25,
      },
    ],
  },
  {
    month: 8,
    rate: 25000,
    days: [
      {
        day: 4,
        start_min: 635,
        end_min: 840,
        task: '17 clip LSK: fensit, linco, canxi, men sống, men rắc, flodoxy, flucasol',
        bonus: 0,
        sheet_hours: 3.416666667,
      },
      {
        day: 5,
        start_min: 860,
        end_min: 1020,
        task: 'LSKMM: 15 clip màu mệnh, 5 clip mệnh gà. COCO: 15 clip màu mệnh',
        bonus: 0,
        sheet_hours: 2.666666667,
      },
      {
        day: 6,
        start_min: 840,
        end_min: 1000,
        task: '8 clip thực tế: men sống, linco, fensit.',
        bonus: 0,
        sheet_hours: 2.666666667,
      },
      {
        day: 13,
        start_min: 805,
        end_min: 940,
        task: 'LSKMM: 16 clip MMG, COCO: 16 clip MMG. Chèn nhạc vào clip LSK 0408 30 phút( tại nhà)',
        bonus: 0,
        sheet_hours: 2.25,
      },
      {
        day: 14,
        start_min: 840,
        end_min: 970,
        task: 'LSKMM: 15 clip MMG, COCO: 15 clip MM',
        bonus: 0,
        sheet_hours: 2.166666667,
      },
      {
        day: 16,
        start_min: 860,
        end_min: 960,
        task: 'LSKMM: 15 clip MMG, COCO: 15 clip MM',
        bonus: 0,
        sheet_hours: 1.666666667,
      },
      {
        day: 18,
        start_min: 700,
        end_min: 975,
        task: 'LSK: 2 men song, 2 linco, 2flucasol, 2 canxi. 2 fensit, 1 gđ gan, 1 tonic, 1 flodoxy, 1 men rắc',
        bonus: 0,
        sheet_hours: 4.583333333,
      },
      {
        day: 19,
        start_min: 770,
        end_min: 960,
        task: 'LSK: 2flodoxy, 2 GDGan, 2Tonic, 2Men song, 2 Men rắc, 1 linco,1 đẹn, 1fensit, 1 canxi',
        bonus: 0,
        sheet_hours: 3.166666667,
      },
      {
        day: 20,
        start_min: 840,
        end_min: 1020,
        task: 'LSK 17 clip: linco, flucasol, fensit, canxi, flodoxy, Gan, Tonic, Men rắc, Men sống',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 28,
        start_min: 870,
        end_min: 1020,
        task: '22 clip nhà máy cho kênh tạp hóa',
        bonus: 0,
        sheet_hours: 2.5,
      },
      {
        day: 29,
        start_min: 860,
        end_min: 1027,
        task: '76 clip kênh tạp hóa cho các Dot4,5,6,7,8,9',
        bonus: 0,
        sheet_hours: 2.783333333,
      },
    ],
  },
  {
    month: 9,
    rate: 25000,
    days: [
      {
        day: 3,
        start_min: 840,
        end_min: 990,
        task: '16 CLIP TRẠI GÀ, 29 CLIP BaPhat',
        bonus: 0,
        sheet_hours: 2.5,
      },
      {
        day: 4,
        start_min: 860,
        end_min: 1040,
        task: '25 clip tạp hóa, 25 clip BaPhat.',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 5,
        start_min: 795,
        end_min: 1065,
        task: 'taphoanhabinh:40 clip. Baphat: 48 clip',
        bonus: 0,
        sheet_hours: 4.5,
      },
      {
        day: 6,
        start_min: 795,
        end_min: 915,
        task: '18 clip nhamaythuocga. 24 clip baphatreview',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 8,
        start_min: 865,
        end_min: 1035,
        task: 'taphoa.24sp.0509; baphat.24sp.0509.dot2; batphat.24sp.0609.dot1',
        bonus: 0,
        sheet_hours: 2.833333333,
      },
      {
        day: 9,
        start_min: 1080,
        end_min: 1200,
        task: '48 clip baphat dot1, dot2',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 10,
        start_min: 800,
        end_min: 1095,
        task: 'Tạp Hóa: 80 clip. Bá Phát: 56 clip',
        bonus: 0,
        sheet_hours: 4.916666667,
      },
      {
        day: 16,
        start_min: 1290,
        end_min: 1350,
        task: 'Tạp hóa: 22 clip (không có lỗi)',
        bonus: 0,
        sheet_hours: 1,
      },
      {
        day: 17,
        start_min: 840,
        end_min: 990,
        task: 'taphoa: 27 clip. baphat: 54 clip',
        bonus: 0,
        sheet_hours: 2.5,
      },
      {
        day: 22,
        start_min: 870,
        end_min: 1050,
        task: 'tạp hóa: 39 clip. baphat: 38 clip',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 23,
        start_min: 920,
        end_min: 1040,
        task: 'tạp hóa: 55 clip',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 24,
        start_min: 960,
        end_min: 1080,
        task: 'taphoa: 58 clip',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 25,
        start_min: 840,
        end_min: 900,
        task: 'taphoa: 32 clip',
        bonus: 0,
        sheet_hours: 1,
      },
    ],
  },
  {
    month: 10,
    rate: 25000,
    days: [
      {
        day: 5,
        start_min: 825,
        end_min: 885,
        task: '26 clip tạp hóa',
        bonus: 0,
        sheet_hours: 1,
      },
      {
        day: 13,
        start_min: 840,
        end_min: 960,
        task: '59 clip tạp hóa',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 14,
        start_min: 800,
        end_min: 980,
        task: '70 clip tạp hóa',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 15,
        start_min: 860,
        end_min: 1040,
        task: '44 clip tạp hóa',
        bonus: 0,
        sheet_hours: 3,
      },
      {
        day: 21,
        start_min: 840,
        end_min: 1000,
        task: '38 clip tạp hóa',
        bonus: 0,
        sheet_hours: 2.666666667,
      },
      {
        day: 27,
        start_min: 890,
        end_min: 1000,
        task: '33 clip taphoa',
        bonus: 0,
        sheet_hours: 1.833333333,
      },
      {
        day: 28,
        start_min: 870,
        end_min: 1020,
        task: 'tìm source, edit cho 2 clip chia sẻ thực tế',
        bonus: 0,
        sheet_hours: 2.5,
      },
      {
        day: 29,
        start_min: 875,
        end_min: 995,
        task: 'VUKY: 2 CLIP. Clip thực tế: 1',
        bonus: 0,
        sheet_hours: 2,
      },
      {
        day: 30,
        start_min: 825,
        end_min: 1030,
        task: '3 clip VUKY, 2 clip NUOIKENH',
        bonus: 0,
        sheet_hours: 3.416666667,
      },
    ],
  },
  {
    month: 11,
    rate: 25000,
    days: [
      {
        day: 3,
        start_min: 870,
        end_min: 1005,
        task: '3 vuky, 2 nuoikenh',
        bonus: 0,
        sheet_hours: 2.25,
      },
      {
        day: 4,
        start_min: 885,
        end_min: 1050,
        task: '3 vuky, 2 nuoi kenh',
        bonus: 0,
        sheet_hours: 2.75,
      },
      {
        day: 5,
        start_min: 1005,
        end_min: 1155,
        task: '2 VUKY, 2 NUOIKENH',
        bonus: 0,
        sheet_hours: 2.5,
      },
      {
        day: 6,
        start_min: 855,
        end_min: 1095,
        task: '4 VUKY. 4 NUOIKENH',
        bonus: 0,
        sheet_hours: 4,
      },
    ],
  },
];

function fmtMinToHHMM(min: number | null): string | null {
  if (min === null || !Number.isFinite(min)) return null;
  const normalized = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const isDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const daysInMonth = (y: number, m: number): number =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();
const localMs = (y: number, m: number, d: number, minutes: number): number =>
  Date.UTC(y, m - 1, d, 0, minutes) - OFFSET;
const minuteOfDay = (ms: number): number =>
  Math.floor(((((ms + OFFSET) % DAY) + DAY) % DAY) / 60000);
const pgDate = (v: unknown): string => {
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface TimesheetImportInput {
  file_base64: string;
  year?: number;
  employee_id?: string;
  new_employee_name?: string;
  commit?: boolean;
}
export interface TimesheetImportMonthSummary {
  month: string;
  shifts_new: number;
  shifts_skipped: number;
  hours: number;
  expected_wage_vnd: number | null;
  rate_vnd: number | null;
}
export interface TimesheetImportResult {
  committed: boolean;
  year: number;
  employee: { id: string; code: string; full_name: string; created: boolean };
  months: TimesheetImportMonthSummary[];
  totals: {
    shifts_new: number;
    shifts_skipped: number;
    hours: number;
    expected_wage_vnd: number | null;
    rates_created: number;
    reports_created: number;
  };
  warnings: string[];
}

interface PlannedShift {
  month: number;
  date: string;
  clockIn: number;
  clockOut: number;
  task: string;
}

export class TimesheetService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly payroll: PayrollService,
  ) {}

  // ------------------------------------------------------------------ stats

  async stats(
    auth: AuthenticatedContext,
    q: {
      granularity?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
      employee_id?: string | undefined;
    },
  ): Promise<{
    granularity: Granularity;
    from: string;
    to: string;
    employee_id: string | null;
    totals: Omit<StatsBucket, 'key' | 'label' | 'from' | 'to' | 'days'>;
    buckets: StatsBucket[];
    notes: string[];
  }> {
    requireRole(['owner'], auth);
    const g = (q.granularity ?? 'month') as Granularity;
    if (!GRANULARITIES.includes(g))
      throw new AuthError('VALIDATION_ERROR', 'granularity không hợp lệ.', 400);
    const today = localDate(Date.now());
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    if (!isDate(from) || !isDate(to) || from > to)
      throw new AuthError('VALIDATION_ERROR', 'Khoảng ngày không hợp lệ.', 400);
    if (q.employee_id && !isUuid(q.employee_id))
      throw new AuthError('VALIDATION_ERROR', 'employee_id không hợp lệ.', 400);
    const months: string[] = [];
    {
      let y = Number(from.slice(0, 4));
      let m = Number(from.slice(5, 7));
      const ey = Number(to.slice(0, 4));
      const em = Number(to.slice(5, 7));
      while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        if (++m > 12) {
          m = 1;
          y++;
        }
      }
    }
    if (months.length > MAX_STATS_MONTHS)
      throw new AuthError(
        'VALIDATION_ERROR',
        `Khoảng thời gian tối đa ${MAX_STATS_MONTHS} tháng.`,
        400,
      );

    const reports = await this.reportMap(auth.workspace.id, from, to);
    const rows: StatsDayRow[] = [];
    for (const month of months) {
      const ov = (await this.payroll.overview(auth, month)) as {
        items: {
          employee_id: string;
          employee_code: string;
          full_name: string;
          daily_breakdowns: {
            work_date: unknown;
            shift_count?: number;
            worked_seconds: number;
            rounded_wage_vnd: number;
            hourly_rate_vnd_snapshot: number;
          }[];
        }[];
      };
      for (const it of ov.items) {
        if (q.employee_id && it.employee_id !== q.employee_id) continue;
        for (const d of it.daily_breakdowns) {
          const date = pgDate(d.work_date);
          if (date < from || date > to) continue;
          rows.push({
            employee_id: it.employee_id,
            employee_code: it.employee_code,
            employee_name: it.full_name,
            work_date: date,
            worked_seconds: Number(d.worked_seconds),
            shift_count: d.shift_count ?? 1,
            wage_vnd: Number(d.rounded_wage_vnd),
            hourly_rate_vnd: Number(d.hourly_rate_vnd_snapshot),
            report: reports.get(`${it.employee_id}|${date}`) ?? null,
          });
        }
      }
    }
    const buckets = aggregateStats(rows, g);
    const totalOnly = sumBuckets(buckets);
    return {
      granularity: g,
      from,
      to,
      employee_id: q.employee_id ?? null,
      totals: totalOnly,
      buckets,
      notes: [
        'Chỉ tính ca đã hoàn tất và đã được duyệt (PAY-026).',
        'Tiền lương làm tròn theo từng ngày (half-up, 1 VND) giống bảng lương tháng.',
        'Tuần tính từ Thứ Hai đến Chủ nhật theo múi giờ Asia/Ho_Chi_Minh.',
      ],
    };
  }

  private async reportMap(
    workspaceId: string,
    from: string,
    to: string,
    employeeId?: string,
  ): Promise<Map<string, StatsReportLink>> {
    const res = await this.pool.query<{
      id: string;
      employee_id: string;
      report_date: string;
      status: 'draft' | 'submitted';
      notes: string | null;
      total: number;
    }>(
      `SELECT r.id, r.employee_id, r.report_date::text AS report_date, r.status, r.notes,
              COALESCE(SUM(e.reported_count), 0)::int AS total
         FROM daily_reports r
         LEFT JOIN daily_report_entries e ON e.workspace_id = r.workspace_id AND e.report_id = r.id
        WHERE r.workspace_id = $1 AND r.report_date BETWEEN $2::date AND $3::date
          AND ($4::uuid IS NULL OR r.employee_id = $4)
        GROUP BY r.id`,
      [workspaceId, from, to, employeeId ?? null],
    );
    const map = new Map<string, StatsReportLink>();
    for (const r of res.rows)
      map.set(`${r.employee_id}|${r.report_date}`, {
        id: r.id,
        status: r.status,
        total_reported_count: r.total,
        notes: r.notes,
      });
    return map;
  }

  // ----------------------------------------------------------------- export

  async exportYear(
    auth: AuthenticatedContext,
    employeeId: string,
    year: number,
  ): Promise<{ filename: string; buffer: Buffer }> {
    requireRole(['owner'], auth);
    if (!isUuid(employeeId))
      throw new AuthError('VALIDATION_ERROR', 'employee_id không hợp lệ.', 400);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new AuthError('VALIDATION_ERROR', 'Năm không hợp lệ.', 400);
    const ws = auth.workspace.id;
    const emp = (
      await this.pool.query<{ employee_code: string; full_name: string }>(
        'SELECT employee_code, full_name FROM employees WHERE workspace_id=$1 AND id=$2',
        [ws, employeeId],
      )
    ).rows[0];
    if (!emp) throw new AuthError('NOT_FOUND', 'Nhân viên không tồn tại.', 404);
    const yStart = localMs(year, 1, 1, 0);
    const yEnd = localMs(year + 1, 1, 1, 0);
    const shifts = (
      await this.pool.query<{
        clock_in_at: Date;
        clock_out_at: Date;
        breaks_snapshot: {
          started_at: string;
          ended_at: string | null;
          unpaid?: boolean;
        }[];
        worked_seconds: string;
      }>(
        `SELECT v.clock_in_at, v.clock_out_at, v.breaks_snapshot, v.worked_seconds
           FROM attendance_shifts s
           JOIN attendance_shift_versions v ON v.workspace_id = s.workspace_id AND v.id = s.current_version_id
          WHERE s.workspace_id=$1 AND s.employee_id=$2 AND s.run_state='completed'
            AND s.review_state='approved' AND v.clock_in_at >= $3 AND v.clock_in_at < $4
          ORDER BY v.clock_in_at`,
        [ws, employeeId, new Date(yStart), new Date(yEnd)],
      )
    ).rows;
    const rates = (
      await this.pool.query<PayRate>(
        'SELECT hourly_rate_vnd::int AS hourly_rate_vnd, effective_from, effective_to FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2 ORDER BY effective_from',
        [ws, employeeId],
      )
    ).rows;
    const reports = await this.pool.query<{
      report_date: string;
      notes: string | null;
    }>(
      `SELECT report_date::text AS report_date, notes FROM daily_reports
        WHERE workspace_id=$1 AND employee_id=$2 AND report_date BETWEEN $3::date AND $4::date`,
      [ws, employeeId, `${year}-01-01`, `${year}-12-31`],
    );
    const taskByDate = new Map(
      reports.rows.map((r) => [r.report_date, r.notes ?? '']),
    );

    const byMonth = new Map<number, typeof shifts>();
    for (const s of shifts) {
      const m = Number(localDate(s.clock_in_at.getTime()).slice(5, 7));
      (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(s);
    }
    const months: TimesheetMonth[] = [];
    const asOf = Date.now();
    for (const m of [...byMonth.keys()].sort((a, b) => a - b)) {
      const list = byMonth.get(m)!;
      const intervals: PayInterval[] = list.flatMap((s) =>
        subtractBreaks(
          { start: instant(s.clock_in_at), end: instant(s.clock_out_at) },
          s.breaks_snapshot ?? [],
          asOf,
        ),
      );
      let wageByDate = new Map<string, { wage: number; rate: number }>();
      try {
        wageByDate = new Map(
          calculateDays(
            intervals,
            rates,
            `${year}-${String(m).padStart(2, '0')}`,
          ).map((d) => [
            d.work_date,
            { wage: d.rounded_wage_vnd, rate: d.hourly_rate_vnd_snapshot },
          ]),
        );
      } catch {
        // Missing rate: leave wage cells to the sheet formula.
      }
      const monthRate = wageByDate.size
        ? [...wageByDate.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          )[0]![1].rate
        : null;
      const perDay = new Map<string, typeof list>();
      for (const s of list) {
        const d = localDate(s.clock_in_at.getTime());
        (perDay.get(d) ?? perDay.set(d, []).get(d)!).push(s);
      }
      const days: TimesheetDay[] = [];
      for (const [date, ss] of [...perDay.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const first = ss[0]!;
        const last = ss[ss.length - 1]!;
        const startMin = minuteOfDay(first.clock_in_at.getTime());
        const endMin = minuteOfDay(last.clock_out_at.getTime());
        const actual =
          ss.reduce((t, s) => t + Number(s.worked_seconds), 0) / 3600;
        const computed = ((((endMin - startMin) % 1440) + 1440) % 1440) / 60;
        const w = wageByDate.get(date);
        const hoursDiffers = Math.abs(actual - computed) > 1 / 120;
        const rateDiffers =
          w !== undefined && monthRate !== null && w.rate !== monthRate;
        const day: TimesheetDay = {
          day: Number(date.slice(8, 10)),
          start_min: startMin,
          end_min: endMin,
          task: taskByDate.get(date) ?? '',
          bonus: 0,
        };
        if (hoursDiffers) day.hours_override = actual;
        if ((hoursDiffers || rateDiffers) && w) day.wage_override = w.wage;
        if (ss.length > 1) day.note = `Gồm ${ss.length} ca trong ngày`;
        else if (hoursDiffers) day.note = 'Đã trừ giờ nghỉ / qua ngày';
        days.push(day);
      }
      months.push({ month: m, rate: monthRate, days });
    }
    const buffer = buildTimesheetXlsx({
      employee_name: emp.full_name,
      year,
      months,
    });
    return {
      filename: `chamcong-${emp.employee_code.toLowerCase().replace(/[^a-z0-9]/g, '')}-${year}.xlsx`,
      buffer,
    };
  }

  // ----------------------------------------------------------------- import

  async importWorkbook(
    auth: AuthenticatedContext,
    input: TimesheetImportInput,
    requestId: string,
  ): Promise<TimesheetImportResult> {
    requireRole(['owner'], auth);
    if (typeof input.file_base64 !== 'string' || !input.file_base64)
      throw new AuthError('VALIDATION_ERROR', 'Thiếu tệp .xlsx.', 400);
    const buf = Buffer.from(input.file_base64, 'base64');
    if (buf.length === 0 || buf.length > MAX_FILE_BYTES)
      throw new AuthError(
        'VALIDATION_ERROR',
        'Tệp rỗng hoặc lớn hơn 2 MB.',
        413,
      );
    let parsed: ReturnType<typeof parseTimesheetXlsx>;
    try {
      parsed = parseTimesheetXlsx(buf);
    } catch (e) {
      throw new AuthError(
        'VALIDATION_ERROR',
        e instanceof Error ? e.message : 'Không đọc được tệp .xlsx.',
        422,
      );
    }
    const year = input.year ?? parsed.year;
    if (!year || !Number.isInteger(year) || year < 2000 || year > 2100)
      throw new AuthError('VALIDATION_ERROR', 'Cần chọn năm (2000–2100).', 400);
    if (input.employee_id !== undefined && !isUuid(input.employee_id))
      throw new AuthError('VALIDATION_ERROR', 'employee_id không hợp lệ.', 400);
    const newName = (
      input.new_employee_name ??
      parsed.employee_name ??
      ''
    ).trim();
    if (!input.employee_id && !newName)
      throw new AuthError(
        'VALIDATION_ERROR',
        'Cần chọn nhân viên hoặc nhập tên nhân viên mới.',
        400,
      );
    if (newName.length > 120)
      throw new AuthError('VALIDATION_ERROR', 'Tên nhân viên quá dài.', 400);
    if (parsed.months.length === 0)
      throw new AuthError(
        'VALIDATION_ERROR',
        'Không có tab tháng (T1..T12) nào.',
        422,
      );

    const warnings = [...parsed.warnings];
    const commit = input.commit === true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ts_import_${auth.workspace.id}`,
      ]);
      const result = await this.applyImport(
        client,
        auth,
        parsed.months,
        year,
        input.employee_id ?? null,
        newName,
        warnings,
        requestId,
        commit,
      );
      if (commit) await client.query('COMMIT');
      else await client.query('ROLLBACK');
      return { ...result, committed: commit };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async applyImport(
    c: PoolClient,
    auth: AuthenticatedContext,
    parsedMonths: ReturnType<typeof parseTimesheetXlsx>['months'],
    year: number,
    employeeId: string | null,
    newName: string,
    warnings: string[],
    requestId: string,
    commit: boolean,
  ): Promise<Omit<TimesheetImportResult, 'committed'>> {
    const ws = auth.workspace.id;
    // 1. Employee
    let employee: {
      id: string;
      code: string;
      full_name: string;
      created: boolean;
    };
    if (employeeId) {
      const e = (
        await c.query<{ id: string; employee_code: string; full_name: string }>(
          'SELECT id, employee_code, full_name FROM employees WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [ws, employeeId],
        )
      ).rows[0];
      if (!e) throw new AuthError('NOT_FOUND', 'Nhân viên không tồn tại.', 404);
      employee = {
        id: e.id,
        code: e.employee_code,
        full_name: e.full_name,
        created: false,
      };
    } else {
      const same = (
        await c.query<{ id: string; employee_code: string; full_name: string }>(
          'SELECT id, employee_code, full_name FROM employees WHERE workspace_id=$1 AND lower(full_name)=lower($2) ORDER BY created_at LIMIT 2',
          [ws, newName],
        )
      ).rows;
      if (same.length > 1)
        throw new AuthError(
          'CONFLICT',
          'Có nhiều nhân viên trùng tên, hãy chọn nhân viên cụ thể.',
          409,
        );
      if (same.length === 1) {
        const e = same[0]!;
        employee = {
          id: e.id,
          code: e.employee_code,
          full_name: e.full_name,
          created: false,
        };
        warnings.push(`Dùng nhân viên đã có cùng tên: ${e.employee_code}.`);
      } else {
        const max = (
          await c.query<{ n: number }>(
            `SELECT COALESCE(MAX(SUBSTRING(employee_code FROM '^NV([0-9]+)$')::integer), 0) AS n
               FROM employees WHERE workspace_id=$1 AND employee_code ~ '^NV[0-9]+$'`,
            [ws],
          )
        ).rows[0]!.n;
        const code = `NV${String(max + 1).padStart(3, '0')}`;
        const ins = await c.query<{ id: string }>(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, NULL, $2, $3, 'active', true, 1) RETURNING id`,
          [ws, code, newName],
        );
        employee = {
          id: ins.rows[0]!.id,
          code,
          full_name: newName,
          created: true,
        };
        warnings.push(
          'Nhân viên mới chưa có tài khoản đăng nhập; có thể mời tài khoản sau.',
        );
      }
    }
    const owner = (
      await c.query(
        `SELECT 1 FROM workspace_memberships m JOIN employees e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id
          WHERE e.workspace_id=$1 AND e.id=$2 AND m.role='owner'`,
        [ws, employee.id],
      )
    ).rowCount;
    if (owner)
      throw new AuthError(
        'FORBIDDEN',
        'Chủ sở hữu không thuộc diện tính lương (PAY-025).',
        403,
      );

    // 2. Plan shifts
    const now = Date.now();
    const planned: PlannedShift[] = [];
    const skipped = new Map<number, number>();
    const skip = (m: number, why: string) => {
      skipped.set(m, (skipped.get(m) ?? 0) + 1);
      warnings.push(why);
    };
    let ignoredBonus = 0;
    let futureShifts = 0;
    const monthsWithData: { month: number; rate: number | null }[] = [];
    for (const pm of parsedMonths) {
      const dim = daysInMonth(year, pm.month);
      const seen = new Set<number>();
      let any = false;
      for (const d of pm.days) {
        const tag = `T${pm.month} ngày ${d.day}`;
        if (d.bonus > 0) ignoredBonus += d.bonus;
        if (d.day < 1 || d.day > dim) {
          skip(pm.month, `${tag}: ngày không tồn tại trong tháng, bỏ qua.`);
          continue;
        }
        if (seen.has(d.day)) {
          skip(pm.month, `${tag}: bị lặp, bỏ qua.`);
          continue;
        }
        seen.add(d.day);
        if (d.start_min === null && d.end_min === null) continue; // note-only row
        if (d.start_min === null || d.end_min === null) {
          skip(pm.month, `${tag}: thiếu giờ bắt đầu hoặc kết thúc, bỏ qua.`);
          continue;
        }
        if (d.start_min === d.end_min) {
          skip(pm.month, `${tag}: giờ bắt đầu trùng giờ kết thúc, bỏ qua.`);
          continue;
        }
        const dur = (((d.end_min - d.start_min) % 1440) + 1440) % 1440;
        if (d.sheet_hours !== null && Math.abs(d.sheet_hours - dur / 60) > 0.02)
          warnings.push(
            `${tag}: cột SỐ GIỜ (${d.sheet_hours.toFixed(2)}) khác giờ vào/ra (${(dur / 60).toFixed(2)}); hệ thống dùng giờ vào/ra.`,
          );
        const clockIn = localMs(year, pm.month, d.day, d.start_min);
        if (clockIn + dur * 60000 > now) futureShifts++;
        const date = `${year}-${String(pm.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        planned.push({
          month: pm.month,
          date,
          clockIn,
          clockOut: clockIn + dur * 60000,
          task: d.task,
        });
        any = true;
      }
      // task-only rows still produce reports, but rate is needed only with shifts
      if (any) monthsWithData.push({ month: pm.month, rate: pm.rate });
      else
        for (const d of pm.days)
          if (d.start_min === null && d.end_min === null && d.task)
            warnings.push(
              `T${pm.month} ngày ${d.day}: chỉ có công việc, không có giờ — không tạo ca.`,
            );
    }
    if (futureShifts > 0)
      warnings.push(
        `Có ${futureShifts} ca có ngày lớn hơn giờ máy chủ hiện tại — hãy kiểm tra lại năm (${year}) trước khi xác nhận.`,
      );
    if (ignoredBonus > 0) {
      for (const pm of parsedMonths) {
        const periodMonth = `${year}-${String(pm.month).padStart(2, '0')}`;
        for (const d of pm.days) {
          if (
            d.bonus > 0 &&
            d.day >= 1 &&
            d.day <= daysInMonth(year, pm.month)
          ) {
            const bonusDate = `${periodMonth}-${String(d.day).padStart(2, '0')}`;
            const bonusAmt = Math.round(d.bonus);
            if (bonusAmt > 0) {
              try {
                await c.query('SAVEPOINT sp_ts_bonus');
                const bBounds = monthBounds(periodMonth);
                await c.query(
                  `INSERT INTO payroll_periods(workspace_id,period_month,starts_on,ends_on) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,period_month) DO NOTHING`,
                  [ws, periodMonth, bBounds.starts_on, bBounds.ends_on],
                );
                const pRow = (
                  await c.query<{ id: string; status: string }>(
                    'SELECT id, status FROM payroll_periods WHERE workspace_id=$1 AND period_month=$2',
                    [ws, periodMonth],
                  )
                ).rows[0];
                if (pRow && pRow.status !== 'finalized') {
                  const itemRow = (
                    await c.query<{ id: string }>(
                      'INSERT INTO payroll_employee_items(workspace_id,period_id,employee_id,net_pay_vnd) VALUES($1,$2,$3,0) ON CONFLICT(workspace_id,period_id,employee_id) DO UPDATE SET updated_at=clock_timestamp() RETURNING id',
                      [ws, pRow.id, employee.id],
                    )
                  ).rows[0];
                  if (itemRow) {
                    const reasonText =
                      `[THƯỞNG] Thưởng chấm công ngày ${bonusDate}${d.task ? ` - ${d.task}` : ''}`.slice(
                        0,
                        1000,
                      );
                    const dupAdj = await c.query(
                      'SELECT 1 FROM payroll_adjustments WHERE workspace_id=$1 AND payroll_item_id=$2 AND attributable_date=$3 AND amount_vnd=$4 AND reason=$5 LIMIT 1',
                      [ws, itemRow.id, bonusDate, bonusAmt, reasonText],
                    );
                    if (!dupAdj.rowCount) {
                      await c.query(
                        "INSERT INTO payroll_adjustments(workspace_id,payroll_item_id,adjustment_type,attributable_date,amount_vnd,reason,created_by) VALUES($1,$2,'paid_leave',$3,$4,$5,$6)",
                        [
                          ws,
                          itemRow.id,
                          bonusDate,
                          bonusAmt,
                          reasonText,
                          auth.user.id,
                        ],
                      );
                    }
                  }
                }
                await c.query('RELEASE SAVEPOINT sp_ts_bonus');
              } catch {
                await c.query('ROLLBACK TO SAVEPOINT sp_ts_bonus');
              }
            }
          }
        }
      }
      warnings.push(
        `Đã tự động ghi nhận cột THƯỞNG (${ignoredBonus.toLocaleString('vi-VN')} đ) vào mục điều chỉnh thưởng bảng lương.`,
      );
    }

    // 3. Rates
    const existingRates = (
      await c.query<PayRate>(
        'SELECT hourly_rate_vnd::int AS hourly_rate_vnd, effective_from, effective_to FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2 ORDER BY effective_from FOR UPDATE',
        [ws, employee.id],
      )
    ).rows;
    const segments: { rate: number; from: number; to: number | null }[] = [];
    for (const m of monthsWithData) {
      if (m.rate === null || m.rate <= 0) {
        warnings.push(
          `T${m.month}: thiếu đơn giá/giờ (ô B36) — các ca tháng này không được nhập.`,
        );
        continue;
      }
      const from = localMs(year, m.month, 1, 0);
      const last = segments[segments.length - 1];
      if (last && last.rate === m.rate) continue;
      if (last) last.to = from;
      segments.push({ rate: m.rate, from, to: null });
    }
    const overlaps = (a: number, b: number | null, r: PayRate) => {
      const rs = instant(r.effective_from);
      const re = r.effective_to ? instant(r.effective_to) : Infinity;
      return a < re && (b === null ? Infinity : b) > rs;
    };
    let ratesCreated = 0;
    const newRates: PayRate[] = [];
    for (const s of segments) {
      if (existingRates.some((r) => overlaps(s.from, s.to, r))) {
        warnings.push(
          `Đơn giá ${s.rate.toLocaleString('vi-VN')} đ từ ${localDate(s.from)} trùng đơn giá đã có — giữ đơn giá hiện có.`,
        );
        continue;
      }
      await c.query(
        `INSERT INTO employee_hourly_rates (workspace_id, employee_id, hourly_rate_vnd, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          ws,
          employee.id,
          s.rate,
          new Date(s.from),
          s.to === null ? null : new Date(s.to),
          auth.user.id,
        ],
      );
      newRates.push({
        hourly_rate_vnd: s.rate,
        effective_from: new Date(s.from),
        effective_to: s.to === null ? null : new Date(s.to),
      });
      ratesCreated++;
    }
    const allRates = [...existingRates, ...newRates];
    const covered = (a: number, b: number) => {
      let t = a;
      for (const r of [...allRates].sort(
        (x, y) => instant(x.effective_from) - instant(y.effective_from),
      )) {
        const rs = instant(r.effective_from);
        const re = r.effective_to ? instant(r.effective_to) : Infinity;
        if (rs <= t && re > t) t = re;
        if (t >= b) return true;
      }
      return t >= b;
    };

    // 4. Insert shifts, approvals and reports
    const perMonth = new Map<
      number,
      { hours: number; intervals: PayInterval[]; new: number }
    >();
    let reportsCreated = 0;
    for (const p of planned) {
      if (!covered(p.clockIn, p.clockOut)) {
        skip(p.month, `${p.date}: chưa có đơn giá bao phủ ca này, bỏ qua.`);
        continue;
      }
      const ref = `timesheet:${employee.id}:${p.date}`;
      const dup = await c.query(
        `SELECT 1 FROM attendance_shifts
          WHERE workspace_id=$1 AND employee_id=$2
            AND (import_ref=$3 OR tstzrange(clock_in_at, COALESCE(clock_out_at,'infinity'),'[)') && tstzrange($4,$5,'[)'))
          LIMIT 1`,
        [ws, employee.id, ref, new Date(p.clockIn), new Date(p.clockOut)],
      );
      if (dup.rowCount) {
        skip(p.month, `${p.date}: đã có ca chấm công trùng thời gian, bỏ qua.`);
        continue;
      }
      const workedSeconds = Math.round((p.clockOut - p.clockIn) / 1000);
      const shiftId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const hash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            shift_id: shiftId,
            clock_in_at: new Date(p.clockIn).toISOString(),
            clock_out_at: new Date(p.clockOut).toISOString(),
            breaks: [],
            worked_seconds: workedSeconds,
          }),
        )
        .digest('hex');
      await c.query(
        `INSERT INTO attendance_shifts (id, workspace_id, employee_id, clock_in_at, clock_out_at, run_state, review_state, version, source, import_ref)
         VALUES ($1,$2,$3,$4,$5,'completed','approved',3,'import',$6)`,
        [
          shiftId,
          ws,
          employee.id,
          new Date(p.clockIn),
          new Date(p.clockOut),
          ref,
        ],
      );
      await c.query(
        `INSERT INTO attendance_shift_versions (id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at, breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason)
         VALUES ($1,$2,$3,1,$4,$5,'[]'::jsonb,$6,$7,$8,$9)`,
        [
          versionId,
          ws,
          shiftId,
          new Date(p.clockIn),
          new Date(p.clockOut),
          workedSeconds,
          hash,
          auth.user.id,
          IMPORT_SOURCE,
        ],
      );
      await c.query(
        'UPDATE attendance_shifts SET current_version_id=$1 WHERE id=$2 AND workspace_id=$3',
        [versionId, shiftId, ws],
      );
      await c.query(
        `INSERT INTO attendance_approvals (workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason)
         VALUES ($1,$2,$3,$4,'approved',$5)`,
        [ws, shiftId, versionId, auth.user.id, IMPORT_SOURCE],
      );
      const agg = perMonth.get(p.month) ?? { hours: 0, intervals: [], new: 0 };
      agg.hours += workedSeconds / 3600;
      agg.intervals.push({ start: p.clockIn, end: p.clockOut });
      agg.new += 1;
      perMonth.set(p.month, agg);

      if (p.task) {
        const has = await c.query(
          'SELECT 1 FROM daily_reports WHERE workspace_id=$1 AND employee_id=$2 AND report_date=$3::date',
          [ws, employee.id, p.date],
        );
        if (has.rowCount) {
          warnings.push(
            `${p.date}: đã có báo cáo công việc, giữ nguyên báo cáo cũ.`,
          );
        } else {
          const clips = [...p.task.matchAll(/(\d+)\s*clip/gi)].reduce(
            (t, m) => t + Number(m[1]),
            0,
          );
          const entry = {
            work_type: clips > 0 ? 'video_editing' : 'other',
            reported_count: Math.min(clips, 100000),
            notes: p.task.slice(0, 1000),
          };
          const rep = await c.query<{ id: string }>(
            `INSERT INTO daily_reports (workspace_id, employee_id, report_date, status, current_revision, version, notes, submitted_at)
             VALUES ($1,$2,$3::date,'submitted',1,2,$4,$5) RETURNING id`,
            [
              ws,
              employee.id,
              p.date,
              p.task.slice(0, 2000),
              new Date(p.clockOut),
            ],
          );
          const rid = rep.rows[0]!.id;
          await c.query(
            `INSERT INTO daily_report_entries (workspace_id, report_id, work_type, reported_count, notes, sort_order)
             VALUES ($1,$2,$3,$4,$5,0)`,
            [ws, rid, entry.work_type, entry.reported_count, entry.notes],
          );
          await c.query(
            `INSERT INTO daily_report_revisions (workspace_id, report_id, revision_number, status, snapshot, reason, edited_by)
             VALUES ($1,$2,1,'submitted',$3,$4,$5)`,
            [
              ws,
              rid,
              JSON.stringify({
                entries: [entry],
                notes: p.task.slice(0, 2000),
              }),
              IMPORT_SOURCE,
              auth.user.id,
            ],
          );
          reportsCreated++;
        }
      }
    }

    // 5. Summaries
    const months = parsedMonths
      .map((pm) => {
        const agg = perMonth.get(pm.month);
        let wage: number | null = null;
        if (agg) {
          try {
            wage = calculateDays(
              agg.intervals,
              allRates,
              `${year}-${String(pm.month).padStart(2, '0')}`,
            ).reduce((t, d) => t + d.rounded_wage_vnd, 0);
          } catch {
            wage = null;
          }
        }
        return {
          month: `${year}-${String(pm.month).padStart(2, '0')}`,
          shifts_new: agg?.new ?? 0,
          shifts_skipped: skipped.get(pm.month) ?? 0,
          hours: Math.round((agg?.hours ?? 0) * 100) / 100,
          expected_wage_vnd: wage,
          rate_vnd: pm.rate,
        };
      })
      .filter((m) => m.shifts_new > 0 || m.shifts_skipped > 0);
    const rawHours = [...perMonth.values()].reduce((t, a) => t + a.hours, 0);
    const totals = {
      shifts_new: months.reduce((t, m) => t + m.shifts_new, 0),
      shifts_skipped: months.reduce((t, m) => t + m.shifts_skipped, 0),
      hours: Math.round(rawHours * 100) / 100,
      expected_wage_vnd: months.every((m) => m.expected_wage_vnd !== null)
        ? months.reduce((t, m) => t + (m.expected_wage_vnd ?? 0), 0)
        : null,
      rates_created: ratesCreated,
      reports_created: reportsCreated,
    };
    if (commit)
      await recordAuditEvent(c, {
        workspaceId: ws,
        actorUserId: auth.user.id,
        action: 'payroll.timesheet_import',
        entityType: 'employee',
        entityId: employee.id,
        requestId,
        metadata: { year, ...totals, created_employee: employee.created },
      });
    return { year, employee, months, totals, warnings };
  }

  /**
   * Synchronize & reconcile NV001 payroll/attendance directly from Google Sheet
   * (or uploaded xlsx) and optionally remove NV002 from payroll.
   */
  async syncGoogleSheet(
    auth: AuthenticatedContext,
    input: GoogleSheetSyncInput,
    requestId: string,
  ): Promise<GoogleSheetSyncResult> {
    requireRole(['owner'], auth);
    const year = input.year === undefined ? 2026 : Number(input.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new AuthError('VALIDATION_ERROR', 'Năm không hợp lệ.', 400);
    }

    const sheetId = extractGoogleSheetId(input.sheet_url);
    const canonicalSheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=drive_link`;
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=xlsx`;

    let parsedMonths: ReturnType<typeof parseTimesheetXlsx>['months'] = [];
    const warnings: string[] = [];
    let sourceMode: GoogleSheetSyncResult['source_mode'] = 'live_google_sheet';

    if (
      typeof input.file_base64 === 'string' &&
      input.file_base64.trim().length > 0
    ) {
      const b64 = input.file_base64.replace(/^data:[^,]+,/, '').trim();
      const buf = Buffer.from(b64, 'base64');
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Tệp tải lên không đúng định dạng .xlsx.',
          400,
        );
      }
      const parsed = parseTimesheetXlsx(buf);
      parsedMonths = parsed.months;
      warnings.push(...parsed.warnings);
      sourceMode = 'uploaded_file';
    } else {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const resp = await fetch(exportUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: ctrl.signal,
          });
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          const arrBuf = await resp.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
            throw new Error(
              'Google Sheet chưa bật quyền chia sẻ xem (cần "Bất kỳ ai có đường liên kết đều có thể xem").',
            );
          }
          const parsed = parseTimesheetXlsx(buf);
          parsedMonths = parsed.months;
          warnings.push(...parsed.warnings);
          sourceMode = 'live_google_sheet';
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        if (sheetId === DEFAULT_PAYROLL_GOOGLE_SHEET_ID && year === 2026) {
          parsedMonths = CANONICAL_NV001_MONTHS_2026;
          sourceMode = 'canonical_fallback';
          warnings.push(
            'Đã dùng bản chụp chuẩn của Google Sheet (T6–T11/2026) do máy chủ đang ngoại tuyến hoặc không tải trực tiếp được từ Google.',
          );
        } else {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Không tải được Google Sheet (${err instanceof Error ? err.message : 'Lỗi kết nối'}). Hãy kiểm tra quyền chia sẻ "Bất kỳ ai có liên kết đều có thể xem".`,
            422,
          );
        }
      }
    }

    if (parsedMonths.length === 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Không tìm thấy tab tháng (T1..T12) hợp lệ trong Google Sheet.',
        422,
      );
    }

    const commit = input.commit === true;
    const removeNv002 = input.remove_nv002_payroll !== false;
    const preserveNewerWebClockins =
      input.preserve_newer_web_clockins !== false;
    const ws = auth.workspace.id;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ts_gsheet_sync_${ws}`,
      ]);
      await client.query(
        "SELECT set_config('app.allow_rate_sync', 'on', true)",
      );
      await client.query(
        "SELECT set_config('app.allow_payroll_reconcile', 'on', true)",
      );

      // Resolve target employee (NV001 by default)
      let empRow:
        | {
            id: string;
            employee_code: string;
            full_name: string;
            bank_name: string | null;
            bank_account_number: string | null;
          }
        | undefined;

      if (input.employee_id && isUuid(input.employee_id)) {
        empRow = (
          await client.query<{
            id: string;
            employee_code: string;
            full_name: string;
            bank_name: string | null;
            bank_account_number: string | null;
          }>(
            `SELECT id, employee_code, full_name, bank_name, bank_account_number
             FROM employees WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
            [ws, input.employee_id],
          )
        ).rows[0];
      } else {
        empRow = (
          await client.query<{
            id: string;
            employee_code: string;
            full_name: string;
            bank_name: string | null;
            bank_account_number: string | null;
          }>(
            `SELECT e.id, e.employee_code, e.full_name, e.bank_name, e.bank_account_number
             FROM employees e
             WHERE e.workspace_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM workspace_memberships m
                 WHERE m.workspace_id = e.workspace_id AND m.user_id = e.user_id AND m.role = 'owner'
               )
             ORDER BY (e.employee_code = 'NV001') DESC, e.employee_code ASC
             LIMIT 1
             FOR UPDATE`,
            [ws],
          )
        ).rows[0];
      }

      if (!empRow) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy nhân sự NV001 trong hệ thống.',
          404,
        );
      }

      // Compute BEFORE reconciliation
      const beforeReconciliation = await this.reconcileEmployeeWithSheet(
        client,
        ws,
        empRow.id,
        year,
        parsedMonths,
      );

      // Check NV002 status
      const nv002Rows = (
        await client.query<{
          id: string;
          user_id: string | null;
          is_payroll_eligible: boolean;
        }>(
          `SELECT id, user_id, is_payroll_eligible
           FROM employees
           WHERE workspace_id = $1 AND employee_code = 'NV002' AND id <> $2
           FOR UPDATE`,
          [ws, empRow.id],
        )
      ).rows;

      let nv002ShiftsCount = 0;
      for (const nv2 of nv002Rows) {
        const cntRes = await client.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM attendance_shifts WHERE workspace_id = $1 AND employee_id = $2`,
          [ws, nv2.id],
        );
        nv002ShiftsCount += parseInt(cntRes.rows[0]?.cnt ?? '0', 10) || 0;
      }

      const nv002Status = {
        found: nv002Rows.length > 0,
        removed_from_payroll:
          nv002Rows.length === 0 ||
          (commit && removeNv002) ||
          nv002Rows.every(
            (r) => !r.is_payroll_eligible && nv002ShiftsCount === 0,
          ),
        shifts_removed: commit && removeNv002 ? nv002ShiftsCount : 0,
      };

      let afterReconciliation = beforeReconciliation;

      if (commit) {
        // 1. Remove NV002 from payroll if requested
        if (removeNv002 && nv002Rows.length > 0) {
          for (const nv2 of nv002Rows) {
            await client.query(
              `UPDATE employees
               SET is_payroll_eligible = FALSE,
                   employment_status = CASE WHEN user_id IS NULL THEN 'inactive' ELSE employment_status END,
                   updated_at = now()
               WHERE workspace_id = $1 AND id = $2`,
              [ws, nv2.id],
            );

            await client.query(
              `DELETE FROM payroll_adjustments pa
               USING payroll_employee_items pei
               WHERE pa.workspace_id = $1 AND pa.payroll_item_id = pei.id
                 AND pei.workspace_id = $1 AND pei.employee_id = $2
                 AND NOT EXISTS (
                   SELECT 1 FROM payroll_disbursements pd
                   WHERE pd.workspace_id = $1 AND pd.payroll_item_id = pei.id
                 )`,
              [ws, nv2.id],
            );

            await client.query(
              `DELETE FROM payroll_daily_breakdowns pdb
               USING payroll_employee_items pei
               WHERE pdb.workspace_id = $1 AND pdb.payroll_item_id = pei.id
                 AND pei.workspace_id = $1 AND pei.employee_id = $2
                 AND NOT EXISTS (
                   SELECT 1 FROM payroll_disbursements pd
                   WHERE pd.workspace_id = $1 AND pd.payroll_item_id = pei.id
                 )`,
              [ws, nv2.id],
            );

            await client.query(
              `DELETE FROM payroll_employee_items pei
               WHERE pei.workspace_id = $1 AND pei.employee_id = $2
                 AND NOT EXISTS (
                   SELECT 1 FROM payroll_disbursements pd
                   WHERE pd.workspace_id = $1 AND pd.payroll_item_id = pei.id
                 )`,
              [ws, nv2.id],
            );

            await client.query(
              `UPDATE attendance_shifts SET current_version_id = NULL WHERE workspace_id = $1 AND employee_id = $2`,
              [ws, nv2.id],
            );
            for (const childTable of [
              'attendance_approvals',
              'attendance_adjustments',
              'attendance_correction_requests',
              'attendance_breaks',
              'attendance_shift_versions',
            ]) {
              await client.query(
                `DELETE FROM ${childTable}
                 WHERE workspace_id = $1
                   AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = $1 AND employee_id = $2)`,
                [ws, nv2.id],
              );
            }
            await client.query(
              `DELETE FROM attendance_shifts WHERE workspace_id = $1 AND employee_id = $2`,
              [ws, nv2.id],
            );
            await client.query(
              `DELETE FROM daily_report_entries
               WHERE workspace_id = $1
                 AND report_id IN (SELECT id FROM daily_reports WHERE workspace_id = $1 AND employee_id = $2)`,
              [ws, nv2.id],
            );
            await client.query(
              `DELETE FROM daily_report_revisions
               WHERE workspace_id = $1
                 AND report_id IN (SELECT id FROM daily_reports WHERE workspace_id = $1 AND employee_id = $2)`,
              [ws, nv2.id],
            );
            await client.query(
              `DELETE FROM daily_reports WHERE workspace_id = $1 AND employee_id = $2`,
              [ws, nv2.id],
            );
            await client.query(
              `DELETE FROM employee_hourly_rates WHERE workspace_id = $1 AND employee_id = $2`,
              [ws, nv2.id],
            );
          }
        }

        // 2. Ensure NV001 profile & bank info
        if (empRow.employee_code === 'NV001') {
          const updEmp = await client.query<{
            full_name: string;
            bank_name: string | null;
            bank_account_number: string | null;
          }>(
            `UPDATE employees
             SET full_name = 'Nguyễn Huỳnh Thế Vinh',
                 is_payroll_eligible = TRUE,
                 employment_status = 'active',
                 bank_name = COALESCE(NULLIF(btrim(bank_name), ''), 'Vietcombank'),
                 bank_account_number = COALESCE(NULLIF(btrim(bank_account_number), ''), '1031739417'),
                 bank_account_holder = COALESCE(NULLIF(btrim(bank_account_holder), ''), 'NGUYEN HUYNH THE VINH'),
                 updated_at = now()
             WHERE workspace_id = $1 AND id = $2
             RETURNING full_name, bank_name, bank_account_number`,
            [ws, empRow.id],
          );
          if (updEmp.rows[0]) {
            empRow.full_name = updEmp.rows[0].full_name;
            empRow.bank_name = updEmp.rows[0].bank_name;
            empRow.bank_account_number = updEmp.rows[0].bank_account_number;
          }
        }

        // 3. Synchronize hourly rates from worked months (ignoring empty template tabs like T12)
        const workedMonths = parsedMonths
          .filter(
            (m) =>
              m.days.some((d) => d.start_min !== null && d.end_min !== null) &&
              m.rate !== null &&
              m.rate > 0,
          )
          .sort((a, b) => a.month - b.month);

        const rateSegs: { rate: number; from: number; to: number | null }[] =
          [];
        for (const wm of workedMonths) {
          const from = localMs(year, wm.month, 1, 0);
          const last = rateSegs[rateSegs.length - 1];
          if (last && last.rate === wm.rate) continue;
          if (last) last.to = from;
          rateSegs.push({ rate: wm.rate!, from, to: null });
        }

        if (rateSegs.length > 0) {
          await client.query(
            `DELETE FROM employee_hourly_rates WHERE workspace_id = $1 AND employee_id = $2`,
            [ws, empRow.id],
          );
          for (const seg of rateSegs) {
            await client.query(
              `INSERT INTO employee_hourly_rates (workspace_id, employee_id, hourly_rate_vnd, effective_from, effective_to, created_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                ws,
                empRow.id,
                seg.rate,
                new Date(seg.from),
                seg.to === null ? null : new Date(seg.to),
                auth.user.id,
              ],
            );
          }
        }

        // 4. Determine latest date in Excel sheet
        let maxExcelEndOfDayMs = localMs(year + 1, 1, 1, 0);
        if (preserveNewerWebClockins) {
          let maxMs = 0;
          for (const pm of parsedMonths) {
            for (const d of pm.days) {
              if (d.start_min !== null && d.end_min !== null) {
                const dayEndMs = localMs(year, pm.month, d.day + 1, 0);
                if (dayEndMs > maxMs) maxMs = dayEndMs;
              }
            }
          }
          if (maxMs > 0) maxExcelEndOfDayMs = maxMs;
        }

        // 5. Clear existing shifts of target employee in synced range
        const yearStartMs = localMs(year, 1, 1, 0);
        const yearEndMs = localMs(year + 1, 1, 1, 0);
        await client.query(
          `UPDATE attendance_shifts
           SET current_version_id = NULL
           WHERE workspace_id = $1
             AND employee_id = $2
             AND clock_in_at >= $3
             AND clock_in_at < $4
             AND (source = 'import' OR clock_in_at < $5)`,
          [
            ws,
            empRow.id,
            new Date(yearStartMs),
            new Date(yearEndMs),
            new Date(maxExcelEndOfDayMs),
          ],
        );

        for (const childTable of [
          'attendance_approvals',
          'attendance_adjustments',
          'attendance_correction_requests',
          'attendance_breaks',
          'attendance_shift_versions',
        ]) {
          await client.query(
            `DELETE FROM ${childTable}
             WHERE workspace_id = $1
               AND shift_id IN (
                 SELECT id FROM attendance_shifts
                 WHERE workspace_id = $1 AND employee_id = $2 AND current_version_id IS NULL
               )`,
            [ws, empRow.id],
          );
        }
        await client.query(
          `DELETE FROM attendance_shifts
           WHERE workspace_id = $1 AND employee_id = $2 AND current_version_id IS NULL`,
          [ws, empRow.id],
        );

        // 6. Insert exact shifts & daily reports from Google Sheet
        for (const pm of parsedMonths) {
          const dim = daysInMonth(year, pm.month);
          const seenDays = new Set<number>();
          for (const d of pm.days) {
            if (d.day < 1 || d.day > dim || seenDays.has(d.day)) continue;
            seenDays.add(d.day);
            if (
              d.start_min === null ||
              d.end_min === null ||
              d.start_min === d.end_min
            )
              continue;
            const durMin = (((d.end_min - d.start_min) % 1440) + 1440) % 1440;
            const clockInMs = localMs(year, pm.month, d.day, d.start_min);
            const clockOutMs = clockInMs + durMin * 60000;
            const dateStr = `${year}-${String(pm.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
            const workedSeconds = Math.round((clockOutMs - clockInMs) / 1000);
            const shiftId = crypto.randomUUID();
            const versionId = crypto.randomUUID();
            const ref = `timesheet:${empRow.id}:${dateStr}`;
            const hash = crypto
              .createHash('sha256')
              .update(
                JSON.stringify({
                  shift_id: shiftId,
                  clock_in_at: new Date(clockInMs).toISOString(),
                  clock_out_at: new Date(clockOutMs).toISOString(),
                  breaks: [],
                  worked_seconds: workedSeconds,
                }),
              )
              .digest('hex');

            await client.query(
              `INSERT INTO attendance_shifts
                 (id, workspace_id, employee_id, clock_in_at, clock_out_at, run_state, review_state, current_version_id, version, source, import_ref)
               VALUES ($1,$2,$3,$4,$5,'completed','approved',NULL,1,'import',$6)`,
              [
                shiftId,
                ws,
                empRow.id,
                new Date(clockInMs),
                new Date(clockOutMs),
                ref,
              ],
            );
            await client.query(
              `INSERT INTO attendance_shift_versions
                 (id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at, breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason)
               VALUES ($1,$2,$3,1,$4,$5,'[]'::jsonb,$6,$7,$8,$9)`,
              [
                versionId,
                ws,
                shiftId,
                new Date(clockInMs),
                new Date(clockOutMs),
                workedSeconds,
                hash,
                auth.user.id,
                IMPORT_SOURCE,
              ],
            );
            await client.query(
              `UPDATE attendance_shifts SET current_version_id=$1 WHERE id=$2`,
              [versionId, shiftId],
            );
            await client.query(
              `INSERT INTO attendance_approvals
                 (workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason)
               VALUES ($1,$2,$3,$4,'approved',$5)`,
              [ws, shiftId, versionId, auth.user.id, IMPORT_SOURCE],
            );

            if (d.task && d.task.trim().length > 0) {
              const exRep = await client.query<{ id: string }>(
                `SELECT id FROM daily_reports WHERE workspace_id=$1 AND employee_id=$2 AND report_date=$3 LIMIT 1`,
                [ws, empRow.id, dateStr],
              );
              if (!exRep.rowCount) {
                const rid = crypto.randomUUID();
                const clips = [...d.task.matchAll(/(\d+)\s*clip/gi)].reduce(
                  (t, m) => t + Number(m[1]),
                  0,
                );
                const entry = {
                  work_type: clips > 0 ? 'video_editing' : 'other',
                  reported_count: clips,
                  notes: d.task.slice(0, 500),
                  sort_order: 0,
                };
                await client.query(
                  `INSERT INTO daily_reports (id, workspace_id, employee_id, report_date, status, current_revision, version, notes, submitted_at)
                   VALUES ($1,$2,$3,$4,'submitted',1,1,$5,$6)`,
                  [
                    rid,
                    ws,
                    empRow.id,
                    dateStr,
                    d.task.slice(0, 2000),
                    new Date(clockOutMs),
                  ],
                );
                await client.query(
                  `INSERT INTO daily_report_entries (workspace_id, report_id, work_type, reported_count, notes, sort_order)
                   VALUES ($1,$2,$3,$4,$5,0)`,
                  [ws, rid, entry.work_type, entry.reported_count, entry.notes],
                );
                await client.query(
                  `INSERT INTO daily_report_revisions (workspace_id, report_id, revision_number, status, snapshot, reason, edited_by)
                   VALUES ($1,$2,1,'submitted',$3,$4,$5)`,
                  [
                    ws,
                    rid,
                    JSON.stringify({
                      entries: [entry],
                      notes: d.task.slice(0, 2000),
                    }),
                    IMPORT_SOURCE,
                    auth.user.id,
                  ],
                );
              }
            }
          }
        }

        // 7. Re-open any un-disbursed payroll periods in year so /payroll computes fresh
        await client.query(
          `DELETE FROM payroll_daily_breakdowns pdb
           USING payroll_employee_items pei, payroll_periods pp
           WHERE pdb.workspace_id = $1 AND pdb.payroll_item_id = pei.id
             AND pei.workspace_id = $1 AND pei.period_id = pp.id
             AND pp.workspace_id = $1 AND pp.period_month LIKE $2
             AND NOT EXISTS (
               SELECT 1 FROM payroll_disbursements pd
               WHERE pd.workspace_id = $1 AND pd.payroll_item_id = pei.id
             )`,
          [ws, `${year}-%`],
        );
        await client.query(
          `DELETE FROM payroll_employee_items pei
           USING payroll_periods pp
           WHERE pei.workspace_id = $1 AND pei.period_id = pp.id
             AND pp.workspace_id = $1 AND pp.period_month LIKE $2
             AND NOT EXISTS (
               SELECT 1 FROM payroll_disbursements pd
               WHERE pd.workspace_id = $1 AND pd.payroll_item_id = pei.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM payroll_adjustments pa
               WHERE pa.workspace_id = $1 AND pa.payroll_item_id = pei.id
             )`,
          [ws, `${year}-%`],
        );
        await client.query(
          `UPDATE payroll_periods pp
           SET status = 'draft',
               finalized_at = NULL,
               finalized_by = NULL,
               finalized_snapshot_hash = NULL,
               updated_at = now()
           WHERE pp.workspace_id = $1
             AND pp.period_month LIKE $2
             AND pp.status = 'finalized'
             AND NOT EXISTS (
               SELECT 1
               FROM payroll_employee_items pei
               JOIN payroll_disbursements pd ON pd.workspace_id = pei.workspace_id AND pd.payroll_item_id = pei.id
               WHERE pei.workspace_id = $1 AND pei.period_id = pp.id
             )`,
          [ws, `${year}-%`],
        );

        afterReconciliation = await this.reconcileEmployeeWithSheet(
          client,
          ws,
          empRow.id,
          year,
          parsedMonths,
        );

        await recordAuditEvent(client, {
          workspaceId: ws,
          actorUserId: auth.user.id,
          action: 'payroll.google_sheet_sync',
          entityType: 'employee',
          entityId: empRow.id,
          requestId,
          metadata: {
            sheet_id: sheetId,
            year,
            source_mode: sourceMode,
            nv002_removed: nv002Status.removed_from_payroll,
            excel_days: afterReconciliation.totals.excel_days,
            excel_wage_vnd: afterReconciliation.totals.excel_wage_vnd,
          },
        });
      }

      await client.query(
        "SELECT set_config('app.allow_rate_sync', 'off', true)",
      );
      await client.query(
        "SELECT set_config('app.allow_payroll_reconcile', 'off', true)",
      );

      if (commit) await client.query('COMMIT');
      else await client.query('ROLLBACK');

      return {
        committed: commit,
        sheet_id: sheetId,
        sheet_url: canonicalSheetUrl,
        source_mode: sourceMode,
        year,
        employee: {
          id: empRow.id,
          code: empRow.employee_code,
          full_name: empRow.full_name,
          bank_name: empRow.bank_name,
          bank_account_number: empRow.bank_account_number,
        },
        nv002_status: nv002Status,
        before_reconciliation: beforeReconciliation,
        reconciliation: afterReconciliation,
        warnings,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async reconcileEmployeeWithSheet(
    c: PoolClient,
    ws: string,
    employeeId: string,
    year: number,
    parsedMonths: ReturnType<typeof parseTimesheetXlsx>['months'],
  ): Promise<GoogleSheetReconciliationSummary> {
    const yearStartMs = localMs(year, 1, 1, 0);
    const yearEndMs = localMs(year + 1, 1, 1, 0);

    const rates = (
      await c.query<PayRate>(
        `SELECT hourly_rate_vnd::int AS hourly_rate_vnd, effective_from, effective_to
         FROM employee_hourly_rates
         WHERE workspace_id = $1 AND employee_id = $2
         ORDER BY effective_from ASC`,
        [ws, employeeId],
      )
    ).rows;

    const shifts = (
      await c.query<{
        id: string;
        clock_in_at: Date;
        clock_out_at: Date | null;
        breaks_snapshot: {
          started_at: string;
          ended_at: string | null;
          unpaid: boolean;
        }[];
        source: string;
        review_state: string;
        run_state: string;
      }>(
        `SELECT s.id,
                COALESCE(v.clock_in_at, s.clock_in_at) AS clock_in_at,
                COALESCE(v.clock_out_at, s.clock_out_at) AS clock_out_at,
                COALESCE(v.breaks_snapshot, '[]'::jsonb) AS breaks_snapshot,
                COALESCE(s.source, 'clock') AS source,
                s.review_state,
                s.run_state
         FROM attendance_shifts s
         LEFT JOIN attendance_shift_versions v
           ON v.workspace_id = s.workspace_id AND v.shift_id = s.id AND v.id = s.current_version_id
         WHERE s.workspace_id = $1
           AND s.employee_id = $2
           AND s.review_state <> 'rejected'
           AND COALESCE(v.clock_in_at, s.clock_in_at) >= $3
           AND COALESCE(v.clock_in_at, s.clock_in_at) < $4
         ORDER BY COALESCE(v.clock_in_at, s.clock_in_at) ASC`,
        [ws, employeeId, new Date(yearStartMs), new Date(yearEndMs)],
      )
    ).rows;

    // Group system shifts by YYYY-MM-DD
    const sysByDate = new Map<
      string,
      {
        startMin: number;
        endMin: number;
        intervals: PayInterval[];
        sources: Set<string>;
      }
    >();

    for (const sh of shifts) {
      if (!sh.clock_out_at) continue;
      const startMs = instant(sh.clock_in_at);
      const endMs = instant(sh.clock_out_at);
      if (endMs <= startMs) continue;
      const dateStr = localDate(startMs);
      const startMin = minuteOfDay(startMs);
      const endMin = minuteOfDay(endMs);
      const intervals = subtractBreaks(
        { start: startMs, end: endMs },
        sh.breaks_snapshot ?? [],
        endMs,
      );
      const cur = sysByDate.get(dateStr);
      if (!cur) {
        sysByDate.set(dateStr, {
          startMin,
          endMin,
          intervals: [...intervals],
          sources: new Set([sh.source === 'import' ? 'import' : 'clock']),
        });
      } else {
        cur.startMin = Math.min(cur.startMin, startMin);
        cur.endMin = Math.max(cur.endMin, endMin);
        cur.intervals.push(...intervals);
        cur.sources.add(sh.source === 'import' ? 'import' : 'clock');
      }
    }

    // Build Excel map by YYYY-MM-DD and rate per month
    const excelByDate = new Map<
      string,
      {
        month: number;
        rate: number;
        startMin: number;
        endMin: number;
        minutes: number;
        wageVnd: number;
        task: string;
      }
    >();
    const monthRateMap = new Map<number, number>();
    let lastKnownRate = 25000;
    for (const pm of [...parsedMonths].sort((a, b) => a.month - b.month)) {
      if (pm.rate && pm.rate > 0 && pm.days.length > 0) {
        lastKnownRate = pm.rate;
      }
      const rate = pm.rate && pm.rate > 0 ? pm.rate : lastKnownRate;
      monthRateMap.set(pm.month, rate);
      const dim = daysInMonth(year, pm.month);
      const seen = new Set<number>();
      for (const d of pm.days) {
        if (d.day < 1 || d.day > dim || seen.has(d.day)) continue;
        seen.add(d.day);
        if (
          d.start_min === null ||
          d.end_min === null ||
          d.start_min === d.end_min
        )
          continue;
        const durMin = (((d.end_min - d.start_min) % 1440) + 1440) % 1440;
        const dateStr = `${year}-${String(pm.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        const wageVnd = Math.round((durMin * rate) / 60);
        excelByDate.set(dateStr, {
          month: pm.month,
          rate,
          startMin: d.start_min,
          endMin: d.end_min,
          minutes: durMin,
          wageVnd,
          task: d.task ?? '',
        });
      }
    }

    const allDates = new Set<string>([
      ...sysByDate.keys(),
      ...excelByDate.keys(),
    ]);
    const sortedDates = [...allDates].sort();

    const daysOut: GoogleSheetDayReconciliation[] = [];
    const monthsMap = new Map<number, GoogleSheetDayReconciliation[]>();

    for (const dateStr of sortedDates) {
      const m = parseInt(dateStr.slice(5, 7), 10);
      const monthKey = `${year}-${String(m).padStart(2, '0')}`;
      const ex = excelByDate.get(dateStr);
      const sys = sysByDate.get(dateStr);
      const fallbackRate = ex?.rate ?? monthRateMap.get(m) ?? 25000;

      let sysMinutes = 0;
      let sysWage = 0;
      if (sys) {
        const totalSec = sys.intervals.reduce(
          (acc, iv) =>
            acc + Math.max(0, Math.round((iv.end - iv.start) / 1000)),
          0,
        );
        sysMinutes = Math.round(totalSec / 60);
        try {
          const calc = calculateDays(sys.intervals, rates, monthKey);
          sysWage = calc.reduce((acc, d) => acc + d.rounded_wage_vnd, 0);
        } catch {
          sysWage = Math.round((sysMinutes * fallbackRate) / 60);
        }
      }

      const exMinutes = ex ? ex.minutes : 0;
      const exWage = ex ? ex.wageVnd : 0;
      const sysSource: GoogleSheetDayReconciliation['system_source'] = !sys
        ? null
        : sys.sources.size > 1
          ? 'mixed'
          : (sys.sources.values().next().value as 'clock' | 'import');

      let status: GoogleSheetDayReconciliation['status'];
      if (sys && ex) {
        status =
          Math.abs(sysMinutes - exMinutes) <= 1 &&
          sys.startMin === ex.startMin &&
          sys.endMin === ex.endMin
            ? 'matched'
            : 'diff_hours';
      } else if (ex && !sys) {
        status = 'only_excel';
      } else {
        status = 'only_system';
      }

      const row: GoogleSheetDayReconciliation = {
        date: dateStr,
        month: m,
        rate_vnd: fallbackRate,
        system_start: sys ? fmtMinToHHMM(sys.startMin) : null,
        system_end: sys ? fmtMinToHHMM(sys.endMin) : null,
        system_minutes: sysMinutes,
        system_hours: Math.round((sysMinutes / 60) * 100) / 100,
        system_wage_vnd: sysWage,
        system_source: sysSource,
        excel_start: ex ? fmtMinToHHMM(ex.startMin) : null,
        excel_end: ex ? fmtMinToHHMM(ex.endMin) : null,
        excel_minutes: exMinutes,
        excel_hours: Math.round((exMinutes / 60) * 100) / 100,
        excel_wage_vnd: exWage,
        task: ex?.task ?? '',
        diff_minutes: sysMinutes - exMinutes,
        diff_wage_vnd: sysWage - exWage,
        status,
      };

      daysOut.push(row);
      const list = monthsMap.get(m) ?? [];
      list.push(row);
      monthsMap.set(m, list);
    }

    const monthsOut: GoogleSheetMonthReconciliation[] = [];
    for (const m of [...monthsMap.keys()].sort((a, b) => a - b)) {
      const mDays = monthsMap.get(m) ?? [];
      const rate = monthRateMap.get(m) ?? mDays[0]?.rate_vnd ?? 25000;
      const sysDays = mDays.filter((d) => d.system_minutes > 0).length;
      const sysMinutes = mDays.reduce((a, d) => a + d.system_minutes, 0);
      const sysWage = mDays.reduce((a, d) => a + d.system_wage_vnd, 0);
      const exDays = mDays.filter((d) => d.excel_minutes > 0).length;
      const exMinutes = mDays.reduce((a, d) => a + d.excel_minutes, 0);
      const exWage = mDays.reduce((a, d) => a + d.excel_wage_vnd, 0);
      const exFormulaWage = Math.round((exMinutes * rate) / 60);
      const matchedDays = mDays.filter((d) => d.status === 'matched').length;
      const diffHoursDays = mDays.filter(
        (d) => d.status === 'diff_hours',
      ).length;
      const onlyExcelDays = mDays.filter(
        (d) => d.status === 'only_excel',
      ).length;
      const onlySystemDays = mDays.filter(
        (d) => d.status === 'only_system',
      ).length;

      monthsOut.push({
        month: `${year}-${String(m).padStart(2, '0')}`,
        rate_vnd: rate,
        system_days: sysDays,
        system_minutes: sysMinutes,
        system_hours: Math.round((sysMinutes / 60) * 100) / 100,
        system_wage_vnd: sysWage,
        excel_days: exDays,
        excel_minutes: exMinutes,
        excel_hours: Math.round((exMinutes / 60) * 100) / 100,
        excel_wage_vnd: exWage,
        excel_formula_wage_vnd: exFormulaWage,
        diff_days: sysDays - exDays,
        diff_minutes: sysMinutes - exMinutes,
        diff_hours: Math.round(((sysMinutes - exMinutes) / 60) * 100) / 100,
        diff_wage_vnd: sysWage - exWage,
        matched_days: matchedDays,
        diff_hours_days: diffHoursDays,
        only_excel_days: onlyExcelDays,
        only_system_days: onlySystemDays,
        status:
          diffHoursDays === 0 && onlyExcelDays === 0 && onlySystemDays === 0
            ? 'matched'
            : 'mismatch',
      });
    }

    const totalSysMin = monthsOut.reduce((a, m) => a + m.system_minutes, 0);
    const totalExMin = monthsOut.reduce((a, m) => a + m.excel_minutes, 0);
    const totalSysWage = monthsOut.reduce((a, m) => a + m.system_wage_vnd, 0);
    const totalExWage = monthsOut.reduce((a, m) => a + m.excel_wage_vnd, 0);
    const totalExFormulaWage = monthsOut.reduce(
      (a, m) => a + m.excel_formula_wage_vnd,
      0,
    );

    return {
      months: monthsOut,
      days: daysOut,
      totals: {
        system_days: monthsOut.reduce((a, m) => a + m.system_days, 0),
        system_minutes: totalSysMin,
        system_hours: Math.round((totalSysMin / 60) * 100) / 100,
        system_wage_vnd: totalSysWage,
        excel_days: monthsOut.reduce((a, m) => a + m.excel_days, 0),
        excel_minutes: totalExMin,
        excel_hours: Math.round((totalExMin / 60) * 100) / 100,
        excel_wage_vnd: totalExWage,
        excel_formula_wage_vnd: totalExFormulaWage,
        diff_days: monthsOut.reduce((a, m) => a + m.diff_days, 0),
        diff_minutes: totalSysMin - totalExMin,
        diff_hours: Math.round(((totalSysMin - totalExMin) / 60) * 100) / 100,
        diff_wage_vnd: totalSysWage - totalExWage,
        matched_days: monthsOut.reduce((a, m) => a + m.matched_days, 0),
        diff_hours_days: monthsOut.reduce((a, m) => a + m.diff_hours_days, 0),
        only_excel_days: monthsOut.reduce((a, m) => a + m.only_excel_days, 0),
        only_system_days: monthsOut.reduce((a, m) => a + m.only_system_days, 0),
      },
    };
  }
}
