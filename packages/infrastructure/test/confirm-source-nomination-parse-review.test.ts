import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfirmSourceNominationParseReviewService,
  RejectSourceNominationParseReviewService,
  WentianApplicationError,
  type ConsumerObservationRunRepository,
} from "@wentian/application";
import {
  createConfirmedConsumerObservationRecord,
  createConsumerObservationRun,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  confirmSourceNominationParseReview,
  createSourceNominationParseReview,
  createWentianPrincipal,
} from "@wentian/domain";

import {
  InMemoryConfirmedConsumerObservationRecordRepository,
  InMemorySourceNominationParseReviewRepository,
  SourceNominationEventProjector,
} from "../src/index.ts";

test("人工确认从服务端响应身份原子创建完整nominated事件集合", async () => {
  const fixture = await createFixture();

  const result = await fixture.service.execute(fixture.principal, baseCommand);

  assert.equal(result.review.status, "confirmed");
  assert.equal(result.review.reviewedBy, ids.user);
  assert.equal(result.sourceEvents.length, 2);
  assert.ok(
    result.sourceEvents.every(
      (event) =>
        event.scopeId === ids.scope &&
        event.runId === ids.run &&
        event.responseId === ids.response &&
        event.querySnapshotItemId === ids.query &&
        event.sampleIndex === 1 &&
        event.nominationValidationMethod === "human_confirmed" &&
        event.originalUrl === null,
    ),
  );
  assert.equal(
    (await fixture.nominationRepository.findById(ids.scope, ids.review))
      ?.status,
    "confirmed",
  );
  assert.deepEqual(
    (
      await fixture.nominationRepository.listByResponse(ids.scope, ids.response)
    ).map((event) => event.registrableDomain),
    ["example.com", "example.org"],
  );
});

test("跨scope隐藏资源且viewer不能确认复核", async () => {
  const fixture = await createFixture();
  const outsider = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [],
  });
  const viewer = createWentianPrincipal({
    userId: ids.user,
    role: "viewer",
    allowedScopeIds: [ids.scope],
  });

  await assert.rejects(
    () => fixture.service.execute(outsider, baseCommand),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
  await assert.rejects(
    () => fixture.service.execute(viewer, baseCommand),
    isApplicationError("ACTION_FORBIDDEN"),
  );
});

test("自然回答运行和响应绑定不一致时不终结复核", async () => {
  const naturalFixture = await createFixture({
    experimentKind: "natural_answer",
  });
  await assert.rejects(
    () => naturalFixture.service.execute(naturalFixture.principal, baseCommand),
    /SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH/,
  );
  assert.equal(
    (await naturalFixture.nominationRepository.findById(ids.scope, ids.review))
      ?.status,
    "needs_review",
  );

  const wrongRunFixture = await createFixture({ responseRunId: "other-run" });
  await assert.rejects(
    () =>
      wrongRunFixture.service.execute(wrongRunFixture.principal, baseCommand),
    /SOURCE_NOMINATION_RUN_NOT_FOUND/,
  );
  assert.equal(
    (await wrongRunFixture.nominationRepository.findById(ids.scope, ids.review))
      ?.status,
    "needs_review",
  );
});

test("事件ID冲突时review与整个事件集合均不落档", async () => {
  const fixture = await createFixture({ generatedEventId: ids.existingEvent });
  const projector = new SourceNominationEventProjector();
  await fixture.nominationRepository.createMany(
    projector.project({
      scopeId: ids.scope,
      runId: ids.run,
      responseId: "existing-response",
      querySnapshotItemId: ids.query,
      sampleIndex: 1,
      validationMethod: "schema_validated",
      nominations: [{ registrableDomain: "existing.com", position: 1 }],
      newId: () => ids.existingEvent,
      createdAt: "2026-08-22T11:00:00.000Z",
    }),
  );

  await assert.rejects(
    () => fixture.service.execute(fixture.principal, baseCommand),
    /AI_VISIBILITY_NOMINATED_SOURCE_EVENT_CONFLICT/,
  );
  assert.equal(
    (await fixture.nominationRepository.findById(ids.scope, ids.review))
      ?.status,
    "needs_review",
  );
  assert.deepEqual(
    await fixture.nominationRepository.listByResponse(ids.scope, ids.response),
    [],
  );
});

