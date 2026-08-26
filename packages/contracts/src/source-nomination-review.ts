import { z } from "zod";

export const SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION =
  "wentian-source-nomination-review@0-draft" as const;

export const SOURCE_NOMINATION_REVIEW_API_ROUTES = Object.freeze({
  list: "/ai-visibility/nomination-reviews",
  confirm: "/ai-visibility/nomination-reviews/{id}/confirm",
  reject: "/ai-visibility/nomination-reviews/{id}/reject",
} as const);

export const sourceNominationReviewStatusSchema = z.enum([
  "needs_review",
  "confirmed",
  "rejected",
]);

export const sourceNominationReviewPathSchema = z
  .object({ id: z.uuid() })
  .strict();

export const listSourceNominationReviewsInputSchema = z
  .object({
    scope_id: z.uuid(),
    status: sourceNominationReviewStatusSchema,
  })
  .strict();

export const sourceNominationReviewIdempotencySchema = z
  .object({ idempotency_key: z.string().trim().min(1).max(200) })
  .strict();

export const sourceNominationReviewItemSchema = z
  .object({
    registrable_domain: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine(
        (value) =>
          !value.includes("://") && !value.includes("/") && !/\s/.test(value),
        "INVALID_REGISTRABLE_DOMAIN",
      ),
    position: z.number().int().positive().nullable(),
    information_type: z.string().trim().min(1).max(500).nullable(),
    reason: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const confirmSourceNominationReviewInputSchema = z
  .object({
    scope_id: z.uuid(),
    review_version: z.number().int().positive(),
    reviewed_items: z.array(sourceNominationReviewItemSchema).max(10),
  })
  .strict()
  .superRefine((input, context) => {
    assertReviewItemSemantics(input.reviewed_items, context, [
      "reviewed_items",
    ]);
  });

export const rejectSourceNominationReviewInputSchema = z
  .object({
    scope_id: z.uuid(),
    review_version: z.number().int().positive(),
    rejection_reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const sourceNominationReviewDtoSchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    response_id: z.uuid(),
    proposed_items: z.array(sourceNominationReviewItemSchema).max(10),
    initial_proposed_item_count: z.number().int().min(0).max(10),
    extraction_version: z.string().trim().min(1).max(120),
    valid_explicit_occurrence_count: z.number().int().nonnegative(),
    rejected_explicit_occurrence_count: z.number().int().nonnegative(),
    extraction_truncated: z.boolean(),
    status: sourceNominationReviewStatusSchema,
    reviewed_by: z.uuid().nullable(),
    reviewed_at: z.iso.datetime({ offset: true }).nullable(),
    rejection_reason: z.string().min(1).max(1_000).nullable(),
    version: z.number().int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((review, context) => {
    assertReviewItemSemantics(review.proposed_items, context, [
      "proposed_items",
    ]);
    if (
      (review.extraction_truncated &&
        (review.initial_proposed_item_count !== 10 ||
          review.valid_explicit_occurrence_count <= 10)) ||
      (!review.extraction_truncated &&
        review.valid_explicit_occurrence_count !==
          review.initial_proposed_item_count) ||
      (review.status !== "confirmed" &&
        review.proposed_items.length !== review.initial_proposed_item_count)
    ) {
      context.addIssue({
        code: "custom",
        path: ["valid_explicit_occurrence_count"],
        message: "NOMINATION_EXTRACTION_SUMMARY_MISMATCH",
      });
    }
    if (
      (review.status === "needs_review" &&
        (review.reviewed_by !== null ||
          review.reviewed_at !== null ||
          review.rejection_reason !== null ||
          review.version !== 1 ||
          review.updated_at !== review.created_at)) ||
      (review.status === "confirmed" &&
        (review.reviewed_by === null ||
          review.reviewed_at === null ||
          review.rejection_reason !== null ||
          review.version !== 2 ||
          review.updated_at !== review.reviewed_at)) ||
      (review.status === "rejected" &&
        (review.reviewed_by === null ||
          review.reviewed_at === null ||
          review.rejection_reason === null ||
          review.version !== 2 ||
          review.updated_at !== review.reviewed_at)) ||
      Date.parse(review.updated_at) < Date.parse(review.created_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "SOURCE_NOMINATION_REVIEW_STATE_MISMATCH",
      });
    }
  });

export const listSourceNominationReviewsResponseSchema = z
  .object({
    contract_version: z.literal(SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION),
    reviews: z.array(sourceNominationReviewDtoSchema),
  })
  .strict();

export const confirmSourceNominationReviewResponseSchema = z
  .object({
    contract_version: z.literal(SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION),
    review: sourceNominationReviewDtoSchema,
    nominated_event_count: z.number().int().nonnegative().max(10),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.review.status !== "confirmed" ||
      response.nominated_event_count !== response.review.proposed_items.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["nominated_event_count"],
        message: "SOURCE_NOMINATION_CONFIRMATION_COUNT_MISMATCH",
      });
    }
  });

