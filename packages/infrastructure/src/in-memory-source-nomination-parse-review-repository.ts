import type {
  AiVisibilityNominatedSourceEventRepository,
  SourceNominationParseReviewConfirmationCommit,
  SourceNominationParseReviewRejectionCommit,
  SourceNominationParseReviewRepository,
  SourceNominationParseReviewTransactionRepository,
} from "@wentian/application";
import {
  assertConfirmedConsumerObservationRecordIntegrity,
  assertSourceNominationParseReviewIntegrity,
  type AiVisibilityNominatedSourceEvent,
  type SourceNominationParseReview,
  type SourceNominationParseReviewStatus,
} from "@wentian/domain";

import { assertProjectedNominatedSourceEventIntegrity } from "./source-nomination-event-projection.ts";
import { normalizeSourceRegistrableDomain } from "./source-key-hash.ts";

export class InMemorySourceNominationParseReviewRepository
  implements
    SourceNominationParseReviewRepository,
    AiVisibilityNominatedSourceEventRepository,
    SourceNominationParseReviewTransactionRepository
{
  private readonly reviews = new Map<string, SourceNominationParseReview>();
  private readonly reviewIdByResponse = new Map<string, string>();
  private readonly sourceEvents = new Map<
    string,
    AiVisibilityNominatedSourceEvent
  >();
  private readonly sourceEventIdByUniqueKey = new Map<string, string>();

  async create(review: SourceNominationParseReview): Promise<void> {
    assertSourceNominationParseReviewIntegrity(review);
    const responseKey = sourceNominationReviewResponseKey(review);
    if (
      this.reviews.has(review.id) ||
      this.reviewIdByResponse.has(responseKey)
    ) {
      throw new Error("SOURCE_NOMINATION_PARSE_REVIEW_CONFLICT");
    }
    this.reviews.set(review.id, review);
    this.reviewIdByResponse.set(responseKey, review.id);
  }

  async findById(
    scopeId: string,
    reviewId: string,
  ): Promise<SourceNominationParseReview | null> {
    const review = this.reviews.get(reviewId);
    return review?.scopeId === scopeId ? review : null;
  }

  async findByResponseId(
    scopeId: string,
    responseId: string,
  ): Promise<SourceNominationParseReview | null> {
    const reviewId = this.reviewIdByResponse.get(
      JSON.stringify([scopeId, responseId]),
    );
    return reviewId ? (this.reviews.get(reviewId) ?? null) : null;
  }

  async listByStatus(
    scopeId: string,
    status: SourceNominationParseReviewStatus,
  ): Promise<readonly SourceNominationParseReview[]> {
    return [...this.reviews.values()]
      .filter(
        (review) => review.scopeId === scopeId && review.status === status,
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async save(
    review: SourceNominationParseReview,
    expectedVersion: number,
  ): Promise<SourceNominationParseReview> {
    assertSourceNominationParseReviewIntegrity(review);
    const current = this.reviews.get(review.id);
    assertReviewSaveAllowed(current, review, expectedVersion);
    this.reviews.set(review.id, review);
    return review;
  }

  async createMany(
    events: readonly AiVisibilityNominatedSourceEvent[],
  ): Promise<void> {
    assertNewNominatedSourceEvents(
      events,
      this.sourceEvents,
      this.sourceEventIdByUniqueKey,
    );
    this.storeSourceEvents(events);
  }

  async listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityNominatedSourceEvent[]> {
    return [...this.sourceEvents.values()]
      .filter(
        (event) => event.scopeId === scopeId && event.responseId === responseId,
      )
      .sort(
        (left, right) =>
          (left.sourcePosition ?? Number.MAX_SAFE_INTEGER) -
            (right.sourcePosition ?? Number.MAX_SAFE_INTEGER) ||
          left.id.localeCompare(right.id),
      );
  }

  async commitConfirmation(
    input: SourceNominationParseReviewConfirmationCommit,
  ): Promise<void> {
    assertSourceNominationParseReviewIntegrity(input.review);
    const current = this.reviews.get(input.review.id);
    assertReviewSaveAllowed(current, input.review, input.expectedReviewVersion);
    assertNominationConfirmationEventBindings(
      input.review,
      input.response,
      input.sourceEvents,
    );
    assertNewNominatedSourceEvents(
      input.sourceEvents,
      this.sourceEvents,
      this.sourceEventIdByUniqueKey,
    );

    this.reviews.set(input.review.id, input.review);
    this.storeSourceEvents(input.sourceEvents);
  }

  async commitRejection(
    input: SourceNominationParseReviewRejectionCommit,
  ): Promise<void> {
    assertSourceNominationParseReviewIntegrity(input.review);
    assertConfirmedConsumerObservationRecordIntegrity(input.response);
    const current = this.reviews.get(input.review.id);
    assertReviewSaveAllowed(current, input.review, input.expectedReviewVersion);
    if (
      input.review.status !== "rejected" ||
      input.review.scopeId !== input.response.scopeId ||
      input.review.responseId !== input.response.id
    ) {
      throw new Error("SOURCE_NOMINATION_REJECTION_BINDING_MISMATCH");
    }
    if (
      [...this.sourceEvents.values()].some(
        (event) =>
          event.scopeId === input.review.scopeId &&
          event.responseId === input.review.responseId,
      )
    ) {
      throw new Error("SOURCE_NOMINATION_REJECTION_HAS_SOURCE_EVENTS");
    }
    this.reviews.set(input.review.id, input.review);
  }

  private storeSourceEvents(
    events: readonly AiVisibilityNominatedSourceEvent[],
  ): void {
    for (const event of events) {
      this.sourceEvents.set(event.id, event);
      this.sourceEventIdByUniqueKey.set(
        nominatedSourceEventUniqueKey(event),
        event.id,
      );
    }
  }
}

function sourceNominationReviewResponseKey(
  review: SourceNominationParseReview,
): string {
  return JSON.stringify([review.scopeId, review.responseId]);
}

function assertReviewSaveAllowed(
  current: SourceNominationParseReview | undefined,
  review: SourceNominationParseReview,
  expectedVersion: number,
): void {
  if (!current || current.scopeId !== review.scopeId) {
    throw new Error("SOURCE_NOMINATION_PARSE_REVIEW_NOT_FOUND");
  }
  if (
    current.version !== expectedVersion ||
    review.version !== expectedVersion + 1
  ) {
    throw new Error("SOURCE_NOMINATION_PARSE_REVIEW_VERSION_CONFLICT");
  }
  if (
    current.responseId !== review.responseId ||
    current.createdAt !== review.createdAt ||
    current.initialProposedItemCount !== review.initialProposedItemCount ||
    current.extractionVersion !== review.extractionVersion ||
    current.validExplicitOccurrenceCount !==
      review.validExplicitOccurrenceCount ||
    current.rejectedExplicitOccurrenceCount !==
      review.rejectedExplicitOccurrenceCount ||
    current.extractionTruncated !== review.extractionTruncated
  ) {
    throw new Error("SOURCE_NOMINATION_PARSE_REVIEW_IDENTITY_MISMATCH");
  }
  if (current.status !== "needs_review" || review.status === "needs_review") {
    throw new Error("SOURCE_NOMINATION_PARSE_REVIEW_TRANSITION_INVALID");
  }
}

function assertNewNominatedSourceEvents(
  events: readonly AiVisibilityNominatedSourceEvent[],
  storedEvents: ReadonlyMap<string, AiVisibilityNominatedSourceEvent>,
  storedEventIdByUniqueKey: ReadonlyMap<string, string>,
): void {
  const newIds = new Set<string>();
  const newKeys = new Set<string>();
  for (const event of events) {
    assertProjectedNominatedSourceEventIntegrity(event);
    const uniqueKey = nominatedSourceEventUniqueKey(event);
    if (
      newIds.has(event.id) ||
      newKeys.has(uniqueKey) ||
      storedEvents.has(event.id) ||
      storedEventIdByUniqueKey.has(uniqueKey)
    ) {
      throw new Error("AI_VISIBILITY_NOMINATED_SOURCE_EVENT_CONFLICT");
    }
    newIds.add(event.id);
    newKeys.add(uniqueKey);
  }
}

function assertNominationConfirmationEventBindings(
  review: SourceNominationParseReview,
  response: SourceNominationParseReviewConfirmationCommit["response"],
  events: readonly AiVisibilityNominatedSourceEvent[],
): void {
  assertConfirmedConsumerObservationRecordIntegrity(response);
  if (
    review.status !== "confirmed" ||
    !review.reviewedAt ||
    response.scopeId !== review.scopeId ||
    response.id !== review.responseId ||
    events.length !== review.proposedItems.length
  ) {
    throw new Error("SOURCE_NOMINATION_CONFIRMATION_EVENT_SET_MISMATCH");
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const item = review.proposedItems[index]!;
    if (
      event.scopeId !== review.scopeId ||
      event.responseId !== review.responseId ||
      event.runId !== response.runId ||
      event.querySnapshotItemId !== response.querySnapshotItemId ||
      event.sampleIndex !== response.sampleIndex ||
      event.nominationValidationMethod !== "human_confirmed" ||
      event.registrableDomain !==
        normalizeSourceRegistrableDomain(item.registrableDomain) ||
      event.sourcePosition !== item.position ||
      event.nominationInformationType !== item.informationType ||
      event.nominationReason !== item.reason ||
      event.createdAt !== review.reviewedAt
    ) {
      throw new Error("SOURCE_NOMINATION_CONFIRMATION_EVENT_BINDING_MISMATCH");
    }
  }
}

function nominatedSourceEventUniqueKey(
  event: AiVisibilityNominatedSourceEvent,
): string {
  return JSON.stringify([
    event.scopeId,
    event.responseId,
    event.role,
    event.sourceKeyHash,
    event.sourcePosition,
  ]);
}
