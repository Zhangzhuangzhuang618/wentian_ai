import assert from "node:assert/strict";
import test from "node:test";

import { computeConsumerObservationMetrics } from "../../domain/src/index.ts";
import {
  CONSUMER_OBSERVATION_METRICS_CONTRACT_VERSION,
  adaptConsumerObservationMetricReportToResponse,
  consumerObservationMetricsResponseSchema,
} from "../src/index.ts";

const scopeId = "11111111-1111-4111-8111-111111111111";
const queryId = "21111111-1111-4111-8111-111111111111";
const secondQueryId = "31111111-1111-4111-8111-111111111111";
const runId = "41111111-1111-4111-8111-111111111111";
const surfaceProfileVersionId = "51111111-1111-4111-8111-111111111111";
const snapshotHash = "a".repeat(64);

test("领域指标报告适配为严格只读响应", () => {
  const report = computeConsumerObservationMetrics({
    scopeId,
    querySetSnapshotHash: snapshotHash,
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T12:00:00.000Z",
    sampleBasis: { planned: 2, successful: 2, failed: 0 },
    samples: [
      confirmedSample("s1", [
        ["a.example", 1],
        ["b.example", 2],
      ]),
      confirmedSample("s2", [["a.example", 1]]),
    ],
  });

  const response = adaptConsumerObservationMetricReportToResponse(
    withRunContext(report),
  );

  assert.equal(
    response.contract_version,
    CONSUMER_OBSERVATION_METRICS_CONTRACT_VERSION,
  );
  assert.equal(response.run_id, runId);
  assert.equal(response.query_set_source_type, "local");
  assert.equal(response.collection_method, "browser_assisted");
  assert.equal(response.consumer_surface_code, "doubao_web");
  assert.equal(response.observation_verification_status, "confirmed");
  assert.deepEqual(response.evidence_grades, ["web_confirmed_capture"]);
  assert.equal(response.confirmed_sample_count, 2);
  assert.deepEqual(response.sample_basis, {
    planned: 2,
    successful: 2,
    failed: 0,
  });
  assert.equal(response.groups[0].domains[0].registrable_domain, "a.example");
  assert.deepEqual(response.groups[0].domains[0].web_visible_citation_rate, {
    availability: "available",
    numerator: 2,
    denominator: 2,
    value: 1,
  });
  assert.equal(response.groups[0].source_stability.availability, "available");
  assert.deepEqual(
    consumerObservationMetricsResponseSchema.parse(response),
    response,
  );
});

test("没有确认样本时响应保留not_available而不是零比例", () => {
  const report = computeConsumerObservationMetrics({
    scopeId,
    querySetSnapshotHash: snapshotHash,
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T12:00:00.000Z",
    sampleBasis: { planned: 1, successful: 0, failed: 0 },
    samples: [
      {
        ...confirmedSample("s1", []),
        verificationStatus: "needs_review",
        evidenceGrade: null,
      },
    ],
  });

  const response = adaptConsumerObservationMetricReportToResponse(
    withRunContext(report),
  );
  assert.equal(response.availability, "not_available");
  assert.equal(response.unavailable_reason, "NO_CONFIRMED_WEB_EVIDENCE");
  assert.equal(response.confirmed_sample_count, 0);
  assert.equal(response.observation_verification_status, null);
  assert.deepEqual(response.evidence_grades, []);
  assert.deepEqual(response.groups, []);
});

test("人工录入运行只报告人工确认的证据等级", () => {
  const report = computeConsumerObservationMetrics({
    scopeId,
    querySetSnapshotHash: snapshotHash,
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T12:00:00.000Z",
    sampleBasis: { planned: 1, successful: 1, failed: 0 },
    samples: [
      {
        ...confirmedSample("manual-s1", [["a.example", 1]]),
        collectionMethod: "manual_import",
        evidenceGrade: "web_confirmed_manual",
      },
    ],
  });

  const response = adaptConsumerObservationMetricReportToResponse({
    ...withRunContext(report),
    collectionMethod: "manual_import",
  });

  assert.deepEqual(response.evidence_grades, ["web_confirmed_manual"]);
  assert.equal(
    response.groups[0].evidence_grade_sample_counts.web_confirmed_manual,
    1,
  );
  assert.equal(
    response.groups[0].evidence_grade_sample_counts.web_confirmed_capture,
    0,
  );
});

