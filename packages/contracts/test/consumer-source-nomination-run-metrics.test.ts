import assert from "node:assert/strict";
import test from "node:test";

import { computeSourceNominationMetrics } from "../../domain/src/index.ts";
import {
  CONSUMER_SOURCE_NOMINATION_RUN_METRICS_CONTRACT_VERSION,
  adaptConsumerSourceNominationRunMetricReportToResponse,
  consumerSourceNominationRunMetricsResponseSchema,
} from "../src/index.ts";

test("单运行自述报告适配为带消费端上下文的严格DTO", () => {
  const response =
    adaptConsumerSourceNominationRunMetricReportToResponse(report());

  assert.equal(
    response.contract_version,
    CONSUMER_SOURCE_NOMINATION_RUN_METRICS_CONTRACT_VERSION,
  );
  assert.equal(response.run_id, ids.run);
  assert.equal(response.experiment_kind, "source_nomination");
  assert.equal(response.nomination_context, "unaided");
  assert.equal(response.consumer_surface_code, "doubao_web");
  assert.equal(response.validated_sample_count, 1);
  assert.equal(response.unsupported_internal_claim_sample_count, 0);
  assert.equal(response.unsupported_internal_claim_warning, null);
  assert.deepEqual(
    consumerSourceNominationRunMetricsResponseSchema.parse(response),
    response,
  );
});

test("没有验证样本时仍保留运行上下文和not_available", () => {
  const response = adaptConsumerSourceNominationRunMetricReportToResponse({
    ...report("needs_review"),
  });

  assert.equal(response.availability, "not_available");
  assert.equal(response.run_id, ids.run);
  assert.equal(response.nomination_context, "unaided");
  assert.deepEqual(response.groups, []);
});

test("存在不可核验声明时只返回数量、版本和固定警告", () => {
  const response = adaptConsumerSourceNominationRunMetricReportToResponse({
    ...report(),
    unsupportedInternalClaimSampleCount: 1,
  });

  assert.equal(response.unsupported_internal_claim_sample_count, 1);
  assert.deepEqual(response.unsupported_internal_claim_assessment_versions, [
    "unsupported-internal-claim@1",
  ]);
  assert.equal(
    response.unsupported_internal_claim_warning,
    "UNVERIFIABLE_INTERNAL_RETRIEVAL_STATISTICS_CLAIM_PRESENT",
  );
  assert.equal("internal_crawl_frequency" in response, false);
});

test("运行DTO拒绝额外内部抓取字段和被篡改的领域比例", () => {
  const response =
    adaptConsumerSourceNominationRunMetricReportToResponse(report());
  assert.throws(() =>
    consumerSourceNominationRunMetricsResponseSchema.parse({
      ...response,
      internal_crawl_frequency: 0.9,
    }),
  );
  assert.throws(() =>
    consumerSourceNominationRunMetricsResponseSchema.parse({
      ...response,
      groups: response.groups.map((group) => ({
        ...group,
        domains: group.domains.map((domain) => ({
          ...domain,
          nomination_rate: { ...domain.nomination_rate, value: 0.5 },
        })),
      })),
    }),
  );
});

test("GEO版本和组内提名上下文与运行字段不一致时失败关闭", () => {
  const response =
    adaptConsumerSourceNominationRunMetricReportToResponse(report());
  assert.throws(
    () =>
      consumerSourceNominationRunMetricsResponseSchema.parse({
        ...response,
        query_set_source_type: "geo_sync",
      }),
    /SOURCE_NOMINATION_RUN_GEO_VERSION_MISMATCH/,
  );
  assert.throws(
    () =>
      consumerSourceNominationRunMetricsResponseSchema.parse({
        ...response,
        unsupported_internal_claim_sample_count: 1,
      }),
    /UNSUPPORTED_INTERNAL_CLAIM_SUMMARY_MISMATCH/,
  );
  assert.throws(
    () =>
      consumerSourceNominationRunMetricsResponseSchema.parse({
        ...response,
        groups: response.groups.map((group) => ({
          ...group,
          nomination_context: "search_assisted",
        })),
      }),
    /SOURCE_NOMINATION_RUN_CONTEXT_MISMATCH/,
  );
});

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  query: "21111111-1111-4111-8111-111111111111",
  run: "31111111-1111-4111-8111-111111111111",
  surface: "41111111-1111-4111-8111-111111111111",
} as const;

function report(
  validationStatus: "human_confirmed" | "needs_review" = "human_confirmed",
) {
  return {
    ...computeSourceNominationMetrics({
      scopeId: ids.scope,
      querySetSnapshotHash: "a".repeat(64),
      normalizationVersion: "url-normalization@1",
      computedAt: "2026-08-23T10:00:00.000Z",
      sampleBasis: { planned: 1, successful: 1, failed: 0 },
      samples: [
        {
          id: "response-1",
          querySnapshotItemId: ids.query,
          nominationContext: "unaided",
          validationStatus,
          nominations:
            validationStatus === "human_confirmed"
              ? [{ registrableDomain: "example.com", position: 1 }]
              : [],
        },
      ],
    }),
    runId: ids.run,
    querySetSourceType: "local" as const,
    geoConnectorContractVersion: null,
    experimentKind: "source_nomination" as const,
    collectionMethod: "browser_assisted" as const,
    nominationContext: "unaided" as const,
    surfaceProfileVersionId: ids.surface,
    consumerSurfaceCode: "doubao_web",
    unsupportedInternalClaimSampleCount: 0,
    unsupportedInternalClaimAssessmentVersions: [
      "unsupported-internal-claim@1",
    ],
  };
}
