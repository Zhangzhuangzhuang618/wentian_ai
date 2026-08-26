import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildConsumerSourceNominationMetricSampleBatchService,
  WentianApplicationError,
} from "@wentian/application";
import {
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  confirmSourceNominationParseReview,
  createConfirmedConsumerObservationRecord,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createSourceNominationParseReview,
  createWentianPrincipal,
  reconcileConsumerObservationRun,
  rejectConsumerObservationTask,
  rejectSourceNominationParseReview,
  submitConsumerCaptureArtifact,
  type ConsumerObservationTask,
} from "@wentian/domain";

import {
  ConfirmedConsumerSourceNominationMetricSampleProjector,
  InMemoryConfirmedConsumerObservationRecordRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
  InMemorySourceNominationParseReviewRepository,
  SourceNominationEventProjector,
} from "../src/index.ts";

test("从终结自述运行构建包含三种复核结果的完整指标批次", async () => {
  const fixture = await createFixture();
  const batch = await fixture.service.execute(principal, command);

  assert.equal(batch.scopeId, ids.scope);
  assert.equal(batch.runId, ids.run);
  assert.equal(batch.querySetSnapshotHash, fixture.run.querySetSnapshotHash);
  assert.equal(batch.querySetSourceType, "local");
  assert.equal(batch.geoConnectorContractVersion, null);
  assert.equal(batch.experimentKind, "source_nomination");
  assert.equal(batch.collectionMethod, "browser_assisted");
  assert.equal(batch.nominationContext, "unaided");
  assert.equal(batch.surfaceProfileVersionId, ids.surface);
  assert.equal(batch.consumerSurfaceCode, "doubao_web");
  assert.equal(batch.normalizationVersion, "url-normalization@1");
  assert.equal(batch.unsupportedInternalClaimSampleCount, 0);
  assert.deepEqual(batch.unsupportedInternalClaimAssessmentVersions, [
    "unsupported-internal-claim@1",
  ]);
  assert.deepEqual(batch.sampleBasis, {
    planned: 4,
    successful: 3,
    failed: 1,
  });
  assert.deepEqual(
    batch.samples.map((sample) => sample.validationStatus),
    ["human_confirmed", "needs_review", "rejected"],
  );
  assert.deepEqual(batch.samples[0].nominations, [
    { registrableDomain: "example.com", position: 1 },
  ]);
  assert.deepEqual(batch.samples[1].nominations, []);
  assert.deepEqual(batch.samples[2].nominations, []);
});

