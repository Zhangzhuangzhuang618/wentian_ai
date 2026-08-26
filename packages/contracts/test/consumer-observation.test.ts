import assert from "node:assert/strict";
import test from "node:test";

import {
  attendedCapturePreflightInputSchema,
  createConsumerObservationInputSchema,
  publishConsumerSurfaceProfileInputSchema,
  submitConsumerCaptureInputSchema,
} from "../src/index.ts";

const observationInput = {
  scope_id: "11111111-1111-4111-8111-111111111111",
  query_set_snapshot_id: "21111111-1111-4111-8111-111111111111",
  surface_code: "consumer-web-example",
  collection_method: "manual_import",
  experiment_kind: "natural_answer",
  sample_count: 3,
  session_conditions: {
    search_mode: "unknown",
    is_new_conversation: true,
    is_logged_in: true,
    memory_enabled: null,
    personalization_enabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
  },
};

const captureInput = {
  task_version: 1,
  answer_text: "页面当前可见回答",
  visible_citations: [
    {
      url: "https://example.com/source",
      label: "可见来源",
      position: 1,
    },
  ],
  visible_metadata: {
    product_label: "消费端产品示例",
    surface_model_label: null,
    search_mode: "unknown",
    is_new_conversation: true,
    is_logged_in: true,
    memory_enabled: null,
    personalization_enabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
    observed_at: "2026-08-21T08:00:00+08:00",
  },
  screenshot_media_asset_id: "31111111-1111-4111-8111-111111111111",
  adapter_version: "manual@1",
  collection_method: "manual_import",
};

test("消费端观察只接受web_observed允许的采集方式", () => {
  assert.equal(
    createConsumerObservationInputSchema.safeParse(observationInput).success,
    true,
  );
  assert.equal(
    createConsumerObservationInputSchema.safeParse({
      ...observationInput,
      collection_method: "provider_api",
    }).success,
    false,
  );
});

test("Surface发布契约拒绝未复核的active配置", () => {
  const surfaceInput = {
    surface_code: "consumer-web-example",
    product_label: "消费端产品示例",
    adapter_version: "manual@1",
    allowed_collection_methods: ["manual_import"],
    visible_source_capabilities: {
      visible_citations: true,
      source_panel: true,
      screenshot: true,
      sanitized_dom: false,
    },
    comparison_surface_model_label: null,
    comparison_provider_code: null,
    comparison_model_key: null,
    equivalence_level: "unknown",
    equivalence_basis: null,
    equivalence_evidence_url: null,
    equivalence_reviewed_at: null,
    terms_reviewed_at: null,
    status: "active",
  };

  assert.equal(
    publishConsumerSurfaceProfileInputSchema.safeParse(surfaceInput).success,
    false,
  );
  assert.equal(
    publishConsumerSurfaceProfileInputSchema.safeParse({
      ...surfaceInput,
      status: "draft",
      allowed_collection_methods: [],
    }).success,
    true,
  );
  assert.equal(
    publishConsumerSurfaceProfileInputSchema.safeParse({
      ...surfaceInput,
      terms_reviewed_at: "2026-08-21T00:00:00+08:00",
      allowed_collection_methods: [],
    }).success,
    false,
  );
});

test("消费端观察样本数限制为1至5", () => {
  assert.equal(
    createConsumerObservationInputSchema.safeParse({
      ...observationInput,
      sample_count: 0,
    }).success,
    false,
  );
  assert.equal(
    createConsumerObservationInputSchema.safeParse({
      ...observationInput,
      sample_count: 6,
    }).success,
    false,
  );
});

test("观察包要求截图并只接受HTTP或HTTPS可见引用", () => {
  assert.equal(
    submitConsumerCaptureInputSchema.safeParse(captureInput).success,
    true,
  );
  assert.equal(
    submitConsumerCaptureInputSchema.safeParse({
      ...captureInput,
      screenshot_media_asset_id: undefined,
    }).success,
    false,
  );
  assert.equal(
    submitConsumerCaptureInputSchema.safeParse({
      ...captureInput,
      visible_citations: [
        { url: "javascript:alert(1)", label: "x", position: 1 },
      ],
    }).success,
    false,
  );
});

test("观察包严格拒绝Cookie、Token和账号标识", () => {
  for (const forbiddenField of [
    "cookie",
    "authorization",
    "local_storage",
    "account_email",
  ]) {
    assert.equal(
      submitConsumerCaptureInputSchema.safeParse({
        ...captureInput,
        visible_metadata: {
          ...captureInput.visible_metadata,
          [forbiddenField]: "secret",
        },
      }).success,
      false,
    );
  }
});

test("客户端不能在观察运行中提交Provider模型归属", () => {
  assert.equal(
    createConsumerObservationInputSchema.safeParse({
      ...observationInput,
      provider_code: "provider-a",
      model_key: "model-a",
    }).success,
    false,
  );
});

test("采集预检契约只接受可见数据白名单", () => {
  const preflight = {
    surface_code: "doubao_web",
    page_origin: "https://www.doubao.com",
    user_initiated: true,
    current_task_id: "41111111-1111-4111-8111-111111111111",
    token_task_id: "41111111-1111-4111-8111-111111111111",
    is_current_visible_page: true,
    page_signature_status: "matched",
    answer_state: "complete",
    source_panel_state: "loaded",
    requested_data_kinds: [
      "answer_text",
      "visible_citations",
      "visible_metadata",
      "viewport_screenshot",
    ],
  };

  assert.equal(
    attendedCapturePreflightInputSchema.safeParse(preflight).success,
    true,
  );
  assert.equal(
    attendedCapturePreflightInputSchema.safeParse({
      ...preflight,
      requested_data_kinds: ["answer_text", "cookie"],
    }).success,
    false,
  );
  assert.equal(
    attendedCapturePreflightInputSchema.safeParse({
      ...preflight,
      page_origin: "https://www.doubao.com/chat/",
    }).success,
    false,
  );
  assert.equal(
    attendedCapturePreflightInputSchema.safeParse({
      ...preflight,
      requested_data_kinds: ["answer_text", "visible_metadata"],
    }).success,
    false,
  );
});
