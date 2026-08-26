import { randomUUID } from "node:crypto";

import {
  reconcileConsumerObservationRun,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type QuerySetSnapshot,
} from "@wentian/domain";
import type { Pool, PoolClient } from "pg";

import type { EvidenceObjectDeletion } from "./postgres-consumer-observation-repositories.ts";

export interface RetentionCleanupCounts {
  readonly expiredPendingEvidence: number;
  readonly expiredAbandonedCaptures: number;
  readonly purgedConfirmedScreenshots: number;
  readonly purgedConfirmedRawRecords: number;
  readonly deletedExpiredSessions: number;
  readonly deletedExpiredCaptureTokens: number;
}

export interface RetentionCleanupResult {
  readonly cleanupRunId: string;
  readonly cutoffAt: string;
  readonly counts: RetentionCleanupCounts;
}

type RetentionPool = Pick<Pool, "query" | "connect">;

export class PostgresRetentionCleanupService {
  private readonly pool: RetentionPool;
  private readonly objects: EvidenceObjectDeletion;
  private readonly newId: () => string;

  constructor(options: {
    readonly pool: RetentionPool;
    readonly objects: EvidenceObjectDeletion;
    readonly newId?: () => string;
  }) {
    this.pool = options.pool;
    this.objects = options.objects;
    this.newId = options.newId ?? randomUUID;
  }

