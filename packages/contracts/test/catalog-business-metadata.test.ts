import assert from "node:assert/strict";
import test from "node:test";

import {
  createStandaloneQuerySetInputSchema,
  standaloneConsumerCatalogResponseSchema,
} from "../src/index.ts";

const scopeId = "21111111-1111-4111-8111-111111111111";
const snapshotId = "31111111-1111-4111-8111-111111111111";
const runId = "41111111-1111-4111-8111-111111111111";

test("独立版问题集要求业务地区和行业并接受生成器版本", () => {
  const parsed = createStandaloneQuerySetInputSchema.parse({
    scope_id: scopeId,
    title: "广州搬家观察",
    locale: "zh-CN",
    market: "广州",
    industry: "搬家",
    region: "广州",
    generator_version: "industry-question-generator@1",
    queries: [
      {
        query_text: "广州搬家公司哪家好？",
        intent_code: "recommendation",
        commercial_value: "high",
      },
    ],
  });
  assert.equal(parsed.industry, "搬家");
  assert.equal(parsed.generator_version, "industry-question-generator@1");
  assert.equal(
    createStandaloneQuerySetInputSchema.safeParse({
      ...parsed,
      industry: undefined,
    }).success,
    false,
  );
});

test("目录把问题集地区行业投影到实验运行", () => {
  const parsed = standaloneConsumerCatalogResponseSchema.parse({
    snapshots: [
      {
        id: snapshotId,
        title: "广州搬家观察",
        industry: "搬家",
        region: "广州",
        generator_version: null,
        query_count: 1,
        snapshot_hash: "a".repeat(64),
        created_at: "2026-08-26T00:00:00.000Z",
      },
    ],
    runs: [
      {
        id: runId,
        query_set_snapshot_id: snapshotId,
        industry: "搬家",
        region: "广州",
        surface_code: "doubao_web",
        experiment_kind: "natural_answer",
        paired_run_id: null,
        status: "queued",
        requested_sample_count: 1,
        planned_sample_count: 1,
        successful_sample_count: 0,
        session_conditions: {
          search_mode: "unknown",
          is_new_conversation: true,
          is_logged_in: true,
          memory_enabled: false,
          personalization_enabled: false,
          locale: "zh-CN",
          region: "CN_MAINLAND",
        },
        created_at: "2026-08-26T00:00:00.000Z",
        started_at: null,
        completed_at: null,
      },
    ],
  });
  assert.equal(parsed.runs[0]!.region, "广州");
  assert.equal(parsed.runs[0]!.session_conditions.region, "CN_MAINLAND");
});
