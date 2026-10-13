-- FIN-01A/design.2. Additive private Owner ledger; no existing table changes.
CREATE TABLE fin_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  normalized_name text GENERATED ALWAYS AS (lower(normalize(name, NFC))) STORED,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_user_id, direction, id),
  FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX fin_category_active_name
  ON fin_categories (workspace_id, owner_user_id, direction, normalized_name) WHERE is_active;

CREATE TABLE fin_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_entry_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  category_id uuid NOT NULL,
  category_name_snapshot text NOT NULL CHECK (char_length(category_name_snapshot) BETWEEN 1 AND 100),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  occurred_on date NOT NULL CHECK (occurred_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  note text NULL CHECK (char_length(note) <= 2000),
  operation_key text NOT NULL CHECK (char_length(operation_key) > 0),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, owner_user_id, id),
  UNIQUE (workspace_id, owner_user_id, root_entry_id, id),
  UNIQUE (workspace_id, owner_user_id, root_entry_id, revision_number),
  UNIQUE (workspace_id, owner_user_id, operation_key),
  CHECK ((revision_number = 1 AND id = root_entry_id) OR (revision_number > 1 AND id <> root_entry_id)),
  FOREIGN KEY (workspace_id, owner_user_id, direction, category_id)
    REFERENCES fin_categories (workspace_id, owner_user_id, direction, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id, root_entry_id)
    REFERENCES fin_entries (workspace_id, owner_user_id, id) ON DELETE RESTRICT
);
CREATE INDEX fin_entries_date ON fin_entries (workspace_id, owner_user_id, occurred_on DESC, id DESC);
CREATE INDEX fin_entries_category_date ON fin_entries (workspace_id, owner_user_id, category_id, occurred_on DESC, id DESC);
CREATE INDEX fin_entries_direction_date ON fin_entries (workspace_id, owner_user_id, direction, occurred_on DESC, id DESC);

CREATE TABLE fin_entry_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  root_entry_id uuid NOT NULL,
  original_revision_id uuid NOT NULL,
  replacement_revision_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 1000),
  actor_user_id uuid NOT NULL CHECK (actor_user_id = owner_user_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (original_revision_id <> replacement_revision_id),
  UNIQUE (workspace_id, owner_user_id, original_revision_id),
  UNIQUE (workspace_id, owner_user_id, replacement_revision_id),
  FOREIGN KEY (workspace_id, owner_user_id, root_entry_id, original_revision_id)
    REFERENCES fin_entries (workspace_id, owner_user_id, root_entry_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id, root_entry_id, replacement_revision_id)
    REFERENCES fin_entries (workspace_id, owner_user_id, root_entry_id, id) ON DELETE RESTRICT
);
CREATE INDEX fin_corrections_history ON fin_entry_corrections (workspace_id, owner_user_id, root_entry_id, created_at, id);

CREATE FUNCTION fin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FIN history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER fin_entries_immutable BEFORE UPDATE OR DELETE ON fin_entries
  FOR EACH ROW EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_corrections_immutable BEFORE UPDATE OR DELETE ON fin_entry_corrections
  FOR EACH ROW EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_entries_no_truncate BEFORE TRUNCATE ON fin_entries
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_corrections_no_truncate BEFORE TRUNCATE ON fin_entry_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();

CREATE FUNCTION fin_category_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.direction <> OLD.direction OR NEW.created_at <> OLD.created_at
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Invalid FIN category update' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_category_update BEFORE UPDATE ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION fin_category_guard();
CREATE TRIGGER fin_category_no_delete BEFORE DELETE ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION fin_immutable();
CREATE TRIGGER fin_category_no_truncate BEFORE TRUNCATE ON fin_categories
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();

CREATE FUNCTION fin_category_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  IF NEW.version <> 1 THEN RAISE EXCEPTION 'Invalid initial FIN category version' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_category_insert BEFORE INSERT ON fin_categories
  FOR EACH ROW EXECUTE FUNCTION fin_category_insert_guard();

-- Shared lock order is membership then category then logical root, before audit.
-- This guard supplements (does not replace) authenticated service authorization.
CREATE FUNCTION fin_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category fin_categories%ROWTYPE;
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO category FROM fin_categories WHERE workspace_id = NEW.workspace_id
    AND owner_user_id = NEW.owner_user_id AND id = NEW.category_id FOR SHARE;
  IF NOT FOUND OR NOT category.is_active OR category.direction <> NEW.direction
    OR category.name <> NEW.category_name_snapshot THEN
    RAISE EXCEPTION 'Invalid FIN category' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision_number > 1 THEN
    PERFORM 1 FROM fin_entries WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND id = NEW.root_entry_id AND revision_number = 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid FIN root' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_entry_insert BEFORE INSERT ON fin_entries
  FOR EACH ROW EXECUTE FUNCTION fin_entry_insert_guard();

-- Both sides must exist at commit. No standalone replacement or detached correction.
CREATE FUNCTION fin_revision_pair_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original fin_entries%ROWTYPE; replacement fin_entries%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'fin_entries' THEN
    IF NEW.revision_number = 1 THEN RETURN NULL; END IF;
    PERFORM 1 FROM fin_entry_corrections WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND root_entry_id = NEW.root_entry_id AND replacement_revision_id = NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FIN replacement needs correction' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO STRICT original FROM fin_entries WHERE id = NEW.original_revision_id;
    SELECT * INTO STRICT replacement FROM fin_entries WHERE id = NEW.replacement_revision_id;
    IF replacement.revision_number <> original.revision_number + 1
      OR replacement.root_entry_id <> original.root_entry_id THEN
      RAISE EXCEPTION 'Invalid FIN revision sequence' USING ERRCODE = '23514';
    END IF;
    IF ROW(original.direction, original.category_id, original.amount_vnd, original.occurred_on, original.note)
      IS NOT DISTINCT FROM ROW(replacement.direction, replacement.category_id, replacement.amount_vnd, replacement.occurred_on, replacement.note) THEN
      RAISE EXCEPTION 'FIN correction has no change' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER fin_revision_pair AFTER INSERT ON fin_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_revision_pair_guard();
CREATE CONSTRAINT TRIGGER fin_correction_pair AFTER INSERT ON fin_entry_corrections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_revision_pair_guard();

REVOKE ALL ON fin_categories, fin_entries, fin_entry_corrections FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fin_immutable(), fin_category_guard(), fin_category_insert_guard(), fin_entry_insert_guard(), fin_revision_pair_guard() FROM PUBLIC;
