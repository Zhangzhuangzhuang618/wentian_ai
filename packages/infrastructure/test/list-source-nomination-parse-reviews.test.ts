import assert from "node:assert/strict";
import test from "node:test";

import {
  ListSourceNominationParseReviewsService,
  WentianApplicationError,
  type SourceNominationParseReviewRepository,
} from "@wentian/application";
import {
  confirmSourceNominationParseReview,
  createSourceNominationParseReview,
  createWentianPrincipal,
} from "@wentian/domain";

import { InMemorySourceNominationParseReviewRepository } from "../src/index.ts";

test("viewer可按scope和状态读取确定性复核队列", async () => {
  const repository = new InMemorySourceNominationParseReviewRepository();
  const later = createReview(
    "review-2",
    "response-2",
    "2026-08-22T12:01:00.000Z",
  );
  const earlier = createReview(
    "review-1",
    "response-1",
    "2026-08-22T12:00:00.000Z",
  );
  const confirmedInitial = createReview(
    "review-3",
    "response-3",
    "2026-08-22T12:02:00.000Z",
  );
  const confirmed = confirmSourceNominationParseReview(
    confirmedInitial,
    confirmedInitial.proposedItems,
    {
      scopeId: ids.scope,
      reviewedBy: ids.user,
      expectedVersion: 1,
      occurredAt: "2026-08-22T12:03:00.000Z",
    },
  );
  await repository.create(later);
  await repository.create(earlier);
  await repository.create(confirmedInitial);
  await repository.save(confirmed, 1);

  const result = await new ListSourceNominationParseReviewsService(
    repository,
  ).execute(principal(), { scopeId: ids.scope, status: "needs_review" });

  assert.deepEqual(
    result.map((review) => review.id),
    ["review-1", "review-2"],
  );
  assert.ok(Object.isFrozen(result));
});

test("无scope权限时不调用Repository并统一返回不存在", async () => {
  let called = false;
  const repository: SourceNominationParseReviewRepository = {
    create: async () => undefined,
    findById: async () => null,
    findByResponseId: async () => null,
    listByStatus: async () => {
      called = true;
      return [];
    },
    save: async (review) => review,
  };
  const outsider = createWentianPrincipal({
    userId: ids.user,
    role: "viewer",
    allowedScopeIds: [],
  });

  await assert.rejects(
    () =>
      new ListSourceNominationParseReviewsService(repository).execute(
        outsider,
        { scopeId: ids.scope, status: "needs_review" },
      ),
    (error: unknown) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
  assert.equal(called, false);
});

test("非法运行时状态和Repository错scope、错状态或重复响应失败关闭", async () => {
  const valid = createReview("review-1", "response-1");
  const serviceFor = (reviews: readonly (typeof valid)[]) =>
    new ListSourceNominationParseReviewsService({
      create: async () => undefined,
      findById: async () => null,
      findByResponseId: async () => null,
      listByStatus: async () => reviews,
      save: async (review) => review,
    });

  await assert.rejects(
    () =>
      serviceFor([]).execute(principal(), {
        scopeId: ids.scope,
        status: "invalid" as never,
      }),
    /INVALID_SOURCE_NOMINATION_REVIEW_STATUS/,
  );
  await assert.rejects(
    () =>
      serviceFor([{ ...valid, scopeId: "other-scope" } as never]).execute(
        principal(),
        { scopeId: ids.scope, status: "needs_review" },
      ),
    /INTEGRITY_MISMATCH|QUERY_RESULT_MISMATCH/,
  );
  const confirmed = confirmSourceNominationParseReview(
    valid,
    valid.proposedItems,
    {
      scopeId: ids.scope,
      reviewedBy: ids.user,
      expectedVersion: 1,
      occurredAt: "2026-08-22T12:02:00.000Z",
    },
  );
  await assert.rejects(
    () =>
      serviceFor([confirmed]).execute(principal(), {
        scopeId: ids.scope,
        status: "needs_review",
      }),
    /QUERY_RESULT_MISMATCH/,
  );
  await assert.rejects(
    () =>
      serviceFor([valid, { ...valid, id: "review-2" } as never]).execute(
        principal(),
        { scopeId: ids.scope, status: "needs_review" },
      ),
    /QUERY_RESULT_MISMATCH/,
  );
});

const ids = { scope: "scope-1", user: "user-1" } as const;

function createReview(
  id: string,
  responseId: string,
  createdAt = "2026-08-22T12:00:00.000Z",
) {
  return createSourceNominationParseReview({
    id,
    scopeId: ids.scope,
    responseId,
    proposedItems: [{ registrableDomain: "example.com", position: 1 }],
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    createdAt,
  });
}

function principal() {
  return createWentianPrincipal({
    userId: ids.user,
    role: "viewer",
    allowedScopeIds: [ids.scope],
  });
}
