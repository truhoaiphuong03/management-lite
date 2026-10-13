#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
function getArg(flag, def = null) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : def;
}
const hasFlag = (flag) => args.includes(flag);

const issueId = getArg('--issue-id');
const liveShaFile = 'C:/HoaiPhuong-Server/reports/current-live-sha.txt';
let commitSha = getArg('--commit-sha');
if (!commitSha && existsSync(liveShaFile)) {
  commitSha = readFileSync(liveShaFile, 'utf8').trim();
}
if (!commitSha) {
  try {
    commitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    commitSha = 'unknown';
  }
}

const apiBase = getArg('--api-base', 'http://127.0.0.1:3002');
const webBase = getArg('--web-base', 'https://ql.hoaiphuong.click');
const testCmd = getArg(
  '--test-cmd',
  'node --test tests/backend/bug-ai-management.test.mjs',
);
const manualOnly = hasFlag('--manual');
const adminPassword = process.env.ADMIN_PASSWORD || '12345678';

console.log('=== AUTOMATED BUG VERIFICATION PIPELINE ===');
console.log(`Commit SHA: ${commitSha}`);
console.log(`API Base:   ${apiBase}`);
console.log(`Web Base:   ${webBase}`);
if (issueId) {
  console.log(`Target Issue: ${issueId}`);
}

async function runVerification() {
  // Step 1: Health & Readiness Check
  console.log('\n[1/4] Checking API Health & Readiness...');
  try {
    const healthRes = await fetch(`${apiBase}/api/v1/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const health = await healthRes.json();
    if (healthRes.status !== 200 || health?.data?.status !== 'pass') {
      throw new Error(`Health check failed: HTTP ${healthRes.status}`);
    }

    const readyRes = await fetch(`${apiBase}/api/v1/ready`, {
      signal: AbortSignal.timeout(4000),
    });
    const ready = await readyRes.json();
    if (readyRes.status !== 200 || ready?.data?.status !== 'ready') {
      throw new Error(`Readiness check failed: HTTP ${readyRes.status}`);
    }

    const webRes = await fetch(webBase, { signal: AbortSignal.timeout(4000) });
    if (webRes.status !== 200) {
      throw new Error(`Web UI check failed: HTTP ${webRes.status}`);
    }
    console.log('✔ Health, Ready, and Web UI checks PASSED (HTTP 200)');
  } catch (err) {
    console.error(`✖ Service check FAILED: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Authentication
  console.log('\n[2/4] Authenticating as Owner...');
  let cookie = null;
  let csrf = null;
  try {
    const loginRes = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: webBase,
      },
      body: JSON.stringify({
        identifier: 'admin',
        password: adminPassword,
      }),
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login failed with HTTP ${loginRes.status}`);
    }
    const setCookie = loginRes.headers.get('set-cookie');
    if (setCookie) {
      cookie = setCookie.split(';')[0].trim();
    }
    const body = await loginRes.json();
    csrf = body?.data?.csrf_token;
    console.log('✔ Owner authentication successful');
  } catch (err) {
    console.error(`✖ Authentication error: ${err.message}`);
    process.exit(1);
  }

  // Step 3: Run Regression Test
  console.log('\n[3/4] Running Bug Regression Test...');
  let testPassed = false;
  if (manualOnly) {
    console.log(
      'ℹ Manual verification requested (--manual). Skipping automated regression test.',
    );
  } else {
    try {
      console.log(`Executing: ${testCmd}`);
      execSync(testCmd, { stdio: 'inherit' });
      testPassed = true;
      console.log('✔ Regression test PASSED');
    } catch {
      testPassed = false;
      console.error('✖ Regression test FAILED');
    }
  }

  // Step 4: Update Bug Status on Backend
  if (issueId) {
    console.log(`\n[4/4] Updating Bug Status for Issue: ${issueId}...`);
    let targetResult = 'manual';
    if (!manualOnly) {
      targetResult = testPassed ? 'passed' : 'failed';
    }

    try {
      const verifyRes = await fetch(
        `${apiBase}/api/v1/issues/${encodeURIComponent(issueId)}/verify`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: webBase,
            cookie: cookie || '',
            'x-csrf-token': csrf || '',
          },
          body: JSON.stringify({
            commit_sha: commitSha,
            test_result: targetResult,
          }),
        },
      );

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(
          verifyData?.error?.message || `HTTP ${verifyRes.status}`,
        );
      }

      const updated = verifyData.data;
      console.log(
        `✔ Issue ${updated.bug_code || updated.id} transitioned to: [${updated.status.toUpperCase()}]`,
      );
      console.log(`  - Test Result:  ${updated.test_result}`);
      console.log(`  - Deploy SHA:   ${updated.deploy_sha}`);
      console.log(`  - Closed At:    ${updated.closed_at || 'null'}`);
      console.log(`  - Reopen Count: ${updated.reopen_count || 0}`);
    } catch (err) {
      console.error(`✖ Failed to update issue status via API: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(
      '\n[4/4] No specific --issue-id provided. Smoke verification complete.',
    );
  }

  if (!manualOnly && !testPassed) {
    console.error('\n✖ VERIFICATION FAILED: Bug regression test did not pass.');
    process.exit(1);
  }

  console.log('\n=== ALL VERIFICATION CHECKS PASSED ===');
}

runVerification().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
