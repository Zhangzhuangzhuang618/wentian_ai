import {
  assertConsumerCaptureEvidenceArtifactIntegrity,
  assertCaptureTokenUsable,
  claimConsumerObservationTask,
  confirmConsumerObservationTask,
  hasScopeAccess,
  isConsumerCaptureEvidenceArtifact,
  rejectConsumerObservationTask,
  submitConsumerCaptureArtifact,
  type ConfirmedObservationResponseBinding,
  type ConfirmObservationTaskResult,
  type ConsumerCaptureArtifact,
  type ConsumerObservationTask,
  type RejectObservationTaskResult,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  CaptureTokenNonceRepository,
  CaptureTokenVerifier,
  ConsumerCaptureArtifactBindingRepository,
  ConsumerCaptureSubmissionTransactionRepository,
  ConsumerObservationTaskRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

interface ObservationTaskCommand {
  readonly scopeId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly occurredAt: string;
}

export interface SubmitConsumerCaptureCommand extends ObservationTaskCommand {
  readonly captureToken: string;
  readonly requestOrigin: string;
  readonly artifact: ConsumerCaptureArtifact;
}

export interface ConfirmConsumerObservationCommand extends ObservationTaskCommand {
  readonly response: ConfirmedObservationResponseBinding;
}

export interface RejectConsumerObservationCommand extends ObservationTaskCommand {
  readonly rejectionReason: string;
}

export interface ConsumerObservationWorkflowDependencies {
  readonly tasks: ConsumerObservationTaskRepository;
  readonly captureArtifacts: ConsumerCaptureArtifactBindingRepository;
  readonly captureTokens: CaptureTokenVerifier;
  readonly captureTokenNonces: CaptureTokenNonceRepository;
  readonly systemInstanceId: string;
  readonly captureSubmissions?: ConsumerCaptureSubmissionTransactionRepository;
}

export class ConsumerObservationWorkflowService {
  private readonly dependencies: ConsumerObservationWorkflowDependencies;

  constructor(dependencies: ConsumerObservationWorkflowDependencies) {
    this.dependencies = dependencies;
  }

  async claim(
    principal: WentianPrincipal,
    command: ObservationTaskCommand,
  ): Promise<ConsumerObservationTask> {
    const task = await this.requireTask(principal, command);
    const next = claimConsumerObservationTask(task, {
      scopeId: command.scopeId,
      userId: principal.userId,
      taskVersion: command.taskVersion,
      occurredAt: command.occurredAt,
    });
    return this.dependencies.tasks.save(next, task.version);
  }

  async submitCapture(
    principal: WentianPrincipal,
    command: SubmitConsumerCaptureCommand,
  ): Promise<ConsumerObservationTask> {
    const task = await this.requireTask(principal, command);
    const captureTokenClaims = await this.dependencies.captureTokens.verify(
      command.captureToken,
    );
    assertCaptureTokenUsable(captureTokenClaims, {
      systemInstanceId: this.dependencies.systemInstanceId,
      scopeId: task.scopeId,
      taskId: task.id,
      userId: principal.userId,
      requestOrigin: command.requestOrigin,
      now: command.occurredAt,
      alreadyConsumed: false,
    });
    const next = submitConsumerCaptureArtifact(task, command.artifact, {
      scopeId: command.scopeId,
      userId: principal.userId,
      taskVersion: command.taskVersion,
      occurredAt: command.occurredAt,
    });
    if (isConsumerCaptureEvidenceArtifact(command.artifact)) {
      assertConsumerCaptureEvidenceArtifactIntegrity(command.artifact);
      if (command.artifact.createdAt !== next.capturedAt) {
        throw new Error("CAPTURE_ARTIFACT_TIMESTAMP_MISMATCH");
      }
    }
    if (this.dependencies.captureSubmissions) {
      await this.dependencies.captureSubmissions.commitCapture({
        task: next,
        expectedTaskVersion: task.version,
        artifact: command.artifact,
        captureTokenNonce: captureTokenClaims.nonce,
        consumedAt: command.occurredAt,
      });
      return next;
    }
    if (
      !(await this.dependencies.captureTokenNonces.consumeOnce(
        captureTokenClaims.nonce,
      ))
    ) {
      throw new Error("CAPTURE_TOKEN_ALREADY_CONSUMED");
    }
    await this.dependencies.captureArtifacts.create(command.artifact);
    return this.dependencies.tasks.save(next, task.version);
  }

  async confirm(
    principal: WentianPrincipal,
    command: ConfirmConsumerObservationCommand,
  ): Promise<ConfirmObservationTaskResult> {
    const task = await this.requireTask(principal, command);
    const artifact = task.captureArtifactId
      ? await this.dependencies.captureArtifacts.findById(
          task.scopeId,
          task.captureArtifactId,
        )
      : null;
    if (!artifact) {
      throw new Error("OBSERVATION_TASK_CAPTURE_REQUIRED");
    }
    if (isConsumerCaptureEvidenceArtifact(artifact)) {
      assertConsumerCaptureEvidenceArtifactIntegrity(artifact);
    }
    const result = confirmConsumerObservationTask(
      task,
      artifact,
      command.response,
      {
        scopeId: command.scopeId,
        userId: principal.userId,
        taskVersion: command.taskVersion,
        occurredAt: command.occurredAt,
      },
    );
    const saved = await this.dependencies.tasks.save(result.task, task.version);
    return Object.freeze({ ...result, task: saved });
  }

  async reject(
    principal: WentianPrincipal,
    command: RejectConsumerObservationCommand,
  ): Promise<RejectObservationTaskResult> {
    const task = await this.requireTask(principal, command);
    const artifact = task.captureArtifactId
      ? await this.dependencies.captureArtifacts.findById(
          task.scopeId,
          task.captureArtifactId,
        )
      : null;
    if (!artifact) {
      throw new Error("OBSERVATION_TASK_CAPTURE_REQUIRED");
    }
    const result = rejectConsumerObservationTask(
      task,
      command.rejectionReason,
      {
        scopeId: command.scopeId,
        userId: principal.userId,
        taskVersion: command.taskVersion,
        occurredAt: command.occurredAt,
      },
    );
    const saved = await this.dependencies.tasks.save(result.task, task.version);
    const purged = await this.dependencies.captureArtifacts.purge(
      task.scopeId,
      result.artifactIdToPurge,
    );
    if (!purged) {
      throw new Error("CAPTURE_ARTIFACT_PURGE_FAILED");
    }
    return Object.freeze({ ...result, task: saved });
  }

  private async requireTask(
    principal: WentianPrincipal,
    command: Pick<ObservationTaskCommand, "scopeId" | "taskId">,
  ): Promise<ConsumerObservationTask> {
    if (!hasScopeAccess(principal, command.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (
      principal.role !== "owner" &&
      principal.role !== "admin" &&
      principal.role !== "analyst"
    ) {
      throw new WentianApplicationError("ACTION_FORBIDDEN");
    }
    const task = await this.dependencies.tasks.findById(
      command.scopeId,
      command.taskId,
    );
    if (!task) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    return task;
  }
}
