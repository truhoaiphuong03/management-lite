import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadExplicitDatabaseConfig } from './explicit-database.mjs';
import {
  createDatabasePool,
  closeDatabasePool,
} from '../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../dist/packages/database/src/migrator.js';
import {
  hashPassword,
  validatePasswordStrength,
} from '../dist/packages/security/src/password.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Local operator tool for a new installation, never password recovery or promotion.
export async function bootstrapOwner(env = process.env) {
  const config = loadExplicitDatabaseConfig(env);
  if (env.CONFIRM_BOOTSTRAP_OWNER !== 'create-new-installation')
    throw new Error('Explicit first-install confirmation is required.');
  for (const key of ['OWNER_PASSWORD', 'STAFF_PASSWORD']) {
    if (!validatePasswordStrength(env[key]).valid)
      throw new Error(`Explicit valid ${key} is required.`);
  }
  const owner = {
    username: (env.OWNER_USERNAME || 'owner').trim().toLowerCase(),
    email: (env.OWNER_EMAIL || 'owner@management-lite.local')
      .trim()
      .toLowerCase(),
  };
  const staff = {
    username: (env.STAFF_USERNAME || 'staff').trim().toLowerCase(),
    email: (env.STAFF_EMAIL || 'staff@management-lite.local')
      .trim()
      .toLowerCase(),
  };
  if (
    !owner.username ||
    !staff.username ||
    !owner.email ||
    !staff.email ||
    owner.username === staff.username ||
    owner.email === staff.email
  )
    throw new Error('Owner and Staff require distinct nonempty identities.');
  const pool = createDatabasePool(config);
  const client = await pool.connect().catch(async (error) => {
    await closeDatabasePool(pool);
    throw error;
  });
  let locked = false;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('management-lite:first-install'))",
    );
    locked = true;
    for (const table of ['users', 'workspaces']) {
      const exists = (
        await client.query('SELECT to_regclass($1) AS name', [
          `public.${table}`,
        ])
      ).rows[0].name;
      if (
        exists &&
        (await client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount
      )
        throw new Error(
          'Bootstrap refused: installation already contains users or workspaces.',
        );
    }
    await runMigrations(
      pool,
      loadMigrationFiles(resolve(root, 'packages/database/src/migrations')),
    );
    await client.query('BEGIN');
    await client.query('LOCK TABLE users, workspaces IN EXCLUSIVE MODE');
    if (
      (
        await client.query(
          'SELECT 1 FROM users UNION ALL SELECT 1 FROM workspaces LIMIT 1',
        )
      ).rowCount
    )
      throw new Error('Bootstrap refused: installation is no longer empty.');
    const workspaceId = randomUUID();
    await client.query(
      "INSERT INTO workspaces(id,name,timezone,status) VALUES($1,$2,'Asia/Ho_Chi_Minh','active')",
      [workspaceId, env.WORKSPACE_NAME || 'Cửa hàng Management Lite'],
    );
    for (const [actor, role, password, code, name] of [
      [owner, 'owner', env.OWNER_PASSWORD, 'OWNER', 'Chủ sở hữu'],
      [staff, 'staff', env.STAFF_PASSWORD, 'NV001', 'Nhân viên 01'],
    ]) {
      const id = randomUUID();
      await client.query(
        "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES($1,$2,$3,'active')",
        [id, actor.username, actor.email],
      );
      await client.query(
        'INSERT INTO user_credentials(user_id,password_hash,credential_version) VALUES($1,$2,1)',
        [id, await hashPassword(password)],
      );
      await client.query(
        "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,$3,'active')",
        [workspaceId, id, role],
      );
      await client.query(
        "INSERT INTO user_workspace_bindings(workspace_id,user_id,status,version) VALUES($1,$2,'active',1)",
        [workspaceId, id],
      );
      await client.query(
        "INSERT INTO employees(workspace_id,user_id,employee_code,full_name,employment_status,is_payroll_eligible) VALUES($1,$2,$3,$4,'active',$5)",
        [workspaceId, id, code, name, role === 'staff'],
      );
      if (role === 'owner') owner.id = id;
    }
    await client.query(
      "INSERT INTO audit_events(workspace_id,actor_user_id,action,entity_type,entity_id,request_id,metadata_sanitized) VALUES($1::uuid,$2,'workspace.bootstrapped','workspace',$1::text,'bootstrap-script','{}'::jsonb)",
      [workspaceId, owner.id],
    );
    await client.query('COMMIT');
    return { created: true, workspaceId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked)
      await client
        .query(
          "SELECT pg_advisory_unlock(hashtext('management-lite:first-install'))",
        )
        .catch(() => {});
    client.release();
    await closeDatabasePool(pool);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error(
      'Bootstrap accepts environment configuration only; command-line credentials are refused.',
    );
    process.exitCode = 1;
  } else {
    bootstrapOwner()
      .then(() => console.log('New installation bootstrapped successfully.'))
      .catch(() => {
        console.error(
          'Bootstrap refused or failed; no existing account was updated.',
        );
        process.exitCode = 1;
      });
  }
}
