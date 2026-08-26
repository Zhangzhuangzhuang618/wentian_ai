import {
  reconcileConsumerObservationRun,
  type ConsumerObservationRun,
} from "@wentian/domain";

import type {
  ConsumerObservationRunRepository,
  QuerySetSnapshotRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface ReconcileConsumerObservationRunCommand {
  readonly scopeId: string;
  readonly runId: string;
  readonly occurredAt: string;
}

export interface ReconcileConsumerObservationRunDependencies {
  readonly runs: ConsumerObservationRunRepository;
  readonly snapshots: QuerySetSnapshotRepository;
}

export class ReconcileConsumerObservationRunService {
  private readonly dependencies: ReconcileConsumerObservationRunDependencies;

  constructor(dependencies: ReconcileConsumerObservationRunDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    command: ReconcileConsumerObservationRunCommand,
  ): Promise<ConsumerObservationRun> {
    const run = await this.dependencies.runs.findRunById(
      command.scopeId,
      command.runId,
    );
    if (!run) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (run.scopeId !== command.scopeId || run.id !== command.runId) {
      throw new Error("CONSUMER_OBSERVATION_RUN_IDENTITY_MISMATCH");
    }

    const [snapshot, tasks] = await Promise.all([
      this.dependencies.snapshots.findById(run.scopeId, run.querySetSnapshotId),
      this.dependencies.runs.listTasksForRun(run.scopeId, run.id),
    ]);
    if (!snapshot) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }

    const reconciled = reconcileConsumerObservationRun(
      run,
      snapshot,
      tasks,
      command.occurredAt,
    );
    if (reconciled === run) {
      return run;
    }
    return this.dependencies.runs.saveRun(reconciled, run.version);
  }
}
