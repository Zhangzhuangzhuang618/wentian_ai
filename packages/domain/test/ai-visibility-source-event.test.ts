import assert from "node:assert/strict";
import test from "node:test";

import { createAiVisibilityCitedSourceEvent } from "../src/index.ts";

test("创建固定为cited与answer粒度的不可变来源事件", () => {
  const event = createEvent();

  assert.equal(event.role, "cited");
  assert.equal(event.mappingGranularity, "answer");
  assert.equal(event.snippet, null);
  assert.equal(event.nominationValidationMethod, null);
  assert.equal(Object.isFrozen(event), true);
});

test("来源位置、哈希与HTTP URL严格校验", () => {
  assert.throws(
    () => createEvent({ sourcePosition: 0 }),
    /INVALID_SOURCE_EVENT_POSITION/,
  );
  assert.throws(
    () => createEvent({ sourceKeyHash: "invalid" }),
    /INVALID_SOURCE_EVENT_KEY_HASH/,
  );
  assert.throws(
    () => createEvent({ originalUrl: "ftp://example.com/a" }),
    /INVALID_SOURCE_EVENT_ORIGINAL_URL/,
  );
});

test("规范化URL的host必须与事件host一致", () => {
  assert.throws(
    () => createEvent({ host: "other.example" }),
    /SOURCE_EVENT_HOST_MISMATCH/,
  );
  assert.throws(
    () => createEvent({ registrableDomain: "other.example" }),
    /SOURCE_EVENT_REGISTRABLE_DOMAIN_MISMATCH/,
  );
});

function createEvent(
  overrides: Partial<
    Parameters<typeof createAiVisibilityCitedSourceEvent>[0]
  > = {},
) {
  return createAiVisibilityCitedSourceEvent({
    id: "event-1",
    scopeId: "scope-1",
    runId: "run-1",
    responseId: "response-1",
    querySnapshotItemId: "query-1",
    sampleIndex: 1,
    sourcePosition: 1,
    originalUrl: "https://www.example.com/a?utm_source=test",
    normalizedUrl: "https://www.example.com/a",
    sourceKeyHash: "1".repeat(64),
    host: "www.example.com",
    registrableDomain: "example.com",
    title: "示例来源",
    normalizationVersion: "url-normalization@1",
    createdAt: "2026-08-22T10:03:00.000Z",
    ...overrides,
  });
}
