import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateApproval, safePath } from './deploy-core.mjs';
// Synthetic metadata and ephemeral keys only; these tests never contact GitHub/Windows services.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const policy = {
  environment: 'sandbox',
  enabled: true,
  hold: false,
  sourceBranch: 'main',
  workflowPath: '.github/workflows/release-candidate-windows.yml',
  approvalPublicKey: publicKey,
};
const approval = {
  repository: 'truhoaiphuong03/management-lite',
  repositoryId: 1410248474,
  environment: 'sandbox',
  commit: 'a'.repeat(40),
  packageSHA256: 'b'.repeat(64),
  schemaSHA256: 'c'.repeat(64),
  sourceBranch: 'main',
  workflowPath: policy.workflowPath,
  sequence: 1,
  runId: 11,
  runAttempt: 1,
  artifactId: 22,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  migration: 'none',
  rollbackCompatible: true,
};
const github = {
  authenticated: true,
  repositoryId: 1410248474,
  runId: 11,
  runAttempt: 1,
  artifactId: 22,
  commit: approval.commit,
  branch: 'main',
  workflowPath: approval.workflowPath,
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  artifactName: 'management-lite-windows-' + approval.commit,
  artifactExpired: false,
  artifactSHA256: approval.packageSHA256,
  commitOnSourceBranch: true,
  testsPassed: true,
  buildPassed: true,
  branchProtected: true,
};
const sign = (a) => {
  const payload = JSON.stringify(a);
  return {
    payload,
    signature: crypto
      .sign(null, Buffer.from(payload), privateKey)
      .toString('base64'),
  };
};
test('valid approval bound to repository/SHA/artifact/run/attempt', () =>
  assert.equal(
    validateApproval(policy, sign(approval), github).commit,
    approval.commit,
  ));
test('production remains disabled', () =>
  assert.throws(
    () =>
      validateApproval({ ...policy, enabled: false }, sign(approval), github),
    /DISABLED/,
  ));
test('payload approval cannot be edited without signature', () => {
  const e = sign(approval);
  e.payload = e.payload.replace('"sequence":1', '"sequence":2');
  assert.throws(() => validateApproval(policy, e, github), /SIGNATURE_INVALID/);
});
test('approval cannot be replayed', () =>
  assert.throws(
    () => validateApproval(policy, sign(approval), github, 1),
    /REPLAY/,
  ));
test('expired approval rejected', () =>
  assert.throws(
    () =>
      validateApproval(
        policy,
        sign({ ...approval, expiresAt: '2000-01-01T00:00:00Z' }),
        github,
      ),
    /EXPIRED/,
  ));
test('wrong repository rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign({ ...approval, repositoryId: 99 }), github),
    /REPOSITORY_MISMATCH/,
  ));
test('failed CI rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign(approval), {
        ...github,
        conclusion: 'failure',
      }),
    /CI_NOT_APPROVED/,
  ));
test('plain push or PR cannot authorize deployment', () => {
  for (const event of ['push', 'pull_request'])
    assert.throws(
      () => validateApproval(policy, sign(approval), { ...github, event }),
      /CI_NOT_APPROVED/,
    );
});
test('unauthenticated metadata rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign(approval), {
        ...github,
        authenticated: false,
      }),
    /AUTHENTICATED/,
  ));
test('wrong artifact digest rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign(approval), {
        ...github,
        artifactSHA256: 'd'.repeat(64),
      }),
    /CI_ARTIFACT_MISMATCH/,
  ));
test('wrong SHA rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign(approval), {
        ...github,
        commit: 'd'.repeat(40),
      }),
    /CI_SOURCE_MISMATCH/,
  ));
test('wrong attempt rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign(approval), { ...github, runAttempt: 2 }),
    /CI_ID_MISMATCH/,
  ));
test('missing tests rejected', () =>
  assert.throws(
    () =>
      validateApproval(policy, sign(approval), {
        ...github,
        testsPassed: false,
      }),
    /CI_TEST_BUILD_REQUIRED/,
  ));
test('schema migration cannot run automatically', () =>
  assert.throws(
    () =>
      validateApproval(
        policy,
        sign({ ...approval, migration: 'apply' }),
        github,
      ),
    /MIGRATION_REVIEW/,
  ));
test('unprotected production branch rejected', () =>
  assert.throws(
    () =>
      validateApproval(
        {
          ...policy,
          environment: 'production',
          activationApproved: true,
          independentBackupRequired: true,
        },
        sign({ ...approval, environment: 'production' }),
        { ...github, branchProtected: false },
      ),
    /BRANCH_PROTECTION/,
  ));
test('Windows traversal, ADS, secrets and DB data rejected', () => {
  for (const p of [
    '../escape',
    'C:/escape',
    '/escape',
    'a\\b',
    'file:stream',
    '.env',
    'x/.env.local',
    'database.dump',
    'uploads/file',
    'CON.txt',
    'x/secret.key',
    'x/../a',
  ])
    assert.throws(() => safePath(process.cwd(), p));
});