export const rejectSourceNominationReviewResponseSchema = z
  .object({
    contract_version: z.literal(SOURCE_NOMINATION_REVIEW_CONTRACT_VERSION),
    review: sourceNominationReviewDtoSchema,
    nominated_event_count: z.literal(0),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.review.status !== "rejected") {
      context.addIssue({
        code: "custom",
        path: ["review", "status"],
        message: "REJECTED_SOURCE_NOMINATION_REVIEW_REQUIRED",
      });
    }
  });

export interface SourceNominationParseReviewLike {
  readonly id: string;
  readonly scopeId: string;
  readonly responseId: string;
  readonly proposedItems: readonly {
    readonly registrableDomain: string;
    readonly position: number | null;
    readonly informationType: string | null;
    readonly reason: string | null;
  }[];
  readonly initialProposedItemCount: number;
  readonly extractionVersion: string;
  readonly validExplicitOccurrenceCount: number;
  readonly rejectedExplicitOccurrenceCount: number;
  readonly extractionTruncated: boolean;
  readonly status: "needs_review" | "confirmed" | "rejected";
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toSourceNominationReviewDto(
  review: SourceNominationParseReviewLike,
): SourceNominationReviewDto {
  return sourceNominationReviewDtoSchema.parse({
    id: review.id,
    scope_id: review.scopeId,
    response_id: review.responseId,
    proposed_items: review.proposedItems.map((item) => ({
      registrable_domain: item.registrableDomain,
      position: item.position,
      information_type: item.informationType,
      reason: item.reason,
    })),
    initial_proposed_item_count: review.initialProposedItemCount,
    extraction_version: review.extractionVersion,
    valid_explicit_occurrence_count: review.validExplicitOccurrenceCount,
    rejected_explicit_occurrence_count: review.rejectedExplicitOccurrenceCount,
    extraction_truncated: review.extractionTruncated,
    status: review.status,
    reviewed_by: review.reviewedBy,
    reviewed_at: review.reviewedAt,
    rejection_reason: review.rejectionReason,
    version: review.version,
    created_at: review.createdAt,
    updated_at: review.updatedAt,
  });
}

function assertReviewItemSemantics(
  items: readonly z.infer<typeof sourceNominationReviewItemSchema>[],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const positioned = items.filter((item) => item.position !== null);
  if (positioned.length > 0 && positioned.length !== items.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "NOMINATION_POSITION_ALL_OR_NONE_REQUIRED",
    });
    return;
  }
  if (positioned.length > 0) {
    const positions = positioned.map((item) => item.position!);
    if (
      new Set(positions).size !== positions.length ||
      positions.some((position) => position > positions.length)
    ) {
      context.addIssue({
        code: "custom",
        path,
        message: "INVALID_NOMINATION_POSITION_SEQUENCE",
      });
    }
    return;
  }
  const domains = items.map((item) =>
    item.registrable_domain.toLowerCase().replace(/\.$/, ""),
  );
  if (new Set(domains).size !== domains.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "DUPLICATE_UNORDERED_NOMINATION_DOMAIN",
    });
  }
}

export type ListSourceNominationReviewsInputDto = z.infer<
  typeof listSourceNominationReviewsInputSchema
>;
export type ConfirmSourceNominationReviewInputDto = z.infer<
  typeof confirmSourceNominationReviewInputSchema
>;
export type RejectSourceNominationReviewInputDto = z.infer<
  typeof rejectSourceNominationReviewInputSchema
>;
export type SourceNominationReviewDto = z.infer<
  typeof sourceNominationReviewDtoSchema
>;
