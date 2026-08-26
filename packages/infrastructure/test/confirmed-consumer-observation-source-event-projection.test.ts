import assert from "node:assert/strict";
import test from "node:test";

import { createConfirmedConsumerObservationRecord } from "@wentian/domain";

import {
  InMemoryAiVisibilityCitedSourceEventRepository,
  projectConfirmedConsumerObservationToCitedSourceEvents,
} from "../src/index.ts";

test("确认记录投影为规范化cited来源事件", () => {
  const ids = ["event-1", "event-2"];
  const events = projectConfirmedConsumerObservationToCitedSourceEvents({
    record: createRecord(),
    newId: () => ids.shift()!,
    createdAt: "2026-08-22T10:03:00.000Z",
  });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => ({
      id: event.id,
      position: event.sourcePosition,
      domain: event.registrableDomain,
      normalizedUrl: event.normalizedUrl,
      title: event.title,
    })),
    [
      {
        id: "event-1",
        position: 1,
        domain: "example.com",
        normalizedUrl: "https://www.example.com/a",
        title: "来源A",
      },
      {
        id: "event-2",
        position: 3,
        domain: "example.org",
        normalizedUrl: "https://example.org/b",
        title: null,
      },
    ],
  );
  assert.match(events[0].urlHash, /^[0-9a-f]{64}$/);
  assert.match(events[0].sourceKeyHash, /^[0-9a-f]{64}$/);
});

test("不可注册URL保留在确认记录但不伪造来源事件", () => {
  let generatedIdCount = 0;
  const events = projectConfirmedConsumerObservationToCitedSourceEvents({
    record: createRecord(),
    newId: () => `event-${++generatedIdCount}`,
    createdAt: "2026-08-22T10:03:00.000Z",
  });

  assert.equal(events.length, 2);
  assert.equal(generatedIdCount, 2);
});

test("事件时间必须与确认时间一致且记录完整性必须有效", () => {
  const record = createRecord();
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToCitedSourceEvents({
        record,
        newId: () => "event-1",
        createdAt: "2026-08-22T10:03:01.000Z",
      }),
    /SOURCE_EVENT_CONFIRMATION_TIME_MISMATCH/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToCitedSourceEvents({
        record: { ...record, answerHash: "0".repeat(64) },
        newId: () => "event-1",
        createdAt: "2026-08-22T10:03:00.000Z",
      }),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_INTEGRITY_MISMATCH/,
  );
});

test("来源事件Repository批量追加原子、按scope隔离并拒绝唯一键冲突", async () => {
  const ids = ["event-1", "event-2"];
  const events = projectConfirmedConsumerObservationToCitedSourceEvents({
    record: createRecord(),
    newId: () => ids.shift()!,
    createdAt: "2026-08-22T10:03:00.000Z",
  });
  const repository = new InMemoryAiVisibilityCitedSourceEventRepository();
  await repository.createMany(events);

  assert.deepEqual(
    (await repository.listByResponse("scope-1", "response-1")).map(
      (event) => event.id,
    ),
    ["event-1", "event-2"],
  );
  assert.deepEqual(
    await repository.listByResponse("scope-2", "response-1"),
    [],
  );
  await assert.rejects(
    () => repository.createMany([{ ...events[0], id: "event-3" }]),
    /AI_VISIBILITY_SOURCE_EVENT_CONFLICT/,
  );
  assert.equal(
    (await repository.listByResponse("scope-1", "response-1")).length,
    2,
  );
});

test("Repository拒绝伪造归一化结果、来源键或额外字段", async () => {
  const events = projectConfirmedConsumerObservationToCitedSourceEvents({
    record: createRecord(),
    newId: () => "event-1",
    createdAt: "2026-08-22T10:03:00.000Z",
  });
  const candidates = [
    { ...events[0], sourceKeyHash: "0".repeat(64) },
    { ...events[0], normalizedUrl: "https://www.example.com/other" },
    { ...events[0], cookie: "forbidden" },
  ];

  for (const candidate of candidates) {
    const repository = new InMemoryAiVisibilityCitedSourceEventRepository();
    await assert.rejects(() => repository.createMany([candidate]));
    assert.deepEqual(
      await repository.listByResponse("scope-1", "response-1"),
      [],
    );
  }
});

function createRecord() {
  return createConfirmedConsumerObservationRecord({
    id: "response-1",
    scopeId: "scope-1",
    runId: "run-1",
    querySnapshotItemId: "query-1",
    sampleIndex: 1,
    observationTaskId: "task-1",
    captureArtifactId: "artifact-1",
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted",
    answerText: "合成可见回答。",
    visibleCitations: [
      {
        url: "https://www.example.com/a?utm_source=test",
        label: "来源A",
        position: 1,
      },
      { url: "https://127.0.0.1/private", position: 2 },
      { url: "https://example.org/b#fragment", position: 3 },
    ],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
      observedAt: "2026-08-22T10:02:00.000Z",
    },
    screenshotMediaAssetId: "screenshot-1",
    adapterVersion: "doubao-web@1",
    confirmedBy: "user-1",
    confirmedAt: "2026-08-22T10:03:00.000Z",
  });
}
