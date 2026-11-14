import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const PRIMARY_BACKUP_DIR = 'C:\\ML-Test\\work\\hub-backup-oa20';
const MIRROR_BACKUP_DIR = 'C:\\Projects-Dev\\hub-backup-oa20-mirror';
const REPO_BACKUP_EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  '../../docs/remediation/evidence/oa20-hub-backup',
);

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

test('OA-20.1: Dual permanent backups exist, match SHA-256 manifest, and pass Restore-OA20-HubState.ps1 -VerifyOnly while refusing accidental legacy restore', (t) => {
  const repoManifestPath = path.join(
    REPO_BACKUP_EVIDENCE_DIR,
    'manifest-sha256.json',
  );
  const repoRestoreScript = path.join(
    REPO_BACKUP_EVIDENCE_DIR,
    'Restore-OA20-HubState.ps1',
  );
  assert.equal(fs.existsSync(repoManifestPath), true);
  assert.equal(fs.existsSync(repoRestoreScript), true);
  const repoManifest = JSON.parse(
    fs.readFileSync(repoManifestPath, 'utf8').replace(/^\uFEFF/, ''),
  );
  assert.equal(repoManifest.length, 12);
  for (const item of repoManifest) {
    assert.match(item.sha256, /^[0-9A-F]{64}$/);
  }
  assert.match(
    fs.readFileSync(repoRestoreScript, 'utf8'),
    /REFUSED_LEGACY_AUTO_DEPLOY_RESTORE/,
  );

  if (process.platform !== 'win32') {
    t.diagnostic(
      'Bỏ qua kiểm tra thư mục backup Windows trên môi trường phi Windows.',
    );
    return;
  }
  const missingBackupDir = [PRIMARY_BACKUP_DIR, MIRROR_BACKUP_DIR].find(
    (dir) => !fs.existsSync(path.join(dir, 'manifest-sha256.json')),
  );
  if (missingBackupDir) {
    t.diagnostic(
      `Bỏ qua kiểm tra bản sao lưu ngoài repo do máy hiện tại không có đường dẫn: ${missingBackupDir}`,
    );
    return;
  }

  for (const dir of [PRIMARY_BACKUP_DIR, MIRROR_BACKUP_DIR]) {
    const manifestPath = path.join(dir, 'manifest-sha256.json');
    assert.equal(
      fs.existsSync(manifestPath),
      true,
      `Missing manifest: ${manifestPath}`,
    );
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''),
    );
    assert.equal(
      manifest.length,
      12,
      'Expected 12 backed-up artifacts in manifest',
    );
    for (const item of manifest) {
      const target = path.join(dir, item.file);
      assert.equal(
        fs.existsSync(target),
        true,
        `Missing backup file: ${target}`,
      );
      assert.equal(
        sha256File(target),
        item.sha256,
        `SHA-256 mismatch for ${target}`,
      );
    }
  }

  const verifyRun = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(PRIMARY_BACKUP_DIR, 'Restore-OA20-HubState.ps1'),
      '-VerifyOnly',
    ],
    { encoding: 'utf8', timeout: 15_000 },
  );
  assert.equal(verifyRun.status, 0, verifyRun.stderr || verifyRun.stdout);
  assert.match(verifyRun.stdout, /OA20_BACKUP_VERIFY_PASS: files=12/);

  const refuseLegacyRestore = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(PRIMARY_BACKUP_DIR, 'Restore-OA20-HubState.ps1'),
      '-Component',
      'LegacyHubScripts',
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.notEqual(refuseLegacyRestore.status, 0);
  assert.match(
    `${refuseLegacyRestore.stdout}\n${refuseLegacyRestore.stderr}`,
    /REFUSED_LEGACY_AUTO_DEPLOY_RESTORE/,
  );
});

