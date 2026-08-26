import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelConsumerObservationRun,
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  reconcileConsumerObservationRun,
  rejectConsumerObservationTask,
  submitConsumerCaptureArtifact,
  summarizeConsumerObservationRunTasks,
  type ConsumerCollectionMethod,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type QuerySetSnapshot,
} from "../src/index.ts";

const scopeId = "21111111-1111-4111-8111-111111111111";
const userId = "61111111-1111-4111-8111-111111111111";
const runId = "31111111-1111-4111-8111-111111111111";
const surfaceId = "51111111-1111-4111-8111-111111111111";

test("创建运行冻结web_observed配置、计划样本数和提名上下文", () => {
  const snapshot = createSnapshot(2);
  const run = createRun(snapshot, {
    experimentKind: "source_nomination",
    searchMode: "unknown",
    requestedSampleCount: 3,
  });

  assert.equal(run.retrievalMode, "web_observed");
  assert.equal(run.executionTargetType, "consumer_surface");
  assert.equal(run.querySetSnapshotHash, snapshot.snapshotHash);
  assert.equal(run.queryCount, 2);
  assert.equal(run.plannedSampleCount, 6);
  assert.equal(run.nominationContext, "surface_unknown");
  assert.equal(run.status, "queued");
  assert.equal(Object.isFrozen(run), true);
  assert.equal(Object.isFrozen(run.sessionConditions), true);

  assert.equal(
    createRun(snapshot, {
      experimentKind: "source_nomination",
      searchMode: "disabled",
    }).nominationContext,
    "unaided",
  );
  assert.equal(
    createRun(snapshot, {
      experimentKind: "source_nomination",
      searchMode: "enabled",
    }).nominationContext,
    "search_assisted",
  );
  assert.equal(createRun(snapshot).nominationContext, null);
});

test("未启用Surface、未允许采集方式和非法样本数不能创建运行", () => {
  const snapshot = createSnapshot(1);
  const activeProfile = createSurface("browser_assisted", "active");

  assert.throws(
    () =>
      createRun(snapshot, {
        surfaceProfile: createSurface("browser_assisted", "draft"),
      }),
    /ACTIVE_CONSUMER_SURFACE_REQUIRED/,
  );
  assert.throws(
    () =>
      createRun(snapshot, {
        surfaceProfile: activeProfile,
        collectionMethod: "manual_import",
      }),
    /CONSUMER_COLLECTION_METHOD_NOT_ALLOWED/,
  );
  for (const requestedSampleCount of [0, 6]) {
    assert.throws(
      () => createRun(snapshot, { requestedSampleCount }),
      /INVALID_CONSUMER_OBSERVATION_SAMPLE_COUNT/,
    );
  }
});

test("完整等待任务集保持queued，任一任务开始后进入running", () => {
  const snapshot = createSnapshot(2);
  const run = createRun(snapshot, { requestedSampleCount: 2 });
  const waitingTasks = createTasks(run, snapshot);

  const unchanged = reconcileConsumerObservationRun(
    run,
    snapshot,
    waitingTasks,
    "2026-08-22T10:01:00.000Z",
  );
  assert.equal(unchanged, run);

  const tasks = [claimTask(waitingTasks[0]), ...waitingTasks.slice(1)];
  const running = reconcileConsumerObservationRun(
    run,
    snapshot,
    tasks,
    "2026-08-22T10:02:00.000Z",
  );
  assert.equal(running.status, "running");
  assert.equal(running.startedAt, "2026-08-22T10:02:00.000Z");
  assert.equal(running.version, 2);
});

