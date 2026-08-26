import type { Pool } from "pg";

import type { AuthenticatedLocalUser } from "./postgres-local-access.ts";

type QueryablePool = Pick<Pool, "connect">;

export interface DeletedConsumerObservationRun {
  readonly deletedRunId: string;
}

export class PostgresConsumerObservationRunDeletionService {
  private readonly pool: QueryablePool;

  constructor(pool: QueryablePool) {
    this.pool = pool;
  }

  async deleteUnstartedRun(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly runId: string;
  }): Promise<DeletedConsumerObservationRun> {
    requireInstanceOwner(input.user);
    requireScopeAccess(input.user, input.scopeId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scope = await client.query<{
        readonly status: "active" | "archived" | "deleting";
        readonly role: "owner" | "admin" | "analyst" | "viewer" | null;
      }>(
        `SELECT s.status, sm.role
         FROM scopes s
         LEFT JOIN scope_memberships sm
           ON sm.scope_id = s.id AND sm.user_id = $2
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [input.scopeId, input.user.id],
      );
      const scopeRow = scope.rows[0];
      if (!scopeRow || scopeRow.role === null) {
        throw new Error("RESOURCE_NOT_FOUND");
      }
      if (scopeRow.role !== "owner") {
        throw new Error("ACTION_FORBIDDEN");
      }
      if (scopeRow.status !== "active") {
        throw new Error("SCOPE_NOT_ACTIVE");
      }

      const run = await client.query<{ readonly status: string }>(
        `SELECT status
         FROM consumer_observation_runs
         WHERE scope_id = $1 AND id = $2
         FOR UPDATE`,
        [input.scopeId, input.runId],
      );
      if (!run.rows[0]) {
        throw new Error("RESOURCE_NOT_FOUND");
      }
      if (run.rows[0].status !== "queued") {
        throw new Error("CONSUMER_OBSERVATION_RUN_NOT_DELETABLE");
      }

      const tasks = await client.query<{
        readonly status: string;
        readonly has_capture_artifact: boolean;
        readonly has_confirmed_record: boolean;
      }>(
        `SELECT t.status,
                EXISTS (
                  SELECT 1 FROM consumer_capture_artifacts a
                  WHERE a.scope_id = t.scope_id
                    AND a.observation_task_id = t.id
                ) AS has_capture_artifact,
                EXISTS (
                  SELECT 1 FROM confirmed_consumer_observation_records r
                  WHERE r.scope_id = t.scope_id
                    AND r.observation_task_id = t.id
                ) AS has_confirmed_record
         FROM consumer_observation_tasks t
         WHERE t.scope_id = $1 AND t.run_id = $2
         FOR UPDATE`,
        [input.scopeId, input.runId],
      );
      if (
        tasks.rows.some(
          (task) =>
            task.status !== "waiting_user" ||
            task.has_capture_artifact ||
            task.has_confirmed_record,
        )
      ) {
        throw new Error("CONSUMER_OBSERVATION_RUN_NOT_DELETABLE");
      }

      const pairedRun = await client.query(
        `SELECT 1
         FROM consumer_observation_runs
         WHERE scope_id = $1 AND paired_run_id = $2
         LIMIT 1`,
        [input.scopeId, input.runId],
      );
      if (pairedRun.rowCount !== 0) {
        throw new Error("CONSUMER_OBSERVATION_RUN_NOT_DELETABLE");
      }

      let deleted;
      try {
        deleted = await client.query(
          `DELETE FROM consumer_observation_runs
           WHERE scope_id = $1 AND id = $2 AND status = 'queued'`,
          [input.scopeId, input.runId],
        );
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23503") {
          throw new Error("CONSUMER_OBSERVATION_RUN_NOT_DELETABLE");
        }
        throw error;
      }
      if (deleted.rowCount !== 1) {
        throw new Error("CONSUMER_OBSERVATION_RUN_NOT_DELETABLE");
      }
      await client.query("COMMIT");
      return Object.freeze({ deletedRunId: input.runId });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
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

async function rollback(client: { query(sql: string): Promise<unknown> }) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original failure.
  }
}
