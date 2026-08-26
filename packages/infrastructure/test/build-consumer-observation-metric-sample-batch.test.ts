import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildConsumerObservationMetricSampleBatchService,
  WentianApplicationError,
} from "@wentian/application";
import {
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  createConfirmedConsumerObservationRecord,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createWentianPrincipal,
  reconcileConsumerObservationRun,
  rejectConsumerObservationTask,
  submitConsumerCaptureArtifact,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
} from "@wentian/domain";

import {
  DefaultConfirmedConsumerObservationMetricSampleProjector,
  InMemoryConfirmedConsumerObservationRecordRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
} from "../src/index.ts";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  snapshot: "21111111-1111-4111-8111-111111111111",
  query: "31111111-1111-4111-8111-111111111111",
  surface: "41111111-1111-4111-8111-111111111111",
  user: "51111111-1111-4111-8111-111111111111",
  run: "61111111-1111-4111-8111-111111111111",
  firstTask: "71111111-1111-4111-8111-111111111111",
  secondTask: "81111111-1111-4111-8111-111111111111",
  firstArtifact: "91111111-1111-4111-8111-111111111111",
  secondArtifact: "a1111111-1111-4111-8111-111111111111",
  firstResponse: "b1111111-1111-4111-8111-111111111111",
  secondResponse: "c1111111-1111-4111-8111-111111111111",
} as const;

const principal = createWentianPrincipal({
  userId: ids.user,
  role: "viewer",
  allowedScopeIds: [ids.scope],
});

test("从已终结运行、任务和确认记录构建运行级指标批次", async () => {
  const fixture = await createFixture();

  const batch = await fixture.service.execute(principal, {
    scopeId: ids.scope,
    runId: ids.run,
  });

  assert.equal(batch.scopeId, ids.scope);
  assert.equal(batch.runId, ids.run);
  assert.equal(batch.querySetSnapshotHash, fixture.run.querySetSnapshotHash);
  assert.equal(batch.querySetSourceType, "local");
  assert.equal(batch.geoConnectorContractVersion, null);
  assert.equal(batch.experimentKind, "natural_answer");
  assert.equal(batch.collectionMethod, "browser_assisted");
  assert.equal(batch.nominationContext, null);
  assert.equal(batch.surfaceProfileVersionId, ids.surface);
  assert.equal(batch.consumerSurfaceCode, "doubao_web");
  assert.equal(batch.normalizationVersion, "url-normalization@1");
  assert.deepEqual(batch.sampleBasis, {
    planned: 2,
    successful: 1,
    failed: 1,
  });
  assert.deepEqual(
    batch.samples.map((sample) => sample.verificationStatus),
    ["confirmed", "rejected"],
  );
  assert.equal(batch.samples[0].id, ids.firstResponse);
  assert.equal(batch.samples[1].id, `rejected-task:${ids.secondTask}`);
});

