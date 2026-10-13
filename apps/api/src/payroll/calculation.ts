import { AuthError } from '../auth/service.js';

export interface PayRate {
  hourly_rate_vnd: number;
  effective_from: string | Date;
  effective_to: string | Date | null;
}
export interface PayInterval {
  start: number;
  end: number;
}
export interface PayDay {
  work_date: string;
  worked_seconds: number;
  worked_minutes: number;
  shift_count?: number;
  hourly_rate_vnd_snapshot: number;
  raw_wage_vnd: number;
  rounded_wage_vnd: number;
}
const DAY = 86400000;
const OFFSET = 25200000;
export const instant = (v: string | Date): number =>
  Math.floor(new Date(v).getTime() / 1000) * 1000;
export const localDate = (ms: number): string =>
  new Date(ms + OFFSET).toISOString().slice(0, 10);
export function monthBounds(month: string): {
  start: number;
  end: number;
  starts_on: string;
  ends_on: string;
} {
  if (!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(month))
    throw new AuthError('VALIDATION_ERROR', 'Invalid month', 400);
  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y!, m! - 1, 1) - OFFSET;
  const end = Date.UTC(y!, m!, 1) - OFFSET;
  return {
    start,
    end,
    starts_on: localDate(start),
    ends_on: localDate(end - DAY),
  };
}
export function exactMoney(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AuthError(
      'VALIDATION_ERROR',
      'Money exceeds safe integer range',
      422,
    );
  return Number(value);
}
export const halfUp = (numerator: bigint): number =>
  exactMoney((numerator + 1800n) / 3600n);
export function subtractBreaks(
  interval: PayInterval,
  breaks: { started_at: string; ended_at: string | null; unpaid?: boolean }[],
  asOf: number,
): PayInterval[] {
  let out = [interval];
  for (const b of breaks) {
    if (b.unpaid === false) continue;
    const start = instant(b.started_at),
      end = b.ended_at ? instant(b.ended_at) : asOf;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
      throw new AuthError(
        'INVALID_ATTENDANCE_SOURCE',
        'Invalid break interval',
        422,
      );
    out = out.flatMap((i) =>
      end <= i.start || start >= i.end
        ? [i]
        : [
            ...(start > i.start ? [{ start: i.start, end: start }] : []),
            ...(end < i.end ? [{ start: end, end: i.end }] : []),
          ],
    );
  }
  return out;
}
export function calculateDays(
  intervals: PayInterval[],
  rates: PayRate[],
  month: string,
): PayDay[] {
  const bounds = monthBounds(month);
  const days = new Map<
    string,
    { seconds: number; numerator: bigint; rate: number }
  >();
  const rs = rates.map((r) => ({
    start: instant(r.effective_from),
    end: r.effective_to ? instant(r.effective_to) : Infinity,
    rate: r.hourly_rate_vnd,
  }));
  for (const i of intervals) {
    let start = Math.max(i.start, bounds.start);
    const end = Math.min(i.end, bounds.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || i.end < i.start)
      throw new AuthError(
        'INVALID_ATTENDANCE_SOURCE',
        'Invalid work interval',
        422,
      );
    while (start < end) {
      const nextDay = Math.floor((start + OFFSET) / DAY) * DAY + DAY - OFFSET;
      let stop = Math.min(end, nextDay);
      for (const r of rs)
        for (const t of [r.start, r.end]) if (t > start && t < stop) stop = t;
      const matching = rs.filter((r) => r.start <= start && r.end >= stop);
      if (matching.length !== 1)
        throw new AuthError(
          'MISSING_HOURLY_RATE',
          'Missing or overlapping hourly rate',
          422,
          [
            {
              field: 'interval',
              message:
                new Date(start).toISOString() +
                ' / ' +
                new Date(stop).toISOString(),
            },
          ],
        );
      const rate = matching[0]!.rate;
      if (!Number.isSafeInteger(rate) || rate < 0)
        throw new AuthError('VALIDATION_ERROR', 'Invalid hourly rate', 422);
      const seconds = (stop - start) / 1000;
      const date = localDate(start);
      const day = days.get(date) ?? { seconds: 0, numerator: 0n, rate };
      day.seconds += seconds;
      day.numerator += BigInt(seconds) * BigInt(rate);
      day.rate = rate;
      days.set(date, day);
      start = stop;
    }
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      work_date: date,
      worked_seconds: d.seconds,
      worked_minutes: Math.floor(d.seconds / 60),
      hourly_rate_vnd_snapshot: d.rate,
      raw_wage_vnd: Number((d.numerator * 10000n + 1800n) / 3600n) / 10000,
      rounded_wage_vnd: halfUp(d.numerator),
    }));
}
