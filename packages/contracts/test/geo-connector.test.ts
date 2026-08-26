import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeoProjectBindingRequestSchema,
  geoQuerySetSyncInputSchema,
  geoSsoTicketRequestSchema,
} from "../src/index.ts";

test("GEO绑定申请只接受显式项目引用而不接受问天项目", () => {
  const parsed = createGeoProjectBindingRequestSchema.parse({
    geo_workspace_ref: "workspace-1",
    geo_project_ref: "project-1",
    geo_project_display_name: "广州搬家",
  });
  assert.equal(parsed.geo_project_ref, "project-1");
  assert.throws(() =>
    createGeoProjectBindingRequestSchema.parse({
      ...parsed,
      scope_id: "11111111-1111-4111-8111-111111111111",
    }),
  );
});

test("GEO一次性登录拒绝未知角色和绝对跳转扩展字段", () => {
  assert.equal(
    geoSsoTicketRequestSchema.parse({
      geo_user_ref: "geo-user-1",
      geo_project_ref: "project-1",
      display_name: "分析员",
      role_codes: ["analyst"],
      requested_path: "/scopes/current",
    }).role_codes[0],
    "analyst",
  );
  assert.throws(() =>
    geoSsoTicketRequestSchema.parse({
      geo_user_ref: "geo-user-1",
      geo_project_ref: "project-1",
      display_name: "未知角色",
      role_codes: ["publisher"],
    }),
  );
});

test("GEO问题集同步使用版本化来源并限制为批准意图", () => {
  const parsed = geoQuerySetSyncInputSchema.parse({
    geo_query_set_ref: "query-set-1",
    geo_revision: "12",
    title: "广州搬家问题",
    locale: "zh-CN",
    market: "CN_MAINLAND",
    queries: [
      {
        external_key: "q1",
        text: "广州搬家公司哪家好？",
        intent: "recommendation",
        commercial_value: "high",
      },
    ],
  });
  assert.equal(parsed.queries.length, 1);
  assert.throws(() =>
    geoQuerySetSyncInputSchema.parse({
      ...parsed,
      queries: [{ ...parsed.queries[0], intent: "unknown" }],
    }),
  );
});
