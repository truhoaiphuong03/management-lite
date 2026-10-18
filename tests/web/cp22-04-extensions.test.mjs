import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

test('CP22-04 & 4 Extensions (RBAC 3-Role, Audit Export, GPS Geofencing, MFA/TOTP) acceptance check', () => {
  const auditScreen = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/screens/AuditScreen.tsx'),
    'utf8',
  );
  assert.match(auditScreen, /data-testid="btn-export-audit-csv"/);
  assert.match(auditScreen, /audit-export-/);

  const clockScreen = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/screens/ClockScreen.tsx'),
    'utf8',
  );
  assert.match(clockScreen, /data-testid="gps-geofence-panel"/);
  assert.match(clockScreen, /data-testid="btn-verify-gps"/);
  assert.match(clockScreen, /data-testid="btn-export-attendance-csv"/);

  const settingsScreen = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/screens/SettingsScreen.tsx'),
    'utf8',
  );
  assert.match(settingsScreen, /data-testid="rbac-and-mfa-section"/);
  assert.match(settingsScreen, /data-testid="mfa-totp-panel"/);
  assert.match(settingsScreen, /OWNER \(Chủ sở hữu\)/);
  assert.match(settingsScreen, /ADMIN \(Quản lý vận hành\)/);
  assert.match(settingsScreen, /STAFF \(Nhân viên\)/);
});
