import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildConsumerObservationMetricSampleBatchService,
  ConfirmConsumerObservationTransactionService,
  ConsumerObservationWorkflowService,
  CreateConsumerObservationRunService,
  GetConsumerObservationRunMetricsOnDemandService,
  ReconcileConsumerObservationRunService,
} from "@wentian/application";
import { adaptConsumerObservationMetricReportToResponse } from "@wentian/contracts";
import {
  createCaptureTokenClaims,
  createConsumerCaptureEvidenceArtifact,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createScope,
  createWentianPrincipal,
} from "@wentian/domain";
import {
  ConfirmedConsumerObservationSourceEventProjector,
  DefaultConfirmedConsumerObservationMetricSampleProjector,
  InMemoryCaptureTokenNonceRepository,
  InMemoryCaptureTokenVerifier,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
  InMemoryScopeRepository,
} from "@wentian/infrastructure";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  snapshot: "21111111-1111-4111-8111-111111111111",
  query: "31111111-1111-4111-8111-111111111111",
  surface: "41111111-1111-4111-8111-111111111111",
  user: "51111111-1111-4111-8111-111111111111",
  run: "61111111-1111-4111-8111-111111111111",
  task: "71111111-1111-4111-8111-111111111111",
  artifact: "81111111-1111-4111-8111-111111111111",
  response: "91111111-1111-4111-8111-111111111111",
  sourceEvent: "b1111111-1111-4111-8111-111111111111",
} as const;

