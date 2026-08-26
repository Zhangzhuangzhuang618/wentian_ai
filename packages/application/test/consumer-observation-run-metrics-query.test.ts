import assert from "node:assert/strict";
import test from "node:test";

import {
  GetConsumerObservationRunMetricsOnDemandService,
  WentianApplicationError,
  type ConsumerObservationMetricSampleBatch,
} from "../src/index.ts";
import { createWentianPrincipal } from "../../domain/src/index.ts";

const scopeId = "11111111-1111-4111-8111-111111111111";
const runId = "21111111-1111-4111-8111-111111111111";
const principal = createWentianPrincipal({
  userId: "31111111-1111-4111-8111-111111111111",
  role: "viewer",
  allowedScopeIds: [scopeId],
});

const batch: ConsumerObservationMetricSampleBatch = {
  scopeId,
  runId,
  querySetSnapshotHash: "snapshot-hash",
  querySetSourceType: "local",
  geoConnectorContractVersion: null,
  experimentKind: "natural_answer",
  collectionMethod: "browser_assisted",
  nominationContext: null,
  surfaceProfileVersionId: "41111111-1111-4111-8111-111111111111",
  consumerSurfaceCode: "doubao_web",
  normalizationVersion: "url-normalization@1",
  sampleBasis: { planned: 1, successful: 1, failed: 0 },
  samples: [
    {
      id: "sample-1",
      querySnapshotItemId: "query-1",
      collectionMethod: "browser_assisted",
      verificationStatus: "confirmed",
      evidenceGrade: "web_confirmed_capture",
      configuration: {
        surfaceCode: "doubao_web",
        surfaceModelLabel: null,
        searchMode: "unknown",
        isNewConversation: true,
        isLoggedIn: true,
        memoryEnabled: null,
        personalizationEnabled: null,
        locale: "zh-CN",
        region: "Guangzhou",
      },
      sourceOrderAvailable: true,
      citations: [{ registrableDomain: "example.com", position: 1 }],
    },
  ],
};

test("按需构建批次后立即计算单运行报告", async () => {
  let receivedQuery: unknown = null;
  const service = new GetConsumerObservationRunMetricsOnDemandService({
    batchBuilder: {
      async execute(_principal, query) {
        receivedQuery = query;
        return batch;
      },
    },
    now: () => "2026-08-22T12:00:00.000Z",
  });

  const report = await service.execute(principal, { scopeId, runId });

  assert.deepEqual(receivedQuery, { scopeId, runId });
  assert.equal(report.computedAt, "2026-08-22T12:00:00.000Z");
  assert.equal(report.runId, runId);
  assert.equal(report.querySetSourceType, "local");
  assert.equal(report.collectionMethod, "browser_assisted");
  assert.equal(report.consumerSurfaceCode, "doubao_web");
  assert.equal(report.confirmedSampleCount, 1);
  assert.equal(report.groups[0].domains[0].registrableDomain, "example.com");
});

test("无scope权限时不调用批次构建器", async () => {
  let called = false;
  const service = new GetConsumerObservationRunMetricsOnDemandService({
    batchBuilder: {
      async execute() {
        called = true;
        return batch;
      },
    },
    now: () => "2026-08-22T12:00:00.000Z",
  });

  await assert.rejects(
    () => service.execute(principal, { scopeId: "other-scope", runId }),
    (error: unknown) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
  assert.equal(called, false);
});

test("构建器返回其他运行的批次时失败关闭", async () => {
  const service = new GetConsumerObservationRunMetricsOnDemandService({
    batchBuilder: {
      async execute() {
        return { ...batch, runId: "other-run" };
      },
    },
    now: () => "2026-08-22T12:00:00.000Z",
  });

  await assert.rejects(
    () => service.execute(principal, { scopeId, runId }),
    /CONSUMER_OBSERVATION_METRIC_BATCH_IDENTITY_MISMATCH/,
  );
});

test("批次的GEO版本、实验类型和样本上下文不一致时失败关闭", async () => {
  for (const invalidBatch of [
    { ...batch, querySetSourceType: "geo_sync" as const },
    {
      ...batch,
      experimentKind: "source_nomination" as const,
      nominationContext: "surface_unknown" as const,
    },
    { ...batch, consumerSurfaceCode: "other_surface" },
  ]) {
    const service = new GetConsumerObservationRunMetricsOnDemandService({
      batchBuilder: {
        async execute() {
          return invalidBatch;
        },
      },
      now: () => "2026-08-22T12:00:00.000Z",
    });

    await assert.rejects(() => service.execute(principal, { scopeId, runId }));
  }
});
