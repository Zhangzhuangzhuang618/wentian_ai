import assert from "node:assert/strict";
import test from "node:test";

import { PostgresConsumerObservationRunDeletionService } from "../src/postgres-consumer-observation-run-deletion.ts";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  run: "21111111-1111-4111-8111-111111111111",
  user: "31111111-1111-4111-8111-111111111111",
} as const;

test("Owner原子删除全部任务仍等待领取的运行", async () => {
  const database = new RunDeletionDatabase({
    scopeRole: "owner",
    runStatus: "queued",
    taskStatuses: ["waiting_user", "waiting_user"],
  });
  const service = new PostgresConsumerObservationRunDeletionService(
    database.pool,
  );

  const result = await service.deleteUnstartedRun({
    user: owner(),
    scopeId: ids.scope,
    runId: ids.run,
  });

  assert.deepEqual(result, { deletedRunId: ids.run });
  assert.equal(database.deleted, true);
  assert.deepEqual(database.transaction, ["BEGIN", "COMMIT"]);
});

test("已开始运行或已有非等待任务时拒绝删除", async () => {
  for (const fixture of [
    { runStatus: "running", taskStatuses: ["capturing"] },
    { runStatus: "queued", taskStatuses: ["needs_review"] },
    {
      runStatus: "queued",
      taskStatuses: ["waiting_user"],
      hasCaptureArtifact: true,
    },
  ]) {
    const database = new RunDeletionDatabase({
      scopeRole: "owner",
      ...fixture,
    });
    const service = new PostgresConsumerObservationRunDeletionService(
      database.pool,
    );

    await assert.rejects(
      () =>
        service.deleteUnstartedRun({
          user: owner(),
          scopeId: ids.scope,
          runId: ids.run,
        }),
      { message: "CONSUMER_OBSERVATION_RUN_NOT_DELETABLE" },
    );
    assert.equal(database.deleted, false);
    assert.deepEqual(database.transaction, ["BEGIN", "ROLLBACK"]);
  }
});

test("非项目Owner不能删除运行", async () => {
  const database = new RunDeletionDatabase({
    scopeRole: "admin",
    runStatus: "queued",
    taskStatuses: ["waiting_user"],
  });
  const service = new PostgresConsumerObservationRunDeletionService(
    database.pool,
  );

  await assert.rejects(
    () =>
      service.deleteUnstartedRun({
        user: owner(),
        scopeId: ids.scope,
        runId: ids.run,
      }),
    { message: "ACTION_FORBIDDEN" },
  );
  assert.equal(database.deleted, false);
});

function owner() {
  return {
    id: ids.user,
    email: "owner@wentian.local",
    displayName: "问天 Owner",
    instanceRole: "owner" as const,
    allowedScopeIds: [ids.scope],
  };
}

class RunDeletionDatabase {
  readonly transaction: string[] = [];
  deleted = false;
  private readonly scopeRole: "owner" | "admin";
  private readonly runStatus: string;
  private readonly taskStatuses: readonly string[];
  private readonly hasCaptureArtifact: boolean;
  private readonly hasConfirmedRecord: boolean;

  constructor(input: {
    readonly scopeRole: "owner" | "admin";
    readonly runStatus: string;
    readonly taskStatuses: readonly string[];
    readonly hasCaptureArtifact?: boolean;
    readonly hasConfirmedRecord?: boolean;
  }) {
    this.scopeRole = input.scopeRole;
    this.runStatus = input.runStatus;
    this.taskStatuses = input.taskStatuses;
    this.hasCaptureArtifact = input.hasCaptureArtifact ?? false;
    this.hasConfirmedRecord = input.hasConfirmedRecord ?? false;
  }

  readonly pool = {
    connect: async () => ({
      query: async (sql: string) => this.query(sql),
      release() {},
    }),
  } as never;

  private async query(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      this.transaction.push(normalized);
      return { rows: [], rowCount: null };
    }
    if (normalized.includes("FROM scopes s")) {
      return {
        rows: [{ status: "active", role: this.scopeRole }],
        rowCount: 1,
      };
    }
    if (
      normalized.includes("FROM consumer_observation_runs") &&
      normalized.includes("FOR UPDATE")
    ) {
      return { rows: [{ status: this.runStatus }], rowCount: 1 };
    }
    if (normalized.includes("FROM consumer_observation_tasks")) {
      return {
        rows: this.taskStatuses.map((status) => ({
          status,
          has_capture_artifact: this.hasCaptureArtifact,
          has_confirmed_record: this.hasConfirmedRecord,
        })),
        rowCount: this.taskStatuses.length,
      };
    }
    if (normalized.includes("paired_run_id")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("DELETE FROM consumer_observation_runs")) {
      this.deleted = true;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`UNEXPECTED_SQL:${normalized}`);
  }
}
