import assert from "node:assert/strict";
import test from "node:test";

import {
  claimConsumerObservationTask,
  computeConsumerObservationMetrics,
  createConsumerObservationRun,
  confirmConsumerObservationTask,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  submitConsumerCaptureArtifact,
  type ConsumerCaptureArtifactBinding,
  type ConsumerObservationTask,
} from "@wentian/domain";

import {
  projectConfirmedConsumerObservationToMetricSample,
  type ConfirmedConsumerMetricArtifact,
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

test("已确认观察投影为可直接计算的指标样本", () => {
  const input = confirmedProjectionInput();
  const sample = projectConfirmedConsumerObservationToMetricSample(input);

  assert.deepEqual(sample, {
    id: ids.response,
    querySnapshotItemId: ids.query,
    collectionMethod: "browser_assisted",
    verificationStatus: "confirmed",
    evidenceGrade: "web_confirmed_capture",
    configuration: {
      surfaceCode: "doubao_web",
      surfaceModelLabel: null,
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    sourceOrderAvailable: true,
    citations: [
      { registrableDomain: "example.com", position: 1 },
      { registrableDomain: "example.org", position: 2 },
    ],
  });

  const report = computeConsumerObservationMetrics({
    scopeId: ids.scope,
    querySetSnapshotHash: "snapshot-hash",
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T10:04:00.000Z",
    sampleBasis: { planned: 1, successful: 1, failed: 0 },
    samples: [sample],
  });
  assert.equal(report.availability, "available");
  assert.equal(report.groups[0].domains.length, 2);
});

test("同一可注册域名的多个URL只保留最早可见位置", () => {
  const input = confirmedProjectionInput();
  const sample = projectConfirmedConsumerObservationToMetricSample({
    ...input,
    artifact: {
      ...input.artifact,
      visibleCitations: [
        { url: "https://news.example.com/a?utm_source=x", position: 3 },
        { url: "https://www.example.com/b", position: 1 },
        { url: "https://example.org/c", position: 2 },
      ],
    },
  });

  assert.deepEqual(sample.citations, [
    { registrableDomain: "example.com", position: 1 },
    { registrableDomain: "example.org", position: 2 },
  ]);
});

test("人工导入确认样本的证据等级由采集方式派生", () => {
  const input = confirmedProjectionInput("manual_import");
  const sample = projectConfirmedConsumerObservationToMetricSample(input);

  assert.equal(sample.collectionMethod, "manual_import");
  assert.equal(sample.evidenceGrade, "web_confirmed_manual");
});

test("未确认任务不能进入指标样本", () => {
  const input = confirmedProjectionInput();

  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        task: { ...input.task, status: "needs_review" },
      }),
    /CONFIRMED_OBSERVATION_TASK_REQUIRED/,
  );
});

test("任务、证据、响应和Surface任一绑定不一致时失败关闭", () => {
  const input = confirmedProjectionInput();

  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        artifact: { ...input.artifact, observationTaskId: "other-task" },
      }),
    /CONSUMER_METRIC_ARTIFACT_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        response: { ...input.response, runId: "other-run" },
      }),
    /CONSUMER_METRIC_RESPONSE_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        surfaceProfile: {
          ...input.surfaceProfile,
          adapterVersion: "other-adapter@1",
        },
      }),
    /CONSUMER_METRIC_SURFACE_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        run: { ...input.run, experimentKind: "source_nomination" },
      }),
    /NATURAL_ANSWER_CONSUMER_RUN_REQUIRED/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        artifact: {
          ...input.artifact,
          visibleMetadata: {
            ...input.artifact.visibleMetadata,
            searchMode: "enabled",
          },
        },
      }),
    /CONSUMER_METRIC_SESSION_CONDITIONS_MISMATCH/,
  );
});

