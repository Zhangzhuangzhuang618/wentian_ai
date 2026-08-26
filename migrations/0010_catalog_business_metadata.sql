ALTER TABLE scopes
  ADD COLUMN industry VARCHAR(80),
  ADD COLUMN region VARCHAR(80),
  ADD CONSTRAINT scopes_industry_non_blank
    CHECK (industry IS NULL OR length(btrim(industry)) > 0),
  ADD CONSTRAINT scopes_region_non_blank
    CHECK (region IS NULL OR length(btrim(region)) > 0);
