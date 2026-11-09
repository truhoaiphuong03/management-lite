-- Migration: 0042_cleanup_duplicate_employees_and_nv002_label
-- Scope:
--   1. Remove duplicate/orphan ADMIN/OWNER employee records in canonical workspaces
--      where ADM01 already exists, reassigning any references to ADM01 so only the
--      3 real employees (ADM01, NV001, NV002) remain.
--   2. Ensure NV002 retains sub_role = 'admin' and full 6 sub_permissions with
--      is_payroll_eligible = false.

DO $$
DECLARE
  v_ws record;
  v_primary_emp_id uuid;
  v_dup record;
BEGIN
  FOR v_ws IN
    SELECT w.id, w.name
    FROM workspaces w
    WHERE w.status = 'active'
      AND EXISTS (
        SELECT 1 FROM employees e
        WHERE e.workspace_id = w.id
          AND UPPER(btrim(e.employee_code)) = 'ADM01'
      )
  LOOP
    SELECT e.id INTO v_primary_emp_id
    FROM employees e
    WHERE e.workspace_id = v_ws.id
      AND UPPER(btrim(e.employee_code)) = 'ADM01'
    ORDER BY e.created_at ASC
    LIMIT 1;

    IF v_primary_emp_id IS NOT NULL THEN
      FOR v_dup IN
        SELECT e.id, e.user_id, e.employee_code, e.full_name
        FROM employees e
        WHERE e.workspace_id = v_ws.id
          AND e.id <> v_primary_emp_id
          AND UPPER(btrim(e.employee_code)) NOT IN ('ADM01', 'NV001', 'NV002')
          AND (
            UPPER(btrim(e.employee_code)) IN ('ADMIN', 'OWNER', 'OWNER01')
            OR btrim(e.full_name) IN ('Quản trị viên (Admin)', 'Chủ cửa hàng (Owner)', 'Owner')
          )
      LOOP
        BEGIN
          BEGIN
            UPDATE attendance_shifts
            SET employee_id = v_primary_emp_id
            WHERE workspace_id = v_ws.id AND employee_id = v_dup.id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM daily_reports dr
            WHERE dr.workspace_id = v_ws.id
              AND dr.employee_id = v_dup.id
              AND EXISTS (
                SELECT 1 FROM daily_reports dr2
                WHERE dr2.workspace_id = dr.workspace_id
                  AND dr2.employee_id = v_primary_emp_id
                  AND dr2.report_date = dr.report_date
              );

            UPDATE daily_reports
            SET employee_id = v_primary_emp_id
            WHERE workspace_id = v_ws.id AND employee_id = v_dup.id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM staff_schedules ss
            WHERE ss.workspace_id = v_ws.id
              AND ss.employee_id = v_dup.id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM work_assignments wa
            WHERE wa.workspace_id = v_ws.id
              AND wa.employee_id = v_dup.id
              AND EXISTS (
                SELECT 1 FROM work_assignments wa2
                WHERE wa2.workspace_id = wa.workspace_id
                  AND wa2.work_item_id = wa.work_item_id
                  AND wa2.employee_id = v_primary_emp_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM work_submissions ws
                WHERE ws.workspace_id = wa.workspace_id
                  AND ws.assignment_id = wa.id
              );

            UPDATE work_assignments wa
            SET employee_id = v_primary_emp_id
            WHERE wa.workspace_id = v_ws.id
              AND wa.employee_id = v_dup.id
              AND NOT EXISTS (
                SELECT 1 FROM work_assignments wa2
                WHERE wa2.workspace_id = wa.workspace_id
                  AND wa2.work_item_id = wa.work_item_id
                  AND wa2.employee_id = v_primary_emp_id
              );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM payroll_hourly_rate_rules
            WHERE workspace_id = v_ws.id AND employee_id = v_dup.id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            UPDATE managed_accounts
            SET assigned_employee_id = v_primary_emp_id
            WHERE workspace_id = v_ws.id AND assigned_employee_id = v_dup.id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM resource_access_grants
            WHERE workspace_id = v_ws.id AND employee_id = v_dup.id;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          DELETE FROM employees
          WHERE workspace_id = v_ws.id AND id = v_dup.id;

          IF v_dup.user_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM employees e2 WHERE e2.user_id = v_dup.user_id
          ) THEN
            DELETE FROM user_workspace_bindings
            WHERE workspace_id = v_ws.id
              AND user_id = v_dup.user_id
              AND EXISTS (
                SELECT 1 FROM users u
                WHERE u.id = v_dup.user_id
                  AND u.email_normalized LIKE '%@hoaiphuong.local'
              );

            DELETE FROM workspace_memberships
            WHERE workspace_id = v_ws.id
              AND user_id = v_dup.user_id
              AND EXISTS (
                SELECT 1 FROM users u
                WHERE u.id = v_dup.user_id
                  AND u.email_normalized LIKE '%@hoaiphuong.local'
              );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END IF;

    UPDATE employees
    SET sub_role = 'admin',
        sub_permissions = '["attendance:review","work:manage","employees:manage","accounts:manage","payroll:manage","finance:manage"]'::jsonb,
        is_payroll_eligible = false,
        updated_at = now()
    WHERE workspace_id = v_ws.id
      AND UPPER(btrim(employee_code)) = 'NV002';
  END LOOP;
END $$;
