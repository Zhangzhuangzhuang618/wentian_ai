import {
  computeConsumerObservationMetrics,
  hasScopeAccess,
  type ConsumerCollectionMethod,
  type ConsumerObservationMetricReport,
  type QuerySetSourceType,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  ConsumerObservationMetricSampleBatch,
  ConsumerObservationMetricSampleBatchRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface GetConsumerObservationMetricsQuery {
  readonly scopeId: string;
  readonly runId: string;
}

export interface GetConsumerObservationMetricsDependencies {
  readonly sampleBatches: ConsumerObservationMetricSampleBatchRepository;
  readonly now: () => string;
}

export interface ConsumerObservationRunMetricReport extends ConsumerObservationMetricReport {
  readonly runId: string;
  readonly querySetSourceType: QuerySetSourceType;
  readonly geoConnectorContractVersion: string | null;
  readonly experimentKind: "natural_answer";
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly nominationContext: null;
  readonly surfaceProfileVersionId: string;
  readonly consumerSurfaceCode: string;
}

export class GetConsumerObservationMetricsService {
  private readonly dependencies: GetConsumerObservationMetricsDependencies;

  constructor(dependencies: GetConsumerObservationMetricsDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    query: GetConsumerObservationMetricsQuery,
  ): Promise<ConsumerObservationRunMetricReport> {
    if (!hasScopeAccess(principal, query.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }

    const batch = await this.dependencies.sampleBatches.findByScopeAndRunId(
      query.scopeId,
      query.runId,
    );
    if (!batch) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (batch.scopeId !== query.scopeId || batch.runId !== query.runId) {
      throw new Error("CONSUMER_OBSERVATION_METRIC_BATCH_IDENTITY_MISMATCH");
    }

    return computeConsumerObservationMetricSampleBatch(
      batch,
      this.dependencies.now(),
    );
  }
}

export function computeConsumerObservationMetricSampleBatch(
  batch: ConsumerObservationMetricSampleBatch,
  computedAt: string,
): ConsumerObservationRunMetricReport {
  const context = normalizeRunMetricContext(batch);
  const report = computeConsumerObservationMetrics({
    scopeId: batch.scopeId,
    querySetSnapshotHash: batch.querySetSnapshotHash,
    normalizationVersion: batch.normalizationVersion,
    computedAt,
    sampleBasis: batch.sampleBasis,
    samples: batch.samples,
  });
  return Object.freeze({ ...report, ...context });
}

function normalizeRunMetricContext(
  batch: ConsumerObservationMetricSampleBatch,
): Pick<
  ConsumerObservationRunMetricReport,
  | "runId"
  | "querySetSourceType"
  | "geoConnectorContractVersion"
  | "experimentKind"
  | "collectionMethod"
  | "nominationContext"
  | "surfaceProfileVersionId"
  | "consumerSurfaceCode"
> {
  const runId = normalizeRequiredText(batch.runId, "INVALID_METRIC_RUN_ID");
  const surfaceProfileVersionId = normalizeRequiredText(
    batch.surfaceProfileVersionId,
    "INVALID_METRIC_SURFACE_PROFILE_VERSION_ID",
  );
  const consumerSurfaceCode = normalizeRequiredText(
    batch.consumerSurfaceCode,
    "INVALID_METRIC_CONSUMER_SURFACE_CODE",
  );
  if (
    batch.querySetSourceType !== "local" &&
    batch.querySetSourceType !== "geo_sync" &&
    batch.querySetSourceType !== "imported"
  ) {
    throw new Error("INVALID_METRIC_QUERY_SET_SOURCE_TYPE");
  }
  const geoConnectorContractVersion = normalizeOptionalText(
    batch.geoConnectorContractVersion,
  );
  if (
    (batch.querySetSourceType === "geo_sync") !==
    (geoConnectorContractVersion !== null)
  ) {
    throw new Error("METRIC_GEO_CONTRACT_VERSION_MISMATCH");
  }
  if (
    batch.experimentKind !== "natural_answer" ||
    batch.nominationContext !== null
  ) {
    throw new Error("NATURAL_ANSWER_METRIC_CONTEXT_REQUIRED");
  }
  if (
    batch.collectionMethod !== "browser_assisted" &&
    batch.collectionMethod !== "manual_import"
  ) {
    throw new Error("INVALID_METRIC_CONSUMER_COLLECTION_METHOD");
  }
  for (const sample of batch.samples) {
    if (
      sample.collectionMethod !== batch.collectionMethod ||
      sample.configuration.surfaceCode !== consumerSurfaceCode
    ) {
      throw new Error("CONSUMER_METRIC_SAMPLE_RUN_CONTEXT_MISMATCH");
    }
  }
  return Object.freeze({
    runId,
    querySetSourceType: batch.querySetSourceType,
    geoConnectorContractVersion,
    experimentKind: batch.experimentKind,
    collectionMethod: batch.collectionMethod,
    nominationContext: batch.nominationContext,
    surfaceProfileVersionId,
    consumerSurfaceCode,
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

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = normalizeRequiredText(
    value,
    "INVALID_METRIC_GEO_CONTRACT_VERSION",
  );
  return normalized;
}