test("非终结运行和跨scope请求不能构建批次", async () => {
  const fixture = await createFixture({ terminal: false });

  await assert.rejects(
    () =>
      fixture.service.execute(principal, {
        scopeId: ids.scope,
        runId: ids.run,
      }),
    /TERMINAL_NATURAL_ANSWER_CONSUMER_RUN_REQUIRED/,
  );
  await assert.rejects(
    () =>
      fixture.service.execute(principal, {
        scopeId: "other-scope",
        runId: ids.run,
      }),
    (error: unknown) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
});

test("确认任务缺失记录或未确认任务出现记录时失败关闭", async () => {
  const missing = await createFixture({ includeConfirmedRecord: false });
  await assert.rejects(
    () =>
      missing.service.execute(principal, {
        scopeId: ids.scope,
        runId: ids.run,
      }),
    /CONSUMER_METRIC_CONFIRMED_RECORD_MISSING/,
  );

  const extra = await createFixture({ includeRejectedTaskRecord: true });
  await assert.rejects(
    () =>
      extra.service.execute(principal, {
        scopeId: ids.scope,
        runId: ids.run,
      }),
    /CONSUMER_METRIC_RECORD_FOR_UNCONFIRMED_TASK/,
  );
});

test("投影器返回错误样本身份时失败关闭", async () => {
  const fixture = await createFixture({ corruptProjectedSample: true });

  await assert.rejects(
    () =>
      fixture.service.execute(principal, {
        scopeId: ids.scope,
        runId: ids.run,
      }),
    /CONSUMER_METRIC_PROJECTED_SAMPLE_BINDING_MISMATCH/,
  );
});

test("GEO问题集契约版本从运行冻结的快照进入指标批次", async () => {
  const fixture = await createFixture({ geoSource: true });

  const batch = await fixture.service.execute(principal, {
    scopeId: ids.scope,
    runId: ids.run,
  });

  assert.equal(batch.querySetSourceType, "geo_sync");
  assert.equal(batch.geoConnectorContractVersion, "geo-wentian@1");
});

interface FixtureOptions {
  readonly terminal?: boolean;
  readonly includeConfirmedRecord?: boolean;
  readonly includeRejectedTaskRecord?: boolean;
  readonly corruptProjectedSample?: boolean;
  readonly geoSource?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "合成问题集",
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
        queryText: "广州搬家公司哪家好？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const surface = createConsumerSurfaceProfileVersion({
    id: ids.surface,
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
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const initialRun = createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile: surface,
    collectionMethod: "browser_assisted",
    experimentKind: "natural_answer",
    requestedSampleCount: 2,
    sessionConditions: {
      searchMode: "unknown",
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
  const initialTasks = [
    createConsumerObservationTask({
      id: ids.firstTask,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: 1,
      surfaceProfileVersionId: ids.surface,
      collectionMethod: "browser_assisted",
      assignedTo: ids.user,
      createdAt: "2026-08-22T10:00:00.000Z",
    }),
    createConsumerObservationTask({
      id: ids.secondTask,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: 2,
      surfaceProfileVersionId: ids.surface,
      collectionMethod: "browser_assisted",
      assignedTo: ids.user,
      createdAt: "2026-08-22T10:00:00.000Z",
    }),
  ] as const;
  const terminal = options.terminal ?? true;
  const tasks = terminal ? finishTasks(initialTasks) : initialTasks;
  const run = terminal
    ? reconcileConsumerObservationRun(
        initialRun,
        snapshot,
        tasks,
        "2026-08-22T10:04:00.000Z",
      )
    : initialRun;

  const runs = new InMemoryConsumerObservationRunRepository();
  await runs.createWithTasks(run, snapshot, tasks);
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  const records = new InMemoryConfirmedConsumerObservationRecordRepository();
  if (terminal && (options.includeConfirmedRecord ?? true)) {
    await records.create(confirmedRecord(tasks[0], surface.productLabel));
  }
  if (terminal && options.includeRejectedTaskRecord) {
    await records.create(
      confirmedRecord(
        tasks[1],
        surface.productLabel,
        ids.secondResponse,
        ids.secondArtifact,
      ),
    );
  }
  const realProjector =
    new DefaultConfirmedConsumerObservationMetricSampleProjector();
  const metricProjector = options.corruptProjectedSample
    ? {
        normalizationVersion: realProjector.normalizationVersion,
        project(input: Parameters<typeof realProjector.project>[0]) {
          return { ...realProjector.project(input), id: "wrong-response" };
        },
      }
    : realProjector;
  const service = new BuildConsumerObservationMetricSampleBatchService({
    runs,
    snapshots,
    records,
    surfaceProfiles: new InMemoryConsumerSurfaceProfileVersionRepository([
      surface,
    ]),
    metricProjector,
  });
  return { service, run };
}

function finishTasks(
  tasks: readonly [ConsumerObservationTask, ConsumerObservationTask],
): readonly [ConsumerObservationTask, ConsumerObservationTask] {
  const firstArtifact = artifactBinding(ids.firstArtifact, ids.firstTask);
  const firstClaimed = claimConsumerObservationTask(
    tasks[0],
    context(tasks[0], "2026-08-22T10:01:00.000Z"),
  );
  const firstSubmitted = submitConsumerCaptureArtifact(
    firstClaimed,
    firstArtifact,
    context(firstClaimed, "2026-08-22T10:02:00.000Z"),
  );
  const firstConfirmed = confirmConsumerObservationTask(
    firstSubmitted,
    firstArtifact,
    {
      id: ids.firstResponse,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: 1,
      captureArtifactId: ids.firstArtifact,
    },
    context(firstSubmitted, "2026-08-22T10:03:00.000Z"),
  ).task;

  const secondArtifact = artifactBinding(ids.secondArtifact, ids.secondTask);
  const secondClaimed = claimConsumerObservationTask(
    tasks[1],
    context(tasks[1], "2026-08-22T10:01:00.000Z"),
  );
  const secondSubmitted = submitConsumerCaptureArtifact(
    secondClaimed,
    secondArtifact,
    context(secondClaimed, "2026-08-22T10:02:00.000Z"),
  );
  const secondRejected = rejectConsumerObservationTask(
    secondSubmitted,
    "合成拒绝",
    context(secondSubmitted, "2026-08-22T10:03:00.000Z"),
  ).task;
  return [firstConfirmed, secondRejected];
}

function confirmedRecord(
  task: ConsumerObservationTask,
  productLabel: string,
  id: string = ids.firstResponse,
  captureArtifactId: string = ids.firstArtifact,
) {
  return createConfirmedConsumerObservationRecord({
    id,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: task.sampleIndex,
    observationTaskId: task.id,
    captureArtifactId,
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    answerText: "合成回答。",
    visibleCitations: [{ url: "https://www.example.com/source", position: 1 }],
    visibleMetadata: {
      productLabel,
      surfaceModelLabel: null,
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
      observedAt: "2026-08-22T10:02:30.000Z",
    },
    screenshotMediaAssetId: "d1111111-1111-4111-8111-111111111111",
    adapterVersion: "doubao-web@1",
    confirmedBy: ids.user,
    confirmedAt: "2026-08-22T10:03:00.000Z",
  });
}

function artifactBinding(id: string, observationTaskId: string) {
  return {
    id,
    scopeId: ids.scope,
    observationTaskId,
    capturedBy: ids.user,
    collectionMethod: "browser_assisted" as const,
  };
}

function context(task: ConsumerObservationTask, occurredAt: string) {
  return {
    scopeId: ids.scope,
    userId: ids.user,
    taskVersion: task.version,
    occurredAt,
  };
}
