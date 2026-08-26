import {
  assertConfirmedConsumerObservationRecordIntegrity,
  evidenceGradeForConsumerCollectionMethod,
  type ConfirmedConsumerObservationRecord,
  type ConfirmedObservationResponseBinding,
  type ConsumerCaptureArtifactBinding,
  type ConsumerObservationMetricSample,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type ConsumerSearchMode,
  type ConsumerSurfaceProfileVersion,
} from "@wentian/domain";
import type { ConfirmedConsumerObservationMetricSampleProjector } from "@wentian/application";

import {
  normalizeSourceUrl,
  SOURCE_URL_NORMALIZATION_VERSION,
} from "./source-url-normalization.ts";

export class DefaultConfirmedConsumerObservationMetricSampleProjector implements ConfirmedConsumerObservationMetricSampleProjector {
  readonly normalizationVersion = SOURCE_URL_NORMALIZATION_VERSION;

  project(
    input: ConfirmedConsumerObservationRecordMetricProjectionInput,
  ): ConsumerObservationMetricSample {
    return projectConfirmedConsumerObservationRecordToMetricSample(input);
  }
}

export interface ConsumerMetricVisibleCitation {
  readonly url: string;
  readonly position: number;
}

export interface ConsumerMetricVisibleMetadata {
  readonly surfaceModelLabel: string | null;
  readonly searchMode: ConsumerSearchMode;
  readonly isNewConversation: boolean;
  readonly isLoggedIn: boolean;
  readonly memoryEnabled: boolean | null;
  readonly personalizationEnabled: boolean | null;
  readonly locale: string;
  readonly region: string | null;
}

export interface ConfirmedConsumerMetricArtifact extends ConsumerCaptureArtifactBinding {
  readonly adapterVersion: string;
  readonly visibleCitations: readonly ConsumerMetricVisibleCitation[];
  readonly visibleMetadata: ConsumerMetricVisibleMetadata;
}

export interface ConfirmedConsumerObservationMetricProjectionInput {
  readonly run: ConsumerObservationRun;
  readonly task: ConsumerObservationTask;
  readonly artifact: ConfirmedConsumerMetricArtifact;
  readonly response: ConfirmedObservationResponseBinding;
  readonly surfaceProfile: ConsumerSurfaceProfileVersion;
}

export function projectConfirmedConsumerObservationToMetricSample(
  input: ConfirmedConsumerObservationMetricProjectionInput,
): ConsumerObservationMetricSample {
  const { run, task, artifact, response, surfaceProfile } = input;
  assertRunBinding(run, task, artifact, surfaceProfile);
  assertConfirmedTask(task);
  assertArtifactBinding(task, artifact);
  assertResponseBinding(task, response);
  assertSurfaceBinding(task, artifact, surfaceProfile);
  return buildMetricSample({
    id: response.id,
    querySnapshotItemId: task.querySnapshotItemId,
    collectionMethod: task.collectionMethod,
    evidenceGrade: evidenceGradeForConsumerCollectionMethod(
      task.collectionMethod,
    ),
    surfaceCode: surfaceProfile.surfaceCode,
    visibleMetadata: artifact.visibleMetadata,
    visibleCitations: artifact.visibleCitations,
  });
}

export interface ConfirmedConsumerObservationRecordMetricProjectionInput {
  readonly run: ConsumerObservationRun;
  readonly record: ConfirmedConsumerObservationRecord;
  readonly surfaceProfile: ConsumerSurfaceProfileVersion;
}

