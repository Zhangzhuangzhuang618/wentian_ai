import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSourceNominationParseReviewService,
  WentianApplicationError,
  type ConsumerObservationRunRepository,
  type ExplicitSourceNominationExtractor,
  type SourceNominationParseReviewRepository,
} from "@wentian/application";
import {
  createConfirmedConsumerObservationRecord,
  createConsumerObservationRun,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createWentianPrincipal,
} from "@wentian/domain";

import {
  DeterministicExplicitSourceNominationExtractor,
  InMemoryConfirmedConsumerObservationRecordRepository,
  InMemorySourceNominationParseReviewRepository,
} from "../src/index.ts";

test("从服务端已确认自述响应提取并创建带溯源needs_review", async () => {
  const fixture = await createFixture({
    answerText:
      "参考 https://www.example.com/a，另核验 example.org 和 https://example.com/b。",
  });

  const result = await fixture.service.execute(fixture.principal, command);

  assert.equal(result.created, true);
  assert.equal(result.extractionStatus, "review_required");
  assert.equal(result.review.status, "needs_review");
  assert.equal(
    result.review.extractionVersion,
    "wentian-explicit-source-nomination@1",
  );
  assert.equal(result.review.initialProposedItemCount, 3);
  assert.equal(result.review.validExplicitOccurrenceCount, 3);
  assert.equal(result.review.rejectedExplicitOccurrenceCount, 0);
  assert.equal(result.review.extractionTruncated, false);
  assert.deepEqual(
    result.review.proposedItems.map((item) => item.registrableDomain),
    ["example.com", "example.org", "example.com"],
  );
  assert.equal(
    await fixture.reviews.findByResponseId(ids.scope, ids.response),
    result.review,
  );
});

test("无显式域名仍创建空候选待复核而不伪装成已确认无提名", async () => {
  const fixture = await createFixture({
    answerText: "建议参考官方公示系统和本地消费者评价平台。",
  });

  const result = await fixture.service.execute(fixture.principal, command);

  assert.equal(result.extractionStatus, "no_explicit_source");
  assert.equal(result.review.status, "needs_review");
  assert.deepEqual(result.review.proposedItems, []);
  assert.equal(result.review.initialProposedItemCount, 0);
  assert.equal(result.review.validExplicitOccurrenceCount, 0);
});

test("同一响应幂等复用原review且不重新运行新版本提取器", async () => {
  let extractionCount = 0;
  const delegate = new DeterministicExplicitSourceNominationExtractor();
  const extractor: ExplicitSourceNominationExtractor = {
    extract: (answerText) => {
      extractionCount += 1;
      return delegate.extract(answerText);
    },
  };
  const fixture = await createFixture({ extractor });

  const first = await fixture.service.execute(fixture.principal, command);
  const second = await fixture.service.execute(fixture.principal, command);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.review, first.review);
  assert.equal(extractionCount, 1);
});

test("并发创建已落档后抛出冲突时回读同一响应review", async () => {
  const base = new InMemorySourceNominationParseReviewRepository();
  let firstCreate = true;
  const repository = {
    create: async (review: Parameters<typeof base.create>[0]) => {
      await base.create(review);
      if (firstCreate) {
        firstCreate = false;
        throw new Error("SYNTHETIC_AFTER_COMMIT_CONFLICT");
      }
    },
    findById: base.findById.bind(base),
    findByResponseId: base.findByResponseId.bind(base),
    listByStatus: base.listByStatus.bind(base),
    save: base.save.bind(base),
  };
  const fixture = await createFixture({ reviews: repository });

  const result = await fixture.service.execute(fixture.principal, command);

  assert.equal(result.created, false);
  assert.equal(result.review.responseId, ids.response);
});

test("跨scope、viewer、自然回答和会话错绑均不创建review", async () => {
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
    () => fixture.service.execute(outsider, command),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
  await assert.rejects(
    () => fixture.service.execute(viewer, command),
    isApplicationError("ACTION_FORBIDDEN"),
  );

  const natural = await createFixture({ experimentKind: "natural_answer" });
  await assert.rejects(
    () => natural.service.execute(natural.principal, command),
    /SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH/,
  );
  const mismatchedSession = await createFixture({
    responseSearchMode: "enabled",
  });
  await assert.rejects(
    () =>
      mismatchedSession.service.execute(mismatchedSession.principal, command),
    /SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH/,
  );
  assert.deepEqual(
    await mismatchedSession.reviews.listByStatus(ids.scope, "needs_review"),
    [],
  );
});

test("提取器状态伪造和review时间早于响应确认均失败关闭", async () => {
  const delegate = new DeterministicExplicitSourceNominationExtractor();
  const malformed = await createFixture({
    extractor: {
      extract: (answerText) => ({
        ...delegate.extract(answerText),
        status: "no_explicit_source",
      }),
    },
  });
  await assert.rejects(
    () => malformed.service.execute(malformed.principal, command),
    /SOURCE_NOMINATION_EXTRACTION_RESULT_MISMATCH/,
  );

  const early = await createFixture({
    now: "2026-08-22T11:59:59.000Z",
  });
  await assert.rejects(
    () => early.service.execute(early.principal, command),
    /NOMINATION_REVIEW_BEFORE_RESPONSE_CONFIRMATION/,
  );
  assert.deepEqual(
    await early.reviews.listByStatus(ids.scope, "needs_review"),
    [],
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

const command = { scopeId: ids.scope, responseId: ids.response } as const;

async function createFixture(
  options: {
    readonly answerText?: string;
    readonly experimentKind?: "natural_answer" | "source_nomination";
    readonly responseSearchMode?: "disabled" | "enabled";
    readonly extractor?: ExplicitSourceNominationExtractor;
    readonly reviews?: SourceNominationParseReviewRepository;
    readonly now?: string;
  } = {},
) {
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
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    observationTaskId: "task-1",
    captureArtifactId: "artifact-1",
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    answerText: options.answerText ?? "参考 example.com。",
    visibleCitations: [],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      searchMode: options.responseSearchMode ?? "disabled",
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
  const responses = new InMemoryConfirmedConsumerObservationRecordRepository();
  await responses.create(response);
  const runs: ConsumerObservationRunRepository = {
    findRunById: async (scopeId, runId) =>
      scopeId === ids.scope && runId === ids.run ? run : null,
    createWithTasks: async () => {
      throw new Error("UNUSED");
    },
    listTasksForRun: async () => [],
    saveRun: async () => {
      throw new Error("UNUSED");
    },
  };
  const reviews =
    options.reviews ?? new InMemorySourceNominationParseReviewRepository();
  return {
    reviews,
    principal: createWentianPrincipal({
      userId: ids.user,
      role: "analyst",
      allowedScopeIds: [ids.scope],
    }),
    service: new CreateSourceNominationParseReviewService({
      reviews,
      responses,
      runs,
      extractor:
        options.extractor ??
        new DeterministicExplicitSourceNominationExtractor(),
      newId: () => "review-1",
      now: () => options.now ?? "2026-08-22T12:01:00.000Z",
    }),
  };
}

function isApplicationError(code: string) {
  return (error: unknown) =>
    error instanceof WentianApplicationError && error.code === code;
}