test("合成内部链路从运行创建推进到严格指标响应", async () => {
  const principal = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [ids.scope],
  });
  const scope = createScope({
    id: ids.scope,
    projectKey: "guangzhou-moving",
    displayName: "广州搬家",
    status: "active",
    retentionPolicyCode: "default",
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z",
    version: 1,
  });
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "广州搬家问题集",
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
  const sessionConditions = {
    searchMode: "unknown",
    isNewConversation: true,
    isLoggedIn: true,
    memoryEnabled: null,
    personalizationEnabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
  } as const;
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  const runs = new InMemoryConsumerObservationRunRepository();
  const surfaceProfiles = new InMemoryConsumerSurfaceProfileVersionRepository([
    surface,
  ]);
  const generatedIds = [ids.run, ids.task];
  const createRun = new CreateConsumerObservationRunService({
    scopes: new InMemoryScopeRepository([scope]),
    snapshots,
    surfaceProfiles,
    runs,
    newId: () => {
      const id = generatedIds.shift();
      if (!id) {
        throw new Error("SYNTHETIC_ID_EXHAUSTED");
      }
      return id;
    },
    now: () => "2026-08-22T10:00:00.000Z",
  });
  const created = await createRun.execute(principal, {
    scopeId: ids.scope,
    querySetSnapshotId: ids.snapshot,
    surfaceCode: "doubao_web",
    collectionMethod: "browser_assisted",
    experimentKind: "natural_answer",
    sampleCount: 1,
    sessionConditions,
  });
  assert.equal(created.tasks.length, 1);

  const artifact = createConsumerCaptureEvidenceArtifact({
    id: ids.artifact,
    scopeId: ids.scope,
    observationTaskId: ids.task,
    capturedBy: ids.user,
    collectionMethod: "browser_assisted",
    answerText: "合成可见回答。",
    adapterVersion: "doubao-web@1",
    visibleCitations: [
      { url: "https://www.example.com/source?utm_source=test", position: 1 },
    ],
    visibleSearchTrace: {
      status: "complete",
      summaryText: "搜索 2 个关键词，参考 1 篇资料",
      declaredKeywordCount: 2,
      keywords: [
        { position: 1, text: "广州搬家公司推荐" },
        { position: 2, text: "广州搬家公司避坑" },
      ],
      declaredReferenceCount: 1,
    },
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      ...sessionConditions,
      observedAt: "2026-08-22T10:01:59.000Z",
    },
    screenshotMediaAssetId: "a1111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-22T10:02:00.000Z",
  });
  const captureArtifacts =
    new InMemoryConsumerCaptureArtifactBindingRepository();
  const workflow = new ConsumerObservationWorkflowService({
    tasks: runs,
    captureArtifacts,
    captureTokens: new InMemoryCaptureTokenVerifier([
      [
        "synthetic-capture-token",
        createCaptureTokenClaims({
          systemInstanceId: "wentian-synthetic",
          scopeId: ids.scope,
          taskId: ids.task,
          userId: ids.user,
          audienceOrigin: "https://wentian.example.test",
          nonce: "synthetic-nonce",
          issuedAt: "2026-08-22T10:00:00.000Z",
          expiresAt: "2026-08-22T10:10:00.000Z",
        }),
      ],
    ]),
    captureTokenNonces: new InMemoryCaptureTokenNonceRepository(),
    systemInstanceId: "wentian-synthetic",
  });
  const claimed = await workflow.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const submitted = await workflow.submitCapture(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: claimed.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
    captureToken: "synthetic-capture-token",
    requestOrigin: "https://wentian.example.test",
    artifact,
  });
  const confirmationIds = [ids.response, ids.sourceEvent];
  const confirmed = await new ConfirmConsumerObservationTransactionService({
    tasks: runs,
    runs,
    captureArtifacts,
    surfaceProfiles,
    sourceEventProjector:
      new ConfirmedConsumerObservationSourceEventProjector(),
    transactions: runs,
    newId: () => {
      const id = confirmationIds.shift();
      if (!id) {
        throw new Error("SYNTHETIC_CONFIRMATION_ID_EXHAUSTED");
      }
      return id;
    },
  }).execute(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: submitted.version,
    occurredAt: "2026-08-22T10:03:00.000Z",
  });

  const reconcile = new ReconcileConsumerObservationRunService({
    runs,
    snapshots,
  });
  const completedRun = await reconcile.execute({
    scopeId: ids.scope,
    runId: ids.run,
    occurredAt: "2026-08-22T10:04:00.000Z",
  });
  assert.equal(completedRun.status, "succeeded");
  assert.equal(completedRun.successfulSampleCount, 1);

  const storedRecord = await runs.findRecordById(ids.scope, ids.response);
  assert.ok(storedRecord);
  assert.deepEqual(
    storedRecord.visibleSearchTrace?.keywords.map((keyword) => keyword.text),
    ["广州搬家公司推荐", "广州搬家公司避坑"],
  );
  assert.equal((await runs.listByResponse(ids.scope, ids.response)).length, 1);
  const batchBuilder = new BuildConsumerObservationMetricSampleBatchService({
    runs,
    snapshots,
    records: runs,
    surfaceProfiles,
    metricProjector:
      new DefaultConfirmedConsumerObservationMetricSampleProjector(),
  });
  const metricReport =
    await new GetConsumerObservationRunMetricsOnDemandService({
      batchBuilder,
      now: () => "2026-08-22T10:05:00.000Z",
    }).execute(principal, {
      scopeId: ids.scope,
      runId: ids.run,
    });
  const responseDto =
    adaptConsumerObservationMetricReportToResponse(metricReport);

  assert.equal(responseDto.availability, "available");
  assert.equal(responseDto.run_id, ids.run);
  assert.equal(responseDto.query_set_source_type, "local");
  assert.equal(responseDto.geo_connector_contract_version, null);
  assert.equal(responseDto.experiment_kind, "natural_answer");
  assert.equal(responseDto.collection_method, "browser_assisted");
  assert.equal(responseDto.nomination_context, null);
  assert.equal(responseDto.surface_profile_version_id, ids.surface);
  assert.equal(responseDto.consumer_surface_code, "doubao_web");
  assert.equal(responseDto.observation_verification_status, "confirmed");
  assert.deepEqual(responseDto.evidence_grades, ["web_confirmed_capture"]);
  assert.deepEqual(responseDto.sample_basis, {
    planned: 1,
    successful: 1,
    failed: 0,
  });
  assert.equal(responseDto.confirmed_sample_count, 1);
  assert.deepEqual(responseDto.groups[0].domains, [
    {
      registrable_domain: "example.com",
      web_visible_citation_rate: {
        availability: "available",
        numerator: 1,
        denominator: 1,
        value: 1,
      },
      first_visible_citation_rate: {
        availability: "available",
        numerator: 1,
        denominator: 1,
        value: 1,
      },
    },
  ]);
});
