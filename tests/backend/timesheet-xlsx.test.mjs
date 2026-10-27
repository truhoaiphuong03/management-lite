import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildXlsx,
  readXlsx,
  zipFiles,
  unzipFiles,
} from '../../dist/apps/api/src/payroll/xlsx.js';
import {
  buildTimesheetXlsx,
  parseTimesheetXlsx,
} from '../../dist/apps/api/src/payroll/timesheet.js';
import {
  aggregateStats,
  bucketOf,
} from '../../dist/apps/api/src/payroll/stats.js';

test('zip writer and reader round-trip', () => {
  const zip = zipFiles([
    { name: 'a.txt', data: Buffer.from('xin chào '.repeat(50)) },
    { name: 'dir/b.txt', data: Buffer.from('b') },
  ]);
  const files = unzipFiles(zip);
  assert.equal(files.get('a.txt').toString(), 'xin chào '.repeat(50));
  assert.equal(files.get('dir/b.txt').toString(), 'b');
  assert.throws(() => unzipFiles(Buffer.from('not a zip file at all....')));
});

test('xlsx cells keep text, numbers and escaping', () => {
  const sheets = readXlsx(
    buildXlsx([
      {
        name: 'T6',
        rows: [[{ v: 'a<b>&"c' }, { v: 12.5 }, { f: 'A1', v: 'x' }]],
      },
    ]),
  );
  assert.equal(sheets[0].name, 'T6');
  assert.equal(sheets[0].cells.get('A1'), 'a<b>&"c');
  assert.equal(sheets[0].cells.get('B1'), 12.5);
});

test('timesheet export layout can be re-imported unchanged', () => {
  const buf = buildTimesheetXlsx({
    employee_name: 'Nguyễn Văn A',
    year: 2026,
    months: [
      {
        month: 6,
        rate: 20000,
        days: [
          {
            day: 1,
            start_min: 540,
            end_min: 720,
            task: '8 clip LSK',
            bonus: 0,
          },
          { day: 2, start_min: 1320, end_min: 120, task: '', bonus: 5000 },
        ],
      },
      {
        month: 7,
        rate: 25000,
        days: [{ day: 3, start_min: 600, end_min: 660, task: '', bonus: 0 }],
      },
    ],
  });
  const p = parseTimesheetXlsx(buf);
  assert.equal(p.employee_name, 'Nguyễn Văn A');
  assert.equal(p.year, 2026);
  assert.deepEqual(
    p.months.map((m) => [m.month, m.rate, m.days.length]),
    [
      [6, 20000, 2],
      [7, 25000, 1],
    ],
  );
  const d1 = p.months[0].days[0];
  assert.deepEqual(
    [d1.day, d1.start_min, d1.end_min, d1.task],
    [1, 540, 720, '8 clip LSK'],
  );
  assert.equal(d1.sheet_hours, 3);
  const d2 = p.months[0].days[1];
  assert.equal(d2.end_min, 120);
  assert.equal(d2.sheet_hours, 4); // overnight 22:00 -> 02:00
  assert.equal(d2.bonus, 5000);
});

test('stats buckets: day, ISO week (Mon-Sun), month, year', () => {
  assert.equal(bucketOf('2026-10-25', 'week').key, '2026-10-19'); // Sunday
  assert.equal(bucketOf('2026-10-26', 'week').key, '2026-10-26'); // Monday
  assert.equal(bucketOf('2026-02-10', 'month').to, '2026-02-28');
  const row = (d, sec, wage, report) => ({
    employee_id: 'e1',
    employee_code: 'NV001',
    employee_name: 'A',
    work_date: d,
    worked_seconds: sec,
    shift_count: 1,
    wage_vnd: wage,
    hourly_rate_vnd: 25000,
    report,
  });
  const rep = {
    id: 'r',
    status: 'submitted',
    total_reported_count: 8,
    notes: 'x',
  };
  const rows = [
    row('2026-10-19', 3600, 25000, rep),
    row('2026-10-25', 7200, 50000, null),
    row('2026-10-26', 3600, 25000, rep),
  ];
  const week = aggregateStats(rows, 'week');
  assert.equal(week.length, 2);
  assert.equal(week[0].wage_vnd, 75000);
  assert.equal(week[0].missing_report_days, 1);
  assert.equal(week[0].reported_clips, 8);
  const month = aggregateStats(rows, 'month');
  assert.equal(month[0].worked_hours, 4);
  assert.equal(month[0].wage_vnd, 100000);
  assert.equal(aggregateStats(rows, 'year')[0].work_days, 3);
  assert.equal(aggregateStats(rows, 'day')[0].days.length, 1);
});
