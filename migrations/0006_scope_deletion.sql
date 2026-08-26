ALTER TABLE scopes
  DROP CONSTRAINT scopes_status_check;

ALTER TABLE scopes
  ADD CONSTRAINT scopes_status_check
  CHECK (status IN ('active', 'archived', 'deleting'));

CREATE TABLE scope_deletion_jobs (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL UNIQUE,
  project_key varchar(80) NOT NULL,
  object_prefix varchar(500) NOT NULL,
  requested_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  requested_scope_version integer NOT NULL CHECK (requested_scope_version >= 1),
  status varchar(20) NOT NULL
    CHECK (status IN ('running', 'failed', 'succeeded')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  requested_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  objects_deleted_at timestamptz,
  database_deleted_at timestamptz,
  last_error_code varchar(160),
  CHECK (
    (status = 'running' AND completed_at IS NULL AND last_error_code IS NULL)
    OR
    (status = 'failed' AND completed_at IS NOT NULL AND last_error_code IS NOT NULL)
    OR
    (
      status = 'succeeded'
      AND completed_at IS NOT NULL
      AND last_error_code IS NULL
      AND objects_deleted_at IS NOT NULL
      AND database_deleted_at IS NOT NULL
    )
  )
);

CREATE INDEX scope_deletion_jobs_status_idx
  ON scope_deletion_jobs(status, requested_at, id);
