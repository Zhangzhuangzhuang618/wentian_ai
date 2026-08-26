import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  AiVisibilityCitedSourceEventRepository,
  ConfirmedConsumerObservationRecordRepository,
  ConfirmedConsumerObservationSampleReference,
  ConsumerCaptureArtifactBindingRepository,
  ConsumerCaptureSubmissionCommit,
  ConsumerCaptureSubmissionTransactionRepository,
  ConsumerObservationConfirmationCommit,
  ConsumerObservationConfirmationTransactionRepository,
  ConsumerObservationRunRepository,
  ConsumerObservationTaskRepository,
  ConsumerSurfaceProfileVersionRepository,
  QuerySetSnapshotRepository,
  ScopeRepository,
} from "@wentian/application";
import {
  assertConfirmedConsumerObservationRecordIntegrity,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createScope,
  summarizeConsumerObservationRunTasks,
  type AiVisibilityCitedSourceEvent,
  type ConfirmedConsumerObservationRecord,
  type ConsumerCaptureArtifact,
  type ConsumerCaptureEvidenceArtifact,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type ConsumerSurfaceProfileVersion,
  type QuerySetSnapshot,
  type Scope,
} from "@wentian/domain";
import type { Pool, PoolClient } from "pg";

import { assertProjectedCitedSourceEventIntegrity } from "./confirmed-consumer-observation-source-event-projection.ts";

export interface EvidenceMediaAsset {
  readonly id: string;
  readonly scopeId: string;
  readonly objectKey: string;
  readonly contentType: "image/png";
  readonly byteSize: number;
  readonly sha256: string;
  readonly retentionClass: "pending_24h" | "screenshot_30d";
  readonly expiresAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface EvidenceObjectDeletion {
  deleteObject(objectKey: string): Promise<void>;
}

type QueryablePool = Pick<Pool, "query" | "connect">;

export class PostgresScopeRepository implements ScopeRepository {
  private readonly pool: Pick<Pool, "query">;

  constructor(pool: Pick<Pool, "query">) {
    this.pool = pool;
  }

  async findById(scopeId: string): Promise<Scope | null> {
    const result = await this.pool.query<ScopeRow>(
      `SELECT id, project_key, display_name, status, retention_policy_code,
              created_by, created_at, updated_at, version
       FROM scopes WHERE id = $1`,
      [scopeId],
    );
    return result.rows[0] ? toScope(result.rows[0]) : null;
  }

  async listByIds(scopeIds: readonly string[]): Promise<readonly Scope[]> {
    if (scopeIds.length === 0) {
      return Object.freeze([]);
    }
    const result = await this.pool.query<ScopeRow>(
      `SELECT id, project_key, display_name, status, retention_policy_code,
              created_by, created_at, updated_at, version
       FROM scopes WHERE id = ANY($1::uuid[])`,
      [scopeIds],
    );
    const byId = new Map(result.rows.map((row) => [row.id, toScope(row)]));
    return Object.freeze(
      scopeIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    );
  }
}

export class PostgresQuerySetSnapshotRepository implements QuerySetSnapshotRepository {
  private readonly pool: QueryablePool;

  constructor(pool: QueryablePool) {
    this.pool = pool;
  }

  async findById(
    scopeId: string,
    snapshotId: string,
  ): Promise<QuerySetSnapshot | null> {
    const result = await this.pool.query<{ readonly snapshot_json: unknown }>(
      `SELECT snapshot_json
       FROM query_set_snapshots
       WHERE scope_id = $1 AND id = $2`,
      [scopeId, snapshotId],
    );
    return result.rows[0]
      ? hydrateQuerySetSnapshot(result.rows[0].snapshot_json)
      : null;
  }

  async listByScope(scopeId: string): Promise<readonly QuerySetSnapshot[]> {
    const result = await this.pool.query<{ readonly snapshot_json: unknown }>(
      `SELECT snapshot_json
       FROM query_set_snapshots
       WHERE scope_id = $1
       ORDER BY created_at DESC, id DESC`,
      [scopeId],
    );
    return Object.freeze(
      result.rows.map((row) => hydrateQuerySetSnapshot(row.snapshot_json)),
    );
  }

