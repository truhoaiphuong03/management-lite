-- WORK-01 rev03. Additive workspace-scoped assignment/submission lifecycle.
CREATE TABLE work_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(trim(title))>0 AND length(title)<=200), description text,
 work_type text NOT NULL DEFAULT 'general' CHECK(work_type IN ('general','content','video','design','other')),
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','in_review','completed','cancelled')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')), due_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE work_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 work_item_id uuid NOT NULL, employee_id uuid NOT NULL, stage text NOT NULL DEFAULT 'primary',
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','in_review','completed')),
 assigned_by uuid NOT NULL REFERENCES users(id), assigned_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES work_items(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,employee_id) REFERENCES employees(workspace_id,id) ON DELETE RESTRICT,
 UNIQUE(workspace_id,work_item_id,employee_id), UNIQUE(workspace_id,id), UNIQUE(workspace_id,work_item_id,id)
);
CREATE TABLE work_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 work_item_id uuid NOT NULL, assignment_id uuid NOT NULL, revision_number integer NOT NULL CHECK(revision_number>0),
 submission_note text NOT NULL CHECK(length(trim(submission_note))>0), attachments jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(attachments)='array'),
 submitted_by uuid NOT NULL REFERENCES users(id), submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES work_items(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,work_item_id,assignment_id) REFERENCES work_assignments(workspace_id,work_item_id,id) ON DELETE RESTRICT,
 UNIQUE(workspace_id,assignment_id,revision_number), UNIQUE(workspace_id,work_item_id,assignment_id,id)
);
CREATE TABLE work_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 work_item_id uuid NOT NULL, assignment_id uuid NOT NULL, submission_id uuid NOT NULL,
 reviewer_user_id uuid NOT NULL REFERENCES users(id), decision text NOT NULL CHECK(decision IN ('approved','request_changes')),
 feedback text CHECK(decision<>'request_changes' OR length(trim(feedback))>0 AND feedback IS NOT NULL), reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES work_items(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,work_item_id,assignment_id) REFERENCES work_assignments(workspace_id,work_item_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,work_item_id,assignment_id,submission_id) REFERENCES work_submissions(workspace_id,work_item_id,assignment_id,id) ON DELETE RESTRICT,
 UNIQUE(workspace_id,submission_id)
);
CREATE INDEX work_items_filter ON work_items(workspace_id,status,priority,created_at);
CREATE INDEX work_assignments_employee ON work_assignments(workspace_id,employee_id,work_item_id);
CREATE INDEX work_reviews_history ON work_reviews(workspace_id,assignment_id,reviewed_at);
CREATE FUNCTION work_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WORK history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER work_submission_immutable BEFORE UPDATE OR DELETE ON work_submissions FOR EACH ROW EXECUTE FUNCTION work_history_immutable();
CREATE TRIGGER work_review_immutable BEFORE UPDATE OR DELETE ON work_reviews FOR EACH ROW EXECUTE FUNCTION work_history_immutable();
CREATE FUNCTION work_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WORK assignment history cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT status INTO parent_status FROM work_items WHERE workspace_id=NEW.workspace_id AND id=NEW.work_item_id FOR UPDATE;
 IF parent_status='cancelled' THEN RAISE EXCEPTION 'WORK parent is closed' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.status<>'todo' THEN RAISE EXCEPTION 'Assignment must start todo' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.workspace_id,NEW.work_item_id,NEW.employee_id,NEW.stage,NEW.assigned_by,NEW.assigned_at) IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.work_item_id,OLD.employee_id,OLD.stage,OLD.assigned_by,OLD.assigned_at) THEN RAISE EXCEPTION 'Assignment identity immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status='todo' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='in_review' AND EXISTS(SELECT 1 FROM work_submissions s WHERE s.workspace_id=NEW.workspace_id AND s.assignment_id=NEW.id AND NOT EXISTS(SELECT 1 FROM work_reviews r WHERE r.workspace_id=s.workspace_id AND r.submission_id=s.id))) OR (OLD.status='in_review' AND NEW.status IN ('completed','in_progress') AND EXISTS(SELECT 1 FROM work_reviews r JOIN work_submissions s ON s.workspace_id=r.workspace_id AND s.id=r.submission_id WHERE r.workspace_id=NEW.workspace_id AND r.assignment_id=NEW.id AND r.decision=CASE WHEN NEW.status='completed' THEN 'approved' ELSE 'request_changes' END AND s.revision_number=(SELECT max(revision_number) FROM work_submissions WHERE workspace_id=NEW.workspace_id AND assignment_id=NEW.id)))) THEN RAISE EXCEPTION 'Invalid WORK assignment transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_assignment_transition BEFORE INSERT OR UPDATE OR DELETE ON work_assignments FOR EACH ROW EXECUTE FUNCTION work_assignment_guard();
