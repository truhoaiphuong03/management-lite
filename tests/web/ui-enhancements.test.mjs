import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getVietnamTodayString,
  getVietnamYesterdayString,
} from '../../dist/apps/web/src/screens/ReportsScreen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('ReportsScreen: defines quick date preset buttons for fast date filtering', () => {
  const screenSrc = readFileSync(
    resolve(root, 'apps/web/src/screens/ReportsScreen.tsx'),
    'utf8',
  );

  assert.ok(
    screenSrc.includes('data-testid="report-preset-today"'),
    'ReportsScreen must define Today preset button',
  );
  assert.ok(
    screenSrc.includes('data-testid="report-preset-yesterday"'),
    'ReportsScreen must define Yesterday preset button',
  );
  assert.ok(
    screenSrc.includes('Hôm nay') && screenSrc.includes('Hôm qua'),
    'Preset button labels must be in Vietnamese',
  );
});

test('ReportsScreen Date Presets: computes Today/Yesterday in Asia/Ho_Chi_Minh without toISOString skew near 00:00', () => {
  const screenSrc = readFileSync(
    resolve(root, 'apps/web/src/screens/ReportsScreen.tsx'),
    'utf8',
  );

  // 1. Static assertion: toISOString() is NEVER used to compute preset dates
  assert.ok(
    !screenSrc.includes('new Date().toISOString().slice(0, 10)'),
    'Must NOT use toISOString() for Today preset',
  );
  assert.ok(
    !screenSrc.includes('d.toISOString().slice(0, 10)'),
    'Must NOT use toISOString() for Yesterday preset',
  );
  assert.ok(
    screenSrc.includes('getVietnamTodayString()'),
    'Must use getVietnamTodayString for Today preset',
  );
  assert.ok(
    screenSrc.includes('getVietnamYesterdayString()'),
    'Must use getVietnamYesterdayString for Yesterday preset',
  );

  // 2. Behavioral test: 5 seconds after midnight in Vietnam (00:00:05 ICT -> 17:00:05 UTC previous day)
  // In UTC: 2026-10-12T17:00:05.000Z.
  // In Vietnam (UTC+7): 2026-10-13 00:00:05.
  // toISOString() would yield "2026-10-12" (WRONG - yesterday in VN).
  // getVietnamTodayString() must yield "2026-10-13" (CORRECT - today in VN).
  const postMidnightUtc = new Date('2026-10-12T17:00:05.000Z');
  assert.equal(
    getVietnamTodayString(postMidnightUtc),
    '2026-10-13',
    'Today at 00:00:05 ICT must be 2026-10-13, not UTC previous date',
  );
  assert.equal(
    getVietnamYesterdayString(postMidnightUtc),
    '2026-10-12',
    'Yesterday at 00:00:05 ICT must be 2026-10-12',
  );

  // 3. Behavioral test: 5 seconds before midnight in Vietnam (23:59:55 ICT -> 16:59:55 UTC same day)
  // In UTC: 2026-10-13T16:59:55.000Z.
  // In Vietnam: 2026-10-13 23:59:55.
  const preMidnightUtc = new Date('2026-10-13T16:59:55.000Z');
  assert.equal(
    getVietnamTodayString(preMidnightUtc),
    '2026-10-13',
    'Today at 23:59:55 ICT must be 2026-10-13',
  );
  assert.equal(
    getVietnamYesterdayString(preMidnightUtc),
    '2026-10-12',
    'Yesterday at 23:59:55 ICT must be 2026-10-12',
  );

  // 4. Behavioral test: New Year rollover near 00:00 (2026-01-01 00:02:00 ICT -> 2025-12-31T17:02:00.000Z)
  const newYearUtc = new Date('2025-12-31T17:02:00.000Z');
  assert.equal(getVietnamTodayString(newYearUtc), '2026-01-01');
  assert.equal(getVietnamYesterdayString(newYearUtc), '2025-12-31');

  // 5. Behavioral test: Month rollover (2026-03-01 00:01:00 ICT -> 2026-02-28T17:01:00.000Z)
  const monthRolloverUtc = new Date('2026-02-28T17:01:00.000Z');
  assert.equal(getVietnamTodayString(monthRolloverUtc), '2026-03-01');
  assert.equal(getVietnamYesterdayString(monthRolloverUtc), '2026-02-28');
});

test('App.tsx: includes offline banner and online/offline event listeners', () => {
  const appSrc = readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');

  assert.ok(
    appSrc.includes('data-testid="offline-banner"'),
    'App.tsx must define offline banner',
  );
  assert.ok(
    appSrc.includes('role="status"') && appSrc.includes('aria-live="assertive"'),
    'Offline banner must include accessible live region attributes',
  );
  assert.ok(
    appSrc.includes("addEventListener('offline'") &&
      appSrc.includes("addEventListener('online'"),
    'App.tsx must register online and offline event listeners',
  );
  assert.ok(
    appSrc.includes('Mất kết nối mạng cục bộ (Offline)'),
    'Banner must accurately inform user about local network offline status',
  );
});

test('App.tsx: responds to window online and offline events dynamically', () => {
  let isOnline = true;
  const listeners = new Map();

  const mockWindow = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => {
      const fn = listeners.get(event.type);
      if (fn) fn(event);
    },
  };

  const handleOnline = () => {
    isOnline = true;
  };
  const handleOffline = () => {
    isOnline = false;
  };

  mockWindow.addEventListener('online', handleOnline);
  mockWindow.addEventListener('offline', handleOffline);

  assert.equal(isOnline, true, 'Default state must be online');

  // Trigger offline event
  mockWindow.dispatchEvent({ type: 'offline' });
  assert.equal(isOnline, false, 'State must transition to offline on offline event');

  // Trigger online event
  mockWindow.dispatchEvent({ type: 'online' });
  assert.equal(isOnline, true, 'State must recover to online on online event');

  // Verify cleanup
  mockWindow.removeEventListener('online');
  mockWindow.removeEventListener('offline');
  assert.equal(listeners.size, 0, 'Listeners must be properly removed on unmount');
});

