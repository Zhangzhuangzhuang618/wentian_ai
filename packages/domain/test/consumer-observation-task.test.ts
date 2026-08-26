import assert from "node:assert/strict";
import test from "node:test";

import {
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  createConsumerObservationTask,
  rejectConsumerObservationTask,
  submitConsumerCaptureArtifact,
  type ConsumerCaptureArtifactBinding,
  type ConsumerObservationTask,
  type ObservationTaskCommandContext,
} from "../src/index.ts";

const ids = {
  task: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  run: "31111111-1111-4111-8111-111111111111",
  query: "41111111-1111-4111-8111-111111111111",
  surface: "51111111-1111-4111-8111-111111111111",
  user: "61111111-1111-4111-8111-111111111111",
  artifact: "71111111-1111-4111-8111-111111111111",
  response: "81111111-1111-4111-8111-111111111111",
} as const;

test("任务按等待、采集、复核、确认顺序推进并递增版本", () => {
  const waiting = createWaitingTask();
  const capturing = claim(waiting);
  const needsReview = submit(capturing);
  const confirmed = confirmConsumerObservationTask(
    needsReview,
    artifactBinding(),
    responseBinding(),
    context(needsReview, "2026-08-22T10:03:00.000Z"),
  );

  assert.equal(waiting.status, "waiting_user");
  assert.equal(capturing.status, "capturing");
  assert.equal(needsReview.status, "needs_review");
  assert.equal(confirmed.task.status, "confirmed");
  assert.equal(confirmed.task.version, 4);
  assert.equal(confirmed.task.confirmedResponseId, ids.response);
  assert.equal(confirmed.evidenceGrade, "web_confirmed_capture");
  assert.equal(Object.isFrozen(confirmed.task), true);
});

test("过期版本、换scope或换用户不能推进任务", () => {
  const waiting = createWaitingTask();

  for (const changes of [
    { taskVersion: 2 },
    { scopeId: "99999999-9999-4999-8999-999999999999" },
    { userId: "99999999-9999-4999-8999-999999999999" },
  ]) {
    assert.throws(() =>
      claimConsumerObservationTask(waiting, {
        ...context(waiting, "2026-08-22T10:01:00.000Z"),
        ...changes,
      }),
    );
  }
});

test("采集记录必须绑定同一任务、scope和操作人", () => {
  const capturing = claim(createWaitingTask());
  const artifact = artifactBinding();

  for (const changes of [
    { observationTaskId: "99999999-9999-4999-8999-999999999999" },
    { scopeId: "99999999-9999-4999-8999-999999999999" },
    { capturedBy: "99999999-9999-4999-8999-999999999999" },
  ]) {
    assert.throws(() =>
      submitConsumerCaptureArtifact(
        capturing,
        { ...artifact, ...changes },
        context(capturing, "2026-08-22T10:02:00.000Z"),
      ),
    );
  }
  assert.throws(
    () =>
      submitConsumerCaptureArtifact(
        capturing,
        { ...artifact, collectionMethod: "manual_import" },
        context(capturing, "2026-08-22T10:02:00.000Z"),
      ),
    /CAPTURE_ARTIFACT_COLLECTION_METHOD_MISMATCH/,
  );
});

test("已提交任务不能重复绑定采集记录", () => {
  const needsReview = submit(claim(createWaitingTask()));

  assert.throws(
    () =>
      submitConsumerCaptureArtifact(
        needsReview,
        artifactBinding(),
        context(needsReview, "2026-08-22T10:03:00.000Z"),
      ),
    /INVALID_OBSERVATION_TASK_TRANSITION/,
  );
});

test("确认结果必须绑定同一运行、问题、样本和采集记录", () => {
  const needsReview = submit(claim(createWaitingTask()));
  const response = responseBinding();

  for (const changes of [
    { runId: "99999999-9999-4999-8999-999999999999" },
    { querySnapshotItemId: "99999999-9999-4999-8999-999999999999" },
    { sampleIndex: 2 },
    { captureArtifactId: "99999999-9999-4999-8999-999999999999" },
  ]) {
    assert.throws(() =>
      confirmConsumerObservationTask(
        needsReview,
        artifactBinding(),
        { ...response, ...changes },
        context(needsReview, "2026-08-22T10:03:00.000Z"),
      ),
    );
  }
});

