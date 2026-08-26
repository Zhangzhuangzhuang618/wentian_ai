import { isDeepStrictEqual } from "node:util";

import {
  type ConsumerCollectionMethod,
  type ConsumerSessionConditions,
} from "./consumer-observation.ts";
import type { ConsumerCaptureArtifactBinding } from "./consumer-observation-task.ts";
import {
  normalizeConsumerVisibleCitations,
  normalizeConsumerVisibleMetadata,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTimestamp,
  sha256Utf8,
  type ConsumerVisibleCitation,
  type ConsumerVisibleCitationInput,
  type ConsumerVisibleObservationMetadata,
} from "./consumer-visible-evidence.ts";

export interface ConsumerCaptureEvidenceArtifact extends ConsumerCaptureArtifactBinding {
  readonly answerText: string;
  readonly answerHash: string;
  readonly visibleCitations: readonly ConsumerVisibleCitation[];
  readonly visibleMetadata: ConsumerVisibleObservationMetadata;
  readonly screenshotMediaAssetId: string;
  readonly sanitizedDomObjectKey: string | null;
  readonly domHash: string | null;
  readonly captureSha256: string;
  readonly adapterVersion: string;
  readonly createdAt: string;
}

export type ConsumerCaptureArtifact =
  ConsumerCaptureArtifactBinding | ConsumerCaptureEvidenceArtifact;

export interface CreateConsumerCaptureEvidenceArtifactInput {
  readonly id: string;
  readonly scopeId: string;
  readonly observationTaskId: string;
  readonly capturedBy: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly answerText: string;
  readonly visibleCitations: readonly ConsumerVisibleCitationInput[];
  readonly visibleMetadata: ConsumerVisibleObservationMetadata;
  readonly screenshotMediaAssetId: string;
  readonly sanitizedDomObjectKey?: string | null;
  readonly domHash?: string | null;
  readonly adapterVersion: string;
  readonly createdAt: string;
}

export function createConsumerCaptureEvidenceArtifact(
  input: CreateConsumerCaptureEvidenceArtifactInput,
): ConsumerCaptureEvidenceArtifact {
  if (
    input.collectionMethod !== "browser_assisted" &&
    input.collectionMethod !== "manual_import"
  ) {
    throw new Error("INVALID_CONSUMER_COLLECTION_METHOD");
  }
  if (
    typeof input.answerText !== "string" ||
    !input.answerText.trim() ||
    input.answerText.length > 200_000
  ) {
    throw new Error("INVALID_CAPTURE_ANSWER_TEXT");
  }
  const visibleCitations = normalizeConsumerVisibleCitations(
    input.visibleCitations,
  );
  const visibleMetadata = normalizeConsumerVisibleMetadata(
    input.visibleMetadata,
  );
  const createdAt = normalizeTimestamp(input.createdAt);
  if (Date.parse(visibleMetadata.observedAt) > Date.parse(createdAt)) {
    throw new Error("CAPTURE_CREATED_BEFORE_OBSERVATION");
  }
  const sanitizedDomObjectKey = normalizeOptionalText(
    input.sanitizedDomObjectKey,
    500,
  );
  const domHash = normalizeOptionalSha256(input.domHash);
  if ((sanitizedDomObjectKey === null) !== (domHash === null)) {
    throw new Error("CAPTURE_DOM_REFERENCE_HASH_PAIR_REQUIRED");
  }

  const base = {
    id: normalizeRequiredText(input.id, "INVALID_CAPTURE_ARTIFACT_ID"),
    scopeId: normalizeRequiredText(input.scopeId, "INVALID_SCOPE_ID"),
    observationTaskId: normalizeRequiredText(
      input.observationTaskId,
      "INVALID_OBSERVATION_TASK_ID",
    ),
    capturedBy: normalizeRequiredText(input.capturedBy, "INVALID_CAPTURED_BY"),
    collectionMethod: input.collectionMethod,
    answerText: input.answerText,
    answerHash: sha256Utf8(input.answerText),
    visibleCitations,
    visibleMetadata,
    screenshotMediaAssetId: normalizeRequiredText(
      input.screenshotMediaAssetId,
      "INVALID_SCREENSHOT_MEDIA_ASSET_ID",
    ),
    sanitizedDomObjectKey,
    domHash,
    adapterVersion: normalizeRequiredText(
      input.adapterVersion,
      "INVALID_ADAPTER_VERSION",
    ),
    createdAt,
  } as const;

  return Object.freeze({
    ...base,
    captureSha256: sha256Utf8(canonicalCaptureReferenceBundle(base)),
  });
}

