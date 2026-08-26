import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTimestamp,
} from "./consumer-visible-evidence.ts";

export interface AiVisibilityCitedSourceEvent {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly responseId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly role: "cited";
  readonly sourcePosition: number;
  readonly originalUrl: string;
  readonly normalizedUrl: string;
  readonly urlHash: string;
  readonly sourceKeyHash: string;
  readonly host: string;
  readonly registrableDomain: string;
  readonly title: string | null;
  readonly snippet: null;
  readonly mappingGranularity: "answer";
  readonly answerStart: null;
  readonly answerEnd: null;
  readonly providerSourceId: null;
  readonly nominationInformationType: null;
  readonly nominationReason: null;
  readonly nominationValidationMethod: null;
  readonly normalizationVersion: string;
  readonly createdAt: string;
}

export interface CreateAiVisibilityCitedSourceEventInput {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly responseId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly sourcePosition: number;
  readonly originalUrl: string;
  readonly normalizedUrl: string;
  readonly sourceKeyHash: string;
  readonly host: string;
  readonly registrableDomain: string;
  readonly title?: string | null;
  readonly normalizationVersion: string;
  readonly createdAt: string;
}

export function createAiVisibilityCitedSourceEvent(
  input: CreateAiVisibilityCitedSourceEventInput,
): AiVisibilityCitedSourceEvent {
  if (!Number.isInteger(input.sampleIndex) || input.sampleIndex < 1) {
    throw new Error("INVALID_SOURCE_EVENT_SAMPLE_INDEX");
  }
  if (!Number.isInteger(input.sourcePosition) || input.sourcePosition < 1) {
    throw new Error("INVALID_SOURCE_EVENT_POSITION");
  }
  const originalUrl = normalizeHttpUrl(
    input.originalUrl,
    "INVALID_SOURCE_EVENT_ORIGINAL_URL",
  );
  const normalizedUrl = normalizeHttpUrl(
    input.normalizedUrl,
    "INVALID_SOURCE_EVENT_NORMALIZED_URL",
  );
  const normalized = new URL(normalizedUrl);
  const host = normalizeRequiredText(input.host, "INVALID_SOURCE_EVENT_HOST");
  if (normalized.hostname !== host) {
    throw new Error("SOURCE_EVENT_HOST_MISMATCH");
  }
  const registrableDomain = normalizeRequiredText(
    input.registrableDomain,
    "INVALID_SOURCE_EVENT_REGISTRABLE_DOMAIN",
  );
  if (host !== registrableDomain && !host.endsWith(`.${registrableDomain}`)) {
    throw new Error("SOURCE_EVENT_REGISTRABLE_DOMAIN_MISMATCH");
  }

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
    role: "cited",
    sourcePosition: input.sourcePosition,
    originalUrl,
    normalizedUrl,
    urlHash: sha256(normalizedUrl),
    sourceKeyHash: normalizeSha256(
      input.sourceKeyHash,
      "INVALID_SOURCE_EVENT_KEY_HASH",
    ),
    host,
    registrableDomain,
    title: normalizeOptionalText(input.title, 500),
    snippet: null,
    mappingGranularity: "answer",
    answerStart: null,
    answerEnd: null,
    providerSourceId: null,
    nominationInformationType: null,
    nominationReason: null,
    nominationValidationMethod: null,
    normalizationVersion: normalizeRequiredText(
      input.normalizationVersion,
      "INVALID_NORMALIZATION_VERSION",
    ),
    createdAt: normalizeTimestamp(input.createdAt),
  });
}

export function assertAiVisibilityCitedSourceEventIntegrity(
  event: AiVisibilityCitedSourceEvent,
): void {
  const rebuilt = createAiVisibilityCitedSourceEvent({
    id: event.id,
    scopeId: event.scopeId,
    runId: event.runId,
    responseId: event.responseId,
    querySnapshotItemId: event.querySnapshotItemId,
    sampleIndex: event.sampleIndex,
    sourcePosition: event.sourcePosition,
    originalUrl: event.originalUrl,
    normalizedUrl: event.normalizedUrl,
    sourceKeyHash: event.sourceKeyHash,
    host: event.host,
    registrableDomain: event.registrableDomain,
    title: event.title,
    normalizationVersion: event.normalizationVersion,
    createdAt: event.createdAt,
  });
  if (!isDeepStrictEqual(event, rebuilt)) {
    throw new Error("AI_VISIBILITY_SOURCE_EVENT_INTEGRITY_MISMATCH");
  }
}

function normalizeHttpUrl(value: string, errorCode: string): string {
  const normalized = normalizeRequiredText(value, errorCode);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(errorCode);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error(errorCode);
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
