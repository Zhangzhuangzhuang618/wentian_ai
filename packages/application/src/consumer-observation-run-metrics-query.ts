import { hasScopeAccess, type WentianPrincipal } from "@wentian/domain";

import type {
  BuildConsumerObservationMetricSampleBatchCommand,
  BuildConsumerObservationMetricSampleBatchService,
} from "./build-consumer-observation-metric-sample-batch.ts";
import {
  computeConsumerObservationMetricSampleBatch,
  type ConsumerObservationRunMetricReport,
} from "./consumer-observation-metrics-query.ts";
import { WentianApplicationError } from "./services.ts";

export interface GetConsumerObservationRunMetricsOnDemandDependencies {
  readonly batchBuilder: Pick<
    BuildConsumerObservationMetricSampleBatchService,
    "execute"
  >;
  readonly now: () => string;
}

export class GetConsumerObservationRunMetricsOnDemandService {
  private readonly dependencies: GetConsumerObservationRunMetricsOnDemandDependencies;

  constructor(
    dependencies: GetConsumerObservationRunMetricsOnDemandDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    query: BuildConsumerObservationMetricSampleBatchCommand,
  ): Promise<ConsumerObservationRunMetricReport> {
    if (!hasScopeAccess(principal, query.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    const batch = await this.dependencies.batchBuilder.execute(
      principal,
      query,
    );
    if (batch.scopeId !== query.scopeId || batch.runId !== query.runId) {
      throw new Error("CONSUMER_OBSERVATION_METRIC_BATCH_IDENTITY_MISMATCH");
    }
    return computeConsumerObservationMetricSampleBatch(
      batch,
      this.dependencies.now(),
    );
  }
}