export function projectConfirmedConsumerObservationRecordToMetricSample(
  input: ConfirmedConsumerObservationRecordMetricProjectionInput,
): ConsumerObservationMetricSample {
  assertConfirmedConsumerObservationRecordIntegrity(input.record);
  const { run, record, surfaceProfile } = input;
  if (run.experimentKind !== "natural_answer") {
    throw new Error("NATURAL_ANSWER_CONSUMER_RUN_REQUIRED");
  }
  if (
    record.verificationStatus !== "confirmed" ||
    record.scopeId !== run.scopeId ||
    record.runId !== run.id ||
    record.surfaceProfileVersionId !== run.surfaceProfileVersionId ||
    surfaceProfile.id !== run.surfaceProfileVersionId ||
    record.collectionMethod !== run.collectionMethod
  ) {
    throw new Error("CONSUMER_METRIC_RECORD_BINDING_MISMATCH");
  }
  if (
    record.evidenceGrade !==
    evidenceGradeForConsumerCollectionMethod(record.collectionMethod)
  ) {
    throw new Error("CONSUMER_METRIC_RECORD_EVIDENCE_GRADE_MISMATCH");
  }
  if (
    surfaceProfile.adapterVersion !== record.adapterVersion ||
    surfaceProfile.productLabel !== record.visibleMetadata.productLabel ||
    !surfaceProfile.allowedCollectionMethods.includes(record.collectionMethod)
  ) {
    throw new Error("CONSUMER_METRIC_SURFACE_BINDING_MISMATCH");
  }
  assertSessionConditionsMatch(run, record.visibleMetadata);

  return buildMetricSample({
    id: record.id,
    querySnapshotItemId: record.querySnapshotItemId,
    collectionMethod: record.collectionMethod,
    evidenceGrade: record.evidenceGrade,
    surfaceCode: surfaceProfile.surfaceCode,
    visibleMetadata: record.visibleMetadata,
    visibleCitations: record.visibleCitations,
  });
}

interface BuildMetricSampleInput {
  readonly id: string;
  readonly querySnapshotItemId: string;
  readonly collectionMethod: ConsumerObservationMetricSample["collectionMethod"];
  readonly evidenceGrade: NonNullable<
    ConsumerObservationMetricSample["evidenceGrade"]
  >;
  readonly surfaceCode: string;
  readonly visibleMetadata: ConsumerMetricVisibleMetadata;
  readonly visibleCitations: readonly ConsumerMetricVisibleCitation[];
}

function buildMetricSample(
  input: BuildMetricSampleInput,
): ConsumerObservationMetricSample {
  const citations = projectMetricCitations(input.visibleCitations);
  return Object.freeze({
    id: input.id,
    querySnapshotItemId: input.querySnapshotItemId,
    collectionMethod: input.collectionMethod,
    verificationStatus: "confirmed",
    evidenceGrade: input.evidenceGrade,
    configuration: Object.freeze({
      surfaceCode: input.surfaceCode,
      surfaceModelLabel: input.visibleMetadata.surfaceModelLabel,
      searchMode: input.visibleMetadata.searchMode,
      isNewConversation: input.visibleMetadata.isNewConversation,
      isLoggedIn: input.visibleMetadata.isLoggedIn,
      memoryEnabled: input.visibleMetadata.memoryEnabled,
      personalizationEnabled: input.visibleMetadata.personalizationEnabled,
      locale: input.visibleMetadata.locale,
      region: input.visibleMetadata.region,
    }),
    sourceOrderAvailable: true,
    citations,
  });
}

function projectMetricCitations(
  visibleCitations: readonly ConsumerMetricVisibleCitation[],
): readonly ConsumerObservationMetricSample["citations"][number][] {
  assertCitationPositions(visibleCitations);
  const positionByDomain = new Map<string, number>();
  for (const citation of visibleCitations) {
    const normalized = normalizeSourceUrl(citation.url);
    if (normalized.status === "rejected") {
      throw new Error(
        `VISIBLE_CITATION_URL_NORMALIZATION_REJECTED:${normalized.reason}`,
      );
    }
    const existing = positionByDomain.get(normalized.registrableDomain);
    if (existing === undefined || citation.position < existing) {
      positionByDomain.set(normalized.registrableDomain, citation.position);
    }
  }
  return Object.freeze(
    [...positionByDomain]
      .map(([registrableDomain, position]) =>
        Object.freeze({ registrableDomain, position }),
      )
      .sort(
        (left, right) =>
          left.position - right.position ||
          left.registrableDomain.localeCompare(right.registrableDomain),
      ),
  );
}

