import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExplicitDatabaseConfig } from './explicit-database.mjs';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

export async function addAdminAccount(options = {}) {
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  const pool =
    options.pool ||
    createDatabasePool(
      loadExplicitDatabaseConfig(
        process.env,
        options.databaseUrl || process.env.DATABASE_URL,
      ),
    );
  const shouldClosePool = !options.pool;

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      throw new Error(
        `Không thể kết nối đến cơ sở dữ liệu: ${health.error || 'unreachable'}`,
      );
    }

    const client = await pool.connect();
    try {
      // 1. Resolve existing active workspace (Constraint 3: Không tạo workspace mới)
      let workspace;
      if (options.workspaceId) {
        const wsRes = await client.query(
          `SELECT id, name, timezone, status FROM workspaces WHERE id = $1 AND status = 'active';`,
          [options.workspaceId],
        );
        if (wsRes.rows.length === 0) {
          throw new Error(
            `Workspace chỉ định (${options.workspaceId}) không tồn tại hoặc không ở trạng thái active.`,
          );
        }
        workspace = wsRes.rows[0];
      } else {
        const wsRes = await client.query(
          `SELECT id, name, timezone, status FROM workspaces WHERE status = 'active' ORDER BY created_at ASC LIMIT 2;`,
        );
        if (wsRes.rows.length !== 1) {
          throw new Error(
            'Explicit workspace required unless exactly one is active. Không tìm thấy workspace active nào trong database. Vui lòng tạo workspace hoặc chạy bootstrap trước.',
          );
        }
        workspace = wsRes.rows[0];
      }

      // 2. Check if ADMIN user already exists (Constraint 6: Không tạo tài khoản ADMIN trùng nếu đã tồn tại)
      const username = options.username || 'ADMIN';
      const email = options.email || 'admin@management-lite.local';
      const usernameNormalized = username.trim().toLowerCase();
      const emailNormalized = email.trim().toLowerCase();
      const password = options.password;
      if (typeof password !== 'string' || password.trim() === '') {
        throw new Error(
          'Explicit password is required to create or configure an admin account. Fail-closed.',
        );
      }

      const existingUserRes = await client.query(
        `SELECT id, username_normalized, email_normalized, status FROM users WHERE username_normalized = $1 OR email_normalized = $2;`,
        [usernameNormalized, emailNormalized],
      );

      if (existingUserRes.rows.length > 0) {
        const existingUser = existingUserRes.rows[0];
        // Check existing membership & binding
        const memRes = await client.query(
          `SELECT role, status FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
          [workspace.id, existingUser.id],
        );
        const bindRes = await client.query(
          `SELECT status FROM user_workspace_bindings WHERE user_id = $1 AND status = 'active';`,
          [existingUser.id],
        );

        const mem = memRes.rows[0];
        const binding = bindRes.rows[0];

        console.log(
          `\n⚠️  Tài khoản ${username} (${existingUser.username_normalized}) đã tồn tại trong hệ thống.`,
        );
        console.log(`   User ID: ${existingUser.id}`);
        console.log(`   Workspace: "${workspace.name}" (${workspace.id})`);
        console.log(
          `   Membership Role: ${mem ? mem.role : 'none'} (Status: ${mem ? mem.status : 'none'})`,
        );
        console.log(
          `   Active Binding: ${binding ? binding.status : 'none (C06)'}`,
        );
        console.log(
          '   => Không tạo tài khoản trùng. Giữ nguyên tài khoản hiện tại.\n',
        );

        return {
          created: false,
          alreadyExists: true,
          user: existingUser,
          workspace,
          role: mem?.role ?? null,
        };
      }

      // 3. User does not exist, proceed to create inside transaction
      await client.query('BEGIN');

      const adminUserId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);

      // 3.1. Insert into users
      await client.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [adminUserId, usernameNormalized, emailNormalized],
      );

      // 3.2. Insert into user_credentials
      await client.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
        [adminUserId, passwordHash],
      );

      // 3.3. Insert into workspace_memberships with role 'owner'
      await client.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT (workspace_id, user_id)
         DO UPDATE SET role = 'owner', status = 'active';`,
        [workspace.id, adminUserId],
      );

      // 3.4. Insert into user_workspace_bindings (C06 single active binding)
      await client.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
         VALUES ($1, $2, 'active', 1)
         ON CONFLICT (user_id) WHERE status = 'active'
         DO UPDATE SET workspace_id = $1, status = 'active';`,
        [workspace.id, adminUserId],
      );

      // 3.5. Ensure employee profile if employees table exists
      const tableCheck = await client.query(
        `SELECT to_regclass('public.employees') AS exists;`,
      );
      if (tableCheck.rows[0]?.exists) {
        const empCode = usernameNormalized === 'admin' ? 'ADMIN' : `ADM_${adminUserId.slice(0, 4).toUpperCase()}`;
        const existingEmp = await client.query(
          `SELECT id FROM employees WHERE workspace_id = $1 AND employee_code = $2;`,
          [workspace.id, empCode],
        );
        const finalCode = existingEmp.rows.length > 0 ? `ADM_${adminUserId.slice(0, 4).toUpperCase()}` : empCode;
        await client.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
           VALUES ($1, $2, $3, $4, 'active', false)
           ON CONFLICT (workspace_id, employee_code) DO NOTHING;`,
          [workspace.id, adminUserId, finalCode, `Quản trị viên (${username})`],
        );
      }

      // 3.6. Audit record
      await client.query(
        `INSERT INTO audit_events (
           workspace_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_sanitized
         ) VALUES (
           $1, $2, 'user.created', 'user', $3, 'add-admin-script',
           $4
         );`,
        [
          workspace.id,
          adminUserId,
          String(adminUserId),
          JSON.stringify({
            username: usernameNormalized,
            role: 'owner',
            source: 'admin-provisioning',
            timestamp: new Date().toISOString(),
          }),
        ],
      );

      await client.query('COMMIT');

      console.log('\n=========================================');
      console.log('✅ TẠO TÀI KHOẢN ADMIN THÀNH CÔNG');
      console.log('=========================================');
      console.log(`Workspace: "${workspace.name}" (${workspace.id})`);
      console.log(`Username: ${username} (normalized: ${usernameNormalized})`);
      console.log(`Email: ${emailNormalized}`);
      console.log(`Role: Owner (toàn quyền quản lý)`);
      console.log(`Binding: active (C06 preauthorized context)`);
      console.log(`Password: [CONFIGURED]`);
      console.log('=========================================\n');

      return {
        created: true,
        alreadyExists: false,
        user: {
          id: adminUserId,
          username_normalized: usernameNormalized,
          email_normalized: emailNormalized,
        },
        workspace,
        role: 'owner',
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    if (shouldClosePool) {
      await closeDatabasePool(pool);
    }
  }
}

// CLI execution entrypoint
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const getArg = (flag, envKey, fallback) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1].trim();
    if (process.env[envKey]) return process.env[envKey].trim();
    return fallback;
  };

  const username = getArg('--username', 'ADMIN_USERNAME', 'ADMIN');
  if (args.includes('--password')) {
    console.error(
      'Command-line passwords are refused; use ADMIN_PASSWORD in the operator environment.',
    );
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD;
  const email = getArg('--email', 'ADMIN_EMAIL', 'admin@management-lite.local');
  const workspaceId = getArg('--workspace-id', 'WORKSPACE_ID', null);

  if (!password) {
    console.error(
      'Failed to create ADMIN account: Explicit password is required (--password or ADMIN_PASSWORD env var).',
    );
    process.exit(1);
  }

  addAdminAccount({
    username,
    password,
    email,
    workspaceId,
  })
    .then((result) => {
      if (result.alreadyExists) {
        console.log('ADMIN account is ready (previously existed).');
      } else {
        console.log('ADMIN account created successfully.');
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to create ADMIN account:', err.message || err);
      process.exit(1);
    });
}
