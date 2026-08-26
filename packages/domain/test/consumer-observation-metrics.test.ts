import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSUMER_OBSERVATION_EVIDENCE_WARNING,
  CONSUMER_OBSERVATION_METHODOLOGY_VERSION,
  computeConsumerObservationMetrics,
  type ConsumerObservationMetricConfiguration,
  type ConsumerObservationMetricSample,
} from "../src/index.ts";

const baseConfiguration = {
  surfaceCode: "doubao_web",
  surfaceModelLabel: null,
  searchMode: "disabled",
  isNewConversation: true,
  isLoggedIn: true,
  memoryEnabled: null,
  personalizationEnabled: null,
  locale: "zh-CN",
  region: "Guangzhou",
} as const satisfies ConsumerObservationMetricConfiguration;

test("黄金样本按配置分组计算Web端可见引用率和Jaccard稳定度", () => {
  const samples = [
    confirmedSample("s1", "q1", "browser_assisted", [
      ["a.example", 1],
      ["b.example", 2],
      ["A.EXAMPLE.", 3],
    ]),
    confirmedSample("s2", "q1", "manual_import", [
      ["a.example", 2],
      ["c.example", 1],
    ]),
    confirmedSample("s3", "q2", "browser_assisted", [["a.example", 1]]),
    confirmedSample("s4", "q2", "browser_assisted", []),
    confirmedSample("s5", "q3", "manual_import", [["b.example", 1]], {
      searchMode: "enabled",
    }),
    confirmedSample(
      "s6",
      "q3",
      "browser_assisted",
      [
        ["b.example", 1],
        ["d.example", 2],
      ],
      { searchMode: "enabled" },
      false,
    ),
    ineligibleSample("s7", "needs_review", null),
    ineligibleSample("s8", "rejected", null),
    ineligibleSample("s9", "not_required", "imported_declared"),
  ];

  const report = computeConsumerObservationMetrics({
    scopeId: "scope-1",
    querySetSnapshotHash: "snapshot-hash",
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T10:00:00.000Z",
    sampleBasis: { planned: 9, successful: 7, failed: 1 },
    samples,
  });

  assert.equal(
    report.methodologyVersion,
    CONSUMER_OBSERVATION_METHODOLOGY_VERSION,
  );
  assert.equal(report.availability, "available");
  assert.deepEqual(report.sampleBasis, {
    planned: 9,
    successful: 7,
    failed: 1,
  });
  assert.equal(report.confirmedSampleCount, 6);
  assert.deepEqual(report.excludedSampleCounts, {
    needsReview: 1,
    rejected: 1,
    notRequired: 1,
  });
  assert.deepEqual(report.warnings, [CONSUMER_OBSERVATION_EVIDENCE_WARNING]);
  assert.equal(report.groups.length, 2);

  const disabled = requireGroup(report.groups, "disabled");
  assert.equal(disabled.confirmedSampleCount, 4);
  assert.equal(disabled.sampleAssessment, "individual_observation");
  assert.deepEqual(disabled.evidenceGradeSampleCounts, {
    webConfirmedCapture: 3,
    webConfirmedManual: 1,
  });
  assert.deepEqual(requireDomain(disabled.domains, "a.example"), {
    registrableDomain: "a.example",
    webVisibleCitationRate: {
      availability: "available",
      numerator: 3,
      denominator: 4,
      value: 3 / 4,
    },
    firstVisibleCitationRate: {
      availability: "available",
      numerator: 2,
      denominator: 3,
      value: 2 / 3,
    },
  });
  assert.equal(disabled.sourceStability.availability, "available");
  if (disabled.sourceStability.availability === "available") {
    assert.equal(disabled.sourceStability.value, 1 / 6);
    assert.equal(disabled.sourceStability.questionCount, 2);
    assert.equal(disabled.sourceStability.pairCount, 2);
    assert.deepEqual(
      disabled.sourceStability.questions.map((question) => question.value),
      [1 / 3, 0],
    );
  }

  const enabled = requireGroup(report.groups, "enabled");
  assert.equal(enabled.sourceStability.availability, "available");
  if (enabled.sourceStability.availability === "available") {
    assert.equal(enabled.sourceStability.value, 1 / 2);
  }
  assert.deepEqual(
    requireDomain(enabled.domains, "b.example").firstVisibleCitationRate,
    {
      availability: "not_available",
      numerator: null,
      denominator: null,
      value: null,
      reason: "SOURCE_ORDER_NOT_AVAILABLE",
    },
  );
});

test("没有已确认Web证据时返回not_available而不是零", () => {
  const report = computeConsumerObservationMetrics({
    scopeId: "scope-1",
    querySetSnapshotHash: "snapshot-hash",
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T10:00:00.000Z",
    sampleBasis: { planned: 1, successful: 0, failed: 0 },
    samples: [ineligibleSample("s1", "needs_review", null)],
  });

  assert.equal(report.availability, "not_available");
  assert.equal(report.unavailableReason, "NO_CONFIRMED_WEB_EVIDENCE");
  assert.equal(report.confirmedSampleCount, 0);
  assert.deepEqual(report.groups, []);
});

