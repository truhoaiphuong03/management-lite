-- Migration: 0041_fix_nv002_and_employee_login_access
-- Scope:
--   1. Grant runtime privileges on users, user_credentials, workspace_memberships,
--      user_workspace_bindings, activation_invites, auth_sessions, and employees.
--   2. Heal NV002 (and any unlinked/pending/inactive employee in active canonical workspaces):
--      - Ensure NV002 has an associated users record (user_id IS NOT NULL) and status = 'active'.
--      - Restore employees.employment_status = 'active' when it was set to 'inactive' or 'invited'.
--      - Ensure workspace_memberships (status = 'active') and user_workspace_bindings (status = 'active') exist.
--      - Seed a bootstrap user_credentials row (credential_version = 0, default 'Nv002@123' Argon2id hash)
--        ONLY when the employee user has no row in user_credentials yet.

DO $$
DECLARE
  r text;
  v_ws record;
  v_emp record;
  v_user_id uuid;
  v_username text;
  v_email text;
  v_suffix text;
  v_default_nv002_hash constant text := '$argon2id$v=19$m=19456,t=2,p=1$DA9tBHP8sBjvQYHcuQ97sg$Wx1g09MoBH3ObiDShHOYS6S6X74OtydXcIe3q6D2D1o';
BEGIN
  FOREACH r IN ARRAY ARRAY['mglite_app', 'hp_app_runtime', 'hp_app_test', 'mglite_owner', 'postgres'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
             users,
             user_credentials,
             workspace_memberships,
             user_workspace_bindings,
             activation_invites,
             auth_sessions,
             employees
           TO %I',
          r
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;

  FOR v_ws IN
    SELECT w.id, w.name
    FROM workspaces w
    WHERE w.status = 'active'
      AND (
        btrim(w.name) IN ('THIẾT KẾ IN ẤN TOÀN GIA PHÁT', 'Hoài Phương Media', 'HOÀI PHƯƠNG MEDIA', 'Hoài Phương Studio')
        OR EXISTS (
          SELECT 1 FROM employees e
          WHERE e.workspace_id = w.id
            AND e.employee_code IN ('NV001', 'NV002')
        )
      )
  LOOP
    FOR v_emp IN
      SELECT e.id, e.user_id, e.employee_code, e.full_name, e.employment_status
      FROM employees e
      WHERE e.workspace_id = v_ws.id
        AND e.employment_status NOT IN ('suspended', 'archived')
      ORDER BY e.created_at ASC
    LOOP
      v_user_id := v_emp.user_id;

      IF v_user_id IS NULL THEN
        v_username := lower(regexp_replace(btrim(COALESCE(v_emp.employee_code, 'staff')), '[^a-zA-Z0-9._-]', '', 'g'));
        IF v_username = '' THEN
          v_username := 'staff';
        END IF;
        v_email := v_username || '@hoaiphuong.local';

        SELECT u.id INTO v_user_id
        FROM users u
        LEFT JOIN employees e2 ON e2.user_id = u.id AND e2.workspace_id = v_ws.id
        WHERE (u.username_normalized = v_username OR u.email_normalized = v_email)
          AND (e2.id IS NULL OR e2.id = v_emp.id)
        ORDER BY u.created_at ASC
        LIMIT 1;

        IF v_user_id IS NULL THEN
          v_suffix := lower(substr(replace(v_emp.id::text, '-', ''), 1, 6));
          IF EXISTS (
            SELECT 1 FROM users u
            WHERE u.username_normalized = v_username OR u.email_normalized = v_email
          ) THEN
            v_username := v_username || '_' || v_suffix;
            v_email := v_username || '@hoaiphuong.local';
          END IF;

          INSERT INTO users (username_normalized, email_normalized, status, created_at, updated_at)
          VALUES (v_username, v_email, 'active', now(), now())
          RETURNING id INTO v_user_id;
        END IF;

        UPDATE employees
        SET user_id = v_user_id,
            employment_status = 'active',
            updated_at = now()
        WHERE workspace_id = v_ws.id
          AND id = v_emp.id;
      ELSE
        UPDATE employees
        SET employment_status = 'active',
            updated_at = now()
        WHERE workspace_id = v_ws.id
          AND id = v_emp.id
          AND employment_status IN ('invited', 'inactive');
      END IF;

      IF v_user_id IS NOT NULL THEN
        UPDATE users
        SET status = 'active',
            updated_at = now()
        WHERE id = v_user_id
          AND status = 'pending_activation';

        INSERT INTO workspace_memberships (workspace_id, user_id, role, status, version, created_at, updated_at)
        VALUES (
          v_ws.id,
          v_user_id,
          CASE WHEN UPPER(btrim(v_emp.employee_code)) IN ('OWNER', 'OWNER01', 'ADM01', 'ADMIN') THEN 'owner' ELSE 'staff' END,
          'active',
          1,
          now(),
          now()
        )
        ON CONFLICT (workspace_id, user_id) DO UPDATE
        SET status = CASE
              WHEN workspace_memberships.status = 'suspended' THEN workspace_memberships.status
              ELSE 'active'
            END,
            updated_at = now();

        INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version, created_at, updated_at)
        VALUES (v_ws.id, v_user_id, 'active', 1, now(), now())
        ON CONFLICT (user_id) DO UPDATE
        SET workspace_id = EXCLUDED.workspace_id,
            status = CASE
              WHEN user_workspace_bindings.status = 'suspended' THEN user_workspace_bindings.status
              ELSE 'active'
            END,
            version = user_workspace_bindings.version + 1,
            updated_at = now();

        IF NOT EXISTS (
          SELECT 1 FROM user_credentials uc WHERE uc.user_id = v_user_id
        ) THEN
          INSERT INTO user_credentials (
            user_id,
            password_hash,
            credential_version,
            password_updated_at,
            created_at,
            updated_at
          ) VALUES (
            v_user_id,
            v_default_nv002_hash,
            0,
            now(),
            now(),
            now()
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
