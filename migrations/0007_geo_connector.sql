ALTER TABLE local_users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN auth_source varchar(20) NOT NULL DEFAULT 'local'
    CHECK (auth_source IN ('local', 'geo')),
  ADD CONSTRAINT local_users_auth_password_check
    CHECK (
      (auth_source = 'local' AND password_hash IS NOT NULL)
      OR (auth_source = 'geo' AND password_hash IS NULL)
    );

CREATE TABLE geo_connector_instances (
  id uuid PRIMARY KEY,
  geo_instance_ref varchar(160) NOT NULL UNIQUE,
  geo_tenant_ref varchar(160) NOT NULL,
  display_name varchar(160) NOT NULL,
  allowed_geo_origins_json jsonb NOT NULL,
  callback_base_url text,
  status varchar(20) NOT NULL
    CHECK (status IN ('active', 'suspended', 'revoked')),
  contract_version varchar(80) NOT NULL
    CHECK (contract_version = 'wentian-geo-connector@1'),
  current_secret_ciphertext text NOT NULL,
  previous_secret_ciphertext text,
  previous_secret_expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    (previous_secret_ciphertext IS NULL) =
    (previous_secret_expires_at IS NULL)
  )
);

CREATE UNIQUE INDEX geo_connector_one_active_idx
  ON geo_connector_instances ((true))
  WHERE status = 'active';

CREATE TABLE geo_project_bindings (
  id uuid PRIMARY KEY,
  connector_instance_id uuid NOT NULL
    REFERENCES geo_connector_instances(id) ON DELETE RESTRICT,
  geo_workspace_ref varchar(160) NOT NULL,
  geo_project_ref varchar(160) NOT NULL,
  geo_project_display_name varchar(200) NOT NULL,
  scope_id uuid REFERENCES scopes(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL
    CHECK (status IN (
      'pending_wentian', 'active', 'suspended', 'rejected', 'disconnected'
    )),
  request_id varchar(160) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  requested_at timestamptz NOT NULL,
  decided_by uuid REFERENCES local_users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_reason varchar(500),
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (connector_instance_id, request_id),
  UNIQUE (connector_instance_id, idempotency_key),
  CHECK (
    (status = 'pending_wentian' AND scope_id IS NULL AND decided_at IS NULL)
    OR
    (status <> 'pending_wentian' AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX geo_project_binding_one_open_idx
  ON geo_project_bindings(connector_instance_id, geo_project_ref)
  WHERE status IN ('pending_wentian', 'active', 'suspended');

CREATE UNIQUE INDEX geo_project_binding_one_scope_idx
  ON geo_project_bindings(scope_id)
  WHERE scope_id IS NOT NULL AND status IN ('active', 'suspended');

CREATE INDEX geo_project_bindings_status_idx
  ON geo_project_bindings(status, requested_at, id);

CREATE TABLE geo_identity_bindings (
  id uuid PRIMARY KEY,
  connector_instance_id uuid NOT NULL
    REFERENCES geo_connector_instances(id) ON DELETE RESTRICT,
  geo_user_ref varchar(160) NOT NULL,
  local_user_id uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  display_name varchar(120) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (connector_instance_id, geo_user_ref)
);

CREATE TABLE geo_project_access_bindings (
  id uuid PRIMARY KEY,
  project_binding_id uuid NOT NULL
    REFERENCES geo_project_bindings(id) ON DELETE RESTRICT,
  identity_binding_id uuid NOT NULL
    REFERENCES geo_identity_bindings(id) ON DELETE RESTRICT,
  role varchar(20) NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  status varchar(20) NOT NULL CHECK (status IN ('active', 'revoked')),
  access_version integer NOT NULL DEFAULT 1 CHECK (access_version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_binding_id, identity_binding_id)
);

CREATE TABLE geo_connector_request_nonces (
  connector_instance_id uuid NOT NULL
    REFERENCES geo_connector_instances(id) ON DELETE CASCADE,
  nonce varchar(160) NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (connector_instance_id, nonce),
  CHECK (expires_at > created_at)
);

CREATE TABLE geo_sso_tickets (
  id uuid PRIMARY KEY,
  connector_instance_id uuid NOT NULL
    REFERENCES geo_connector_instances(id) ON DELETE RESTRICT,
  project_binding_id uuid NOT NULL
    REFERENCES geo_project_bindings(id) ON DELETE RESTRICT,
  access_binding_id uuid NOT NULL
    REFERENCES geo_project_access_bindings(id) ON DELETE RESTRICT,
  code_hash char(64) NOT NULL UNIQUE,
  code_ciphertext text NOT NULL,
  request_id varchar(160) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  requested_path varchar(500),
  binding_version integer NOT NULL CHECK (binding_version >= 1),
  access_version integer NOT NULL CHECK (access_version >= 1),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (connector_instance_id, request_id),
  UNIQUE (connector_instance_id, idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE TABLE geo_query_set_syncs (
  id uuid PRIMARY KEY,
  connector_instance_id uuid NOT NULL
    REFERENCES geo_connector_instances(id) ON DELETE RESTRICT,
  project_binding_id uuid NOT NULL
    REFERENCES geo_project_bindings(id) ON DELETE RESTRICT,
  geo_query_set_ref varchar(160) NOT NULL,
  geo_revision varchar(160) NOT NULL,
  request_id varchar(160) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES query_set_snapshots(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (connector_instance_id, request_id),
  UNIQUE (connector_instance_id, idempotency_key),
  UNIQUE (project_binding_id, geo_query_set_ref, geo_revision)
);

ALTER TABLE local_sessions
  ADD COLUMN auth_source varchar(20) NOT NULL DEFAULT 'local'
    CHECK (auth_source IN ('local', 'geo')),
  ADD COLUMN geo_project_binding_id uuid
    REFERENCES geo_project_bindings(id) ON DELETE RESTRICT,
  ADD COLUMN geo_access_binding_id uuid
    REFERENCES geo_project_access_bindings(id) ON DELETE RESTRICT,
  ADD COLUMN binding_version integer CHECK (binding_version >= 1),
  ADD COLUMN access_version integer CHECK (access_version >= 1),
  ADD CONSTRAINT local_sessions_geo_binding_check
    CHECK (
      (
        auth_source = 'local'
        AND geo_project_binding_id IS NULL
        AND geo_access_binding_id IS NULL
        AND binding_version IS NULL
        AND access_version IS NULL
      )
      OR
      (
        auth_source = 'geo'
        AND geo_project_binding_id IS NOT NULL
        AND geo_access_binding_id IS NOT NULL
        AND binding_version IS NOT NULL
        AND access_version IS NOT NULL
      )
    );
