// FIN time rules: fixed Asia/Ho_Chi_Minh (UTC+7, no DST). Pure functions, no I/O.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function vnParts(d: Date) {
  const s = new Date(d.getTime() + VN_OFFSET_MS);
  return {
    y: s.getUTCFullYear(),
    mo: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    h: s.getUTCHours(),
    mi: s.getUTCMinutes(),
  };
}
export function vnDate(d: Date): string {
  const p = vnParts(d);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}
/** Value for <input type="datetime-local"> in VN time, minute precision. */
export function vnDateTimeLocal(d: Date): string {
  const p = vnParts(d);
  return `${vnDate(d)}T${pad(p.h)}:${pad(p.mi)}`;
}
/** Parse "YYYY-MM-DDTHH:mm" as VN local time; null when malformed or non-existent. */
export function parseVnLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m || m[1] === '0000') return null;
  const [y, mo, da, h, mi] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const utc = Date.UTC(y, mo - 1, da, h, mi) - VN_OFFSET_MS;
  const d = new Date(utc);
  return vnDateTimeLocal(d) === value ? d : null;
}
export type EntryTime =
  | {
      ok: true;
      mode: 'auto' | 'manual';
      occurred_on: string;
      /** ISO-8601 with +07:00; the exact instant the entry is recorded for. */
      occurred_at: string;
    }
  | { ok: false; error: 'invalid' | 'future' };
function iso(d: Date): string {
  const p = vnParts(d);
  return `${vnDate(d)}T${pad(p.h)}:${pad(p.mi)}:00+07:00`;
}
/**
 * Auto: use `now` (VN). Manual: validate the Owner's local value; the future is rejected.
 * Callers must freeze the result in the pending operation so retries never change it.
 */
export function resolveEntryTime(input: {
  auto: boolean;
  manualLocal: string;
  now: Date;
}): EntryTime {
  if (input.auto)
    return {
      ok: true,
      mode: 'auto',
      occurred_on: vnDate(input.now),
      occurred_at: iso(input.now),
    };
  const d = parseVnLocal(input.manualLocal);
  if (!d) return { ok: false, error: 'invalid' };
  if (d.getTime() > input.now.getTime()) return { ok: false, error: 'future' };
  return {
    ok: true,
    mode: 'manual',
    occurred_on: vnDate(d),
    occurred_at: iso(d),
  };
}
