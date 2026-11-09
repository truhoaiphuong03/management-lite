-- Migration: 0038_sync_nv001_timesheet_and_remove_nv002_payroll
-- Scope:
--   1. Allow controlled transaction-local rate & payroll reconciliation (app.allow_rate_sync / app.allow_payroll_reconcile)
--      when synchronizing timesheets from the authoritative Google Sheet while keeping append-only/immutability guards
--      strictly enforced for all normal operations.
--   2. Remove NV002 from payroll (is_payroll_eligible = false, clean up duplicate/test shifts & un-disbursed payroll items).
--   3. Synchronize NV001 (Nguyễn Huỳnh Thế Vinh) hourly rates (T6: 20.000 đ/h, T7+: 25.000 đ/h) and all 61 work days
--      across T6..T11 (including fixing T10 = 9 days / 21,42h / 535.417 đ) from Google Sheet 11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw.

CREATE OR REPLACE FUNCTION pay_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pay:' || NEW.workspace_id::text, 0));
  IF current_setting('app.allow_rate_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL) THEN RAISE EXCEPTION 'Rate closure is one-way'; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'effective_to') IS DISTINCT FROM (to_jsonb(NEW) - 'effective_to') THEN
    RAISE EXCEPTION 'Rate history is immutable except interval closure';
  END IF;
  IF EXISTS (SELECT 1 FROM employee_hourly_rates r WHERE r.workspace_id = NEW.workspace_id
    AND r.employee_id = NEW.employee_id AND r.id <> NEW.id
    AND tstzrange(r.effective_from, r.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')) THEN
    RAISE EXCEPTION 'Overlapping hourly rates';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pay_rate_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_rate_sync', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PAY history is append-only';
END $$;

DROP TRIGGER IF EXISTS pay_rate_no_delete ON employee_hourly_rates;
CREATE TRIGGER pay_rate_no_delete
  BEFORE DELETE ON employee_hourly_rates
  FOR EACH ROW EXECUTE FUNCTION pay_rate_delete_guard();

CREATE OR REPLACE FUNCTION pay_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.period_month <> OLD.period_month THEN
    RAISE EXCEPTION 'PAY period identity is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pay_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; p uuid; w uuid; state text;
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE' AND (NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id) THEN
      RAISE EXCEPTION 'PAY child identity is immutable';
    END IF;
    r := OLD;
  ELSE r := NEW; END IF;
  w := r.workspace_id;
  IF TG_TABLE_NAME = 'payroll_employee_items' THEN
    IF EXISTS (SELECT 1 FROM employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id WHERE e.workspace_id=w AND e.id=r.employee_id AND m.role='owner') THEN RAISE EXCEPTION 'Owner excluded from PAY'; END IF;
    p := r.period_id;
  ELSE SELECT period_id INTO p FROM payroll_employee_items WHERE workspace_id = w AND id = r.payroll_item_id; END IF;
  SELECT status INTO state FROM payroll_periods WHERE workspace_id = w AND id = p FOR UPDATE;
  IF state = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'payroll_employee_items' THEN
      IF NEW.period_id <> OLD.period_id OR NEW.employee_id <> OLD.employee_id THEN RAISE EXCEPTION 'PAY parent is immutable'; END IF;
    ELSIF NEW.payroll_item_id <> OLD.payroll_item_id THEN RAISE EXCEPTION 'PAY parent is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_attendance_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'attendance_shift_versions is immutable: % prohibited', TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_daily_report_revisions_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'daily_report_revisions is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON employees, employee_hourly_rates, attendance_shifts, attendance_shift_versions, attendance_approvals, attendance_breaks, attendance_adjustments, attendance_correction_requests, daily_reports, daily_report_entries, daily_report_revisions, payroll_periods, payroll_employee_items, payroll_daily_breakdowns, payroll_adjustments TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_ws record;
  v_actor_id uuid;
  v_nv001_id uuid;
  v_nv002 record;
  v_row record;
  v_shift_id uuid;
  v_ver_id uuid;
  v_rep_id uuid;
  v_clock_in timestamptz;
  v_clock_out timestamptz;
  v_worked_sec bigint;
  v_ref text;
  v_hash text;
BEGIN
  PERFORM set_config('app.allow_rate_sync', 'on', true);
  PERFORM set_config('app.allow_payroll_reconcile', 'on', true);

  FOR v_ws IN
    SELECT w.id, w.name
    FROM workspaces w
    WHERE w.status = 'active'
      AND btrim(w.name) IN (
        'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
        'Hoài Phương Media',
        'HOÀI PHƯƠNG MEDIA',
        'Hoài Phương Studio'
      )
  LOOP
    SELECT m.user_id INTO v_actor_id
    FROM workspace_memberships m
    WHERE m.workspace_id = v_ws.id AND m.role = 'owner' AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1;

    IF v_actor_id IS NULL THEN
      SELECT m.user_id INTO v_actor_id
      FROM workspace_memberships m
      WHERE m.workspace_id = v_ws.id
      ORDER BY m.created_at ASC
      LIMIT 1;
    END IF;

    -- 1. Remove NV002 from payroll and clean up NV002 shifts/rates/un-disbursed payroll items
    FOR v_nv002 IN
      SELECT e.id, e.user_id
      FROM employees e
      WHERE e.workspace_id = v_ws.id AND e.employee_code = 'NV002'
    LOOP
      UPDATE employees
      SET is_payroll_eligible = FALSE,
          employment_status = CASE WHEN user_id IS NULL THEN 'inactive' ELSE employment_status END,
          updated_at = now()
      WHERE workspace_id = v_ws.id AND id = v_nv002.id;

      DELETE FROM payroll_adjustments pa
      USING payroll_employee_items pei
      WHERE pa.workspace_id = v_ws.id
        AND pa.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      DELETE FROM payroll_daily_breakdowns pdb
      USING payroll_employee_items pei
      WHERE pdb.workspace_id = v_ws.id
        AND pdb.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      DELETE FROM payroll_employee_items pei
      WHERE pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      UPDATE attendance_shifts
      SET current_version_id = NULL
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;

      DELETE FROM attendance_approvals
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_adjustments
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_correction_requests
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_breaks
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_shift_versions
      WHERE workspace_id = v_ws.id
        AND shift_id IN (SELECT id FROM attendance_shifts WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM attendance_shifts
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;

      DELETE FROM daily_report_entries
      WHERE workspace_id = v_ws.id
        AND report_id IN (SELECT id FROM daily_reports WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM daily_report_revisions
      WHERE workspace_id = v_ws.id
        AND report_id IN (SELECT id FROM daily_reports WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id);

      DELETE FROM daily_reports
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;

      DELETE FROM employee_hourly_rates
      WHERE workspace_id = v_ws.id AND employee_id = v_nv002.id;
    END LOOP;

    -- 2. Synchronize NV001 (Nguyễn Huỳnh Thế Vinh)
    SELECT e.id INTO v_nv001_id
    FROM employees e
    WHERE e.workspace_id = v_ws.id AND e.employee_code = 'NV001'
    LIMIT 1;

    IF v_nv001_id IS NOT NULL AND v_actor_id IS NOT NULL THEN
      UPDATE employees
      SET full_name = 'Nguyễn Huỳnh Thế Vinh',
          is_payroll_eligible = TRUE,
          employment_status = 'active',
          bank_name = COALESCE(NULLIF(btrim(bank_name), ''), 'Vietcombank'),
          bank_account_number = COALESCE(NULLIF(btrim(bank_account_number), ''), '1031739417'),
          bank_account_holder = COALESCE(NULLIF(btrim(bank_account_holder), ''), 'NGUYEN HUYNH THE VINH'),
          updated_at = now()
      WHERE workspace_id = v_ws.id AND id = v_nv001_id;

      -- Replace NV001 hourly rates with exact segments from Google Sheet:
      -- T6 (2026-06-01 .. 2026-07-01): 20.000 đ/h
      -- T7+ (2026-07-01 .. NULL): 25.000 đ/h
      DELETE FROM employee_hourly_rates
      WHERE workspace_id = v_ws.id AND employee_id = v_nv001_id;

      INSERT INTO employee_hourly_rates (
        workspace_id, employee_id, hourly_rate_vnd, effective_from, effective_to, created_by
      ) VALUES
        (v_ws.id, v_nv001_id, 20000, '2026-06-01T00:00:00+07:00'::timestamptz, '2026-07-01T00:00:00+07:00'::timestamptz, v_actor_id),
        (v_ws.id, v_nv001_id, 25000, '2026-07-01T00:00:00+07:00'::timestamptz, NULL, v_actor_id);

      -- Clear NV001 shifts up through 2026-11-06 (preserving any newer live web clock-ins after 2026-11-06)
      UPDATE attendance_shifts
      SET current_version_id = NULL
      WHERE workspace_id = v_ws.id
        AND employee_id = v_nv001_id
        AND (source = 'import' OR clock_in_at < '2026-11-07T00:00:00+07:00'::timestamptz);

      DELETE FROM attendance_approvals
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_adjustments
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_correction_requests
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_breaks
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_shift_versions
      WHERE workspace_id = v_ws.id
        AND shift_id IN (
          SELECT id FROM attendance_shifts
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND current_version_id IS NULL
        );

      DELETE FROM attendance_shifts
      WHERE workspace_id = v_ws.id
        AND employee_id = v_nv001_id
        AND current_version_id IS NULL;

      -- Insert the exact 61 shifts & daily reports from Google Sheet 11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw
      FOR v_row IN
        SELECT * FROM (VALUES
          -- T6 (14 days, 57.17h, rate 20.000 -> 1.143.333 đ)
          ('2026-06-01'::date, 540, 720, ''::text, 0),
          ('2026-06-02'::date, 540, 780, ''::text, 0),
          ('2026-06-03'::date, 570, 810, ''::text, 0),
          ('2026-06-04'::date, 570, 690, 'Edit 8 clip kênh LSK'::text, 8),
          ('2026-06-08'::date, 570, 930, 'Edit 8 clip LSK: 4 Tonic, 2 men rắc, 2 tiêu phân-khử mùi; 4 clip LSKMM: 2 men rắc thảo dược, 2 men rắc tiêu phân - khử mùi'::text, 12),
          ('2026-06-09'::date, 570, 810, '6 clip LSK: 2 Linco, 2 bổ gan thận, 2 Canxi B12. Phụ live TikTok'::text, 6),
          ('2026-06-10'::date, 630, 900, '8 clip LSK: 4 Flodoxy, 4 Fensit. Live kênh LSKMM'::text, 8),
          ('2026-06-15'::date, 630, 840, '4 Clip LSK: 2 Flodoxy, 2 Fensit. Phụ Live Tiktok'::text, 4),
          ('2026-06-17'::date, 540, 900, '10 clip LSK: giải độc gan, Tonic, Flodoxy, Linco, Fensit'::text, 10),
          ('2026-06-18'::date, 810, 1020, '2 clip thực tế Linco, 1 clip thực tế Flodoxy'::text, 3),
          ('2026-06-19'::date, 630, 900, '6 clip thực tế: 3 Flodoxy,  3 Fensit'::text, 6),
          ('2026-06-22'::date, 630, 810, '8 clip LSKMM: Flodoxy, Fensit, Linco, Flucasol. LIVE'::text, 8),
          ('2026-06-23'::date, 630, 900, '6 clip LSK: linco, 4 fensit, flucasol. LIVE. 4 clip thực tế: 2 fensit, 2 flodoxy'::text, 10),
          ('2026-06-24'::date, 640, 920, '5 clip thực tế: 2 flodoxy, 2 tonic, 1 canxi B12'::text, 5),
          -- T7 (10 days, 34.33h, rate 25.000 -> 858.334 đ)
          ('2026-07-03'::date, 675, 900, '8 clip thực tế cho: flodoxy, linco, men rắc tiêu phân, fensit'::text, 8),
          ('2026-07-07'::date, 680, 910, '7 clip LSK: 2Tonic, 3 linco, 2men rắc tiêu phân-khử mùi | 7 clip LSKMM'::text, 14),
          ('2026-07-09'::date, 795, 915, '8 clip LSK: linco, tonic, canxiB12, giải độc gan'::text, 8),
          ('2026-07-14'::date, 585, 885, 'LSK: 10 clip: 2 canxi B12, 2 Gan, 2 Tonic, 4 Men sống| Thực tế: 3 men sống, 3 fensit'::text, 16),
          ('2026-07-20'::date, 635, 840, '9 clip thực tế: Fensit, Linco, Men sống'::text, 9),
          ('2026-07-21'::date, 635, 840, '17 clip kênh LSK: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit'::text, 17),
          ('2026-07-22'::date, 705, 870, '17 clip kênh LSKMM: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit'::text, 17),
          ('2026-07-23'::date, 715, 950, '8 clip LSK: men sống, flucasol, fensit, linco. 2 clip thực tế linco, men thảo dược.'::text, 10),
          ('2026-07-29'::date, 820, 1000, 'LSKMM:5 clip Nuôi gà theo mệnh. | Kenh2:15 clip MMG. | COCO: 15 clip MMG.'::text, 35),
          ('2026-07-30'::date, 800, 995, '3 clip thực tế: linco, 3 clip thực tế men sống, 1 clip thực tế fensit.'::text, 7),
          -- T8 (11 days, 30.87h, rate 25.000 -> 771.668 đ)
          ('2026-08-04'::date, 635, 840, '17 clip LSK: fensit, linco, canxi, men sống, men rắc, flodoxy, flucasol'::text, 17),
          ('2026-08-05'::date, 860, 1020, 'LSKMM: 15 clip màu mệnh, 5 clip mệnh gà. COCO: 15 clip màu mệnh'::text, 35),
          ('2026-08-06'::date, 840, 1000, '8 clip thực tế: men sống, linco, fensit.'::text, 8),
          ('2026-08-13'::date, 805, 940, 'LSKMM: 16 clip MMG, COCO: 16 clip MMG. Chèn nhạc vào clip LSK 0408 30 phút( tại nhà)'::text, 32),
          ('2026-08-14'::date, 840, 970, 'LSKMM: 15 clip MMG, COCO: 15 clip MM'::text, 30),
          ('2026-08-16'::date, 860, 960, 'LSKMM: 15 clip MMG, COCO: 15 clip MM'::text, 30),
          ('2026-08-18'::date, 700, 975, 'LSK: 2 men song, 2 linco, 2flucasol, 2 canxi. 2 fensit, 1 gđ gan, 1 tonic, 1 flodoxy, 1 men rắc'::text, 14),
          ('2026-08-19'::date, 770, 960, 'LSK: 2flodoxy, 2 GDGan, 2Tonic, 2Men song, 2 Men rắc, 1 linco,1 đẹn, 1fensit, 1 canxi'::text, 14),
          ('2026-08-20'::date, 840, 1020, 'LSK 17 clip: linco, flucasol, fensit, canxi, flodoxy, Gan, Tonic, Men rắc, Men sống'::text, 17),
          ('2026-08-28'::date, 870, 1020, '22 clip nhà máy cho kênh tạp hóa'::text, 22),
          ('2026-08-29'::date, 860, 1027, '76 clip kênh tạp hóa cho các Dot4,5,6,7,8,9'::text, 76),
          -- T9 (13 days, 33.25h, rate 25.000 -> 831.250 đ)
          ('2026-09-03'::date, 840, 990, '16 CLIP TRẠI GÀ, 29 CLIP BaPhat'::text, 45),
          ('2026-09-04'::date, 860, 1040, '25 clip tạp hóa, 25 clip BaPhat.'::text, 50),
          ('2026-09-05'::date, 795, 1065, 'taphoanhabinh:40 clip. Baphat: 48 clip'::text, 88),
          ('2026-09-06'::date, 795, 915, '18 clip nhamaythuocga. 24 clip baphatreview'::text, 42),
          ('2026-09-08'::date, 865, 1035, 'taphoa.24sp.0509; baphat.24sp.0509.dot2; batphat.24sp.0609.dot1'::text, 0),
          ('2026-09-09'::date, 1080, 1200, '48 clip baphat dot1, dot2'::text, 48),
          ('2026-09-10'::date, 800, 1095, 'Tạp Hóa: 80 clip. Bá Phát: 56 clip'::text, 136),
          ('2026-09-16'::date, 1290, 1350, 'Tạp hóa: 22 clip (không có lỗi)'::text, 22),
          ('2026-09-17'::date, 840, 990, 'taphoa: 27 clip. baphat: 54 clip'::text, 81),
          ('2026-09-22'::date, 870, 1050, 'tạp hóa: 39 clip. baphat: 38 clip'::text, 77),
          ('2026-09-23'::date, 920, 1040, 'tạp hóa: 55 clip'::text, 55),
          ('2026-09-24'::date, 960, 1080, 'taphoa: 58 clip'::text, 58),
          ('2026-09-25'::date, 840, 900, 'taphoa: 32 clip'::text, 32),
          -- T10 (9 days, 21.42h, rate 25.000 -> 535.417 đ)
          ('2026-10-05'::date, 825, 885, '26 clip tạp hóa'::text, 26),
          ('2026-10-13'::date, 840, 960, '59 clip tạp hóa'::text, 59),
          ('2026-10-14'::date, 800, 980, '70 clip tạp hóa'::text, 70),
          ('2026-10-15'::date, 860, 1040, '44 clip tạp hóa'::text, 44),
          ('2026-10-21'::date, 840, 1000, '38 clip tạp hóa'::text, 38),
          ('2026-10-27'::date, 890, 1000, '33 clip taphoa'::text, 33),
          ('2026-10-28'::date, 870, 1020, 'tìm source, edit cho 2 clip chia sẻ thực tế'::text, 2),
          ('2026-10-29'::date, 875, 995, 'VUKY: 2 CLIP. Clip thực tế: 1'::text, 3),
          ('2026-10-30'::date, 825, 1030, '3 clip VUKY, 2 clip NUOIKENH'::text, 5),
          -- T11 (4 days up to 06/11, 11.50h, rate 25.000 -> 287.500 đ)
          ('2026-11-03'::date, 870, 1005, '3 vuky, 2 nuoikenh'::text, 5),
          ('2026-11-04'::date, 885, 1050, '3 vuky, 2 nuoi kenh'::text, 5),
          ('2026-11-05'::date, 1005, 1155, '2 VUKY, 2 NUOIKENH'::text, 4),
          ('2026-11-06'::date, 855, 1095, '4 VUKY. 4 NUOIKENH'::text, 8)
        ) AS t(work_date, start_min, end_min, task_text, clip_count)
      LOOP
        v_clock_in := (v_row.work_date::text || 'T00:00:00+07:00')::timestamptz + make_interval(mins => v_row.start_min);
        v_clock_out := (v_row.work_date::text || 'T00:00:00+07:00')::timestamptz + make_interval(mins => v_row.end_min);
        v_worked_sec := (v_row.end_min - v_row.start_min) * 60;
        v_ref := 'timesheet:' || v_nv001_id::text || ':' || v_row.work_date::text;
        v_shift_id := gen_random_uuid();
        v_ver_id := gen_random_uuid();
        v_hash := encode(sha256(convert_to(v_shift_id::text || ':' || v_clock_in::text || ':' || v_clock_out::text || ':' || v_worked_sec::text, 'UTF8')), 'hex');

        INSERT INTO attendance_shifts (
          id, workspace_id, employee_id, clock_in_at, clock_out_at,
          run_state, review_state, current_version_id, version, source, import_ref
        ) VALUES (
          v_shift_id, v_ws.id, v_nv001_id, v_clock_in, v_clock_out,
          'completed', 'approved', NULL, 1, 'import', v_ref
        );

        INSERT INTO attendance_shift_versions (
          id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at,
          breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason
        ) VALUES (
          v_ver_id, v_ws.id, v_shift_id, 1, v_clock_in, v_clock_out,
          '[]'::jsonb, v_worked_sec, v_hash, v_actor_id, '[TIMESHEET-IMPORT]'
        );

        UPDATE attendance_shifts
        SET current_version_id = v_ver_id
        WHERE id = v_shift_id;

        INSERT INTO attendance_approvals (
          workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason
        ) VALUES (
          v_ws.id, v_shift_id, v_ver_id, v_actor_id, 'approved', '[TIMESHEET-IMPORT]'
        );

        IF length(btrim(v_row.task_text)) > 0 THEN
          SELECT id INTO v_rep_id
          FROM daily_reports
          WHERE workspace_id = v_ws.id
            AND employee_id = v_nv001_id
            AND report_date = v_row.work_date
          LIMIT 1;

          IF v_rep_id IS NULL THEN
            v_rep_id := gen_random_uuid();
            INSERT INTO daily_reports (
              id, workspace_id, employee_id, report_date, status, notes, submitted_at, current_revision, version
            ) VALUES (
              v_rep_id, v_ws.id, v_nv001_id, v_row.work_date, 'submitted',
              left(v_row.task_text, 2000), v_clock_out, 1, 1
            );

            INSERT INTO daily_report_entries (
              workspace_id, report_id, work_type, reported_count, notes, sort_order
            ) VALUES (
              v_ws.id, v_rep_id,
              CASE WHEN v_row.clip_count > 0 THEN 'Dựng clip' ELSE 'Công việc ngày' END,
              GREATEST(0, v_row.clip_count),
              left(v_row.task_text, 500),
              0
            );

            INSERT INTO daily_report_revisions (
              workspace_id, report_id, revision_number, status, snapshot, reason, edited_by
            ) VALUES (
              v_ws.id, v_rep_id, 1, 'submitted',
              jsonb_build_object(
                'entries', jsonb_build_array(
                  jsonb_build_object(
                    'work_type', CASE WHEN v_row.clip_count > 0 THEN 'Dựng clip' ELSE 'Công việc ngày' END,
                    'reported_count', GREATEST(0, v_row.clip_count),
                    'notes', left(v_row.task_text, 500),
                    'sort_order', 0
                  )
                ),
                'notes', left(v_row.task_text, 2000)
              ),
              '[TIMESHEET-IMPORT]', v_actor_id
            );
          END IF;
        END IF;
      END LOOP;

      -- Re-open any un-disbursed 2026 payroll periods so /payroll computes fresh from the synced shifts
      DELETE FROM payroll_daily_breakdowns pdb
      USING payroll_employee_items pei, payroll_periods pp
      WHERE pdb.workspace_id = v_ws.id
        AND pdb.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.period_id = pp.id
        AND pp.workspace_id = v_ws.id
        AND pp.period_month LIKE '2026-%'
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        );

      DELETE FROM payroll_employee_items pei
      USING payroll_periods pp
      WHERE pei.workspace_id = v_ws.id
        AND pei.period_id = pp.id
        AND pp.workspace_id = v_ws.id
        AND pp.period_month LIKE '2026-%'
        AND NOT EXISTS (
          SELECT 1 FROM payroll_disbursements pd
          WHERE pd.workspace_id = v_ws.id AND pd.payroll_item_id = pei.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_adjustments pa
          WHERE pa.workspace_id = v_ws.id AND pa.payroll_item_id = pei.id
        );

      UPDATE payroll_periods pp
      SET status = 'draft',
          finalized_at = NULL,
          finalized_by = NULL,
          finalized_snapshot_hash = NULL,
          updated_at = now()
      WHERE pp.workspace_id = v_ws.id
        AND pp.period_month LIKE '2026-%'
        AND pp.status = 'finalized'
        AND NOT EXISTS (
          SELECT 1
          FROM payroll_employee_items pei
          JOIN payroll_disbursements pd ON pd.workspace_id = pei.workspace_id AND pd.payroll_item_id = pei.id
          WHERE pei.workspace_id = v_ws.id AND pei.period_id = pp.id
        );
    END IF;
  END LOOP;

  PERFORM set_config('app.allow_rate_sync', 'off', true);
  PERFORM set_config('app.allow_payroll_reconcile', 'off', true);
END $$;
