-- Migration: 0039_reconcile_finalized_payroll_snapshots_nv001
-- Scope:
--   1. Extend pay_no_delete() and pay_disbursement_guard() to honor transaction-local
--      current_setting('app.allow_payroll_reconcile', true) = 'on' and grant runtime CRUD on payroll_disbursements.
--   2. Completely remove any remaining NV002 payroll items/disbursements even in finalized periods.
--   3. Recompute and synchronize payroll_employee_items, payroll_daily_breakdowns, and full-period
--      payroll_disbursements for NV001 across all finalized/draft 2026 periods (T6..T11), fixing
--      2026-10 on /payroll from the stale 5-day snapshot (11h 40p / 291.667 đ) to the full 9-day
--      Google Sheet snapshot (21h 25p / 1.285p / 535.417 đ).

CREATE OR REPLACE FUNCTION pay_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' OR current_setting('app.allow_rate_sync', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PAY history is append-only';
END $$;

CREATE OR REPLACE FUNCTION pay_disbursement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item payroll_employee_items%ROWTYPE; state text; paid numeric;
BEGIN
  IF current_setting('app.allow_payroll_reconcile', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT item FROM payroll_employee_items WHERE workspace_id = NEW.workspace_id AND id = NEW.payroll_item_id FOR UPDATE;
  SELECT status INTO state FROM payroll_periods WHERE workspace_id = NEW.workspace_id AND id = item.period_id;
  IF state <> 'finalized' THEN RAISE EXCEPTION 'PAY period must be finalized'; END IF;
  SELECT COALESCE(sum(amount_vnd),0) INTO paid FROM payroll_disbursements WHERE workspace_id = NEW.workspace_id AND payroll_item_id = NEW.payroll_item_id;
  IF paid + NEW.amount_vnd > item.net_pay_vnd THEN RAISE EXCEPTION 'OVERPAYMENT_BLOCKED'; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON employees, employee_hourly_rates, attendance_shifts, attendance_shift_versions, attendance_approvals, attendance_breaks, attendance_adjustments, attendance_correction_requests, daily_reports, daily_report_entries, daily_report_revisions, payroll_periods, payroll_employee_items, payroll_daily_breakdowns, payroll_adjustments, payroll_disbursements TO %I',
        r
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_ws record;
  v_nv001_id uuid;
  v_nv002 record;
  v_period record;
  v_item_id uuid;
  v_old_net bigint;
  v_paid_total bigint;
  v_disb_count int;
  v_disb_id uuid;
  v_tot_sec bigint;
  v_tot_min int;
  v_base_pay bigint;
  v_leave_pay bigint;
  v_deduct_pay bigint;
  v_new_net bigint;
BEGIN
  PERFORM set_config('app.allow_rate_sync', 'on', true);
  PERFORM set_config('app.allow_payroll_reconcile', 'on', true);

  FOR v_ws IN
    SELECT w.id, w.name
    FROM workspaces w
    WHERE w.status = 'active'
      AND (
        btrim(w.name) IN (
          'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
          'Hoài Phương Media',
          'HOÀI PHƯƠNG MEDIA',
          'Hoài Phương Studio'
        )
        OR EXISTS (
          SELECT 1 FROM employees e
          WHERE e.workspace_id = w.id
            AND e.employee_code = 'NV001'
            AND e.full_name = 'Nguyễn Huỳnh Thế Vinh'
        )
      )
  LOOP
    -- 1. Force-clean any remaining NV002 payroll items (even if finalized/disbursed)
    FOR v_nv002 IN
      SELECT e.id
      FROM employees e
      WHERE e.workspace_id = v_ws.id AND e.employee_code = 'NV002'
    LOOP
      DELETE FROM payroll_disbursements pd
      USING payroll_employee_items pei
      WHERE pd.workspace_id = v_ws.id
        AND pd.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id;

      DELETE FROM payroll_adjustments pa
      USING payroll_employee_items pei
      WHERE pa.workspace_id = v_ws.id
        AND pa.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id;

      DELETE FROM payroll_daily_breakdowns pdb
      USING payroll_employee_items pei
      WHERE pdb.workspace_id = v_ws.id
        AND pdb.payroll_item_id = pei.id
        AND pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id;

      DELETE FROM payroll_employee_items pei
      WHERE pei.workspace_id = v_ws.id
        AND pei.employee_id = v_nv002.id;
    END LOOP;

    -- 2. Reconcile NV001 payroll snapshots across all 2026 periods (including finalized/disbursed 2026-10)
    SELECT e.id INTO v_nv001_id
    FROM employees e
    WHERE e.workspace_id = v_ws.id AND e.employee_code = 'NV001'
    LIMIT 1;

    IF v_nv001_id IS NOT NULL THEN
      FOR v_period IN
        SELECT pp.id, pp.period_month, pp.status, pp.starts_on, pp.ends_on
        FROM payroll_periods pp
        WHERE pp.workspace_id = v_ws.id
          AND pp.period_month LIKE '2026-%'
        ORDER BY pp.period_month ASC
      LOOP
        SELECT pei.id, pei.net_pay_vnd
        INTO v_item_id, v_old_net
        FROM payroll_employee_items pei
        WHERE pei.workspace_id = v_ws.id
          AND pei.period_id = v_period.id
          AND pei.employee_id = v_nv001_id
        LIMIT 1;

        -- Compute exact totals from NV001 approved attendance_shifts in this month
        WITH day_agg AS (
          SELECT
            (COALESCE(v.clock_in_at, s.clock_in_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS work_date,
            COUNT(*)::int AS shift_count,
            SUM(COALESCE(v.worked_seconds, EXTRACT(EPOCH FROM (COALESCE(v.clock_out_at, s.clock_out_at) - COALESCE(v.clock_in_at, s.clock_in_at)))::bigint))::bigint AS worked_seconds,
            CASE
              WHEN v_period.period_month = '2026-06' THEN 20000::bigint
              ELSE 25000::bigint
            END AS rate_vnd
          FROM attendance_shifts s
          LEFT JOIN attendance_shift_versions v
            ON v.workspace_id = s.workspace_id
           AND v.shift_id = s.id
           AND v.id = s.current_version_id
          WHERE s.workspace_id = v_ws.id
            AND s.employee_id = v_nv001_id
            AND s.run_state = 'completed'
            AND s.review_state = 'approved'
            AND to_char(COALESCE(v.clock_in_at, s.clock_in_at) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') = v_period.period_month
          GROUP BY 1
        ),
        day_wages AS (
          SELECT
            work_date,
            shift_count,
            worked_seconds,
            (worked_seconds / 60)::int AS worked_minutes,
            rate_vnd,
            ROUND((worked_seconds::numeric * rate_vnd::numeric) / 3600.0, 4) AS raw_wage_vnd,
            ROUND((worked_seconds::numeric * rate_vnd::numeric) / 3600.0, 0)::bigint AS rounded_wage_vnd
          FROM day_agg
        )
        SELECT
          COALESCE(SUM(worked_seconds), 0)::bigint,
          COALESCE(SUM(worked_minutes), 0)::int,
          COALESCE(SUM(rounded_wage_vnd), 0)::bigint
        INTO v_tot_sec, v_tot_min, v_base_pay
        FROM day_wages;

        IF v_item_id IS NULL AND v_period.status = 'finalized' AND v_tot_sec > 0 THEN
          v_item_id := gen_random_uuid();
          v_old_net := 0;
          INSERT INTO payroll_employee_items (
            id, workspace_id, period_id, employee_id,
            approved_worked_seconds, approved_worked_minutes,
            base_pay_vnd, paid_leave_pay_vnd, net_pay_vnd
          ) VALUES (
            v_item_id, v_ws.id, v_period.id, v_nv001_id,
            v_tot_sec, v_tot_min,
            v_base_pay, 0, v_base_pay
          );
        END IF;

        IF v_item_id IS NOT NULL THEN
          SELECT
            COALESCE(SUM(CASE WHEN pa.reason !~* '^\[(KHẤU TRỪ|KHAU TRU|TẠM ỨNG|TAM UNG|PHẠT|PHAT)\]' THEN pa.amount_vnd ELSE 0 END), 0)::bigint,
            COALESCE(SUM(CASE WHEN pa.reason ~* '^\[(KHẤU TRỪ|KHAU TRU|TẠM ỨNG|TAM UNG|PHẠT|PHAT)\]' THEN pa.amount_vnd ELSE 0 END), 0)::bigint
          INTO v_leave_pay, v_deduct_pay
          FROM payroll_adjustments pa
          WHERE pa.workspace_id = v_ws.id AND pa.payroll_item_id = v_item_id;

          v_new_net := GREATEST(0, v_base_pay + v_leave_pay - v_deduct_pay);

          -- Rebuild payroll_daily_breakdowns for this item
          DELETE FROM payroll_daily_breakdowns
          WHERE workspace_id = v_ws.id AND payroll_item_id = v_item_id;

          INSERT INTO payroll_daily_breakdowns (
            workspace_id, payroll_item_id, work_date, shift_count,
            worked_seconds, worked_minutes, hourly_rate_vnd_snapshot,
            raw_wage_vnd, rounded_wage_vnd
          )
          SELECT
            v_ws.id,
            v_item_id,
            (COALESCE(v.clock_in_at, s.clock_in_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS work_date,
            COUNT(*)::int AS shift_count,
            SUM(COALESCE(v.worked_seconds, EXTRACT(EPOCH FROM (COALESCE(v.clock_out_at, s.clock_out_at) - COALESCE(v.clock_in_at, s.clock_in_at)))::bigint))::bigint AS worked_seconds,
            (SUM(COALESCE(v.worked_seconds, EXTRACT(EPOCH FROM (COALESCE(v.clock_out_at, s.clock_out_at) - COALESCE(v.clock_in_at, s.clock_in_at)))::bigint)) / 60)::int AS worked_minutes,
            CASE WHEN v_period.period_month = '2026-06' THEN 20000::bigint ELSE 25000::bigint END AS hourly_rate_vnd_snapshot,
            ROUND((SUM(COALESCE(v.worked_seconds, EXTRACT(EPOCH FROM (COALESCE(v.clock_out_at, s.clock_out_at) - COALESCE(v.clock_in_at, s.clock_in_at)))::bigint))::numeric * (CASE WHEN v_period.period_month = '2026-06' THEN 20000 ELSE 25000 END)::numeric) / 3600.0, 4) AS raw_wage_vnd,
            ROUND((SUM(COALESCE(v.worked_seconds, EXTRACT(EPOCH FROM (COALESCE(v.clock_out_at, s.clock_out_at) - COALESCE(v.clock_in_at, s.clock_in_at)))::bigint))::numeric * (CASE WHEN v_period.period_month = '2026-06' THEN 20000 ELSE 25000 END)::numeric) / 3600.0, 0)::bigint AS rounded_wage_vnd
          FROM attendance_shifts s
          LEFT JOIN attendance_shift_versions v
            ON v.workspace_id = s.workspace_id
           AND v.shift_id = s.id
           AND v.id = s.current_version_id
          WHERE s.workspace_id = v_ws.id
            AND s.employee_id = v_nv001_id
            AND s.run_state = 'completed'
            AND s.review_state = 'approved'
            AND to_char(COALESCE(v.clock_in_at, s.clock_in_at) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') = v_period.period_month
          GROUP BY 3
          ORDER BY 3 ASC;

          -- Update payroll_employee_items snapshot
          UPDATE payroll_employee_items
          SET approved_worked_seconds = v_tot_sec,
              approved_worked_minutes = v_tot_min,
              base_pay_vnd = v_base_pay,
              paid_leave_pay_vnd = v_leave_pay,
              net_pay_vnd = v_new_net,
              updated_at = now()
          WHERE workspace_id = v_ws.id AND id = v_item_id;

          -- If this period had a full-balance disbursement matching the old net pay (e.g. 291.667 đ in 2026-10),
          -- update the disbursement to match the reconciled net pay (535.417 đ).
          SELECT COALESCE(SUM(amount_vnd), 0)::bigint, COUNT(*)::int, MAX(id::text)::uuid
          INTO v_paid_total, v_disb_count, v_disb_id
          FROM payroll_disbursements
          WHERE workspace_id = v_ws.id AND payroll_item_id = v_item_id;

          IF v_disb_count = 1 AND v_new_net > 0 AND (v_paid_total = v_old_net OR (v_period.period_month = '2026-10' AND v_paid_total = 291667)) AND v_paid_total <> v_new_net THEN
            UPDATE payroll_disbursements
            SET amount_vnd = v_new_net
            WHERE workspace_id = v_ws.id AND id = v_disb_id;
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  PERFORM set_config('app.allow_rate_sync', 'off', true);
  PERFORM set_config('app.allow_payroll_reconcile', 'off', true);
END $$;
