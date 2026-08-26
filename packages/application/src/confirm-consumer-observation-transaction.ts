import {
  confirmConsumerObservationTask,
  hasScopeAccess,
  type AiVisibilityCitedSourceEvent,
  type ConfirmedConsumerObservationRecord,
  type ConsumerObservationTask,
  type ObservationEvidenceGrade,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  ConfirmedConsumerObservationSourceEventProjector,
  ConsumerCaptureArtifactBindingRepository,
  ConsumerObservationConfirmationTransactionRepository,
  ConsumerObservationRunRepository,
  ConsumerObservationTaskRepository,
  ConsumerSurfaceProfileVersionRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";
import { buildConfirmedConsumerObservationRecord } from "./store-confirmed-consumer-observation-record.ts";

export interface ConfirmConsumerObservationTransactionCommand {
  readonly scopeId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly occurredAt: string;
}

export interface ConfirmConsumerObservationTransactionResult {
  readonly task: ConsumerObservationTask;
  readonly record: ConfirmedConsumerObservationRecord;
  readonly sourceEvents: readonly AiVisibilityCitedSourceEvent[];
  readonly evidenceGrade: Extract<
    ObservationEvidenceGrade,
    "web_confirmed_capture" | "web_confirmed_manual"
  >;
}

export interface ConfirmConsumerObservationTransactionDependencies {
  readonly tasks: ConsumerObservationTaskRepository;
  readonly runs: ConsumerObservationRunRepository;
  readonly captureArtifacts: ConsumerCaptureArtifactBindingRepository;
  readonly surfaceProfiles: ConsumerSurfaceProfileVersionRepository;
  readonly sourceEventProjector: ConfirmedConsumerObservationSourceEventProjector;
  readonly transactions: ConsumerObservationConfirmationTransactionRepository;
  readonly newId: () => string;
}

export class ConfirmConsumerObservationTransactionService {
  private readonly dependencies: ConfirmConsumerObservationTransactionDependencies;

  constructor(dependencies: ConfirmConsumerObservationTransactionDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: ConfirmConsumerObservationTransactionCommand,
  ): Promise<ConfirmConsumerObservationTransactionResult> {
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
    const artifact = task.captureArtifactId
      ? await this.dependencies.captureArtifacts.findById(
          command.scopeId,
          task.captureArtifactId,
        )
      : null;
    if (!artifact) {
      throw new Error("OBSERVATION_TASK_CAPTURE_REQUIRED");
    }
    const [run, surfaceProfile] = await Promise.all([
      this.dependencies.runs.findRunById(command.scopeId, task.runId),
      this.dependencies.surfaceProfiles.findById(task.surfaceProfileVersionId),
    ]);
    if (!run || !surfaceProfile) {
      throw new Error("CONFIRMED_OBSERVATION_DEPENDENCY_NOT_FOUND");
    }

    const response = {
      id: this.dependencies.newId(),
      scopeId: task.scopeId,
      runId: task.runId,
      querySnapshotItemId: task.querySnapshotItemId,
      sampleIndex: task.sampleIndex,
      captureArtifactId: artifact.id,
    };
    const confirmed = confirmConsumerObservationTask(task, artifact, response, {
      scopeId: command.scopeId,
      userId: principal.userId,
      taskVersion: command.taskVersion,
      occurredAt: command.occurredAt,
    });
    const record = buildConfirmedConsumerObservationRecord({
      task: confirmed.task,
      run,
      artifact,
      surfaceProfile,
    });
    const sourceEvents =
      run.experimentKind === "natural_answer"
        ? this.dependencies.sourceEventProjector.project({
            record,
            newId: this.dependencies.newId,
            createdAt: command.occurredAt,
          })
        : Object.freeze([]);

    await this.dependencies.transactions.commitConfirmation({
      task: confirmed.task,
      expectedTaskVersion: task.version,
      record,
      sourceEvents,
    });
    return Object.freeze({
      task: confirmed.task,
      record,
      sourceEvents,
      evidenceGrade: confirmed.evidenceGrade,
    });
  }
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
