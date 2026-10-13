-- FIN-PLAN-MVP. Additive private Owner plan ("Ke hoach thu chi co dinh").
-- Independent from fin_entries: a plan item is a monthly estimate, never a ledger transaction.
-- 0014/0015 are applied history and are not modified. Amounts are exact bigint VND (no floats).
-- Upper bound 9,999,999,999,999 per item keeps every sum and the weekly conversion far below bigint limits.
CREATE TABLE fin_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  category_id uuid NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd BETWEEN 1 AND 9999999999999),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id, direction, category_id)
    REFERENCES fin_categories (workspace_id, owner_user_id, direction, id) ON DELETE RESTRICT
);
CREATE INDEX fin_plan_items_owner
  ON fin_plan_items (workspace_id, owner_user_id, direction, is_active, created_at, id);
