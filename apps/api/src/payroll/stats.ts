/**
 * Pure aggregation of approved payroll days into day / week / month / year buckets.
 * Weeks run Monday..Sunday on the workspace-local calendar (PAY-021).
 */
export type Granularity = 'day' | 'week' | 'month' | 'year';
export const GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'year'];

export interface StatsReportLink {
  id: string;
  status: 'draft' | 'submitted';
  total_reported_count: number;
  notes: string | null;
}
export interface StatsDayRow {
  employee_id: string;
  employee_name: string;
  employee_code: string;
  work_date: string; // YYYY-MM-DD
  worked_seconds: number;
  shift_count: number;
  wage_vnd: number;
  hourly_rate_vnd: number;
  report: StatsReportLink | null;
}
export interface StatsEmployeeTotal {
  employee_id: string;
  employee_name: string;
  employee_code: string;
  worked_seconds: number;
  wage_vnd: number;
  work_days: number;
  report_days: number;
}
export interface StatsBucket {
  key: string;
  label: string;
  from: string;
  to: string;
  worked_seconds: number;
  worked_hours: number;
  work_days: number;
  shift_count: number;
  wage_vnd: number;
  report_days: number;
  reported_clips: number;
  missing_report_days: number;
  employees: StatsEmployeeTotal[];
  days?: StatsDayRow[];
}

const DAY_MS = 86400000;
const toMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dmy = (d: string): string =>
  `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dm = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function bucketOf(
  date: string,
  g: Granularity,
): { key: string; from: string; to: string; label: string } {
  if (g === 'day') return { key: date, from: date, to: date, label: dmy(date) };
  if (g === 'week') {
    const ms = toMs(date);
    const dow = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
    const from = toDate(ms - dow * DAY_MS);
    const to = toDate(ms - dow * DAY_MS + 6 * DAY_MS);
    return { key: from, from, to, label: `Tuần ${dm(from)} – ${dmy(to)}` };
  }
  if (g === 'month') {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const from = `${date.slice(0, 7)}-01`;
    const to = toDate(Date.UTC(y, m, 1) - DAY_MS);
    return { key: date.slice(0, 7), from, to, label: `Tháng ${m}/${y}` };
  }
  const y = date.slice(0, 4);
  return { key: y, from: `${y}-01-01`, to: `${y}-12-31`, label: `Năm ${y}` };
}

export function aggregateStats(
  rows: StatsDayRow[],
  g: Granularity,
): StatsBucket[] {
  const map = new Map<string, StatsBucket>();
  const seenDay = new Map<string, Set<string>>();
  for (const r of rows) {
    const b = bucketOf(r.work_date, g);
    let bucket = map.get(b.key);
    if (!bucket) {
      bucket = {
        key: b.key,
        label: b.label,
        from: b.from,
        to: b.to,
        worked_seconds: 0,
        worked_hours: 0,
        work_days: 0,
        shift_count: 0,
        wage_vnd: 0,
        report_days: 0,
        reported_clips: 0,
        missing_report_days: 0,
        employees: [],
      };
      if (g === 'day') bucket.days = [];
      map.set(b.key, bucket);
      seenDay.set(b.key, new Set());
    }
    bucket.worked_seconds += r.worked_seconds;
    bucket.shift_count += r.shift_count;
    bucket.wage_vnd += r.wage_vnd;
    const dayId = `${r.employee_id}|${r.work_date}`;
    if (!seenDay.get(b.key)!.has(dayId)) {
      seenDay.get(b.key)!.add(dayId);
      bucket.work_days += 1;
      if (r.report) {
        bucket.report_days += 1;
        bucket.reported_clips += r.report.total_reported_count;
      } else bucket.missing_report_days += 1;
    }
    let emp = bucket.employees.find((e) => e.employee_id === r.employee_id);
    if (!emp) {
      emp = {
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        employee_code: r.employee_code,
        worked_seconds: 0,
        wage_vnd: 0,
        work_days: 0,
        report_days: 0,
      };
      bucket.employees.push(emp);
    }
    emp.worked_seconds += r.worked_seconds;
    emp.wage_vnd += r.wage_vnd;
    emp.work_days += 1;
    if (r.report) emp.report_days += 1;
    bucket.days?.push(r);
  }
  const out = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const b of out) {
    b.worked_hours = Math.round((b.worked_seconds / 3600) * 100) / 100;
    b.employees.sort((x, y) => y.wage_vnd - x.wage_vnd);
  }
  return out;
}

/** Grand total across buckets. Buckets partition the days, so every figure is additive. */
export function sumBuckets(
  buckets: StatsBucket[],
): Omit<StatsBucket, 'key' | 'label' | 'from' | 'to' | 'days'> {
  const total: Omit<StatsBucket, 'key' | 'label' | 'from' | 'to' | 'days'> = {
    worked_seconds: 0,
    worked_hours: 0,
    work_days: 0,
    shift_count: 0,
    wage_vnd: 0,
    report_days: 0,
    reported_clips: 0,
    missing_report_days: 0,
    employees: [],
  };
  const emps = new Map<string, StatsEmployeeTotal>();
  for (const b of buckets) {
    total.worked_seconds += b.worked_seconds;
    total.work_days += b.work_days;
    total.shift_count += b.shift_count;
    total.wage_vnd += b.wage_vnd;
    total.report_days += b.report_days;
    total.reported_clips += b.reported_clips;
    total.missing_report_days += b.missing_report_days;
    for (const e of b.employees) {
      const cur = emps.get(e.employee_id) ?? {
        ...e,
        worked_seconds: 0,
        wage_vnd: 0,
        work_days: 0,
        report_days: 0,
      };
      cur.worked_seconds += e.worked_seconds;
      cur.wage_vnd += e.wage_vnd;
      cur.work_days += e.work_days;
      cur.report_days += e.report_days;
      emps.set(e.employee_id, cur);
    }
  }
  total.worked_hours = Math.round((total.worked_seconds / 3600) * 100) / 100;
  total.employees = [...emps.values()].sort((x, y) => y.wage_vnd - x.wage_vnd);
  return total;
}
