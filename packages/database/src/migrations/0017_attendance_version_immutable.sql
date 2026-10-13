-- Migration: 0017_attendance_version_immutable
-- Enforce the existing ATT contract: corrections append versions, never rewrite history.
-- No data rewrite. Apply only through the normal migration gate.
CREATE OR REPLACE FUNCTION prevent_attendance_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance_shift_versions is immutable: % prohibited', TG_OP;
END;
$$;

CREATE TRIGGER attendance_version_immutable
  BEFORE UPDATE OR DELETE ON attendance_shift_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_version_mutation();
