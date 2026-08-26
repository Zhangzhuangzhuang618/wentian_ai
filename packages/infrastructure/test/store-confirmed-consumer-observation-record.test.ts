import assert from "node:assert/strict";
import test from "node:test";

import { StoreConfirmedConsumerObservationRecordService } from "@wentian/application";
import {
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  createConfirmedConsumerObservationRecord,
  createConsumerCaptureEvidenceArtifact,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createWentianPrincipal,
  isConsumerCaptureEvidenceArtifact,
  submitConsumerCaptureArtifact,
} from "@wentian/domain";

import {
  InMemoryConfirmedConsumerObservationRecordRepository,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
} from "../src/index.ts";

test("已确认任务由应用服务派生绑定并追加不可变记录", async () => {
  const fixture = await createFixture();
  const result = await fixture.service.execute(
    fixture.principal,
    fixture.command,
  );

  assert.equal(result.created, true);
  assert.equal(result.record.id, "response-1");
  assert.equal(result.record.runId, "run-1");
  assert.equal(result.record.observationTaskId, "task-1");
  assert.equal(result.record.confirmedBy, "user-1");
  assert.equal(result.record.confirmedAt, "2026-08-22T10:03:00.000Z");
  assert.equal(
    await fixture.records.findRecordById("scope-1", "response-1"),
    result.record,
  );
});

test("同内容重试幂等返回原记录", async () => {
  const fixture = await createFixture();
  const first = await fixture.service.execute(
    fixture.principal,
    fixture.command,
  );
  const retried = await fixture.service.execute(
    fixture.principal,
    fixture.command,
  );

  assert.equal(first.created, true);
  assert.equal(retried.created, false);
  assert.equal(retried.record, first.record);
});

test("相同确认响应的不同证据内容失败关闭", async () => {
  const fixture = await createFixture();
  const artifact = fixture.artifact;
  assert.equal(isConsumerCaptureEvidenceArtifact(artifact), true);
  if (!isConsumerCaptureEvidenceArtifact(artifact)) {
    throw new Error("TEST_EVIDENCE_ARTIFACT_REQUIRED");
  }
  await fixture.records.create(
    createConfirmedConsumerObservationRecord({
      id: "response-1",
      scopeId: "scope-1",
      runId: "run-1",
      querySnapshotItemId: "query-1",
      sampleIndex: 1,
      observationTaskId: "task-1",
      captureArtifactId: "artifact-1",
      surfaceProfileVersionId: "surface-1",
      collectionMethod: "browser_assisted",
      answerText: "不同的既有回答。",
      visibleCitations: artifact.visibleCitations,
      visibleMetadata: artifact.visibleMetadata,
      screenshotMediaAssetId: artifact.screenshotMediaAssetId,
      adapterVersion: artifact.adapterVersion,
      confirmedBy: "user-1",
      confirmedAt: "2026-08-22T10:03:00.000Z",
    }),
  );

  await assert.rejects(
    () => fixture.service.execute(fixture.principal, fixture.command),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_MISMATCH/,
  );
});

test("未确认任务不能生成确认记录", async () => {
  const fixture = await createFixture({ confirmed: false });

  await assert.rejects(
    () => fixture.service.execute(fixture.principal, fixture.command),
    /OBSERVATION_TASK_NOT_CONFIRMED/,
  );
});

test("运行会话、Surface版本和采集能力必须与证据一致", async () => {
  const sessionMismatch = await createFixture({ artifactLoggedIn: false });

  await assert.rejects(
    () =>
      sessionMismatch.service.execute(
        sessionMismatch.principal,
        sessionMismatch.command,
      ),
    /CONFIRMED_OBSERVATION_SESSION_MISMATCH/,
  );
  const adapterMismatch = await createFixture({
    artifactAdapterVersion: "other-adapter@1",
  });
  await assert.rejects(
    () =>
      adapterMismatch.service.execute(
        adapterMismatch.principal,
        adapterMismatch.command,
      ),
    /CONFIRMED_OBSERVATION_SURFACE_MISMATCH/,
  );
  const capabilityMismatch = await createFixture({ includeDom: true });
  await assert.rejects(
    () =>
      capabilityMismatch.service.execute(
        capabilityMismatch.principal,
        capabilityMismatch.command,
      ),
    /CONFIRMED_OBSERVATION_SURFACE_CAPABILITY_MISMATCH/,
  );
});

test("观察时间和artifact创建时间必须绑定任务采集窗口", async () => {
  const earlyObservation = await createFixture({
    artifactObservedAt: "2026-08-22T09:59:59.000Z",
  });

  await assert.rejects(
    () =>
      earlyObservation.service.execute(
        earlyObservation.principal,
        earlyObservation.command,
      ),
    /OBSERVATION_OUTSIDE_TASK_WINDOW/,
  );
  const timestampMismatch = await createFixture({
    artifactCreatedAt: "2026-08-22T10:01:59.000Z",
  });
  await assert.rejects(
    () =>
      timestampMismatch.service.execute(
        timestampMismatch.principal,
        timestampMismatch.command,
      ),
    /CONFIRMED_OBSERVATION_CAPTURE_TIME_MISMATCH/,
  );
});

