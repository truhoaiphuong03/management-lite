-- FIN-01A/impl.6. Additive: full occurred_at (time modes) and private receipt metadata.
-- 0014 is applied history and is not modified. Legacy rows stay occurred_at NULL / legacy_date_only;
-- a time is never inferred from occurred_on or created_at.

CREATE TABLE fin_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  storage_key text NOT NULL CHECK (storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}[.](jpg|png)$'),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'attached', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attached_at timestamptz NULL,
  CHECK (expires_at > created_at),
  CHECK ((state = 'attached') = (attached_at IS NOT NULL)),
  UNIQUE (workspace_id, owner_user_id, id),
  FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspace_memberships (workspace_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX fin_receipts_lifecycle ON fin_receipts (workspace_id, owner_user_id, state, expires_at);
CREATE INDEX fin_receipts_digest ON fin_receipts (workspace_id, owner_user_id, sha256);

CREATE FUNCTION fin_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'attached' THEN
      RAISE EXCEPTION 'Attached FIN receipt is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.workspace_id <> OLD.workspace_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.storage_key <> OLD.storage_key OR NEW.mime_type <> OLD.mime_type
    OR NEW.size_bytes <> OLD.size_bytes OR NEW.sha256 <> OLD.sha256
    OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at
    OR OLD.state <> 'staged' OR NEW.state NOT IN ('attached', 'discarded') THEN
    RAISE EXCEPTION 'Invalid FIN receipt update' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_receipt_update BEFORE UPDATE OR DELETE ON fin_receipts
  FOR EACH ROW EXECUTE FUNCTION fin_receipt_guard();
CREATE TRIGGER fin_receipt_no_truncate BEFORE TRUNCATE ON fin_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION fin_immutable();

CREATE FUNCTION fin_receipt_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspace_memberships
    WHERE workspace_id = NEW.workspace_id AND user_id = NEW.owner_user_id
      AND role = 'owner' AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FIN Owner membership required' USING ERRCODE = '23514'; END IF;
  IF NEW.state <> 'staged' OR NEW.attached_at IS NOT NULL THEN
    RAISE EXCEPTION 'FIN receipt must start staged' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fin_receipt_insert BEFORE INSERT ON fin_receipts
  FOR EACH ROW EXECUTE FUNCTION fin_receipt_insert_guard();

ALTER TABLE fin_entries
  ADD COLUMN occurred_at timestamptz NULL,
  ADD COLUMN occurred_at_source text NOT NULL DEFAULT 'legacy_date_only'
    CHECK (occurred_at_source IN ('legacy_date_only', 'auto', 'manual', 'receipt_confirmed')),
  ADD COLUMN receipt_id uuid NULL,
  ADD CONSTRAINT fin_entries_time_pair CHECK (
    (occurred_at_source = 'legacy_date_only' AND occurred_at IS NULL)
    OR (occurred_at_source <> 'legacy_date_only' AND occurred_at IS NOT NULL
      AND (occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = occurred_on)
  ),
  ADD CONSTRAINT fin_entries_receipt_fk FOREIGN KEY (workspace_id, owner_user_id, receipt_id)
    REFERENCES fin_receipts (workspace_id, owner_user_id, id) ON DELETE RESTRICT;
CREATE INDEX fin_entries_receipt ON fin_entries (workspace_id, owner_user_id, receipt_id) WHERE receipt_id IS NOT NULL;

-- Replaces the 0014 function body; adds non-future time and receipt checks.
CREATE OR REPLACE FUNCTION fin_entry_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE category fin_categories%ROWTYPE; receipt fin_receipts%ROWTYPE;
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
  IF NEW.occurred_at IS NOT NULL AND NEW.occurred_at > clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'FIN time cannot be in the future' USING ERRCODE = '23514';
  END IF;
  IF NEW.receipt_id IS NOT NULL THEN
    SELECT * INTO receipt FROM fin_receipts WHERE workspace_id = NEW.workspace_id
      AND owner_user_id = NEW.owner_user_id AND id = NEW.receipt_id FOR SHARE;
    IF NOT FOUND OR receipt.state <> 'attached' THEN
      RAISE EXCEPTION 'Invalid FIN receipt' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM fin_entries WHERE workspace_id = NEW.workspace_id AND owner_user_id = NEW.owner_user_id
      AND receipt_id = NEW.receipt_id AND root_entry_id <> NEW.root_entry_id;
    IF FOUND THEN RAISE EXCEPTION 'FIN receipt already used' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Replaces the 0014 function body: a time-only or receipt-only change is a valid correction.
CREATE OR REPLACE FUNCTION fin_revision_pair_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF ROW(original.direction, original.category_id, original.amount_vnd, original.occurred_on, original.note,
        original.occurred_at, original.occurred_at_source, original.receipt_id)
      IS NOT DISTINCT FROM ROW(replacement.direction, replacement.category_id, replacement.amount_vnd, replacement.occurred_on, replacement.note,
        replacement.occurred_at, replacement.occurred_at_source, replacement.receipt_id) THEN
      RAISE EXCEPTION 'FIN correction has no change' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON fin_receipts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fin_receipt_guard(), fin_receipt_insert_guard() FROM PUBLIC;
