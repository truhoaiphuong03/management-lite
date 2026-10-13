// Fixed host controller library. Production service adapter is intentionally absent.
// Keep this file and policy Administrator-owned; never execute a controller from a release.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const shaPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
function requireThat(condition, code) {
  if (!condition) throw Error(code);
}
export const digest = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
export function atomicJSON(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
export function safePath(root, relative) {
  requireThat(
    typeof relative === 'string' && relative.length > 0,
    'INVALID_PATH',
  );
  requireThat(
    !relative.includes('\\') &&
      !relative.includes(':') &&
      !relative.includes('\0') &&
      !relative.startsWith('/'),
    'UNSAFE_PATH',
  );
  const parts = relative.split('/');
  requireThat(
    parts.every(
      (x) =>
        x &&
        x !== '.' &&
        x !== '..' &&
        !/[. ]$/.test(x) &&
        !/[<>"|?*\x00-\x1f]/.test(x) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x),
    ),
    'UNSAFE_PATH',
  );
  requireThat(
    parts.every(
      (x) =>
        !/^\.env(?:\.|$)/i.test(x) &&
        !/^(secrets?|uploads?|backups?|logs?|\.git)$/i.test(x) &&
        !/\.(dump|sql|pem|key|pfx|p12|wfw)$/i.test(x) &&
        !/^runtime-private\.json$/i.test(x),
    ),
    'FORBIDDEN_PAYLOAD',
  );
  const full = path.resolve(root, ...parts),
    base = path.resolve(root);
  requireThat(full.startsWith(base + path.sep), 'PATH_ESCAPE');
  return full;
}
export function inventory(root) {
  const files = [];
  function walk(dir, rel = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = rel + e.name;
      const full = safePath(root, name);
      requireThat(!fs.lstatSync(full).isSymbolicLink(), 'REPARSE_PAYLOAD');
      if (e.isDirectory()) walk(full, name + '/');
      else {
        requireThat(e.isFile(), 'SPECIAL_PAYLOAD');
        files.push({
          path: name,
          size: fs.statSync(full).size,
          sha256: digest(fs.readFileSync(full)),
        });
      }
    }
  }
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function validateApproval(
  policy,
  envelope,
  github,
  watermark = 0,
  now = Date.now(),
) {
  requireThat(
    policy.environment === 'sandbox' || policy.environment === 'production',
    'INVALID_ENVIRONMENT',
  );
  requireThat(
    policy.enabled === true && policy.hold === false,
    'DEPLOYMENT_DISABLED',
  );
  requireThat(
    envelope &&
      typeof envelope.payload === 'string' &&
      typeof envelope.signature === 'string',
    'APPROVAL_REQUIRED',
  );
  requireThat(
    crypto.verify(
      null,
      Buffer.from(envelope.payload),
      policy.approvalPublicKey,
      Buffer.from(envelope.signature, 'base64'),
    ),
    'APPROVAL_SIGNATURE_INVALID',
  );
  const a = JSON.parse(envelope.payload);
  requireThat(
    a.repository === 'truhoaiphuong03/management-lite' &&
      a.repositoryId === 1410248474,
    'REPOSITORY_MISMATCH',
  );
  requireThat(a.environment === policy.environment, 'ENVIRONMENT_MISMATCH');
  requireThat(
    shaPattern.test(a.commit) &&
      hashPattern.test(a.packageSHA256) &&
      hashPattern.test(a.schemaSHA256),
    'INVALID_DIGEST',
  );
  requireThat(
    a.sourceBranch === policy.sourceBranch &&
      a.workflowPath === policy.workflowPath,
    'RELEASE_SOURCE_MISMATCH',
  );
  requireThat(
    Number.isSafeInteger(a.sequence) && a.sequence > watermark,
    'APPROVAL_REPLAY',
  );
  requireThat(
    Number.isSafeInteger(a.runId) &&
      Number.isSafeInteger(a.runAttempt) &&
      Number.isSafeInteger(a.artifactId),
    'INVALID_CI_ID',
  );
  requireThat(
    Number.isFinite(Date.parse(a.expiresAt)) &&
      Date.parse(a.expiresAt) > now &&
      Date.parse(a.expiresAt) - now <= 24 * 3600 * 1000,
    'APPROVAL_EXPIRED',
  );
  requireThat(
    a.migration === 'none' && a.rollbackCompatible === true,
    'MIGRATION_REVIEW_REQUIRED',
  );
  requireThat(
    github.authenticated === true && github.repositoryId === a.repositoryId,
    'AUTHENTICATED_PROVENANCE_REQUIRED',
  );
  requireThat(
    github.runId === a.runId &&
      github.runAttempt === a.runAttempt &&
      github.artifactId === a.artifactId,
    'CI_ID_MISMATCH',
  );
  requireThat(
    github.commit === a.commit &&
      github.branch === a.sourceBranch &&
      github.workflowPath === a.workflowPath,
    'CI_SOURCE_MISMATCH',
  );
  requireThat(
    github.event ===
      (policy.environment === 'sandbox'
        ? policy.releaseEvent || 'workflow_dispatch'
        : 'workflow_dispatch') &&
      github.status === 'completed' &&
      github.conclusion === 'success',
    'CI_NOT_APPROVED_RELEASE_BUILD',
  );
  requireThat(
    github.artifactExpired === false &&
      github.artifactName === 'management-lite-windows-' + a.commit,
    'INVALID_ARTIFACT',
  );
  requireThat(
    github.artifactSHA256 === a.packageSHA256 &&
      github.commitOnSourceBranch === true,
    'CI_ARTIFACT_MISMATCH',
  );
  requireThat(
    github.testsPassed === true && github.buildPassed === true,
    'CI_TEST_BUILD_REQUIRED',
  );
  if (policy.environment === 'production') {
    requireThat(github.branchProtected === true, 'BRANCH_PROTECTION_REQUIRED');
    requireThat(
      policy.activationApproved === true &&
        policy.independentBackupRequired === true,
      'PRODUCTION_ACTIVATION_REQUIRED',
    );
  }
  return a;
}
export function verifyPayload(directory, manifest, approval) {
  requireThat(
    manifest.commit === approval.commit &&
      manifest.schemaSHA256 === approval.schemaSHA256,
    'PAYLOAD_IDENTITY_MISMATCH',
  );
  requireThat(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length < 30000,
    'INVALID_INVENTORY',
  );
  const seen = new Set();
  for (const f of manifest.files) {
    safePath(directory, f.path);
    const k = f.path.toLowerCase();
    requireThat(!seen.has(k), 'DUPLICATE_PATH');
    seen.add(k);
  }
  const actual = inventory(directory);
  const expected = [...manifest.files].sort((a, b) =>
    a.path.localeCompare(b.path, 'en'),
  );
  requireThat(
    JSON.stringify(actual) === JSON.stringify(expected),
    'PAYLOAD_INTEGRITY_FAILED',
  );
  requireThat(
    actual.some((x) => x.path === 'dist/apps/api/src/main.js') &&
      actual.some((x) => x.path === 'web/index.html'),
    'ENTRYPOINT_MISSING',
  );
}
export async function deploy({
  root,
  policy,
  envelope,
  github,
  packageFile,
  payloadDirectory,
  manifest,
  hooks,
}) {
  // No generic commands, credentials, environment values or raw child errors in the journal.
  const base = path.resolve(root);
  requireThat(
    fs.existsSync(path.join(base, 'SANDBOX_ONLY')) &&
      policy.environment === 'sandbox',
    'PRODUCTION_ADAPTER_NOT_INSTALLED',
  );
  const stateFile = path.join(base, 'state.json'),
    lockFile = path.join(base, 'deploy.lock'),
    journal = path.join(base, 'journal.jsonl');
  let lock;
  try {
    lock = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        nonce: crypto.randomUUID(),
        created: new Date().toISOString(),
      }),
    );
    fs.fsyncSync(lock);
  } catch {
    throw Error('DEPLOYMENT_LOCKED');
  }
  const log = (state, extra = {}) =>
    fs.appendFileSync(
      journal,
      JSON.stringify({ at: new Date().toISOString(), state, ...extra }) + '\n',
    );
  let prior = {},
    switched = false,
    approval;
  try {
    prior = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      : { sequence: 0, current: null };
    requireThat(
      !['SWITCHING', 'ROLLING_BACK', 'MANUAL_INTERVENTION'].includes(
        prior.status,
      ),
      'RECOVERY_REVIEW_REQUIRED',
    );
    approval = validateApproval(policy, envelope, github, prior.sequence);
    requireThat(
      digest(fs.readFileSync(packageFile)) === approval.packageSHA256,
      'PACKAGE_DIGEST_MISMATCH',
    );
    verifyPayload(payloadDirectory, manifest, approval);
    if (prior.current)
      requireThat(
        prior.current.schemaSHA256 === approval.schemaSHA256,
        'SCHEMA_COMPATIBILITY_REQUIRED',
      );
    requireThat(await hooks.preflight(approval), 'PREFLIGHT_FAILED');
    const backup = await hooks.backup(approval);
    requireThat(
      backup.verified === true && backup.restored === true,
      'BACKUP_NOT_VERIFIED',
    );
    requireThat(
      typeof backup.id === 'string' && hashPattern.test(backup.sha256),
      'BACKUP_IDENTITY_REQUIRED',
    );
    log('VERIFIED', {
      commit: approval.commit,
      sequence: approval.sequence,
      packageSHA256: approval.packageSHA256,
      backupId: backup.id,
      backupSHA256: backup.sha256,
    });
    const next = {
      commit: approval.commit,
      packageSHA256: approval.packageSHA256,
      schemaSHA256: approval.schemaSHA256,
      directory: payloadDirectory,
      manifest,
      envelope,
      packageFile,
    };
    // Persist anti-replay watermark and previous target BEFORE touching processes.
    atomicJSON(stateFile, {
      sequence: approval.sequence,
      status: 'SWITCHING',
      current: next,
      previous: prior.current || null,
    });
    switched = true;
    await hooks.stop();
    await hooks.start(next);
    if (hooks.afterStart) await hooks.afterStart(next);
    requireThat(await hooks.health(next), 'HEALTH_FAILED');
    atomicJSON(stateFile, {
      sequence: approval.sequence,
      status: 'HEALTHY',
      current: next,
      previous: prior.current || null,
    });
    log('HEALTHY', { commit: approval.commit });
    return { status: 'HEALTHY', commit: approval.commit };
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message)
      ? error.message
      : 'HOST_OPERATION_FAILED';
    log('FAILED', { code, commit: approval?.commit || null });
    if (switched) {
      try {
        atomicJSON(stateFile, {
          sequence: approval.sequence,
          status: 'ROLLING_BACK',
          current: prior.current || null,
          failedCommit: approval.commit,
        });
        await hooks.stop();
        if (prior.current) {
          await hooks.start(prior.current);
          requireThat(
            await hooks.health(prior.current),
            'ROLLBACK_HEALTH_FAILED',
          );
          atomicJSON(stateFile, {
            sequence: approval.sequence,
            status: 'ROLLED_BACK',
            current: prior.current,
            failedCommit: approval.commit,
          });
          log('ROLLED_BACK', {
            commit: prior.current.commit,
            failedCommit: approval.commit,
          });
          return {
            status: 'ROLLED_BACK',
            commit: prior.current.commit,
            failedCommit: approval.commit,
          };
        }
        atomicJSON(stateFile, {
          sequence: approval.sequence,
          status: 'STOPPED_FIRST_RELEASE',
          current: null,
          failedCommit: approval.commit,
        });
        log('STOPPED_FIRST_RELEASE', { commit: approval.commit });
        return { status: 'STOPPED_FIRST_RELEASE' };
      } catch {
        atomicJSON(stateFile, {
          sequence: approval.sequence,
          status: 'MANUAL_INTERVENTION',
          current: prior.current || null,
          failedCommit: approval.commit,
        });
        log('MANUAL_INTERVENTION', { commit: approval.commit });
        throw Error('ROLLBACK_FAILED_MANUAL_INTERVENTION');
      }
    }
    throw Error(code);
  } finally {
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockFile);
    }
  }
}

