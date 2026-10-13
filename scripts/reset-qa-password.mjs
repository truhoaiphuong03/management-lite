import { loadConfirmedTestConfig } from './explicit-database.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

function generateSecurePassword(prefix = 'MgLite') {
  const bytes = crypto.randomBytes(12).toString('base64url');
  return `${prefix}!${bytes}9#`;
}

async function main() {
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  const config = loadConfirmedTestConfig();
  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      console.error(`Database unreachable: ${health.error}`);
      process.exit(1);
    }

    const args = process.argv.slice(2);
    const getArg = (flag, fallback) => {
      const idx = args.indexOf(flag);
      if (idx !== -1 && args[idx + 1]) return args[idx + 1].trim();
      return fallback;
    };

    if (args.includes('--password')) throw new Error('Use RESET_PASSWORD in the environment; password arguments are refused.');
    const targetUser = getArg('--user', '')?.toLowerCase();
    if (!targetUser) throw new Error('Explicit --user is required.');
    const explicitPassword = process.env.RESET_PASSWORD || null;
    const newPassword =
      explicitPassword ||
      generateSecurePassword(
        targetUser === 'owner'
          ? 'Owner'
          : targetUser === 'staff'
            ? 'Staff'
            : 'User',
      );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `SELECT id, username_normalized, email_normalized, status FROM users WHERE username_normalized = $1;`,
        [targetUser],
      );

      if (userRes.rows.length === 0) {
        console.error(`User "${targetUser}" not found in database.`);
        await client.query('ROLLBACK');
        process.exit(1);
      }

      const userId = userRes.rows[0].id;
      const passwordHash = await hashPassword(newPassword);

      // Update password hash and increment credential_version
      await client.query(
        `UPDATE user_credentials SET password_hash = $1, credential_version = credential_version + 1 WHERE user_id = $2;`,
        [passwordHash, userId],
      );

      // Revoke all active sessions
      await client.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL;`,
        [userId],
      );

      // Audit event
      await client.query(
        `INSERT INTO audit_events (
          workspace_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_sanitized
        ) VALUES (
          (SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1),
          $1, 'auth.password_reset', 'user', $1, 'cli-reset-script',
          $2
        );`,
        [
          userId,
          JSON.stringify({
            resetAt: new Date().toISOString(),
            by: 'local-operator',
          }),
        ],
      );

      await client.query('COMMIT');

      // Update local credentials file with mode 0600
      const credFile = resolve(root, '.env.qa-credentials.local');
      let currentContent = '';
      if (fs.existsSync(credFile)) {
        currentContent = fs.readFileSync(credFile, 'utf8');
      }

      const keyName =
        targetUser === 'owner'
          ? 'OWNER_PASSWORD'
          : targetUser === 'staff'
            ? 'STAFF_PASSWORD'
            : targetUser === 'staff2'
              ? 'STAFF2_PASSWORD'
              : `${targetUser.toUpperCase()}_PASSWORD`;

      let updated = false;
      const lines = currentContent.split('\n').map((l) => {
        if (l.startsWith(`${keyName}=`)) {
          updated = true;
          return `${keyName}="${newPassword}"`;
        }
        return l;
      });

      if (!updated) {
        lines.push(`${keyName}="${newPassword}"`);
      }

      fs.writeFileSync(credFile, lines.join('\n'), { mode: 0o600 });
      fs.chmodSync(credFile, 0o600);

      console.log('\n======================================================');
      console.log('✅ CẤP LẠI MẬT KHẨU QA THÀNH CÔNG (LOCAL TERMINAL ONLY)');
      console.log('======================================================');
      console.log(
        `Tài khoản : ${targetUser} (${userRes.rows[0].email_normalized})`,
      );
      console.log(`Mật khẩu  : [CONFIGURED]`);
      console.log(`Lưu trữ   : ${credFile} (Quyền hạn 0600)`);
      console.log(`Phiên cũ  : Đã thu hồi toàn bộ session đang chạy`);
      console.log('======================================================\n');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await closeDatabasePool(pool);
  }
}

main().catch((err) => {
  console.error('Reset password failed:', err);
  process.exit(1);
});
