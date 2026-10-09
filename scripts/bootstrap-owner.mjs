import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

async function main() {
  const { loadDatabaseConfig, sanitizeDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  const config = loadDatabaseConfig();
  console.log('Target database:', sanitizeDatabaseConfig(config));

  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      console.error(`Database unreachable: ${health.error}. Cannot bootstrap.`);
      process.exit(1);
    }

    // 1. Ensure migrations are up to date
    const migrations = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    const migResult = await runMigrations(pool, migrations);
    if (migResult.appliedCount > 0) {
      console.log(`Applied ${migResult.appliedCount} new migrations.`);
    }

    // 2. Parse arguments & environment variables
    const args = process.argv.slice(2);
    const getArg = (flag, envKey, fallback) => {
      const idx = args.indexOf(flag);
      if (idx !== -1 && args[idx + 1]) return args[idx + 1].trim();
      if (process.env[envKey]) return process.env[envKey].trim();
      return fallback;
    };

    const ownerUsername = getArg(
      '--owner-username',
      'OWNER_USERNAME',
      'owner',
    ).toLowerCase();
    const ownerEmail = getArg(
      '--owner-email',
      'OWNER_EMAIL',
      'owner@management-lite.local',
    ).toLowerCase();
    const ownerPassword = getArg('--owner-password', 'OWNER_PASSWORD', null);
    const finalOwnerPassword = ownerPassword || 'OwnerPass123!Secure';

    const staffUsername = getArg(
      '--staff-username',
      'STAFF_USERNAME',
      'staff',
    ).toLowerCase();
    const staffEmail = getArg(
      '--staff-email',
      'STAFF_EMAIL',
      'staff@management-lite.local',
    ).toLowerCase();
    const staffPassword = getArg('--staff-password', 'STAFF_PASSWORD', null);
    const finalStaffPassword = staffPassword || 'StaffPass123!Secure';

    const workspaceName = getArg(
      '--workspace-name',
      'WORKSPACE_NAME',
      'Cửa hàng Management Lite',
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 3. Find or Create Workspace
      let workspaceId;
      const wsRes = await client.query(
        `SELECT id, name FROM workspaces WHERE status = 'active' LIMIT 1;`,
      );
      if (wsRes.rows.length > 0) {
        workspaceId = wsRes.rows[0].id;
        console.log(
          `Using existing active workspace: "${wsRes.rows[0].name}" (${workspaceId})`,
        );
      } else {
        workspaceId = crypto.randomUUID();
        await client.query(
          `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
          [workspaceId, workspaceName],
        );
        console.log(
          `Created new workspace: "${workspaceName}" (${workspaceId})`,
        );
      }

      // 4. Bootstrap / Update Owner
      let ownerId;
      const existingOwnerRes = await client.query(
        `SELECT id FROM users WHERE username_normalized = $1 OR email_normalized = $2;`,
        [ownerUsername, ownerEmail],
      );

      const ownerHash = await hashPassword(finalOwnerPassword);

      if (existingOwnerRes.rows.length > 0) {
        ownerId = existingOwnerRes.rows[0].id;
        console.log(
          `Found existing Owner user (${ownerUsername} / ${ownerId}). Updating password.`,
        );
        await client.query(
          `UPDATE user_credentials SET password_hash = $1, credential_version = credential_version + 1 WHERE user_id = $2;`,
          [ownerHash, ownerId],
        );
      } else {
        ownerId = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [ownerId, ownerUsername, ownerEmail],
        );
        await client.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [ownerId, ownerHash],
        );
        console.log(`Created Owner user: ${ownerUsername} (${ownerEmail})`);
      }

      // Ensure Owner Membership in Workspace
      await client.query(
        `
        INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
        VALUES ($1, $2, 'owner', 'active')
        ON CONFLICT (workspace_id, user_id)
        DO UPDATE SET role = 'owner', status = 'active';
      `,
        [workspaceId, ownerId],
      );

      // Ensure Owner Active Binding
      await client.query(
        `
        INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
        VALUES ($1, $2, 'active', 1)
        ON CONFLICT (user_id) WHERE status = 'active'
        DO UPDATE SET workspace_id = $1, status = 'active';
      `,
        [workspaceId, ownerId],
      );

      // 5. Bootstrap / Update Staff Member
      let staffId;
      const existingStaffRes = await client.query(
        `SELECT id FROM users WHERE username_normalized = $1 OR email_normalized = $2;`,
        [staffUsername, staffEmail],
      );

      const staffHash = await hashPassword(finalStaffPassword);

      if (existingStaffRes.rows.length > 0) {
        staffId = existingStaffRes.rows[0].id;
        console.log(
          `Found existing Staff user (${staffUsername} / ${staffId}). Updating password.`,
        );
        await client.query(
          `UPDATE user_credentials SET password_hash = $1, credential_version = credential_version + 1 WHERE user_id = $2;`,
          [staffHash, staffId],
        );
      } else {
        staffId = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [staffId, staffUsername, staffEmail],
        );
        await client.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [staffId, staffHash],
        );
        console.log(`Created Staff user: ${staffUsername} (${staffEmail})`);
      }

      // Ensure Staff Membership in Workspace
      await client.query(
        `
        INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
        VALUES ($1, $2, 'staff', 'active')
        ON CONFLICT (workspace_id, user_id)
        DO UPDATE SET role = 'staff', status = 'active';
      `,
        [workspaceId, staffId],
      );

      // Ensure Staff Active Binding
      await client.query(
        `
        INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
        VALUES ($1, $2, 'active', 1)
        ON CONFLICT (user_id) WHERE status = 'active'
        DO UPDATE SET workspace_id = $1, status = 'active';
      `,
        [workspaceId, staffId],
      );

      // Audit Record
      await client.query(
        `
        INSERT INTO audit_events (
          workspace_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_sanitized
        ) VALUES (
          $1, $2, 'workspace.bootstrapped', 'workspace', $3, 'bootstrap-script',
          $4
        );
      `,
        [
          workspaceId,
          ownerId,
          String(workspaceId),
          JSON.stringify({
            ownerUsername,
            staffUsername,
            timestamp: new Date().toISOString(),
          }),
        ],
      );

      await client.query('COMMIT');
      console.log('\n=========================================');
      console.log('✅ BOOTSTRAP THÀNH CÔNG (READY FOR LOGIN)');
      console.log('=========================================');
      console.log(`Workspace: ${workspaceName} (${workspaceId})`);
      console.log(
        `Owner Account: ${ownerUsername} (Mật khẩu: ${finalOwnerPassword ? '[CONFIGURED]' : '[GENERATED]'})`,
      );
      console.log(
        `Staff Account: ${staffUsername} (Mật khẩu: ${finalStaffPassword ? '[CONFIGURED]' : '[GENERATED]'})`,
      );
      console.log('=========================================\n');
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
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
