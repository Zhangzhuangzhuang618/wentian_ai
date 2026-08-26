import {
  computeSourceNominationMetrics,
  hasScopeAccess,
  type ConsumerCollectionMethod,
  type ConsumerNominationContext,
  type QuerySetSourceType,
  type SourceNominationMetricReport,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  BuildConsumerSourceNominationMetricSampleBatchCommand,
  BuildConsumerSourceNominationMetricSampleBatchService,
} from "./build-consumer-source-nomination-metric-sample-batch.ts";
import type { ConsumerSourceNominationMetricSampleBatch } from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface ConsumerSourceNominationRunMetricReport extends SourceNominationMetricReport {
  readonly runId: string;
  readonly querySetSourceType: QuerySetSourceType;
  readonly geoConnectorContractVersion: string | null;
  readonly experimentKind: "source_nomination";
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly nominationContext: ConsumerNominationContext;
  readonly surfaceProfileVersionId: string;
  readonly consumerSurfaceCode: string;
  readonly unsupportedInternalClaimSampleCount: number;
  readonly unsupportedInternalClaimAssessmentVersions: readonly string[];
}

export interface GetConsumerSourceNominationRunMetricsOnDemandDependencies {
  readonly batchBuilder: Pick<
    BuildConsumerSourceNominationMetricSampleBatchService,
    "execute"
  >;
  readonly now: () => string;
}

export class GetConsumerSourceNominationRunMetricsOnDemandService {
  private readonly dependencies: GetConsumerSourceNominationRunMetricsOnDemandDependencies;

  constructor(
    dependencies: GetConsumerSourceNominationRunMetricsOnDemandDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    query: BuildConsumerSourceNominationMetricSampleBatchCommand,
  ): Promise<ConsumerSourceNominationRunMetricReport> {
    if (!hasScopeAccess(principal, query.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    const batch = await this.dependencies.batchBuilder.execute(
      principal,
      query,
    );
    if (batch.scopeId !== query.scopeId || batch.runId !== query.runId) {
      throw new Error("SOURCE_NOMINATION_METRIC_BATCH_IDENTITY_MISMATCH");
    }
    return computeConsumerSourceNominationMetricSampleBatch(
      batch,
      this.dependencies.now(),
    );
  }
}

export function computeConsumerSourceNominationMetricSampleBatch(
  batch: ConsumerSourceNominationMetricSampleBatch,
  computedAt: string,
): ConsumerSourceNominationRunMetricReport {
  const context = normalizeRunMetricContext(batch);
  const report = computeSourceNominationMetrics({
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
  batch: ConsumerSourceNominationMetricSampleBatch,
): Pick<
  ConsumerSourceNominationRunMetricReport,
  | "runId"
  | "querySetSourceType"
  | "geoConnectorContractVersion"
  | "experimentKind"
  | "collectionMethod"
  | "nominationContext"
  | "surfaceProfileVersionId"
  | "consumerSurfaceCode"
  | "unsupportedInternalClaimSampleCount"
  | "unsupportedInternalClaimAssessmentVersions"
> {
  const runId = normalizeRequiredText(
    batch.runId,
    "INVALID_SOURCE_NOMINATION_METRIC_RUN_ID",
  );
  const surfaceProfileVersionId = normalizeRequiredText(
    batch.surfaceProfileVersionId,
    "INVALID_SOURCE_NOMINATION_METRIC_SURFACE_PROFILE_VERSION_ID",
  );
  const consumerSurfaceCode = normalizeRequiredText(
    batch.consumerSurfaceCode,
    "INVALID_SOURCE_NOMINATION_METRIC_CONSUMER_SURFACE_CODE",
  );
  if (
    batch.querySetSourceType !== "local" &&
    batch.querySetSourceType !== "geo_sync" &&
    batch.querySetSourceType !== "imported"
  ) {
    throw new Error("INVALID_SOURCE_NOMINATION_METRIC_QUERY_SET_SOURCE_TYPE");
  }
  const geoConnectorContractVersion = normalizeOptionalText(
    batch.geoConnectorContractVersion,
  );
  if (
    (batch.querySetSourceType === "geo_sync") !==
    (geoConnectorContractVersion !== null)
  ) {
    throw new Error("SOURCE_NOMINATION_METRIC_GEO_VERSION_MISMATCH");
  }
  if (batch.experimentKind !== "source_nomination") {
    throw new Error("SOURCE_NOMINATION_METRIC_CONTEXT_REQUIRED");
  }
  if (
    batch.nominationContext !== "unaided" &&
    batch.nominationContext !== "search_assisted" &&
    batch.nominationContext !== "surface_unknown"
  ) {
    throw new Error("INVALID_SOURCE_NOMINATION_METRIC_CONTEXT");
  }
  if (
    batch.collectionMethod !== "browser_assisted" &&
    batch.collectionMethod !== "manual_import"
  ) {
    throw new Error("INVALID_SOURCE_NOMINATION_METRIC_COLLECTION_METHOD");
  }
  for (const sample of batch.samples) {
    if (sample.nominationContext !== batch.nominationContext) {
      throw new Error("SOURCE_NOMINATION_SAMPLE_RUN_CONTEXT_MISMATCH");
    }
  }
  if (
    !Number.isInteger(batch.unsupportedInternalClaimSampleCount) ||
    batch.unsupportedInternalClaimSampleCount < 0 ||
    batch.unsupportedInternalClaimSampleCount > batch.sampleBasis.successful
  ) {
    throw new Error("INVALID_UNSUPPORTED_INTERNAL_CLAIM_SAMPLE_COUNT");
  }
  const unsupportedInternalClaimAssessmentVersions =
    batch.unsupportedInternalClaimAssessmentVersions.map((version) =>
      normalizeRequiredText(
        version,
        "INVALID_UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION",
      ),
    );
  if (
    new Set(unsupportedInternalClaimAssessmentVersions).size !==
      unsupportedInternalClaimAssessmentVersions.length ||
    (batch.sampleBasis.successful > 0 &&
      unsupportedInternalClaimAssessmentVersions.length === 0) ||
    (batch.sampleBasis.successful === 0 &&
      unsupportedInternalClaimAssessmentVersions.length > 0)
  ) {
    throw new Error("UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_COVERAGE_MISMATCH");
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
    unsupportedInternalClaimSampleCount:
      batch.unsupportedInternalClaimSampleCount,
    unsupportedInternalClaimAssessmentVersions: Object.freeze(
      unsupportedInternalClaimAssessmentVersions,
    ),
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
  return normalizeRequiredText(
    value,
    "INVALID_SOURCE_NOMINATION_METRIC_GEO_VERSION",
  );
}
