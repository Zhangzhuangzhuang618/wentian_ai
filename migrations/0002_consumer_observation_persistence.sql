CREATE TABLE query_set_snapshots (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  snapshot_hash char(64) NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (scope_id, snapshot_hash),
  UNIQUE (scope_id, id)
);

CREATE TABLE query_set_snapshot_items (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  item_hash char(64) NOT NULL,
  item_json jsonb NOT NULL,
  FOREIGN KEY (scope_id, snapshot_id)
    REFERENCES query_set_snapshots(scope_id, id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, ordinal),
  UNIQUE (snapshot_id, id),
  UNIQUE (scope_id, id)
);

CREATE TABLE consumer_surface_profile_versions (
  id uuid PRIMARY KEY,
  surface_code varchar(80) NOT NULL,
  product_label varchar(160) NOT NULL,
  adapter_version varchar(120) NOT NULL,
  allowed_collection_methods_json jsonb NOT NULL,
  visible_source_capabilities_json jsonb NOT NULL,
  comparison_surface_model_label varchar(120),
  comparison_provider_code varchar(80),
  comparison_model_key varchar(160),
  equivalence_level varchar(20) NOT NULL
    CHECK (equivalence_level IN ('exact', 'approximate', 'unknown')),
  equivalence_basis text,
  equivalence_evidence_url text,
  equivalence_reviewed_at timestamptz,
  terms_reviewed_at timestamptz,
  status varchar(20) NOT NULL
    CHECK (status IN ('draft', 'active', 'suspended')),
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX consumer_surface_one_active_code_idx
  ON consumer_surface_profile_versions(surface_code)
  WHERE status = 'active';

CREATE TABLE consumer_observation_runs (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  query_set_snapshot_id uuid NOT NULL,
  surface_profile_version_id uuid NOT NULL
    REFERENCES consumer_surface_profile_versions(id) ON DELETE RESTRICT,
  paired_run_id uuid,
  experiment_kind varchar(30) NOT NULL
    CHECK (experiment_kind IN ('natural_answer', 'source_nomination')),
  status varchar(20) NOT NULL,
  run_json jsonb NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, query_set_snapshot_id)
    REFERENCES query_set_snapshots(scope_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (scope_id, paired_run_id)
    REFERENCES consumer_observation_runs(scope_id, id) ON DELETE RESTRICT,
  UNIQUE (scope_id, id)
);

CREATE INDEX consumer_observation_runs_scope_created_idx
  ON consumer_observation_runs(scope_id, created_at DESC, id);

CREATE TABLE consumer_observation_tasks (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  run_id uuid NOT NULL,
  query_snapshot_item_id uuid NOT NULL,
  sample_index smallint NOT NULL CHECK (sample_index BETWEEN 1 AND 5),
  status varchar(30) NOT NULL,
  task_json jsonb NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, run_id)
    REFERENCES consumer_observation_runs(scope_id, id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, query_snapshot_item_id)
    REFERENCES query_set_snapshot_items(scope_id, id) ON DELETE RESTRICT,
  UNIQUE (scope_id, id),
  UNIQUE (run_id, query_snapshot_item_id, sample_index)
);

CREATE INDEX consumer_observation_tasks_scope_status_idx
  ON consumer_observation_tasks(scope_id, status, created_at, id);

CREATE TABLE evidence_media_assets (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  object_key varchar(500) NOT NULL UNIQUE,
  content_type varchar(120) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL,
  retention_class varchar(40) NOT NULL
    CHECK (retention_class IN ('pending_24h', 'screenshot_30d')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (scope_id, id)
);

CREATE TABLE consumer_capture_artifacts (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  observation_task_id uuid NOT NULL,
  screenshot_media_asset_id uuid NOT NULL,
  artifact_json jsonb NOT NULL,
  capture_sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, observation_task_id)
    REFERENCES consumer_observation_tasks(scope_id, id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, screenshot_media_asset_id)
    REFERENCES evidence_media_assets(scope_id, id) ON DELETE RESTRICT,
  UNIQUE (scope_id, id),
  UNIQUE (observation_task_id)
);

CREATE TABLE confirmed_consumer_observation_records (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  run_id uuid NOT NULL,
  observation_task_id uuid NOT NULL,
  query_snapshot_item_id uuid NOT NULL,
  sample_index smallint NOT NULL CHECK (sample_index BETWEEN 1 AND 5),
  record_json jsonb NOT NULL,
  answer_hash char(64) NOT NULL,
  confirmed_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, run_id)
    REFERENCES consumer_observation_runs(scope_id, id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, observation_task_id)
    REFERENCES consumer_observation_tasks(scope_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (scope_id, query_snapshot_item_id)
    REFERENCES query_set_snapshot_items(scope_id, id) ON DELETE RESTRICT,
  UNIQUE (scope_id, id),
  UNIQUE (observation_task_id),
  UNIQUE (run_id, query_snapshot_item_id, sample_index)
);

CREATE TABLE ai_visibility_cited_source_events (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  run_id uuid NOT NULL,
  response_id uuid NOT NULL,
  query_snapshot_item_id uuid NOT NULL,
  sample_index smallint NOT NULL CHECK (sample_index BETWEEN 1 AND 5),
  source_key_hash char(64) NOT NULL,
  source_position integer NOT NULL CHECK (source_position >= 1),
  event_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, run_id)
    REFERENCES consumer_observation_runs(scope_id, id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, response_id)
    REFERENCES confirmed_consumer_observation_records(scope_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (scope_id, query_snapshot_item_id)
    REFERENCES query_set_snapshot_items(scope_id, id) ON DELETE RESTRICT,
  UNIQUE (scope_id, id),
  UNIQUE (scope_id, response_id, source_key_hash, source_position)
);

CREATE INDEX ai_visibility_cited_events_response_idx
  ON ai_visibility_cited_source_events(scope_id, response_id, source_position, id);

CREATE TABLE capture_token_nonces (
  nonce_hash char(64) PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  observation_task_id uuid NOT NULL REFERENCES consumer_observation_tasks(id)
    ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);

INSERT INTO consumer_surface_profile_versions (
  id,
  surface_code,
  product_label,
  adapter_version,
  allowed_collection_methods_json,
  visible_source_capabilities_json,
  equivalence_level,
  terms_reviewed_at,
  status,
  created_by,
  created_at
) VALUES (
  'd0ba0000-0000-4000-8000-000000000001',
  'doubao_web',
  '豆包网页版',
  'doubao-web@1-attended',
  '["browser_assisted", "manual_import"]'::jsonb,
  '{"visibleCitations": true, "sourcePanel": true, "screenshot": true, "sanitizedDom": false}'::jsonb,
  'unknown',
  '2026-08-23T00:00:00.000Z',
  'active',
  'system:wentian',
  '2026-08-23T00:00:00.000Z'
);
