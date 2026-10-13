-- Migration: 0018_audit_events_immutable
-- AUDIT-005: refresh the append-only guard without rewriting historical rows.
-- The migrator applies this DDL atomically. Existing migration checksums stay unchanged.
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
