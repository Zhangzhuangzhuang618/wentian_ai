CREATE TABLE source_nomination_parse_reviews (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  response_id uuid NOT NULL,
  status varchar(20) NOT NULL
    CHECK (status IN ('needs_review', 'confirmed', 'rejected')),
  review_json jsonb NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, response_id)
    REFERENCES confirmed_consumer_observation_records(scope_id, id)
    ON DELETE CASCADE,
  UNIQUE (scope_id, id),
  UNIQUE (scope_id, response_id)
);

CREATE INDEX source_nomination_reviews_scope_status_idx
  ON source_nomination_parse_reviews(scope_id, status, created_at, id);

CREATE TABLE ai_visibility_nominated_source_events (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL,
  run_id uuid NOT NULL,
  response_id uuid NOT NULL,
  query_snapshot_item_id uuid NOT NULL,
  sample_index smallint NOT NULL CHECK (sample_index BETWEEN 1 AND 5),
  source_key_hash char(64) NOT NULL,
  source_position integer CHECK (source_position >= 1),
  event_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (scope_id, run_id)
    REFERENCES consumer_observation_runs(scope_id, id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id, response_id)
    REFERENCES confirmed_consumer_observation_records(scope_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (scope_id, query_snapshot_item_id)
    REFERENCES query_set_snapshot_items(scope_id, id) ON DELETE RESTRICT,
  UNIQUE (scope_id, id)
);

CREATE UNIQUE INDEX ai_visibility_nominated_events_identity_idx
  ON ai_visibility_nominated_source_events(
    scope_id,
    response_id,
    source_key_hash,
    COALESCE(source_position, 0)
  );

CREATE INDEX ai_visibility_nominated_events_response_idx
  ON ai_visibility_nominated_source_events(
    scope_id,
    response_id,
    source_position,
    id
  );
