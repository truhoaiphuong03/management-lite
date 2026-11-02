import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

async function rotateQaPasswords() {
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !dbUrl.includes('mglite_mvp_v01_test') ||
    !dbUrl.includes('127.0.0.1:55499')
  ) {
    throw new Error(
      'Refused: Rotation script ONLY operates on isolated test database 127.0.0.1:55499/mglite_mvp_v01_test',
    );
  }

  const pool = new pg.Pool({ connectionString: dbUrl });

  function generateSecureSecret(prefix = 'MgLite') {
    const raw = crypto.randomBytes(16).toString('hex');
    return `${prefix}!${raw}A9`;
  }

  const newAdminPassword = generateSecureSecret('AdminQA');
  const newQaOwnerPassword = generateSecureSecret('OwnerQA');
  const newQaStaffPassword = generateSecureSecret('StaffQA');

  const adminHash = await hashPassword(newAdminPassword);
  const ownerHash = await hashPassword(newQaOwnerPassword);
  const staffHash = await hashPassword(newQaStaffPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update admin
    await client.query(
      `UPDATE user_credentials
       SET password_hash = $1, credential_version = credential_version + 1, password_changed_at = now()
       WHERE user_id = (SELECT id FROM users WHERE username_normalized = 'admin')`,
      [adminHash],
    );

    // 2. Update qa_owner
    await client.query(
      `UPDATE user_credentials
       SET password_hash = $1, credential_version = credential_version + 1, password_changed_at = now()
       WHERE user_id = (SELECT id FROM users WHERE username_normalized = 'qa_owner')`,
      [ownerHash],
    );

    // 3. Update qa_staff
    await client.query(
      `UPDATE user_credentials
       SET password_hash = $1, credential_version = credential_version + 1, password_changed_at = now()
       WHERE user_id = (SELECT id FROM users WHERE username_normalized = 'qa_staff')`,
      [staffHash],
    );

    await client.query('COMMIT');
    console.log(
      'Database password hashes successfully rotated in isolated QA database.',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  // Write to local-only .env.qa-credentials.local with 0600 permissions
  const targetPath = resolve(root, '.env.qa-credentials.local');
  const content = [
    '# Authoritative Isolated Local QA Credentials (Rotated)',
    '# Auto-generated. Do not commit to version control.',
    `ADMIN_PASSWORD="${newAdminPassword}"`,
    `QA_OWNER_PASSWORD="${newQaOwnerPassword}"`,
    `QA_STAFF_PASSWORD="${newQaStaffPassword}"`,
    `OWNER_PASSWORD="${newQaOwnerPassword}"`,
    `STAFF_PASSWORD="${newQaStaffPassword}"`,
    `STAFF2_PASSWORD="${newQaStaffPassword}"`,
    '',
  ].join('\n');

  fs.writeFileSync(targetPath, content, { encoding: 'utf8', mode: 0o600 });
  console.log(
    `Credentials saved securely to local file: ${targetPath} (mode 0600).`,
  );

  // Immediate self-verification
  const { verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );
  const { parseEnv } = await import('node:util');
  const verifyEnv = parseEnv(fs.readFileSync(targetPath, 'utf8'));

  const ownerOk = await verifyPassword(verifyEnv.QA_OWNER_PASSWORD, ownerHash);
  const staffOk = await verifyPassword(verifyEnv.QA_STAFF_PASSWORD, staffHash);
  const adminOk = await verifyPassword(verifyEnv.ADMIN_PASSWORD, adminHash);

  if (!ownerOk || !staffOk || !adminOk) {
    throw new Error(
      'Self-verification failed: Rotated password did not verify against Argon2 hash!',
    );
  }
  console.log('All 3 credentials verified against Argon2 hashes: PASS.');
  console.log(
    'NOTICE: Passwords are NOT printed to stdout/stderr in compliance with security guidelines.',
  );
}

rotateQaPasswords().catch((err) => {
  console.error('Rotation failed:', err.message || err);
  process.exit(1);
});
