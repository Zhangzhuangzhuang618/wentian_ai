import assert from "node:assert/strict";
import test from "node:test";

import {
  loadDoubaoAutomationRuntime,
  loadQianwenAutomationRuntime,
} from "../src/doubao-automation-runtime.ts";

test("豆包生产自动化部署配置默认没有授权", () => {
  assert.deepEqual(loadDoubaoAutomationRuntime({}), {
    environment: "production",
    currentRegion: "CN_MAINLAND",
    authorizationBasis: "none",
    authorizationEvidenceId: null,
    authorizationReviewedAt: null,
  });
});

test("千问使用独立部署变量且生产配置默认没有授权", () => {
  assert.deepEqual(
    loadQianwenAutomationRuntime({
      WENTIAN_DOUBAO_AUTOMATION_ENVIRONMENT: "synthetic",
      WENTIAN_QIANWEN_AUTOMATION_ENVIRONMENT: "production",
    }),
    {
      environment: "production",
      currentRegion: "CN_MAINLAND",
      authorizationBasis: "none",
      authorizationEvidenceId: null,
      authorizationReviewedAt: null,
    },
  );
});

test("可显式配置合成环境或书面许可证据", () => {
  assert.deepEqual(
    loadDoubaoAutomationRuntime({
      WENTIAN_DOUBAO_AUTOMATION_ENVIRONMENT: "synthetic",
      WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_BASIS: "written_permission",
      WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_EVIDENCE_ID: "AUTH-001",
      WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_REVIEWED_AT:
        "2026-08-24T00:00:00.000Z",
    }),
    {
      environment: "synthetic",
      currentRegion: "CN_MAINLAND",
      authorizationBasis: "written_permission",
      authorizationEvidenceId: "AUTH-001",
      authorizationReviewedAt: "2026-08-24T00:00:00.000Z",
    },
  );
});

test("非法部署配置启动时失败关闭", () => {
  assert.throws(
    () =>
      loadDoubaoAutomationRuntime({
        WENTIAN_DOUBAO_AUTOMATION_ENVIRONMENT: "live",
      }),
    /INVALID_DOUBAO_AUTOMATION_ENVIRONMENT/,
  );
  assert.throws(
    () =>
      loadDoubaoAutomationRuntime({
        WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_BASIS: "internal_approval",
      }),
    /INVALID_DOUBAO_AUTOMATION_AUTHORIZATION_BASIS/,
  );
  assert.throws(
    () =>
      loadDoubaoAutomationRuntime({
        WENTIAN_DOUBAO_AUTOMATION_AUTHORIZATION_REVIEWED_AT: "2026-08-24",
      }),
    /INVALID_DOUBAO_AUTOMATION_AUTHORIZATION_REVIEWED_AT/,
  );
});
