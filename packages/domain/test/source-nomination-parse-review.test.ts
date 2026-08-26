import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSourceNominationParseReviewIntegrity,
  confirmSourceNominationParseReview,
  createSourceNominationParseReview,
  rejectSourceNominationParseReview,
} from "../src/index.ts";

const ids = {
  review: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  response: "31111111-1111-4111-8111-111111111111",
  user: "41111111-1111-4111-8111-111111111111",
};

test("创建不可变needs_review记录并规范化最多10个显式域名", () => {
  const review = createReview();

  assert.equal(review.status, "needs_review");
  assert.equal(review.version, 1);
  assert.equal(review.initialProposedItemCount, 1);
  assert.equal(review.extractionVersion, "test-explicit@1");
  assert.equal(review.proposedItems[0].registrableDomain, "example.com");
  assert.equal(review.reviewedBy, null);
  assert.ok(Object.isFrozen(review));
  assert.ok(Object.isFrozen(review.proposedItems));
  assert.doesNotThrow(() => assertSourceNominationParseReviewIntegrity(review));
});

test("人工确认可以修订项目并进入不可逆终态", () => {
  const initial = createReview();
  const confirmed = confirmSourceNominationParseReview(
    initial,
    [
      {
        registrableDomain: "example.org",
        position: null,
        informationType: "消费者评价",
        reason: "人工复核后的显式域名",
      },
      {
        registrableDomain: "example.net",
        position: null,
        informationType: null,
        reason: "人工补充的显式域名",
      },
    ],
    context(),
  );

  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.version, 2);
  assert.equal(confirmed.proposedItems[0].registrableDomain, "example.org");
  assert.equal(confirmed.proposedItems.length, 2);
  assert.equal(confirmed.initialProposedItemCount, 1);
  assert.equal(confirmed.validExplicitOccurrenceCount, 1);
  assert.equal(confirmed.reviewedBy, ids.user);
  assert.equal(confirmed.reviewedAt, "2026-08-22T12:01:00.000Z");
  assert.equal(confirmed.rejectionReason, null);
  assert.doesNotThrow(() =>
    assertSourceNominationParseReviewIntegrity(confirmed),
  );
  assert.throws(() =>
    confirmSourceNominationParseReview(confirmed, [], {
      ...context(),
      expectedVersion: 2,
    }),
  );
});

test("拒绝只保存原因且不能再次确认", () => {
  const rejected = rejectSourceNominationParseReview(
    createReview(),
    "无法确认文本中的域名归属",
    context(),
  );

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, "无法确认文本中的域名归属");
  assert.equal(rejected.version, 2);
  assert.doesNotThrow(() =>
    assertSourceNominationParseReviewIntegrity(rejected),
  );
  assert.throws(() =>
    confirmSourceNominationParseReview(rejected, [], {
      ...context(),
      expectedVersion: 2,
    }),
  );
});

test("scope、版本、时间和拒绝原因失败关闭", () => {
  const review = createReview();
  assert.throws(() =>
    confirmSourceNominationParseReview(review, [], {
      ...context(),
      scopeId: "other-scope",
    }),
  );
  assert.throws(() =>
    confirmSourceNominationParseReview(review, [], {
      ...context(),
      expectedVersion: 2,
    }),
  );
  assert.throws(() =>
    confirmSourceNominationParseReview(review, [], {
      ...context(),
      occurredAt: "2026-08-22T11:59:59.000Z",
    }),
  );
  assert.throws(() =>
    rejectSourceNominationParseReview(review, " ", context()),
  );
});

test("混合顺序、非连续顺序、重复无序域名和额外字段被拒绝", () => {
  for (const proposedItems of [
    [
      { registrableDomain: "example.com", position: 1 },
      { registrableDomain: "example.org", position: null },
    ],
    [
      { registrableDomain: "example.com", position: 1 },
      { registrableDomain: "example.org", position: 3 },
    ],
    [
      { registrableDomain: "example.com", position: null },
      { registrableDomain: "EXAMPLE.COM", position: null },
    ],
  ]) {
    assert.throws(() =>
      createSourceNominationParseReview({
        ...baseInput(),
        proposedItems,
      }),
    );
  }

  const review = createReview();
  assert.throws(() =>
    assertSourceNominationParseReviewIntegrity({
      ...review,
      cookie: "session=secret",
    } as never),
  );
  assert.throws(() =>
    assertSourceNominationParseReviewIntegrity({
      ...review,
      initialProposedItemCount: 2,
    }),
  );
});

function createReview() {
  return createSourceNominationParseReview(baseInput());
}

function baseInput() {
  return {
    id: ids.review,
    scopeId: ids.scope,
    responseId: ids.response,
    proposedItems: [
      {
        registrableDomain: "Example.COM.",
        position: 1,
        informationType: "官方资料",
        reason: "文本中明确列出",
      },
    ],
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    createdAt: "2026-08-22T12:00:00.000Z",
  };
}

function context() {
  return {
    scopeId: ids.scope,
    reviewedBy: ids.user,
    expectedVersion: 1,
    occurredAt: "2026-08-22T12:01:00.000Z",
  };
}
