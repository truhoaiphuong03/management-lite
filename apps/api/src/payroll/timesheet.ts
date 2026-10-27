/**
 * Timesheet workbook layout (same as the Owner's Google Sheet):
 * one tab per month "T<m>", rows 4..34 = day 1..31, B36 = hourly rate,
 * rows 39..42 = month summary.
 */
import { buildXlsx, readXlsx, type XCell, type XSheet } from './xlsx.js';

export interface TimesheetDay {
  day: number;
  start_min: number | null;
  end_min: number | null;
  task: string;
  bonus: number;
  /** Set when the system value differs from what the formula would compute. */
  hours_override?: number;
  wage_override?: number;
  note?: string;
}
export interface TimesheetMonth {
  month: number;
  rate: number | null;
  days: TimesheetDay[];
}

const FIRST_ROW = 4;
const LAST_ROW = 34;
const RATE_ROW = 36;
const DAY_FRACTION = 1440;

export function buildTimesheetXlsx(args: {
  employee_name: string;
  year: number;
  months: TimesheetMonth[];
}): Buffer {
  const sheets: XSheet[] = args.months.map((m) => {
    const rows: (XCell | null)[][] = [];
    const set = (r: number, c: number, cell: XCell) => {
      (rows[r - 1] ??= [])[c] = cell;
    };
    set(1, 0, { v: `THÁNG ${m.month}`, style: 'bold' });
    [
      'NGÀY',
      'GIỜ BẮT ĐẦU',
      'GIỜ KẾT THÚC',
      'SỐ GIỜ',
      'CÔNG VIỆC LÀM TRONG BUỔI',
      'THƯỞNG',
      'LƯƠNG',
      'GHI CHÚ',
    ].forEach((h, i) => set(2, i, { v: h, style: 'bold' }));
    [
      'Nhập số',
      'HH:MM',
      'HH:MM',
      'Nhập số',
      'Văn bản',
      'Nhập số',
      'Nhập số',
      'Văn bản',
    ].forEach((h, i) => set(3, i, { v: h }));
    let hours = 0;
    let wages = 0;
    let bonus = 0;
    let workedDays = 0;
    for (let d = 1; d <= 31; d++) {
      const r = FIRST_ROW + d - 1;
      set(r, 0, { v: d });
      const e = m.days.find((x) => x.day === d);
      if (!e || e.start_min === null || e.end_min === null) {
        set(r, 3, {
          f: `IF(OR(ISBLANK(B${r}), ISBLANK(C${r})), "", MOD(C${r}-B${r}, 1)*24)`,
          v: '',
        });
        set(r, 6, {
          f: `IF(D${r}="", "", D${r}*$B$${RATE_ROW}+IF(ISBLANK(F${r}),0,F${r}))`,
          v: '',
        });
        continue;
      }
      workedDays++;
      set(r, 1, { v: e.start_min / DAY_FRACTION, style: 'time' });
      set(r, 2, { v: e.end_min / DAY_FRACTION, style: 'time' });
      const computed =
        ((((e.end_min - e.start_min) % DAY_FRACTION) + DAY_FRACTION) %
          DAY_FRACTION) /
        60;
      const h = e.hours_override ?? computed;
      hours += h;
      if (e.hours_override !== undefined)
        set(r, 3, { v: Math.round(h * 1e6) / 1e6, style: 'num2' });
      else
        set(r, 3, {
          f: `IF(OR(ISBLANK(B${r}), ISBLANK(C${r})), "", MOD(C${r}-B${r}, 1)*24)`,
          v: Math.round(h * 1e6) / 1e6,
          style: 'num2',
        });
      if (e.task) set(r, 4, { v: e.task });
      if (e.bonus) {
        set(r, 5, { v: e.bonus, style: 'money' });
        bonus += e.bonus;
      }
      const w =
        e.wage_override ?? Math.round(h * (m.rate ?? 0) * 100) / 100 + e.bonus;
      wages += w;
      if (e.wage_override !== undefined) set(r, 6, { v: w, style: 'money' });
      else
        set(r, 6, {
          f: `IF(D${r}="", "", D${r}*$B$${RATE_ROW}+IF(ISBLANK(F${r}),0,F${r}))`,
          v: w,
          style: 'money',
        });
      if (e.note) set(r, 7, { v: e.note });
    }
    set(RATE_ROW, 0, { v: 'Lương/Giờ', style: 'bold' });
    if (m.rate !== null) set(RATE_ROW, 1, { v: m.rate, style: 'money' });
    set(38, 0, { v: 'TỔNG KẾT THÁNG', style: 'bold' });
    set(39, 0, { v: 'Tổng giờ làm' });
    set(39, 1, {
      f: `SUM(D${FIRST_ROW}:D${LAST_ROW})`,
      v: hours,
      style: 'num2',
    });
    set(40, 0, { v: 'Tổng ngày công' });
    set(40, 1, {
      f: `COUNTIFS(B${FIRST_ROW}:B${LAST_ROW}, "<>", C${FIRST_ROW}:C${LAST_ROW}, "<>")`,
      v: workedDays,
    });
    set(41, 0, { v: 'Tổng thưởng' });
    set(41, 1, {
      f: `SUM(F${FIRST_ROW}:F${LAST_ROW})`,
      v: bonus,
      style: 'money',
    });
    set(42, 0, { v: 'Tổng lương' });
    set(42, 1, {
      f: `SUM(G${FIRST_ROW}:G${LAST_ROW})`,
      v: wages,
      style: 'money',
    });
    set(44, 0, { v: 'Năm:' });
    set(44, 1, { v: args.year });
    set(45, 0, { v: 'Nhân viên:' });
    set(45, 1, { v: args.employee_name });
    return {
      name: `T${m.month}`,
      rows,
      colWidths: [18, 14, 14, 10, 60, 12, 14, 24],
    };
  });
  if (sheets.length === 0)
    sheets.push({
      name: 'Trống',
      rows: [[{ v: 'Chưa có dữ liệu chấm công đã duyệt trong năm này.' }]],
    });
  return buildXlsx(sheets);
}

