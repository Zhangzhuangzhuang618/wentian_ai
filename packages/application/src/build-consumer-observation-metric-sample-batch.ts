import {
  hasScopeAccess,
  summarizeConsumerObservationRunTasks,
  type ConfirmedConsumerObservationRecord,
  type ConsumerObservationMetricSample,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type ConsumerSurfaceProfileVersion,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  ConfirmedConsumerObservationMetricSampleProjector,
  ConfirmedConsumerObservationRecordRepository,
  ConsumerObservationMetricSampleBatch,
  ConsumerObservationRunRepository,
  ConsumerSurfaceProfileVersionRepository,
  QuerySetSnapshotRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface BuildConsumerObservationMetricSampleBatchCommand {
  readonly scopeId: string;
  readonly runId: string;
}

export interface BuildConsumerObservationMetricSampleBatchDependencies {
  readonly runs: ConsumerObservationRunRepository;
  readonly snapshots: QuerySetSnapshotRepository;
  readonly records: ConfirmedConsumerObservationRecordRepository;
  readonly surfaceProfiles: ConsumerSurfaceProfileVersionRepository;
  readonly metricProjector: ConfirmedConsumerObservationMetricSampleProjector;
}

export class BuildConsumerObservationMetricSampleBatchService {
  private readonly dependencies: BuildConsumerObservationMetricSampleBatchDependencies;

  constructor(
    dependencies: BuildConsumerObservationMetricSampleBatchDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: BuildConsumerObservationMetricSampleBatchCommand,
  ): Promise<ConsumerObservationMetricSampleBatch> {
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
      throw new Error("CONSUMER_METRIC_RUN_IDENTITY_MISMATCH");
    }
    assertMaterializableRun(run);

    const [snapshot, tasks, records, surfaceProfile] = await Promise.all([
      this.dependencies.snapshots.findById(
        command.scopeId,
        run.querySetSnapshotId,
      ),
      this.dependencies.runs.listTasksForRun(command.scopeId, run.id),
      this.dependencies.records.listByRun(command.scopeId, run.id),
      this.dependencies.surfaceProfiles.findById(run.surfaceProfileVersionId),
    ]);
    if (!snapshot) {
      throw new Error("CONSUMER_METRIC_RUN_SNAPSHOT_NOT_FOUND");
    }
    if (!surfaceProfile) {
      throw new Error("CONSUMER_METRIC_SURFACE_PROFILE_NOT_FOUND");
    }
    assertSurfaceBinding(run, surfaceProfile);
    const summary = summarizeConsumerObservationRunTasks(run, snapshot, tasks);
    assertTerminalRunSummary(run, summary);

    const recordsByTaskId = indexRecords(run, records);
    const samples: ConsumerObservationMetricSample[] = [];
    for (const task of tasks) {
      const record = recordsByTaskId.get(task.id);
      if (task.status === "confirmed") {
        if (!record) {
          throw new Error("CONSUMER_METRIC_CONFIRMED_RECORD_MISSING");
        }
        assertConfirmedRecordTaskBinding(task, record);
        const sample = this.dependencies.metricProjector.project({
          run,
          record,
          surfaceProfile,
        });
        assertProjectedSampleBinding(run, record, surfaceProfile, sample);
        samples.push(sample);
        recordsByTaskId.delete(task.id);
      } else {
        if (record) {
          throw new Error("CONSUMER_METRIC_RECORD_FOR_UNCONFIRMED_TASK");
        }
        if (task.status === "rejected") {
          samples.push(projectRejectedTask(run, task, surfaceProfile));
        }
      }
    }
    if (recordsByTaskId.size > 0) {
      throw new Error("CONSUMER_METRIC_RECORD_TASK_SET_MISMATCH");
    }
    assertUniqueSampleIds(samples);

    return Object.freeze({
      scopeId: run.scopeId,
      runId: run.id,
      querySetSnapshotHash: run.querySetSnapshotHash,
      querySetSourceType: snapshot.source.type,
      geoConnectorContractVersion: snapshot.source.contractVersion ?? null,
      experimentKind: run.experimentKind,
      collectionMethod: run.collectionMethod,
      nominationContext: run.nominationContext,
      surfaceProfileVersionId: run.surfaceProfileVersionId,
      consumerSurfaceCode: surfaceProfile.surfaceCode,
      normalizationVersion: normalizeRequiredText(
        this.dependencies.metricProjector.normalizationVersion,
        "CONSUMER_METRIC_NORMALIZATION_VERSION_REQUIRED",
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
    run.experimentKind !== "natural_answer" ||
    (run.status !== "succeeded" &&
      run.status !== "partial" &&
      run.status !== "failed") ||
    !run.completedAt
  ) {
    throw new Error("TERMINAL_NATURAL_ANSWER_CONSUMER_RUN_REQUIRED");
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
    throw new Error("CONSUMER_METRIC_SURFACE_BINDING_MISMATCH");
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
    throw new Error("CONSUMER_METRIC_RUN_SUMMARY_MISMATCH");
  }
}

function indexRecords(
  run: ConsumerObservationRun,
  records: readonly ConfirmedConsumerObservationRecord[],
): Map<string, ConfirmedConsumerObservationRecord> {
  const result = new Map<string, ConfirmedConsumerObservationRecord>();
  for (const record of records) {
    if (record.scopeId !== run.scopeId || record.runId !== run.id) {
      throw new Error("CONSUMER_METRIC_RECORD_RUN_MISMATCH");
    }
    if (result.has(record.observationTaskId)) {
      throw new Error("CONSUMER_METRIC_DUPLICATE_TASK_RECORD");
    }
    result.set(record.observationTaskId, record);
  }
  return result;
}

function assertConfirmedRecordTaskBinding(
  task: ConsumerObservationTask,
  record: ConfirmedConsumerObservationRecord,
): void {
  if (
    record.observationTaskId !== task.id ||
    record.scopeId !== task.scopeId ||
    record.runId !== task.runId ||
    record.querySnapshotItemId !== task.querySnapshotItemId ||
    record.sampleIndex !== task.sampleIndex ||
    record.id !== task.confirmedResponseId ||
    record.captureArtifactId !== task.captureArtifactId ||
    record.surfaceProfileVersionId !== task.surfaceProfileVersionId ||
    record.collectionMethod !== task.collectionMethod ||
    record.confirmedBy !== task.assignedTo ||
    record.confirmedAt !== task.confirmedAt
  ) {
    throw new Error("CONSUMER_METRIC_RECORD_TASK_BINDING_MISMATCH");
  }
}

function assertProjectedSampleBinding(
  run: ConsumerObservationRun,
  record: ConfirmedConsumerObservationRecord,
  surfaceProfile: ConsumerSurfaceProfileVersion,
  sample: ConsumerObservationMetricSample,
): void {
  const conditions = run.sessionConditions;
  if (
    sample.id !== record.id ||
    sample.querySnapshotItemId !== record.querySnapshotItemId ||
    sample.collectionMethod !== run.collectionMethod ||
    sample.verificationStatus !== "confirmed" ||
    sample.evidenceGrade !== record.evidenceGrade ||
    !sample.sourceOrderAvailable ||
    sample.configuration.surfaceCode !== surfaceProfile.surfaceCode ||
    sample.configuration.surfaceModelLabel !==
      record.visibleMetadata.surfaceModelLabel ||
    sample.configuration.searchMode !== conditions.searchMode ||
    sample.configuration.isNewConversation !== conditions.isNewConversation ||
    sample.configuration.isLoggedIn !== conditions.isLoggedIn ||
    sample.configuration.memoryEnabled !== conditions.memoryEnabled ||
    sample.configuration.personalizationEnabled !==
      conditions.personalizationEnabled ||
    sample.configuration.locale !== conditions.locale ||
    sample.configuration.region !== conditions.region
  ) {
    throw new Error("CONSUMER_METRIC_PROJECTED_SAMPLE_BINDING_MISMATCH");
  }
}

function assertUniqueSampleIds(
  samples: readonly ConsumerObservationMetricSample[],
): void {
  const ids = new Set<string>();
  for (const sample of samples) {
    const id = normalizeRequiredText(
      sample.id,
      "CONSUMER_METRIC_SAMPLE_ID_REQUIRED",
    );
    if (ids.has(id)) {
      throw new Error("CONSUMER_METRIC_DUPLICATE_SAMPLE_ID");
    }
    ids.add(id);
  }
}

function projectRejectedTask(
  run: ConsumerObservationRun,
  task: ConsumerObservationTask,
  surfaceProfile: ConsumerSurfaceProfileVersion,
): ConsumerObservationMetricSample {
  return Object.freeze({
    id: `rejected-task:${task.id}`,
    querySnapshotItemId: task.querySnapshotItemId,
    collectionMethod: task.collectionMethod,
    verificationStatus: "rejected",
    evidenceGrade: null,
    configuration: Object.freeze({
      surfaceCode: surfaceProfile.surfaceCode,
      surfaceModelLabel: null,
      ...run.sessionConditions,
    }),
    sourceOrderAvailable: false,
    citations: Object.freeze([]),
  });
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
