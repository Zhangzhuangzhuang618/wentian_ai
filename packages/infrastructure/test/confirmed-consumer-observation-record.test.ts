import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfirmedConsumerObservationRecord,
  createConsumerObservationRun,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
} from "@wentian/domain";

import {
  InMemoryConfirmedConsumerObservationRecordRepository,
  projectConfirmedConsumerObservationRecordToMetricSample,
} from "../src/index.ts";

test("追加式Repository按scope隔离并按问题和样本排序", async () => {
  const repository = new InMemoryConfirmedConsumerObservationRecordRepository();
  const second = createRecord("response-2", "query-2", 1, "task-2");
  const first = createRecord("response-1", "query-1", 2, "task-1");
  await repository.create(second);
  await repository.create(first);

  assert.equal(await repository.findRecordById("scope-1", first.id), first);
  assert.equal(await repository.findRecordById("other-scope", first.id), null);
  assert.deepEqual(
    (await repository.listByRun("scope-1", "run-1")).map((record) => record.id),
    ["response-1", "response-2"],
  );
});

test("相同响应ID或任务不能追加第二条确认记录", async () => {
  const repository = new InMemoryConfirmedConsumerObservationRecordRepository();
  const record = createRecord("response-1", "query-1", 1, "task-1");
  await repository.create(record);

  await assert.rejects(
    () => repository.create(record),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_CONFLICT/,
  );
  await assert.rejects(
    () => repository.create(createRecord("response-2", "query-1", 1, "task-1")),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_CONFLICT/,
  );
  await assert.rejects(
    () => repository.create(createRecord("response-3", "query-1", 1, "task-3")),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_CONFLICT/,
  );
});

test("不可变确认记录可直接投影为指标样本", () => {
  const { run, surface } = createRunFixture();
  const record = createRecord("response-1", "query-1", 1, "task-1");
  const sample = projectConfirmedConsumerObservationRecordToMetricSample({
    run,
    record,
    surfaceProfile: surface,
  });

  assert.equal(sample.id, record.id);
  assert.equal(sample.evidenceGrade, "web_confirmed_capture");
  assert.deepEqual(sample.citations, [
    { registrableDomain: "example.com", position: 1 },
  ]);
});

test("记录与运行、会话或Surface不一致时投影失败关闭", () => {
  const { run, surface } = createRunFixture();
  const record = createRecord("response-1", "query-1", 1, "task-1");

  assert.throws(
    () =>
      projectConfirmedConsumerObservationRecordToMetricSample({
        run,
        record: { ...record, runId: "other-run" },
        surfaceProfile: surface,
      }),
    /CONSUMER_METRIC_RECORD_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationRecordToMetricSample({
        run,
        record: {
          ...record,
          visibleMetadata: {
            ...record.visibleMetadata,
            searchMode: "enabled",
          },
        },
        surfaceProfile: surface,
      }),
    /CONSUMER_METRIC_SESSION_CONDITIONS_MISMATCH/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationRecordToMetricSample({
        run,
        record: { ...record, adapterVersion: "other-adapter@1" },
        surfaceProfile: surface,
      }),
    /CONSUMER_METRIC_SURFACE_BINDING_MISMATCH/,
  );
});

function createRecord(
  id: string,
  querySnapshotItemId: string,
  sampleIndex: number,
  observationTaskId: string,
) {
  return createConfirmedConsumerObservationRecord({
    id,
    scopeId: "scope-1",
    runId: "run-1",
    querySnapshotItemId,
    sampleIndex,
    observationTaskId,
    captureArtifactId: `artifact-${id}`,
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted",
    answerText: "合成可见回答。",
    visibleCitations: [
      { url: "https://www.example.com/a?utm_source=test", position: 1 },
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
      observedAt: "2026-08-22T10:00:00.000Z",
    },
    screenshotMediaAssetId: `screenshot-${id}`,
    adapterVersion: "doubao-web@1",
    confirmedBy: "user-1",
    confirmedAt: "2026-08-22T10:03:00.000Z",
  });
}

function createRunFixture() {
  const snapshot = createQuerySetSnapshot({
    id: "snapshot-1",
    itemIds: ["query-1"],
    scopeId: "scope-1",
    title: "合成问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
    queries: [
      {
        queryText: "广州搬家公司哪家好？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: "user-1",
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const surface = createConsumerSurfaceProfileVersion({
    id: "surface-1",
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    adapterVersion: "doubao-web@1",
    allowedCollectionMethods: ["browser_assisted"],
    visibleSourceCapabilities: {
      visibleCitations: true,
      sourcePanel: true,
      screenshot: true,
      sanitizedDom: false,
    },
    equivalenceLevel: "unknown",
    termsReviewedAt: "2026-08-22T09:00:00.000Z",
    status: "active",
    createdBy: "user-1",
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  return {
    surface,
    run: createConsumerObservationRun({
      id: "run-1",
      snapshot,
      surfaceProfile: surface,
      collectionMethod: "browser_assisted",
      experimentKind: "natural_answer",
      requestedSampleCount: 1,
      sessionConditions: {
        searchMode: "unknown",
        isNewConversation: true,
        isLoggedIn: true,
        memoryEnabled: null,
        personalizationEnabled: null,
        locale: "zh-CN",
        region: "Guangzhou",
      },
      createdBy: "user-1",
      createdAt: "2026-08-22T09:00:00.000Z",
    }),
  };
}
