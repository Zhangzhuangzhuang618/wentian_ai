import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const migrationsDirectory = path.join(projectRoot, "migrations");
const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((filename) => migrationPattern.test(filename))
  .sort();

if (migrationFiles.length === 0 || !migrationFiles[0]?.startsWith("0001_")) {
  throw new Error("MIGRATIONS_MUST_START_AT_0001");
}
for (let index = 0; index < migrationFiles.length; index += 1) {
  const expected = String(index + 1).padStart(4, "0");
  if (!migrationFiles[index]?.startsWith(`${expected}_`)) {
    throw new Error("MIGRATION_VERSION_GAP");
  }
}

const firstMigration = await readFile(
  path.join(migrationsDirectory, migrationFiles[0]),
  "utf8",
);
for (const requiredTable of [
  "wentian_instances",
  "local_users",
  "instance_memberships",
  "local_sessions",
  "scopes",
  "scope_memberships",
  "scope_consumer_settings",
]) {
  if (!firstMigration.includes(`CREATE TABLE ${requiredTable}`)) {
    throw new Error(`FOUNDATION_TABLE_MISSING:${requiredTable}`);
  }
}

const retentionMigration = await readFile(
  path.join(migrationsDirectory, "0004_consumer_evidence_retention.sql"),
  "utf8",
);
for (const requiredFact of [
  "retention_cleanup_runs",
  "raw_expires_at",
  "raw_purged_at",
  "purged_at",
]) {
  if (!retentionMigration.includes(requiredFact)) {
    throw new Error(`RETENTION_MIGRATION_FACT_MISSING:${requiredFact}`);
  }
}

const minimizationMigration = await readFile(
  path.join(migrationsDirectory, "0005_retention_data_minimization.sql"),
  "utf8",
);
for (const requiredFact of [
  "evidence_media_hash_lifecycle_check",
  "confirmed_record_answer_hash_lifecycle_check",
  "nominationInformationType",
  "originalUrl",
]) {
  if (!minimizationMigration.includes(requiredFact)) {
    throw new Error(`RETENTION_MINIMIZATION_FACT_MISSING:${requiredFact}`);
  }
}

const scopeDeletionMigration = await readFile(
  path.join(migrationsDirectory, "0006_scope_deletion.sql"),
  "utf8",
);
for (const requiredFact of [
  "scope_deletion_jobs",
  "'deleting'",
  "objects_deleted_at",
  "database_deleted_at",
]) {
  if (!scopeDeletionMigration.includes(requiredFact)) {
    throw new Error(`SCOPE_DELETION_MIGRATION_FACT_MISSING:${requiredFact}`);
  }
}

const geoConnectorMigration = await readFile(
  path.join(migrationsDirectory, "0007_geo_connector.sql"),
  "utf8",
);
for (const requiredFact of [
  "geo_connector_instances",
  "geo_project_bindings",
  "geo_project_access_bindings",
  "geo_sso_tickets",
  "geo_query_set_syncs",
  "wentian-geo-connector@1",
]) {
  if (!geoConnectorMigration.includes(requiredFact)) {
    throw new Error(`GEO_CONNECTOR_MIGRATION_FACT_MISSING:${requiredFact}`);
  }
}

const qianwenSurfaceMigration = await readFile(
  path.join(migrationsDirectory, "0008_qianwen_web_surface.sql"),
  "utf8",
);
for (const requiredFact of [
  "qianwen_web",
  "千问网页版",
  "qianwen-web@1-attended",
  "browser_assisted",
  "manual_import",
]) {
  if (!qianwenSurfaceMigration.includes(requiredFact)) {
    throw new Error(`QIANWEN_SURFACE_MIGRATION_FACT_MISSING:${requiredFact}`);
  }
}

const qianwenReferencePanelMigration = await readFile(
  path.join(migrationsDirectory, "0009_qianwen_visible_reference_panel.sql"),
  "utf8",
);
for (const requiredFact of [
  "qianwen_web",
  "qianwen-web@2-visible-reference-panel",
  '"sourcePanel": true',
  "'suspended'",
]) {
  if (!qianwenReferencePanelMigration.includes(requiredFact)) {
    throw new Error(
      `QIANWEN_REFERENCE_PANEL_MIGRATION_FACT_MISSING:${requiredFact}`,
    );
  }
}

const catalogBusinessMetadataMigration = await readFile(
  path.join(migrationsDirectory, "0010_catalog_business_metadata.sql"),
  "utf8",
);
for (const requiredFact of [
  "ADD COLUMN industry",
  "ADD COLUMN region",
  "scopes_industry_non_blank",
  "scopes_region_non_blank",
]) {
  if (!catalogBusinessMetadataMigration.includes(requiredFact)) {
    throw new Error(`CATALOG_BUSINESS_METADATA_MISSING:${requiredFact}`);
  }
}

const nominationMigration = await readFile(
  path.join(migrationsDirectory, "0003_source_nomination_comparison.sql"),
  "utf8",
);
for (const requiredTable of [
  "source_nomination_parse_reviews",
  "ai_visibility_nominated_source_events",
]) {
  if (!nominationMigration.includes(`CREATE TABLE ${requiredTable}`)) {
    throw new Error(`NOMINATION_PERSISTENCE_TABLE_MISSING:${requiredTable}`);
  }
}

if (
  !/automation_enabled boolean NOT NULL DEFAULT false/u.test(firstMigration)
) {
  throw new Error("AUTOMATION_SWITCH_MUST_DEFAULT_OFF");
}

const consumerMigration = await readFile(
  path.join(migrationsDirectory, "0002_consumer_observation_persistence.sql"),
  "utf8",
);
for (const requiredTable of [
  "query_set_snapshots",
  "consumer_surface_profile_versions",
  "consumer_observation_runs",
  "consumer_observation_tasks",
  "evidence_media_assets",
  "consumer_capture_artifacts",
  "confirmed_consumer_observation_records",
  "ai_visibility_cited_source_events",
  "capture_token_nonces",
]) {
  if (!consumerMigration.includes(`CREATE TABLE ${requiredTable}`)) {
    throw new Error(`CONSUMER_PERSISTENCE_TABLE_MISSING:${requiredTable}`);
  }
}

const compose = await readFile(
  path.join(projectRoot, "docker-compose.yml"),
  "utf8",
);
for (const requiredService of [
  "postgres:",
  "object-store:",
  "object-store-init:",
  "migrations:",
  "api:",
]) {
  if (!compose.includes(requiredService)) {
    throw new Error(`COMPOSE_SERVICE_MISSING:${requiredService}`);
  }
}
if (!compose.includes("image: postgres:16-alpine")) {
  throw new Error("POSTGRES_16_REQUIRED");
}
if (/^\s{2}(redis|geo[^:]*):/imu.test(compose)) {
  throw new Error("V1_FORBIDDEN_COMPOSE_DEPENDENCY");
}

process.stdout.write(
  `Standalone foundation is valid (${migrationFiles.length} migration).\n`,
);
