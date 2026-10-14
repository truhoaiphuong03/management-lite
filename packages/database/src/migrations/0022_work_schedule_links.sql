-- Stable links to the employee's registered date, not replaceable entry IDs.
-- Deferred date FK permits existing schedule revision delete/reinsert in one transaction.
ALTER TABLE work_assignments ADD CONSTRAINT uq_work_assignment_employee UNIQUE(workspace_id,id,employee_id);
ALTER TABLE staff_schedules ADD CONSTRAINT uq_schedule_employee_identity UNIQUE(workspace_id,id,employee_id);
ALTER TABLE staff_schedule_entries ADD CONSTRAINT uq_schedule_entry_workspace_date UNIQUE(workspace_id,schedule_id,work_date);
CREATE TABLE work_schedule_links (
  workspace_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  schedule_id uuid NOT NULL,
  work_date date NOT NULL,
  linked_by uuid NOT NULL REFERENCES users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,assignment_id,work_date),
  FOREIGN KEY(workspace_id,assignment_id,employee_id) REFERENCES work_assignments(workspace_id,id,employee_id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,schedule_id,employee_id) REFERENCES staff_schedules(workspace_id,id,employee_id) ON DELETE RESTRICT,
  CONSTRAINT fk_work_schedule_registered_date FOREIGN KEY(workspace_id,schedule_id,work_date) REFERENCES staff_schedule_entries(workspace_id,schedule_id,work_date) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ix_work_schedule_date ON work_schedule_links(workspace_id,schedule_id,work_date);
