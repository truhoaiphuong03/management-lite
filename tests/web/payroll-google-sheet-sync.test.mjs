import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  CANONICAL_NV001_MONTHS_2026,
  DEFAULT_PAYROLL_GOOGLE_SHEET_ID,
  DEFAULT_PAYROLL_GOOGLE_SHEET_URL,
  extractGoogleSheetId,
} from '../../dist/apps/api/src/payroll/timesheet-service.js';

const computeHoursPayVnd = (minutes, rateVnd) =>
  Math.round((minutes * rateVnd) / 60);

test('PAY-GSHEET-SYNC-0912: extractGoogleSheetId parses Google Sheet URLs and defaults to canonical sheet', () => {
  assert.equal(
    DEFAULT_PAYROLL_GOOGLE_SHEET_ID,
    '11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw',
  );
  assert.equal(
    extractGoogleSheetId(DEFAULT_PAYROLL_GOOGLE_SHEET_URL),
    '11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw',
  );
  assert.equal(
    extractGoogleSheetId('11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw'),
    '11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw',
  );
  assert.equal(
    extractGoogleSheetId(''),
    '11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw',
  );
});

test('PAY-GSHEET-SYNC-0912: CANONICAL_NV001_MONTHS_2026 matches Excel/Google Sheet T6..T11 including T10 fix (535.417 đ)', () => {
  assert.equal(CANONICAL_NV001_MONTHS_2026.length, 6);

  const summaryByMonth = new Map();
  let totalDays = 0;
  let totalMinutes = 0;
  let totalPayVnd = 0;

  for (const m of CANONICAL_NV001_MONTHS_2026) {
    let mMin = 0;
    let mPay = 0;
    for (const d of m.days) {
      const mins = d.end_min - d.start_min;
      mMin += mins;
      mPay += computeHoursPayVnd(mins, m.rate);
    }
    totalDays += m.days.length;
    totalMinutes += mMin;
    totalPayVnd += mPay;
    summaryByMonth.set(m.month, {
      daysCount: m.days.length,
      minutes: mMin,
      hours: Math.round((mMin / 60) * 100) / 100,
      rateVnd: m.rate,
      payVnd: mPay,
    });
  }

  // T6: 14 days, 3430 mins (57.17h), 20,000 VND/h -> 1,143,333 VND
  assert.deepEqual(summaryByMonth.get(6), {
    daysCount: 14,
    minutes: 3430,
    hours: 57.17,
    rateVnd: 20000,
    payVnd: 1143333,
  });

  // T7: 10 days, 2060 mins (34.33h), 25,000 VND/h -> 858,334 VND
  assert.deepEqual(summaryByMonth.get(7), {
    daysCount: 10,
    minutes: 2060,
    hours: 34.33,
    rateVnd: 25000,
    payVnd: 858334,
  });

  // T8: 11 days, 1852 mins (30.87h), 25,000 VND/h -> 771,668 VND
  assert.deepEqual(summaryByMonth.get(8), {
    daysCount: 11,
    minutes: 1852,
    hours: 30.87,
    rateVnd: 25000,
    payVnd: 771668,
  });

  // T9: 13 days, 1995 mins (33.25h), 25,000 VND/h -> 831,250 VND
  assert.deepEqual(summaryByMonth.get(9), {
    daysCount: 13,
    minutes: 1995,
    hours: 33.25,
    rateVnd: 25000,
    payVnd: 831250,
  });

  // T10 (FIXED): 9 days (05, 13, 14, 15, 21, 27, 28, 29, 30/10), 1285 mins (21.42h), 25,000 VND/h -> 535,417 VND
  assert.deepEqual(summaryByMonth.get(10), {
    daysCount: 9,
    minutes: 1285,
    hours: 21.42,
    rateVnd: 25000,
    payVnd: 535417,
  });
  const octDays = CANONICAL_NV001_MONTHS_2026.find(
    (m) => m.month === 10,
  ).days.map((d) => d.day);
  assert.deepEqual(octDays, [5, 13, 14, 15, 21, 27, 28, 29, 30]);

  // T11: 4 days (03, 04, 05, 06/11), 690 mins (11.50h), 25,000 VND/h -> 287,500 VND
  assert.deepEqual(summaryByMonth.get(11), {
    daysCount: 4,
    minutes: 690,
    hours: 11.5,
    rateVnd: 25000,
    payVnd: 287500,
  });

  // Grand total across T6..T11: 61 days, 11312 mins (188.53h), 4,427,502 VND
  assert.equal(totalDays, 61);
  assert.equal(totalMinutes, 11312);
  assert.equal(totalPayVnd, 4427502);
});

test('PAY-GSHEET-SYNC-0912: PayrollStatsScreen and PayrollScreen expose Google Sheet sync & System-vs-Excel reconciliation UI', () => {
  const statsSrc = readFileSync(
    resolve('apps/web/src/screens/PayrollStatsScreen.tsx'),
    'utf8',
  );
  assert.match(statsSrc, /data-testid="google-sheet-sync-card"/);
  assert.match(statsSrc, /data-testid="google-sheet-url-input"/);
  assert.match(statsSrc, /data-testid="btn-reconcile-google-sheet"/);
  assert.match(statsSrc, /data-testid="btn-sync-google-sheet"/);
  assert.match(
    statsSrc,
    /1\. Bảng tổng hợp đối chiếu theo tháng \(Hệ thống ↔ File Excel\)/,
  );
  assert.match(
    statsSrc,
    /2\. Đối chiếu chi tiết từng ngày chấm công \(Web ↔ Excel\)/,
  );
  assert.match(
    statsSrc,
    /\/api\/v1\/payroll-tools\/timesheet\/sync-google-sheet/,
  );

  const payrollSrc = readFileSync(
    resolve('apps/web/src/screens/PayrollScreen.tsx'),
    'utf8',
  );
  assert.match(payrollSrc, /data-testid="btn-payroll-sync-gsheet"/);
  assert.match(payrollSrc, /Đồng bộ Google Sheet/);
  assert.match(payrollSrc, /data-testid="payroll-month-select"/);
  assert.match(payrollSrc, /data-testid="payroll-quick-months"/);
  assert.ok(
    !payrollSrc.includes('type="month"'),
    'PayrollScreen must use <select> month dropdown instead of native <input type="month">',
  );

  const migrationSrc = readFileSync(
    resolve(
      'packages/database/src/migrations/0038_sync_nv001_timesheet_and_remove_nv002_payroll.sql',
    ),
    'utf8',
  );
  assert.match(migrationSrc, /is_payroll_eligible = false/);
  assert.match(migrationSrc, /Nguyễn Huỳnh Thế Vinh/);
  assert.match(migrationSrc, /1031739417/);
});
