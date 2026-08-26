CREATE TABLE wentian_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  owner_user_id uuid,
  owner_initialized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wentian_instances_singleton_unique UNIQUE (singleton)
);

CREATE TABLE local_users (
  id uuid PRIMARY KEY,
  email_normalized varchar(320) NOT NULL,
  display_name varchar(120) NOT NULL,
  password_hash text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT local_users_email_normalized_unique UNIQUE (email_normalized),
  CONSTRAINT local_users_email_lowercase CHECK (email_normalized = lower(email_normalized))
);

CREATE TABLE instance_memberships (
  user_id uuid PRIMARY KEY REFERENCES local_users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('owner', 'admin')),
  created_at timestamptz NOT NULL
);

ALTER TABLE wentian_instances
  ADD CONSTRAINT wentian_instances_owner_user_fk
  FOREIGN KEY (owner_user_id) REFERENCES local_users(id) ON DELETE RESTRICT;

CREATE TABLE local_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX local_sessions_active_user_idx
  ON local_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE scopes (
  id uuid PRIMARY KEY,
  project_key varchar(80) NOT NULL UNIQUE,
  display_name varchar(160) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  retention_policy_code varchar(80) NOT NULL DEFAULT 'consumer-observation-governance@1',
  created_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE scope_memberships (
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope_id, user_id)
);

CREATE TABLE scope_consumer_settings (
  scope_id uuid PRIMARY KEY REFERENCES scopes(id) ON DELETE CASCADE,
  automation_enabled boolean NOT NULL DEFAULT false,
  allowed_usage_region varchar(40) NOT NULL DEFAULT 'CN_MAINLAND',
  governance_policy_version varchar(120) NOT NULL DEFAULT 'consumer-observation-governance@1',
  updated_by uuid NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1)
);

INSERT INTO wentian_instances (singleton) VALUES (true);
