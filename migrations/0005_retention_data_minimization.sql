ALTER TABLE evidence_media_assets
  ALTER COLUMN sha256 DROP NOT NULL;

UPDATE evidence_media_assets
SET sha256 = NULL
WHERE purged_at IS NOT NULL;

ALTER TABLE evidence_media_assets
  ADD CONSTRAINT evidence_media_hash_lifecycle_check
    CHECK (
      (purged_at IS NULL AND sha256 IS NOT NULL)
      OR
      (purged_at IS NOT NULL AND sha256 IS NULL)
    );

ALTER TABLE confirmed_consumer_observation_records
  ALTER COLUMN answer_hash DROP NOT NULL;

UPDATE ai_visibility_cited_source_events e
SET event_json = jsonb_set(
  jsonb_set(e.event_json, '{originalUrl}', e.event_json->'normalizedUrl'),
  '{title}',
  'null'::jsonb
)
FROM confirmed_consumer_observation_records r
WHERE r.scope_id = e.scope_id
  AND r.id = e.response_id
  AND r.raw_purged_at IS NOT NULL;

UPDATE ai_visibility_nominated_source_events e
SET event_json = jsonb_set(
  jsonb_set(e.event_json, '{nominationInformationType}', 'null'::jsonb),
  '{nominationReason}',
  'null'::jsonb
)
FROM confirmed_consumer_observation_records r
WHERE r.scope_id = e.scope_id
  AND r.id = e.response_id
  AND r.raw_purged_at IS NOT NULL;

UPDATE source_nomination_parse_reviews review
SET review_json = jsonb_set(
  review.review_json,
  '{proposedItems}',
  COALESCE(
    (
      SELECT jsonb_agg(
        item || '{"informationType": null, "reason": null}'::jsonb
        ORDER BY ordinal
      )
      FROM jsonb_array_elements(review.review_json->'proposedItems')
        WITH ORDINALITY AS proposed(item, ordinal)
    ),
    '[]'::jsonb
  )
)
FROM confirmed_consumer_observation_records r
WHERE r.scope_id = review.scope_id
  AND r.id = review.response_id
  AND r.raw_purged_at IS NOT NULL;

UPDATE confirmed_consumer_observation_records
SET answer_hash = NULL
WHERE raw_purged_at IS NOT NULL;

ALTER TABLE confirmed_consumer_observation_records
  ADD CONSTRAINT confirmed_record_answer_hash_lifecycle_check
    CHECK (
      (raw_purged_at IS NULL AND answer_hash IS NOT NULL)
      OR
      (raw_purged_at IS NOT NULL AND answer_hash IS NULL)
    );
