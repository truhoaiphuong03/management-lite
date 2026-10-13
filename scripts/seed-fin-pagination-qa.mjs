// Seed pagination QA data for the `admin` Owner. REFUSES any DB that is not an isolated `fin_qa_*` database.
// Creates 12 extra expense categories (+ 13 standard => >= 25) and dedicated per-count categories
// "QA-N" holding exactly N entries each (N = 0,1,10,11,20,21,55) so list sizes can be tested via filters.
import crypto from 'node:crypto';
import pg from 'pg';

const url = process.env.FIN_QA_DATABASE_URL ?? '';
const name = /\/(fin_qa_[a-z0-9_]+)$/.exec(url)?.[1];
if (!name) {
  console.error(
    'Refusing: FIN_QA_DATABASE_URL must point to a fin_qa_* database',
  );
  process.exit(1);
}
const COUNTS = [0, 1, 10, 11, 20, 21, 55];
const pool = new pg.Pool({ connectionString: url });
const c = await pool.connect();
try {
  await c.query('BEGIN');
  const owner = (
    await c.query(
      `SELECT wm.workspace_id, wm.user_id FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id WHERE u.username_normalized='admin' AND wm.role='owner' LIMIT 1`,
    )
  ).rows[0];
  if (!owner) throw new Error('admin owner not found');
  const addCategory = async (label, direction) => {
    const id = crypto.randomUUID();
    await c.query(
      `INSERT INTO fin_categories (id, workspace_id, owner_user_id, direction, name) VALUES ($1,$2,$3,$4,$5)`,
      [id, owner.workspace_id, owner.user_id, direction, label],
    );
    return id;
  };
  for (let i = 1; i <= 12; i++)
    await addCategory(
      `QA Danh mục phụ ${String(i).padStart(2, '0')}`,
      'expense',
    );
  let seq = 0;
  for (const n of COUNTS) {
    const cat = await addCategory(`QA-${n}`, 'expense');
    for (let i = 0; i < n; i++) {
      const id = crypto.randomUUID();
      const day = 1 + ((seq + i) % 28);
      const withTime = i % 2 === 0;
      await c.query(
        `INSERT INTO fin_entries (id, root_entry_id, workspace_id, owner_user_id, revision_number, direction, category_id, category_name_snapshot, amount_vnd, occurred_on, note, operation_key, request_fingerprint${withTime ? ', occurred_at, occurred_at_source' : ''})
         VALUES ($1,$1,$2,$3,1,'expense',$4,$5,$6,$7::date,$8,$9,$10${withTime ? `, ($7::date + time '08:00' + ($11 || ' minutes')::interval) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'manual'` : ''})`,
        [
          id,
          owner.workspace_id,
          owner.user_id,
          cat,
          `QA-${n}`,
          1000 * (i + 1),
          `2026-09-${String(day).padStart(2, '0')}`,
          `Giao dịch thử ${n}-${i + 1}`,
          `qa-pg-${n}-${i}-${crypto.randomUUID()}`,
          crypto.randomBytes(32).toString('hex'),
          ...(withTime ? [String(i)] : []),
        ],
      );
    }
    seq += n;
  }
  await c.query('COMMIT');
  const t = (
    await c.query(
      `SELECT (SELECT count(*) FROM fin_entries) e, (SELECT count(*) FROM fin_categories WHERE owner_user_id=$1) c`,
      [owner.user_id],
    )
  ).rows[0];
  console.log(`Seeded ${name}: entries=${t.e}, admin categories=${t.c}`);
} catch (e) {
  await c.query('ROLLBACK');
  console.error(e);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