test("全部任务终结后按成功和失败数量派生三种终态", () => {
  const snapshot = createSnapshot(1);
  const base = createRun(snapshot, { requestedSampleCount: 3 });
  const waiting = createTasks(base, snapshot);

  const succeeded = reconcileConsumerObservationRun(
    base,
    snapshot,
    waiting.map(confirmTask),
    "2026-08-22T10:04:00.000Z",
  );
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.successfulSampleCount, 3);
  assert.equal(succeeded.failedSampleCount, 0);

  const partial = reconcileConsumerObservationRun(
    base,
    snapshot,
    [confirmTask(waiting[0]), rejectTask(waiting[1]), confirmTask(waiting[2])],
    "2026-08-22T10:04:00.000Z",
  );
  assert.equal(partial.status, "partial");
  assert.equal(partial.successfulSampleCount, 2);
  assert.equal(partial.failedSampleCount, 1);

  const failed = reconcileConsumerObservationRun(
    base,
    snapshot,
    waiting.map(rejectTask),
    "2026-08-22T10:04:00.000Z",
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.successfulSampleCount, 0);
  assert.equal(failed.failedSampleCount, 3);
});

test("任务全集必须匹配运行scope、快照项和样本槽位", () => {
  const snapshot = createSnapshot(2);
  const run = createRun(snapshot, { requestedSampleCount: 1 });
  const tasks = createTasks(run, snapshot);

  assert.throws(
    () => summarizeConsumerObservationRunTasks(run, snapshot, tasks.slice(1)),
    /CONSUMER_OBSERVATION_TASK_COUNT_MISMATCH/,
  );
  assert.throws(
    () =>
      summarizeConsumerObservationRunTasks(run, snapshot, [
        tasks[0],
        { ...tasks[1], querySnapshotItemId: tasks[0].querySnapshotItemId },
      ]),
    /DUPLICATE_CONSUMER_OBSERVATION_TASK_SLOT/,
  );
  assert.throws(
    () =>
      summarizeConsumerObservationRunTasks(run, snapshot, [
        { ...tasks[0], scopeId: "other-scope" },
        tasks[1],
      ]),
    /CONSUMER_OBSERVATION_RUN_TASK_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      summarizeConsumerObservationRunTasks(
        run,
        { ...snapshot, snapshotHash: "other-hash" },
        tasks,
      ),
    /CONSUMER_OBSERVATION_RUN_SNAPSHOT_MISMATCH/,
  );
});

test("有待处理任务时可取消，终态不可被不同结果覆盖", () => {
  const snapshot = createSnapshot(1);
  const run = createRun(snapshot, { requestedSampleCount: 2 });
  const tasks = createTasks(run, snapshot);
  const cancelled = cancelConsumerObservationRun(
    run,
    snapshot,
    tasks,
    "2026-08-22T10:01:00.000Z",
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt, "2026-08-22T10:01:00.000Z");

  const succeededTasks = tasks.map(confirmTask);
  const succeeded = reconcileConsumerObservationRun(
    run,
    snapshot,
    succeededTasks,
    "2026-08-22T10:04:00.000Z",
  );
  assert.equal(
    reconcileConsumerObservationRun(
      succeeded,
      snapshot,
      succeededTasks,
      "2026-08-22T10:05:00.000Z",
    ),
    succeeded,
  );
  assert.throws(
    () =>
      reconcileConsumerObservationRun(
        succeeded,
        snapshot,
        tasks.map(rejectTask),
        "2026-08-22T10:05:00.000Z",
      ),
    /CONSUMER_OBSERVATION_RUN_TERMINAL/,
  );
  assert.throws(
    () =>
      cancelConsumerObservationRun(
        succeeded,
        snapshot,
        succeededTasks,
        "2026-08-22T10:05:00.000Z",
      ),
    /CONSUMER_OBSERVATION_RUN_CANNOT_CANCEL/,
  );
});

