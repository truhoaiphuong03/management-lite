import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './pool.js';
import { sanitizeErrorMessage } from './config.js';
import { EMBEDDED_MIGRATIONS } from './migrations/catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationFile {
  id: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  id: string;
  checksum: string;
  applied_at: Date;
  execution_time_ms: number;
}

export interface MigrationResult {
  appliedCount: number;
  alreadyAppliedCount: number;
  appliedIds: string[];
}

/**
 * 64-bit integer hash for PostgreSQL advisory lock to ensure single-runner concurrency.
 * hashtext('management_lite_migration_lock')
 */
const MIGRATION_ADVISORY_LOCK_ID = 8273645192837461n;

/**
 * Calculates SHA-256 checksum of normalized SQL content.
 */
export function calculateChecksum(sql: string): string {
  const normalized = sql.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Asserts strict 1:1 parity between filesystem migration files and embedded catalog migrations.
 * Prevents drift, divergent schema versions, or unauthenticated migration sources.
 */
export function assertMigrationParity(
  fileMigrations: MigrationFile[],
  catalogMigrations: MigrationFile[],
): void {
  if (fileMigrations.length !== catalogMigrations.length) {
    throw new Error(
      `Migration catalog divergence: filesystem has ${fileMigrations.length} migrations, but embedded catalog has ${catalogMigrations.length}. Migration sources must have strict 1:1 parity.`,
    );
  }

  for (let i = 0; i < fileMigrations.length; i++) {
    const file = fileMigrations[i];
    const cat = catalogMigrations[i];

    if (!file || !cat || file.id !== cat.id) {
      throw new Error(
        `Migration catalog divergence at index ${i}: filesystem has id "${file?.id}", but embedded catalog has id "${cat?.id}".`,
      );
    }

    if (file.checksum !== cat.checksum) {
      throw new Error(
        `Migration checksum divergence for "${file.id}": filesystem checksum (${file.checksum}) does not match embedded catalog checksum (${cat.checksum}). Single source of truth violated.`,
      );
    }
  }
}

/**
 * Loads migration files from filesystem or embedded catalog sorted in strict lexicographical order.
 * Enforces strict checksum and content parity between filesystem and embedded catalog.
 */
export function loadMigrationFiles(migrationsDir?: string): MigrationFile[] {
  let targetDir = migrationsDir;

  if (!targetDir) {
    const candidate1 = path.join(__dirname, 'migrations');
    const candidate2 = path.resolve(
      __dirname,
      '../../../packages/database/src/migrations',
    );
    if (
      fs.existsSync(candidate1) &&
      fs.readdirSync(candidate1).some((f) => f.endsWith('.sql'))
    ) {
      targetDir = candidate1;
    } else if (
      fs.existsSync(candidate2) &&
      fs.readdirSync(candidate2).some((f) => f.endsWith('.sql'))
    ) {
      targetDir = candidate2;
    } else {
      return EMBEDDED_MIGRATIONS;
    }
  }

  if (!fs.existsSync(targetDir)) {
    return EMBEDDED_MIGRATIONS;
  }

  const entries = fs
    .readdirSync(targetDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (entries.length === 0) {
    return EMBEDDED_MIGRATIONS;
  }

  const loadedFiles = entries.map((filename) => {
    const filePath = path.join(targetDir, filename);
    const sql = fs.readFileSync(filePath, 'utf8');
    const id = path.basename(filename, '.sql');
    return {
      id,
      sql,
      checksum: calculateChecksum(sql),
    };
  });

  // Strict verification: When both filesystem files and embedded catalog exist, enforce 1:1 parity
  if (EMBEDDED_MIGRATIONS && EMBEDDED_MIGRATIONS.length > 0) {
    assertMigrationParity(loadedFiles, EMBEDDED_MIGRATIONS);
  }

  return loadedFiles;
}

/**
 * Executes database migrations with:
 * 1. Concurrency lock (pg_advisory_lock)
 * 2. Immutable checksum validation (fail closed on mismatch)
 * 3. Transactional execution per migration
 * 4. Safe idempotent replay
 */
export async function runMigrations(
  pool: DatabasePool,
  migrations: MigrationFile[] = loadMigrationFiles(),
): Promise<MigrationResult> {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // 1. Acquire PostgreSQL advisory lock (blocks concurrent migration runners)
    await client.query('SELECT pg_advisory_lock($1)', [
      MIGRATION_ADVISORY_LOCK_ID.toString(),
    ]);
    lockAcquired = true;

    // 2. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        execution_time_ms integer NOT NULL
      );
    `);

    // 3. Fetch already applied migrations
    const res = await client.query<AppliedMigration>(
      'SELECT id, checksum, applied_at, execution_time_ms FROM schema_migrations ORDER BY id ASC;',
    );
    const appliedMap = new Map<string, AppliedMigration>();
    for (const row of res.rows) {
      appliedMap.set(row.id, row);
    }

    let appliedCount = 0;
    let alreadyAppliedCount = 0;
    const appliedIds: string[] = [];

    // 4. Validate and apply migrations in order
    for (const mig of migrations) {
      const existing = appliedMap.get(mig.id);

      if (existing) {
        // T4 Invariant: checksum mismatch must fail closed
        if (existing.checksum !== mig.checksum) {
          throw new Error(
            `Migration checksum mismatch for "${mig.id}": previously applied with checksum ${existing.checksum}, but migration file has checksum ${mig.checksum}. Schema modification is immutable.`,
          );
        }
        alreadyAppliedCount++;
        continue;
      }

      // Apply pending migration inside an atomic transaction
      const startTime = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(mig.sql);
        const duration = Date.now() - startTime;

        await client.query(
          `INSERT INTO schema_migrations (id, checksum, execution_time_ms) VALUES ($1, $2, $3);`,
          [mig.id, mig.checksum, duration],
        );
        await client.query('COMMIT');

        appliedCount++;
        appliedIds.push(mig.id);
      } catch (err) {
        await client.query('ROLLBACK');
        const rawMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Migration failed at "${mig.id}": ${sanitizeErrorMessage(rawMessage)}`,
        );
      }
    }

    return {
      appliedCount,
      alreadyAppliedCount,
      appliedIds,
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [
          MIGRATION_ADVISORY_LOCK_ID.toString(),
        ]);
      } catch {
        // Ignore unlock error on teardown
      }
    }
    client.release();
  }
}
