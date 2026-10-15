import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('Deployment policy rejects unapproved SHA, untrusted CI and missing Owner protection', () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'management-lite-policy-qa-'),
  );
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '--quiet', '-b', 'main');
    git('config', 'user.name', 'Synthetic QA');
    git('config', 'user.email', 'synthetic@isolated.example.test');
    fs.writeFileSync(path.join(dir, 'fixture.txt'), 'synthetic');
    git('add', 'fixture.txt');
    git('commit', '--quiet', '-m', 'synthetic fixture');
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', sha);
    const mock = path.join(dir, 'mock-api.mjs');
    fs.writeFileSync(
      mock,
      `globalThis.fetch=async url=>{const scenario=process.env.POLICY_CASE;const run={head_sha:process.env.RELEASE_SHA,head_branch:'main',event:'push',status:'completed',conclusion:'success',path:'.github/workflows/foundation.yml'};const policy={protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'synthetic-owner'}}]}],deployment_branch_policy:{protected_branches:true}};if(scenario==='ci-sha')run.head_sha='0'.repeat(40);if(scenario==='ci-pr')run.event='pull_request';if(scenario==='ci-fail')run.conclusion='failure';if(scenario==='wrong-workflow')run.path='.github/workflows/other.yml';if(scenario==='no-reviewer')policy.protection_rules=[];if(scenario==='wrong-owner')policy.protection_rules[0].reviewers[0].reviewer.login='another-user';if(scenario==='extra-reviewer')policy.protection_rules[0].reviewers.push({type:'User',reviewer:{login:'another-user'}});if(scenario==='unprotected')policy.deployment_branch_policy.protected_branches=false;return {ok:scenario!=='api-denied',status:scenario==='api-denied'?403:200,json:async()=>url.includes('environments')?policy:run};};`,
    );
    const script = fileURLToPath(
      new URL(
        '../../scripts/deployment/verify-release-request.mjs',
        import.meta.url,
      ),
    );
    const base = {
      ...process.env,
      GITHUB_REPOSITORY: 'truhoaiphuong03/management-lite',
      GITHUB_REF: 'refs/heads/main',
      RELEASE_SHA: sha,
      QA_APPROVED_SHA: sha,
      CI_RUN_ID: '123',
      CD_ENABLED: 'true',
      PRODUCTION_OWNER_LOGIN: 'synthetic-owner',
      GITHUB_TOKEN: 'synthetic-test-token-not-real',
    };
    const run = (scenario, override = {}) =>
      spawnSync(
        process.execPath,
        ['--import', pathToFileURL(mock).href, script],
        {
          cwd: dir,
          encoding: 'utf8',
          env: { ...base, POLICY_CASE: scenario, ...override },
        },
      );
    assert.equal(run('valid').status, 0);
    for (const scenario of [
      'ci-sha',
      'ci-pr',
      'ci-fail',
      'wrong-workflow',
      'no-reviewer',
      'wrong-owner',
      'unprotected',
      'extra-reviewer',
      'api-denied',
    ])
      assert.notEqual(run(scenario).status, 0, scenario);
    for (const override of [
      { CD_ENABLED: 'false' },
      { QA_APPROVED_SHA: '0'.repeat(40) },
      { RELEASE_SHA: 'main' },
      { GITHUB_REF: 'refs/pull/1/merge' },
      { GITHUB_REPOSITORY: 'untrusted/repo' },
    ])
      assert.notEqual(
        run('valid', override).status,
        0,
        JSON.stringify(override),
      );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Option 1 CI/CD architecture: automatic CI on push/PR without deploy, single artifact builder, zero self-hosted runner', () => {
  const workflowsDir = fileURLToPath(
    new URL('../../.github/workflows', import.meta.url),
  );
  const files = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  assert.deepEqual(
    files,
    ['deploy.yml', 'foundation.yml'],
    'Must have exactly two canonical workflows: foundation.yml (CI on push/PR) and deploy.yml (manual release artifact builder)',
  );
  for (const file of files) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    assert.equal(
      content.includes('self-hosted'),
      false,
      `Workflow ${file} must not dispatch jobs to self-hosted Windows runner under Option 1`,
    );
    if (file === 'foundation.yml') {
      assert.equal(
        /^\s*push\s*:/m.test(content) && /^\s*pull_request\s*:/m.test(content),
        true,
        'foundation.yml must automatically run CI on both push and pull_request',
      );
      assert.equal(
        content.includes('Deploy-SemiAutoWindows.ps1'),
        false,
        'foundation.yml must never execute production/host deployment',
      );
    }
    if (file.startsWith('deploy')) {
      assert.equal(
        /^\s*push\s*:/m.test(content),
        false,
        `Deploy workflow ${file} must not trigger on push`,
      );
      assert.equal(
        content.includes("if: github.ref == 'refs/heads/main'"),
        true,
        'deploy.yml must restrict execution to refs/heads/main',
      );
      assert.equal(
        content.includes('artifact_sha256') &&
          content.includes('schema_sha256') &&
          content.includes('run_attempt') &&
          content.includes('workflow_path'),
        true,
        'deploy.yml must bind artifact_sha256, schema_sha256, run_attempt, and workflow_path in ci-run-receipt',
      );
    }
    assert.equal(
      content.includes('node-version-file: .nvmrc') &&
        content.includes('npm install --global npm@10.9.2'),
      true,
      `Workflow ${file} must lock exact Node version via .nvmrc (22.14.0) and npm@10.9.2 required by scripts/check-toolchain.mjs`,
    );
    const usesMatches = [...content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)];
    for (const m of usesMatches) {
      assert.match(
        m[1],
        /@[0-9a-f]{40}$/,
        `Workflow ${file} action ${m[1]} must be pinned to a full 40-char commit SHA`,
      );
    }
  }

  const controllerPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Deploy-SemiAutoWindows.ps1',
      import.meta.url,
    ),
  );
  const controllerCode = fs.readFileSync(controllerPath, 'utf8');
  assert.equal(
    controllerCode.includes('npm run build'),
    false,
    'Deploy-SemiAutoWindows.ps1 must never fall back to local host compilation (npm run build)',
  );
  assert.equal(
    controllerCode.includes('REJECTED_ARTIFACT_MISSING') &&
      controllerCode.includes('REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED') &&
      controllerCode.includes('REJECTED_GITHUB_API_CI_VERIFICATION_FAILED') &&
      controllerCode.includes('ROLLBACK_FAILED_MANUAL_INTERVENTION') &&
      controllerCode.includes('REJECTED_BUILD_NOT_READY') &&
      controllerCode.includes('MIGRATION_FAILED_PRE_CUTOVER') &&
      controllerCode.includes('STOP_NO_GO_INCOMPATIBLE_ROLLBACK') &&
      controllerCode.includes(
        'ROLLBACK_BLOCKED_INCOMPATIBLE_SCHEMA_OR_AUTH_POLICY',
      ) &&
      controllerCode.includes('Invoke-AtomicRuntimeSwap') &&
      controllerCode.includes('UNSAFE_TAR_TYPE'),
    true,
    'Deploy-SemiAutoWindows.ps1 must enforce mandatory artifact, CI receipt, live GitHub API, build readiness, pre-cutover migration, atomic same-volume swap, TAR header symlink/hardlink rejection, and rollback STOP/NO-GO + MANUAL_INTERVENTION states',
  );
  const preCutoverMigIdx = controllerCode.indexOf(
    "phase           = 'PRE_CUTOVER_MIGRATION'",
  );
  const runtimeCutoverIdx = controllerCode.indexOf(
    "phase           = 'RUNTIME_CUTOVER'",
  );
  assert.equal(
    preCutoverMigIdx > 0 && runtimeCutoverIdx > preCutoverMigIdx,
    true,
    'Deploy-SemiAutoWindows.ps1 must execute and verify database migrations (PRE_CUTOVER_MIGRATION) strictly before switching live API/Web runtime (RUNTIME_CUTOVER)',
  );
});