test("有效稳定度允许同时报告其他问题的空来源样本对", () => {
  const report = computeConsumerObservationMetrics({
    scopeId,
    querySetSnapshotHash: snapshotHash,
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T12:00:00.000Z",
    sampleBasis: { planned: 4, successful: 4, failed: 0 },
    samples: [
      confirmedSample("s1", [], queryId),
      confirmedSample("s2", [], queryId),
      confirmedSample("s3", [["a.example", 1]], secondQueryId),
      confirmedSample("s4", [["a.example", 1]], secondQueryId),
    ],
  });

  const response = adaptConsumerObservationMetricReportToResponse(
    withRunContext(report),
  );
  const stability = response.groups[0].source_stability;
  assert.equal(stability.availability, "available");
  assert.equal(stability.no_source_pair_count, 1);
  assert.equal(stability.questions.length, 1);
  assert.equal(stability.questions[0].no_source_pair_count, 0);
});

test("响应契约拒绝额外字段和不可复算比例", () => {
  const report = computeConsumerObservationMetrics({
    scopeId,
    querySetSnapshotHash: snapshotHash,
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T12:00:00.000Z",
    sampleBasis: { planned: 1, successful: 1, failed: 0 },
    samples: [confirmedSample("s1", [["a.example", 1]])],
  });
  const response = adaptConsumerObservationMetricReportToResponse(
    withRunContext(report),
  );

  assert.throws(() =>
    consumerObservationMetricsResponseSchema.parse({
      ...response,
      internal_crawl_frequency: 99,
    }),
  );
  assert.throws(() =>
    consumerObservationMetricsResponseSchema.parse({
      ...response,
      groups: response.groups.map((group) => ({
        ...group,
        domains: group.domains.map((domain) => ({
          ...domain,
          web_visible_citation_rate: {
            ...domain.web_visible_citation_rate,
            value: 0.5,
          },
        })),
      })),
    }),
  );
  assert.throws(() =>
    consumerObservationMetricsResponseSchema.parse({
      ...response,
      sample_basis: { planned: 1, successful: 1, failed: 1 },
    }),
  );
  assert.throws(() =>
    consumerObservationMetricsResponseSchema.parse({
      ...response,
      sample_basis: { planned: 2, successful: 0, failed: 1 },
    }),
  );
  assert.throws(() =>
    consumerObservationMetricsResponseSchema.parse({
      ...response,
      query_set_source_type: "geo_sync",
    }),
  );
  assert.throws(() =>
    consumerObservationMetricsResponseSchema.parse({
      ...response,
      consumer_surface_code: "other_surface",
    }),
  );
});

function withRunContext(
  report: ReturnType<typeof computeConsumerObservationMetrics>,
) {
  return {
    ...report,
    runId,
    querySetSourceType: "local" as const,
    geoConnectorContractVersion: null,
    experimentKind: "natural_answer" as const,
    collectionMethod: "browser_assisted" as const,
    nominationContext: null,
    surfaceProfileVersionId,
    consumerSurfaceCode: "doubao_web",
  };
}

function confirmedSample(
  id: string,
  citations: readonly (readonly [string, number])[],
  querySnapshotItemId = queryId,
) {
  return {
    id,
    querySnapshotItemId,
    collectionMethod: "browser_assisted" as const,
    verificationStatus: "confirmed" as const,
    evidenceGrade: "web_confirmed_capture" as const,
    configuration: {
      surfaceCode: "doubao_web",
      surfaceModelLabel: null,
      searchMode: "unknown" as const,
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    sourceOrderAvailable: true,
    citations: citations.map(([registrableDomain, position]) => ({
      registrableDomain,
      position,
    })),
  };
}
