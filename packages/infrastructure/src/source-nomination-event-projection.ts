import {
  assertAiVisibilityNominatedSourceEventIntegrity,
  createAiVisibilityNominatedSourceEvent,
  type AiVisibilityNominatedSourceEvent,
  type NominationValidationMethod,
} from "@wentian/domain";

import {
  deriveSourceKeyHash,
  normalizeSourceRegistrableDomain,
} from "./source-key-hash.ts";
import { SOURCE_URL_NORMALIZATION_VERSION } from "./source-url-normalization.ts";

export interface SourceNominationProjectionItem {
  readonly registrableDomain: string;
  readonly position: number | null;
  readonly informationType?: string | null;
  readonly reason?: string | null;
}

export interface ProjectSourceNominationEventsInput {
  readonly scopeId: string;
  readonly runId: string;
  readonly responseId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly validationMethod: NominationValidationMethod;
  readonly nominations: readonly SourceNominationProjectionItem[];
  readonly newId: () => string;
  readonly createdAt: string;
}

export class SourceNominationEventProjector {
  readonly normalizationVersion = SOURCE_URL_NORMALIZATION_VERSION;

  project(
    input: ProjectSourceNominationEventsInput,
  ): readonly AiVisibilityNominatedSourceEvent[] {
    if (input.nominations.length > 10) {
      throw new Error("TOO_MANY_NOMINATIONS");
    }
    assertPositionSemantics(input.nominations);
    const events = input.nominations.map((nomination) => {
      const registrableDomain = normalizeSourceRegistrableDomain(
        nomination.registrableDomain,
      );
      const sourceKey = deriveSourceKeyHash({
        normalizedSource: null,
        registrableDomain,
        normalizationVersion: this.normalizationVersion,
      });
      return createAiVisibilityNominatedSourceEvent({
        id: input.newId(),
        scopeId: input.scopeId,
        runId: input.runId,
        responseId: input.responseId,
        querySnapshotItemId: input.querySnapshotItemId,
        sampleIndex: input.sampleIndex,
        sourcePosition: nomination.position,
        sourceKeyHash: sourceKey.sourceKeyHash,
        registrableDomain,
        nominationInformationType: nomination.informationType,
        nominationReason: nomination.reason,
        nominationValidationMethod: input.validationMethod,
        normalizationVersion: sourceKey.normalizationVersion,
        createdAt: input.createdAt,
      });
    });
    assertUniqueEventIdentities(events);
    return Object.freeze(events);
  }
}

export function assertProjectedNominatedSourceEventIntegrity(
  event: AiVisibilityNominatedSourceEvent,
): void {
  assertAiVisibilityNominatedSourceEventIntegrity(event);
  const registrableDomain = normalizeSourceRegistrableDomain(
    event.registrableDomain,
  );
  const sourceKey = deriveSourceKeyHash({
    normalizedSource: null,
    registrableDomain,
    normalizationVersion: event.normalizationVersion,
  });
  if (
    event.host !== registrableDomain ||
    event.registrableDomain !== registrableDomain ||
    event.sourceKeyHash !== sourceKey.sourceKeyHash ||
    event.normalizationVersion !== SOURCE_URL_NORMALIZATION_VERSION
  ) {
    throw new Error("AI_VISIBILITY_NOMINATED_EVENT_PROJECTION_MISMATCH");
  }
}

function assertPositionSemantics(
  nominations: readonly SourceNominationProjectionItem[],
): void {
  const positioned = nominations.filter(
    (nomination) => nomination.position !== null,
  );
  if (positioned.length > 0 && positioned.length !== nominations.length) {
    throw new Error("NOMINATION_POSITION_ALL_OR_NONE_REQUIRED");
  }
  if (positioned.length > 0) {
    const positions = positioned.map((nomination) => nomination.position!);
    if (
      new Set(positions).size !== positions.length ||
      positions.some(
        (position) =>
          !Number.isInteger(position) ||
          position < 1 ||
          position > positions.length,
      )
    ) {
      throw new Error("INVALID_NOMINATION_POSITION_SEQUENCE");
    }
    return;
  }
  const domains = new Set<string>();
  for (const nomination of nominations) {
    const domain = normalizeSourceRegistrableDomain(
      nomination.registrableDomain,
    );
    if (domains.has(domain)) {
      throw new Error("DUPLICATE_UNORDERED_NOMINATION_DOMAIN");
    }
    domains.add(domain);
  }
}

function assertUniqueEventIdentities(
  events: readonly AiVisibilityNominatedSourceEvent[],
): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const event of events) {
    assertProjectedNominatedSourceEventIntegrity(event);
    const key = JSON.stringify([
      event.scopeId,
      event.responseId,
      event.role,
      event.sourceKeyHash,
      event.sourcePosition,
    ]);
    if (ids.has(event.id) || keys.has(key)) {
      throw new Error("DUPLICATE_NOMINATED_SOURCE_EVENT");
    }
    ids.add(event.id);
    keys.add(key);
  }
}