test("事务拒绝缺项、错响应身份和伪造事件归属且保持原记录", async () => {
  const fixture = await createFixture();
  const confirmed = await fixture.service.execute(fixture.principal, {
    ...baseCommand,
    reviewedItems: [],
  });
  assert.equal(confirmed.sourceEvents.length, 0);

  const second = await createFixture();
  const review = createSourceNominationParseReview({
    id: "review-direct",
    scopeId: ids.scope,
    responseId: ids.response,
    proposedItems: [{ registrableDomain: "example.com", position: 1 }],
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    createdAt: "2026-08-22T12:01:00.000Z",
  });
  const otherRepository = new InMemorySourceNominationParseReviewRepository();
  await otherRepository.create(review);
  const confirmedReview = confirmSourceNominationParseReview(
    review,
    review.proposedItems,
    {
      scopeId: ids.scope,
      reviewedBy: ids.user,
      expectedVersion: 1,
      occurredAt: "2026-08-22T12:02:00.000Z",
    },
  );
  await assert.rejects(
    () =>
      otherRepository.commitConfirmation({
        review: confirmedReview,
        expectedReviewVersion: 1,
        response: second.response,
        sourceEvents: [],
      }),
    /EVENT_SET_MISMATCH/,
  );
  const wrongEvents = new SourceNominationEventProjector().project({
    scopeId: ids.scope,
    runId: "wrong-run",
    responseId: ids.response,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    validationMethod: "human_confirmed",
    nominations: confirmedReview.proposedItems,
    newId: () => "wrong-binding-event",
    createdAt: confirmedReview.reviewedAt!,
  });
  await assert.rejects(
    () =>
      otherRepository.commitConfirmation({
        review: confirmedReview,
        expectedReviewVersion: 1,
        response: second.response,
        sourceEvents: wrongEvents,
      }),
    /EVENT_BINDING_MISMATCH/,
  );
  assert.equal(
    (await otherRepository.findById(ids.scope, review.id))?.status,
    "needs_review",
  );
});

test("拒绝复核只保存终态与原因且不创建来源事件", async () => {
  const fixture = await createFixture();

  const rejected = await fixture.rejectService.execute(
    fixture.principal,
    rejectCommand,
  );

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reviewedBy, ids.user);
  assert.equal(rejected.rejectionReason, "回答没有明确列出可核验域名");
  assert.deepEqual(
    await fixture.nominationRepository.listByResponse(ids.scope, ids.response),
    [],
  );
});

test("拒绝路径执行scope、角色、版本和自述运行门禁", async () => {
  const fixture = await createFixture();
  const outsider = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [],
  });
  const viewer = createWentianPrincipal({
    userId: ids.user,
    role: "viewer",
    allowedScopeIds: [ids.scope],
  });

  await assert.rejects(
    () => fixture.rejectService.execute(outsider, rejectCommand),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
  await assert.rejects(
    () => fixture.rejectService.execute(viewer, rejectCommand),
    isApplicationError("ACTION_FORBIDDEN"),
  );
  await assert.rejects(
    () =>
      fixture.rejectService.execute(fixture.principal, {
        ...rejectCommand,
        reviewVersion: 2,
      }),
    /NOMINATION_REVIEW_VERSION_CONFLICT/,
  );

  const natural = await createFixture({ experimentKind: "natural_answer" });
  await assert.rejects(
    () => natural.rejectService.execute(natural.principal, rejectCommand),
    /SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH/,
  );
});

test("响应已有正式提名事件时拒绝事务失败且review保持待复核", async () => {
  const fixture = await createFixture();
  await fixture.nominationRepository.createMany(
    new SourceNominationEventProjector().project({
      scopeId: ids.scope,
      runId: ids.run,
      responseId: ids.response,
      querySnapshotItemId: ids.query,
      sampleIndex: 1,
      validationMethod: "schema_validated",
      nominations: [{ registrableDomain: "example.com", position: 1 }],
      newId: () => "preexisting-event",
      createdAt: "2026-08-22T12:01:30.000Z",
    }),
  );

  await assert.rejects(
    () => fixture.rejectService.execute(fixture.principal, rejectCommand),
    /SOURCE_NOMINATION_REJECTION_HAS_SOURCE_EVENTS/,
  );
  assert.equal(
    (await fixture.nominationRepository.findById(ids.scope, ids.review))
      ?.status,
    "needs_review",
  );
});