// Recovery can only restore a previously signed package inside an explicitly marked sandbox.
export async function recoverInterruptedDeployment({ root, policy, hooks }) {
  requireThat(
    policy.environment === 'sandbox' &&
      fs.existsSync(path.join(root, 'SANDBOX_ONLY')),
    'PRODUCTION_ADAPTER_NOT_INSTALLED',
  );
  const lockFile = path.join(root, 'deploy.lock'),
    stateFile = path.join(root, 'state.json');
  if (fs.existsSync(lockFile)) {
    let owner;
    try {
      owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch {
      throw Error('UNVERIFIED_LOCK_OWNER');
    }
    requireThat(
      Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        typeof owner.nonce === 'string',
      'UNVERIFIED_LOCK_OWNER',
    );
    let absent = false;
    try {
      process.kill(owner.pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') absent = true;
    }
    requireThat(absent, 'RECOVERY_OWNER_STILL_RUNNING');
    // Recheck the nonce before reclaiming a lock; never kill another process.
    requireThat(
      JSON.parse(fs.readFileSync(lockFile, 'utf8')).nonce === owner.nonce,
      'LOCK_CHANGED',
    );
    fs.renameSync(lockFile, lockFile + '.stale-' + owner.nonce);
  }
  const lock = fs.openSync(lockFile, 'wx');
  fs.writeFileSync(
    lock,
    JSON.stringify({
      pid: process.pid,
      nonce: crypto.randomUUID(),
      created: new Date().toISOString(),
    }),
  );
  fs.fsyncSync(lock);
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    requireThat(
      ['SWITCHING', 'ROLLING_BACK'].includes(state.status),
      'NO_INTERRUPTED_DEPLOYMENT',
    );
    const stable =
      state.status === 'SWITCHING' ? state.previous : state.current;
    if (stable) {
      requireThat(
        crypto.verify(
          null,
          Buffer.from(stable.envelope.payload),
          policy.approvalPublicKey,
          Buffer.from(stable.envelope.signature, 'base64'),
        ),
        'RECOVERY_SIGNATURE_INVALID',
      );
      const priorApproval = JSON.parse(stable.envelope.payload);
      requireThat(
        priorApproval.commit === stable.commit &&
          priorApproval.packageSHA256 === stable.packageSHA256 &&
          priorApproval.schemaSHA256 === stable.schemaSHA256,
        'RECOVERY_TARGET_MISMATCH',
      );
      requireThat(
        digest(fs.readFileSync(stable.packageFile)) === stable.packageSHA256,
        'RECOVERY_PACKAGE_CHANGED',
      );
      verifyPayload(stable.directory, stable.manifest, priorApproval);
      requireThat(
        await hooks.preflight(priorApproval),
        'RECOVERY_PREFLIGHT_FAILED',
      );
    }
    await hooks.stop();
    if (stable) {
      await hooks.start(stable);
      requireThat(await hooks.health(stable), 'RECOVERY_HEALTH_FAILED');
    }
    atomicJSON(stateFile, {
      sequence: state.sequence,
      status: stable ? 'RECOVERED_PREVIOUS' : 'STOPPED_FIRST_RELEASE',
      current: stable || null,
      failedCommit: state.failedCommit || state.current?.commit || null,
    });
    fs.appendFileSync(
      path.join(root, 'journal.jsonl'),
      JSON.stringify({
        at: new Date().toISOString(),
        state: 'RECOVERED_PREVIOUS',
        commit: stable?.commit || null,
        sequence: state.sequence,
      }) + '\n',
    );
    return {
      status: stable ? 'RECOVERED_PREVIOUS' : 'STOPPED_FIRST_RELEASE',
      commit: stable?.commit || null,
      sequence: state.sequence,
    };
  } catch {
    const existing = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    atomicJSON(stateFile, { ...existing, status: 'MANUAL_INTERVENTION' });
    throw Error('RECOVERY_FAILED_MANUAL_INTERVENTION');
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}
