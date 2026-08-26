import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPairedConsumerRunComparability,
  MAX_PAIRED_RUN_START_GAP_SECONDS,
  type ConsumerObservationRun,
} from "../src/index.ts";

function run(
  experimentKind: "natural_answer" | "source_nomination",
  startedAt: string,
): ConsumerObservationRun {
  const isNomination = experimentKind === "source_nomination";
  return {
    id: isNomination ? "nomination-run" : "natural-run",
    scopeId: "scope-1",
    querySetSnapshotId: "snapshot-1",
    querySetSnapshotHash: "hash-1",
    queryCount: 1,
    retrievalMode: "web_observed",
    executionTargetType: "consumer_surface",
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted",
    experimentKind,
    nominationContext: isNomination ? "surface_unknown" : null,
    pairedRunId: isNomination ? "natural-run" : null,
    requestedSampleCount: 3,
    plannedSampleCount: 3,
    successfulSampleCount: 3,
    failedSampleCount: 0,
    sessionConditions: {
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    status: "succeeded",
    createdBy: "user-1",
    createdAt: "2026-08-20T00:00:00.000Z",
    startedAt,
    completedAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    version: 2,
  };
}

test("实际开始时间恰好相隔24小时仍可比", () => {
  const report = assessPairedConsumerRunComparability({
    naturalAnswerRun: run("natural_answer", "2026-08-22T00:00:00.000Z"),
    sourceNominationRun: run("source_nomination", "2026-08-23T00:00:00.000Z"),
  });

  assert.equal(report.status, "comparable");
  assert.equal(report.startGapSeconds, MAX_PAIRED_RUN_START_GAP_SECONDS);
  assert.deepEqual(report.reasons, []);
});

test("实际开始时间超过24小时1毫秒时不可比", () => {
  const report = assessPairedConsumerRunComparability({
    naturalAnswerRun: run("natural_answer", "2026-08-22T00:00:00.000Z"),
    sourceNominationRun: run("source_nomination", "2026-08-23T00:00:00.001Z"),
  });

  assert.equal(report.status, "not_comparable");
  assert.equal(report.startGapSeconds, 86_400.001);
  assert.deepEqual(report.reasons, ["RUN_START_GAP_EXCEEDED"]);
});

test("门禁使用startedAt而不是相同的createdAt", () => {
  const natural = run("natural_answer", "2026-08-21T00:00:00.000Z");
  const nomination = run("source_nomination", "2026-08-23T00:00:00.000Z");

  assert.equal(natural.createdAt, nomination.createdAt);
  assert.deepEqual(
    assessPairedConsumerRunComparability({
      naturalAnswerRun: natural,
      sourceNominationRun: nomination,
    }).reasons,
    ["RUN_START_GAP_EXCEEDED"],
  );
});

test("非终态或时间不完整时返回确定性原因", () => {
  const natural = {
    ...run("natural_answer", "2026-08-22T00:00:00.000Z"),
    status: "running" as const,
    completedAt: null,
  };

  const report = assessPairedConsumerRunComparability({
    naturalAnswerRun: natural,
    sourceNominationRun: run("source_nomination", "2026-08-22T01:00:00.000Z"),
  });

  assert.deepEqual(report.reasons, [
    "RUN_NOT_TERMINAL",
    "RUN_TIMESTAMPS_INCOMPLETE",
  ]);
  assert.equal(report.startGapSeconds, null);
});

test("错配对、配置漂移和有效上下文漂移分别失败关闭", () => {
  const natural = run("natural_answer", "2026-08-22T00:00:00.000Z");
  const nomination = run("source_nomination", "2026-08-22T01:00:00.000Z");
  const changed = {
    ...nomination,
    pairedRunId: "other-run",
    requestedSampleCount: 2,
    nominationContext: "unaided" as const,
  };

  const report = assessPairedConsumerRunComparability({
    naturalAnswerRun: natural,
    sourceNominationRun: changed,
  });

  assert.deepEqual(report.reasons, [
    "RUN_PAIR_LINK_MISMATCH",
    "RUN_CONFIGURATION_MISMATCH",
    "RUN_EFFECTIVE_NOMINATION_CONTEXT_MISMATCH",
  ]);
  assert.throws(
    () => (report.reasons as string[]).push("RUN_NOT_TERMINAL"),
    TypeError,
  );
});
