import { z } from "zod";

import {
  SOURCE_NOMINATION_METRICS_CONTRACT_VERSION,
  adaptSourceNominationMetricReportToResponse,
  sourceNominationMetricsResponseSchema,
  type SourceNominationMetricReportLike,
} from "./source-nomination-metrics.ts";

export const CONSUMER_SOURCE_NOMINATION_RUN_METRICS_CONTRACT_VERSION =
  "wentian-consumer-source-nomination-run-metrics@0-draft" as const;

export const consumerSourceNominationRunMetricsResponseSchema = z
  .object({
    ...sourceNominationMetricsResponseSchema.shape,
    contract_version: z.literal(
      CONSUMER_SOURCE_NOMINATION_RUN_METRICS_CONTRACT_VERSION,
    ),
    run_id: z.uuid(),
    query_set_source_type: z.enum(["local", "geo_sync", "imported"]),
    geo_connector_contract_version: z.string().trim().min(1).max(64).nullable(),
    experiment_kind: z.literal("source_nomination"),
    collection_method: z.enum(["browser_assisted", "manual_import"]),
    nomination_context: z.enum([
      "unaided",
      "search_assisted",
      "surface_unknown",
    ]),
    surface_profile_version_id: z.uuid(),
    consumer_surface_code: z.string().trim().min(1).max(80),
    unsupported_internal_claim_sample_count: z.number().int().nonnegative(),
    unsupported_internal_claim_assessment_versions: z
      .array(z.string().trim().min(1).max(120))
      .max(20),
    unsupported_internal_claim_warning: z
      .literal("UNVERIFIABLE_INTERNAL_RETRIEVAL_STATISTICS_CLAIM_PRESENT")
      .nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    const {
      run_id: _runId,
      query_set_source_type: _querySetSourceType,
      geo_connector_contract_version: _geoConnectorContractVersion,
      experiment_kind: _experimentKind,
      collection_method: _collectionMethod,
      nomination_context: _nominationContext,
      surface_profile_version_id: _surfaceProfileVersionId,
      consumer_surface_code: _consumerSurfaceCode,
      unsupported_internal_claim_sample_count:
        _unsupportedInternalClaimSampleCount,
      unsupported_internal_claim_assessment_versions:
        _unsupportedInternalClaimAssessmentVersions,
      unsupported_internal_claim_warning: _unsupportedInternalClaimWarning,
      ...metricFields
    } = response;
    const baseResult = sourceNominationMetricsResponseSchema.safeParse({
      ...metricFields,
      contract_version: SOURCE_NOMINATION_METRICS_CONTRACT_VERSION,
    });
    if (!baseResult.success) {
      for (const issue of baseResult.error.issues) {
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
    }
    if (
      (response.query_set_source_type === "geo_sync") !==
      (response.geo_connector_contract_version !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["geo_connector_contract_version"],
        message: "SOURCE_NOMINATION_RUN_GEO_VERSION_MISMATCH",
      });
    }
    if (
      response.unsupported_internal_claim_sample_count >
        response.sample_basis.successful ||
      response.unsupported_internal_claim_sample_count > 0 !==
        (response.unsupported_internal_claim_warning !== null) ||
      (response.sample_basis.successful > 0 &&
        response.unsupported_internal_claim_assessment_versions.length === 0) ||
      (response.sample_basis.successful === 0 &&
        response.unsupported_internal_claim_assessment_versions.length > 0) ||
      new Set(response.unsupported_internal_claim_assessment_versions).size !==
        response.unsupported_internal_claim_assessment_versions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["unsupported_internal_claim_sample_count"],
        message: "UNSUPPORTED_INTERNAL_CLAIM_SUMMARY_MISMATCH",
      });
    }
    if (
      response.groups.some(
        (group) => group.nomination_context !== response.nomination_context,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["groups"],
        message: "SOURCE_NOMINATION_RUN_CONTEXT_MISMATCH",
      });
    }
  });

export type ConsumerSourceNominationRunMetricsResponseDto = z.infer<
  typeof consumerSourceNominationRunMetricsResponseSchema
>;

export interface ConsumerSourceNominationRunMetricReportLike extends SourceNominationMetricReportLike {
  readonly runId: string;
  readonly querySetSourceType: "local" | "geo_sync" | "imported";
  readonly geoConnectorContractVersion: string | null;
  readonly experimentKind: "source_nomination";
  readonly collectionMethod: "browser_assisted" | "manual_import";
  readonly nominationContext: "unaided" | "search_assisted" | "surface_unknown";
  readonly surfaceProfileVersionId: string;
  readonly consumerSurfaceCode: string;
  readonly unsupportedInternalClaimSampleCount: number;
  readonly unsupportedInternalClaimAssessmentVersions: readonly string[];
}

export function adaptConsumerSourceNominationRunMetricReportToResponse(
  report: ConsumerSourceNominationRunMetricReportLike,
): ConsumerSourceNominationRunMetricsResponseDto {
  const metricResponse = adaptSourceNominationMetricReportToResponse(report);
  return consumerSourceNominationRunMetricsResponseSchema.parse({
    ...metricResponse,
    contract_version: CONSUMER_SOURCE_NOMINATION_RUN_METRICS_CONTRACT_VERSION,
    run_id: report.runId,
    query_set_source_type: report.querySetSourceType,
    geo_connector_contract_version: report.geoConnectorContractVersion,
    experiment_kind: report.experimentKind,
    collection_method: report.collectionMethod,
    nomination_context: report.nominationContext,
    surface_profile_version_id: report.surfaceProfileVersionId,
    consumer_surface_code: report.consumerSurfaceCode,
    unsupported_internal_claim_sample_count:
      report.unsupportedInternalClaimSampleCount,
    unsupported_internal_claim_assessment_versions:
      report.unsupportedInternalClaimAssessmentVersions,
    unsupported_internal_claim_warning:
      report.unsupportedInternalClaimSampleCount > 0
        ? "UNVERIFIABLE_INTERNAL_RETRIEVAL_STATISTICS_CLAIM_PRESENT"
        : null,
  });
}
