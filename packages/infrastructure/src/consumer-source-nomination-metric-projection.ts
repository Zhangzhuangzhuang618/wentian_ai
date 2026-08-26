import {
  assertConsumerSourceNominationResponseRunBindings,
  type ConsumerSourceNominationMetricSampleProjector,
} from "@wentian/application";
import {
  assertConfirmedConsumerObservationRecordIntegrity,
  assertSourceNominationParseReviewIntegrity,
  type AiVisibilityNominatedSourceEvent,
  type SourceNominationMetricItem,
  type SourceNominationMetricSample,
  type SourceNominationParseReview,
} from "@wentian/domain";

import { normalizeSourceRegistrableDomain } from "./source-key-hash.ts";
import { assertProjectedNominatedSourceEventIntegrity } from "./source-nomination-event-projection.ts";
import { SOURCE_URL_NORMALIZATION_VERSION } from "./source-url-normalization.ts";

export class ConfirmedConsumerSourceNominationMetricSampleProjector implements ConsumerSourceNominationMetricSampleProjector {
  readonly normalizationVersion = SOURCE_URL_NORMALIZATION_VERSION;

  project(
    input: Parameters<
      ConsumerSourceNominationMetricSampleProjector["project"]
    >[0],
  ): SourceNominationMetricSample {
    const { run, response, review, sourceEvents } = input;
    assertConfirmedConsumerObservationRecordIntegrity(response);
    assertSourceNominationParseReviewIntegrity(review);
    assertConsumerSourceNominationResponseRunBindings(response, run);
    if (
      review.scopeId !== response.scopeId ||
      review.responseId !== response.id
    ) {
      throw new Error("SOURCE_NOMINATION_METRIC_REVIEW_BINDING_MISMATCH");
    }

    if (review.status !== "confirmed") {
      if (sourceEvents.length > 0) {
        throw new Error("UNVALIDATED_NOMINATION_EVENTS_FORBIDDEN");
      }
      return freezeSample({
        id: response.id,
        querySnapshotItemId: response.querySnapshotItemId,
        nominationContext: run.nominationContext!,
        validationStatus: review.status,
        nominations: [],
      });
    }

    assertCompleteConfirmedEventSet(response, review, sourceEvents);
    const nominations = [...sourceEvents].sort(compareEvents).map((event) =>
      Object.freeze({
        registrableDomain: event.registrableDomain,
        position: event.sourcePosition,
      }),
    );
    return freezeSample({
      id: response.id,
      querySnapshotItemId: response.querySnapshotItemId,
      nominationContext: run.nominationContext!,
      validationStatus: "human_confirmed",
      nominations,
    });
  }
}

function assertCompleteConfirmedEventSet(
  response: Parameters<
    ConsumerSourceNominationMetricSampleProjector["project"]
  >[0]["response"],
  review: SourceNominationParseReview,
  sourceEvents: readonly AiVisibilityNominatedSourceEvent[],
): void {
  if (sourceEvents.length !== review.proposedItems.length) {
    throw new Error("SOURCE_NOMINATION_METRIC_EVENT_COUNT_MISMATCH");
  }
  const reviewItems = new Map(
    review.proposedItems.map((item) => {
      const key = itemKey(item.registrableDomain, item.position);
      return [key, item] as const;
    }),
  );
  if (reviewItems.size !== review.proposedItems.length) {
    throw new Error("SOURCE_NOMINATION_METRIC_DUPLICATE_REVIEW_ITEM");
  }

  const eventIds = new Set<string>();
  const eventKeys = new Set<string>();
  for (const event of sourceEvents) {
    assertProjectedNominatedSourceEventIntegrity(event);
    if (eventIds.has(event.id)) {
      throw new Error("SOURCE_NOMINATION_METRIC_DUPLICATE_EVENT_ID");
    }
    eventIds.add(event.id);
    if (
      event.scopeId !== response.scopeId ||
      event.runId !== response.runId ||
      event.responseId !== response.id ||
      event.querySnapshotItemId !== response.querySnapshotItemId ||
      event.sampleIndex !== response.sampleIndex ||
      event.nominationValidationMethod !== "human_confirmed" ||
      event.createdAt !== review.reviewedAt
    ) {
      throw new Error("SOURCE_NOMINATION_METRIC_EVENT_BINDING_MISMATCH");
    }

    const key = itemKey(event.registrableDomain, event.sourcePosition);
    if (eventKeys.has(key)) {
      throw new Error("SOURCE_NOMINATION_METRIC_DUPLICATE_EVENT_ITEM");
    }
    eventKeys.add(key);
    const reviewItem = reviewItems.get(key);
    if (
      !reviewItem ||
      reviewItem.informationType !== event.nominationInformationType ||
      reviewItem.reason !== event.nominationReason
    ) {
      throw new Error("SOURCE_NOMINATION_METRIC_EVENT_REVIEW_MISMATCH");
    }
  }
  if (eventKeys.size !== reviewItems.size) {
    throw new Error("SOURCE_NOMINATION_METRIC_EVENT_SET_MISMATCH");
  }
}

function itemKey(registrableDomain: string, position: number | null): string {
  return JSON.stringify([
    normalizeSourceRegistrableDomain(registrableDomain),
    position,
  ]);
}

function compareEvents(
  left: AiVisibilityNominatedSourceEvent,
  right: AiVisibilityNominatedSourceEvent,
): number {
  return (
    (left.sourcePosition ?? Number.MAX_SAFE_INTEGER) -
      (right.sourcePosition ?? Number.MAX_SAFE_INTEGER) ||
    left.registrableDomain.localeCompare(right.registrableDomain) ||
    left.id.localeCompare(right.id)
  );
}

function freezeSample(
  sample: Omit<SourceNominationMetricSample, "nominations"> & {
    readonly nominations: readonly SourceNominationMetricItem[];
  },
): SourceNominationMetricSample {
  return Object.freeze({
    ...sample,
    nominations: Object.freeze(sample.nominations),
  });
}
