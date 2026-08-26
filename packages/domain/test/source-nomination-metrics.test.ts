import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_NOMINATION_EVIDENCE_WARNING,
  computeSourceNominationMetrics,
  type ComputeSourceNominationMetricsInput,
  type SourceNominationMetricSample,
} from "../src/index.ts";

const scopeId = "11111111-1111-4111-8111-111111111111";
const firstQueryId = "21111111-1111-4111-8111-111111111111";
const secondQueryId = "31111111-1111-4111-8111-111111111111";

test("黄金样本计算提名率、首位提名率、提名份额和稳定度", () => {
  const report = computeSourceNominationMetrics(
    metricInput([
      sample("s1", firstQueryId, "schema_validated", [
        ["a.example", 1],
        ["a.example", 2],
        ["b.example", 3],
      ]),
      sample("s2", firstQueryId, "human_confirmed", [
        ["a.example", 2],
        ["c.example", 1],
      ]),
      sample("s3", secondQueryId, "schema_validated", [["a.example", null]]),
    ]),
  );

  assert.equal(report.availability, "available");
  assert.equal(report.validatedSampleCount, 3);
  assert.deepEqual(report.warnings, [SOURCE_NOMINATION_EVIDENCE_WARNING]);
  const group = report.groups[0];
  assert.equal(group.nominationContext, "unaided");
  assert.deepEqual(group.validationMethodSampleCounts, {
    schemaValidated: 2,
    humanConfirmed: 1,
  });
  assert.equal(group.nominationEventCount, 6);

  const a = group.domains.find(
    (domain) => domain.registrableDomain === "a.example",
  );
  assert.ok(a);
  assert.deepEqual(a.nominationRate, ratio(3, 3));
  assert.deepEqual(a.firstNominationRate, ratio(1, 2));
  assert.deepEqual(a.nominationShare, ratio(4, 6));
  assert.equal(group.stability.availability, "available");
  assert.equal(group.stability.value, 1 / 3);
  assert.equal(group.stability.pairCount, 1);
});

test("不同提名上下文分别计算且不合并分母", () => {
  const report = computeSourceNominationMetrics(
    metricInput([
      sample("s1", firstQueryId, "schema_validated", [["a.example", 1]]),
      {
        ...sample("s2", firstQueryId, "schema_validated", [["b.example", 1]]),
        nominationContext: "search_assisted",
      },
    ]),
  );

  assert.equal(report.groups.length, 2);
  assert.deepEqual(
    report.groups.map((group) => [
      group.nominationContext,
      group.validatedSampleCount,
    ]),
    [
      ["search_assisted", 1],
      ["unaided", 1],
    ],
  );
});

test("待复核与拒绝解析不进入提名指标分母", () => {
  const report = computeSourceNominationMetrics(
    metricInput([
      sample("s1", firstQueryId, "human_confirmed", [["a.example", 1]]),
      sample("s2", firstQueryId, "needs_review", []),
      sample("s3", firstQueryId, "rejected", []),
    ]),
  );

  assert.equal(report.validatedSampleCount, 1);
  assert.deepEqual(report.excludedParseCounts, {
    needsReview: 1,
    rejected: 1,
  });
  assert.deepEqual(report.groups[0].domains[0].nominationRate, ratio(1, 1));
});

test("没有通过解析确认的样本时返回not_available", () => {
  const report = computeSourceNominationMetrics(
    metricInput([
      sample("s1", firstQueryId, "needs_review", []),
      sample("s2", firstQueryId, "rejected", []),
    ]),
  );

  assert.equal(report.availability, "not_available");
  assert.equal(report.unavailableReason, "NO_VALIDATED_NOMINATION_SAMPLES");
  assert.equal(report.validatedSampleCount, 0);
  assert.deepEqual(report.groups, []);
});

test("没有明确顺序时首位提名率不可用而其他指标仍可用", () => {
  const report = computeSourceNominationMetrics(
    metricInput([
      sample("s1", firstQueryId, "schema_validated", [["a.example", null]]),
    ]),
  );
  const domain = report.groups[0].domains[0];

  assert.equal(domain.nominationRate.availability, "available");
  assert.deepEqual(domain.firstNominationRate, {
    availability: "not_available",
    numerator: null,
    denominator: null,
    value: null,
    reason: "NO_VALID_NOMINATION_ORDER",
  });
});

test("两个空提名集合不把稳定度伪装为1", () => {
  const report = computeSourceNominationMetrics(
    metricInput([
      sample("s1", firstQueryId, "schema_validated", []),
      sample("s2", firstQueryId, "schema_validated", []),
    ]),
  );

  assert.deepEqual(report.groups[0].stability, {
    availability: "not_available",
    value: null,
    questionCount: 0,
    pairCount: 0,
    noNominationPairCount: 1,
    questions: [],
    reason: "ALL_SAMPLE_PAIRS_HAVE_NO_NOMINATIONS",
  });
});

test("样本覆盖、解析状态、域名和顺序异常时失败关闭", () => {
  const valid = sample("s1", firstQueryId, "schema_validated", [
    ["a.example", 1],
  ]);
  for (const invalidInput of [
    {
      ...metricInput([valid]),
      sampleBasis: { planned: 2, successful: 2, failed: 0 },
    },
    metricInput([valid, { ...valid }]),
    metricInput([
      sample("s2", firstQueryId, "needs_review", [["a.example", 1]]),
    ]),
    metricInput([
      sample("s3", firstQueryId, "schema_validated", [
        ["a.example", 1],
        ["b.example", null],
      ]),
    ]),
    metricInput([
      sample("s4", firstQueryId, "schema_validated", [
        ["a.example", 1],
        ["b.example", 3],
      ]),
    ]),
    metricInput([
      sample("s5", firstQueryId, "schema_validated", [
        ["https://a.example", 1],
      ]),
    ]),
  ]) {
    assert.throws(() => computeSourceNominationMetrics(invalidInput));
  }
});

function metricInput(
  samples: readonly SourceNominationMetricSample[],
): ComputeSourceNominationMetricsInput {
  return {
    scopeId,
    querySetSnapshotHash: "a".repeat(64),
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T12:00:00.000Z",
    sampleBasis: {
      planned: samples.length,
      successful: samples.length,
      failed: 0,
    },
    samples,
  };
}

function sample(
  id: string,
  querySnapshotItemId: string,
  validationStatus: SourceNominationMetricSample["validationStatus"],
  nominations: readonly (readonly [string, number | null])[],
): SourceNominationMetricSample {
  return {
    id,
    querySnapshotItemId,
    nominationContext: "unaided",
    validationStatus,
    nominations: nominations.map(([registrableDomain, position]) => ({
      registrableDomain,
      position,
    })),
  };
}

function ratio(numerator: number, denominator: number) {
  return {
    availability: "available",
    numerator,
    denominator,
    value: numerator / denominator,
  };
}
