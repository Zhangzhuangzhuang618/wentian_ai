import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmSourceNominationParseReview,
  createConfirmedConsumerObservationRecord,
  createConsumerObservationRun,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createSourceNominationParseReview,
  rejectSourceNominationParseReview,
} from "@wentian/domain";

import {
  ConfirmedConsumerSourceNominationMetricSampleProjector,
  SourceNominationEventProjector,
} from "../src/index.ts";

test("人工确认review与完整正式事件投影为human_confirmed指标样本", () => {
  const fixture = createFixture();
  const sample = fixture.metricProjector.project({
    run: fixture.run,
    response: fixture.response,
    review: fixture.confirmedReview,
    sourceEvents: fixture.sourceEvents,
  });

  assert.deepEqual(sample, {
    id: ids.response,
    querySnapshotItemId: ids.query,
    nominationContext: "unaided",
    validationStatus: "human_confirmed",
    nominations: [
      { registrableDomain: "example.com", position: 1 },
      { registrableDomain: "example.org", position: 2 },
    ],
  });
  assert.equal(Object.isFrozen(sample), true);
  assert.equal(Object.isFrozen(sample.nominations), true);
});

test("待复核和拒绝响应均投影为空提名并禁止正式事件", () => {
  const fixture = createFixture();
  for (const review of [fixture.review, fixture.rejectedReview]) {
    const sample = fixture.metricProjector.project({
      run: fixture.run,
      response: fixture.response,
      review,
      sourceEvents: [],
    });
    assert.equal(sample.validationStatus, review.status);
    assert.deepEqual(sample.nominations, []);
    assert.throws(() =>
      fixture.metricProjector.project({
        run: fixture.run,
        response: fixture.response,
        review,
        sourceEvents: fixture.sourceEvents,
      }),
    );
  }
});

test("缺失、重复和错绑事件集合均失败关闭", () => {
  const fixture = createFixture();
  const base = {
    run: fixture.run,
    response: fixture.response,
    review: fixture.confirmedReview,
  } as const;

  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...base,
        sourceEvents: fixture.sourceEvents.slice(0, 1),
      }),
    /EVENT_COUNT_MISMATCH/,
  );
  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...base,
        sourceEvents: [fixture.sourceEvents[0], fixture.sourceEvents[0]],
      }),
    /DUPLICATE_EVENT_ID/,
  );
  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...base,
        sourceEvents: [
          { ...fixture.sourceEvents[0], runId: "wrong-run" },
          fixture.sourceEvents[1],
        ],
      }),
    /EVENT_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...base,
        sourceEvents: [
          {
            ...fixture.sourceEvents[0],
            nominationValidationMethod: "schema_validated",
          },
          fixture.sourceEvents[1],
        ],
      }),
    /EVENT_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...base,
        sourceEvents: [
          { ...fixture.sourceEvents[0], sourceKeyHash: "b".repeat(64) },
          fixture.sourceEvents[1],
        ],
      }),
    /PROJECTION_MISMATCH/,
  );
});

test("自然回答、会话错绑和其他响应review不能进入投影", () => {
  const fixture = createFixture();
  const input = {
    response: fixture.response,
    review: fixture.confirmedReview,
    sourceEvents: fixture.sourceEvents,
  } as const;
  const naturalRun = createRun("natural_answer");
  assert.throws(
    () => fixture.metricProjector.project({ ...input, run: naturalRun }),
    /SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH/,
  );
  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...input,
        run: {
          ...fixture.run,
          sessionConditions: {
            ...fixture.run.sessionConditions,
            isLoggedIn: false,
          },
        },
      }),
    /SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH/,
  );
  const otherReview = confirmSourceNominationParseReview(
    createReview("other-response"),
    [{ registrableDomain: "example.com", position: 1 }],
    reviewContext,
  );
  assert.throws(
    () =>
      fixture.metricProjector.project({
        ...input,
        run: fixture.run,
        review: otherReview,
      }),
    /REVIEW_BINDING_MISMATCH/,
  );
});

const ids = {
  scope: "scope-1",
  run: "run-1",
  response: "response-1",
  query: "query-1",
  surface: "surface-1",
  user: "user-1",
} as const;

const reviewContext = {
  scopeId: ids.scope,
  reviewedBy: ids.user,
  expectedVersion: 1,
  occurredAt: "2026-08-22T12:02:00.000Z",
} as const;

function createFixture() {
  const run = createRun("source_nomination");
  const response = createResponse();
  const review = createReview(ids.response);
  const confirmedReview = confirmSourceNominationParseReview(
    review,
    [
      {
        registrableDomain: "Example.COM.",
        position: 1,
        informationType: "官方信息",
        reason: "核验主体资料",
      },
      { registrableDomain: "example.org", position: 2 },
    ],
    reviewContext,
  );
  const sourceEvents = new SourceNominationEventProjector().project({
    scopeId: ids.scope,
    runId: ids.run,
    responseId: ids.response,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    validationMethod: "human_confirmed",
    nominations: confirmedReview.proposedItems,
    newId: idGenerator(),
    createdAt: confirmedReview.reviewedAt!,
  });
  return {
    run,
    response,
    review,
    confirmedReview,
    rejectedReview: rejectSourceNominationParseReview(
      review,
      "无法确认",
      reviewContext,
    ),
    sourceEvents,
    metricProjector:
      new ConfirmedConsumerSourceNominationMetricSampleProjector(),
  };
}

function createReview(responseId: string) {
  return createSourceNominationParseReview({
    id: `review:${responseId}`,
    scopeId: ids.scope,
    responseId,
    proposedItems: [{ registrableDomain: "example.com", position: 1 }],
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    createdAt: "2026-08-22T12:01:00.000Z",
  });
}

function createRun(experimentKind: "natural_answer" | "source_nomination") {
  const snapshot = createQuerySetSnapshot({
    id: "snapshot-1",
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "自述问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
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
  return createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile: createSurface(),
    collectionMethod: "browser_assisted",
    experimentKind,
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
}

function createResponse() {
  return createConfirmedConsumerObservationRecord({
    id: ids.response,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    observationTaskId: "task-1",
    captureArtifactId: "artifact-1",
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    answerText: "参考 example.com。",
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
}

function createSurface() {
  return createConsumerSurfaceProfileVersion({
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
}

function idGenerator() {
  let value = 0;
  return () => `event-${++value}`;
}
