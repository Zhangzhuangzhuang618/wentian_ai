import {
  assertObservationTaskTransition,
  evidenceGradeForConsumerCollectionMethod,
  type ConsumerCollectionMethod,
  type ObservationEvidenceGrade,
  type ObservationTaskStatus,
} from "./consumer-observation.ts";

export interface ConsumerObservationTask {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly surfaceProfileVersionId: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly assignedTo: string;
  readonly status: ObservationTaskStatus;
  readonly captureArtifactId: string | null;
  readonly confirmedResponseId: string | null;
  readonly capturedAt: string | null;
  readonly confirmedAt: string | null;
  readonly rejectedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateConsumerObservationTaskInput {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly surfaceProfileVersionId: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly assignedTo: string;
  readonly createdAt: string;
}

export interface ObservationTaskCommandContext {
  readonly scopeId: string;
  readonly userId: string;
  readonly taskVersion: number;
  readonly occurredAt: string;
}

export interface ConsumerCaptureArtifactBinding {
  readonly id: string;
  readonly scopeId: string;
  readonly observationTaskId: string;
  readonly capturedBy: string;
  readonly collectionMethod: ConsumerCollectionMethod;
}

export interface ConfirmedObservationResponseBinding {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly captureArtifactId: string;
}

export interface ConfirmObservationTaskResult {
  readonly task: ConsumerObservationTask;
  readonly evidenceGrade: Extract<
    ObservationEvidenceGrade,
    "web_confirmed_capture" | "web_confirmed_manual"
  >;
}

export interface RejectObservationTaskResult {
  readonly task: ConsumerObservationTask;
  readonly artifactIdToPurge: string;
  readonly rejectionReason: string;
}

export function createConsumerObservationTask(
  input: CreateConsumerObservationTaskInput,
): ConsumerObservationTask {
  if (!Number.isInteger(input.sampleIndex) || input.sampleIndex < 1) {
    throw new Error("INVALID_OBSERVATION_SAMPLE_INDEX");
  }
  if (
    input.collectionMethod !== "browser_assisted" &&
    input.collectionMethod !== "manual_import"
  ) {
    throw new Error("INVALID_CONSUMER_COLLECTION_METHOD");
  }
  const createdAt = normalizeTimestamp(input.createdAt);
  return freezeTask({
    id: normalizeRequired(input.id, "INVALID_OBSERVATION_TASK_ID"),
    scopeId: normalizeRequired(input.scopeId, "INVALID_SCOPE_ID"),
    runId: normalizeRequired(input.runId, "INVALID_RUN_ID"),
    querySnapshotItemId: normalizeRequired(
      input.querySnapshotItemId,
      "INVALID_QUERY_SNAPSHOT_ITEM_ID",
    ),
    sampleIndex: input.sampleIndex,
    surfaceProfileVersionId: normalizeRequired(
      input.surfaceProfileVersionId,
      "INVALID_SURFACE_PROFILE_VERSION_ID",
    ),
    collectionMethod: input.collectionMethod,
    assignedTo: normalizeRequired(input.assignedTo, "INVALID_ASSIGNEE"),
    status: "waiting_user",
    captureArtifactId: null,
    confirmedResponseId: null,
    capturedAt: null,
    confirmedAt: null,
    rejectedAt: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
}

export function claimConsumerObservationTask(
  task: ConsumerObservationTask,
  context: ObservationTaskCommandContext,
): ConsumerObservationTask {
  assertTaskCommandContext(task, context);
  assertObservationTaskTransition(task.status, "capturing");
  return advanceTask(task, "capturing", context.occurredAt, {});
}

export function submitConsumerCaptureArtifact(
  task: ConsumerObservationTask,
  artifact: ConsumerCaptureArtifactBinding,
  context: ObservationTaskCommandContext,
): ConsumerObservationTask {
  assertTaskCommandContext(task, context);
  assertObservationTaskTransition(task.status, "needs_review");
  assertArtifactBinding(task, artifact, context.userId);
  const artifactId = normalizeRequired(
    artifact.id,
    "INVALID_CAPTURE_ARTIFACT_ID",
  );
  return advanceTask(task, "needs_review", context.occurredAt, {
    captureArtifactId: artifactId,
    capturedAt: context.occurredAt,
  });
}

export function confirmConsumerObservationTask(
  task: ConsumerObservationTask,
  artifact: ConsumerCaptureArtifactBinding,
  response: ConfirmedObservationResponseBinding,
  context: ObservationTaskCommandContext,
): ConfirmObservationTaskResult {
  assertTaskCommandContext(task, context);
  assertObservationTaskTransition(task.status, "confirmed");
  if (!task.captureArtifactId || !task.capturedAt) {
    throw new Error("OBSERVATION_TASK_CAPTURE_REQUIRED");
  }
  assertArtifactBinding(task, artifact, context.userId);
  if (artifact.id !== task.captureArtifactId) {
    throw new Error("CONFIRMED_RESPONSE_ARTIFACT_MISMATCH");
  }
  if (response.scopeId !== task.scopeId) {
    throw new Error("CONFIRMED_RESPONSE_SCOPE_MISMATCH");
  }
  if (response.runId !== task.runId) {
    throw new Error("CONFIRMED_RESPONSE_RUN_MISMATCH");
  }
  if (response.querySnapshotItemId !== task.querySnapshotItemId) {
    throw new Error("CONFIRMED_RESPONSE_QUERY_MISMATCH");
  }
  if (response.sampleIndex !== task.sampleIndex) {
    throw new Error("CONFIRMED_RESPONSE_SAMPLE_MISMATCH");
  }
  if (response.captureArtifactId !== task.captureArtifactId) {
    throw new Error("CONFIRMED_RESPONSE_ARTIFACT_MISMATCH");
  }
  const confirmedResponseId = normalizeRequired(
    response.id,
    "INVALID_CONFIRMED_RESPONSE_ID",
  );
  const confirmedAt = normalizeTimestamp(context.occurredAt);
  assertNotBefore(confirmedAt, task.capturedAt);

  return Object.freeze({
    task: advanceTask(task, "confirmed", confirmedAt, {
      confirmedResponseId,
      confirmedAt,
    }),
    evidenceGrade: evidenceGradeForConsumerCollectionMethod(
      artifact.collectionMethod,
    ),
  });
}

export function rejectConsumerObservationTask(
  task: ConsumerObservationTask,
  rejectionReason: string,
  context: ObservationTaskCommandContext,
): RejectObservationTaskResult {
  assertTaskCommandContext(task, context);
  assertObservationTaskTransition(task.status, "rejected");
  if (!task.captureArtifactId || !task.capturedAt) {
    throw new Error("OBSERVATION_TASK_CAPTURE_REQUIRED");
  }
  const rejectedAt = normalizeTimestamp(context.occurredAt);
  assertNotBefore(rejectedAt, task.capturedAt);
  const normalizedReason = normalizeRequired(
    rejectionReason,
    "OBSERVATION_REJECTION_REASON_REQUIRED",
  );
  if (normalizedReason.length > 1_000) {
    throw new Error("OBSERVATION_REJECTION_REASON_TOO_LONG");
  }
  const artifactIdToPurge = task.captureArtifactId;

  return Object.freeze({
    task: advanceTask(task, "rejected", rejectedAt, {
      captureArtifactId: null,
      rejectedAt,
    }),
    artifactIdToPurge,
    rejectionReason: normalizedReason,
  });
}

function assertTaskCommandContext(
  task: ConsumerObservationTask,
  context: ObservationTaskCommandContext,
): void {
  if (context.scopeId !== task.scopeId) {
    throw new Error("OBSERVATION_TASK_SCOPE_MISMATCH");
  }
  if (context.userId !== task.assignedTo) {
    throw new Error("OBSERVATION_TASK_ASSIGNEE_MISMATCH");
  }
  if (context.taskVersion !== task.version) {
    throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
  }
  const occurredAt = normalizeTimestamp(context.occurredAt);
  assertNotBefore(occurredAt, task.updatedAt);
}

function assertArtifactBinding(
  task: ConsumerObservationTask,
  artifact: ConsumerCaptureArtifactBinding,
  userId: string,
): void {
  if (artifact.scopeId !== task.scopeId) {
    throw new Error("CAPTURE_ARTIFACT_SCOPE_MISMATCH");
  }
  if (artifact.observationTaskId !== task.id) {
    throw new Error("CAPTURE_ARTIFACT_TASK_MISMATCH");
  }
  if (artifact.capturedBy !== userId) {
    throw new Error("CAPTURE_ARTIFACT_USER_MISMATCH");
  }
  if (artifact.collectionMethod !== task.collectionMethod) {
    throw new Error("CAPTURE_ARTIFACT_COLLECTION_METHOD_MISMATCH");
  }
}

function advanceTask(
  task: ConsumerObservationTask,
  status: ObservationTaskStatus,
  occurredAt: string,
  changes: Partial<ConsumerObservationTask>,
): ConsumerObservationTask {
  return freezeTask({
    ...task,
    ...changes,
    status,
    version: task.version + 1,
    updatedAt: normalizeTimestamp(occurredAt),
  });
}

function freezeTask(task: ConsumerObservationTask): ConsumerObservationTask {
  return Object.freeze(task);
}

function normalizeRequired(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const normalized = normalizeRequired(value, "INVALID_TIMESTAMP");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return normalized;
}

function assertNotBefore(value: string, minimum: string): void {
  if (Date.parse(value) < Date.parse(minimum)) {
    throw new Error("OBSERVATION_TASK_TIMESTAMP_ORDER_INVALID");
  }
}
