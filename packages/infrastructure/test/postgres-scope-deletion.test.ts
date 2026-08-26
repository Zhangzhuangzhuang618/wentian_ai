import assert from "node:assert/strict";
import test from "node:test";

import {
  hashLocalPassword,
  PostgresScopeDeletionService,
} from "../src/index.ts";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  job: "31111111-1111-4111-8111-111111111111",
} as const;
const password = "a-long-owner-password";

test("Owner二次确认后清理两次对象前缀并删除项目数据", async () => {
  const database = await FakeDeletionDatabase.create();
  const objectCalls: string[] = [];
  const service = new PostgresScopeDeletionService({
    pool: database.pool as never,
    objects: {
      async deleteScopeObjects(scopeId) {
        objectCalls.push(scopeId);
        return 1;
      },
    },
    instanceId: "wentian-instance",
    now: () => "2026-08-23T12:00:00.000Z",
    newId: () => ids.job,
  });

  const result = await service.requestDeletion({
    user: owner(),
    scopeId: ids.scope,
    projectKey: "guangzhou-moving",
    password,
    expectedVersion: 1,
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(objectCalls, [ids.scope, ids.scope]);
  assert.equal(database.scopeExists, false);
  assert.deepEqual(database.geoActions, [
    "REVOKE_GEO_SESSIONS",
    "REVOKE_GEO_ACCESS",
    "DELETE_GEO_QUERY_SYNCS",
    "DISCONNECT_GEO_BINDING",
  ]);
  assert.equal(database.deletedTables.at(-1), "scopes");
});

test("对象存储失败时保留作业并可由同一Owner重试", async () => {
  const database = await FakeDeletionDatabase.create();
  let first = true;
  const service = new PostgresScopeDeletionService({
    pool: database.pool as never,
    objects: {
      async deleteScopeObjects() {
        if (first) {
          first = false;
          throw new Error("S3_UNAVAILABLE");
        }
        return 0;
      },
    },
    instanceId: "wentian-instance",
    now: () => "2026-08-23T12:00:00.000Z",
    newId: () => ids.job,
  });

  const failed = await service.requestDeletion({
    user: owner(),
    scopeId: ids.scope,
    projectKey: "guangzhou-moving",
    password,
    expectedVersion: 1,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastErrorCode, "SCOPE_OBJECT_DELETE_FAILED");
  assert.equal(database.scopeStatus, "deleting");

  const succeeded = await service.retryDeletion({
    user: owner(),
    jobId: ids.job,
    password,
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.attemptCount, 2);
  assert.equal(database.scopeExists, false);
});

test("错密码和非实例Owner不能开始项目删除", async () => {
  const database = await FakeDeletionDatabase.create();
  const service = new PostgresScopeDeletionService({
    pool: database.pool as never,
    objects: { deleteScopeObjects: async () => 0 },
    instanceId: "wentian-instance",
  });
  await assert.rejects(
    () =>
      service.requestDeletion({
        user: owner(),
        scopeId: ids.scope,
        projectKey: "guangzhou-moving",
        password: "wrong-password-value",
        expectedVersion: 1,
      }),
    /LOCAL_REAUTH_INVALID/,
  );
  await assert.rejects(
    () =>
      service.requestDeletion({
        user: { ...owner(), instanceRole: "admin" },
        scopeId: ids.scope,
        projectKey: "guangzhou-moving",
        password,
        expectedVersion: 1,
      }),
    /ACTION_FORBIDDEN/,
  );
});

class FakeDeletionDatabase {
  readonly deletedTables: string[] = [];
  readonly geoActions: string[] = [];
  readonly pool: {
    query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
    connect: () => Promise<{
      query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
      release: () => void;
    }>;
  };
  scopeExists = true;
  scopeStatus: "active" | "deleting" = "active";
  private readonly passwordHash: string;
  private job: {
    status: "running" | "failed" | "succeeded";
    attemptCount: number;
    completedAt: string | null;
    lastErrorCode: string | null;
  } | null = null;

  private constructor(passwordHash: string) {
    this.passwordHash = passwordHash;
    this.pool = {
      query: (sql, values) => this.query(sql, values),
      connect: async () => ({
        query: (sql, values) => this.query(sql, values),
        release() {},
      }),
    };
  }

  static async create(): Promise<FakeDeletionDatabase> {
    return new FakeDeletionDatabase(await hashLocalPassword(password));
  }

  private async query(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount?: number }> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      return { rows: [] };
    }
    if (
      normalized.startsWith("SELECT password_hash, status FROM local_users")
    ) {
      return {
        rows: [{ password_hash: this.passwordHash, status: "active" }],
      };
    }
    if (normalized.startsWith("SELECT s.project_key")) {
      return {
        rows: this.scopeExists
          ? [
              {
                project_key: "guangzhou-moving",
                status: this.scopeStatus,
                version: this.scopeStatus === "active" ? 1 : 2,
                role: "owner",
              },
            ]
          : [],
      };
    }
    if (normalized.startsWith("UPDATE scopes SET status = 'deleting'")) {
      this.scopeStatus = "deleting";
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO scope_deletion_jobs")) {
      this.job = {
        status: "running",
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: null,
      };
      return { rows: [], rowCount: 1 };
    }
    if (
      normalized.startsWith("SELECT id, scope_id, project_key, status") &&
      normalized.includes("requested_by = $2")
    ) {
      return { rows: this.job ? [this.jobRow()] : [] };
    }
    if (
      normalized.startsWith("UPDATE scope_deletion_jobs SET status = 'running'")
    ) {
      this.job = {
        status: "running",
        attemptCount: (this.job?.attemptCount ?? 0) + 1,
        completedAt: null,
        lastErrorCode: null,
      };
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT status FROM scope_deletion_jobs")) {
      return { rows: this.job ? [{ status: this.job.status }] : [] };
    }
    if (normalized.startsWith("SELECT status FROM scopes")) {
      return {
        rows: this.scopeExists ? [{ status: this.scopeStatus }] : [],
      };
    }
    if (
      normalized.startsWith("UPDATE local_sessions") &&
      normalized.includes("geo_project_binding_id IN")
    ) {
      this.geoActions.push("REVOKE_GEO_SESSIONS");
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE geo_project_access_bindings")) {
      this.geoActions.push("REVOKE_GEO_ACCESS");
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("DELETE FROM geo_query_set_syncs")) {
      this.geoActions.push("DELETE_GEO_QUERY_SYNCS");
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE geo_project_bindings")) {
      this.geoActions.push("DISCONNECT_GEO_BINDING");
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("DELETE FROM ")) {
      const table = normalized.split(" ")[2]!;
      if (table !== "capture_token_nonces" || this.scopeStatus === "deleting") {
        this.deletedTables.push(table);
      }
      if (table === "scopes") this.scopeExists = false;
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("SET database_deleted_at = COALESCE")) {
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("SET status = 'succeeded'")) {
      this.job = {
        status: "succeeded",
        attemptCount: this.job?.attemptCount ?? 1,
        completedAt: String(values[1]),
        lastErrorCode: null,
      };
      return { rows: [], rowCount: 1 };
    }
    if (normalized.includes("SET status = 'failed'")) {
      this.job = {
        status: "failed",
        attemptCount: this.job?.attemptCount ?? 1,
        completedAt: String(values[1]),
        lastErrorCode: String(values[2]),
      };
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT id, scope_id, project_key, status")) {
      return { rows: this.job ? [this.jobRow()] : [] };
    }
    throw new Error(`UNEXPECTED_SQL:${normalized}`);
  }

  private jobRow() {
    return {
      id: ids.job,
      scope_id: ids.scope,
      project_key: "guangzhou-moving",
      status: this.job!.status,
      attempt_count: this.job!.attemptCount,
      requested_at: "2026-08-23T12:00:00.000Z",
      completed_at: this.job!.completedAt,
      last_error_code: this.job!.lastErrorCode,
    };
  }
}

function owner() {
  return {
    id: ids.user,
    email: "owner@example.com",
    displayName: "Owner",
    instanceRole: "owner" as const,
    allowedScopeIds: [ids.scope],
  };
}
