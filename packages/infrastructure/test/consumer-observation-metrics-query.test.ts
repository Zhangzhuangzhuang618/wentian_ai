import assert from "node:assert/strict";
import test from "node:test";

import {
  GetConsumerObservationMetricsService,
  WentianApplicationError,
  type ConsumerObservationMetricSampleBatch,
} from "@wentian/application";
import {
  createWentianPrincipal,
  type ConsumerObservationMetricConfiguration,
  type ConsumerObservationMetricSample,
} from "@wentian/domain";

import { InMemoryConsumerObservationMetricSampleBatchRepository } from "../src/index.ts";

const scopeId = "31111111-1111-4111-8111-111111111111";
const otherScopeId = "51111111-1111-4111-8111-111111111111";
const runId = "61111111-1111-4111-8111-111111111111";
const otherRunId = "71111111-1111-4111-8111-111111111111";
const snapshotHash = "snapshot-hash";
const computedAt = "2026-08-22T12:00:00.000Z";

const configuration = {
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

const principal = createWentianPrincipal({
  userId: "41111111-1111-4111-8111-111111111111",
  role: "viewer",
  allowedScopeIds: [scopeId],
});

test("有权访问时按scope和运行读取批次并计算报告", async () => {
  const service = createService([
    metricBatch(scopeId, runId, snapshotHash, [confirmedSample("sample-1")]),
  ]);

  const report = await service.execute(principal, {
    scopeId,
    runId,
  });

  assert.equal(report.scopeId, scopeId);
  assert.equal(report.runId, runId);
  assert.equal(report.querySetSnapshotHash, snapshotHash);
  assert.equal(report.querySetSourceType, "local");
  assert.equal(report.collectionMethod, "browser_assisted");
  assert.equal(report.nominationContext, null);
  assert.equal(report.consumerSurfaceCode, "doubao_web");
  assert.equal(report.normalizationVersion, "url-normalization@1");
  assert.equal(report.computedAt, computedAt);
  assert.equal(report.availability, "available");
  assert.equal(report.confirmedSampleCount, 1);
});

test("无权访问和不存在批次统一返回RESOURCE_NOT_FOUND", async () => {
  const service = createService([
    metricBatch(scopeId, runId, snapshotHash, [confirmedSample("sample-1")]),
  ]);

  await assert.rejects(
    () =>
      service.execute(principal, {
        scopeId: otherScopeId,
        runId,
      }),
    isResourceNotFound,
  );
  await assert.rejects(
    () =>
      service.execute(principal, {
        scopeId,
        runId: "missing-run-id",
      }),
    isResourceNotFound,
  );
});

test("相同运行ID在不同scope中隔离", async () => {
  const twoScopePrincipal = createWentianPrincipal({
    ...principal,
    allowedScopeIds: [scopeId, otherScopeId],
  });
  const service = createService([
    metricBatch(scopeId, runId, snapshotHash, [
      confirmedSample("scope-1-sample"),
    ]),
    metricBatch(otherScopeId, runId, snapshotHash, []),
  ]);

  const first = await service.execute(twoScopePrincipal, {
    scopeId,
    runId,
  });
  const second = await service.execute(twoScopePrincipal, {
    scopeId: otherScopeId,
    runId,
  });

  assert.equal(first.availability, "available");
  assert.equal(second.availability, "not_available");
  assert.equal(second.unavailableReason, "NO_CONFIRMED_WEB_EVIDENCE");
});

test("相同scope和快照哈希的不同运行可以并存", async () => {
  const service = createService([
    metricBatch(scopeId, runId, snapshotHash, [
      confirmedSample("run-1-sample"),
    ]),
    metricBatch(scopeId, otherRunId, snapshotHash, []),
  ]);

  const first = await service.execute(principal, { scopeId, runId });
  const second = await service.execute(principal, {
    scopeId,
    runId: otherRunId,
  });

  assert.equal(first.availability, "available");
  assert.equal(second.availability, "not_available");
});

test("批次存在但只有待审核证据时明确返回not_available", async () => {
  const service = createService([
    metricBatch(scopeId, runId, snapshotHash, [
      {
        ...confirmedSample("sample-needs-review"),
        verificationStatus: "needs_review",
        evidenceGrade: null,
      },
    ]),
  ]);

  const report = await service.execute(principal, {
    scopeId,
    runId,
  });

  assert.equal(report.availability, "not_available");
  assert.equal(report.confirmedSampleCount, 0);
  assert.equal(report.excludedSampleCounts.needsReview, 1);
});

test("仓储返回不同身份的批次时失败关闭", async () => {
  const service = new GetConsumerObservationMetricsService({
    sampleBatches: {
      async findByScopeAndRunId() {
        return metricBatch(scopeId, otherRunId, snapshotHash, []);
      },
    },
    now: () => computedAt,
  });

  await assert.rejects(
    () =>
      service.execute(principal, {
        scopeId,
        runId,
      }),
    /CONSUMER_OBSERVATION_METRIC_BATCH_IDENTITY_MISMATCH/,
  );
});

test("重复scope和运行批次被拒绝", () => {
  assert.throws(
    () =>
      new InMemoryConsumerObservationMetricSampleBatchRepository([
        metricBatch(scopeId, runId, snapshotHash, []),
        metricBatch(scopeId, runId, "other-snapshot-hash", []),
      ]),
    /CONSUMER_OBSERVATION_METRIC_BATCH_CONFLICT/,
  );
});

function createService(
  batches: readonly ConsumerObservationMetricSampleBatch[],
): GetConsumerObservationMetricsService {
  return new GetConsumerObservationMetricsService({
    sampleBatches: new InMemoryConsumerObservationMetricSampleBatchRepository(
      batches,
    ),
    now: () => computedAt,
  });
}

function metricBatch(
  batchScopeId: string,
  batchRunId: string,
  batchSnapshotHash: string,
  samples: readonly ConsumerObservationMetricSample[],
): ConsumerObservationMetricSampleBatch {
  const successful = samples.filter(
    (sample) =>
      sample.verificationStatus === "confirmed" ||
      sample.verificationStatus === "not_required",
  ).length;
  const failed = samples.filter(
    (sample) => sample.verificationStatus === "rejected",
  ).length;
  return {
    scopeId: batchScopeId,
    runId: batchRunId,
    querySetSnapshotHash: batchSnapshotHash,
    querySetSourceType: "local",
    geoConnectorContractVersion: null,
    experimentKind: "natural_answer",
    collectionMethod: "browser_assisted",
    nominationContext: null,
    surfaceProfileVersionId: "81111111-1111-4111-8111-111111111111",
    consumerSurfaceCode: "doubao_web",
    normalizationVersion: "url-normalization@1",
    sampleBasis: { planned: samples.length, successful, failed },
    samples,
  };
}

function confirmedSample(id: string): ConsumerObservationMetricSample {
  return {
    id,
    querySnapshotItemId: "query-item-1",
    collectionMethod: "browser_assisted",
    verificationStatus: "confirmed",
    evidenceGrade: "web_confirmed_capture",
    configuration,
    sourceOrderAvailable: true,
    citations: [{ registrableDomain: "example.com", position: 1 }],
  };
}

function isResourceNotFound(error: unknown): boolean {
  return (
    error instanceof WentianApplicationError &&
    error.code === "RESOURCE_NOT_FOUND"
  );
}
