import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCaptureTokenUsable,
  assertObservationTaskTransition,
  canTransitionObservationTask,
  createCaptureTokenClaims,
  createConsumerSurfaceProfileVersion,
  deriveConsumerComparisonTier,
  evidenceGradeForConsumerCollectionMethod,
  isDefaultConsumerMetricEligible,
  type CreateConsumerSurfaceProfileVersionInput,
} from "../src/index.ts";

const baseProfile: CreateConsumerSurfaceProfileVersionInput = {
  id: "11111111-1111-4111-8111-111111111111",
  surfaceCode: "consumer-web-example",
  productLabel: "消费端产品示例",
  adapterVersion: "manual@1",
  allowedCollectionMethods: ["manual_import"],
  visibleSourceCapabilities: {
    visibleCitations: true,
    sourcePanel: true,
    screenshot: true,
    sanitizedDom: false,
  },
  equivalenceLevel: "unknown",
  status: "draft",
  createdBy: "21111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-21T00:00:00.000Z",
};

test("surface版本不可修改且采集方式去重", () => {
  const profile = createConsumerSurfaceProfileVersion({
    ...baseProfile,
    allowedCollectionMethods: ["manual_import", "manual_import"],
  });

  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.allowedCollectionMethods), true);
  assert.deepEqual(profile.allowedCollectionMethods, ["manual_import"]);
});

test("draft surface可等待采集方式审批，非draft必须已有获批方式", () => {
  const draft = createConsumerSurfaceProfileVersion({
    ...baseProfile,
    allowedCollectionMethods: [],
  });

  assert.deepEqual(draft.allowedCollectionMethods, []);
  assert.throws(
    () =>
      createConsumerSurfaceProfileVersion({
        ...baseProfile,
        allowedCollectionMethods: [],
        status: "active",
        termsReviewedAt: "2026-08-21T00:00:00.000Z",
      }),
    /SURFACE_COLLECTION_METHOD_REQUIRED/,
  );
});

test("active surface必须已有条款复核时间", () => {
  assert.throws(
    () =>
      createConsumerSurfaceProfileVersion({
        ...baseProfile,
        status: "active",
      }),
    /ACTIVE_SURFACE_TERMS_REVIEW_REQUIRED/,
  );
});

test("unknown映射不能伪造API model ID", () => {
  assert.throws(
    () =>
      createConsumerSurfaceProfileVersion({
        ...baseProfile,
        comparisonProviderCode: "provider-a",
        comparisonModelKey: "model-a",
      }),
    /UNKNOWN_EQUIVALENCE_API_MAPPING_FORBIDDEN/,
  );
});

test("exact映射必须有公开证据", () => {
  assert.throws(
    () =>
      createConsumerSurfaceProfileVersion({
        ...baseProfile,
        equivalenceLevel: "exact",
        comparisonSurfaceModelLabel: "Model A",
        comparisonProviderCode: "provider-a",
        comparisonModelKey: "model-a",
        equivalenceBasis: "公开模型快照说明",
        equivalenceReviewedAt: "2026-08-21T00:00:00.000Z",
      }),
    /EXACT_EQUIVALENCE_EVIDENCE_REQUIRED/,
  );
});

test("模型标签未知或不匹配时只能query_only", () => {
  const profile = createConsumerSurfaceProfileVersion({
    ...baseProfile,
    equivalenceLevel: "approximate",
    comparisonSurfaceModelLabel: "Model A",
    comparisonProviderCode: "provider-a",
    comparisonModelKey: "model-family-a",
    equivalenceBasis: "已审批模型族映射",
    equivalenceReviewedAt: "2026-08-21T00:00:00.000Z",
  });

  assert.equal(deriveConsumerComparisonTier(profile, null), "query_only");
  assert.equal(deriveConsumerComparisonTier(profile, "Model B"), "query_only");
  assert.equal(deriveConsumerComparisonTier(profile, "Model A"), "approximate");
});

test("观察任务必须先采集再审核确认", () => {
  assert.equal(canTransitionObservationTask("waiting_user", "capturing"), true);
  assert.equal(canTransitionObservationTask("capturing", "needs_review"), true);
  assert.equal(canTransitionObservationTask("needs_review", "confirmed"), true);
  assert.throws(
    () => assertObservationTaskTransition("capturing", "confirmed"),
    /INVALID_OBSERVATION_TASK_TRANSITION/,
  );
  assert.equal(canTransitionObservationTask("rejected", "needs_review"), false);
});

test("确认状态与证据等级保持独立", () => {
  assert.equal(
    evidenceGradeForConsumerCollectionMethod("browser_assisted"),
    "web_confirmed_capture",
  );
  assert.equal(
    evidenceGradeForConsumerCollectionMethod("manual_import"),
    "web_confirmed_manual",
  );
  assert.equal(
    isDefaultConsumerMetricEligible("confirmed", "web_confirmed_capture"),
    true,
  );
  assert.equal(
    isDefaultConsumerMetricEligible("needs_review", "web_confirmed_capture"),
    false,
  );
  assert.equal(
    isDefaultConsumerMetricEligible("confirmed", "imported_declared"),
    false,
  );
});

test("capture token绑定实例、scope、任务和用户并拒绝重放", () => {
  const claims = createCaptureTokenClaims({
    systemInstanceId: "wentian-instance-1",
    scopeId: "31111111-1111-4111-8111-111111111111",
    taskId: "41111111-1111-4111-8111-111111111111",
    userId: "51111111-1111-4111-8111-111111111111",
    audienceOrigin: "https://wentian.example.com",
    nonce: "nonce-1",
    issuedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-21T00:05:00.000Z",
  });
  const context = {
    systemInstanceId: claims.systemInstanceId,
    scopeId: claims.scopeId,
    taskId: claims.taskId,
    userId: claims.userId,
    requestOrigin: claims.audienceOrigin,
    now: "2026-08-21T00:01:00.000Z",
    alreadyConsumed: false,
  };

  assert.doesNotThrow(() => assertCaptureTokenUsable(claims, context));
  assert.throws(
    () =>
      assertCaptureTokenUsable(claims, {
        ...context,
        userId: "61111111-1111-4111-8111-111111111111",
      }),
    /CAPTURE_TOKEN_USER_MISMATCH/,
  );
  for (const [field, value, errorCode] of [
    ["systemInstanceId", "wentian-instance-2", "CAPTURE_TOKEN_SYSTEM_MISMATCH"],
    [
      "scopeId",
      "71111111-1111-4111-8111-111111111111",
      "CAPTURE_TOKEN_SCOPE_MISMATCH",
    ],
    [
      "taskId",
      "81111111-1111-4111-8111-111111111111",
      "CAPTURE_TOKEN_TASK_MISMATCH",
    ],
    [
      "requestOrigin",
      "https://other.example.com",
      "CAPTURE_TOKEN_ORIGIN_MISMATCH",
    ],
  ] as const) {
    assert.throws(
      () => assertCaptureTokenUsable(claims, { ...context, [field]: value }),
      new RegExp(errorCode),
    );
  }
  assert.throws(
    () =>
      assertCaptureTokenUsable(claims, {
        ...context,
        alreadyConsumed: true,
      }),
    /CAPTURE_TOKEN_ALREADY_CONSUMED/,
  );
  assert.throws(
    () =>
      assertCaptureTokenUsable(claims, {
        ...context,
        now: claims.expiresAt,
      }),
    /CAPTURE_TOKEN_EXPIRED/,
  );
});
