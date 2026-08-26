import assert from "node:assert/strict";
import test from "node:test";

import { HmacAutomationBatchTokenService } from "../src/index.ts";

const claims = {
  systemInstanceId: "wentian-instance",
  scopeId: "21111111-1111-4111-8111-111111111111",
  runId: "31111111-1111-4111-8111-111111111111",
  userId: "41111111-1111-4111-8111-111111111111",
  audienceOrigin: "http://127.0.0.1:3100",
  issuedAt: "2026-08-25T08:00:00.000Z",
  expiresAt: "2026-08-25T10:00:00.000Z",
} as const;

test("批次令牌可重复验证但不能被篡改", async () => {
  const service = new HmacAutomationBatchTokenService("s".repeat(32));
  const issued = service.issue(claims);

  assert.equal((await service.verify(issued.token)).runId, claims.runId);
  assert.equal((await service.verify(issued.token)).scopeId, claims.scopeId);
  await assert.rejects(
    () => service.verify(`${issued.token.slice(0, -1)}x`),
    /AUTOMATION_BATCH_TOKEN_INVALID/,
  );
});

test("批次令牌使用独立密钥长度门禁", () => {
  assert.throws(
    () => new HmacAutomationBatchTokenService("too-short"),
    /AUTOMATION_BATCH_TOKEN_SECRET_TOO_SHORT/,
  );
});