  async runOnce(
    cutoffAt = new Date().toISOString(),
  ): Promise<RetentionCleanupResult> {
    const normalizedCutoff = normalizeTimestamp(cutoffAt);
    const cleanupRunId = this.newId();
    const counts = mutableZeroCounts();
    const startedAt = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO retention_cleanup_runs
        (id, cutoff_at, status, counts_json, started_at)
       VALUES ($1, $2, 'running', $3::jsonb, $4)`,
      [cleanupRunId, normalizedCutoff, JSON.stringify(counts), startedAt],
    );

    try {
      counts.expiredPendingEvidence =
        await this.purgeExpiredPendingEvidence(normalizedCutoff);
      counts.expiredAbandonedCaptures =
        await this.expireAbandonedCaptures(normalizedCutoff);
      counts.purgedConfirmedScreenshots =
        await this.purgeExpiredConfirmedScreenshots(normalizedCutoff);
      counts.purgedConfirmedRawRecords =
        await this.purgeExpiredConfirmedRawRecords(normalizedCutoff);
      counts.deletedExpiredSessions = await deleteExpiredRows(
        this.pool,
        "local_sessions",
        normalizedCutoff,
      );
      counts.deletedExpiredCaptureTokens = await deleteExpiredRows(
        this.pool,
        "capture_token_nonces",
        normalizedCutoff,
      );
      await this.pool.query(
        `UPDATE retention_cleanup_runs
         SET status = 'succeeded', counts_json = $2::jsonb, completed_at = $3
         WHERE id = $1 AND status = 'running'`,
        [cleanupRunId, JSON.stringify(counts), new Date().toISOString()],
      );
      return Object.freeze({
        cleanupRunId,
        cutoffAt: normalizedCutoff,
        counts: Object.freeze({ ...counts }),
      });
    } catch (error) {
      await this.pool
        .query(
          `UPDATE retention_cleanup_runs
           SET status = 'failed', counts_json = $2::jsonb,
               error_code = $3, completed_at = $4
           WHERE id = $1 AND status = 'running'`,
          [
            cleanupRunId,
            JSON.stringify(counts),
            safeErrorCode(error),
            new Date().toISOString(),
          ],
        )
        .catch(() => undefined);
      throw error;
    }
  }

  private async purgeExpiredPendingEvidence(cutoffAt: string): Promise<number> {
    const candidates = await this.pool.query<{ readonly id: string }>(
      `SELECT m.id
       FROM evidence_media_assets m
       JOIN consumer_capture_artifacts a
         ON a.scope_id = m.scope_id AND a.screenshot_media_asset_id = m.id
       JOIN consumer_observation_tasks t
         ON t.scope_id = a.scope_id AND t.id = a.observation_task_id
       WHERE m.retention_class = 'pending_24h'
         AND m.purged_at IS NULL
         AND m.expires_at <= $1
         AND t.status = 'needs_review'
       ORDER BY m.expires_at, m.id`,
      [cutoffAt],
    );
    let purged = 0;
    for (const candidate of candidates.rows) {
      if (await this.purgePendingAsset(candidate.id, cutoffAt)) {
        purged += 1;
      }
    }
    return purged;
  }

  private async purgePendingAsset(
    assetId: string,
    cutoffAt: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<PendingEvidenceRow>(
        `SELECT m.id AS asset_id, m.scope_id, m.object_key,
                a.id AS artifact_id, t.id AS task_id, t.run_id,
                t.version, t.task_json
         FROM evidence_media_assets m
         JOIN consumer_capture_artifacts a
           ON a.scope_id = m.scope_id AND a.screenshot_media_asset_id = m.id
         JOIN consumer_observation_tasks t
           ON t.scope_id = a.scope_id AND t.id = a.observation_task_id
         WHERE m.id = $1
           AND m.retention_class = 'pending_24h'
           AND m.purged_at IS NULL
           AND m.expires_at <= $2
           AND t.status = 'needs_review'
         FOR UPDATE OF m, a, t`,
        [assetId, cutoffAt],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      const task = parseTaskRow(row);
      const expiredTask = Object.freeze({
        ...task,
        status: "expired" as const,
        captureArtifactId: null,
        version: task.version + 1,
        updatedAt: cutoffAt,
      });
      await this.objects.deleteObject(row.object_key);
      const updated = await client.query(
        `UPDATE consumer_observation_tasks
         SET status = 'expired', task_json = $1::jsonb,
             version = $2, updated_at = $3
         WHERE scope_id = $4 AND id = $5
           AND version = $6 AND status = 'needs_review'`,
        [
          JSON.stringify(expiredTask),
          expiredTask.version,
          cutoffAt,
          row.scope_id,
          row.task_id,
          task.version,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error("RETENTION_TASK_VERSION_CONFLICT");
      }
      await client.query(
        "DELETE FROM consumer_capture_artifacts WHERE scope_id = $1 AND id = $2",
        [row.scope_id, row.artifact_id],
      );
      await client.query(
        "DELETE FROM evidence_media_assets WHERE scope_id = $1 AND id = $2",
        [row.scope_id, row.asset_id],
      );
      await reconcileRun(client, row.scope_id, row.run_id, cutoffAt);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async expireAbandonedCaptures(cutoffAt: string): Promise<number> {
    const candidates = await this.pool.query<{
      readonly id: string;
      readonly scope_id: string;
    }>(
      `SELECT id, scope_id
       FROM consumer_observation_tasks
       WHERE status = 'capturing'
         AND updated_at <= $1::timestamptz - interval '24 hours'
       ORDER BY updated_at, id`,
      [cutoffAt],
    );
    let expired = 0;
    for (const candidate of candidates.rows) {
      if (
        await this.expireAbandonedCapture(
          candidate.scope_id,
          candidate.id,
          cutoffAt,
        )
      ) {
        expired += 1;
      }
    }
    return expired;
  }

  private async expireAbandonedCapture(
    scopeId: string,
    taskId: string,
    cutoffAt: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<CapturingTaskRow>(
        `SELECT id AS task_id, scope_id, run_id, version, task_json
         FROM consumer_observation_tasks
         WHERE scope_id = $1 AND id = $2 AND status = 'capturing'
           AND updated_at <= $3::timestamptz - interval '24 hours'
         FOR UPDATE`,
        [scopeId, taskId, cutoffAt],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      const task = parseTaskRow(row);
      const expiredTask = Object.freeze({
        ...task,
        status: "expired" as const,
        version: task.version + 1,
        updatedAt: cutoffAt,
      });
      const updated = await client.query(
        `UPDATE consumer_observation_tasks
         SET status = 'expired', task_json = $1::jsonb,
             version = $2, updated_at = $3
         WHERE scope_id = $4 AND id = $5
           AND version = $6 AND status = 'capturing'`,
        [
          JSON.stringify(expiredTask),
          expiredTask.version,
          cutoffAt,
          row.scope_id,
          row.task_id,
          task.version,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error("RETENTION_TASK_VERSION_CONFLICT");
      }
      await reconcileRun(client, row.scope_id, row.run_id, cutoffAt);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async purgeExpiredConfirmedScreenshots(
    cutoffAt: string,
  ): Promise<number> {
    const candidates = await this.pool.query<{ readonly id: string }>(
      `SELECT id FROM evidence_media_assets
       WHERE retention_class = 'screenshot_30d'
         AND purged_at IS NULL AND expires_at <= $1
       ORDER BY expires_at, id`,
      [cutoffAt],
    );
    let purged = 0;
    for (const candidate of candidates.rows) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{
          readonly object_key: string;
        }>(
          `SELECT object_key FROM evidence_media_assets
           WHERE id = $1 AND retention_class = 'screenshot_30d'
             AND purged_at IS NULL AND expires_at <= $2
           FOR UPDATE`,
          [candidate.id, cutoffAt],
        );
        if (!found.rows[0]) {
          await client.query("ROLLBACK");
          continue;
        }
        await this.objects.deleteObject(found.rows[0].object_key);
        await client.query(
          `UPDATE evidence_media_assets
           SET purged_at = $2, purge_reason = 'confirmed_screenshot_30d',
               sha256 = NULL
           WHERE id = $1 AND purged_at IS NULL`,
          [candidate.id, cutoffAt],
        );
        await client.query("COMMIT");
        purged += 1;
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    }
    return purged;
  }

  private async purgeExpiredConfirmedRawRecords(
    cutoffAt: string,
  ): Promise<number> {
    const candidates = await this.pool.query<{ readonly id: string }>(
      `SELECT id FROM confirmed_consumer_observation_records
       WHERE raw_purged_at IS NULL AND raw_expires_at <= $1
       ORDER BY raw_expires_at, id`,
      [cutoffAt],
    );
    let purged = 0;
    for (const candidate of candidates.rows) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{
          readonly scope_id: string;
          readonly observation_task_id: string;
        }>(
          `SELECT scope_id, observation_task_id
           FROM confirmed_consumer_observation_records
           WHERE id = $1 AND raw_purged_at IS NULL AND raw_expires_at <= $2
           FOR UPDATE`,
          [candidate.id, cutoffAt],
        );
        const row = found.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          continue;
        }
        await client.query(
          `DELETE FROM consumer_capture_artifacts
           WHERE scope_id = $1 AND observation_task_id = $2`,
          [row.scope_id, row.observation_task_id],
        );
        await client.query(
          `UPDATE ai_visibility_cited_source_events
           SET event_json = jsonb_set(
             jsonb_set(event_json, '{originalUrl}', event_json->'normalizedUrl'),
             '{title}', 'null'::jsonb
           )
           WHERE scope_id = $1 AND response_id = $2`,
          [row.scope_id, candidate.id],
        );
        await client.query(
          `UPDATE ai_visibility_nominated_source_events
           SET event_json = jsonb_set(
             jsonb_set(event_json, '{nominationInformationType}', 'null'::jsonb),
             '{nominationReason}', 'null'::jsonb
           )
           WHERE scope_id = $1 AND response_id = $2`,
          [row.scope_id, candidate.id],
        );
        await client.query(
          `UPDATE source_nomination_parse_reviews
           SET review_json = jsonb_set(
             review_json,
             '{proposedItems}',
             COALESCE(
               (
                 SELECT jsonb_agg(
                   item || '{"informationType": null, "reason": null}'::jsonb
                   ORDER BY ordinal
                 )
                 FROM jsonb_array_elements(review_json->'proposedItems')
                   WITH ORDINALITY AS proposed(item, ordinal)
               ),
               '[]'::jsonb
             )
           )
           WHERE scope_id = $1 AND response_id = $2`,
          [row.scope_id, candidate.id],
        );
        await client.query(
          `UPDATE confirmed_consumer_observation_records
           SET record_json = NULL, answer_hash = NULL, raw_purged_at = $2
           WHERE id = $1 AND raw_purged_at IS NULL`,
          [candidate.id, cutoffAt],
        );
        await client.query("COMMIT");
        purged += 1;
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    }
    return purged;
  }
}

interface PendingEvidenceRow {
  readonly asset_id: string;
  readonly scope_id: string;
  readonly object_key: string;
  readonly artifact_id: string;
  readonly task_id: string;
  readonly run_id: string;
  readonly version: number;
  readonly task_json: unknown;
}

interface CapturingTaskRow {
  readonly task_id: string;
  readonly scope_id: string;
  readonly run_id: string;
  readonly version: number;
  readonly task_json: unknown;
}

function parseTaskRow(
  row: PendingEvidenceRow | CapturingTaskRow,
): ConsumerObservationTask {
  const task = structuredClone(row.task_json) as ConsumerObservationTask;
  if (
    !task ||
    task.id !== row.task_id ||
    task.scopeId !== row.scope_id ||
    task.runId !== row.run_id ||
    task.version !== row.version
  ) {
    throw new Error("RETENTION_TASK_JSON_MISMATCH");
  }
  return task;
}

async function reconcileRun(
  client: PoolClient,
  scopeId: string,
  runId: string,
  occurredAt: string,
): Promise<void> {
  const runResult = await client.query<{
    readonly run_json: unknown;
    readonly version: number;
  }>(
    `SELECT run_json, version FROM consumer_observation_runs
     WHERE scope_id = $1 AND id = $2 FOR UPDATE`,
    [scopeId, runId],
  );
  const runRow = runResult.rows[0];
  if (!runRow) {
    throw new Error("RETENTION_RUN_MISSING");
  }
  const run = structuredClone(runRow.run_json) as ConsumerObservationRun;
  if (
    run.id !== runId ||
    run.scopeId !== scopeId ||
    run.version !== runRow.version
  ) {
    throw new Error("RETENTION_RUN_JSON_MISMATCH");
  }
  const [snapshotResult, taskResult] = await Promise.all([
    client.query<{ readonly snapshot_json: unknown }>(
      `SELECT snapshot_json FROM query_set_snapshots
       WHERE scope_id = $1 AND id = $2`,
      [scopeId, run.querySetSnapshotId],
    ),
    client.query<{ readonly task_json: unknown }>(
      `SELECT task_json FROM consumer_observation_tasks
       WHERE scope_id = $1 AND run_id = $2
       ORDER BY query_snapshot_item_id, sample_index`,
      [scopeId, runId],
    ),
  ]);
  const snapshot = structuredClone(
    snapshotResult.rows[0]?.snapshot_json,
  ) as QuerySetSnapshot;
  if (
    !snapshot ||
    snapshot.id !== run.querySetSnapshotId ||
    snapshot.scopeId !== scopeId
  ) {
    throw new Error("RETENTION_SNAPSHOT_JSON_MISMATCH");
  }
  const tasks = taskResult.rows.map(
    (row) => structuredClone(row.task_json) as ConsumerObservationTask,
  );
  const reconciled = reconcileConsumerObservationRun(
    run,
    snapshot,
    tasks,
    occurredAt,
  );
  if (reconciled === run) {
    return;
  }
  const updated = await client.query(
    `UPDATE consumer_observation_runs
     SET status = $1, run_json = $2::jsonb, version = $3, updated_at = $4
     WHERE scope_id = $5 AND id = $6 AND version = $7`,
    [
      reconciled.status,
      JSON.stringify(reconciled),
      reconciled.version,
      reconciled.updatedAt,
      scopeId,
      runId,
      run.version,
    ],
  );
  if (updated.rowCount !== 1) {
    throw new Error("RETENTION_RUN_VERSION_CONFLICT");
  }
}

async function deleteExpiredRows(
  pool: Pick<Pool, "query">,
  table: "local_sessions" | "capture_token_nonces",
  cutoffAt: string,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM ${table} WHERE expires_at <= $1`,
    [cutoffAt],
  );
  return result.rowCount ?? 0;
}

function mutableZeroCounts(): {
  -readonly [Key in keyof RetentionCleanupCounts]: RetentionCleanupCounts[Key];
} {
  return {
    expiredPendingEvidence: 0,
    expiredAbandonedCaptures: 0,
    purgedConfirmedScreenshots: 0,
    purgedConfirmedRawRecords: 0,
    deletedExpiredSessions: 0,
    deletedExpiredCaptureTokens: 0,
  };
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (!value.trim() || !Number.isFinite(date.getTime())) {
    throw new Error("INVALID_RETENTION_CUTOFF");
  }
  if (date.getTime() > Date.now() + 60_000) {
    throw new Error("RETENTION_CUTOFF_IN_FUTURE");
  }
  return date.toISOString();
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,160}$/u.test(error.message)) {
    return error.message;
  }
  return "RETENTION_CLEANUP_FAILED";
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