const ids = {
  scope: "scope-1",
  run: "run-1",
  response: "response-1",
  query: "query-1",
  review: "review-1",
  user: "user-1",
  surface: "surface-1",
  existingEvent: "existing-event-1",
} as const;

const baseCommand = {
  scopeId: ids.scope,
  reviewId: ids.review,
  reviewVersion: 1,
  reviewedItems: [
    {
      registrableDomain: "Example.COM.",
      position: 1,
      informationType: "官方信息",
      reason: "人工核对回答原文",
    },
    {
      registrableDomain: "example.org",
      position: 2,
      informationType: "行业信息",
      reason: "回答显式列出",
    },
  ],
  occurredAt: "2026-08-22T12:02:00.000Z",
} as const;

const rejectCommand = {
  scopeId: ids.scope,
  reviewId: ids.review,
  reviewVersion: 1,
  rejectionReason: "回答没有明确列出可核验域名",
  occurredAt: "2026-08-22T12:02:00.000Z",
} as const;

async function createFixture(
  options: {
    readonly experimentKind?: "natural_answer" | "source_nomination";
    readonly responseRunId?: string;
    readonly generatedEventId?: string;
  } = {},
) {
  const snapshot = createQuerySetSnapshot({
    id: "snapshot-1",
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "自述实验问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
    queries: [
      {
        queryText: "回答广州搬家公司问题应参考哪些公开来源？",
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
    termsReviewedAt: "2026-08-22T10:00:00.000Z",
    status: "active",
    createdBy: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const run = createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile: surface,
    collectionMethod: "browser_assisted",
    experimentKind: options.experimentKind ?? "source_nomination",
    requestedSampleCount: 1,
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
  const response = createConfirmedConsumerObservationRecord({
    id: ids.response,
    scopeId: ids.scope,
    runId: options.responseRunId ?? ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    observationTaskId: "task-1",
    captureArtifactId: "artifact-1",
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    answerText: "建议参考 example.com 和 example.org。",
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
      observedAt: "2026-08-22T12:00:00.000Z",
    },
    screenshotMediaAssetId: "screenshot-1",
    adapterVersion: "doubao-web@1",
    confirmedBy: ids.user,
    confirmedAt: "2026-08-22T12:00:00.000Z",
  });
  const review = createSourceNominationParseReview({
    id: ids.review,
    scopeId: ids.scope,
    responseId: ids.response,
    proposedItems: [{ registrableDomain: "example.com", position: 1 }],
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    createdAt: "2026-08-22T12:01:00.000Z",
  });
  const nominationRepository =
    new InMemorySourceNominationParseReviewRepository();
  const responses = new InMemoryConfirmedConsumerObservationRecordRepository();
  await nominationRepository.create(review);
  await responses.create(response);

  const runs: ConsumerObservationRunRepository = {
    findRunById: async (scopeId, runId) =>
      scopeId === run.scopeId && runId === run.id ? run : null,
    createWithTasks: async () => {
      throw new Error("UNUSED");
    },
    listTasksForRun: async () => [],
    saveRun: async () => {
      throw new Error("UNUSED");
    },
  };
  let generated = 0;
  const service = new ConfirmSourceNominationParseReviewService({
    reviews: nominationRepository,
    responses,
    runs,
    projector: new SourceNominationEventProjector(),
    transactions: nominationRepository,
    newId: () => {
      generated += 1;
      return generated === 1 && options.generatedEventId
        ? options.generatedEventId
        : `event-${generated}`;
    },
  });
  const rejectService = new RejectSourceNominationParseReviewService({
    reviews: nominationRepository,
    responses,
    runs,
    transactions: nominationRepository,
  });
  return {
    nominationRepository,
    principal: createWentianPrincipal({
      userId: ids.user,
      role: "analyst",
      allowedScopeIds: [ids.scope],
    }),
    response,
    rejectService,
    service,
  };
}

function isApplicationError(code: string) {
  return (error: unknown) =>
    error instanceof WentianApplicationError && error.code === code;
}
