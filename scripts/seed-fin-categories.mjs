// Seed default Finance categories for Owner workspace.
// Idempotent: Skips any category that already exists.
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

export const DEFAULT_INCOME_CATEGORIES = [
  'Lương Viettel Post',
  'In ấn – Thiết kế',
  'TikTok',
  'Nguồn khác',
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Tiền nhà',
  'Điện, nước',
  'Internet, điện thoại',
  'Ăn uống, sinh hoạt',
  'Đi lại, xăng xe',
  'Gia đình, con cái',
  'Y tế, sức khỏe',
  'Mua sắm',
  'Chi khác',
];

export async function seedFinanceCategories(pool) {
  const client = await pool.connect();
  try {
    // 1. Find all active Owner workspace memberships (admin and owner)
    const ownerRes = await client.query(`
      SELECT wm.workspace_id, wm.user_id, u.username_normalized, w.name as workspace_name
      FROM workspace_memberships wm
      JOIN workspaces w ON w.id = wm.workspace_id
      JOIN users u ON u.id = wm.user_id
      WHERE wm.role = 'owner'
        AND u.username_normalized IN ('admin', 'owner')
      ORDER BY wm.created_at ASC;
    `);

    if (ownerRes.rows.length === 0) {
      throw new Error('No owner workspace found to seed finance categories.');
    }

    const results = { created: [], skipped: [] };

    const toSeed = [
      ...DEFAULT_INCOME_CATEGORIES.map((name) => ({
        name,
        direction: 'income',
      })),
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        name,
        direction: 'expense',
      })),
    ];

    for (const ownerRow of ownerRes.rows) {
      const { workspace_id, user_id, username_normalized, workspace_name } =
        ownerRow;
      console.log(
        `[Seed FIN] Workspace: "${workspace_name}" (Owner: ${username_normalized} - ${user_id})`,
      );

      for (const item of toSeed) {
        // Check existing active category
        const checkRes = await client.query(
          `
          SELECT id, name FROM fin_categories
          WHERE workspace_id = $1
            AND owner_user_id = $2
            AND direction = $3
            AND lower(NORMALIZE(name, NFC)) = lower(NORMALIZE($4, NFC))
            AND is_active = true;
          `,
          [workspace_id, user_id, item.direction, item.name],
        );

        if (checkRes.rows.length > 0) {
          results.skipped.push({ ...item, id: checkRes.rows[0].id });
          console.log(
            `  [SKIP] ${item.direction.toUpperCase()}: "${item.name}" (already exists)`,
          );
        } else {
          const insertRes = await client.query(
            `
            INSERT INTO fin_categories (workspace_id, owner_user_id, direction, name, is_active, version)
            VALUES ($1, $2, $3, $4, true, 1)
            RETURNING id, name, direction;
            `,
            [workspace_id, user_id, item.direction, item.name],
          );
          const created = insertRes.rows[0];
          results.created.push(created);
          console.log(
            `  [CREATED] ${created.direction.toUpperCase()}: "${created.name}" (${created.id})`,
          );
        }
      }
    }

    return results;
  } finally {
    client.release();
  }
}

// Standalone execution if run directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Refusing: DATABASE_URL must be set explicitly');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  seedFinanceCategories(pool)
    .then((res) => {
      console.log(
        `\nHoàn thành: Tạo mới ${res.created.length}, Bỏ qua trùng lặp ${res.skipped.length}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('Lỗi seed danh mục:', err);
      process.exit(1);
    });
}