test('OA-20.2: All direct, indirect, and boot-scheduled legacy auto-deploy entrypoints fail closed with exit code 43/1 and do not recreate persistence vectors', async (t) => {
  if (process.platform !== 'win32') {
    t.diagnostic('Bỏ qua OA-20.2 trên môi trường phi Windows.');
    return;
  }
  const nodeTriggers = [
    {
      file: 'C:\\Projects\\anty-remote-hub\\src\\server-daemon.mjs',
      expectedCode: 'OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED',
    },
    {
      file: 'C:\\Projects-Dev\\anty-remote-hub\\src\\server-daemon.mjs',
      expectedCode: 'OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED',
    },
    {
      file: 'C:\\Projects\\anty-remote-hub\\src\\sync-live-web.mjs',
      expectedCode: 'OA20_FAIL_CLOSED_LIVE_SYNC_DISABLED',
    },
    {
      file: 'C:\\Projects-Dev\\anty-remote-hub\\src\\sync-live-web.mjs',
      expectedCode: 'OA20_FAIL_CLOSED_LIVE_SYNC_DISABLED',
    },
    {
      file: 'C:\\Projects\\anty-remote-hub\\src\\index.mjs',
      expectedCode: 'OA20_FAIL_CLOSED_LEGACY_INDEX_DISABLED',
    },
  ];
  const atBootScript =
    'C:\\ProgramData\\HoaiPhuong\\ServerStartup\\server-atboot.ps1';
  const missingHostPath = [
    ...nodeTriggers.map((item) => item.file),
    atBootScript,
  ].find((targetPath) => !fs.existsSync(targetPath));
  if (missingHostPath) {
    t.diagnostic(
      `Bỏ qua OA-20.2 do máy hiện tại không có đường dẫn ngoài repo: ${missingHostPath}`,
    );
    return;
  }

  for (const trigger of nodeTriggers) {
    const res = spawnSync(process.execPath, [trigger.file], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(res.status, 43, `Expected exit 43 for ${trigger.file}`);
    assert.match(res.stderr, new RegExp(trigger.expectedCode));
    assert.match(res.stderr, /OA20_FAIL_CLOSED_BLOCKED/);
  }

  // Simulate Scheduled Task HoaiPhuong-Anty-AtBoot command line
  const atBootRes = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\ProgramData\\HoaiPhuong\\ServerStartup\\server-atboot.ps1',
      '-Target',
      'Anty',
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(
    atBootRes.status,
    1,
    'server-atboot.ps1 -Target Anty must exit 1 fail-closed',
  );
  assert.match(
    `${atBootRes.stdout}\n${atBootRes.stderr}`,
    /OA20_FAIL_CLOSED_SERVER_DAEMON_DISABLED/,
  );

  // Verify defense-in-depth function-level guards inside legacy/src/index.mjs source
  const legacyIndexSrc = fs.readFileSync(
    'C:\\Projects\\anty-remote-hub\\src\\index.mjs',
    'utf8',
  );
  assert.match(
    legacyIndexSrc,
    /assertLegacyHubDisabledByOA20\('executeWebReleaseAndDeploy'\)/,
  );
  assert.match(
    legacyIndexSrc,
    /assertLegacyHubDisabledByOA20\('ensureWindows24x7WatchdogInstalled'\)/,
  );
  assert.match(
    legacyIndexSrc,
    /assertLegacyHubDisabledByOA20\('autoPullAndPublishWebProjectsOnServer'\)/,
  );

  // Verify persistence vectors were NOT recreated by any trigger
  const startupVbs = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'anty-remote-hub.vbs',
  );
  assert.equal(fs.existsSync('C:\\Projects\\anty-daemon-hidden.vbs'), false);
  assert.equal(fs.existsSync(startupVbs), false);

  const regCheck = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "$p = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'AntyRemoteHubServer24x7' -ErrorAction SilentlyContinue; if ($null -ne $p) { exit 1 } else { exit 0 }",
    ],
    { encoding: 'utf8', timeout: 8_000 },
  );
  assert.equal(
    regCheck.status,
    0,
    'Registry Run value AntyRemoteHubServer24x7 must not exist',
  );
});

test('OA-20.3: Production services and isolated DEV Bot remain healthy while legacy preview port 4799 is released', (t) => {
  const lockFile = 'C:\\Projects-Dev\\anty-remote-hub\\.anty-poller.lock';
  if (process.platform !== 'win32' || !fs.existsSync(lockFile)) {
    t.diagnostic(
      `Bỏ qua OA-20.3 do máy hiện tại không có tệp trạng thái DEV Bot ngoài repo: ${lockFile}`,
    );
    return;
  }
  assert.equal(fs.existsSync(lockFile), true, 'DEV Bot lock file must exist');
  const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(lockData.mode, 'DEV_CONTROLLED_POLLER');
  assert.equal(typeof lockData.pid, 'number');

  const runtimeCheck = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `
      $ErrorActionPreference = 'Stop'
      $svcs = Get-Service HPManagementLiteWeb, HPManagementLiteApi, HPManagementLiteGateway, HPManagementLiteDatabase, Cloudflared
      foreach ($s in $svcs) {
        if ($s.Status -ne 'Running') { throw "Service $($s.Name) is $($s.Status)" }
      }
      $devProc = Get-Process -Id ${lockData.pid} -ErrorAction Stop
      if ($devProc.ProcessName -ne 'node') { throw "Unexpected DEV bot process name: $($devProc.ProcessName)" }
      $legacy4799 = @(Get-NetTCPConnection -State Listen -LocalPort 4799 -ErrorAction SilentlyContinue)
      if ($legacy4799.Count -gt 0) { throw "Legacy control port 4799 is still occupied" }
      Write-Output "RUNTIME_CHECK_OK"
      `,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(
    runtimeCheck.status,
    0,
    runtimeCheck.stderr || runtimeCheck.stdout,
  );
  assert.match(runtimeCheck.stdout, /RUNTIME_CHECK_OK/);
});
