import { isDeepStrictEqual } from "node:util";

import {
  evidenceGradeForConsumerCollectionMethod,
  type ConsumerCollectionMethod,
  type ObservationEvidenceGrade,
} from "./consumer-observation.ts";
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
import { assessUnsupportedInternalClaim } from "./unsupported-internal-claim.ts";

export type ConfirmedConsumerObservationCitation = ConsumerVisibleCitation;

export type ConfirmedConsumerObservationMetadata =
  ConsumerVisibleObservationMetadata;

export interface ConfirmedConsumerObservationRecord {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly observationTaskId: string;
  readonly captureArtifactId: string;
  readonly surfaceProfileVersionId: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly verificationStatus: "confirmed";
  readonly evidenceGrade: Extract<
    ObservationEvidenceGrade,
    "web_confirmed_capture" | "web_confirmed_manual"
  >;
  readonly answerText: string;
  readonly answerHash: string;
  readonly unsupportedInternalClaim: boolean;
  readonly unsupportedInternalClaimAssessmentVersion: string;
  readonly visibleCitations: readonly ConfirmedConsumerObservationCitation[];
  readonly visibleMetadata: ConfirmedConsumerObservationMetadata;
  readonly screenshotMediaAssetId: string;
  readonly sanitizedDomObjectKey: string | null;
  readonly adapterVersion: string;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

export interface CreateConfirmedConsumerObservationRecordInput {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly observationTaskId: string;
  readonly captureArtifactId: string;
  readonly surfaceProfileVersionId: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly answerText: string;
  readonly visibleCitations: readonly ConsumerVisibleCitationInput[];
  readonly visibleMetadata: ConfirmedConsumerObservationMetadata;
  readonly screenshotMediaAssetId: string;
  readonly sanitizedDomObjectKey?: string | null;
  readonly adapterVersion: string;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

export function createConfirmedConsumerObservationRecord(
  input: CreateConfirmedConsumerObservationRecordInput,
): ConfirmedConsumerObservationRecord {
  if (!Number.isInteger(input.sampleIndex) || input.sampleIndex < 1) {
    throw new Error("INVALID_OBSERVATION_SAMPLE_INDEX");
  }
  if (
    typeof input.answerText !== "string" ||
    !input.answerText.trim() ||
    input.answerText.length > 200_000
  ) {
    throw new Error("INVALID_CONFIRMED_ANSWER_TEXT");
  }
  const visibleCitations = normalizeConsumerVisibleCitations(
    input.visibleCitations,
  );
  const visibleMetadata = normalizeConsumerVisibleMetadata(
    input.visibleMetadata,
  );
  const confirmedAt = normalizeTimestamp(input.confirmedAt);
  const internalClaimAssessment = assessUnsupportedInternalClaim(
    input.answerText,
  );
  if (Date.parse(confirmedAt) < Date.parse(visibleMetadata.observedAt)) {
    throw new Error("CONFIRMATION_BEFORE_OBSERVATION");
  }

  return Object.freeze({
    id: normalizeRequiredText(input.id, "INVALID_CONFIRMED_RESPONSE_ID"),
    scopeId: normalizeRequiredText(input.scopeId, "INVALID_SCOPE_ID"),
    runId: normalizeRequiredText(input.runId, "INVALID_RUN_ID"),
    querySnapshotItemId: normalizeRequiredText(
      input.querySnapshotItemId,
      "INVALID_QUERY_SNAPSHOT_ITEM_ID",
    ),
    sampleIndex: input.sampleIndex,
    observationTaskId: normalizeRequiredText(
      input.observationTaskId,
      "INVALID_OBSERVATION_TASK_ID",
    ),
    captureArtifactId: normalizeRequiredText(
      input.captureArtifactId,
      "INVALID_CAPTURE_ARTIFACT_ID",
    ),
    surfaceProfileVersionId: normalizeRequiredText(
      input.surfaceProfileVersionId,
      "INVALID_SURFACE_PROFILE_VERSION_ID",
    ),
    collectionMethod: input.collectionMethod,
    verificationStatus: "confirmed",
    evidenceGrade: evidenceGradeForConsumerCollectionMethod(
      input.collectionMethod,
    ),
    answerText: input.answerText,
    answerHash: sha256Utf8(input.answerText),
    unsupportedInternalClaim: internalClaimAssessment.unsupportedInternalClaim,
    unsupportedInternalClaimAssessmentVersion:
      internalClaimAssessment.assessmentVersion,
    visibleCitations,
    visibleMetadata,
    screenshotMediaAssetId: normalizeRequiredText(
      input.screenshotMediaAssetId,
      "INVALID_SCREENSHOT_MEDIA_ASSET_ID",
    ),
    sanitizedDomObjectKey: normalizeOptionalText(
      input.sanitizedDomObjectKey,
      500,
    ),
    adapterVersion: normalizeRequiredText(
      input.adapterVersion,
      "INVALID_ADAPTER_VERSION",
    ),
    confirmedBy: normalizeRequiredText(input.confirmedBy, "INVALID_CONFIRMER"),
    confirmedAt,
  });
}

export function assertConfirmedConsumerObservationRecordIntegrity(
  record: ConfirmedConsumerObservationRecord,
): void {
  const rebuilt = createConfirmedConsumerObservationRecord({
    id: record.id,
    scopeId: record.scopeId,
    runId: record.runId,
    querySnapshotItemId: record.querySnapshotItemId,
    sampleIndex: record.sampleIndex,
    observationTaskId: record.observationTaskId,
    captureArtifactId: record.captureArtifactId,
    surfaceProfileVersionId: record.surfaceProfileVersionId,
    collectionMethod: record.collectionMethod,
    answerText: record.answerText,
    visibleCitations: record.visibleCitations,
    visibleMetadata: record.visibleMetadata,
    screenshotMediaAssetId: record.screenshotMediaAssetId,
    sanitizedDomObjectKey: record.sanitizedDomObjectKey,
    adapterVersion: record.adapterVersion,
    confirmedBy: record.confirmedBy,
    confirmedAt: record.confirmedAt,
  });
  if (!isDeepStrictEqual(record, rebuilt)) {
    throw new Error("CONFIRMED_CONSUMER_OBSERVATION_RECORD_INTEGRITY_MISMATCH");
  }
}
