import {
  hasScopeAccess,
  summarizeConsumerObservationRunTasks,
  type ConfirmedConsumerObservationRecord,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type ConsumerSurfaceProfileVersion,
  type SourceNominationMetricSample,
  type SourceNominationParseReview,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  AiVisibilityNominatedSourceEventRepository,
  ConfirmedConsumerObservationRecordRepository,
  ConsumerObservationRunRepository,
  ConsumerSourceNominationMetricSampleBatch,
  ConsumerSourceNominationMetricSampleProjector,
  ConsumerSurfaceProfileVersionRepository,
  QuerySetSnapshotRepository,
  SourceNominationParseReviewRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface BuildConsumerSourceNominationMetricSampleBatchCommand {
  readonly scopeId: string;
  readonly runId: string;
}

export interface BuildConsumerSourceNominationMetricSampleBatchDependencies {
  readonly runs: ConsumerObservationRunRepository;
  readonly snapshots: QuerySetSnapshotRepository;
  readonly responses: ConfirmedConsumerObservationRecordRepository;
  readonly reviews: SourceNominationParseReviewRepository;
  readonly sourceEvents: AiVisibilityNominatedSourceEventRepository;
  readonly surfaceProfiles: ConsumerSurfaceProfileVersionRepository;
  readonly metricProjector: ConsumerSourceNominationMetricSampleProjector;
}

export class BuildConsumerSourceNominationMetricSampleBatchService {
  private readonly dependencies: BuildConsumerSourceNominationMetricSampleBatchDependencies;

  constructor(
    dependencies: BuildConsumerSourceNominationMetricSampleBatchDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: BuildConsumerSourceNominationMetricSampleBatchCommand,
  ): Promise<ConsumerSourceNominationMetricSampleBatch> {
    if (!hasScopeAccess(principal, command.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    const run = await this.dependencies.runs.findRunById(
      command.scopeId,
      command.runId,
    );
    if (!run) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (run.scopeId !== command.scopeId || run.id !== command.runId) {
      throw new Error("SOURCE_NOMINATION_METRIC_RUN_IDENTITY_MISMATCH");
    }
    assertMaterializableRun(run);

    const [snapshot, tasks, responses, surfaceProfile] = await Promise.all([
      this.dependencies.snapshots.findById(
        command.scopeId,
        run.querySetSnapshotId,
      ),
      this.dependencies.runs.listTasksForRun(command.scopeId, run.id),
      this.dependencies.responses.listByRun(command.scopeId, run.id),
      this.dependencies.surfaceProfiles.findById(run.surfaceProfileVersionId),
    ]);
    if (!snapshot) {
      throw new Error("SOURCE_NOMINATION_METRIC_RUN_SNAPSHOT_NOT_FOUND");
    }
    if (!surfaceProfile) {
      throw new Error("SOURCE_NOMINATION_METRIC_SURFACE_PROFILE_NOT_FOUND");
    }
    assertSurfaceBinding(run, surfaceProfile);
    const summary = summarizeConsumerObservationRunTasks(run, snapshot, tasks);
    assertTerminalRunSummary(run, summary);

    const responsesByTaskId = indexResponses(run, responses);
    const samples: SourceNominationMetricSample[] = [];
    let unsupportedInternalClaimSampleCount = 0;
    const unsupportedInternalClaimAssessmentVersions = new Set<string>();
    const orderedTasks = [...tasks].sort(compareTasks);
    for (const task of orderedTasks) {
      const response = responsesByTaskId.get(task.id);
      if (task.status === "confirmed") {
        if (!response) {
          throw new Error("SOURCE_NOMINATION_METRIC_RESPONSE_MISSING");
        }
        assertConfirmedResponseTaskBinding(task, response);
        assertResponseSurfaceBinding(response, surfaceProfile);
        if (response.unsupportedInternalClaim) {
          unsupportedInternalClaimSampleCount += 1;
        }
        unsupportedInternalClaimAssessmentVersions.add(
          normalizeRequiredText(
            response.unsupportedInternalClaimAssessmentVersion,
            "UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION_REQUIRED",
          ),
        );
        const review = await this.dependencies.reviews.findByResponseId(
          run.scopeId,
          response.id,
        );
        if (!review) {
          throw new Error("SOURCE_NOMINATION_METRIC_REVIEW_MISSING");
        }
        const sourceEvents =
          await this.dependencies.sourceEvents.listByResponse(
            run.scopeId,
            response.id,
          );
        const sample = this.dependencies.metricProjector.project({
          run,
          response,
          review,
          sourceEvents,
        });
        assertProjectedSampleBinding(run, response, review, sample);
        samples.push(sample);
        responsesByTaskId.delete(task.id);
      } else if (response) {
        throw new Error("SOURCE_NOMINATION_METRIC_RESPONSE_FOR_FAILED_TASK");
      }
    }
    if (responsesByTaskId.size > 0) {
      throw new Error("SOURCE_NOMINATION_METRIC_RESPONSE_TASK_SET_MISMATCH");
    }
    if (samples.length !== summary.successfulSampleCount) {
      throw new Error("SOURCE_NOMINATION_METRIC_SAMPLE_COVERAGE_MISMATCH");
    }
    assertUniqueSampleIds(samples);

    return Object.freeze({
      scopeId: run.scopeId,
      runId: run.id,
      querySetSnapshotHash: run.querySetSnapshotHash,
      querySetSourceType: snapshot.source.type,
      geoConnectorContractVersion: snapshot.source.contractVersion ?? null,
      experimentKind: "source_nomination",
      collectionMethod: run.collectionMethod,
      nominationContext: run.nominationContext!,
      surfaceProfileVersionId: run.surfaceProfileVersionId,
      consumerSurfaceCode: surfaceProfile.surfaceCode,
      normalizationVersion: normalizeRequiredText(
        this.dependencies.metricProjector.normalizationVersion,
        "SOURCE_NOMINATION_METRIC_NORMALIZATION_VERSION_REQUIRED",
      ),
      unsupportedInternalClaimSampleCount,
      unsupportedInternalClaimAssessmentVersions: Object.freeze(
        [...unsupportedInternalClaimAssessmentVersions].sort((left, right) =>
          left.localeCompare(right),
        ),
      ),
      sampleBasis: Object.freeze({
        planned: run.plannedSampleCount,
        successful: run.successfulSampleCount,
        failed: run.failedSampleCount,
      }),
      samples: Object.freeze(samples),
    });
  }
}

function assertMaterializableRun(run: ConsumerObservationRun): void {
  if (
    run.experimentKind !== "source_nomination" ||
    !run.nominationContext ||
    (run.status !== "succeeded" &&
      run.status !== "partial" &&
      run.status !== "failed") ||
    !run.completedAt
  ) {
    throw new Error("TERMINAL_SOURCE_NOMINATION_CONSUMER_RUN_REQUIRED");
  }
}

function assertSurfaceBinding(
  run: ConsumerObservationRun,
  surfaceProfile: ConsumerSurfaceProfileVersion,
): void {
  if (
    surfaceProfile.id !== run.surfaceProfileVersionId ||
    !surfaceProfile.allowedCollectionMethods.includes(run.collectionMethod)
  ) {
    throw new Error("SOURCE_NOMINATION_METRIC_SURFACE_BINDING_MISMATCH");
  }
}

function assertResponseSurfaceBinding(
  response: ConfirmedConsumerObservationRecord,
  surfaceProfile: ConsumerSurfaceProfileVersion,
): void {
  if (
    response.surfaceProfileVersionId !== surfaceProfile.id ||
    response.adapterVersion !== surfaceProfile.adapterVersion ||
    response.visibleMetadata.productLabel !== surfaceProfile.productLabel
  ) {
    throw new Error("SOURCE_NOMINATION_METRIC_RESPONSE_SURFACE_MISMATCH");
  }
}

function assertTerminalRunSummary(
  run: ConsumerObservationRun,
  summary: ReturnType<typeof summarizeConsumerObservationRunTasks>,
): void {
  const expectedStatus =
    summary.successfulSampleCount === summary.plannedSampleCount
      ? "succeeded"
      : summary.failedSampleCount === summary.plannedSampleCount
        ? "failed"
        : "partial";
  if (
    summary.pendingSampleCount !== 0 ||
    summary.successfulSampleCount !== run.successfulSampleCount ||
    summary.failedSampleCount !== run.failedSampleCount ||
    run.status !== expectedStatus
  ) {
    throw new Error("SOURCE_NOMINATION_METRIC_RUN_SUMMARY_MISMATCH");
  }
}

function indexResponses(
  run: ConsumerObservationRun,
  responses: readonly ConfirmedConsumerObservationRecord[],
): Map<string, ConfirmedConsumerObservationRecord> {
  const result = new Map<string, ConfirmedConsumerObservationRecord>();
  for (const response of responses) {
    if (response.scopeId !== run.scopeId || response.runId !== run.id) {
      throw new Error("SOURCE_NOMINATION_METRIC_RESPONSE_RUN_MISMATCH");
    }
    if (result.has(response.observationTaskId)) {
      throw new Error("SOURCE_NOMINATION_METRIC_DUPLICATE_TASK_RESPONSE");
    }
    result.set(response.observationTaskId, response);
  }
  return result;
}

function assertConfirmedResponseTaskBinding(
  task: ConsumerObservationTask,
  response: ConfirmedConsumerObservationRecord,
): void {
  if (
    response.observationTaskId !== task.id ||
    response.scopeId !== task.scopeId ||
    response.runId !== task.runId ||
    response.querySnapshotItemId !== task.querySnapshotItemId ||
    response.sampleIndex !== task.sampleIndex ||
    response.id !== task.confirmedResponseId ||
    response.captureArtifactId !== task.captureArtifactId ||
    response.surfaceProfileVersionId !== task.surfaceProfileVersionId ||
    response.collectionMethod !== task.collectionMethod ||
    response.confirmedBy !== task.assignedTo ||
    response.confirmedAt !== task.confirmedAt
  ) {
    throw new Error("SOURCE_NOMINATION_METRIC_RESPONSE_TASK_BINDING_MISMATCH");
  }
}

function assertProjectedSampleBinding(
  run: ConsumerObservationRun,
  response: ConfirmedConsumerObservationRecord,
  review: SourceNominationParseReview,
  sample: SourceNominationMetricSample,
): void {
  const expectedValidationStatus =
    review.status === "confirmed" ? "human_confirmed" : review.status;
  if (
    sample.id !== response.id ||
    sample.querySnapshotItemId !== response.querySnapshotItemId ||
    sample.nominationContext !== run.nominationContext ||
    sample.validationStatus !== expectedValidationStatus ||
    ((review.status === "needs_review" || review.status === "rejected") &&
      sample.nominations.length > 0)
  ) {
    throw new Error("SOURCE_NOMINATION_METRIC_PROJECTED_SAMPLE_MISMATCH");
  }
}

function assertUniqueSampleIds(
  samples: readonly SourceNominationMetricSample[],
): void {
  const ids = new Set<string>();
  for (const sample of samples) {
    const id = normalizeRequiredText(
      sample.id,
      "SOURCE_NOMINATION_METRIC_SAMPLE_ID_REQUIRED",
    );
    if (ids.has(id)) {
      throw new Error("SOURCE_NOMINATION_METRIC_DUPLICATE_SAMPLE_ID");
    }
    ids.add(id);
  }
}

function compareTasks(
  left: ConsumerObservationTask,
  right: ConsumerObservationTask,
): number {
  return (
    left.querySnapshotItemId.localeCompare(right.querySnapshotItemId) ||
    left.sampleIndex - right.sampleIndex ||
    left.id.localeCompare(right.id)
  );
}

function normalizeRequiredText(value: string, errorCode: string): string {
  if (typeof value !== "string") {
    throw new Error(errorCode);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}
