-- Migration: 0028_system_logs
-- Scope: Operational system log (API errors, slow requests, browser errors) for the Owner log console.
-- Not append-only: rows older than the retention window are purged by the application.

CREATE TABLE IF NOT EXISTS system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source text NOT NULL CHECK (source IN ('api', 'web')),
  workspace_id uuid NULL,
  user_id uuid NULL,
  request_id text NULL,
  method text NULL,
  route text NULL,
  status integer NULL,
  duration_ms integer NULL,
  error_code text NULL,
  message text NOT NULL,
  stack text NULL,
  fingerprint text NOT NULL,
  release text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_system_logs_time ON system_logs (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_system_logs_level_time ON system_logs (level, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_system_logs_request ON system_logs (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_system_logs_fingerprint ON system_logs (fingerprint, occurred_at DESC);
