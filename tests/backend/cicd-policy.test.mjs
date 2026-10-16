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

const normalizeLineEndings = (text) => String(text).replace(/\r\n?/g, '\n');

test('Option 1 CI/CD architecture: automatic CI on push/PR without deploy, mandatory Windows P0 security gate before artifact packaging, zero self-hosted runner', () => {
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

  const verifyWorkflowAndControllerContent = (lineEndingTransformer) => {
    for (const file of files) {
      const rawContent = lineEndingTransformer(
        fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
      );
      const content = normalizeLineEndings(rawContent);
      assert.equal(
        content.includes('self-hosted'),
        false,
        `Workflow ${file} must not dispatch jobs to self-hosted Windows runner under Option 1`,
      );
      assert.equal(
        content.includes('windows-p0-security:') &&
          content.includes('runs-on: windows-latest') &&
          content.includes('tests/backend/windows-p0-gate.test.mjs') &&
          content.includes('needs: windows-p0-security'),
        true,
        `Workflow ${file} must run windows-p0-gate.test.mjs on windows-latest and require windows-p0-security to PASS before packaging/uploading any release artifact`,
      );
      if (file === 'foundation.yml') {
        assert.equal(
          /^\s*push\s*:/m.test(content) &&
            /^\s*pull_request\s*:/m.test(content),
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
    const controllerCode = normalizeLineEndings(
      lineEndingTransformer(fs.readFileSync(controllerPath, 'utf8')),
    );
    assert.equal(
      controllerCode.includes('npm run build'),
      false,
      'Deploy-SemiAutoWindows.ps1 must never fall back to local host compilation (npm run build)',
    );
    assert.equal(
      controllerCode.includes('REJECTED_ARTIFACT_MISSING') &&
        controllerCode.includes(
          'REJECTED_INDEPENDENT_CI_VERIFICATION_FAILED',
        ) &&
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
  };

  verifyWorkflowAndControllerContent((s) => s);
  verifyWorkflowAndControllerContent((s) => s.replace(/\r\n?/g, '\n'));
  verifyWorkflowAndControllerContent((s) =>
    s.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'),
  );
});

test('P0 Release Gate Static Policy & Guard Verification (Linux & Windows): verifies all release-gate, UAC, NTFS ACL, DPAPI, GCM, SCOPED_WINDOW, and Windows test suite invariants across LF and CRLF', () => {
  const controllerPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Deploy-SemiAutoWindows.ps1',
      import.meta.url,
    ),
  );
  const approvePath = fileURLToPath(
    new URL('../../scripts/deployment/Approve-ReleaseSha.ps1', import.meta.url),
  );
  const setupPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Invoke-OwnerP0Setup.ps1',
      import.meta.url,
    ),
  );
  const verifyPatPath = fileURLToPath(
    new URL(
      '../../scripts/deployment/Verify-GitHubPatAndLiveCi.ps1',
      import.meta.url,
    ),
  );
  const windowsGateTestPath = fileURLToPath(
    new URL('./windows-p0-gate.test.mjs', import.meta.url),
  );

  const verifyStaticInvariants = (lineEndingTransformer) => {
    const readNormalized = (p) =>
      normalizeLineEndings(lineEndingTransformer(fs.readFileSync(p, 'utf8')));

    const controllerCode = readNormalized(controllerPath);
    const approveCode = readNormalized(approvePath);
    const setupCode = readNormalized(setupPath);
    const verifyPatCode = readNormalized(verifyPatPath);
    const windowsGateTestCode = readNormalized(windowsGateTestPath);

    assert.equal(
      controllerCode.includes(
        'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION',
      ) &&
        controllerCode.includes('REJECTED_SYNTHETIC_CI_RECEIPT') &&
        controllerCode.includes('REJECTED_PRIVATE_KEY_EXPOSED_ON_HOST') &&
        controllerCode.includes('REJECTED_OUT_OF_SCOPE_LINEAGE') &&
        controllerCode.includes('REJECTED_OUT_OF_SCOPE_PATH_MODIFICATION') &&
        controllerCode.includes('REJECTED_UNAPPROVED_MIGRATION') &&
        controllerCode.includes('REJECTED_SCOPE_QUOTA_EXCEEDED') &&
        controllerCode.includes('config\\test-secrets'),
      true,
      'Deploy-SemiAutoWindows.ps1 must enforce official GitHub API in production, reject synthetic CI receipts, recursively scan config\\test-secrets for exposed private keys, and enforce SCOPED_WINDOW lineage, path, migration, and quota gates',
    );

    assert.equal(
      approveCode.includes('SECURITY_VIOLATION_RUNNER_SELF_APPROVAL') &&
        approveCode.includes('SECURITY_VIOLATION_AGENT_SELF_APPROVAL') &&
        approveCode.includes('SECURITY_VIOLATION_NON_ELEVATED_CALLER') &&
        approveCode.includes('SECURITY_VIOLATION_PRIVATE_KEY_IN_SERVER_GATE') &&
        approveCode.includes('SECURITY_VIOLATION_UAC_HIJACK_DETECTED') &&
        approveCode.includes(
          'REJECTED_NON_OFFICIAL_GITHUB_API_IN_PRODUCTION',
        ) &&
        approveCode.includes('.provenance.json'),
      true,
      'Approve-ReleaseSha.ps1 must block GitHub Actions runner self-approval, block AI agent self-signing, block non-elevated callers, block UAC registry hijacks, block server-local private keys, enforce official GitHub API on production targets, and support .provenance.json auto-discovery',
    );

    assert.equal(
      setupCode.includes('*S-1-3-4') &&
        setupCode.includes('Lock-DirectoryReadOnlyForNonElevated') &&
        setupCode.includes('Lock-ContainerOnlyNoDeleteChild') &&
        setupCode.includes('Preserve-OperationalDirectoryExplicitAcl') &&
        setupCode.includes('Test-LiveStackAndBackupHealth') &&
        setupCode.includes('Restore-P0SetupSnapshot') &&
        setupCode.includes('ConsentPromptBehaviorAdmin'),
      true,
      'Invoke-OwnerP0Setup.ps1 must enforce OWNER RIGHTS (*S-1-3-4) RX lock, parent DC removal, operational service ACL preservation, preflight/post-ACL live stack + DB backup checks, UAC hardening, and transactional rollback',
    );

    assert.equal(
      verifyPatCode.includes('FORBIDDEN_MAIN_BRANCH_PUSH') &&
        verifyPatCode.includes('SECURITY_VIOLATION_CLI_PAT_FORBIDDEN') &&
        verifyPatCode.includes('01000000d08c9ddf') &&
        verifyPatCode.includes('GCM_PLAINTEXT_LEAK_DETECTED') &&
        verifyPatCode.includes('GITHUB_PAT_EXCESSIVE_PERMISSIONS'),
      true,
      'Verify-GitHubPatAndLiveCi.ps1 must forbid pushing to main/master, forbid CLI PAT arguments, enforce DPAPI encryption + GCM WinCred without plaintext leaks, and verify minimum PAT permissions',
    );

    assert.equal(
      windowsGateTestCode.includes(
        "assert.equal(\n    process.platform,\n    'win32'",
      ) &&
        windowsGateTestCode.includes('buildIsolatedTestEnv') &&
        windowsGateTestCode.includes(
          'SECURITY_VIOLATION_RUNNER_SELF_APPROVAL',
        ) &&
        windowsGateTestCode.includes('LuaNtfsKernelVerifier') &&
        windowsGateTestCode.includes('FORBIDDEN_MAIN_BRANCH_PUSH'),
      true,
      'windows-p0-gate.test.mjs must fail closed on non-win32 platforms, explicitly test GitHub Actions runner self-approval rejection, isolate test environments via buildIsolatedTestEnv, and execute live PowerShell, NTFS ACL (LUA_TOKEN kernel), DPAPI, GCM, and SCOPED_WINDOW tests',
    );
  };

  verifyStaticInvariants((s) => s);
  verifyStaticInvariants((s) => s.replace(/\r\n?/g, '\n'));
  verifyStaticInvariants((s) =>
    s.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'),
  );
});