test("非终结运行和跨scope请求不能构建自述指标批次", async () => {
  const fixture = await createFixture({ terminal: false });
  await assert.rejects(
    () => fixture.service.execute(principal, command),
    /TERMINAL_SOURCE_NOMINATION_CONSUMER_RUN_REQUIRED/,
  );
  await assert.rejects(
    () =>
      fixture.service.execute(principal, {
        scopeId: "other-scope",
        runId: ids.run,
      }),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
});

test("确认任务缺响应、成功响应缺review和失败任务带响应均失败关闭", async () => {
  const missingResponse = await createFixture({ includeFirstResponse: false });
  await assert.rejects(
    () => missingResponse.service.execute(principal, command),
    /SOURCE_NOMINATION_METRIC_RESPONSE_MISSING/,
  );

  const missingReview = await createFixture({ includeSecondReview: false });
  await assert.rejects(
    () => missingReview.service.execute(principal, command),
    /SOURCE_NOMINATION_METRIC_REVIEW_MISSING/,
  );

  const extraResponse = await createFixture({ includeFailedResponse: true });
  await assert.rejects(
    () => extraResponse.service.execute(principal, command),
    /SOURCE_NOMINATION_METRIC_RESPONSE_FOR_FAILED_TASK/,
  );
});

test("投影样本身份和历史Surface证据错绑时失败关闭", async () => {
  const corruptProjection = await createFixture({ corruptProjection: true });
  await assert.rejects(
    () => corruptProjection.service.execute(principal, command),
    /SOURCE_NOMINATION_METRIC_PROJECTED_SAMPLE_MISMATCH/,
  );

  const wrongSurface = await createFixture({ wrongSurfaceAdapter: true });
  await assert.rejects(
    () => wrongSurface.service.execute(principal, command),
    /SOURCE_NOMINATION_METRIC_RESPONSE_SURFACE_MISMATCH/,
  );
});

test("GEO问题集来源契约版本进入自述指标批次", async () => {
  const fixture = await createFixture({ geoSource: true });
  const batch = await fixture.service.execute(principal, command);

  assert.equal(batch.querySetSourceType, "geo_sync");
  assert.equal(batch.geoConnectorContractVersion, "geo-wentian@1");
});

test("不可核验内部抓取声明只汇总标记和判定版本", async () => {
  const fixture = await createFixture({ unsupportedInternalClaim: true });
  const batch = await fixture.service.execute(principal, command);

  assert.equal(batch.unsupportedInternalClaimSampleCount, 1);
  assert.deepEqual(batch.unsupportedInternalClaimAssessmentVersions, [
    "unsupported-internal-claim@1",
  ]);
  assert.equal(
    "claimedFrequency" in batch || "internalCrawlFrequency" in batch,
    false,
  );
});

const ids = {
  scope: "scope-1",
  snapshot: "snapshot-1",
  query: "query-1",
  surface: "surface-1",
  user: "user-1",
  run: "run-1",
  tasks: ["task-1", "task-2", "task-3", "task-4"],
  artifacts: ["artifact-1", "artifact-2", "artifact-3", "artifact-4"],
  responses: ["response-1", "response-2", "response-3", "response-4"],
} as const;

const principal = createWentianPrincipal({
  userId: ids.user,
  role: "viewer",
  allowedScopeIds: [ids.scope],
});
const command = { scopeId: ids.scope, runId: ids.run } as const;

interface FixtureOptions {
  readonly terminal?: boolean;
  readonly includeFirstResponse?: boolean;
  readonly includeSecondReview?: boolean;
  readonly includeFailedResponse?: boolean;
  readonly corruptProjection?: boolean;
  readonly wrongSurfaceAdapter?: boolean;
  readonly geoSource?: boolean;
  readonly unsupportedInternalClaim?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "自述问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: options.geoSource
      ? {
          type: "geo_sync",
          geoBindingId: "geo-binding-1",
          contractVersion: "geo-wentian@1",
        }
      : { type: "local" },
    queries: [
      {
        queryText: "应参考哪些公开来源？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const surface = createSurface(options.wrongSurfaceAdapter);
  const initialRun = createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile: surface,
    collectionMethod: "browser_assisted",
    experimentKind: "source_nomination",
    requestedSampleCount: 4,
    sessionConditions: {
      searchMode: "disabled",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    createdBy: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const initialTasks = ids.tasks.map((id, index) =>
    createConsumerObservationTask({
      id,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: index + 1,
      surfaceProfileVersionId: ids.surface,
      collectionMethod: "browser_assisted",
      assignedTo: ids.user,
      createdAt: "2026-08-22T10:00:00.000Z",
    }),
  );
  const terminal = options.terminal ?? true;
  const tasks = terminal
    ? initialTasks.map((task, index) =>
        index < 3
          ? finishConfirmedTask(task, index)
          : finishRejectedTask(task, index),
      )
    : initialTasks;
  const run = terminal
    ? reconcileConsumerObservationRun(
        initialRun,
        snapshot,
        tasks,
        "2026-08-22T10:06:00.000Z",
      )
    : initialRun;

  const runs = new InMemoryConsumerObservationRunRepository();
  await runs.createWithTasks(run, snapshot, tasks);
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  const responses = new InMemoryConfirmedConsumerObservationRecordRepository();
  const reviews = new InMemorySourceNominationParseReviewRepository();
  if (terminal) {
    for (let index = 0; index < 3; index += 1) {
      if (index === 0 && options.includeFirstResponse === false) {
        continue;
      }
      const response = createResponse(
        tasks[index]!,
        index,
        index === 0 && options.unsupportedInternalClaim,
      );
      await responses.create(response);
      if (index === 1 && options.includeSecondReview === false) {
        continue;
      }
      await storeReview(reviews, response, index);
    }
    if (options.includeFailedResponse) {
      await responses.create(createResponse(tasks[3]!, 3));
    }
  }

  const realProjector =
    new ConfirmedConsumerSourceNominationMetricSampleProjector();
  const metricProjector = options.corruptProjection
    ? {
        normalizationVersion: realProjector.normalizationVersion,
        project(input: Parameters<typeof realProjector.project>[0]) {
          return { ...realProjector.project(input), id: "wrong-response" };
        },
      }
    : realProjector;
  const service = new BuildConsumerSourceNominationMetricSampleBatchService({
    runs,
    snapshots,
    responses,
    reviews,
    sourceEvents: reviews,
    surfaceProfiles: new InMemoryConsumerSurfaceProfileVersionRepository([
      surface,
    ]),
    metricProjector,
  });
  return { service, run };
}

async function storeReview(
  repository: InMemorySourceNominationParseReviewRepository,
  response: ReturnType<typeof createResponse>,
  index: number,
) {
  const review = createSourceNominationParseReview({
    id: `review-${index + 1}`,
    scopeId: ids.scope,
    responseId: response.id,
    proposedItems: [{ registrableDomain: "example.com", position: 1 }],
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    createdAt: "2026-08-22T10:04:00.000Z",
  });
  await repository.create(review);
  if (index === 0) {
    const confirmed = confirmSourceNominationParseReview(
      review,
      review.proposedItems,
      reviewContext,
    );
    const events = new SourceNominationEventProjector().project({
      scopeId: ids.scope,
      runId: ids.run,
      responseId: response.id,
      querySnapshotItemId: ids.query,
      sampleIndex: 1,
      validationMethod: "human_confirmed",
      nominations: confirmed.proposedItems,
      newId: () => "event-1",
      createdAt: confirmed.reviewedAt!,
    });
    await repository.commitConfirmation({
      review: confirmed,
      expectedReviewVersion: 1,
      response,
      sourceEvents: events,
    });
  } else if (index === 2) {
    await repository.commitRejection({
      review: rejectSourceNominationParseReview(
        review,
        "无法确认",
        reviewContext,
      ),
      expectedReviewVersion: 1,
      response,
    });
  }
}

const reviewContext = {
  scopeId: ids.scope,
  reviewedBy: ids.user,
  expectedVersion: 1,
  occurredAt: "2026-08-22T10:05:00.000Z",
} as const;

function finishConfirmedTask(task: ConsumerObservationTask, index: number) {
  const artifact = artifactBinding(index);
  const claimed = claimConsumerObservationTask(task, taskContext(task, 1));
  const submitted = submitConsumerCaptureArtifact(
    claimed,
    artifact,
    taskContext(claimed, 2),
  );
  return confirmConsumerObservationTask(
    submitted,
    artifact,
    {
      id: ids.responses[index]!,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: index + 1,
      captureArtifactId: ids.artifacts[index]!,
    },
    taskContext(submitted, 3),
  ).task;
}

function finishRejectedTask(task: ConsumerObservationTask, index: number) {
  const artifact = artifactBinding(index);
  const claimed = claimConsumerObservationTask(task, taskContext(task, 1));
  const submitted = submitConsumerCaptureArtifact(
    claimed,
    artifact,
    taskContext(claimed, 2),
  );
  return rejectConsumerObservationTask(
    submitted,
    "合成拒绝",
    taskContext(submitted, 3),
  ).task;
}

function createResponse(
  task: ConsumerObservationTask,
  index: number,
  unsupportedInternalClaim = false,
) {
  return createConfirmedConsumerObservationRecord({
    id: ids.responses[index]!,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: index + 1,
    observationTaskId: task.id,
    captureArtifactId: ids.artifacts[index]!,
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    answerText: unsupportedInternalClaim
      ? "我的抓取频率最高的前10个域名如下：example.com。"
      : "参考 example.com。",
    visibleCitations: [],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      searchMode: "disabled",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
      observedAt: "2026-08-22T10:02:30.000Z",
    },
    screenshotMediaAssetId: `screenshot-${index + 1}`,
    adapterVersion: "doubao-web@1",
    confirmedBy: ids.user,
    confirmedAt: "2026-08-22T10:03:00.000Z",
  });
}

function createSurface(wrongAdapter = false) {
  return createConsumerSurfaceProfileVersion({
    id: ids.surface,
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    adapterVersion: wrongAdapter ? "doubao-web@2" : "doubao-web@1",
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
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
}

function artifactBinding(index: number) {
  return {
    id: ids.artifacts[index]!,
    scopeId: ids.scope,
    observationTaskId: ids.tasks[index]!,
    capturedBy: ids.user,
    collectionMethod: "browser_assisted" as const,
  };
}

function taskContext(task: ConsumerObservationTask, minute: number) {
  return {
    scopeId: ids.scope,
    userId: ids.user,
    taskVersion: task.version,
    occurredAt: `2026-08-22T10:0${minute}:00.000Z`,
  };
}

function isApplicationError(code: string) {
  return (error: unknown) =>
    error instanceof WentianApplicationError && error.code === code;
}
