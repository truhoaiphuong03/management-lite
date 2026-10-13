-- Migration: 0009_m07_payroll
-- Scope: PAY M07 Employee hourly rates, payroll periods, items, daily breakdowns, paid leaves, disbursements
-- Authoritative: SCOPE-EXT-02 PAY-01 POLICY-01 (V0.2 Extension) & GOVERNANCE-EXCEPTION PAY-024/V0.2

-- 1. Employee Hourly Rates (Immutable audit log of rate assignments with effective interval)
CREATE TABLE employee_hourly_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL,
  hourly_rate_vnd bigint NOT NULL CHECK (hourly_rate_vnd >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL CHECK (effective_to IS NULL OR effective_to > effective_from),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_employee_hourly_rates_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_employee_hourly_rates_employee FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_employee_hourly_rates_lookup
  ON employee_hourly_rates (workspace_id, employee_id, effective_from DESC);

CREATE UNIQUE INDEX uq_pay_current_rate ON employee_hourly_rates(workspace_id,employee_id) WHERE effective_to IS NULL;

-- 2. Payroll Periods (Monthly accounting periods: draft / finalized)
CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_month text NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  calculation_revision integer NOT NULL DEFAULT 1 CHECK (calculation_revision > 0),
  finalized_at timestamptz NULL,
  finalized_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  finalized_snapshot_hash text NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_periods_month UNIQUE (workspace_id, period_month),
  CONSTRAINT uq_payroll_periods_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT ck_payroll_periods_dates CHECK (ends_on >= starts_on),
  CONSTRAINT ck_pay_finalized_metadata CHECK ((status = 'draft' AND finalized_at IS NULL AND finalized_by IS NULL AND finalized_snapshot_hash IS NULL) OR (status = 'finalized' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND finalized_snapshot_hash IS NOT NULL AND finalized_snapshot_hash ~ '^[a-f0-9]{64}$'))
);

CREATE INDEX ix_payroll_periods_month
  ON payroll_periods (workspace_id, period_month DESC);

