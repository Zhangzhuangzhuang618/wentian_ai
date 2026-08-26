import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildConsumerSourceNominationMetricSampleBatchService,
  ConfirmConsumerObservationTransactionService,
  ConfirmSourceNominationParseReviewService,
  ConsumerObservationWorkflowService,
  CreateConsumerObservationRunService,
  CreateSourceNominationParseReviewService,
  GetConsumerSourceNominationRunMetricsOnDemandService,
  ReconcileConsumerObservationRunService,
} from "@wentian/application";
import { adaptConsumerSourceNominationRunMetricReportToResponse } from "@wentian/contracts";
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
  ConfirmedConsumerSourceNominationMetricSampleProjector,
  DeterministicExplicitSourceNominationExtractor,
  InMemoryCaptureTokenNonceRepository,
  InMemoryCaptureTokenVerifier,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
  InMemoryScopeRepository,
  InMemorySourceNominationParseReviewRepository,
  SourceNominationEventProjector,
} from "@wentian/infrastructure";

test("合成消费端自述从运行创建、人工复核推进到严格指标DTO", async () => {
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
    createdAt: times.scope,
    updatedAt: times.scope,
    version: 1,
  });
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "广州搬家信源自述问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
    queries: [
      {
        queryText: "推荐广州搬家公司时应参考哪些权威信源？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: ids.user,
    createdAt: times.scope,
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
    termsReviewedAt: times.scope,
    status: "active",
    createdBy: ids.user,
    createdAt: times.scope,
  });
  const sessionConditions = {
    searchMode: "disabled",
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
  const runIds = [ids.run, ids.task];
  const created = await new CreateConsumerObservationRunService({
    scopes: new InMemoryScopeRepository([scope]),
    snapshots,
    surfaceProfiles,
    runs,
    newId: sequentialIds(runIds),
    now: () => times.runCreated,
  }).execute(principal, {
    scopeId: ids.scope,
    querySetSnapshotId: ids.snapshot,
    surfaceCode: "doubao_web",
    collectionMethod: "browser_assisted",
    experimentKind: "source_nomination",
    sampleCount: 1,
    sessionConditions,
  });
  assert.equal(created.run.nominationContext, "unaided");

  const captureArtifacts =
    new InMemoryConsumerCaptureArtifactBindingRepository();
  const workflow = new ConsumerObservationWorkflowService({
    tasks: runs,
    captureArtifacts,
    captureTokens: new InMemoryCaptureTokenVerifier([
      [
        "synthetic-nomination-token",
        createCaptureTokenClaims({
          systemInstanceId: "wentian-synthetic",
          scopeId: ids.scope,
          taskId: ids.task,
          userId: ids.user,
          audienceOrigin: "https://wentian.example.test",
          nonce: "synthetic-nomination-nonce",
          issuedAt: times.runCreated,
          expiresAt: "2026-08-23T10:10:00.000Z",
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
    occurredAt: times.claimed,
  });
  const artifact = createConsumerCaptureEvidenceArtifact({
    id: ids.artifact,
    scopeId: ids.scope,
    observationTaskId: ids.task,
    capturedBy: ids.user,
    collectionMethod: "browser_assisted",
    answerText:
      "建议参考 https://www.example.com/reference，并交叉核验 example.org。",
    visibleCitations: [
      {
        url: "https://citation-only.example.net/article",
        label: "回答页面可见引用，但自述实验不得写为cited事件",
        position: 1,
      },
    ],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      ...sessionConditions,
      observedAt: times.observed,
    },
    screenshotMediaAssetId: ids.screenshot,
    adapterVersion: "doubao-web@1",
    createdAt: times.captured,
  });
  const submitted = await workflow.submitCapture(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: claimed.version,
    occurredAt: times.captured,
    captureToken: "synthetic-nomination-token",
    requestOrigin: "https://wentian.example.test",
    artifact,
  });
  const confirmed = await new ConfirmConsumerObservationTransactionService({
    tasks: runs,
    runs,
    captureArtifacts,
    surfaceProfiles,
    sourceEventProjector:
      new ConfirmedConsumerObservationSourceEventProjector(),
    transactions: runs,
    newId: () => ids.response,
  }).execute(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: submitted.version,
    occurredAt: times.responseConfirmed,
  });
  assert.equal(confirmed.sourceEvents.length, 0);

  const completedRun = await new ReconcileConsumerObservationRunService({
    runs,
    snapshots,
  }).execute({
    scopeId: ids.scope,
    runId: ids.run,
    occurredAt: times.runCompleted,
  });
  assert.equal(completedRun.status, "succeeded");

  const reviews = new InMemorySourceNominationParseReviewRepository();
  const parsed = await new CreateSourceNominationParseReviewService({
    reviews,
    responses: runs,
    runs,
    extractor: new DeterministicExplicitSourceNominationExtractor(),
    newId: () => ids.review,
    now: () => times.reviewCreated,
  }).execute(principal, {
    scopeId: ids.scope,
    responseId: ids.response,
  });
  assert.deepEqual(
    parsed.review.proposedItems.map((item) => item.registrableDomain),
    ["example.com", "example.org"],
  );

  const nominationEventIds = [
    ids.firstNominationEvent,
    ids.secondNominationEvent,
  ];
  const reviewed = await new ConfirmSourceNominationParseReviewService({
    reviews,
    responses: runs,
    runs,
    projector: new SourceNominationEventProjector(),
    transactions: reviews,
    newId: sequentialIds(nominationEventIds),
  }).execute(principal, {
    scopeId: ids.scope,
    reviewId: ids.review,
    reviewVersion: parsed.review.version,
    reviewedItems: parsed.review.proposedItems,
    occurredAt: times.reviewConfirmed,
  });
  assert.equal(reviewed.sourceEvents.length, 2);

  const batchBuilder =
    new BuildConsumerSourceNominationMetricSampleBatchService({
      runs,
      snapshots,
      responses: runs,
      reviews,
      sourceEvents: reviews,
      surfaceProfiles,
      metricProjector:
        new ConfirmedConsumerSourceNominationMetricSampleProjector(),
    });
  const report = await new GetConsumerSourceNominationRunMetricsOnDemandService(
    {
      batchBuilder,
      now: () => times.computed,
    },
  ).execute(principal, { scopeId: ids.scope, runId: ids.run });
  const responseDto =
    adaptConsumerSourceNominationRunMetricReportToResponse(report);

  assert.equal(responseDto.run_id, ids.run);
  assert.equal(responseDto.experiment_kind, "source_nomination");
  assert.equal(responseDto.nomination_context, "unaided");
  assert.equal(responseDto.availability, "available");
  assert.equal(responseDto.validated_sample_count, 1);
  assert.equal(responseDto.unsupported_internal_claim_sample_count, 0);
  assert.equal(responseDto.unsupported_internal_claim_warning, null);
  assert.equal(
    responseDto.warnings[0],
    "SELF_REPORTED_NOMINATION_NOT_OBSERVED_RETRIEVAL_OR_CITATION",
  );
  assert.deepEqual(
    responseDto.groups[0].domains.map((domain) => domain.registrable_domain),
    ["example.com", "example.org"],
  );
});

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
  review: "a1111111-1111-4111-8111-111111111111",
  firstNominationEvent: "b1111111-1111-4111-8111-111111111111",
  secondNominationEvent: "c1111111-1111-4111-8111-111111111111",
  screenshot: "d1111111-1111-4111-8111-111111111111",
} as const;

const times = {
  scope: "2026-08-23T09:00:00.000Z",
  runCreated: "2026-08-23T10:00:00.000Z",
  claimed: "2026-08-23T10:01:00.000Z",
  observed: "2026-08-23T10:01:59.000Z",
  captured: "2026-08-23T10:02:00.000Z",
  responseConfirmed: "2026-08-23T10:03:00.000Z",
  runCompleted: "2026-08-23T10:04:00.000Z",
  reviewCreated: "2026-08-23T10:05:00.000Z",
  reviewConfirmed: "2026-08-23T10:06:00.000Z",
  computed: "2026-08-23T10:07:00.000Z",
} as const;

function sequentialIds(idsToUse: string[]) {
  return () => {
    const id = idsToUse.shift();
    if (!id) {
      throw new Error("SYNTHETIC_ID_EXHAUSTED");
    }
    return id;
  };
}
