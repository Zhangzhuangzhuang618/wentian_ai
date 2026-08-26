import assert from "node:assert/strict";
import test from "node:test";

import { ConfirmConsumerObservationTransactionService } from "@wentian/application";
import {
  claimConsumerObservationTask,
  createConfirmedConsumerObservationRecord,
  createConsumerCaptureEvidenceArtifact,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createWentianPrincipal,
  submitConsumerCaptureArtifact,
} from "@wentian/domain";

import {
  ConfirmedConsumerObservationSourceEventProjector,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  projectConfirmedConsumerObservationToCitedSourceEvents,
} from "../src/index.ts";

test("确认事务原子写入任务、正式记录和cited来源事件", async () => {
  const fixture = await createFixture();
  const result = await fixture.service.execute(
    fixture.principal,
    fixture.command,
  );

  assert.equal(result.task.status, "confirmed");
  assert.equal(result.record.id, "response-1");
  assert.equal(result.sourceEvents.length, 1);
  assert.equal(
    (await fixture.runs.findById("scope-1", "task-1"))?.status,
    "confirmed",
  );
  assert.equal(
    (await fixture.runs.findRecordById("scope-1", "response-1"))?.id,
    "response-1",
  );
  assert.equal(
    (await fixture.runs.listByResponse("scope-1", "response-1")).length,
    1,
  );
});

test("来源事件集合不完整时任务和正式记录均不落档", async () => {
  const fixture = await createFixture({ omitProjectedEvents: true });

  await assert.rejects(
    () => fixture.service.execute(fixture.principal, fixture.command),
    /CONSUMER_OBSERVATION_SOURCE_EVENT_SET_MISMATCH/,
  );
  assert.equal(
    (await fixture.runs.findById("scope-1", "task-1"))?.status,
    "needs_review",
  );
  assert.equal(
    await fixture.runs.findRecordById("scope-1", "response-1"),
    null,
  );
  assert.deepEqual(
    await fixture.runs.listByResponse("scope-1", "response-1"),
    [],
  );
});

test("来源事件ID冲突时事务整体失败且保留既有事件", async () => {
  const fixture = await createFixture();
  const existingRecord = createConfirmedConsumerObservationRecord({
    id: "response-existing",
    scopeId: "scope-1",
    runId: "run-1",
    querySnapshotItemId: "query-1",
    sampleIndex: 1,
    observationTaskId: "task-existing",
    captureArtifactId: "artifact-existing",
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted",
    answerText: "既有合成回答。",
    visibleCitations: [{ url: "https://www.example.com/source", position: 1 }],
    visibleMetadata: fixture.artifact.visibleMetadata,
    screenshotMediaAssetId: "screenshot-existing",
    adapterVersion: "doubao-web@1",
    confirmedBy: "user-1",
    confirmedAt: "2026-08-22T10:03:00.000Z",
  });
  await fixture.runs.createMany(
    projectConfirmedConsumerObservationToCitedSourceEvents({
      record: existingRecord,
      newId: () => "event-1",
      createdAt: existingRecord.confirmedAt,
    }),
  );

  await assert.rejects(
    () => fixture.service.execute(fixture.principal, fixture.command),
    /AI_VISIBILITY_SOURCE_EVENT_CONFLICT/,
  );
  assert.equal(
    (await fixture.runs.findById("scope-1", "task-1"))?.status,
    "needs_review",
  );
  assert.equal(
    await fixture.runs.findRecordById("scope-1", "response-1"),
    null,
  );
  assert.equal(
    (await fixture.runs.listByResponse("scope-1", "response-existing")).length,
    1,
  );
});

test("旧任务版本和非任务分配人不能执行确认事务", async () => {
  const fixture = await createFixture();
  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...fixture.command,
        taskVersion: 2,
      }),
    /OBSERVATION_TASK_VERSION_CONFLICT/,
  );

  const otherAnalyst = createWentianPrincipal({
    userId: "user-2",
    role: "analyst",
    allowedScopeIds: ["scope-1"],
  });
  await assert.rejects(
    () => fixture.service.execute(otherAnalyst, fixture.command),
    /ACTION_FORBIDDEN/,
  );
});

async function createFixture(options: { omitProjectedEvents?: boolean } = {}) {
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
  const sessionConditions = {
    searchMode: "unknown",
    isNewConversation: true,
    isLoggedIn: true,
    memoryEnabled: null,
    personalizationEnabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
  } as const;
  const run = createConsumerObservationRun({
    id: "run-1",
    snapshot,
    surfaceProfile: surface,
    collectionMethod: "browser_assisted",
    experimentKind: "natural_answer",
    requestedSampleCount: 1,
    sessionConditions,
    createdBy: "user-1",
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const waiting = createConsumerObservationTask({
    id: "task-1",
    scopeId: "scope-1",
    runId: "run-1",
    querySnapshotItemId: "query-1",
    sampleIndex: 1,
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted",
    assignedTo: "user-1",
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const capturing = claimConsumerObservationTask(waiting, {
    scopeId: "scope-1",
    userId: "user-1",
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const artifact = createConsumerCaptureEvidenceArtifact({
    id: "artifact-1",
    scopeId: "scope-1",
    observationTaskId: "task-1",
    capturedBy: "user-1",
    collectionMethod: "browser_assisted",
    answerText: "合成可见回答。",
    visibleCitations: [{ url: "https://www.example.com/source", position: 1 }],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      ...sessionConditions,
      observedAt: "2026-08-22T10:01:59.000Z",
    },
    screenshotMediaAssetId: "screenshot-1",
    adapterVersion: "doubao-web@1",
    createdAt: "2026-08-22T10:02:00.000Z",
  });
  const needsReview = submitConsumerCaptureArtifact(capturing, artifact, {
    scopeId: "scope-1",
    userId: "user-1",
    taskVersion: 2,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  const runs = new InMemoryConsumerObservationRunRepository();
  await runs.createWithTasks(run, snapshot, [waiting]);
  await runs.save(capturing, waiting.version);
  await runs.save(needsReview, capturing.version);
  const captureArtifacts =
    new InMemoryConsumerCaptureArtifactBindingRepository();
  await captureArtifacts.create(artifact);
  const ids = ["response-1", "event-1"];
  const realProjector = new ConfirmedConsumerObservationSourceEventProjector();
  const sourceEventProjector = options.omitProjectedEvents
    ? { project: () => [] }
    : realProjector;
  const service = new ConfirmConsumerObservationTransactionService({
    tasks: runs,
    runs,
    captureArtifacts,
    surfaceProfiles: new InMemoryConsumerSurfaceProfileVersionRepository([
      surface,
    ]),
    sourceEventProjector,
    transactions: runs,
    newId: () => {
      const id = ids.shift();
      if (!id) {
        throw new Error("TEST_ID_EXHAUSTED");
      }
      return id;
    },
  });
  const principal = createWentianPrincipal({
    userId: "user-1",
    role: "analyst",
    allowedScopeIds: ["scope-1"],
  });
  const command = {
    scopeId: "scope-1",
    taskId: "task-1",
    taskVersion: needsReview.version,
    occurredAt: "2026-08-22T10:03:00.000Z",
  } as const;

  return { service, principal, command, runs, artifact };
}
