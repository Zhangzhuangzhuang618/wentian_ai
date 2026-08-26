import {
  assertAiVisibilityCitedSourceEventIntegrity,
  assertConfirmedConsumerObservationRecordIntegrity,
  createAiVisibilityCitedSourceEvent,
  type AiVisibilityCitedSourceEvent,
  type ConfirmedConsumerObservationRecord,
} from "@wentian/domain";

import { deriveSourceKeyHash } from "./source-key-hash.ts";
import { normalizeSourceUrl } from "./source-url-normalization.ts";

export interface ProjectConfirmedConsumerObservationSourceEventsInput {
  readonly record: ConfirmedConsumerObservationRecord;
  readonly newId: () => string;
  readonly createdAt: string;
}

export class ConfirmedConsumerObservationSourceEventProjector {
  project(
    input: ProjectConfirmedConsumerObservationSourceEventsInput,
  ): readonly AiVisibilityCitedSourceEvent[] {
    return projectConfirmedConsumerObservationToCitedSourceEvents(input);
  }
}

export function assertProjectedCitedSourceEventIntegrity(
  event: AiVisibilityCitedSourceEvent,
): void {
  assertAiVisibilityCitedSourceEventIntegrity(event);
  const normalizedSource = normalizeSourceUrl(event.originalUrl);
  if (
    normalizedSource.status !== "normalized" ||
    normalizedSource.normalizedUrl !== event.normalizedUrl ||
    normalizedSource.host !== event.host ||
    normalizedSource.registrableDomain !== event.registrableDomain ||
    normalizedSource.normalizationVersion !== event.normalizationVersion
  ) {
    throw new Error("AI_VISIBILITY_SOURCE_EVENT_NORMALIZATION_MISMATCH");
  }
  const sourceKey = deriveSourceKeyHash({ normalizedSource });
  if (sourceKey.sourceKeyHash !== event.sourceKeyHash) {
    throw new Error("AI_VISIBILITY_SOURCE_EVENT_KEY_HASH_MISMATCH");
  }
}

export function projectConfirmedConsumerObservationToCitedSourceEvents(
  input: ProjectConfirmedConsumerObservationSourceEventsInput,
): readonly AiVisibilityCitedSourceEvent[] {
  assertConfirmedConsumerObservationRecordIntegrity(input.record);
  if (input.createdAt !== input.record.confirmedAt) {
    throw new Error("SOURCE_EVENT_CONFIRMATION_TIME_MISMATCH");
  }

  const events: AiVisibilityCitedSourceEvent[] = [];
  for (const citation of input.record.visibleCitations) {
    const normalizedSource = normalizeSourceUrl(citation.url);
    if (normalizedSource.status !== "normalized") {
      continue;
    }
    const sourceKey = deriveSourceKeyHash({ normalizedSource });
    events.push(
      createAiVisibilityCitedSourceEvent({
        id: input.newId(),
        scopeId: input.record.scopeId,
        runId: input.record.runId,
        responseId: input.record.id,
        querySnapshotItemId: input.record.querySnapshotItemId,
        sampleIndex: input.record.sampleIndex,
        sourcePosition: citation.position,
        originalUrl: normalizedSource.originalUrl,
        normalizedUrl: normalizedSource.normalizedUrl,
        sourceKeyHash: sourceKey.sourceKeyHash,
        host: normalizedSource.host,
        registrableDomain: normalizedSource.registrableDomain,
        title: citation.label,
        normalizationVersion: normalizedSource.normalizationVersion,
        createdAt: input.createdAt,
      }),
    );
  }
  return Object.freeze(events);
}
