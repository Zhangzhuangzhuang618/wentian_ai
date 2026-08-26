import assert from "node:assert/strict";
import test from "node:test";

import { computeSourceNominationMetrics } from "../../domain/src/index.ts";
import {
  SOURCE_NOMINATION_METRICS_CONTRACT_VERSION,
  adaptSourceNominationMetricReportToResponse,
  sourceNominationMetricsResponseSchema,
} from "../src/index.ts";

const scopeId = "11111111-1111-4111-8111-111111111111";
const queryId = "21111111-1111-4111-8111-111111111111";

test("自述领域报告适配为严格可复算响应", () => {
  const response = adaptSourceNominationMetricReportToResponse(
    computeSourceNominationMetrics({
      scopeId,
      querySetSnapshotHash: "a".repeat(64),
      normalizationVersion: "url-normalization@1",
      computedAt: "2026-08-22T12:00:00.000Z",
      sampleBasis: { planned: 2, successful: 2, failed: 0 },
      samples: [
        sample("s1", [
          ["a.example", 1],
          ["b.example", 2],
        ]),
        sample("s2", [
          ["a.example", 1],
          ["c.example", 2],
        ]),
      ],
    }),
  );

  assert.equal(
    response.contract_version,
    SOURCE_NOMINATION_METRICS_CONTRACT_VERSION,
  );
  assert.equal(response.availability, "available");
  assert.equal(response.validated_sample_count, 2);
  assert.equal(response.groups[0].nomination_context, "unaided");
  assert.deepEqual(response.groups[0].domains[0].nomination_rate, {
    availability: "available",
    numerator: 2,
    denominator: 2,
    value: 1,
  });
  assert.deepEqual(
    sourceNominationMetricsResponseSchema.parse(response),
    response,
  );
});

test("没有验证样本的响应保持not_available", () => {
  const response = adaptSourceNominationMetricReportToResponse(
    computeSourceNominationMetrics({
      scopeId,
      querySetSnapshotHash: "a".repeat(64),
      normalizationVersion: "url-normalization@1",
      computedAt: "2026-08-22T12:00:00.000Z",
      sampleBasis: { planned: 1, successful: 1, failed: 0 },
      samples: [
        {
          ...sample("s1", []),
          validationStatus: "needs_review",
        },
      ],
    }),
  );

  assert.equal(response.availability, "not_available");
  assert.equal(response.unavailable_reason, "NO_VALIDATED_NOMINATION_SAMPLES");
  assert.deepEqual(response.groups, []);
});

test("响应拒绝额外字段、伪造比例、样本覆盖和上下文合并", () => {
  const response = adaptSourceNominationMetricReportToResponse(
    computeSourceNominationMetrics({
      scopeId,
      querySetSnapshotHash: "a".repeat(64),
      normalizationVersion: "url-normalization@1",
      computedAt: "2026-08-22T12:00:00.000Z",
      sampleBasis: { planned: 1, successful: 1, failed: 0 },
      samples: [sample("s1", [["a.example", 1]])],
    }),
  );

  assert.throws(() =>
    sourceNominationMetricsResponseSchema.parse({
      ...response,
      claimed_internal_crawl_frequency: 0.9,
    }),
  );
  assert.throws(() =>
    sourceNominationMetricsResponseSchema.parse({
      ...response,
      groups: response.groups.map((group) => ({
        ...group,
        domains: group.domains.map((domain) => ({
          ...domain,
          first_nomination_rate: {
            availability: "available",
            numerator: 0,
            denominator: 1,
            value: 0,
          },
        })),
      })),
    }),
  );
  assert.throws(() =>
    sourceNominationMetricsResponseSchema.parse({
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
  assert.throws(() =>
    sourceNominationMetricsResponseSchema.parse({
      ...response,
      sample_basis: { planned: 2, successful: 2, failed: 0 },
    }),
  );
  assert.throws(() =>
    sourceNominationMetricsResponseSchema.parse({
      ...response,
      groups: [...response.groups, response.groups[0]],
      validated_sample_count: 2,
      sample_basis: { planned: 2, successful: 2, failed: 0 },
    }),
  );
});

function sample(
  id: string,
  nominations: readonly (readonly [string, number | null])[],
) {
  return {
    id,
    querySnapshotItemId: queryId,
    nominationContext: "unaided" as const,
    validationStatus: "schema_validated" as const,
    nominations: nominations.map(([registrableDomain, position]) => ({
      registrableDomain,
      position,
    })),
  };
}