function createSnapshot(queryCount: number): QuerySetSnapshot {
  return createQuerySetSnapshot({
    id: "11111111-1111-4111-8111-111111111111",
    itemIds: Array.from(
      { length: queryCount },
      (_, index) => `query-item-${index + 1}`,
    ),
    scopeId,
    title: "消费端观察问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
    queries: Array.from({ length: queryCount }, (_, index) => ({
      queryText: `问题${index + 1}`,
      intentCode: "recommendation" as const,
      commercialValue: "high" as const,
    })),
    createdBy: userId,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
}

function createSurface(
  collectionMethod: ConsumerCollectionMethod,
  status: "draft" | "active",
) {
  return createConsumerSurfaceProfileVersion({
    id: surfaceId,
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    adapterVersion: "doubao-web@1",
    allowedCollectionMethods: [collectionMethod] as readonly (
      "browser_assisted" | "manual_import"
    )[],
    visibleSourceCapabilities: {
      visibleCitations: true,
      sourcePanel: true,
      screenshot: true,
      sanitizedDom: false,
    },
    equivalenceLevel: "unknown",
    termsReviewedAt: status === "active" ? "2026-08-22T09:00:00.000Z" : null,
    status,
    createdBy: userId,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
}

function createRun(
  snapshot: QuerySetSnapshot,
  changes: {
    readonly experimentKind?: "natural_answer" | "source_nomination";
    readonly searchMode?: "enabled" | "disabled" | "unknown";
    readonly requestedSampleCount?: number;
    readonly collectionMethod?: "browser_assisted" | "manual_import";
    readonly surfaceProfile?: ReturnType<typeof createSurface>;
  } = {},
): ConsumerObservationRun {
  const collectionMethod = changes.collectionMethod ?? "browser_assisted";
  return createConsumerObservationRun({
    id: runId,
    snapshot,
    surfaceProfile:
      changes.surfaceProfile ?? createSurface(collectionMethod, "active"),
    collectionMethod,
    experimentKind: changes.experimentKind ?? "natural_answer",
    requestedSampleCount: changes.requestedSampleCount ?? 1,
    sessionConditions: {
      searchMode: changes.searchMode ?? "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    createdBy: userId,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
}

function createTasks(
  run: ConsumerObservationRun,
  snapshot: QuerySetSnapshot,
): ConsumerObservationTask[] {
  const tasks: ConsumerObservationTask[] = [];
  for (const item of snapshot.items) {
    for (
      let sampleIndex = 1;
      sampleIndex <= run.requestedSampleCount;
      sampleIndex += 1
    ) {
      tasks.push(
        createConsumerObservationTask({
          id: `task-${item.ordinal}-${sampleIndex}`,
          scopeId: run.scopeId,
          runId: run.id,
          querySnapshotItemId: item.id,
          sampleIndex,
          surfaceProfileVersionId: run.surfaceProfileVersionId,
          collectionMethod: run.collectionMethod,
          assignedTo: userId,
          createdAt: "2026-08-22T10:00:00.000Z",
        }),
      );
    }
  }
  return tasks;
}

function claimTask(task: ConsumerObservationTask): ConsumerObservationTask {
  return claimConsumerObservationTask(task, {
    scopeId,
    userId,
    taskVersion: task.version,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
}

function confirmTask(task: ConsumerObservationTask): ConsumerObservationTask {
  const artifact = artifactFor(task);
  const capturing = claimTask(task);
  const needsReview = submitConsumerCaptureArtifact(capturing, artifact, {
    scopeId,
    userId,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  return confirmConsumerObservationTask(
    needsReview,
    artifact,
    {
      id: `response-${task.id}`,
      scopeId,
      runId,
      querySnapshotItemId: task.querySnapshotItemId,
      sampleIndex: task.sampleIndex,
      captureArtifactId: artifact.id,
    },
    {
      scopeId,
      userId,
      taskVersion: needsReview.version,
      occurredAt: "2026-08-22T10:03:00.000Z",
    },
  ).task;
}

function rejectTask(task: ConsumerObservationTask): ConsumerObservationTask {
  const artifact = artifactFor(task);
  const capturing = claimTask(task);
  const needsReview = submitConsumerCaptureArtifact(capturing, artifact, {
    scopeId,
    userId,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  return rejectConsumerObservationTask(needsReview, "证据未通过", {
    scopeId,
    userId,
    taskVersion: needsReview.version,
    occurredAt: "2026-08-22T10:03:00.000Z",
  }).task;
}

function artifactFor(task: ConsumerObservationTask) {
  return {
    id: `artifact-${task.id}`,
    scopeId,
    observationTaskId: task.id,
    capturedBy: userId,
    collectionMethod: task.collectionMethod,
  };
}
