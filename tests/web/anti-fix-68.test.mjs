import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('ANTI-FIX-68/70 — Close QA-67/QA-69 Pay Findings & Mounted Browser Regression Suite', async (t) => {
  // 1. Static Contract & Source Integrity
  await t.test('1. Static invariants in PayrollScreen source', () => {
    const payrollCode = readFileSync(
      resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
      'utf8',
    );

    // Q67-01: Canonical validation function presence
    assert.ok(
      payrollCode.includes(
        'export function validateDisbursementSuccessResponse(',
      ),
      'Must export validateDisbursementSuccessResponse',
    );
    assert.ok(
      payrollCode.includes(
        'validateDisbursementSuccessResponse(res.ok, resBody,',
      ),
      'Must invoke validateDisbursementSuccessResponse on payment response',
    );

    // Q67-02: Typed storage inspection
    assert.ok(
      payrollCode.includes(
        'export function inspectUnresolvedDisbursementStorage(',
      ),
      'Must export inspectUnresolvedDisbursementStorage',
    );
    assert.ok(
      payrollCode.includes("status: 'corrupt'"),
      'Must detect and return corrupt storage status',
    );
    assert.ok(
      payrollCode.includes("status: 'blocked'"),
      'Must detect and return blocked storage status',
    );

    // Q67-03: Legacy v1 storage inspection and ambiguous keys
    assert.ok(
      payrollCode.includes('mgmt_lite_unresolved_disbursements_v1'),
      'Must inspect legacy v1 storage key',
    );
    assert.ok(
      payrollCode.includes('ambiguousLegacyKeys'),
      'Must track ambiguous legacy keys for unverified users',
    );

    // Q67-04: Strict canonical identity
    assert.ok(
      payrollCode.includes('const rawWsId = body.data.active_workspace?.id;'),
      'Must strictly read active_workspace.id without fallback to workspace_id',
    );
  });

  // 2. Mounted Headless Chrome Suite Execution (CDP fail-closed verification)
  await t.test(
    '2. Live Chrome CDP suite execution (strict FIX-72 suite)',
    (subT) => {
      if (!process.env.QA_WEB_BASE) {
        subT.skip('Requires live QA_WEB_BASE server');
        return;
      }
      const scriptPath = resolve(root, 'scripts/capture-anti-fix-68.mjs');
      const output = execFileSync('node', [scriptPath], {
        encoding: 'utf8',
        cwd: root,
      });

      assert.ok(
        output.includes('✔ Controlled probe blocked'),
        'Controlled probe must fail-closed',
      );
      assert.match(
        output,
        /✔ ALL \d+ MOUNTED PRODUCTION SCENARIOS \+ \d+ FUNCTION CHECKS PASSED \(strict\)/,
        'All mounted scenarios and function checks must pass',
      );

      const artifactPath = resolve(
        root,
        'docs/handoff/FIX-72/browser-pay.json',
      );
      assert.ok(
        existsSync(artifactPath),
        'browser-pay.json must be written to docs/handoff/FIX-72',
      );
    },
  );
});