test("只有包含完整白名单内容的待复核artifact才能生成正式记录", async () => {
  const fixture = await createFixture({ bindingOnly: true });

  await assert.rejects(
    () => fixture.service.execute(fixture.principal, fixture.command),
    /CAPTURE_EVIDENCE_ARTIFACT_REQUIRED/,
  );
});

test("跨scope隐藏资源且只读角色不能追加记录", async () => {
  const fixture = await createFixture();
  const otherScopePrincipal = createWentianPrincipal({
    userId: "user-1",
    role: "analyst",
    allowedScopeIds: ["scope-2"],
  });
  const viewer = createWentianPrincipal({
    userId: "user-1",
    role: "viewer",
    allowedScopeIds: ["scope-1"],
  });
  const otherAnalyst = createWentianPrincipal({
    userId: "user-2",
    role: "analyst",
    allowedScopeIds: ["scope-1"],
  });

  await assert.rejects(
    () => fixture.service.execute(otherScopePrincipal, fixture.command),
    /RESOURCE_NOT_FOUND/,
  );
  await assert.rejects(
    () => fixture.service.execute(viewer, fixture.command),
    /ACTION_FORBIDDEN/,
  );
  await assert.rejects(
    () => fixture.service.execute(otherAnalyst, fixture.command),
    /ACTION_FORBIDDEN/,
  );
});

async function createFixture(
  options: {
    confirmed?: boolean;
    bindingOnly?: boolean;
    artifactLoggedIn?: boolean;
    artifactAdapterVersion?: string;
    artifactObservedAt?: string;
    artifactCreatedAt?: string;
    includeDom?: boolean;
  } = {},
) {
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
  const artifact = options.bindingOnly
    ? ({
        id: "artifact-1",
        scopeId: "scope-1",
        observationTaskId: "task-1",
        capturedBy: "user-1",
        collectionMethod: "browser_assisted",
      } as const)
    : createConsumerCaptureEvidenceArtifact({
        id: "artifact-1",
        scopeId: "scope-1",
        observationTaskId: "task-1",
        capturedBy: "user-1",
        collectionMethod: "browser_assisted",
        answerText: "合成可见回答。",
        visibleCitations: [
          { url: "https://www.example.com/source", position: 1 },
        ],
        visibleMetadata: {
          productLabel: "豆包网页版",
          surfaceModelLabel: null,
          ...sessionConditions,
          isLoggedIn: options.artifactLoggedIn ?? true,
          observedAt: options.artifactObservedAt ?? "2026-08-22T10:01:59.000Z",
        },
        screenshotMediaAssetId: "screenshot-1",
        sanitizedDomObjectKey: options.includeDom ? "evidence/dom.html" : null,
        domHash: options.includeDom ? "0".repeat(64) : null,
        adapterVersion: options.artifactAdapterVersion ?? "doubao-web@1",
        createdAt: options.artifactCreatedAt ?? "2026-08-22T10:02:00.000Z",
      });
  const needsReview = submitConsumerCaptureArtifact(capturing, artifact, {
    scopeId: "scope-1",
    userId: "user-1",
    taskVersion: 2,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  const confirmed = confirmConsumerObservationTask(
    needsReview,
    artifact,
    {
      id: "response-1",
      scopeId: "scope-1",
      runId: "run-1",
      querySnapshotItemId: "query-1",
      sampleIndex: 1,
      captureArtifactId: "artifact-1",
    },
    {
      scopeId: "scope-1",
      userId: "user-1",
      taskVersion: 3,
      occurredAt: "2026-08-22T10:03:00.000Z",
    },
  ).task;

  const runs = new InMemoryConsumerObservationRunRepository();
  await runs.createWithTasks(run, snapshot, [waiting]);
  await runs.save(capturing, waiting.version);
  await runs.save(needsReview, capturing.version);
  if (options.confirmed !== false) {
    await runs.save(confirmed, needsReview.version);
  }
  const captureArtifacts =
    new InMemoryConsumerCaptureArtifactBindingRepository();
  await captureArtifacts.create(artifact);
  const records = new InMemoryConfirmedConsumerObservationRecordRepository();
  const service = new StoreConfirmedConsumerObservationRecordService({
    tasks: runs,
    runs,
    captureArtifacts,
    surfaceProfiles: new InMemoryConsumerSurfaceProfileVersionRepository([
      surface,
    ]),
    records,
  });
  const principal = createWentianPrincipal({
    userId: "user-1",
    role: "analyst",
    allowedScopeIds: ["scope-1"],
  });
  const command = {
    scopeId: "scope-1",
    taskId: "task-1",
  } as const;

  return { service, principal, command, records, artifact };
}