export interface ParsedDay {
  day: number;
  start_min: number | null;
  end_min: number | null;
  task: string;
  bonus: number;
  /** Hours written in the sheet (for cross-checking only). */
  sheet_hours: number | null;
}
export interface ParsedMonth {
  month: number;
  rate: number | null;
  days: ParsedDay[];
}

function minutesOf(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === 'number') {
    if (v < 0) return null;
    return Math.round((v % 1) * DAY_FRACTION) % DAY_FRACTION;
  }
  const m = /^\s*(\d{1,2})\s*[:h]\s*(\d{1,2})\s*$/i.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function parseTimesheetXlsx(buf: Buffer): {
  employee_name: string | null;
  year: number | null;
  months: ParsedMonth[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const months: ParsedMonth[] = [];
  let employeeName: string | null = null;
  let year: number | null = null;
  for (const sheet of readXlsx(buf)) {
    const mm = /^T\s*(\d{1,2})$/i.exec(sheet.name.trim());
    const month = mm ? Number(mm[1]) : 0;
    if (month < 1 || month > 12) {
      warnings.push(`Bỏ qua tab "${sheet.name}" (không đúng dạng T1..T12).`);
      continue;
    }
    if (months.some((x) => x.month === month)) {
      warnings.push(`Tab T${month} bị trùng, chỉ đọc tab đầu tiên.`);
      continue;
    }
    const num = (ref: string): number | null => {
      const v = sheet.cells.get(ref);
      return typeof v === 'number' ? v : null;
    };
    const rate = num(`B${RATE_ROW}`);
    const nameCell = sheet.cells.get('B45');
    if (typeof nameCell === 'string' && nameCell.trim() && !employeeName)
      employeeName = nameCell.trim();
    const yearCell = num('B44');
    if (yearCell !== null && Number.isInteger(yearCell) && !year)
      year = yearCell;
    const days: ParsedDay[] = [];
    for (let r = FIRST_ROW; r <= LAST_ROW; r++) {
      const dv = num(`A${r}`);
      if (dv === null || !Number.isInteger(dv)) continue;
      const startRaw = sheet.cells.get(`B${r}`);
      const endRaw = sheet.cells.get(`C${r}`);
      const taskRaw = sheet.cells.get(`E${r}`);
      const bonus = num(`F${r}`) ?? 0;
      if (startRaw === undefined && endRaw === undefined && !taskRaw && !bonus)
        continue;
      days.push({
        day: dv,
        start_min: minutesOf(startRaw),
        end_min: minutesOf(endRaw),
        task: typeof taskRaw === 'string' ? taskRaw.trim() : '',
        bonus: Number.isFinite(bonus) ? Math.round(bonus) : 0,
        sheet_hours: num(`D${r}`),
      });
    }
    months.push({ month, rate: rate !== null ? Math.round(rate) : null, days });
  }
  months.sort((a, b) => a.month - b.month);
  return { employee_name: employeeName, year, months, warnings };
}
