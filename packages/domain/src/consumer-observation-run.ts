import {
  type ConsumerCollectionMethod,
  type ConsumerSessionConditions,
  type ConsumerSurfaceProfileVersion,
  type ObservationTaskStatus,
} from "./consumer-observation.ts";
import type { ConsumerObservationTask } from "./consumer-observation-task.ts";
import type { QuerySetSnapshot } from "./query-set-snapshot.ts";

export const CONSUMER_OBSERVATION_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
] as const;

export type ConsumerObservationRunStatus =
  (typeof CONSUMER_OBSERVATION_RUN_STATUSES)[number];
export type ConsumerObservationExperimentKind =
  "natural_answer" | "source_nomination";
export type ConsumerNominationContext =
  "unaided" | "search_assisted" | "surface_unknown";

export interface ConsumerObservationRun {
  readonly id: string;
  readonly scopeId: string;
  readonly querySetSnapshotId: string;
  readonly querySetSnapshotHash: string;
  readonly queryCount: number;
  readonly retrievalMode: "web_observed";
  readonly executionTargetType: "consumer_surface";
  readonly surfaceProfileVersionId: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly experimentKind: ConsumerObservationExperimentKind;
  readonly nominationContext: ConsumerNominationContext | null;
  readonly pairedRunId: string | null;
  readonly requestedSampleCount: number;
  readonly plannedSampleCount: number;
  readonly successfulSampleCount: number;
  readonly failedSampleCount: number;
  readonly sessionConditions: ConsumerSessionConditions;
  readonly status: ConsumerObservationRunStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
  readonly version: number;
}

