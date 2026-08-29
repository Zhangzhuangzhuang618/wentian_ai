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
  '91a00000-0000-4000-8000-000000000003',
  'deepseek_web',
  'DeepSeek 网页版',
  'deepseek-web@1-visible-page',
  '["browser_assisted", "manual_import"]'::jsonb,
  '{"visibleCitations": true, "sourcePanel": false, "screenshot": true, "sanitizedDom": false}'::jsonb,
  'unknown',
  '2026-08-29T00:00:00.000Z',
  'active',
  'system:wentian',
  '2026-08-29T00:00:00.000Z'
);
