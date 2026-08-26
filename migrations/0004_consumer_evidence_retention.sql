ALTER TABLE evidence_media_assets
  ADD COLUMN purged_at timestamptz,
  ADD COLUMN purge_reason varchar(80),
  ADD CONSTRAINT evidence_media_purge_pair_check
    CHECK ((purged_at IS NULL) = (purge_reason IS NULL));

CREATE INDEX evidence_media_assets_expiry_idx
  ON evidence_media_assets(retention_class, expires_at, id)
  WHERE purged_at IS NULL;

ALTER TABLE confirmed_consumer_observation_records
  ADD COLUMN raw_expires_at timestamptz,
  ADD COLUMN raw_purged_at timestamptz;

UPDATE confirmed_consumer_observation_records
SET raw_expires_at = confirmed_at + interval '180 days';

ALTER TABLE confirmed_consumer_observation_records
  ALTER COLUMN raw_expires_at SET NOT NULL,
  ALTER COLUMN record_json DROP NOT NULL,
  ADD CONSTRAINT confirmed_record_raw_lifecycle_check
    CHECK (
      (raw_purged_at IS NULL AND record_json IS NOT NULL)
      OR
      (raw_purged_at IS NOT NULL AND record_json IS NULL)
    );

CREATE INDEX confirmed_consumer_records_raw_expiry_idx
  ON confirmed_consumer_observation_records(raw_expires_at, id)
  WHERE raw_purged_at IS NULL;

CREATE TABLE retention_cleanup_runs (
  id uuid PRIMARY KEY,
  cutoff_at timestamptz NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  counts_json jsonb NOT NULL,
  error_code varchar(160),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (
    (status = 'running' AND completed_at IS NULL AND error_code IS NULL)
    OR
    (status = 'succeeded' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR
    (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);
