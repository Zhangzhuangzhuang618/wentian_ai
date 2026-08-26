import assert from "node:assert/strict";
import test from "node:test";

import {
  HmacCaptureTokenService,
  PostgresCaptureTokenNonceRepository,
} from "../src/index.ts";

const claims = {
  systemInstanceId: "wentian-instance",
  scopeId: "21111111-1111-4111-8111-111111111111",
  taskId: "31111111-1111-4111-8111-111111111111",
  userId: "41111111-1111-4111-8111-111111111111",
  audienceOrigin: "http://127.0.0.1:3000",
  issuedAt: "2026-08-23T12:00:00.000Z",
  expiresAt: "2026-08-23T12:10:00.000Z",
} as const;

test("HMAC采集令牌可验证且篡改失败关闭", async () => {
  const service = new HmacCaptureTokenService("s".repeat(32));
  const issued = service.issue(claims);

  assert.equal((await service.verify(issued.token)).taskId, claims.taskId);
  await assert.rejects(
    () => service.verify(`${issued.token.slice(0, -1)}x`),
    /CAPTURE_TOKEN_INVALID/,
  );
});

test("PostgreSQL nonce只在未消费且未过期时成功一次", async () => {
  let consumed = false;
  const calls: string[] = [];
  const repository = new PostgresCaptureTokenNonceRepository(
    {
      async query(sql: string) {
        if (sql.includes("INSERT INTO capture_token_nonces")) {
          calls.push("issue");
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes("UPDATE capture_token_nonces")) {
          calls.push("consume");
          if (consumed) {
            return { rowCount: 0, rows: [] };
          }
          consumed = true;
          return { rowCount: 1, rows: [] };
        }
        throw new Error("UNEXPECTED_SQL");
      },
    } as never,
    { now: () => "2026-08-23T12:01:00.000Z" },
  );
  const service = new HmacCaptureTokenService("s".repeat(32));
  const issued = service.issue(claims);

  await repository.issue(issued.claims);
  assert.equal(await repository.consumeOnce(issued.claims.nonce), true);
  assert.equal(await repository.consumeOnce(issued.claims.nonce), false);
  assert.deepEqual(calls, ["issue", "consume", "consume"]);
});

test("采集令牌密钥不足32字节时拒绝启动", () => {
  assert.throws(
    () => new HmacCaptureTokenService("too-short"),
    /CAPTURE_TOKEN_SECRET_TOO_SHORT/,
  );
});
