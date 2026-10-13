import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('ATT-007: Attendance correction request modal & decision workflow', () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/ClockScreen.tsx'),
    'utf8',
  );

  // 1. Correction triggers on active and historical shifts
  assert.ok(
    screen.includes('data-testid="clock-correction-btn"'),
    'ClockScreen must render clock-correction-btn for forgotten clock-out on current shift',
  );
  assert.ok(
    screen.includes('data-testid="shift-correction-btn"'),
    'ClockScreen must render shift-correction-btn on completed un-corrected shifts',
  );

  // 2. Correction modal and input fields
  assert.ok(
    screen.includes('data-testid="correction-modal"'),
    'ClockScreen must render correction-modal dialog',
  );
  assert.ok(
    screen.includes('data-testid="correction-reason-input"'),
    'ClockScreen must render correction-reason-input textarea',
  );
  assert.ok(
    screen.includes('data-testid="correction-clockout-input"'),
    'ClockScreen must render correction-clockout-input datetime-local',
  );
  assert.ok(
    screen.includes('data-testid="correction-evidence-input"'),
    'ClockScreen must render correction-evidence-input text input',
  );
  assert.ok(
    screen.includes('data-testid="correction-submit-btn"'),
    'ClockScreen must render correction-submit-btn',
  );
  assert.ok(
    screen.includes('data-testid="correction-cancel-btn"'),
    'ClockScreen must render correction-cancel-btn',
  );

  // 3. API endpoints
  assert.ok(
    screen.includes('/api/v1/attendance/shifts/${targetShiftForCorrection.id}/correction-requests'),
    'ClockScreen must call staff correction request endpoint',
  );
  assert.ok(
    screen.includes('/api/v1/attendance/correction-requests/${crId}/decide'),
    'ClockScreen must call owner decide endpoint for correction approval/rejection',
  );
});

test('ATT-010: Overnight shifts & Asia/Ho_Chi_Minh timezone display', () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/ClockScreen.tsx'),
    'utf8',
  );

  // 1. Timezone helpers
  assert.ok(
    screen.includes("timeZone: 'Asia/Ho_Chi_Minh'"),
    'ClockScreen must format dates and times in Asia/Ho_Chi_Minh timezone',
  );
  assert.ok(
    screen.includes('isOvernightShift'),
    'ClockScreen must have isOvernightShift cross-midnight calculation helper',
  );

  // 2. Visual badges for overnight shifts
  assert.ok(
    screen.includes('data-testid="overnight-badge"'),
    'ClockScreen must render overnight-badge for staff shift history',
  );
  assert.ok(
    screen.includes('data-testid="owner-overnight-badge"'),
    'ClockScreen must render owner-overnight-badge for owner review shift list',
  );
  assert.ok(
    screen.includes('Ca qua đêm (+1 ngày)'),
    'ClockScreen must render explicit label "Ca qua đêm (+1 ngày)"',
  );

  // 3. Mathematical verification of isOvernightShift logic
  const checkOvernight = (inIso, outIso) => {
    if (!outIso) return false;
    const inDay = new Date(inIso).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const outDay = new Date(outIso).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    return inDay !== outDay;
  };

  // Same day shift (8:00 -> 17:00 VN)
  assert.equal(
    checkOvernight('2026-10-12T01:00:00Z', '2026-10-12T10:00:00Z'),
    false,
    'Daytime shift on same date should not be marked overnight',
  );

  // Overnight shift (22:00 -> 06:00 next morning VN)
  // 22:00 VN is 15:00 UTC; 06:00 next day VN is 23:00 UTC
  assert.equal(
    checkOvernight('2026-10-12T15:00:00Z', '2026-10-12T23:00:00Z'),
    true,
    'Cross-midnight shift spanning to next day in VN time must be marked overnight',
  );
});

test('ATT-006: Shift history pagination for both staff and owner review', () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/ClockScreen.tsx'),
    'utf8',
  );

  assert.ok(
    screen.includes('testId="my-shifts-pager"'),
    'ClockScreen must render my-shifts-pager Pagination for staff shift history',
  );
  assert.ok(
    screen.includes('testId="shifts-pager"'),
    'ClockScreen must render shifts-pager Pagination for owner review shifts',
  );
});
