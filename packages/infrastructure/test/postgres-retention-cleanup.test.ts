import assert from "node:assert/strict";
import test from "node:test";

import { PostgresRetentionCleanupService } from "../src/postgres-retention-cleanup.ts";

test("没有到期数据时仍落档一次成功的保留清理审计", async () => {
  const statements: string[] = [];
  const pool = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("DELETE FROM local_sessions")) {
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes("DELETE FROM capture_token_nonces")) {
        return { rows: [], rowCount: 3 };
      }
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      throw new Error("NO_CANDIDATE_SHOULD_NOT_CONNECT");
    },
  };
  const cleanup = new PostgresRetentionCleanupService({
    pool: pool as never,
    objects: { async deleteObject() {} },
    newId: () => "00000000-0000-4000-8000-000000000001",
  });

  const cutoffAt = new Date(Date.now() - 1_000).toISOString();
  const result = await cleanup.runOnce(cutoffAt);

  assert.equal(result.cutoffAt, cutoffAt);
  assert.deepEqual(result.counts, {
    expiredPendingEvidence: 0,
    expiredAbandonedCaptures: 0,
    purgedConfirmedScreenshots: 0,
    purgedConfirmedRawRecords: 0,
    deletedExpiredSessions: 2,
    deletedExpiredCaptureTokens: 3,
  });
  assert.equal(
    statements.some((statement) =>
      statement.includes("INSERT INTO retention_cleanup_runs"),
    ),
    true,
  );
  assert.equal(
    statements.some((statement) => statement.includes("status = 'succeeded'")),
    true,
  );
});

test("非法清理截止时间在访问数据库前失败关闭", async () => {
  let queried = false;
  const cleanup = new PostgresRetentionCleanupService({
    pool: {
      async query() {
        queried = true;
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        throw new Error("UNUSED");
      },
    } as never,
    objects: { async deleteObject() {} },
  });

  await assert.rejects(() => cleanup.runOnce("not-a-time"), {
    message: "INVALID_RETENTION_CUTOFF",
  });
  assert.equal(queried, false);
});

test("明显位于未来的截止时间不能提前清除数据", async () => {
  const cleanup = new PostgresRetentionCleanupService({
    pool: {
      async query() {
        throw new Error("DATABASE_MUST_NOT_BE_READ");
      },
      async connect() {
        throw new Error("DATABASE_MUST_NOT_BE_READ");
      },
    } as never,
    objects: { async deleteObject() {} },
  });

  await assert.rejects(() => cleanup.runOnce("2099-01-01T00:00:00.000Z"), {
    message: "RETENTION_CUTOFF_IN_FUTURE",
  });
});
