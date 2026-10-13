// Read-only, one-shot authenticated provenance verifier. Never log response bodies or tokens.
// Call only from a protected host controller; GITHUB_READ_TOKEN is process-local, read-only.
export async function getGitHubEvidence(approval, token) {
  if (!token) throw Error('GITHUB_CREDENTIAL_UNAVAILABLE');
  const prefix =
    'https://api.github.com/repos/truhoaiphuong03/management-lite/';
  const get = async (suffix) => {
    const r = await fetch(prefix + suffix, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) throw Error('GITHUB_METADATA_UNAVAILABLE');
    return r.json();
  };
  for (const k of ['runId', 'runAttempt', 'artifactId'])
    if (!Number.isSafeInteger(approval[k]) || approval[k] < 1)
      throw Error('INVALID_CI_ID');
  if (
    !/^[a-f0-9]{40}$/.test(approval.commit) ||
    approval.sourceBranch !== 'main'
  )
    throw Error('INVALID_RELEASE_SOURCE');
  const [repo, run, artifact, branch, compare, jobs] = await Promise.all([
    get(''),
    get('actions/runs/' + approval.runId + '/attempts/' + approval.runAttempt),
    get('actions/artifacts/' + approval.artifactId),
    get('branches/main'),
    get('compare/' + approval.commit + '...main'),
    get(
      'actions/runs/' +
        approval.runId +
        '/attempts/' +
        approval.runAttempt +
        '/jobs?per_page=100',
    ),
  ]);
  if (jobs.total_count !== jobs.jobs.length)
    throw Error('CI_JOB_PAGINATION_REVIEW_REQUIRED');
  const required = ['release-tests', 'windows-package'];
  const jobsPassed = required.every((name) =>
    jobs.jobs.some(
      (j) =>
        j.name === name &&
        j.status === 'completed' &&
        j.conclusion === 'success',
    ),
  );
  if (
    artifact.workflow_run?.id !== approval.runId ||
    artifact.workflow_run?.head_sha !== approval.commit
  )
    throw Error('ARTIFACT_RUN_MISMATCH');
  return {
    authenticated: true,
    repositoryId: repo.id,
    runId: run.id,
    runAttempt: run.run_attempt,
    artifactId: artifact.id,
    commit: run.head_sha,
    branch: run.head_branch,
    workflowPath: run.path,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    artifactName: artifact.name,
    artifactExpired: artifact.expired,
    artifactSHA256: (artifact.digest || '').replace(/^sha256:/, ''),
    commitOnSourceBranch:
      ['ahead', 'identical'].includes(compare.status) &&
      compare.merge_base_commit?.sha === approval.commit,
    branchProtected: branch.protected === true,
    testsPassed: jobsPassed,
    buildPassed: jobsPassed,
  };
}
