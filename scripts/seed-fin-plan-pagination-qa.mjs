// Seed (or clear) FIN plan items for pagination QA. REFUSES any DB that is not an isolated `fin_qa_*` database.
// Usage: FIN_QA_DATABASE_URL=... node scripts/seed-fin-plan-pagination-qa.mjs [--clear]
// Seeds for the `admin` Owner: 12 active expense items of 1.000.000 (total 12.000.000) + 1 income item.
import pg from 'pg';

const url = process.env.FIN_QA_DATABASE_URL ?? '';
if (!/\/fin_qa_[a-z0-9_]+$/.test(url)) {
  console.error(
    'Refusing: FIN_QA_DATABASE_URL must point to a fin_qa_* database',
  );
  process.exit(1);
}
const clear = process.argv.includes('--clear');
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
  await c.query(
    'DELETE FROM fin_plan_items WHERE workspace_id=$1 AND owner_user_id=$2',
    [owner.workspace_id, owner.user_id],
  );
  if (!clear) {
    const cats = async (direction, n) =>
      (
        await c.query(
          `SELECT id FROM fin_categories WHERE workspace_id=$1 AND owner_user_id=$2 AND direction=$3 AND is_active ORDER BY normalized_name LIMIT $4`,
          [owner.workspace_id, owner.user_id, direction, n],
        )
      ).rows;
    const exp = await cats('expense', 12);
    const inc = await cats('income', 1);
    if (exp.length < 12 || inc.length < 1)
      throw new Error('not enough categories');
    for (const [direction, rows] of [
      ['expense', exp],
      ['income', inc],
    ])
      for (const r of rows)
        await c.query(
          `INSERT INTO fin_plan_items(workspace_id,owner_user_id,direction,category_id,amount_vnd) VALUES ($1,$2,$3,$4,1000000)`,
          [owner.workspace_id, owner.user_id, direction, r.id],
        );
  }
  await c.query('COMMIT');
  console.log(
    clear ? 'plan items cleared' : 'plan items seeded (12 expense + 1 income)',
  );
} catch (e) {
  await c.query('ROLLBACK');
  console.error(e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