-- 3. Payroll Employee Items (Aggregated net earnings per employee per period)
CREATE TABLE payroll_employee_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  approved_worked_seconds bigint NOT NULL DEFAULT 0 CHECK (approved_worked_seconds >= 0),
  approved_worked_minutes integer NOT NULL DEFAULT 0 CHECK (approved_worked_minutes >= 0),
  base_pay_vnd bigint NOT NULL DEFAULT 0 CHECK (base_pay_vnd >= 0),
  paid_leave_pay_vnd bigint NOT NULL DEFAULT 0 CHECK (paid_leave_pay_vnd >= 0),
  net_pay_vnd bigint NOT NULL CHECK (net_pay_vnd >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_employee_items_period UNIQUE (workspace_id, period_id, employee_id),
  CONSTRAINT uq_payroll_employee_items_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_employee_items_period FOREIGN KEY (workspace_id, period_id)
    REFERENCES payroll_periods(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_employee_items_employee FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_payroll_employee_items_lookup
  ON payroll_employee_items (workspace_id, period_id, employee_id);

-- 4. Payroll Daily Breakdowns (Daily exact wage calculation and 1 VND rounding)
CREATE TABLE payroll_daily_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL,
  work_date date NOT NULL,
  shift_count integer NOT NULL DEFAULT 0 CHECK (shift_count >= 0),
  worked_seconds bigint NOT NULL DEFAULT 0 CHECK (worked_seconds >= 0),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  hourly_rate_vnd_snapshot bigint NOT NULL CHECK (hourly_rate_vnd_snapshot >= 0),
  raw_wage_vnd numeric(18, 4) NOT NULL CHECK (raw_wage_vnd >= 0),
  rounded_wage_vnd bigint NOT NULL CHECK (rounded_wage_vnd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_daily_breakdowns UNIQUE (workspace_id, payroll_item_id, work_date),
  CONSTRAINT uq_payroll_daily_breakdowns_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_daily_breakdowns_item FOREIGN KEY (workspace_id, payroll_item_id)
    REFERENCES payroll_employee_items(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_payroll_daily_breakdowns_date
  ON payroll_daily_breakdowns (workspace_id, payroll_item_id, work_date ASC);

-- 5. Payroll Paid Leaves (Separate paid leave entries with mandatory date, amount and reason)
CREATE TABLE payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type = 'paid_leave'),
  attributable_date date NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_adjustments_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_adjustments_item FOREIGN KEY (workspace_id, payroll_item_id)
    REFERENCES payroll_employee_items(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_payroll_adjustments_item
  ON payroll_adjustments (workspace_id, payroll_item_id, attributable_date ASC);

-- 6. Payroll Disbursements (Append-only record of actual manual wage disbursements)
CREATE TABLE payroll_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payroll_item_id uuid NOT NULL,
  disbursement_order integer NOT NULL CHECK (disbursement_order > 0),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer', 'cash', 'other')),
  payment_date date NOT NULL,
  reference_note text NULL,
  paid_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payroll_disbursements_order UNIQUE (workspace_id, payroll_item_id, disbursement_order),
  CONSTRAINT uq_payroll_disbursements_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_payroll_disbursements_item FOREIGN KEY (workspace_id, payroll_item_id)
    REFERENCES payroll_employee_items(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX ix_payroll_disbursements_item
  ON payroll_disbursements (workspace_id, payroll_item_id, disbursement_order ASC);


-- Rates cannot overlap; serialize even the first assignment (no prior row).
CREATE FUNCTION pay_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pay:' || NEW.workspace_id::text, 0));
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
CREATE TRIGGER pay_rate_guard BEFORE INSERT OR UPDATE ON employee_hourly_rates FOR EACH ROW EXECUTE FUNCTION pay_rate_guard();
CREATE FUNCTION pay_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PAY history is append-only'; END $$;
CREATE TRIGGER pay_rate_no_delete BEFORE DELETE ON employee_hourly_rates FOR EACH ROW EXECUTE FUNCTION pay_no_delete();

-- Freeze the period and all children, including INSERT, reparenting and DELETE.
CREATE FUNCTION pay_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'Finalized PAY snapshot is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.period_month <> OLD.period_month THEN
    RAISE EXCEPTION 'PAY period identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_period_guard BEFORE UPDATE OR DELETE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION pay_period_guard();

CREATE FUNCTION pay_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; p uuid; w uuid; state text;
BEGIN
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
CREATE TRIGGER pay_item_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_employee_items FOR EACH ROW EXECUTE FUNCTION pay_child_guard();
CREATE TRIGGER pay_daily_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_daily_breakdowns FOR EACH ROW EXECUTE FUNCTION pay_child_guard();
CREATE TRIGGER pay_adjustment_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_adjustments FOR EACH ROW EXECUTE FUNCTION pay_child_guard();

-- Manual ledger only. Check balance while holding the same parent row lock.
CREATE FUNCTION pay_disbursement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item payroll_employee_items%ROWTYPE; state text; paid numeric;
BEGIN
  SELECT * INTO STRICT item FROM payroll_employee_items WHERE workspace_id = NEW.workspace_id AND id = NEW.payroll_item_id FOR UPDATE;
  SELECT status INTO state FROM payroll_periods WHERE workspace_id = NEW.workspace_id AND id = item.period_id;
  IF state <> 'finalized' THEN RAISE EXCEPTION 'PAY period must be finalized'; END IF;
  SELECT COALESCE(sum(amount_vnd),0) INTO paid FROM payroll_disbursements WHERE workspace_id = NEW.workspace_id AND payroll_item_id = NEW.payroll_item_id;
  IF paid + NEW.amount_vnd > item.net_pay_vnd THEN RAISE EXCEPTION 'OVERPAYMENT_BLOCKED'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pay_disbursement_guard BEFORE INSERT ON payroll_disbursements FOR EACH ROW EXECUTE FUNCTION pay_disbursement_guard();
CREATE TRIGGER pay_disbursement_immutable BEFORE UPDATE OR DELETE ON payroll_disbursements FOR EACH ROW EXECUTE FUNCTION pay_no_delete();