test("两个空来源集合不把Jaccard伪装为1", () => {
  const report = computeConsumerObservationMetrics({
    scopeId: "scope-1",
    querySetSnapshotHash: "snapshot-hash",
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T10:00:00.000Z",
    sampleBasis: { planned: 2, successful: 2, failed: 0 },
    samples: [
      confirmedSample("s1", "q1", "browser_assisted", []),
      confirmedSample("s2", "q1", "browser_assisted", []),
    ],
  });
  const stability = report.groups[0].sourceStability;

  assert.deepEqual(stability, {
    availability: "not_available",
    value: null,
    questionCount: 0,
    pairCount: 0,
    noSourcePairCount: 1,
    questions: [],
    reason: "ALL_SAMPLE_PAIRS_HAVE_NO_SOURCES",
  });
});

test("单次样本不足以计算来源稳定度", () => {
  const report = computeConsumerObservationMetrics({
    scopeId: "scope-1",
    querySetSnapshotHash: "snapshot-hash",
    normalizationVersion: "url-normalization@1",
    computedAt: "2026-08-22T10:00:00.000Z",
    sampleBasis: { planned: 1, successful: 1, failed: 0 },
    samples: [
      confirmedSample("s1", "q1", "browser_assisted", [["a.example", 1]]),
    ],
  });

  assert.equal(report.groups[0].sourceStability.availability, "not_available");
  assert.equal(
    report.groups[0].sourceStability.availability === "not_available"
      ? report.groups[0].sourceStability.reason
      : null,
    "INSUFFICIENT_REPEATED_SAMPLES",
  );
});

test("确认状态、证据等级和采集方式不一致时指标失败关闭", () => {
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 1, successful: 1, failed: 0 },
        samples: [
          {
            ...confirmedSample("s1", "q1", "browser_assisted", []),
            evidenceGrade: "api_structured",
          },
        ],
      }),
    /INVALID_CONFIRMED_CONSUMER_EVIDENCE_GRADE/,
  );
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 1, successful: 1, failed: 0 },
        samples: [
          {
            ...confirmedSample("s1", "q1", "manual_import", []),
            evidenceGrade: "web_confirmed_capture",
          },
        ],
      }),
    /CONSUMER_EVIDENCE_COLLECTION_METHOD_MISMATCH/,
  );
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 1, successful: 0, failed: 1 },
        samples: [
          {
            ...ineligibleSample("s1", "rejected", null),
            evidenceGrade: "web_confirmed_manual",
          },
        ],
      }),
    /UNCONFIRMED_CONSUMER_EVIDENCE_GRADE_FORBIDDEN/,
  );
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 1, successful: 1, failed: 0 },
        samples: [
          {
            ...ineligibleSample("s1", "not_required", null),
            evidenceGrade: "web_confirmed_manual",
          },
        ],
      }),
    /UNCONFIRMED_CONSUMER_EVIDENCE_GRADE_FORBIDDEN/,
  );
});

test("样本基数拒绝超出计划数和证据状态覆盖不一致", () => {
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 1, successful: 1, failed: 1 },
        samples: [],
      }),
    /CONSUMER_SAMPLE_BASIS_EXCEEDS_PLANNED/,
  );
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 1, successful: 1, failed: 0 },
        samples: [ineligibleSample("s1", "rejected", null)],
      }),
    /CONSUMER_SAMPLE_BASIS_COVERAGE_MISMATCH/,
  );
});

test("指标输入拒绝重复样本标识", () => {
  assert.throws(
    () =>
      computeConsumerObservationMetrics({
        scopeId: "scope-1",
        querySetSnapshotHash: "snapshot-hash",
        normalizationVersion: "url-normalization@1",
        computedAt: "2026-08-22T10:00:00.000Z",
        sampleBasis: { planned: 2, successful: 2, failed: 0 },
        samples: [
          confirmedSample("s1", "q1", "browser_assisted", []),
          confirmedSample(" s1 ", "q1", "browser_assisted", []),
        ],
      }),
    /DUPLICATE_CONSUMER_METRIC_SAMPLE_ID/,
  );
});

function confirmedSample(
  id: string,
  querySnapshotItemId: string,
  collectionMethod: "browser_assisted" | "manual_import",
  citations: readonly (readonly [string, number | null])[],
  configurationChanges: Partial<ConsumerObservationMetricConfiguration> = {},
  sourceOrderAvailable = true,
): ConsumerObservationMetricSample {
  return {
    id,
    querySnapshotItemId,
    collectionMethod,
    verificationStatus: "confirmed",
    evidenceGrade:
      collectionMethod === "browser_assisted"
        ? "web_confirmed_capture"
        : "web_confirmed_manual",
    configuration: { ...baseConfiguration, ...configurationChanges },
    sourceOrderAvailable,
    citations: citations.map(([registrableDomain, position]) => ({
      registrableDomain,
      position,
    })),
  };
}

function ineligibleSample(
  id: string,
  verificationStatus: "needs_review" | "rejected" | "not_required",
  evidenceGrade: "imported_declared" | null,
): ConsumerObservationMetricSample {
  return {
    id,
    querySnapshotItemId: "q-excluded",
    collectionMethod: "manual_import",
    verificationStatus,
    evidenceGrade,
    configuration: baseConfiguration,
    sourceOrderAvailable: false,
    citations: [],
  };
}

function requireGroup(
  groups: ReturnType<typeof computeConsumerObservationMetrics>["groups"],
  searchMode: "enabled" | "disabled",
) {
  const group = groups.find(
    (candidate) => candidate.configuration.searchMode === searchMode,
  );
  assert.ok(group);
  return group;
}

function requireDomain(
  domains: ReturnType<typeof requireGroup>["domains"],
  registrableDomain: string,
) {
  const domain = domains.find(
    (candidate) => candidate.registrableDomain === registrableDomain,
  );
  assert.ok(domain);
  return domain;
}
