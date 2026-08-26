import assert from "node:assert/strict";
import test from "node:test";

import {
  consumerAutomationSettingsSchema,
  createStandaloneScopeInputSchema,
  localLoginInputSchema,
  localSessionResponseSchema,
  requestScopeDeletionInputSchema,
  scopeDeletionJobSchema,
  updateStandaloneScopeMetadataInputSchema,
} from "../src/index.ts";

test("本地访问契约接受最小登录、会话、项目和自动化设置", () => {
  assert.equal(
    localLoginInputSchema.parse({
      email: "Owner@Example.com",
      password: "a-long-owner-password",
    }).email,
    "Owner@Example.com",
  );
  assert.equal(
    createStandaloneScopeInputSchema.parse({
      project_key: "guangzhou-moving",
      display_name: "广州搬家",
      industry: "搬家",
      region: "广州",
    }).project_key,
    "guangzhou-moving",
  );
  assert.equal(
    updateStandaloneScopeMetadataInputSchema.parse({
      industry: "搬家服务",
      region: "广州",
      version: 2,
    }).version,
    2,
  );
  assert.equal(
    consumerAutomationSettingsSchema.parse({
      scope_id: "21111111-1111-4111-8111-111111111111",
      automation_enabled: false,
      allowed_usage_region: "CN_MAINLAND",
      governance_policy_version: "consumer-observation-governance@1",
      version: 1,
      updated_at: "2026-08-23T12:00:00.000Z",
    }).automation_enabled,
    false,
  );
  assert.equal(
    localSessionResponseSchema.parse({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "owner@example.com",
        display_name: "Owner",
        instance_role: "owner",
        authorization_role: "owner",
        auth_source: "local",
      },
      csrf_token: "a".repeat(43),
      expires_at: "2026-08-23T20:00:00.000Z",
    }).user.instance_role,
    "owner",
  );
});

test("项目删除契约要求项目标识、密码和当前版本", () => {
  const input = requestScopeDeletionInputSchema.parse({
    project_key: "guangzhou-moving",
    password: "a-long-owner-password",
    version: 2,
  });
  assert.equal(input.version, 2);
  const job = scopeDeletionJobSchema.parse({
    id: "31111111-1111-4111-8111-111111111111",
    scope_id: "21111111-1111-4111-8111-111111111111",
    project_key: "guangzhou-moving",
    status: "failed",
    attempt_count: 1,
    requested_at: "2026-08-23T12:00:00.000Z",
    completed_at: "2026-08-23T12:00:01.000Z",
    last_error_code: "SCOPE_OBJECT_DELETE_FAILED",
  });
  assert.equal(job.status, "failed");
  assert.throws(() =>
    requestScopeDeletionInputSchema.parse({
      project_key: "guangzhou-moving",
      password: "a-long-owner-password",
      version: 2,
      recycle_bin: true,
    }),
  );
});

test("本地访问契约拒绝额外字段和非法项目键", () => {
  assert.throws(() =>
    localLoginInputSchema.parse({
      email: "owner@example.com",
      password: "a-long-owner-password",
      remember_me: true,
    }),
  );
  assert.throws(() =>
    createStandaloneScopeInputSchema.parse({
      project_key: "广州搬家",
      display_name: "广州搬家",
    }),
  );
});