test("不可归一化URL和非法位置不会进入指标样本", () => {
  const input = confirmedProjectionInput();

  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        artifact: {
          ...input.artifact,
          visibleCitations: [
            { url: "https://source.invalid/path", position: 1 },
          ],
        },
      }),
    /VISIBLE_CITATION_URL_NORMALIZATION_REJECTED:REGISTRABLE_DOMAIN_NOT_AVAILABLE/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        artifact: {
          ...input.artifact,
          visibleCitations: [{ url: "https://example.com/path", position: 0 }],
        },
      }),
    /INVALID_VISIBLE_CITATION_POSITION/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        artifact: {
          ...input.artifact,
          visibleCitations: [
            { url: "https://example.com/a", position: 1 },
            { url: "https://example.org/b", position: 1 },
          ],
        },
      }),
    /DUPLICATE_VISIBLE_CITATION_POSITION/,
  );
  assert.throws(
    () =>
      projectConfirmedConsumerObservationToMetricSample({
        ...input,
        artifact: {
          ...input.artifact,
          visibleCitations: [{ url: "https://example.com/a", position: 2 }],
        },
      }),
    /VISIBLE_CITATION_FIRST_POSITION_REQUIRED/,
  );
});

function confirmedProjectionInput(
  collectionMethod: "browser_assisted" | "manual_import" = "browser_assisted",
) {
  const artifact = artifactRecord(collectionMethod);
  const task = confirmedTask(collectionMethod, artifact);
  const surfaceProfile = createConsumerSurfaceProfileVersion({
    id: ids.surface,
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    adapterVersion: "doubao-web@1",
    allowedCollectionMethods: [collectionMethod],
    visibleSourceCapabilities: {
      visibleCitations: true,
      sourcePanel: true,
      screenshot: true,
      sanitizedDom: false,
    },
    comparisonSurfaceModelLabel: null,
    comparisonProviderCode: null,
    comparisonModelKey: null,
    equivalenceLevel: "unknown",
    equivalenceBasis: null,
    equivalenceEvidenceUrl: null,
    equivalenceReviewedAt: null,
    termsReviewedAt: "2026-08-22T09:00:00.000Z",
    status: "active",
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const snapshot = createQuerySetSnapshot({
    id: "91111111-1111-4111-8111-111111111111",
    itemIds: [ids.query],
    scopeId: ids.scope,
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
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const run = createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile,
    collectionMethod,
    experimentKind: "natural_answer",
    requestedSampleCount: 1,
    sessionConditions: artifact.visibleMetadata,
    createdBy: ids.user,
    createdAt: "2026-08-22T09:30:00.000Z",
  });
  return {
    run,
    task,
    artifact,
    response: responseBinding(),
    surfaceProfile,
  } as const;
}

function confirmedTask(
  collectionMethod: "browser_assisted" | "manual_import",
  artifact: ConsumerCaptureArtifactBinding,
): ConsumerObservationTask {
  const waiting = createConsumerObservationTask({
    id: ids.task,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    surfaceProfileVersionId: ids.surface,
    collectionMethod,
    assignedTo: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const capturing = claimConsumerObservationTask(waiting, {
    scopeId: ids.scope,
    userId: ids.user,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const needsReview = submitConsumerCaptureArtifact(capturing, artifact, {
    scopeId: ids.scope,
    userId: ids.user,
    taskVersion: 2,
    occurredAt: "2026-08-22T10:02:00.000Z",
  });
  return confirmConsumerObservationTask(
    needsReview,
    artifact,
    responseBinding(),
    {
      scopeId: ids.scope,
      userId: ids.user,
      taskVersion: 3,
      occurredAt: "2026-08-22T10:03:00.000Z",
    },
  ).task;
}

function artifactRecord(
  collectionMethod: "browser_assisted" | "manual_import",
): ConfirmedConsumerMetricArtifact {
  return {
    id: ids.artifact,
    scopeId: ids.scope,
    observationTaskId: ids.task,
    capturedBy: ids.user,
    collectionMethod,
    adapterVersion: "doubao-web@1",
    visibleCitations: [
      { url: "https://news.example.com/a?utm_source=x", position: 3 },
      { url: "https://www.example.com/b", position: 1 },
      { url: "https://example.org/c", position: 2 },
    ],
    visibleMetadata: {
      surfaceModelLabel: null,
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
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