export function isConsumerCaptureEvidenceArtifact(
  artifact: ConsumerCaptureArtifactBinding,
): artifact is ConsumerCaptureEvidenceArtifact {
  return (
    "answerText" in artifact &&
    "answerHash" in artifact &&
    "visibleCitations" in artifact &&
    "visibleMetadata" in artifact &&
    "screenshotMediaAssetId" in artifact &&
    "captureSha256" in artifact &&
    "adapterVersion" in artifact &&
    "createdAt" in artifact
  );
}

export function assertConsumerCaptureEvidenceArtifactIntegrity(
  artifact: ConsumerCaptureEvidenceArtifact,
): void {
  const rebuilt = createConsumerCaptureEvidenceArtifact({
    id: artifact.id,
    scopeId: artifact.scopeId,
    observationTaskId: artifact.observationTaskId,
    capturedBy: artifact.capturedBy,
    collectionMethod: artifact.collectionMethod,
    answerText: artifact.answerText,
    visibleCitations: artifact.visibleCitations,
    visibleMetadata: artifact.visibleMetadata,
    screenshotMediaAssetId: artifact.screenshotMediaAssetId,
    sanitizedDomObjectKey: artifact.sanitizedDomObjectKey,
    domHash: artifact.domHash,
    adapterVersion: artifact.adapterVersion,
    createdAt: artifact.createdAt,
  });
  if (!isDeepStrictEqual(artifact, rebuilt)) {
    throw new Error("CAPTURE_EVIDENCE_ARTIFACT_INTEGRITY_MISMATCH");
  }
}

export function hasSameConsumerSessionConditions(
  conditions: ConsumerSessionConditions,
  metadata: ConsumerVisibleObservationMetadata,
): boolean {
  return (
    conditions.searchMode === metadata.searchMode &&
    conditions.isNewConversation === metadata.isNewConversation &&
    conditions.isLoggedIn === metadata.isLoggedIn &&
    conditions.memoryEnabled === metadata.memoryEnabled &&
    conditions.personalizationEnabled === metadata.personalizationEnabled &&
    conditions.locale === metadata.locale &&
    conditions.region === metadata.region
  );
}

function normalizeOptionalSha256(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeOptionalText(value, 64);
  if (normalized !== null && !/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("INVALID_CAPTURE_DOM_HASH");
  }
  return normalized;
}

function canonicalCaptureReferenceBundle(
  artifact: Omit<ConsumerCaptureEvidenceArtifact, "captureSha256">,
): string {
  return JSON.stringify({
    version: "wentian-consumer-capture-reference-bundle@1",
    id: artifact.id,
    scopeId: artifact.scopeId,
    observationTaskId: artifact.observationTaskId,
    capturedBy: artifact.capturedBy,
    collectionMethod: artifact.collectionMethod,
    answerHash: artifact.answerHash,
    visibleCitations: artifact.visibleCitations,
    visibleMetadata: artifact.visibleMetadata,
    screenshotMediaAssetId: artifact.screenshotMediaAssetId,
    sanitizedDomObjectKey: artifact.sanitizedDomObjectKey,
    domHash: artifact.domHash,
    adapterVersion: artifact.adapterVersion,
    createdAt: artifact.createdAt,
  });
}
