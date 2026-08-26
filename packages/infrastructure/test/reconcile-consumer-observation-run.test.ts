import assert from "node:assert/strict";
import test from "node:test";

import {
  ReconcileConsumerObservationRunService,
  WentianApplicationError,
  type ConsumerObservationRunRepository,
} from "@wentian/application";
import {
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  reconcileConsumerObservationRun,
  rejectConsumerObservationTask,
  submitConsumerCaptureArtifact,
  type ConsumerObservationTask,
} from "@wentian/domain";

import {
  InMemoryConsumerObservationRunRepository,
  InMemoryQuerySetSnapshotRepository,
} from "../src/index.ts";

const scopeId = "21111111-1111-4111-8111-111111111111";
const runId = "31111111-1111-4111-8111-111111111111";
const snapshotId = "41111111-1111-4111-8111-111111111111";
const surfaceId = "51111111-1111-4111-8111-111111111111";
const userId = "61111111-1111-4111-8111-111111111111";

test("任务变化后从完整任务集重算running和partial", async () => {
  const fixture = await createFixture();
  const [first, second] = fixture.tasks;

  const unchanged = await fixture.service.execute({
    scopeId,
    runId,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  assert.equal(unchanged, fixture.run);

  const claimed = claim(first);
  await fixture.runs.save(claimed, first.version);
  const running = await fixture.service.execute({
    scopeId,
    runId,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  assert.equal(running.status, "running");
  assert.equal(running.version, 2);

  const confirmed = confirm(claimed);
  await saveRemainingTransitions(fixture.runs, claimed, confirmed);
  const oneSucceeded = await fixture.service.execute({
    scopeId,
    runId,
    occurredAt: "2026-08-22T10:04:00.000Z",
  });
  assert.equal(oneSucceeded.status, "running");
  assert.equal(oneSucceeded.successfulSampleCount, 1);
  assert.equal(oneSucceeded.version, 3);

  const rejected = reject(second);
  await saveAllTransitions(fixture.runs, second, rejected);
  const partial = await fixture.service.execute({
    scopeId,
    runId,
    occurredAt: "2026-08-22T10:04:00.000Z",
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.successfulSampleCount, 1);
  assert.equal(partial.failedSampleCount, 1);
  assert.equal(partial.version, 4);
});

test("没有任务变化时重算幂等且不增加运行版本", async () => {
  const fixture = await createFixture();

  const first = await fixture.service.execute({
    scopeId,
    runId,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const second = await fixture.service.execute({
    scopeId,
    runId,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });

  assert.equal(first, fixture.run);
  assert.equal(second, fixture.run);
  assert.equal(second.version, 1);
});

test("缺失运行和缺失快照统一返回RESOURCE_NOT_FOUND", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      fixture.service.execute({
        scopeId,
        runId: "missing-run",
        occurredAt: "2026-08-22T10:01:00.000Z",
      }),
    isResourceNotFound,
  );
  const missingSnapshots = new InMemoryQuerySetSnapshotRepository();
  const service = new ReconcileConsumerObservationRunService({
    runs: fixture.runs,
    snapshots: missingSnapshots,
  });
  await assert.rejects(
    () =>
      service.execute({
        scopeId,
        runId,
        occurredAt: "2026-08-22T10:01:00.000Z",
      }),
    isResourceNotFound,
  );
});

test("仓储返回错误运行身份或不完整任务集时失败关闭", async () => {
  const fixture = await createFixture();
  const poisonedRepository: ConsumerObservationRunRepository = {
    ...fixture.runs,
    async findRunById() {
      return { ...fixture.run, scopeId: "other-scope" };
    },
    async createWithTasks() {},
    async listTasksForRun() {
      return fixture.tasks;
    },
    async saveRun(run) {
      return run;
    },
  };
  const poisoned = new ReconcileConsumerObservationRunService({
    runs: poisonedRepository,
    snapshots: fixture.snapshots,
  });
  await assert.rejects(
    () =>
      poisoned.execute({
        scopeId,
        runId,
        occurredAt: "2026-08-22T10:01:00.000Z",
      }),
    /CONSUMER_OBSERVATION_RUN_IDENTITY_MISMATCH/,
  );

  const incompleteRepository: ConsumerObservationRunRepository = {
    async findRunById() {
      return fixture.run;
    },
    async createWithTasks() {},
    async listTasksForRun() {
      return fixture.tasks.slice(1);
    },
    async saveRun(run) {
      return run;
    },
  };
  const incomplete = new ReconcileConsumerObservationRunService({
    runs: incompleteRepository,
    snapshots: fixture.snapshots,
  });
  await assert.rejects(
    () =>
      incomplete.execute({
        scopeId,
        runId,
        occurredAt: "2026-08-22T10:01:00.000Z",
      }),
    /CONSUMER_OBSERVATION_TASK_COUNT_MISMATCH/,
  );
});

test("运行保存使用版本检查拒绝并发旧写入", async () => {
  const fixture = await createFixture();
  const claimedTasks = [claim(fixture.tasks[0]), fixture.tasks[1]];
  const next = reconcileConsumerObservationRun(
    fixture.run,
    fixture.snapshot,
    claimedTasks,
    "2026-08-22T10:01:00.000Z",
  );
  await fixture.runs.saveRun(next, 1);

  await assert.rejects(
    () => fixture.runs.saveRun(next, 1),
    /CONSUMER_OBSERVATION_RUN_VERSION_CONFLICT/,
  );
});

async function createFixture() {
  const snapshot = createQuerySetSnapshot({
    id: snapshotId,
    itemIds: ["query-item-1"],
    scopeId,
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
    createdBy: userId,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const surface = createConsumerSurfaceProfileVersion({
    id: surfaceId,
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
    createdBy: userId,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const run = createConsumerObservationRun({
    id: runId,
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
    createdBy: userId,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const tasks = [1, 2].map((sampleIndex) =>
    createConsumerObservationTask({
      id: `task-${sampleIndex}`,
      scopeId,
      runId,
      querySnapshotItemId: "query-item-1",
      sampleIndex,
      surfaceProfileVersionId: surfaceId,
      collectionMethod: "browser_assisted",
      assignedTo: userId,
      createdAt: "2026-08-22T10:00:00.000Z",
    }),
  );
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  const runs = new InMemoryConsumerObservationRunRepository();
  await runs.createWithTasks(run, snapshot, tasks);
  return {
    run,
    snapshot,
    snapshots,
    tasks,
    runs,
    service: new ReconcileConsumerObservationRunService({ runs, snapshots }),
  };
}

function claim(task: ConsumerObservationTask): ConsumerObservationTask {
  return claimConsumerObservationTask(task, {
    scopeId,
    userId,
    taskVersion: task.version,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
}

function confirm(claimed: ConsumerObservationTask): ConsumerObservationTask {
  const artifact = artifactFor(claimed);
  const needsReview = submitConsumerCaptureArtifact(claimed, artifact, {
    scopeId,
    userId,
    taskVersion: claimed.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  return confirmConsumerObservationTask(
    needsReview,
    artifact,
    {
      id: `response-${claimed.id}`,
      scopeId,
      runId,
      querySnapshotItemId: claimed.querySnapshotItemId,
      sampleIndex: claimed.sampleIndex,
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

function reject(waiting: ConsumerObservationTask): ConsumerObservationTask {
  const claimed = claim(waiting);
  const artifact = artifactFor(waiting);
  const needsReview = submitConsumerCaptureArtifact(claimed, artifact, {
    scopeId,
    userId,
    taskVersion: claimed.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  return rejectConsumerObservationTask(needsReview, "证据未通过", {
    scopeId,
    userId,
    taskVersion: needsReview.version,
    occurredAt: "2026-08-22T10:03:00.000Z",
  }).task;
}

async function saveRemainingTransitions(
  repository: InMemoryConsumerObservationRunRepository,
  claimed: ConsumerObservationTask,
  terminal: ConsumerObservationTask,
): Promise<void> {
  const artifact = artifactFor(claimed);
  const needsReview = submitConsumerCaptureArtifact(claimed, artifact, {
    scopeId,
    userId,
    taskVersion: claimed.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  await repository.save(needsReview, claimed.version);
  await repository.save(terminal, needsReview.version);
}

async function saveAllTransitions(
  repository: InMemoryConsumerObservationRunRepository,
  waiting: ConsumerObservationTask,
  terminal: ConsumerObservationTask,
): Promise<void> {
  const claimed = claim(waiting);
  await repository.save(claimed, waiting.version);
  await saveRemainingTransitions(repository, claimed, terminal);
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

function isResourceNotFound(error: unknown): boolean {
  return (
    error instanceof WentianApplicationError &&
    error.code === "RESOURCE_NOT_FOUND"
  );
}
