// Executes on GitHub-hosted Windows only, never on the production runner or a PR job.
import { execFileSync } from 'node:child_process';
const env = process.env;
const fail = (message) => {
  throw new Error(message);
};
const sha = env.RELEASE_SHA;
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) fail('A full commit SHA is required');
if (
  env.GITHUB_REPOSITORY !== 'truhoaiphuong03/management-lite' ||
  env.GITHUB_REF !== 'refs/heads/main'
)
  fail('Only the protected main workflow may request deployment');
if (env.CD_ENABLED !== 'true' || env.QA_APPROVED_SHA !== sha)
  fail('Owner release gate is closed or bound to another SHA');
if (!/^[0-9]+$/.test(env.CI_RUN_ID ?? '') || !env.PRODUCTION_OWNER_LOGIN)
  fail('CI run and Owner identity required');
const api = async (path) => {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok)
    fail(
      `GitHub policy lookup failed (${response.status}); no approval fallback`,
    );
  return response.json();
};
const run = await api(`actions/runs/${env.CI_RUN_ID}`);
if (
  run.head_sha !== sha ||
  run.head_branch !== 'main' ||
  run.event !== 'push' ||
  run.status !== 'completed' ||
  run.conclusion !== 'success' ||
  run.path !== '.github/workflows/foundation.yml'
)
  fail('Exact-SHA trusted main CI has not passed');
const environment = await api('environments/production');
const required = environment.protection_rules?.find(
  (rule) => rule.type === 'required_reviewers',
);
if (
  required?.reviewers?.length !== 1 ||
  !required?.reviewers?.some(
    (item) =>
      item.type === 'User' &&
      item.reviewer.login === env.PRODUCTION_OWNER_LOGIN,
  )
)
  fail(
    'Production must require the specified Owner reviewer; verify private-repository plan',
  );
if (environment.deployment_branch_policy?.protected_branches !== true)
  fail('Production must allow protected branches only');
execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
console.log(
  `Verified immutable release request ${sha}; production environment approval is still required.`,
);
