import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONSUMER_OBSERVATION_GOVERNANCE_POLICY,
  evaluateConsumerAutomationPolicy,
} from "../src/index.ts";

const base = {
  environment: "production",
  surfaceStatus: "active",
  adapterSupportsAutomation: true,
  authorizationBasis: "written_permission",
  authorizationEvidenceId: "permission-2026-001",
  currentRegion: "CN_MAINLAND",
  allowedRegions: ["CN_MAINLAND"],
} as const;

test("自动化开关未提供时默认关闭并保持用户在场流程", () => {
  const decision = evaluateConsumerAutomationPolicy(base);

  assert.equal(decision.automationEnabled, false);
  assert.equal(decision.requestedMode, "attended");
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresUserPromptSubmission, true);
  assert.equal(decision.requiresUserCaptureClick, true);
  assert.equal(decision.requiresLocalPreview, true);
  assert.equal(decision.requiresFinalReview, true);
});

test("合成环境可验证自动化路径且仍要求最终复核", () => {
  const decision = evaluateConsumerAutomationPolicy({
    ...base,
    environment: "synthetic",
    surfaceStatus: "draft",
    automationEnabled: true,
    authorizationBasis: "none",
    authorizationEvidenceId: null,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.requestedMode, "automated");
  assert.equal(decision.productionAuthorizationSatisfied, false);
  assert.equal(decision.requiresUserPromptSubmission, false);
  assert.equal(decision.requiresUserCaptureClick, false);
  assert.equal(decision.requiresLocalPreview, false);
  assert.equal(decision.requiresFinalReview, true);
});

test("生产自动化要求active、允许地区和带证据的外部授权", () => {
  assert.deepEqual(
    evaluateConsumerAutomationPolicy({
      ...base,
      surfaceStatus: "draft",
      automationEnabled: true,
    }).blockReason,
    "SURFACE_NOT_ACTIVE",
  );
  assert.deepEqual(
    evaluateConsumerAutomationPolicy({
      ...base,
      automationEnabled: true,
      currentRegion: "US",
    }).blockReason,
    "REGION_NOT_ALLOWED",
  );
  assert.deepEqual(
    evaluateConsumerAutomationPolicy({
      ...base,
      automationEnabled: true,
      authorizationBasis: "none",
      authorizationEvidenceId: null,
    }).blockReason,
    "PRODUCTION_AUTHORIZATION_REQUIRED",
  );
  assert.deepEqual(
    evaluateConsumerAutomationPolicy({
      ...base,
      automationEnabled: true,
      authorizationEvidenceId: " ",
    }).blockReason,
    "PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED",
  );
});

test("默认保留期、地区和责任策略准确且深度不可变", () => {
  const policy = DEFAULT_CONSUMER_OBSERVATION_GOVERNANCE_POLICY;

  assert.equal(policy.dataRegion, "CN_MAINLAND");
  assert.equal(policy.retention.pendingCaptureHours, 24);
  assert.equal(policy.retention.confirmedScreenshotDays, 30);
  assert.equal(policy.retention.confirmedAnswerDays, 180);
  assert.equal(policy.retention.confirmedVisibleCitationDays, 180);
  assert.equal(policy.retention.sanitizedDomEnabled, false);
  assert.equal(policy.retention.scopeDeletionPurgeMaxDays, 30);
  assert.equal(policy.responsibility.projectPolicyOwnerRole, "owner");
  assert.equal(policy.responsibility.termsReviewIntervalDays, 90);
  assert.throws(
    () =>
      (policy.allowedUsageRegions as unknown as string[]).push("OTHER_REGION"),
    TypeError,
  );
});

test("未知授权依据和空地区策略失败关闭", () => {
  assert.throws(
    () =>
      evaluateConsumerAutomationPolicy({
        ...base,
        authorizationBasis: "internal_approval" as "none",
      }),
    /INVALID_CONSUMER_AUTOMATION_AUTHORIZATION_BASIS/,
  );
  assert.throws(
    () =>
      evaluateConsumerAutomationPolicy({
        ...base,
        allowedRegions: [],
      }),
    /INVALID_CONSUMER_AUTOMATION_REGION_POLICY/,
  );
});
