import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { AuthenticatedLocalUser } from "./postgres-local-access.ts";
import { verifyLocalPassword } from "./local-password.ts";

export type ScopeDeletionStatus = "running" | "failed" | "succeeded";

export interface ScopeDeletionJobRecord {
  readonly id: string;
  readonly scopeId: string;
  readonly projectKey: string;
  readonly status: ScopeDeletionStatus;
  readonly attemptCount: number;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly lastErrorCode: string | null;
}

export interface ScopeDeletionObjectStore {
  deleteScopeObjects(scopeId: string): Promise<number>;
}

export class PostgresScopeDeletionService {
  private readonly pool: Pick<Pool, "query" | "connect">;
  private readonly objects: ScopeDeletionObjectStore;
  private readonly instanceId: string;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(options: {
    readonly pool: Pick<Pool, "query" | "connect">;
    readonly objects: ScopeDeletionObjectStore;
    readonly instanceId: string;
    readonly now?: () => string;
    readonly newId?: () => string;
  }) {
    this.pool = options.pool;
    this.objects = options.objects;
    this.instanceId = normalizeSegment(
      options.instanceId,
      "INVALID_INSTANCE_ID",
    );
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? randomUUID;
  }

  async requestDeletion(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly projectKey: string;
    readonly password: string;
    readonly expectedVersion: number;
  }): Promise<ScopeDeletionJobRecord> {
    requireInstanceOwner(input.user);
    requireScopeAccess(input.user, input.scopeId);
    await this.verifyPassword(input.user.id, input.password);
    const scopeId = normalizeId(input.scopeId, "INVALID_SCOPE_ID");
    const projectKey = normalizeProjectKey(input.projectKey);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("INVALID_SCOPE_VERSION");
    }
    const now = normalizeTimestamp(this.now());
    const jobId = this.newId();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scope = await client.query<{
        readonly project_key: string;
        readonly status: "active" | "archived" | "deleting";
        readonly version: number;
        readonly role: "owner" | "admin" | "analyst" | "viewer" | null;
      }>(
        `SELECT s.project_key, s.status, s.version, sm.role
         FROM scopes s
         LEFT JOIN scope_memberships sm
           ON sm.scope_id = s.id AND sm.user_id = $2
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [scopeId, input.user.id],
      );
      const row = scope.rows[0];
      if (!row || row.role === null) {
        throw new Error("RESOURCE_NOT_FOUND");
      }
      if (row.role !== "owner") {
        throw new Error("ACTION_FORBIDDEN");
      }
      if (row.status === "deleting") {
        throw new Error("SCOPE_DELETION_IN_PROGRESS");
      }
      if (row.version !== input.expectedVersion) {
        throw new Error("SCOPE_VERSION_CONFLICT");
      }
      if (row.project_key !== projectKey) {
        throw new Error("SCOPE_DELETE_CONFIRMATION_MISMATCH");
      }
      await client.query(
        `UPDATE scopes
         SET status = 'deleting', updated_at = $2, version = version + 1
         WHERE id = $1`,
        [scopeId, now],
      );
      await client.query(
        "DELETE FROM capture_token_nonces WHERE scope_id = $1",
        [scopeId],
      );
      await client.query(
        `INSERT INTO scope_deletion_jobs
          (id, scope_id, project_key, object_prefix, requested_by,
           requested_scope_version, status, attempt_count, requested_at,
           started_at, completed_at, objects_deleted_at, database_deleted_at,
           last_error_code)
         VALUES ($1, $2, $3, $4, $5, $6, 'running', 1, $7, $7,
                 NULL, NULL, NULL, NULL)`,
        [
          jobId,
          scopeId,
          projectKey,
          this.scopeObjectPrefix(scopeId),
          input.user.id,
          input.expectedVersion,
          now,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }

    return this.execute(jobId, scopeId);
  }

  async retryDeletion(input: {
    readonly user: AuthenticatedLocalUser;
    readonly jobId: string;
    readonly password: string;
  }): Promise<ScopeDeletionJobRecord> {
    requireInstanceOwner(input.user);
    await this.verifyPassword(input.user.id, input.password);
    const jobId = normalizeId(input.jobId, "INVALID_SCOPE_DELETION_JOB_ID");
    const now = normalizeTimestamp(this.now());
    const client = await this.pool.connect();
    let scopeId: string;
    try {
      await client.query("BEGIN");
      const result = await client.query<ScopeDeletionJobRow>(
        `SELECT id, scope_id, project_key, status, attempt_count,
                requested_at, completed_at, last_error_code
         FROM scope_deletion_jobs
         WHERE id = $1 AND requested_by = $2
         FOR UPDATE`,
        [jobId, input.user.id],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("RESOURCE_NOT_FOUND");
      }
      if (row.status === "succeeded") {
        await client.query("COMMIT");
        return toJobRecord(row);
      }
      if (row.status === "running") {
        throw new Error("SCOPE_DELETION_IN_PROGRESS");
      }
      scopeId = row.scope_id;
      await client.query(
        `UPDATE scope_deletion_jobs
         SET status = 'running', attempt_count = attempt_count + 1,
             started_at = $2, completed_at = NULL, last_error_code = NULL
         WHERE id = $1`,
        [jobId, now],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
    return this.execute(jobId, scopeId!);
  }

  async getDeletionByScope(
    user: AuthenticatedLocalUser,
    scopeId: string,
  ): Promise<ScopeDeletionJobRecord> {
    requireInstanceOwner(user);
    requireScopeAccess(user, scopeId);
    const result = await this.pool.query<ScopeDeletionJobRow>(
      `SELECT id, scope_id, project_key, status, attempt_count,
              requested_at, completed_at, last_error_code
       FROM scope_deletion_jobs
       WHERE scope_id = $1 AND requested_by = $2`,
      [normalizeId(scopeId, "INVALID_SCOPE_ID"), user.id],
    );
    if (!result.rows[0]) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    return toJobRecord(result.rows[0]);
  }

  private async execute(
    jobId: string,
    scopeId: string,
  ): Promise<ScopeDeletionJobRecord> {
    let phase: "object_store" | "database" = "object_store";
    try {
      await this.objects.deleteScopeObjects(scopeId);
      phase = "database";
      await this.deleteDatabaseRows(jobId, scopeId);
      phase = "object_store";
      await this.objects.deleteScopeObjects(scopeId);
      const completedAt = normalizeTimestamp(this.now());
      await this.pool.query(
        `UPDATE scope_deletion_jobs
         SET status = 'succeeded', completed_at = $2,
             objects_deleted_at = $2, last_error_code = NULL
         WHERE id = $1 AND status = 'running'`,
        [jobId, completedAt],
      );
    } catch {
      const errorCode =
        phase === "object_store"
          ? "SCOPE_OBJECT_DELETE_FAILED"
          : "SCOPE_DATABASE_DELETE_FAILED";
      await this.pool.query(
        `UPDATE scope_deletion_jobs
         SET status = 'failed', completed_at = $2, last_error_code = $3
         WHERE id = $1 AND status = 'running'`,
        [jobId, normalizeTimestamp(this.now()), errorCode],
      );
    }
    return this.getJob(jobId);
  }

  private async deleteDatabaseRows(
    jobId: string,
    scopeId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query<{ readonly status: ScopeDeletionStatus }>(
        "SELECT status FROM scope_deletion_jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      if (job.rows[0]?.status !== "running") {
        throw new Error("SCOPE_DELETION_JOB_NOT_RUNNING");
      }
      const scope = await client.query<{ readonly status: string }>(
        "SELECT status FROM scopes WHERE id = $1 FOR UPDATE",
        [scopeId],
      );
      if (scope.rows[0] && scope.rows[0].status !== "deleting") {
        throw new Error("SCOPE_NOT_DELETING");
      }
      for (const statement of SCOPE_DELETE_STATEMENTS) {
        await client.query(statement, [scopeId]);
      }
      await client.query(
        `UPDATE scope_deletion_jobs
         SET database_deleted_at = COALESCE(database_deleted_at, $2)
         WHERE id = $1`,
        [jobId, normalizeTimestamp(this.now())],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async getJob(jobId: string): Promise<ScopeDeletionJobRecord> {
    const result = await this.pool.query<ScopeDeletionJobRow>(
      `SELECT id, scope_id, project_key, status, attempt_count,
              requested_at, completed_at, last_error_code
       FROM scope_deletion_jobs
       WHERE id = $1`,
      [jobId],
    );
    if (!result.rows[0]) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    return toJobRecord(result.rows[0]);
  }

  private async verifyPassword(
    userId: string,
    password: string,
  ): Promise<void> {
    const result = await this.pool.query<{
      readonly password_hash: string;
      readonly status: "active" | "disabled";
    }>("SELECT password_hash, status FROM local_users WHERE id = $1", [userId]);
    const row = result.rows[0];
    if (
      !row ||
      row.status !== "active" ||
      !(await verifyLocalPassword(password, row.password_hash))
    ) {
      throw new Error("LOCAL_REAUTH_INVALID");
    }
  }

  private scopeObjectPrefix(scopeId: string): string {
    return `instances/${this.instanceId}/scopes/${scopeId}/`;
  }
}

const SCOPE_DELETE_STATEMENTS = Object.freeze([
  `UPDATE local_sessions
   SET revoked_at = COALESCE(revoked_at, now())
   WHERE geo_project_binding_id IN (
     SELECT id FROM geo_project_bindings WHERE scope_id = $1
   )`,
  `UPDATE geo_project_access_bindings
   SET status = 'revoked', access_version = access_version + 1,
       updated_at = now()
   WHERE project_binding_id IN (
     SELECT id FROM geo_project_bindings WHERE scope_id = $1
   ) AND status = 'active'`,
  `DELETE FROM geo_query_set_syncs
   WHERE project_binding_id IN (
     SELECT id FROM geo_project_bindings WHERE scope_id = $1
   )`,
  `UPDATE geo_project_bindings
   SET scope_id = NULL, status = 'disconnected',
       decided_at = COALESCE(decided_at, now()),
       decision_reason = 'wentian_scope_deleted',
       updated_at = now(), version = version + 1
   WHERE scope_id = $1`,
  "DELETE FROM ai_visibility_nominated_source_events WHERE scope_id = $1",
  "DELETE FROM ai_visibility_cited_source_events WHERE scope_id = $1",
  "DELETE FROM source_nomination_parse_reviews WHERE scope_id = $1",
  "DELETE FROM confirmed_consumer_observation_records WHERE scope_id = $1",
  "DELETE FROM consumer_capture_artifacts WHERE scope_id = $1",
  "DELETE FROM evidence_media_assets WHERE scope_id = $1",
  "DELETE FROM capture_token_nonces WHERE scope_id = $1",
  "DELETE FROM consumer_observation_tasks WHERE scope_id = $1",
  "DELETE FROM consumer_observation_runs WHERE scope_id = $1 AND paired_run_id IS NOT NULL",
  "DELETE FROM consumer_observation_runs WHERE scope_id = $1",
  "DELETE FROM query_set_snapshot_items WHERE scope_id = $1",
  "DELETE FROM query_set_snapshots WHERE scope_id = $1",
  "DELETE FROM scope_consumer_settings WHERE scope_id = $1",
  "DELETE FROM scope_memberships WHERE scope_id = $1",
  "DELETE FROM scopes WHERE id = $1",
]);

interface ScopeDeletionJobRow {
  readonly id: string;
  readonly scope_id: string;
  readonly project_key: string;
  readonly status: ScopeDeletionStatus;
  readonly attempt_count: number;
  readonly requested_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly last_error_code: string | null;
}

function toJobRecord(row: ScopeDeletionJobRow): ScopeDeletionJobRecord {
  return Object.freeze({
    id: row.id,
    scopeId: row.scope_id,
    projectKey: row.project_key,
    status: row.status,
    attemptCount: row.attempt_count,
    requestedAt: new Date(row.requested_at).toISOString(),
    completedAt:
      row.completed_at === null
        ? null
        : new Date(row.completed_at).toISOString(),
    lastErrorCode: row.last_error_code,
  });
}

function requireInstanceOwner(user: AuthenticatedLocalUser): void {
  if (user.instanceRole !== "owner") {
    throw new Error("ACTION_FORBIDDEN");
  }
}

function requireScopeAccess(
  user: AuthenticatedLocalUser,
  scopeId: string,
): void {
  if (!user.allowedScopeIds.includes(scopeId)) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
}

function normalizeProjectKey(value: string): string {
  const normalized = value.trim();
  if (
    !/^[a-z0-9\p{Script=Han}](?:[a-z0-9\p{Script=Han}-]{0,78}[a-z0-9\p{Script=Han}])?$/u.test(
      normalized,
    )
  ) {
    throw new Error("INVALID_PROJECT_KEY");
  }
  return normalized;
}

function normalizeId(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeSegment(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return new Date(value).toISOString();
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
