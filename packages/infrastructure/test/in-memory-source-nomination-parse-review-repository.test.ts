import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmSourceNominationParseReview,
  createSourceNominationParseReview,
  rejectSourceNominationParseReview,
} from "@wentian/domain";

import { InMemorySourceNominationParseReviewRepository } from "../src/index.ts";

test("复核仓储按scope隔离并支持响应反查和状态队列", async () => {
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
  await repository.create(later);
  await repository.create(earlier);

  assert.equal(await repository.findById("scope-1", earlier.id), earlier);
  assert.equal(await repository.findById("scope-2", earlier.id), null);
  assert.equal(
    await repository.findByResponseId("scope-1", earlier.responseId),
    earlier,
  );
  assert.equal(
    await repository.findByResponseId("scope-2", earlier.responseId),
    null,
  );
  assert.deepEqual(
    (await repository.listByStatus("scope-1", "needs_review")).map(
      (review) => review.id,
    ),
    ["review-1", "review-2"],
  );
});

test("同一ID或同一scope内的响应不能创建第二条复核", async () => {
  const repository = new InMemorySourceNominationParseReviewRepository();
  const review = createReview("review-1", "response-1");
  await repository.create(review);

  await assert.rejects(
    () => repository.create(review),
    /SOURCE_NOMINATION_PARSE_REVIEW_CONFLICT/,
  );
  await assert.rejects(
    () => repository.create(createReview("review-2", "response-1")),
    /SOURCE_NOMINATION_PARSE_REVIEW_CONFLICT/,
  );

  const otherScope = createSourceNominationParseReview({
    ...baseInput,
    id: "review-3",
    scopeId: "scope-2",
    responseId: "response-1",
  });
  await repository.create(otherScope);
  assert.equal(
    await repository.findByResponseId("scope-2", "response-1"),
    otherScope,
  );
});

test("确认和驳回按乐观锁保存并迁移状态队列", async () => {
  const repository = new InMemorySourceNominationParseReviewRepository();
  const confirmable = createReview("review-1", "response-1");
  const rejectable = createReview("review-2", "response-2");
  await repository.create(confirmable);
  await repository.create(rejectable);

  const confirmed = confirmSourceNominationParseReview(
    confirmable,
    [
      {
        registrableDomain: "official.example",
        position: 1,
        reason: "人工核对回答原文",
      },
    ],
    reviewContext,
  );
  const rejected = rejectSourceNominationParseReview(
    rejectable,
    "回答没有明确列出域名",
    reviewContext,
  );

  assert.equal(await repository.save(confirmed, 1), confirmed);
  assert.equal(await repository.save(rejected, 1), rejected);
  assert.deepEqual(
    await repository.listByStatus("scope-1", "needs_review"),
    [],
  );
  assert.deepEqual(
    (await repository.listByStatus("scope-1", "confirmed")).map(
      (review) => review.id,
    ),
    ["review-1"],
  );
  assert.deepEqual(
    (await repository.listByStatus("scope-1", "rejected")).map(
      (review) => review.id,
    ),
    ["review-2"],
  );
});

test("陈旧版本、身份篡改和非法状态更新失败且不污染原记录", async () => {
  const repository = new InMemorySourceNominationParseReviewRepository();
  const review = createReview("review-1", "response-1");
  await repository.create(review);
  const confirmed = confirmSourceNominationParseReview(
    review,
    review.proposedItems,
    reviewContext,
  );

  await assert.rejects(
    () => repository.save(confirmed, 2),
    /SOURCE_NOMINATION_PARSE_REVIEW_VERSION_CONFLICT/,
  );
  await assert.rejects(
    () => repository.save({ ...confirmed, responseId: "response-2" }, 1),
    /SOURCE_NOMINATION_PARSE_REVIEW_IDENTITY_MISMATCH|INTEGRITY_MISMATCH/,
  );
  await assert.rejects(
    () => repository.save({ ...review, version: 2 }, 1),
    /INTEGRITY_MISMATCH|TRANSITION_INVALID/,
  );
  await assert.rejects(
    () => repository.save({ ...confirmed, extractionVersion: "tampered@2" }, 1),
    /IDENTITY_MISMATCH/,
  );
  assert.equal(await repository.findById("scope-1", review.id), review);
});

const baseInput = {
  scopeId: "scope-1",
  responseId: "response-1",
  proposedItems: [
    {
      registrableDomain: "example.com",
      position: 1,
      informationType: "官方信息",
      reason: "核验公开资料",
    },
  ],
  extractionVersion: "test-explicit@1",
  validExplicitOccurrenceCount: 1,
  rejectedExplicitOccurrenceCount: 0,
  extractionTruncated: false,
  createdAt: "2026-08-22T12:00:00.000Z",
} as const;

const reviewContext = {
  scopeId: "scope-1",
  reviewedBy: "reviewer-1",
  expectedVersion: 1,
  occurredAt: "2026-08-22T12:02:00.000Z",
} as const;

function createReview(
  id: string,
  responseId: string,
  createdAt: string = baseInput.createdAt,
) {
  return createSourceNominationParseReview({
    ...baseInput,
    id,
    responseId,
    createdAt,
  });
}
