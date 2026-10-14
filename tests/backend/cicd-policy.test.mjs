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
      spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, script], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...base, POLICY_CASE: scenario, ...override },
      });
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
