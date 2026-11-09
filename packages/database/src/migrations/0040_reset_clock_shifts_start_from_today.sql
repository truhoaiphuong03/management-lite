-- Migration 0040: Reset /clock state to start working fresh from today (2026-11-09)
-- 1. Ensures runtime permissions on attendance tables.
-- 2. Ensures Workspace Owner in production workspace has an active linked employee profile (is_payroll_eligible = FALSE) so /clock works seamlessly.
-- 3. Cleans up any hanging open shifts (working/paused) and web clock-in test shifts (source = 'clock'), while strictly preserving NV001's 61 imported Google Sheet shifts (source = 'import', T6..T11) and finalized payroll snapshots.

DO $$
DECLARE
  r text;
  v_ws RECORD;
  v_actor_id UUID;
  v_owner_name TEXT;
  v_owner_emp_id UUID;
BEGIN
  FOREACH r IN ARRAY ARRAY['mglite_app', 'hp_app_runtime', 'hp_app_test', 'ml_app_runtime', 'ml_app_test', 'app_runtime', 'app_test']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON employees, attendance_shifts, attendance_shift_versions, attendance_approvals, attendance_breaks, attendance_adjustments, attendance_correction_requests TO %I',
        r
      );
    END IF;
  END LOOP;

  PERFORM set_config('app.allow_payroll_reconcile', 'on', true);

  FOR v_ws IN
    SELECT w.id, w.name
    FROM workspaces w
    WHERE w.status = 'active'
      AND (
        btrim(w.name) IN ('THIẾT KẾ IN ẤN TOÀN GIA PHÁT', 'Hoài Phương Media', 'HOÀI PHƯƠNG MEDIA', 'Hoài Phương Studio')
        OR EXISTS (
          SELECT 1 FROM employees e
          WHERE e.workspace_id = w.id
            AND e.employee_code = 'NV001'
            AND e.full_name ILIKE '%Nguyễn Huỳnh Thế Vinh%'
        )
      )
  LOOP
    SELECT wm.user_id, u.username_normalized
    INTO v_actor_id, v_owner_name
    FROM workspace_memberships wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = v_ws.id
      AND wm.role = 'owner'
      AND wm.status = 'active'
    ORDER BY wm.created_at ASC
    LIMIT 1;

    IF v_actor_id IS NOT NULL THEN
      SELECT id INTO v_owner_emp_id
      FROM employees
      WHERE workspace_id = v_ws.id
        AND user_id = v_actor_id
      LIMIT 1;

      IF v_owner_emp_id IS NOT NULL THEN
        UPDATE employees
        SET employment_status = 'active',
            updated_at = now()
        WHERE workspace_id = v_ws.id
          AND id = v_owner_emp_id
          AND employment_status <> 'active';
      ELSE
        SELECT id INTO v_owner_emp_id
        FROM employees
        WHERE workspace_id = v_ws.id
          AND user_id IS NULL
          AND employee_code IN ('OWNER', 'OWNER01', 'ADM01', 'ADMIN')
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_owner_emp_id IS NOT NULL THEN
          UPDATE employees
          SET user_id = v_actor_id,
              employment_status = 'active',
              is_payroll_eligible = FALSE,
              updated_at = now()
          WHERE workspace_id = v_ws.id
            AND id = v_owner_emp_id;
        ELSE
          INSERT INTO employees (
            workspace_id,
            user_id,
            employee_code,
            full_name,
            employment_status,
            is_payroll_eligible,
            created_at,
            updated_at
          ) VALUES (
            v_ws.id,
            v_actor_id,
            'OWNER',
            COALESCE(NULLIF(BTRIM(v_owner_name), ''), 'Chủ sở hữu'),
            'active',
            FALSE,
            now(),
            now()
          )
          ON CONFLICT (workspace_id, employee_code) DO UPDATE
          SET user_id = COALESCE(employees.user_id, EXCLUDED.user_id),
              employment_status = 'active',
              updated_at = now();
        END IF;
      END IF;
    END IF;

    -- Clean up any open shifts (working/paused) and web clock-in test shifts (source = 'clock'),
    -- while strictly preserving imported timesheet shifts (source = 'import').
    UPDATE attendance_shifts
    SET current_version_id = NULL
    WHERE workspace_id = v_ws.id
      AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock');

    DELETE FROM attendance_approvals
    WHERE workspace_id = v_ws.id
      AND shift_id IN (
        SELECT id FROM attendance_shifts
        WHERE workspace_id = v_ws.id
          AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock')
      );

    DELETE FROM attendance_adjustments
    WHERE workspace_id = v_ws.id
      AND shift_id IN (
        SELECT id FROM attendance_shifts
        WHERE workspace_id = v_ws.id
          AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock')
      );

    DELETE FROM attendance_correction_requests
    WHERE workspace_id = v_ws.id
      AND shift_id IN (
        SELECT id FROM attendance_shifts
        WHERE workspace_id = v_ws.id
          AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock')
      );

    DELETE FROM attendance_breaks
    WHERE workspace_id = v_ws.id
      AND shift_id IN (
        SELECT id FROM attendance_shifts
        WHERE workspace_id = v_ws.id
          AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock')
      );

    DELETE FROM attendance_shift_versions
    WHERE workspace_id = v_ws.id
      AND shift_id IN (
        SELECT id FROM attendance_shifts
        WHERE workspace_id = v_ws.id
          AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock')
      );

    DELETE FROM attendance_shifts
    WHERE workspace_id = v_ws.id
      AND (run_state IN ('working', 'paused') OR COALESCE(source, 'clock') = 'clock');
  END LOOP;

  PERFORM set_config('app.allow_payroll_reconcile', 'off', true);
END $$;