export interface CreateConsumerObservationRunInput {
  readonly id: string;
  readonly snapshot: QuerySetSnapshot;
  readonly surfaceProfile: ConsumerSurfaceProfileVersion;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly experimentKind: ConsumerObservationExperimentKind;
  readonly pairedRunId?: string | null;
  readonly requestedSampleCount: number;
  readonly sessionConditions: ConsumerSessionConditions;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ConsumerObservationRunTaskSummary {
  readonly plannedSampleCount: number;
  readonly successfulSampleCount: number;
  readonly failedSampleCount: number;
  readonly pendingSampleCount: number;
}

export function createConsumerObservationRun(
  input: CreateConsumerObservationRunInput,
): ConsumerObservationRun {
  if (
    input.collectionMethod !== "browser_assisted" &&
    input.collectionMethod !== "manual_import"
  ) {
    throw new Error("INVALID_CONSUMER_COLLECTION_METHOD");
  }
  if (
    !Number.isInteger(input.requestedSampleCount) ||
    input.requestedSampleCount < 1 ||
    input.requestedSampleCount > 5
  ) {
    throw new Error("INVALID_CONSUMER_OBSERVATION_SAMPLE_COUNT");
  }
  if (input.surfaceProfile.status !== "active") {
    throw new Error("ACTIVE_CONSUMER_SURFACE_REQUIRED");
  }
  if (
    !input.surfaceProfile.allowedCollectionMethods.includes(
      input.collectionMethod,
    )
  ) {
    throw new Error("CONSUMER_COLLECTION_METHOD_NOT_ALLOWED");
  }
  if (
    input.experimentKind !== "natural_answer" &&
    input.experimentKind !== "source_nomination"
  ) {
    throw new Error("INVALID_CONSUMER_OBSERVATION_EXPERIMENT_KIND");
  }

  const createdAt = normalizeTimestamp(input.createdAt);
  const sessionConditions = normalizeSessionConditions(input.sessionConditions);
  const pairedRunId = normalizeOptionalText(input.pairedRunId);
  const plannedSampleCount =
    input.snapshot.queryCount * input.requestedSampleCount;

  return freezeRun({
    id: normalizeRequiredText(input.id, "INVALID_RUN_ID"),
    scopeId: normalizeRequiredText(input.snapshot.scopeId, "INVALID_SCOPE_ID"),
    querySetSnapshotId: normalizeRequiredText(
      input.snapshot.id,
      "INVALID_QUERY_SET_SNAPSHOT_ID",
    ),
    querySetSnapshotHash: normalizeRequiredText(
      input.snapshot.snapshotHash,
      "INVALID_QUERY_SET_SNAPSHOT_HASH",
    ),
    queryCount: input.snapshot.queryCount,
    retrievalMode: "web_observed",
    executionTargetType: "consumer_surface",
    surfaceProfileVersionId: input.surfaceProfile.id,
    collectionMethod: input.collectionMethod,
    experimentKind: input.experimentKind,
    nominationContext: deriveConsumerNominationContext(
      input.experimentKind,
      sessionConditions.searchMode,
    ),
    pairedRunId,
    requestedSampleCount: input.requestedSampleCount,
    plannedSampleCount,
    successfulSampleCount: 0,
    failedSampleCount: 0,
    sessionConditions,
    status: "queued",
    createdBy: normalizeRequiredText(input.createdBy, "INVALID_CREATED_BY"),
    createdAt,
    startedAt: null,
    completedAt: null,
    updatedAt: createdAt,
    version: 1,
  });
}

export function deriveConsumerNominationContext(
  experimentKind: ConsumerObservationExperimentKind,
  searchMode: ConsumerSessionConditions["searchMode"],
): ConsumerNominationContext | null {
  if (experimentKind === "natural_answer") {
    return null;
  }
  if (experimentKind !== "source_nomination") {
    throw new Error("INVALID_CONSUMER_OBSERVATION_EXPERIMENT_KIND");
  }
  if (searchMode === "disabled") {
    return "unaided";
  }
  if (searchMode === "enabled") {
    return "search_assisted";
  }
  if (searchMode === "unknown") {
    return "surface_unknown";
  }
  throw new Error("INVALID_CONSUMER_SEARCH_MODE");
}

export function summarizeConsumerObservationRunTasks(
  run: ConsumerObservationRun,
  snapshot: QuerySetSnapshot,
  tasks: readonly ConsumerObservationTask[],
): ConsumerObservationRunTaskSummary {
  assertRunSnapshotBinding(run, snapshot);
  if (tasks.length !== run.plannedSampleCount) {
    throw new Error("CONSUMER_OBSERVATION_TASK_COUNT_MISMATCH");
  }

  const expectedTaskKeys = new Set<string>();
  for (const item of snapshot.items) {
    for (
      let sampleIndex = 1;
      sampleIndex <= run.requestedSampleCount;
      sampleIndex += 1
    ) {
      expectedTaskKeys.add(taskKey(item.id, sampleIndex));
    }
  }

  let successfulSampleCount = 0;
  let failedSampleCount = 0;
  let pendingSampleCount = 0;
  const actualTaskKeys = new Set<string>();
  for (const task of tasks) {
    assertRunTaskBinding(run, task);
    const key = taskKey(task.querySnapshotItemId, task.sampleIndex);
    if (!expectedTaskKeys.has(key)) {
      throw new Error("CONSUMER_OBSERVATION_TASK_SNAPSHOT_MISMATCH");
    }
    if (actualTaskKeys.has(key)) {
      throw new Error("DUPLICATE_CONSUMER_OBSERVATION_TASK_SLOT");
    }
    actualTaskKeys.add(key);

    const outcome = classifyTaskStatus(task.status);
    if (outcome === "successful") {
      successfulSampleCount += 1;
    } else if (outcome === "failed") {
      failedSampleCount += 1;
    } else {
      pendingSampleCount += 1;
    }
  }

  if (actualTaskKeys.size !== expectedTaskKeys.size) {
    throw new Error("CONSUMER_OBSERVATION_TASK_SET_INCOMPLETE");
  }

  return Object.freeze({
    plannedSampleCount: run.plannedSampleCount,
    successfulSampleCount,
    failedSampleCount,
    pendingSampleCount,
  });
}

export function reconcileConsumerObservationRun(
  run: ConsumerObservationRun,
  snapshot: QuerySetSnapshot,
  tasks: readonly ConsumerObservationTask[],
  occurredAt: string,
): ConsumerObservationRun {
  const normalizedOccurredAt = normalizeTimestamp(occurredAt);
  assertTimestampNotBefore(normalizedOccurredAt, run.updatedAt);
  const summary = summarizeConsumerObservationRunTasks(run, snapshot, tasks);
  const nextStatus = deriveRunStatus(tasks, summary);

  if (isTerminalRunStatus(run.status)) {
    if (
      run.status === nextStatus &&
      run.successfulSampleCount === summary.successfulSampleCount &&
      run.failedSampleCount === summary.failedSampleCount
    ) {
      return run;
    }
    throw new Error("CONSUMER_OBSERVATION_RUN_TERMINAL");
  }
  if (
    run.status === nextStatus &&
    run.successfulSampleCount === summary.successfulSampleCount &&
    run.failedSampleCount === summary.failedSampleCount
  ) {
    return run;
  }

  const startedAt =
    run.startedAt ?? (nextStatus === "queued" ? null : normalizedOccurredAt);
  return freezeRun({
    ...run,
    status: nextStatus,
    successfulSampleCount: summary.successfulSampleCount,
    failedSampleCount: summary.failedSampleCount,
    startedAt,
    completedAt: isTerminalRunStatus(nextStatus) ? normalizedOccurredAt : null,
    updatedAt: normalizedOccurredAt,
    version: run.version + 1,
  });
}

export function cancelConsumerObservationRun(
  run: ConsumerObservationRun,
  snapshot: QuerySetSnapshot,
  tasks: readonly ConsumerObservationTask[],
  occurredAt: string,
): ConsumerObservationRun {
  const normalizedOccurredAt = normalizeTimestamp(occurredAt);
  assertTimestampNotBefore(normalizedOccurredAt, run.updatedAt);
  const summary = summarizeConsumerObservationRunTasks(run, snapshot, tasks);
  if (run.status === "cancelled") {
    return run;
  }
  if (isTerminalRunStatus(run.status) || summary.pendingSampleCount === 0) {
    throw new Error("CONSUMER_OBSERVATION_RUN_CANNOT_CANCEL");
  }
  return freezeRun({
    ...run,
    status: "cancelled",
    successfulSampleCount: summary.successfulSampleCount,
    failedSampleCount: summary.failedSampleCount,
    startedAt: run.startedAt,
    completedAt: normalizedOccurredAt,
    updatedAt: normalizedOccurredAt,
    version: run.version + 1,
  });
}

function deriveRunStatus(
  tasks: readonly ConsumerObservationTask[],
  summary: ConsumerObservationRunTaskSummary,
): ConsumerObservationRunStatus {
  if (summary.pendingSampleCount > 0) {
    return tasks.every((task) => task.status === "waiting_user")
      ? "queued"
      : "running";
  }
  if (summary.successfulSampleCount === summary.plannedSampleCount) {
    return "succeeded";
  }
  if (summary.failedSampleCount === summary.plannedSampleCount) {
    return "failed";
  }
  return "partial";
}

function classifyTaskStatus(
  status: ObservationTaskStatus,
): "successful" | "failed" | "pending" {
  if (status === "confirmed") {
    return "successful";
  }
  if (status === "rejected" || status === "expired" || status === "cancelled") {
    return "failed";
  }
  return "pending";
}

function assertRunSnapshotBinding(
  run: ConsumerObservationRun,
  snapshot: QuerySetSnapshot,
): void {
  if (
    snapshot.id !== run.querySetSnapshotId ||
    snapshot.scopeId !== run.scopeId ||
    snapshot.snapshotHash !== run.querySetSnapshotHash ||
    snapshot.queryCount !== run.queryCount ||
    snapshot.queryCount * run.requestedSampleCount !== run.plannedSampleCount
  ) {
    throw new Error("CONSUMER_OBSERVATION_RUN_SNAPSHOT_MISMATCH");
  }
}

function assertRunTaskBinding(
  run: ConsumerObservationRun,
  task: ConsumerObservationTask,
): void {
  if (
    task.scopeId !== run.scopeId ||
    task.runId !== run.id ||
    task.surfaceProfileVersionId !== run.surfaceProfileVersionId ||
    task.collectionMethod !== run.collectionMethod
  ) {
    throw new Error("CONSUMER_OBSERVATION_RUN_TASK_BINDING_MISMATCH");
  }
}

function normalizeSessionConditions(
  input: ConsumerSessionConditions,
): ConsumerSessionConditions {
  if (
    input.searchMode !== "enabled" &&
    input.searchMode !== "disabled" &&
    input.searchMode !== "unknown"
  ) {
    throw new Error("INVALID_CONSUMER_SEARCH_MODE");
  }
  if (
    typeof input.isNewConversation !== "boolean" ||
    typeof input.isLoggedIn !== "boolean"
  ) {
    throw new Error("INVALID_CONSUMER_SESSION_BOOLEAN");
  }
  if (
    (input.memoryEnabled !== null &&
      typeof input.memoryEnabled !== "boolean") ||
    (input.personalizationEnabled !== null &&
      typeof input.personalizationEnabled !== "boolean")
  ) {
    throw new Error("INVALID_CONSUMER_SESSION_NULLABLE_BOOLEAN");
  }
  return Object.freeze({
    searchMode: input.searchMode,
    isNewConversation: input.isNewConversation,
    isLoggedIn: input.isLoggedIn,
    memoryEnabled: input.memoryEnabled,
    personalizationEnabled: input.personalizationEnabled,
    locale: normalizeRequiredText(input.locale, "INVALID_LOCALE"),
    region: normalizeOptionalText(input.region),
  });
}

function taskKey(querySnapshotItemId: string, sampleIndex: number): string {
  return JSON.stringify([querySnapshotItemId, sampleIndex]);
}

function isTerminalRunStatus(status: ConsumerObservationRunStatus): boolean {
  return (
    status === "succeeded" ||
    status === "partial" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function freezeRun(run: ConsumerObservationRun): ConsumerObservationRun {
  return Object.freeze(run);
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTimestamp(value: string): string {
  const normalized = normalizeRequiredText(value, "INVALID_TIMESTAMP");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return normalized;
}

function assertTimestampNotBefore(value: string, minimum: string): void {
  if (Date.parse(value) < Date.parse(minimum)) {
    throw new Error("CONSUMER_OBSERVATION_RUN_TIMESTAMP_ORDER_INVALID");
  }
}
