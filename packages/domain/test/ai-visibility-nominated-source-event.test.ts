import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAiVisibilityNominatedSourceEventIntegrity,
  createAiVisibilityNominatedSourceEvent,
} from "../src/index.ts";

const input = {
  id: "11111111-1111-4111-8111-111111111111",
  scopeId: "21111111-1111-4111-8111-111111111111",
  runId: "31111111-1111-4111-8111-111111111111",
  responseId: "41111111-1111-4111-8111-111111111111",
  querySnapshotItemId: "51111111-1111-4111-8111-111111111111",
  sampleIndex: 1,
  sourcePosition: 1,
  sourceKeyHash: "a".repeat(64),
  registrableDomain: "Example.COM.",
  nominationInformationType: "行业榜单",
  nominationReason: "适合核验本地服务商名录",
  nominationValidationMethod: "human_confirmed" as const,
  normalizationVersion: "url-normalization@1",
  createdAt: "2026-08-22T12:00:00.000Z",
};

test("创建不伪造URL的domain-only nominated来源事件", () => {
  const event = createAiVisibilityNominatedSourceEvent(input);

  assert.equal(event.role, "nominated");
  assert.equal(event.registrableDomain, "example.com");
  assert.equal(event.host, "example.com");
  assert.equal(event.originalUrl, null);
  assert.equal(event.normalizedUrl, null);
  assert.equal(event.urlHash, null);
  assert.equal(event.nominationValidationMethod, "human_confirmed");
  assert.doesNotThrow(() =>
    assertAiVisibilityNominatedSourceEventIntegrity(event),
  );
});

test("未知顺序允许为空但非法位置和验证方式被拒绝", () => {
  assert.equal(
    createAiVisibilityNominatedSourceEvent({ ...input, sourcePosition: null })
      .sourcePosition,
    null,
  );
  assert.throws(() =>
    createAiVisibilityNominatedSourceEvent({ ...input, sourcePosition: 0 }),
  );
  assert.throws(() =>
    createAiVisibilityNominatedSourceEvent({
      ...input,
      nominationValidationMethod: "needs_review" as never,
    }),
  );
});

test("篡改URL空值或追加字段时结构完整性校验失败", () => {
  const event = createAiVisibilityNominatedSourceEvent(input);
  for (const mutated of [
    { ...event, originalUrl: "https://example.com" },
    { ...event, cookie: "session=secret" },
  ]) {
    assert.throws(() =>
      assertAiVisibilityNominatedSourceEventIntegrity(mutated as never),
    );
  }
});
