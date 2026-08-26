import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmSourceNominationReviewInputSchema,
  confirmSourceNominationReviewResponseSchema,
  listSourceNominationReviewsInputSchema,
  rejectSourceNominationReviewInputSchema,
  rejectSourceNominationReviewResponseSchema,
  SOURCE_NOMINATION_REVIEW_API_ROUTES,
  SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION,
  sourceNominationReviewPathSchema,
  toSourceNominationReviewDto,
} from "../src/index.ts";

const ids = {
  review: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  response: "31111111-1111-4111-8111-111111111111",
  user: "41111111-1111-4111-8111-111111111111",
} as const;

test("复核路由和输入契约只接受批准的最小字段", () => {
  assert.deepEqual(SOURCE_NOMINATION_REVIEW_API_ROUTES, {
    list: "/ai-visibility/nomination-reviews",
    confirm: "/ai-visibility/nomination-reviews/{id}/confirm",
    reject: "/ai-visibility/nomination-reviews/{id}/reject",
  });
  assert.deepEqual(sourceNominationReviewPathSchema.parse({ id: ids.review }), {
    id: ids.review,
  });
  assert.deepEqual(
    listSourceNominationReviewsInputSchema.parse({
      scope_id: ids.scope,
      status: "needs_review",
    }),
    { scope_id: ids.scope, status: "needs_review" },
  );
});

test("确认输入接受最多10个显式域名并拒绝归属、URL和来源键", () => {
  const input = confirmInput();
  assert.deepEqual(
    confirmSourceNominationReviewInputSchema.parse(input),
    input,
  );

  for (const forbidden of [
    { response_id: ids.response },
    { run_id: ids.review },
    { query_snapshot_item_id: ids.review },
    { sample_index: 1 },
    { role: "nominated" },
    { source_key_hash: "a".repeat(64) },
    { url: "https://example.com" },
  ]) {
    assert.throws(() =>
      confirmSourceNominationReviewInputSchema.parse({
        ...input,
        ...forbidden,
      }),
    );
  }
  assert.throws(() =>
    confirmSourceNominationReviewInputSchema.parse({
      ...input,
      reviewed_items: Array.from({ length: 11 }, () => input.reviewed_items[0]),
    }),
  );
  assert.throws(() =>
    confirmSourceNominationReviewInputSchema.parse({
      ...input,
      reviewed_items: [item("https://example.com/path", 1)],
    }),
  );
});

test("确认输入拒绝混合顺序、非连续顺序和重复无序域名", () => {
  for (const reviewedItems of [
    [item("example.com", 1), item("example.org", null)],
    [item("example.com", 1), item("example.org", 3)],
    [item("example.com", null), item("EXAMPLE.COM.", null)],
  ]) {
    assert.throws(() =>
      confirmSourceNominationReviewInputSchema.parse({
        ...confirmInput(),
        reviewed_items: reviewedItems,
      }),
    );
  }
});

test("拒绝输入只允许版本和有界原因", () => {
  const input = {
    scope_id: ids.scope,
    review_version: 1,
    rejection_reason: "回答未显式给出可核验域名",
  } as const;
  assert.deepEqual(rejectSourceNominationReviewInputSchema.parse(input), input);
  assert.throws(() =>
    rejectSourceNominationReviewInputSchema.parse({
      ...input,
      source_event_ids: [],
    }),
  );
  assert.throws(() =>
    rejectSourceNominationReviewInputSchema.parse({
      ...input,
      rejection_reason: " ",
    }),
  );
});

test("领域复核可适配为严格snake_case读模型", () => {
  const confirmed = toSourceNominationReviewDto({
    id: ids.review,
    scopeId: ids.scope,
    responseId: ids.response,
    proposedItems: [
      {
        registrableDomain: "example.com",
        position: 1,
        informationType: "官方信息",
        reason: "人工核对",
      },
    ],
    initialProposedItemCount: 1,
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 1,
    rejectedExplicitOccurrenceCount: 0,
    extractionTruncated: false,
    status: "confirmed",
    reviewedBy: ids.user,
    reviewedAt: "2026-08-22T12:02:00.000Z",
    rejectionReason: null,
    version: 2,
    createdAt: "2026-08-22T12:01:00.000Z",
    updatedAt: "2026-08-22T12:02:00.000Z",
  });

  assert.equal(confirmed.scope_id, ids.scope);
  assert.equal(confirmed.proposed_items[0]?.registrable_domain, "example.com");
  assert.deepEqual(
    confirmSourceNominationReviewResponseSchema.parse({
      contract_version: SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION,
      review: confirmed,
      nominated_event_count: 1,
    }).review,
    confirmed,
  );
  assert.throws(() =>
    confirmSourceNominationReviewResponseSchema.parse({
      contract_version: SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION,
      review: confirmed,
      nominated_event_count: 0,
    }),
  );
  assert.throws(() =>
    confirmSourceNominationReviewResponseSchema.parse({
      contract_version: SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION,
      review: { ...confirmed, version: 3 },
      nominated_event_count: 1,
    }),
  );
});

test("拒绝响应固定零事件并拒绝伪装确认状态", () => {
  const rejected = toSourceNominationReviewDto({
    id: ids.review,
    scopeId: ids.scope,
    responseId: ids.response,
    proposedItems: [],
    initialProposedItemCount: 0,
    extractionVersion: "test-explicit@1",
    validExplicitOccurrenceCount: 0,
    rejectedExplicitOccurrenceCount: 1,
    extractionTruncated: false,
    status: "rejected",
    reviewedBy: ids.user,
    reviewedAt: "2026-08-22T12:02:00.000Z",
    rejectionReason: "无法确认域名",
    version: 2,
    createdAt: "2026-08-22T12:01:00.000Z",
    updatedAt: "2026-08-22T12:02:00.000Z",
  });
  assert.equal(
    rejectSourceNominationReviewResponseSchema.parse({
      contract_version: SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION,
      review: rejected,
      nominated_event_count: 0,
    }).review.status,
    "rejected",
  );
  assert.throws(() =>
    rejectSourceNominationReviewResponseSchema.parse({
      contract_version: SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION,
      review: rejected,
      nominated_event_count: 1,
    }),
  );
});

function confirmInput() {
  return {
    scope_id: ids.scope,
    review_version: 1,
    reviewed_items: [item("example.com", 1)],
  };
}

function item(registrableDomain: string, position: number | null) {
  return {
    registrable_domain: registrableDomain,
    position,
    information_type: "官方信息",
    reason: "核验公开资料",
  };
}
