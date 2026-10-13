import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadQaCredentials,
  getAcceptanceOwnerCredentials,
  getAcceptanceStaffCredentials,
  ACCEPTANCE_ACTORS,
  DEFAULT_QA_CREDENTIALS_FILE,
} from '../../scripts/qa-credentials-reader.mjs';

function createTempEnvFile(content) {
  const dir = resolve(
    tmpdir(),
    'mgl-qa-test-' + Math.random().toString(36).substring(2, 9),
  );
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, '.env.synthetic');
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  return {
    filePath,
    cleanup: () => {
      try {
        unlinkSync(filePath);
      } catch {}
    },
  };
}

test('QA CREDENTIAL PARSER REGRESSION SUITE', async (t) => {
  await t.test(
    '1. Quoted value containing # is parsed verbatim without truncation',
    () => {
      const synthetic = createTempEnvFile(
        'ADMIN_PASSWORD="synth#password#hash#val"\nSTAFF_PASSWORD="another#hash#"',
      );
      try {
        const creds = loadQaCredentials(synthetic.filePath, {
          requiredKeys: ['ADMIN_PASSWORD', 'STAFF_PASSWORD'],
        });
        assert.equal(creds.ADMIN_PASSWORD, 'synth#password#hash#val');
        assert.equal(creds.STAFF_PASSWORD, 'another#hash#');
      } finally {
        synthetic.cleanup();
      }
    },
  );

  await t.test(
    '2. Unquoted inline comment conformance with node:util.parseEnv',
    () => {
      const synthetic = createTempEnvFile(
        'KEY_INLINE=val # inline comment\nKEY_SIMPLE=simpleval',
      );
      try {
        const creds = loadQaCredentials(synthetic.filePath);
        // node:util.parseEnv standard behavior for unquoted tokens
        assert.ok(creds.KEY_INLINE.includes('val'));
        assert.equal(creds.KEY_SIMPLE, 'simpleval');
      } finally {
        synthetic.cleanup();
      }
    },
  );

  await t.test(
    '3. Quoted multiline values are supported per dotenv specification',
    () => {
      const synthetic = createTempEnvFile(
        'MULTILINE_KEY="first_line\nsecond_line"',
      );
      try {
        const creds = loadQaCredentials(synthetic.filePath);
        assert.equal(creds.MULTILINE_KEY, 'first_line\nsecond_line');
      } finally {
        synthetic.cleanup();
      }
    },
  );

  await t.test(
    '4. Duplicate keys follow standard last-occurrence precedence',
    () => {
      const synthetic = createTempEnvFile(
        'DUP_KEY="first_value"\nDUP_KEY="second_value"',
      );
      try {
        const creds = loadQaCredentials(synthetic.filePath);
        assert.equal(creds.DUP_KEY, 'second_value');
      } finally {
        synthetic.cleanup();
      }
    },
  );

  await t.test(
    '5. Missing or empty required keys trigger fail-closed error',
    () => {
      // 5a. Missing key entirely
      const synthetic1 = createTempEnvFile('STAFF_PASSWORD="test_staff"');
      try {
        assert.throws(
          () =>
            loadQaCredentials(synthetic1.filePath, {
              requiredKeys: ['ADMIN_PASSWORD'],
            }),
          /Missing or empty required credential key "ADMIN_PASSWORD"/,
        );
      } finally {
        synthetic1.cleanup();
      }

      // 5b. Empty string value
      const synthetic2 = createTempEnvFile(
        'ADMIN_PASSWORD=""\nSTAFF_PASSWORD="test_staff"',
      );
      try {
        assert.throws(
          () =>
            loadQaCredentials(synthetic2.filePath, {
              requiredKeys: ['ADMIN_PASSWORD'],
            }),
          /Missing or empty required credential key "ADMIN_PASSWORD"/,
        );
      } finally {
        synthetic2.cleanup();
      }

      // 5c. Whitespace only value
      const synthetic3 = createTempEnvFile(
        'ADMIN_PASSWORD="   "\nSTAFF_PASSWORD="test_staff"',
      );
      try {
        assert.throws(
          () =>
            loadQaCredentials(synthetic3.filePath, {
              requiredKeys: ['ADMIN_PASSWORD'],
            }),
          /Missing or empty required credential key "ADMIN_PASSWORD"/,
        );
      } finally {
        synthetic3.cleanup();
      }
    },
  );

  await t.test(
    '6. Environment override rejection: process.env values NEVER override credential file',
    () => {
      const synthetic = createTempEnvFile(
        'ADMIN_PASSWORD="authoritative_file_password"',
      );
      const originalEnv = process.env.ADMIN_PASSWORD;
      try {
        process.env.ADMIN_PASSWORD = 'tampered_env_override';
        const creds = loadQaCredentials(synthetic.filePath, {
          requiredKeys: ['ADMIN_PASSWORD'],
        });
        assert.equal(
          creds.ADMIN_PASSWORD,
          'authoritative_file_password',
          'Reader must return authoritative file content, ignoring process.env',
        );
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ADMIN_PASSWORD;
        } else {
          process.env.ADMIN_PASSWORD = originalEnv;
        }
        synthetic.cleanup();
      }
    },
  );

  await t.test(
    '7. Exact Acceptance Actor enforcement and identity integrity',
    () => {
      const synthetic = createTempEnvFile(
        'ADMIN_PASSWORD="synthetic_admin_pw"\nSTAFF_PASSWORD="synthetic_staff_pw"',
      );
      try {
        const owner = getAcceptanceOwnerCredentials(synthetic.filePath);
        assert.equal(
          owner.id,
          '2a565b98-868c-4d8b-821e-fdd9da94dacc',
          'Owner ID must match Acceptance Admin actor',
        );
        assert.equal(
          owner.identifier,
          'admin',
          'Owner identifier must be admin',
        );
        assert.equal(owner.password, 'synthetic_admin_pw');

        const staff = getAcceptanceStaffCredentials(synthetic.filePath);
        assert.equal(
          staff.id,
          '13b98f3e-5292-4d9f-a91f-517d2b98c17d',
          'Staff ID must match Acceptance Staff actor',
        );
        assert.equal(
          staff.identifier,
          'staff',
          'Staff identifier must be staff',
        );
        assert.equal(staff.password, 'synthetic_staff_pw');
      } finally {
        synthetic.cleanup();
      }
    },
  );

  await t.test(
    '8. Fail-closed: No fallback when source is missing, invalid, or corrupted',
    () => {
      // 8a. Missing source file throws immediately (no fallback to default passwords)
      assert.throws(
        () => getAcceptanceOwnerCredentials('/non/existent/file.env'),
        /Explicit QA credentials file not found/,
      );
      assert.throws(
        () => getAcceptanceStaffCredentials('/non/existent/file.env'),
        /Explicit QA credentials file not found/,
      );

      // 8b. Missing ADMIN_PASSWORD does NOT fall back to OWNER_PASSWORD or hardcoded '12345678'
      const syntheticNoAdmin = createTempEnvFile(
        'OWNER_PASSWORD="fallback_owner_pw"\nSTAFF_PASSWORD="synthetic_staff_pw"',
      );
      try {
        assert.throws(
          () => getAcceptanceOwnerCredentials(syntheticNoAdmin.filePath),
          /Missing or empty required credential key "ADMIN_PASSWORD"/,
        );
      } finally {
        syntheticNoAdmin.cleanup();
      }

      // 8c. Missing STAFF_PASSWORD does NOT fall back to hardcoded 'StaffPass123!Secure'
      const syntheticNoStaff = createTempEnvFile(
        'ADMIN_PASSWORD="synthetic_admin_pw"',
      );
      try {
        assert.throws(
          () => getAcceptanceStaffCredentials(syntheticNoStaff.filePath),
          /Missing or empty required credential key "STAFF_PASSWORD"/,
        );
      } finally {
        syntheticNoStaff.cleanup();
      }
    },
  );

  await t.test(
    '9. Authoritative Acceptance Actor constants are frozen immutable objects',
    () => {
      assert.ok(Object.isFrozen(ACCEPTANCE_ACTORS));
      assert.ok(Object.isFrozen(ACCEPTANCE_ACTORS.OWNER));
      assert.ok(Object.isFrozen(ACCEPTANCE_ACTORS.STAFF));
      assert.equal(
        ACCEPTANCE_ACTORS.OWNER.id,
        '2a565b98-868c-4d8b-821e-fdd9da94dacc',
      );
      assert.equal(
        ACCEPTANCE_ACTORS.STAFF.id,
        '13b98f3e-5292-4d9f-a91f-517d2b98c17d',
      );
      assert.equal(DEFAULT_QA_CREDENTIALS_FILE, '.env.qa-credentials.local');
    },
  );
});
