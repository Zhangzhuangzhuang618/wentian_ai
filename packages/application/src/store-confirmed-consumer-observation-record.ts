import { isDeepStrictEqual } from "node:util";

import {
  assertConsumerCaptureEvidenceArtifactIntegrity,
  createConfirmedConsumerObservationRecord,
  hasSameConsumerSessionConditions,
  hasScopeAccess,
  isConsumerCaptureEvidenceArtifact,
  type ConfirmedConsumerObservationRecord,
  type ConsumerCaptureArtifact,
  type ConsumerCaptureEvidenceArtifact,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type ConsumerSurfaceProfileVersion,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  ConfirmedConsumerObservationRecordRepository,
  ConsumerCaptureArtifactBindingRepository,
  ConsumerObservationRunRepository,
  ConsumerObservationTaskRepository,
  ConsumerSurfaceProfileVersionRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface StoreConfirmedConsumerObservationRecordCommand {
  readonly scopeId: string;
  readonly taskId: string;
}

export interface StoreConfirmedConsumerObservationRecordResult {
  readonly record: ConfirmedConsumerObservationRecord;
  readonly created: boolean;
}

export interface StoreConfirmedConsumerObservationRecordDependencies {
  readonly tasks: ConsumerObservationTaskRepository;
  readonly runs: ConsumerObservationRunRepository;
  readonly captureArtifacts: ConsumerCaptureArtifactBindingRepository;
  readonly surfaceProfiles: ConsumerSurfaceProfileVersionRepository;
  readonly records: ConfirmedConsumerObservationRecordRepository;
}

export class StoreConfirmedConsumerObservationRecordService {
  private readonly dependencies: StoreConfirmedConsumerObservationRecordDependencies;

  constructor(
    dependencies: StoreConfirmedConsumerObservationRecordDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: StoreConfirmedConsumerObservationRecordCommand,
  ): Promise<StoreConfirmedConsumerObservationRecordResult> {
    assertWriteAccess(principal, command.scopeId);
    const task = await this.dependencies.tasks.findById(
      command.scopeId,
      command.taskId,
    );
    if (!task) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (principal.userId !== task.assignedTo) {
      throw new WentianApplicationError("ACTION_FORBIDDEN");
    }
    assertConfirmedTask(task);

    const [run, artifact, surfaceProfile] = await Promise.all([
      this.dependencies.runs.findRunById(command.scopeId, task.runId),
      this.dependencies.captureArtifacts.findById(
        command.scopeId,
        task.captureArtifactId!,
      ),
      this.dependencies.surfaceProfiles.findById(task.surfaceProfileVersionId),
    ]);
    if (!run || !artifact || !surfaceProfile) {
      throw new Error("CONFIRMED_OBSERVATION_DEPENDENCY_NOT_FOUND");
    }
    const record = buildConfirmedConsumerObservationRecord({
      task,
      run,
      artifact,
      surfaceProfile,
    });

    const existing = await this.dependencies.records.findRecordById(
      record.scopeId,
      record.id,
    );
    if (existing) {
      return sameRecord(existing, record)
        ? Object.freeze({ record: existing, created: false })
        : conflict();
    }

    try {
      await this.dependencies.records.create(record);
      return Object.freeze({ record, created: true });
    } catch (error) {
      const concurrent = await this.dependencies.records.findRecordById(
        record.scopeId,
        record.id,
      );
      if (concurrent && sameRecord(concurrent, record)) {
        return Object.freeze({ record: concurrent, created: false });
      }
      throw error;
    }
  }
}

export interface BuildConfirmedConsumerObservationRecordInput {
  readonly task: ConsumerObservationTask;
  readonly run: ConsumerObservationRun;
  readonly artifact: ConsumerCaptureArtifact;
  readonly surfaceProfile: ConsumerSurfaceProfileVersion;
}

export function buildConfirmedConsumerObservationRecord(
  input: BuildConfirmedConsumerObservationRecordInput,
): ConfirmedConsumerObservationRecord {
  assertConfirmedTask(input.task);
  if (!isConsumerCaptureEvidenceArtifact(input.artifact)) {
    throw new Error("CAPTURE_EVIDENCE_ARTIFACT_REQUIRED");
  }
  assertConsumerCaptureEvidenceArtifactIntegrity(input.artifact);
  assertBindings(input.task, input.run, input.artifact, input.surfaceProfile);

  const record = createConfirmedConsumerObservationRecord({
    id: input.task.confirmedResponseId!,
    scopeId: input.task.scopeId,
    runId: input.task.runId,
    querySnapshotItemId: input.task.querySnapshotItemId,
    sampleIndex: input.task.sampleIndex,
    observationTaskId: input.task.id,
    captureArtifactId: input.task.captureArtifactId!,
    surfaceProfileVersionId: input.task.surfaceProfileVersionId,
    collectionMethod: input.task.collectionMethod,
    answerText: input.artifact.answerText,
    visibleCitations: input.artifact.visibleCitations,
    visibleMetadata: input.artifact.visibleMetadata,
    screenshotMediaAssetId: input.artifact.screenshotMediaAssetId,
    sanitizedDomObjectKey: input.artifact.sanitizedDomObjectKey,
    adapterVersion: input.artifact.adapterVersion,
    confirmedBy: input.task.assignedTo,
    confirmedAt: input.task.confirmedAt!,
  });
  const observedAt = Date.parse(record.visibleMetadata.observedAt);
  if (
    observedAt < Date.parse(input.task.createdAt) ||
    observedAt > Date.parse(input.task.capturedAt!)
  ) {
    throw new Error("OBSERVATION_OUTSIDE_TASK_WINDOW");
  }
  return record;
}

function assertWriteAccess(principal: WentianPrincipal, scopeId: string): void {
  if (!hasScopeAccess(principal, scopeId)) {
    throw new WentianApplicationError("RESOURCE_NOT_FOUND");
  }
  if (
    principal.role !== "owner" &&
    principal.role !== "admin" &&
    principal.role !== "analyst"
  ) {
    throw new WentianApplicationError("ACTION_FORBIDDEN");
  }
}

function assertConfirmedTask(task: ConsumerObservationTask): void {
  if (
    task.status !== "confirmed" ||
    !task.captureArtifactId ||
    !task.capturedAt ||
    !task.confirmedResponseId ||
    !task.confirmedAt
  ) {
    throw new Error("OBSERVATION_TASK_NOT_CONFIRMED");
  }
}

function assertBindings(
  task: ConsumerObservationTask,
  run: ConsumerObservationRun,
  artifact: ConsumerCaptureEvidenceArtifact,
  surfaceProfile: ConsumerSurfaceProfileVersion,
): void {
  if (
    run.scopeId !== task.scopeId ||
    run.id !== task.runId ||
    run.surfaceProfileVersionId !== task.surfaceProfileVersionId ||
    run.collectionMethod !== task.collectionMethod ||
    artifact.id !== task.captureArtifactId ||
    artifact.scopeId !== task.scopeId ||
    artifact.observationTaskId !== task.id ||
    artifact.capturedBy !== task.assignedTo ||
    artifact.collectionMethod !== task.collectionMethod
  ) {
    throw new Error("CONFIRMED_OBSERVATION_BINDING_MISMATCH");
  }
  if (artifact.createdAt !== task.capturedAt) {
    throw new Error("CONFIRMED_OBSERVATION_CAPTURE_TIME_MISMATCH");
  }
  if (
    surfaceProfile.id !== task.surfaceProfileVersionId ||
    surfaceProfile.adapterVersion !== artifact.adapterVersion ||
    surfaceProfile.productLabel !== artifact.visibleMetadata.productLabel ||
    !surfaceProfile.allowedCollectionMethods.includes(task.collectionMethod)
  ) {
    throw new Error("CONFIRMED_OBSERVATION_SURFACE_MISMATCH");
  }
  if (
    !surfaceProfile.visibleSourceCapabilities.screenshot ||
    (artifact.visibleCitations.length > 0 &&
      !surfaceProfile.visibleSourceCapabilities.visibleCitations) ||
    (artifact.sanitizedDomObjectKey &&
      !surfaceProfile.visibleSourceCapabilities.sanitizedDom)
  ) {
    throw new Error("CONFIRMED_OBSERVATION_SURFACE_CAPABILITY_MISMATCH");
  }
  if (
    !hasSameConsumerSessionConditions(
      run.sessionConditions,
      artifact.visibleMetadata,
    )
  ) {
    throw new Error("CONFIRMED_OBSERVATION_SESSION_MISMATCH");
  }
}

function sameRecord(
  left: ConfirmedConsumerObservationRecord,
  right: ConfirmedConsumerObservationRecord,
): boolean {
  return isDeepStrictEqual(left, right);
}

function conflict(): never {
  throw new Error("CONFIRMED_CONSUMER_OBSERVATION_RECORD_MISMATCH");
}
