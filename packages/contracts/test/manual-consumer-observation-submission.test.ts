import assert from "node:assert/strict";
import test from "node:test";

import {
  MANUAL_CONSUMER_OBSERVATION_ADAPTER_VERSION,
  adaptManualConsumerObservationToSubmission,
  manualConsumerObservationSubmissionInputSchema,
  submitConsumerCaptureInputSchema,
} from "../src/index.ts";

const input = {
  task_version: 2,
  answer_text: "人工录入的页面可见回答。",
  visible_citations: [
    {
      url: "https://example.com/source",
      label: "示例来源",
      position: 1,
    },
  ],
  visible_metadata: {
    product_label: "豆包网页版",
    surface_model_label: null,
    search_mode: "unknown",
    is_new_conversation: true,
    is_logged_in: true,
    memory_enabled: null,
    personalization_enabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
    observed_at: "2026-08-22T12:00:00.000Z",
  },
  screenshot_media_asset_id: "11111111-1111-4111-8111-111111111111",
} as const;

test("人工录入适配器固定采集方式和版本", () => {
  const submission = adaptManualConsumerObservationToSubmission(input);

  assert.equal(submission.collection_method, "manual_import");
  assert.equal(
    submission.adapter_version,
    MANUAL_CONSUMER_OBSERVATION_ADAPTER_VERSION,
  );
  assert.equal(submission.answer_text, input.answer_text);
  assert.deepEqual(
    submitConsumerCaptureInputSchema.parse(submission),
    submission,
  );
});

test("人工录入输入不能覆盖采集方式、版本或提交DOM引用", () => {
  for (const forbiddenField of [
    { collection_method: "browser_assisted" },
    { adapter_version: "doubao-web@1" },
    { sanitized_dom_object_key: "captures/raw-dom.html" },
    { cookie: "session=secret" },
  ]) {
    assert.throws(() =>
      manualConsumerObservationSubmissionInputSchema.parse({
        ...input,
        ...forbiddenField,
      }),
    );
  }
});

test("人工录入仍要求截图、可见元数据和合法HTTP引用", () => {
  assert.throws(() =>
    adaptManualConsumerObservationToSubmission({
      ...input,
      screenshot_media_asset_id: undefined,
    }),
  );
  assert.throws(() =>
    adaptManualConsumerObservationToSubmission({
      ...input,
      visible_citations: [{ url: "javascript:alert(1)", position: 1 }],
    }),
  );
  assert.throws(() =>
    adaptManualConsumerObservationToSubmission({
      ...input,
      visible_metadata: {
        ...input.visible_metadata,
        observed_at: "not-a-time",
      },
    }),
  );
});
