import {
  createConsumerObservationRun,
  createConsumerObservationTask,
  hasScopeAccess,
  type ConsumerCollectionMethod,
  type ConsumerObservationExperimentKind,
  type ConsumerObservationRun,
  type ConsumerObservationTask,
  type ConsumerSessionConditions,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  ConsumerObservationRunRepository,
  ConsumerSurfaceProfileVersionRepository,
  QuerySetSnapshotRepository,
  ScopeRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface CreateConsumerObservationRunCommand {
  readonly scopeId: string;
  readonly querySetSnapshotId: string;
  readonly surfaceCode: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly experimentKind: ConsumerObservationExperimentKind;
  readonly sampleCount: number;
  readonly sessionConditions: ConsumerSessionConditions;
  readonly pairedRunId?: string | null;
}

export interface CreateConsumerObservationRunResult {
  readonly run: ConsumerObservationRun;
  readonly tasks: readonly ConsumerObservationTask[];
}

export interface CreateConsumerObservationRunDependencies {
  readonly scopes: ScopeRepository;
  readonly snapshots: QuerySetSnapshotRepository;
  readonly surfaceProfiles: ConsumerSurfaceProfileVersionRepository;
  readonly runs: ConsumerObservationRunRepository;
  readonly newId: () => string;
  readonly now: () => string;
}

export class CreateConsumerObservationRunService {
  private readonly dependencies: CreateConsumerObservationRunDependencies;

  constructor(dependencies: CreateConsumerObservationRunDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: CreateConsumerObservationRunCommand,
  ): Promise<CreateConsumerObservationRunResult> {
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

    const scope = await this.dependencies.scopes.findById(command.scopeId);
    if (!scope) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (scope.status !== "active") {
      throw new WentianApplicationError("SCOPE_INACTIVE");
    }

    const snapshot = await this.dependencies.snapshots.findById(
      command.scopeId,
      command.querySetSnapshotId,
    );
    if (!snapshot) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    const surfaceProfile =
      await this.dependencies.surfaceProfiles.findActiveBySurfaceCode(
        command.surfaceCode,
      );
    if (!surfaceProfile) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }

    const pairedRun = command.pairedRunId
      ? await this.dependencies.runs.findRunById(
          command.scopeId,
          command.pairedRunId,
        )
      : null;
    if (command.pairedRunId && !pairedRun) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    assertPairedRun(
      command,
      snapshot.snapshotHash,
      surfaceProfile.id,
      pairedRun,
    );

    const createdAt = this.dependencies.now();
    const run = createConsumerObservationRun({
      id: this.dependencies.newId(),
      snapshot,
      surfaceProfile,
      collectionMethod: command.collectionMethod,
      experimentKind: command.experimentKind,
      pairedRunId: command.pairedRunId,
      requestedSampleCount: command.sampleCount,
      sessionConditions: command.sessionConditions,
      createdBy: principal.userId,
      createdAt,
    });
    const tasks = snapshot.items.flatMap((item) =>
      Array.from({ length: command.sampleCount }, (_, sampleOffset) =>
        createConsumerObservationTask({
          id: this.dependencies.newId(),
          scopeId: run.scopeId,
          runId: run.id,
          querySnapshotItemId: item.id,
          sampleIndex: sampleOffset + 1,
          surfaceProfileVersionId: run.surfaceProfileVersionId,
          collectionMethod: run.collectionMethod,
          assignedTo: principal.userId,
          createdAt,
        }),
      ),
    );

    await this.dependencies.runs.createWithTasks(run, snapshot, tasks);
    return Object.freeze({ run, tasks: Object.freeze(tasks) });
  }
}

function assertPairedRun(
  command: CreateConsumerObservationRunCommand,
  snapshotHash: string,
  surfaceProfileVersionId: string,
  pairedRun: ConsumerObservationRun | null,
): void {
  if (!command.pairedRunId) {
    return;
  }
  if (command.experimentKind !== "source_nomination") {
    throw new Error("PAIRED_RUN_ONLY_ALLOWED_FOR_SOURCE_NOMINATION");
  }
  if (!pairedRun || pairedRun.experimentKind !== "natural_answer") {
    throw new Error("PAIRED_RUN_NATURAL_ANSWER_REQUIRED");
  }
  if (
    pairedRun.querySetSnapshotHash !== snapshotHash ||
    pairedRun.surfaceProfileVersionId !== surfaceProfileVersionId ||
    pairedRun.collectionMethod !== command.collectionMethod ||
    pairedRun.requestedSampleCount !== command.sampleCount ||
    !sameSessionConditions(
      pairedRun.sessionConditions,
      command.sessionConditions,
    )
  ) {
    throw new Error("PAIRED_RUN_CONFIGURATION_MISMATCH");
  }
}

function sameSessionConditions(
  left: ConsumerSessionConditions,
  right: ConsumerSessionConditions,
): boolean {
  return (
    left.searchMode === right.searchMode &&
    left.isNewConversation === right.isNewConversation &&
    left.isLoggedIn === right.isLoggedIn &&
    left.memoryEnabled === right.memoryEnabled &&
    left.personalizationEnabled === right.personalizationEnabled &&
    left.locale === right.locale.trim() &&
    left.region === normalizeOptionalText(right.region)
  );
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}