function assertRunBinding(
  run: ConsumerObservationRun,
  task: ConsumerObservationTask,
  artifact: ConfirmedConsumerMetricArtifact,
  surfaceProfile: ConsumerSurfaceProfileVersion,
): void {
  if (run.experimentKind !== "natural_answer") {
    throw new Error("NATURAL_ANSWER_CONSUMER_RUN_REQUIRED");
  }
  if (
    run.id !== task.runId ||
    run.scopeId !== task.scopeId ||
    run.surfaceProfileVersionId !== task.surfaceProfileVersionId ||
    run.surfaceProfileVersionId !== surfaceProfile.id ||
    run.collectionMethod !== task.collectionMethod
  ) {
    throw new Error("CONSUMER_METRIC_RUN_BINDING_MISMATCH");
  }
  assertSessionConditionsMatch(run, artifact.visibleMetadata);
}

function assertSessionConditionsMatch(
  run: ConsumerObservationRun,
  metadata: ConsumerMetricVisibleMetadata,
): void {
  const conditions = run.sessionConditions;
  if (
    conditions.searchMode !== metadata.searchMode ||
    conditions.isNewConversation !== metadata.isNewConversation ||
    conditions.isLoggedIn !== metadata.isLoggedIn ||
    conditions.memoryEnabled !== metadata.memoryEnabled ||
    conditions.personalizationEnabled !== metadata.personalizationEnabled ||
    conditions.locale !== metadata.locale ||
    conditions.region !== metadata.region
  ) {
    throw new Error("CONSUMER_METRIC_SESSION_CONDITIONS_MISMATCH");
  }
}

function assertCitationPositions(
  citations: readonly ConsumerMetricVisibleCitation[],
): void {
  const positions = new Set<number>();
  for (const citation of citations) {
    if (!Number.isInteger(citation.position) || citation.position < 1) {
      throw new Error("INVALID_VISIBLE_CITATION_POSITION");
    }
    if (positions.has(citation.position)) {
      throw new Error("DUPLICATE_VISIBLE_CITATION_POSITION");
    }
    positions.add(citation.position);
  }
  if (positions.size > 0 && !positions.has(1)) {
    throw new Error("VISIBLE_CITATION_FIRST_POSITION_REQUIRED");
  }
}

function assertConfirmedTask(task: ConsumerObservationTask): void {
  if (
    task.status !== "confirmed" ||
    !task.captureArtifactId ||
    !task.confirmedResponseId ||
    !task.capturedAt ||
    !task.confirmedAt
  ) {
    throw new Error("CONFIRMED_OBSERVATION_TASK_REQUIRED");
  }
}

function assertArtifactBinding(
  task: ConsumerObservationTask,
  artifact: ConfirmedConsumerMetricArtifact,
): void {
  if (
    artifact.id !== task.captureArtifactId ||
    artifact.scopeId !== task.scopeId ||
    artifact.observationTaskId !== task.id ||
    artifact.capturedBy !== task.assignedTo ||
    artifact.collectionMethod !== task.collectionMethod
  ) {
    throw new Error("CONSUMER_METRIC_ARTIFACT_BINDING_MISMATCH");
  }
}

function assertResponseBinding(
  task: ConsumerObservationTask,
  response: ConfirmedObservationResponseBinding,
): void {
  if (
    response.id !== task.confirmedResponseId ||
    response.scopeId !== task.scopeId ||
    response.runId !== task.runId ||
    response.querySnapshotItemId !== task.querySnapshotItemId ||
    response.sampleIndex !== task.sampleIndex ||
    response.captureArtifactId !== task.captureArtifactId
  ) {
    throw new Error("CONSUMER_METRIC_RESPONSE_BINDING_MISMATCH");
  }
}

function assertSurfaceBinding(
  task: ConsumerObservationTask,
  artifact: ConfirmedConsumerMetricArtifact,
  surfaceProfile: ConsumerSurfaceProfileVersion,
): void {
  if (
    surfaceProfile.id !== task.surfaceProfileVersionId ||
    surfaceProfile.adapterVersion !== artifact.adapterVersion ||
    !surfaceProfile.allowedCollectionMethods.includes(task.collectionMethod)
  ) {
    throw new Error("CONSUMER_METRIC_SURFACE_BINDING_MISMATCH");
  }
}