  async getOrCreate(snapshot: QuerySetSnapshot): Promise<{
    readonly snapshot: QuerySetSnapshot;
    readonly created: boolean;
  }> {
    const verified = hydrateQuerySetSnapshot(snapshot);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO query_set_snapshots
          (id, scope_id, snapshot_hash, snapshot_json, created_by, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          verified.id,
          verified.scopeId,
          verified.snapshotHash,
          JSON.stringify(verified),
          verified.createdBy,
          verified.createdAt,
        ],
      );
      if (inserted.rowCount === 1) {
        for (const item of verified.items) {
          await client.query(
            `INSERT INTO query_set_snapshot_items
              (id, scope_id, snapshot_id, ordinal, item_hash, item_json)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              item.id,
              verified.scopeId,
              verified.id,
              item.ordinal,
              item.itemHash,
              JSON.stringify(item),
            ],
          );
        }
        await client.query("COMMIT");
        return Object.freeze({ snapshot: verified, created: true });
      }

      const existing = await client.query<{ readonly snapshot_json: unknown }>(
        `SELECT snapshot_json
         FROM query_set_snapshots
         WHERE scope_id = $1 AND snapshot_hash = $2`,
        [verified.scopeId, verified.snapshotHash],
      );
      if (!existing.rows[0]) {
        throw new Error("QUERY_SET_SNAPSHOT_CONFLICT");
      }
      await client.query("COMMIT");
      return Object.freeze({
        snapshot: hydrateQuerySetSnapshot(existing.rows[0].snapshot_json),
        created: false,
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresConsumerSurfaceProfileVersionRepository implements ConsumerSurfaceProfileVersionRepository {
  private readonly pool: Pick<Pool, "query">;

  constructor(pool: Pick<Pool, "query">) {
    this.pool = pool;
  }

  async findById(id: string): Promise<ConsumerSurfaceProfileVersion | null> {
    const result = await this.pool.query<SurfaceRow>(
      `${SURFACE_SELECT} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toSurfaceProfile(result.rows[0]) : null;
  }

  async findActiveBySurfaceCode(
    surfaceCode: string,
  ): Promise<ConsumerSurfaceProfileVersion | null> {
    const result = await this.pool.query<SurfaceRow>(
      `${SURFACE_SELECT} WHERE surface_code = $1 AND status = 'active'`,
      [surfaceCode],
    );
    return result.rows[0] ? toSurfaceProfile(result.rows[0]) : null;
  }
}

export class PostgresConsumerObservationRepository
  implements
    ConsumerObservationRunRepository,
    ConsumerObservationTaskRepository,
    ConfirmedConsumerObservationRecordRepository,
    AiVisibilityCitedSourceEventRepository,
    ConsumerObservationConfirmationTransactionRepository
{
  private readonly pool: QueryablePool;

  constructor(pool: QueryablePool) {
    this.pool = pool;
  }

  async findRunById(
    scopeId: string,
    runId: string,
  ): Promise<ConsumerObservationRun | null> {
    const result = await this.pool.query<{
      readonly run_json: unknown;
      readonly version: number;
    }>(
      `SELECT run_json, version
       FROM consumer_observation_runs
       WHERE scope_id = $1 AND id = $2`,
      [scopeId, runId],
    );
    return result.rows[0]
      ? hydrateRun(result.rows[0].run_json, result.rows[0].version)
      : null;
  }

  async listRunsByScope(
    scopeId: string,
  ): Promise<readonly ConsumerObservationRun[]> {
    const result = await this.pool.query<{
      readonly run_json: unknown;
      readonly version: number;
    }>(
      `SELECT run_json, version
       FROM consumer_observation_runs
       WHERE scope_id = $1
       ORDER BY created_at DESC, id DESC`,
      [scopeId],
    );
    return Object.freeze(
      result.rows.map((row) => hydrateRun(row.run_json, row.version)),
    );
  }

  async createWithTasks(
    run: ConsumerObservationRun,
    snapshot: QuerySetSnapshot,
    tasks: readonly ConsumerObservationTask[],
  ): Promise<void> {
    summarizeConsumerObservationRunTasks(run, snapshot, tasks);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO consumer_observation_runs
          (id, scope_id, query_set_snapshot_id, surface_profile_version_id,
           paired_run_id, experiment_kind, status, run_json, version,
           created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
        [
          run.id,
          run.scopeId,
          run.querySetSnapshotId,
          run.surfaceProfileVersionId,
          run.pairedRunId,
          run.experimentKind,
          run.status,
          JSON.stringify(run),
          run.version,
          run.createdBy,
          run.createdAt,
          run.updatedAt,
        ],
      );
      for (const task of tasks) {
        await insertTask(client, task);
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listTasksForRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConsumerObservationTask[]> {
    const result = await this.pool.query<{
      readonly task_json: unknown;
      readonly version: number;
    }>(
      `SELECT task_json, version
       FROM consumer_observation_tasks
       WHERE scope_id = $1 AND run_id = $2
       ORDER BY query_snapshot_item_id, sample_index`,
      [scopeId, runId],
    );
    return Object.freeze(
      result.rows.map((row) => hydrateTask(row.task_json, row.version)),
    );
  }

  async saveRun(
    run: ConsumerObservationRun,
    expectedVersion: number,
  ): Promise<ConsumerObservationRun> {
    if (run.version !== expectedVersion + 1) {
      throw new Error("CONSUMER_OBSERVATION_RUN_VERSION_CONFLICT");
    }
    const result = await this.pool.query(
      `UPDATE consumer_observation_runs
       SET status = $1, run_json = $2::jsonb, version = $3, updated_at = $4
       WHERE scope_id = $5 AND id = $6 AND version = $7`,
      [
        run.status,
        JSON.stringify(run),
        run.version,
        run.updatedAt,
        run.scopeId,
        run.id,
        expectedVersion,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("CONSUMER_OBSERVATION_RUN_VERSION_CONFLICT");
    }
    return deepFreeze(structuredClone(run));
  }

  async findById(
    scopeId: string,
    taskId: string,
  ): Promise<ConsumerObservationTask | null> {
    const result = await this.pool.query<{
      readonly task_json: unknown;
      readonly version: number;
    }>(
      `SELECT task_json, version
       FROM consumer_observation_tasks
       WHERE scope_id = $1 AND id = $2`,
      [scopeId, taskId],
    );
    return result.rows[0]
      ? hydrateTask(result.rows[0].task_json, result.rows[0].version)
      : null;
  }

  async save(
    task: ConsumerObservationTask,
    expectedVersion: number,
  ): Promise<ConsumerObservationTask> {
    if (task.version !== expectedVersion + 1) {
      throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
    }
    const result = await this.pool.query(
      `UPDATE consumer_observation_tasks
       SET status = $1, task_json = $2::jsonb, version = $3, updated_at = $4
       WHERE scope_id = $5 AND id = $6 AND version = $7`,
      [
        task.status,
        JSON.stringify(task),
        task.version,
        task.updatedAt,
        task.scopeId,
        task.id,
        expectedVersion,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
    }
    return deepFreeze(structuredClone(task));
  }

  async create(record: ConfirmedConsumerObservationRecord): Promise<void> {
    assertConfirmedConsumerObservationRecordIntegrity(record);
    await this.pool.query(...insertRecordQuery(record));
  }

  async findRecordById(
    scopeId: string,
    recordId: string,
  ): Promise<ConfirmedConsumerObservationRecord | null> {
    const result = await this.pool.query<{ readonly record_json: unknown }>(
      `SELECT record_json
       FROM confirmed_consumer_observation_records
       WHERE scope_id = $1 AND id = $2 AND record_json IS NOT NULL`,
      [scopeId, recordId],
    );
    return result.rows[0]
      ? hydrateConfirmedRecord(result.rows[0].record_json)
      : null;
  }

  async listByRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConfirmedConsumerObservationRecord[]> {
    const result = await this.pool.query<{ readonly record_json: unknown }>(
      `SELECT record_json
       FROM confirmed_consumer_observation_records
       WHERE scope_id = $1 AND run_id = $2 AND record_json IS NOT NULL
       ORDER BY query_snapshot_item_id, sample_index`,
      [scopeId, runId],
    );
    return Object.freeze(
      result.rows.map((row) => hydrateConfirmedRecord(row.record_json)),
    );
  }

  async listSampleReferencesByRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConfirmedConsumerObservationSampleReference[]> {
    const result = await this.pool.query<{
      readonly id: string;
      readonly scope_id: string;
      readonly run_id: string;
      readonly query_snapshot_item_id: string;
      readonly sample_index: number;
    }>(
      `SELECT id, scope_id, run_id, query_snapshot_item_id, sample_index
       FROM confirmed_consumer_observation_records
       WHERE scope_id = $1 AND run_id = $2
       ORDER BY query_snapshot_item_id, sample_index`,
      [scopeId, runId],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          id: row.id,
          scopeId: row.scope_id,
          runId: row.run_id,
          querySnapshotItemId: row.query_snapshot_item_id,
          sampleIndex: row.sample_index,
        }),
      ),
    );
  }

  async createMany(
    events: readonly AiVisibilityCitedSourceEvent[],
  ): Promise<void> {
    for (const event of events) {
      assertProjectedCitedSourceEventIntegrity(event);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of events) {
        await client.query(...insertEventQuery(event));
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityCitedSourceEvent[]> {
    const result = await this.pool.query<{ readonly event_json: unknown }>(
      `SELECT event_json
       FROM ai_visibility_cited_source_events
       WHERE scope_id = $1 AND response_id = $2
       ORDER BY source_position, id`,
      [scopeId, responseId],
    );
    return Object.freeze(
      result.rows.map((row) => hydrateCitedEvent(row.event_json)),
    );
  }

  async commitConfirmation(
    input: ConsumerObservationConfirmationCommit,
  ): Promise<void> {
    assertConfirmationBindings(input);
    const run = await this.findRunById(
      input.record.scopeId,
      input.record.runId,
    );
    if (!run) {
      throw new Error("CONSUMER_OBSERVATION_CONFIRMATION_RUN_MISSING");
    }
    if (
      run.experimentKind === "source_nomination" &&
      input.sourceEvents.length !== 0
    ) {
      throw new Error("SOURCE_NOMINATION_CITED_EVENTS_FORBIDDEN");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const taskUpdate = await client.query(
        `UPDATE consumer_observation_tasks
         SET status = $1, task_json = $2::jsonb, version = $3, updated_at = $4
         WHERE scope_id = $5 AND id = $6 AND version = $7 AND status = 'needs_review'`,
        [
          input.task.status,
          JSON.stringify(input.task),
          input.task.version,
          input.task.updatedAt,
          input.task.scopeId,
          input.task.id,
          input.expectedTaskVersion,
        ],
      );
      if (taskUpdate.rowCount !== 1) {
        throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
      }
      await client.query(...insertRecordQuery(input.record));
      for (const event of input.sourceEvents) {
        await client.query(...insertEventQuery(event));
      }
      await client.query(
        `UPDATE evidence_media_assets
         SET retention_class = 'screenshot_30d',
             expires_at = $1::timestamptz + interval '30 days'
         WHERE scope_id = $2 AND id = $3`,
        [
          input.record.confirmedAt,
          input.record.scopeId,
          input.record.screenshotMediaAssetId,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresEvidenceMediaAssetRepository {
  private readonly pool: Pick<Pool, "query">;
  private readonly objects: EvidenceObjectDeletion | undefined;

  constructor(pool: Pick<Pool, "query">, objects?: EvidenceObjectDeletion) {
    this.pool = pool;
    this.objects = objects;
  }

  async create(asset: EvidenceMediaAsset): Promise<void> {
    assertEvidenceMediaAsset(asset);
    const inserted = await this.pool.query(
      `INSERT INTO evidence_media_assets
        (id, scope_id, object_key, content_type, byte_size, sha256,
         retention_class, expires_at, created_by, created_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       WHERE EXISTS (
         SELECT 1 FROM scopes WHERE id = $2 AND status = 'active'
       )`,
      [
        asset.id,
        asset.scopeId,
        asset.objectKey,
        asset.contentType,
        asset.byteSize,
        asset.sha256,
        asset.retentionClass,
        asset.expiresAt,
        asset.createdBy,
        asset.createdAt,
      ],
    );
    if (inserted.rowCount !== 1) {
      await this.objects?.deleteObject(asset.objectKey);
      throw new Error("SCOPE_NOT_ACTIVE");
    }
  }

  async findById(
    scopeId: string,
    assetId: string,
  ): Promise<EvidenceMediaAsset | null> {
    const result = await this.pool.query<MediaRow>(
      `SELECT id, scope_id, object_key, content_type, byte_size, sha256,
              retention_class, expires_at, created_by, created_at
       FROM evidence_media_assets
       WHERE scope_id = $1 AND id = $2 AND purged_at IS NULL`,
      [scopeId, assetId],
    );
    return result.rows[0] ? toMediaAsset(result.rows[0]) : null;
  }

  async purge(scopeId: string, assetId: string): Promise<boolean> {
    const asset = await this.findById(scopeId, assetId);
    if (!asset) {
      return false;
    }
    await this.objects?.deleteObject(asset.objectKey);
    const deleted = await this.pool.query(
      `DELETE FROM evidence_media_assets
       WHERE scope_id = $1 AND id = $2
         AND NOT EXISTS (
           SELECT 1 FROM consumer_capture_artifacts
           WHERE scope_id = $1 AND screenshot_media_asset_id = $2
         )`,
      [scopeId, assetId],
    );
    return deleted.rowCount === 1;
  }
}

export class PostgresConsumerCaptureArtifactRepository implements ConsumerCaptureArtifactBindingRepository {
  private readonly pool: QueryablePool;
  private readonly objects: EvidenceObjectDeletion | undefined;

  constructor(pool: QueryablePool, objects?: EvidenceObjectDeletion) {
    this.pool = pool;
    this.objects = objects;
  }

  async create(artifact: ConsumerCaptureArtifact): Promise<void> {
    if (!("captureSha256" in artifact)) {
      throw new Error("CAPTURE_EVIDENCE_ARTIFACT_REQUIRED");
    }
    const evidence = artifact as ConsumerCaptureEvidenceArtifact;
    await this.pool.query(
      `INSERT INTO consumer_capture_artifacts
        (id, scope_id, observation_task_id, screenshot_media_asset_id,
         artifact_json, capture_sha256, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        evidence.id,
        evidence.scopeId,
        evidence.observationTaskId,
        evidence.screenshotMediaAssetId,
        JSON.stringify(evidence),
        evidence.captureSha256,
        evidence.createdAt,
      ],
    );
  }

  async findById(
    scopeId: string,
    artifactId: string,
  ): Promise<ConsumerCaptureArtifact | null> {
    const result = await this.pool.query<{ readonly artifact_json: unknown }>(
      `SELECT artifact_json
       FROM consumer_capture_artifacts
       WHERE scope_id = $1 AND id = $2`,
      [scopeId, artifactId],
    );
    return result.rows[0]
      ? hydrateCaptureArtifact(result.rows[0].artifact_json)
      : null;
  }

  async purge(scopeId: string, artifactId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        readonly screenshot_media_asset_id: string;
        readonly object_key: string;
      }>(
        `SELECT a.screenshot_media_asset_id, m.object_key
         FROM consumer_capture_artifacts a
         JOIN evidence_media_assets m
           ON m.scope_id = a.scope_id AND m.id = a.screenshot_media_asset_id
         WHERE a.scope_id = $1 AND a.id = $2
         FOR UPDATE`,
        [scopeId, artifactId],
      );
      if (!found.rows[0]) {
        await client.query("ROLLBACK");
        return false;
      }
      await this.objects?.deleteObject(found.rows[0].object_key);
      await client.query(
        `DELETE FROM consumer_capture_artifacts
         WHERE scope_id = $1 AND id = $2`,
        [scopeId, artifactId],
      );
      await client.query(
        `DELETE FROM evidence_media_assets
         WHERE scope_id = $1 AND id = $2`,
        [scopeId, found.rows[0].screenshot_media_asset_id],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresConsumerCaptureSubmissionTransactionRepository implements ConsumerCaptureSubmissionTransactionRepository {
  private readonly pool: Pick<Pool, "connect">;

  constructor(pool: Pick<Pool, "connect">) {
    this.pool = pool;
  }

  async commitCapture(input: ConsumerCaptureSubmissionCommit): Promise<void> {
    if (!("captureSha256" in input.artifact)) {
      throw new Error("CAPTURE_EVIDENCE_ARTIFACT_REQUIRED");
    }
    const artifact = input.artifact as ConsumerCaptureEvidenceArtifact;
    if (
      input.task.status !== "needs_review" ||
      input.task.version !== input.expectedTaskVersion + 1 ||
      input.task.captureArtifactId !== artifact.id ||
      artifact.scopeId !== input.task.scopeId ||
      artifact.observationTaskId !== input.task.id ||
      artifact.createdAt !== input.consumedAt
    ) {
      throw new Error("CONSUMER_CAPTURE_SUBMISSION_BINDING_MISMATCH");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scope = await client.query<{ readonly status: string }>(
        "SELECT status FROM scopes WHERE id = $1 FOR SHARE",
        [input.task.scopeId],
      );
      if (scope.rows[0]?.status !== "active") {
        throw new Error("SCOPE_NOT_ACTIVE");
      }
      const nonce = await client.query(
        `UPDATE capture_token_nonces
         SET consumed_at = $2
         WHERE nonce_hash = $1
           AND consumed_at IS NULL
           AND expires_at > $2
           AND scope_id = $3
           AND observation_task_id = $4`,
        [
          sha256(input.captureTokenNonce),
          input.consumedAt,
          input.task.scopeId,
          input.task.id,
        ],
      );
      if (nonce.rowCount !== 1) {
        throw new Error("CAPTURE_TOKEN_ALREADY_CONSUMED");
      }
      await client.query(
        `INSERT INTO consumer_capture_artifacts
          (id, scope_id, observation_task_id, screenshot_media_asset_id,
           artifact_json, capture_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          artifact.id,
          artifact.scopeId,
          artifact.observationTaskId,
          artifact.screenshotMediaAssetId,
          JSON.stringify(artifact),
          artifact.captureSha256,
          artifact.createdAt,
        ],
      );
      const task = await client.query(
        `UPDATE consumer_observation_tasks
         SET status = $1, task_json = $2::jsonb, version = $3, updated_at = $4
         WHERE scope_id = $5 AND id = $6 AND version = $7 AND status = 'capturing'`,
        [
          input.task.status,
          JSON.stringify(input.task),
          input.task.version,
          input.task.updatedAt,
          input.task.scopeId,
          input.task.id,
          input.expectedTaskVersion,
        ],
      );
      if (task.rowCount !== 1) {
        throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

const SURFACE_SELECT = `SELECT id, surface_code, product_label, adapter_version,
  allowed_collection_methods_json, visible_source_capabilities_json,
  comparison_surface_model_label, comparison_provider_code,
  comparison_model_key, equivalence_level, equivalence_basis,
  equivalence_evidence_url, equivalence_reviewed_at, terms_reviewed_at,
  status, created_by, created_at
  FROM consumer_surface_profile_versions`;

interface ScopeRow {
  readonly id: string;
  readonly project_key: string;
  readonly display_name: string;
  readonly status: "active" | "archived" | "deleting";
  readonly retention_policy_code: string;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface SurfaceRow {
  readonly id: string;
  readonly surface_code: string;
  readonly product_label: string;
  readonly adapter_version: string;
  readonly allowed_collection_methods_json: readonly (
    "browser_assisted" | "manual_import"
  )[];
  readonly visible_source_capabilities_json: {
    readonly visibleCitations: boolean;
    readonly sourcePanel: boolean;
    readonly screenshot: boolean;
    readonly sanitizedDom: boolean;
  };
  readonly comparison_surface_model_label: string | null;
  readonly comparison_provider_code: string | null;
  readonly comparison_model_key: string | null;
  readonly equivalence_level: "exact" | "approximate" | "unknown";
  readonly equivalence_basis: string | null;
  readonly equivalence_evidence_url: string | null;
  readonly equivalence_reviewed_at: Date | string | null;
  readonly terms_reviewed_at: Date | string | null;
  readonly status: "draft" | "active" | "suspended";
  readonly created_by: string;
  readonly created_at: Date | string;
}

interface MediaRow {
  readonly id: string;
  readonly scope_id: string;
  readonly object_key: string;
  readonly content_type: "image/png";
  readonly byte_size: string | number;
  readonly sha256: string;
  readonly retention_class: "pending_24h" | "screenshot_30d";
  readonly expires_at: Date | string;
  readonly created_by: string;
  readonly created_at: Date | string;
}

function toScope(row: ScopeRow): Scope {
  return createScope({
    id: row.id,
    projectKey: row.project_key,
    displayName: row.display_name,
    status: row.status,
    retentionPolicyCode: row.retention_policy_code,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    version: row.version,
  });
}

function toSurfaceProfile(row: SurfaceRow): ConsumerSurfaceProfileVersion {
  return createConsumerSurfaceProfileVersion({
    id: row.id,
    surfaceCode: row.surface_code,
    productLabel: row.product_label,
    adapterVersion: row.adapter_version,
    allowedCollectionMethods: row.allowed_collection_methods_json,
    visibleSourceCapabilities: row.visible_source_capabilities_json,
    comparisonSurfaceModelLabel: row.comparison_surface_model_label,
    comparisonProviderCode: row.comparison_provider_code,
    comparisonModelKey: row.comparison_model_key,
    equivalenceLevel: row.equivalence_level,
    equivalenceBasis: row.equivalence_basis,
    equivalenceEvidenceUrl: row.equivalence_evidence_url,
    equivalenceReviewedAt: nullableIso(row.equivalence_reviewed_at),
    termsReviewedAt: nullableIso(row.terms_reviewed_at),
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  });
}

function hydrateQuerySetSnapshot(value: unknown): QuerySetSnapshot {
  const snapshot = value as QuerySetSnapshot;
  if (!snapshot || !Array.isArray(snapshot.items)) {
    throw new Error("QUERY_SET_SNAPSHOT_DATA_INVALID");
  }
  const rebuilt = createQuerySetSnapshot({
    id: snapshot.id,
    itemIds: snapshot.items.map((item) => item.id),
    scopeId: snapshot.scopeId,
    title: snapshot.title,
    locale: snapshot.locale,
    market: snapshot.market,
    ...(Object.hasOwn(snapshot, "industry")
      ? { industry: snapshot.industry }
      : {}),
    ...(Object.hasOwn(snapshot, "region") ? { region: snapshot.region } : {}),
    source: snapshot.source,
    queries: snapshot.items.map((item) => ({
      externalKey: item.externalKey,
      queryText: item.queryText,
      intentCode: item.intentCode,
      commercialValue: item.commercialValue,
    })),
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
  });
  if (!isDeepStrictEqual(rebuilt, snapshot)) {
    throw new Error("QUERY_SET_SNAPSHOT_DATA_DRIFT");
  }
  return rebuilt;
}

function hydrateRun(value: unknown, version: number): ConsumerObservationRun {
  const run = value as ConsumerObservationRun;
  if (
    !run ||
    run.version !== version ||
    run.retrievalMode !== "web_observed" ||
    run.executionTargetType !== "consumer_surface"
  ) {
    throw new Error("CONSUMER_OBSERVATION_RUN_DATA_DRIFT");
  }
  return deepFreeze(structuredClone(run));
}

function hydrateTask(value: unknown, version: number): ConsumerObservationTask {
  const task = value as ConsumerObservationTask;
  if (!task || task.version !== version || !task.id || !task.scopeId) {
    throw new Error("CONSUMER_OBSERVATION_TASK_DATA_DRIFT");
  }
  return deepFreeze(structuredClone(task));
}

function hydrateCaptureArtifact(
  value: unknown,
): ConsumerCaptureEvidenceArtifact {
  const artifact = value as ConsumerCaptureEvidenceArtifact;
  if (!artifact || !("captureSha256" in artifact)) {
    throw new Error("CAPTURE_ARTIFACT_DATA_INVALID");
  }
  return deepFreeze(structuredClone(artifact));
}

function hydrateConfirmedRecord(
  value: unknown,
): ConfirmedConsumerObservationRecord {
  const record = deepFreeze(
    structuredClone(value),
  ) as ConfirmedConsumerObservationRecord;
  assertConfirmedConsumerObservationRecordIntegrity(record);
  return record;
}

function hydrateCitedEvent(value: unknown): AiVisibilityCitedSourceEvent {
  const event = deepFreeze(
    structuredClone(value),
  ) as AiVisibilityCitedSourceEvent;
  assertProjectedCitedSourceEventIntegrity(event);
  return event;
}

function insertTask(client: PoolClient, task: ConsumerObservationTask) {
  return client.query(
    `INSERT INTO consumer_observation_tasks
      (id, scope_id, run_id, query_snapshot_item_id, sample_index,
       status, task_json, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
    [
      task.id,
      task.scopeId,
      task.runId,
      task.querySnapshotItemId,
      task.sampleIndex,
      task.status,
      JSON.stringify(task),
      task.version,
      task.createdAt,
      task.updatedAt,
    ],
  );
}

function insertRecordQuery(
  record: ConfirmedConsumerObservationRecord,
): [string, unknown[]] {
  return [
    `INSERT INTO confirmed_consumer_observation_records
      (id, scope_id, run_id, observation_task_id, query_snapshot_item_id,
       sample_index, record_json, answer_hash, confirmed_at, raw_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
             $9::timestamptz + interval '180 days')`,
    [
      record.id,
      record.scopeId,
      record.runId,
      record.observationTaskId,
      record.querySnapshotItemId,
      record.sampleIndex,
      JSON.stringify(record),
      record.answerHash,
      record.confirmedAt,
    ],
  ];
}

function insertEventQuery(
  event: AiVisibilityCitedSourceEvent,
): [string, unknown[]] {
  return [
    `INSERT INTO ai_visibility_cited_source_events
      (id, scope_id, run_id, response_id, query_snapshot_item_id,
       sample_index, source_key_hash, source_position, event_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      event.id,
      event.scopeId,
      event.runId,
      event.responseId,
      event.querySnapshotItemId,
      event.sampleIndex,
      event.sourceKeyHash,
      event.sourcePosition,
      JSON.stringify(event),
      event.createdAt,
    ],
  ];
}

function assertConfirmationBindings(
  input: ConsumerObservationConfirmationCommit,
): void {
  assertConfirmedConsumerObservationRecordIntegrity(input.record);
  if (
    input.task.status !== "confirmed" ||
    input.task.version !== input.expectedTaskVersion + 1 ||
    input.record.id !== input.task.confirmedResponseId ||
    input.record.scopeId !== input.task.scopeId ||
    input.record.observationTaskId !== input.task.id
  ) {
    throw new Error("CONSUMER_OBSERVATION_CONFIRMATION_BINDING_MISMATCH");
  }
  for (const event of input.sourceEvents) {
    assertProjectedCitedSourceEventIntegrity(event);
    if (
      event.scopeId !== input.record.scopeId ||
      event.runId !== input.record.runId ||
      event.responseId !== input.record.id ||
      event.querySnapshotItemId !== input.record.querySnapshotItemId ||
      event.sampleIndex !== input.record.sampleIndex
    ) {
      throw new Error("CONSUMER_OBSERVATION_SOURCE_EVENT_BINDING_MISMATCH");
    }
  }
}

function assertEvidenceMediaAsset(asset: EvidenceMediaAsset): void {
  if (
    asset.contentType !== "image/png" ||
    !Number.isInteger(asset.byteSize) ||
    asset.byteSize < 1 ||
    !/^[0-9a-f]{64}$/.test(asset.sha256) ||
    Date.parse(asset.expiresAt) <= Date.parse(asset.createdAt)
  ) {
    throw new Error("EVIDENCE_MEDIA_ASSET_INVALID");
  }
}

function toMediaAsset(row: MediaRow): EvidenceMediaAsset {
  const asset = Object.freeze({
    id: row.id,
    scopeId: row.scope_id,
    objectKey: row.object_key,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    retentionClass: row.retention_class,
    expiresAt: toIso(row.expires_at),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
  });
  assertEvidenceMediaAsset(asset);
  return asset;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
