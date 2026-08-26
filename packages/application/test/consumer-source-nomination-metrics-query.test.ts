import assert from "node:assert/strict";
import test from "node:test";

import {
  GetConsumerSourceNominationRunMetricsOnDemandService,
  WentianApplicationError,
  computeConsumerSourceNominationMetricSampleBatch,
  type ConsumerSourceNominationMetricSampleBatch,
} from "../src/index.ts";
import { createWentianPrincipal } from "@wentian/domain";

test("按需构建批次并计算带运行上下文的自述指标报告", async () => {
  let callCount = 0;
  const service = new GetConsumerSourceNominationRunMetricsOnDemandService({
    batchBuilder: {
      execute: async () => {
        callCount += 1;
        return batch;
      },
    },
    now: () => "2026-08-22T13:00:00.000Z",
  });

  const report = await service.execute(principal, query);

  assert.equal(callCount, 1);
  assert.equal(report.runId, "run-1");
  assert.equal(report.experimentKind, "source_nomination");
  assert.equal(report.nominationContext, "unaided");
  assert.equal(report.consumerSurfaceCode, "doubao_web");
  assert.equal(report.availability, "available");
  assert.equal(report.validatedSampleCount, 1);
  assert.deepEqual(report.excludedParseCounts, {
    needsReview: 1,
    rejected: 0,
  });
  assert.equal(report.groups[0].domains[0].registrableDomain, "example.com");
});

test("无scope权限时不调用批次构建器", async () => {
  let called = false;
  const service = new GetConsumerSourceNominationRunMetricsOnDemandService({
    batchBuilder: {
      execute: async () => {
        called = true;
        return batch;
      },
    },
    now: () => "2026-08-22T13:00:00.000Z",
  });

  await assert.rejects(
    () =>
      service.execute(
        createWentianPrincipal({
          userId: "user-1",
          role: "viewer",
          allowedScopeIds: [],
        }),
        query,
      ),
    (error: unknown) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
  assert.equal(called, false);
});

test("构建器返回其他运行批次时失败关闭", async () => {
  const service = new GetConsumerSourceNominationRunMetricsOnDemandService({
    batchBuilder: {
      execute: async () => ({ ...batch, runId: "wrong-run" }),
    },
    now: () => "2026-08-22T13:00:00.000Z",
  });

  await assert.rejects(
    () => service.execute(principal, query),
    /SOURCE_NOMINATION_METRIC_BATCH_IDENTITY_MISMATCH/,
  );
});

test("GEO版本、实验类型、上下文和样本上下文漂移时失败关闭", () => {
  assert.throws(
    () =>
      computeConsumerSourceNominationMetricSampleBatch(
        { ...batch, querySetSourceType: "geo_sync" },
        "2026-08-22T13:00:00.000Z",
      ),
    /GEO_VERSION_MISMATCH/,
  );
  assert.throws(
    () =>
      computeConsumerSourceNominationMetricSampleBatch(
        {
          ...batch,
          experimentKind: "natural_answer" as "source_nomination",
        },
        "2026-08-22T13:00:00.000Z",
      ),
    /CONTEXT_REQUIRED/,
  );
  assert.throws(
    () =>
      computeConsumerSourceNominationMetricSampleBatch(
        {
          ...batch,
          samples: [
            {
              ...batch.samples[0],
              nominationContext: "search_assisted",
            },
            batch.samples[1],
          ],
        },
        "2026-08-22T13:00:00.000Z",
      ),
    /SAMPLE_RUN_CONTEXT_MISMATCH/,
  );
});

const batch: ConsumerSourceNominationMetricSampleBatch = Object.freeze({
  scopeId: "scope-1",
  runId: "run-1",
  querySetSnapshotHash: "a".repeat(64),
  querySetSourceType: "local",
  geoConnectorContractVersion: null,
  experimentKind: "source_nomination",
  collectionMethod: "browser_assisted",
  nominationContext: "unaided",
  surfaceProfileVersionId: "surface-1",
  consumerSurfaceCode: "doubao_web",
  normalizationVersion: "url-normalization@1",
  unsupportedInternalClaimSampleCount: 0,
  unsupportedInternalClaimAssessmentVersions: Object.freeze([
    "unsupported-internal-claim@1",
  ]),
  sampleBasis: Object.freeze({ planned: 2, successful: 2, failed: 0 }),
  samples: Object.freeze([
    Object.freeze({
      id: "response-1",
      querySnapshotItemId: "query-1",
      nominationContext: "unaided",
      validationStatus: "human_confirmed",
      nominations: Object.freeze([
        Object.freeze({ registrableDomain: "example.com", position: 1 }),
      ]),
    }),
    Object.freeze({
      id: "response-2",
      querySnapshotItemId: "query-1",
      nominationContext: "unaided",
      validationStatus: "needs_review",
      nominations: Object.freeze([]),
    }),
  ]),
});

const principal = createWentianPrincipal({
  userId: "user-1",
  role: "viewer",
  allowedScopeIds: ["scope-1"],
});
const query = { scopeId: "scope-1", runId: "run-1" } as const;
