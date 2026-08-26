import { isDeepStrictEqual } from "node:util";

import {
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTimestamp,
} from "./consumer-visible-evidence.ts";

export type NominationValidationMethod = "schema_validated" | "human_confirmed";

export interface AiVisibilityNominatedSourceEvent {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly responseId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly role: "nominated";
  readonly sourcePosition: number | null;
  readonly originalUrl: null;
  readonly normalizedUrl: null;
  readonly urlHash: null;
  readonly sourceKeyHash: string;
  readonly host: string;
  readonly registrableDomain: string;
  readonly title: null;
  readonly snippet: null;
  readonly mappingGranularity: "answer";
  readonly answerStart: null;
  readonly answerEnd: null;
  readonly providerSourceId: null;
  readonly nominationInformationType: string | null;
  readonly nominationReason: string | null;
  readonly nominationValidationMethod: NominationValidationMethod;
  readonly normalizationVersion: string;
  readonly createdAt: string;
}

export interface CreateAiVisibilityNominatedSourceEventInput {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly responseId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly sourcePosition: number | null;
  readonly sourceKeyHash: string;
  readonly registrableDomain: string;
  readonly nominationInformationType?: string | null;
  readonly nominationReason?: string | null;
  readonly nominationValidationMethod: NominationValidationMethod;
  readonly normalizationVersion: string;
  readonly createdAt: string;
}

export function createAiVisibilityNominatedSourceEvent(
  input: CreateAiVisibilityNominatedSourceEventInput,
): AiVisibilityNominatedSourceEvent {
  if (!Number.isInteger(input.sampleIndex) || input.sampleIndex < 1) {
    throw new Error("INVALID_SOURCE_EVENT_SAMPLE_INDEX");
  }
  if (
    input.sourcePosition !== null &&
    (!Number.isInteger(input.sourcePosition) || input.sourcePosition < 1)
  ) {
    throw new Error("INVALID_SOURCE_EVENT_POSITION");
  }
  if (
    input.nominationValidationMethod !== "schema_validated" &&
    input.nominationValidationMethod !== "human_confirmed"
  ) {
    throw new Error("INVALID_NOMINATION_VALIDATION_METHOD");
  }
  const registrableDomain = normalizeDomain(input.registrableDomain);

  return Object.freeze({
    id: normalizeRequiredText(input.id, "INVALID_SOURCE_EVENT_ID"),
    scopeId: normalizeRequiredText(input.scopeId, "INVALID_SCOPE_ID"),
    runId: normalizeRequiredText(input.runId, "INVALID_RUN_ID"),
    responseId: normalizeRequiredText(input.responseId, "INVALID_RESPONSE_ID"),
    querySnapshotItemId: normalizeRequiredText(
      input.querySnapshotItemId,
      "INVALID_QUERY_SNAPSHOT_ITEM_ID",
    ),
    sampleIndex: input.sampleIndex,
    role: "nominated",
    sourcePosition: input.sourcePosition,
    originalUrl: null,
    normalizedUrl: null,
    urlHash: null,
    sourceKeyHash: normalizeSha256(
      input.sourceKeyHash,
      "INVALID_SOURCE_EVENT_KEY_HASH",
    ),
    host: registrableDomain,
    registrableDomain,
    title: null,
    snippet: null,
    mappingGranularity: "answer",
    answerStart: null,
    answerEnd: null,
    providerSourceId: null,
    nominationInformationType: normalizeOptionalText(
      input.nominationInformationType,
      500,
    ),
    nominationReason: normalizeOptionalText(input.nominationReason, 2_000),
    nominationValidationMethod: input.nominationValidationMethod,
    normalizationVersion: normalizeRequiredText(
      input.normalizationVersion,
      "INVALID_NORMALIZATION_VERSION",
    ),
    createdAt: normalizeTimestamp(input.createdAt),
  });
}

export function assertAiVisibilityNominatedSourceEventIntegrity(
  event: AiVisibilityNominatedSourceEvent,
): void {
  const rebuilt = createAiVisibilityNominatedSourceEvent({
    id: event.id,
    scopeId: event.scopeId,
    runId: event.runId,
    responseId: event.responseId,
    querySnapshotItemId: event.querySnapshotItemId,
    sampleIndex: event.sampleIndex,
    sourcePosition: event.sourcePosition,
    sourceKeyHash: event.sourceKeyHash,
    registrableDomain: event.registrableDomain,
    nominationInformationType: event.nominationInformationType,
    nominationReason: event.nominationReason,
    nominationValidationMethod: event.nominationValidationMethod,
    normalizationVersion: event.normalizationVersion,
    createdAt: event.createdAt,
  });
  if (!isDeepStrictEqual(event, rebuilt)) {
    throw new Error("AI_VISIBILITY_NOMINATED_EVENT_INTEGRITY_MISMATCH");
  }
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

function normalizeSha256(value: string, errorCode: string): string {
  const normalized = normalizeRequiredText(value, errorCode);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}