CREATE FUNCTION work_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a work_assignments; p text; next_revision integer;
BEGIN
 SELECT status INTO p FROM work_items WHERE workspace_id=NEW.workspace_id AND id=NEW.work_item_id FOR UPDATE;
 SELECT * INTO a FROM work_assignments WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.work_item_id AND id=NEW.assignment_id FOR UPDATE;
 SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM work_submissions WHERE workspace_id=NEW.workspace_id AND assignment_id=NEW.assignment_id;
 IF p IN ('cancelled','completed') OR a.status<>'in_progress' OR NEW.revision_number<>next_revision OR NOT EXISTS(SELECT 1 FROM employees WHERE workspace_id=NEW.workspace_id AND id=a.employee_id AND user_id=NEW.submitted_by) THEN RAISE EXCEPTION 'Invalid WORK submission' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_submission_valid BEFORE INSERT ON work_submissions FOR EACH ROW EXECUTE FUNCTION work_submission_guard();
CREATE FUNCTION work_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a work_assignments; p text;
BEGIN
 SELECT status INTO p FROM work_items WHERE workspace_id=NEW.workspace_id AND id=NEW.work_item_id FOR UPDATE;
 SELECT * INTO a FROM work_assignments WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.work_item_id AND id=NEW.assignment_id FOR UPDATE;
 IF p IN ('cancelled','completed') OR a.status<>'in_review' OR NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=NEW.workspace_id AND user_id=NEW.reviewer_user_id AND status='active' AND role='owner') OR NOT EXISTS(SELECT 1 FROM work_submissions WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.work_item_id AND assignment_id=NEW.assignment_id AND id=NEW.submission_id AND revision_number=(SELECT max(revision_number) FROM work_submissions WHERE workspace_id=NEW.workspace_id AND assignment_id=NEW.assignment_id)) THEN RAISE EXCEPTION 'Invalid WORK review' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_review_valid BEFORE INSERT ON work_reviews FOR EACH ROW EXECUTE FUNCTION work_review_guard();
CREATE FUNCTION work_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WORK item history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'todo' OR NEW.version<>1 THEN RAISE EXCEPTION 'WORK must start todo version 1' USING ERRCODE='23514'; END IF; RETURN NEW; END IF;
 IF OLD.status='cancelled' OR ROW(OLD.id,OLD.workspace_id,OLD.created_by,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.workspace_id,NEW.created_by,NEW.created_at) THEN RAISE EXCEPTION 'WORK item closed or identity changed' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'WORK version must increment once' USING ERRCODE='23514'; END IF;
 SELECT CASE WHEN count(*)=0 OR bool_and(status='todo') THEN 'todo' WHEN bool_and(status='completed') THEN 'completed' WHEN bool_and(status='in_review') THEN 'in_review' ELSE 'in_progress' END INTO expected FROM work_assignments WHERE workspace_id=NEW.workspace_id AND work_item_id=NEW.id;
 IF NEW.status<>'cancelled' AND NEW.status<>expected THEN RAISE EXCEPTION 'WORK aggregate status invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_item_valid BEFORE INSERT OR UPDATE OR DELETE ON work_items FOR EACH ROW EXECUTE FUNCTION work_item_guard();

-- Commit-time aggregate validation covers inserts as well as status updates.
CREATE FUNCTION work_aggregate_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w uuid; parent uuid; actual text; expected text;
BEGIN
 w:=NEW.workspace_id;
 IF TG_TABLE_NAME='work_items' THEN parent:=NEW.id; ELSE parent:=NEW.work_item_id; END IF;
 SELECT status INTO actual FROM work_items WHERE workspace_id=w AND id=parent;
 SELECT CASE WHEN count(*)=0 OR bool_and(status='todo') THEN 'todo' WHEN bool_and(status='completed') THEN 'completed' WHEN bool_and(status='in_review') THEN 'in_review' ELSE 'in_progress' END INTO expected FROM work_assignments WHERE workspace_id=w AND work_item_id=parent;
 IF actual IS DISTINCT FROM 'cancelled' AND actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'WORK aggregate status inconsistent at commit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER work_item_aggregate AFTER INSERT OR UPDATE ON work_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_aggregate_consistent();
CREATE CONSTRAINT TRIGGER work_assignment_aggregate AFTER INSERT OR UPDATE ON work_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_aggregate_consistent();