test("证据等级只由已绑定采集记录的方法派生", () => {
  const capturing = claim(
    createWaitingTask({ collectionMethod: "manual_import" }),
  );
  const manualArtifact = {
    ...artifactBinding(),
    collectionMethod: "manual_import" as const,
  };
  const needsReview = submitConsumerCaptureArtifact(
    capturing,
    manualArtifact,
    context(capturing, "2026-08-22T10:02:00.000Z"),
  );
  const confirmed = confirmConsumerObservationTask(
    needsReview,
    manualArtifact,
    responseBinding(),
    context(needsReview, "2026-08-22T10:03:00.000Z"),
  );

  assert.equal(confirmed.evidenceGrade, "web_confirmed_manual");
});

test("拒绝返回待清除证据ID并进入不可逆终态", () => {
  const needsReview = submit(claim(createWaitingTask()));
  const rejected = rejectConsumerObservationTask(
    needsReview,
    "截图包含不应保留的信息",
    context(needsReview, "2026-08-22T10:03:00.000Z"),
  );

  assert.equal(rejected.task.status, "rejected");
  assert.equal(rejected.task.captureArtifactId, null);
  assert.equal(rejected.artifactIdToPurge, ids.artifact);
  assert.equal(rejected.rejectionReason, "截图包含不应保留的信息");
  assert.throws(() =>
    confirmConsumerObservationTask(
      rejected.task,
      artifactBinding(),
      responseBinding(),
      context(rejected.task, "2026-08-22T10:04:00.000Z"),
    ),
  );
});

test("任务时间不能倒退", () => {
  const capturing = claim(createWaitingTask());

  assert.throws(
    () =>
      submitConsumerCaptureArtifact(
        capturing,
        artifactBinding(),
        context(capturing, "2026-08-22T09:59:00.000Z"),
      ),
    /OBSERVATION_TASK_TIMESTAMP_ORDER_INVALID/,
  );
});

test("运行时非法采集方式失败关闭", () => {
  assert.throws(
    () =>
      createWaitingTask({
        collectionMethod: "forged_method" as "browser_assisted",
      }),
    /INVALID_CONSUMER_COLLECTION_METHOD/,
  );
});

test("拒绝原因长度不能绕过API契约上限", () => {
  const needsReview = submit(claim(createWaitingTask()));

  assert.throws(
    () =>
      rejectConsumerObservationTask(
        needsReview,
        "拒".repeat(1_001),
        context(needsReview, "2026-08-22T10:03:00.000Z"),
      ),
    /OBSERVATION_REJECTION_REASON_TOO_LONG/,
  );
});

function createWaitingTask(
  changes: Partial<Parameters<typeof createConsumerObservationTask>[0]> = {},
): ConsumerObservationTask {
  return createConsumerObservationTask({
    id: ids.task,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    assignedTo: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
    ...changes,
  });
}

function claim(task: ConsumerObservationTask): ConsumerObservationTask {
  return claimConsumerObservationTask(
    task,
    context(task, "2026-08-22T10:01:00.000Z"),
  );
}

function submit(task: ConsumerObservationTask): ConsumerObservationTask {
  return submitConsumerCaptureArtifact(
    task,
    artifactBinding(),
    context(task, "2026-08-22T10:02:00.000Z"),
  );
}

function context(
  task: ConsumerObservationTask,
  occurredAt: string,
): ObservationTaskCommandContext {
  return {
    scopeId: ids.scope,
    userId: ids.user,
    taskVersion: task.version,
    occurredAt,
  };
}

function artifactBinding(): ConsumerCaptureArtifactBinding {
  return {
    id: ids.artifact,
    scopeId: ids.scope,
    observationTaskId: ids.task,
    capturedBy: ids.user,
    collectionMethod: "browser_assisted",
  };
}

function responseBinding() {
  return {
    id: ids.response,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    captureArtifactId: ids.artifact,
  };
}
