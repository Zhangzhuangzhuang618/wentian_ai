import { isDeepStrictEqual } from "node:util";

import {
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTimestamp,
} from "./consumer-visible-evidence.ts";

export type SourceNominationParseReviewStatus =
  "needs_review" | "confirmed" | "rejected";

export interface SourceNominationParseReviewItem {
  readonly registrableDomain: string;
  readonly position: number | null;
  readonly informationType: string | null;
  readonly reason: string | null;
}

export interface SourceNominationParseReview {
  readonly id: string;
  readonly scopeId: string;
  readonly responseId: string;
  readonly proposedItems: readonly SourceNominationParseReviewItem[];
  readonly initialProposedItemCount: number;
  readonly extractionVersion: string;
  readonly validExplicitOccurrenceCount: number;
  readonly rejectedExplicitOccurrenceCount: number;
  readonly extractionTruncated: boolean;
  readonly status: SourceNominationParseReviewStatus;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSourceNominationParseReviewInput {
  readonly id: string;
  readonly scopeId: string;
  readonly responseId: string;
  readonly proposedItems: readonly {
    readonly registrableDomain: string;
    readonly position: number | null;
    readonly informationType?: string | null;
    readonly reason?: string | null;
  }[];
  readonly extractionVersion: string;
  readonly validExplicitOccurrenceCount: number;
  readonly rejectedExplicitOccurrenceCount: number;
  readonly extractionTruncated: boolean;
  readonly createdAt: string;
}

export interface ReviewSourceNominationParseContext {
  readonly scopeId: string;
  readonly reviewedBy: string;
  readonly expectedVersion: number;
  readonly occurredAt: string;
}

export function createSourceNominationParseReview(
  input: CreateSourceNominationParseReviewInput,
): SourceNominationParseReview {
  const createdAt = normalizeTimestamp(input.createdAt);
  const proposedItems = normalizeItems(input.proposedItems);
  assertExtractionSummary(
    proposedItems.length,
    input.validExplicitOccurrenceCount,
    input.rejectedExplicitOccurrenceCount,
    input.extractionTruncated,
  );
  return freezeReview({
    id: normalizeRequiredText(input.id, "INVALID_NOMINATION_REVIEW_ID"),
    scopeId: normalizeRequiredText(input.scopeId, "INVALID_SCOPE_ID"),
    responseId: normalizeRequiredText(input.responseId, "INVALID_RESPONSE_ID"),
    proposedItems,
    initialProposedItemCount: proposedItems.length,
    extractionVersion: normalizeBoundedRequiredText(
      input.extractionVersion,
      120,
      "INVALID_NOMINATION_EXTRACTION_VERSION",
    ),
    validExplicitOccurrenceCount: input.validExplicitOccurrenceCount,
    rejectedExplicitOccurrenceCount: input.rejectedExplicitOccurrenceCount,
    extractionTruncated: input.extractionTruncated,
    status: "needs_review",
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
}

export function confirmSourceNominationParseReview(
  review: SourceNominationParseReview,
  reviewedItems: CreateSourceNominationParseReviewInput["proposedItems"],
  context: ReviewSourceNominationParseContext,
): SourceNominationParseReview {
  assertReviewTransitionAllowed(review, context);
  const occurredAt = normalizeTimestamp(context.occurredAt);
  assertTimestampNotBefore(occurredAt, review.updatedAt);
  return freezeReview({
    ...review,
    proposedItems: normalizeItems(reviewedItems),
    status: "confirmed",
    reviewedBy: normalizeRequiredText(
      context.reviewedBy,
      "INVALID_REVIEWED_BY",
    ),
    reviewedAt: occurredAt,
    rejectionReason: null,
    version: review.version + 1,
    updatedAt: occurredAt,
  });
}

export function rejectSourceNominationParseReview(
  review: SourceNominationParseReview,
  rejectionReason: string,
  context: ReviewSourceNominationParseContext,
): SourceNominationParseReview {
  assertReviewTransitionAllowed(review, context);
  const occurredAt = normalizeTimestamp(context.occurredAt);
  assertTimestampNotBefore(occurredAt, review.updatedAt);
  return freezeReview({
    ...review,
    status: "rejected",
    reviewedBy: normalizeRequiredText(
      context.reviewedBy,
      "INVALID_REVIEWED_BY",
    ),
    reviewedAt: occurredAt,
    rejectionReason: normalizeBoundedRequiredText(
      rejectionReason,
      1_000,
      "INVALID_NOMINATION_REJECTION_REASON",
    ),
    version: review.version + 1,
    updatedAt: occurredAt,
  });
}

export function assertSourceNominationParseReviewIntegrity(
  review: SourceNominationParseReview,
): void {
  const integrityProposedItems =
    review.status === "confirmed"
      ? Array.from({ length: review.initialProposedItemCount }, (_, index) => ({
          registrableDomain: `integrity-${index + 1}.com`,
          position: index + 1,
        }))
      : review.proposedItems;
  const initial = createSourceNominationParseReview({
    id: review.id,
    scopeId: review.scopeId,
    responseId: review.responseId,
    proposedItems: integrityProposedItems,
    extractionVersion: review.extractionVersion,
    validExplicitOccurrenceCount: review.validExplicitOccurrenceCount,
    rejectedExplicitOccurrenceCount: review.rejectedExplicitOccurrenceCount,
    extractionTruncated: review.extractionTruncated,
    createdAt: review.createdAt,
  });
  const rebuilt =
    review.status === "needs_review"
      ? initial
      : review.status === "confirmed"
        ? confirmSourceNominationParseReview(initial, review.proposedItems, {
            scopeId: review.scopeId,
            reviewedBy: review.reviewedBy ?? "",
            expectedVersion: 1,
            occurredAt: review.reviewedAt ?? "",
          })
        : rejectSourceNominationParseReview(
            initial,
            review.rejectionReason ?? "",
            {
              scopeId: review.scopeId,
              reviewedBy: review.reviewedBy ?? "",
              expectedVersion: 1,
              occurredAt: review.reviewedAt ?? "",
            },
          );
  if (!isDeepStrictEqual(review, rebuilt)) {
    throw new Error("SOURCE_NOMINATION_PARSE_REVIEW_INTEGRITY_MISMATCH");
  }
}

function assertReviewTransitionAllowed(
  review: SourceNominationParseReview,
  context: ReviewSourceNominationParseContext,
): void {
  if (review.scopeId !== context.scopeId) {
    throw new Error("NOMINATION_REVIEW_SCOPE_MISMATCH");
  }
  if (review.version !== context.expectedVersion) {
    throw new Error("NOMINATION_REVIEW_VERSION_CONFLICT");
  }
  if (review.status !== "needs_review") {
    throw new Error("NOMINATION_REVIEW_TERMINAL");
  }
}

function normalizeItems(
  items: CreateSourceNominationParseReviewInput["proposedItems"],
): readonly SourceNominationParseReviewItem[] {
  if (items.length > 10) {
    throw new Error("TOO_MANY_NOMINATION_REVIEW_ITEMS");
  }
  const normalized = items.map((item) =>
    Object.freeze({
      registrableDomain: normalizeDomain(item.registrableDomain),
      position: normalizePosition(item.position),
      informationType: normalizeOptionalText(item.informationType, 500),
      reason: normalizeOptionalText(item.reason, 2_000),
    }),
  );
  assertPositionSemantics(normalized);
  return Object.freeze(normalized);
}

function assertExtractionSummary(
  initialProposedItemCount: number,
  validExplicitOccurrenceCount: number,
  rejectedExplicitOccurrenceCount: number,
  extractionTruncated: boolean,
): void {
  if (
    !Number.isInteger(validExplicitOccurrenceCount) ||
    validExplicitOccurrenceCount < 0 ||
    !Number.isInteger(rejectedExplicitOccurrenceCount) ||
    rejectedExplicitOccurrenceCount < 0
  ) {
    throw new Error("INVALID_NOMINATION_EXTRACTION_COUNTS");
  }
  if (
    (extractionTruncated &&
      (initialProposedItemCount !== 10 ||
        validExplicitOccurrenceCount <= 10)) ||
    (!extractionTruncated &&
      validExplicitOccurrenceCount !== initialProposedItemCount)
  ) {
    throw new Error("NOMINATION_EXTRACTION_SUMMARY_MISMATCH");
  }
}

function assertPositionSemantics(
  items: readonly SourceNominationParseReviewItem[],
): void {
  const positioned = items.filter((item) => item.position !== null);
  if (positioned.length > 0 && positioned.length !== items.length) {
    throw new Error("NOMINATION_POSITION_ALL_OR_NONE_REQUIRED");
  }
  if (positioned.length > 0) {
    const positions = positioned.map((item) => item.position!);
    if (
      new Set(positions).size !== positions.length ||
      positions.some((position) => position > positions.length)
    ) {
      throw new Error("INVALID_NOMINATION_POSITION_SEQUENCE");
    }
    return;
  }
  const domains = new Set<string>();
  for (const item of items) {
    if (domains.has(item.registrableDomain)) {
      throw new Error("DUPLICATE_UNORDERED_NOMINATION_DOMAIN");
    }
    domains.add(item.registrableDomain);
  }
}

function normalizePosition(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("INVALID_NOMINATION_POSITION");
  }
  return value;
}

function normalizeDomain(value: string): string {
  const normalized = normalizeRequiredText(value, "INVALID_REGISTRABLE_DOMAIN")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    normalized.includes("://") ||
    normalized.includes("/") ||
    normalized.includes(" ")
  ) {
    throw new Error("INVALID_REGISTRABLE_DOMAIN");
  }
  return normalized;
}

function normalizeBoundedRequiredText(
  value: string,
  maximumLength: number,
  errorCode: string,
): string {
  const normalized = normalizeRequiredText(value, errorCode);
  if (normalized.length > maximumLength) {
    throw new Error(errorCode);
  }
  return normalized;
}

function assertTimestampNotBefore(value: string, minimum: string): void {
  if (Date.parse(value) < Date.parse(minimum)) {
    throw new Error("NOMINATION_REVIEW_TIMESTAMP_ORDER_INVALID");
  }
}

function freezeReview(
  review: SourceNominationParseReview,
): SourceNominationParseReview {
  return Object.freeze(review);
}
