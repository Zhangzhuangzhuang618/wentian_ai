import assert from "node:assert/strict";
import test from "node:test";

import {
  syntheticClaimObservationTaskInputSchema,
  syntheticConfirmObservationInputSchema,
  syntheticRejectObservationInputSchema,
  syntheticSubmitCaptureInputSchema,
} from "../src/index.ts";

const base = {
  scope_id: "11111111-1111-4111-8111-111111111111",
  task_version: 1,
} as const;

test("合成任务动作只接受scope和正整数版本", () => {
  assert.deepEqual(syntheticClaimObservationTaskInputSchema.parse(base), base);
  assert.deepEqual(syntheticConfirmObservationInputSchema.parse(base), base);
});

test("合成采集接口拒绝真实回答、截图和引用字段", () => {
  const capture = { ...base, capture_token: "synthetic-token" };

  assert.deepEqual(syntheticSubmitCaptureInputSchema.parse(capture), capture);
  for (const forbidden of [
    { answer_text: "真实回答" },
    { screenshot: "data:image/png;base64,AA==" },
    { visible_citations: [] },
  ]) {
    assert.throws(() =>
      syntheticSubmitCaptureInputSchema.parse({ ...capture, ...forbidden }),
    );
  }
});

test("合成拒绝接口限制原因长度并拒绝额外字段", () => {
  assert.equal(
    syntheticRejectObservationInputSchema.parse({
      ...base,
      rejection_reason: "合成拒绝测试",
    }).rejection_reason,
    "合成拒绝测试",
  );
  assert.throws(() =>
    syntheticRejectObservationInputSchema.parse({
      ...base,
      rejection_reason: "拒".repeat(1_001),
    }),
  );
  assert.throws(() =>
    syntheticRejectObservationInputSchema.parse({
      ...base,
      rejection_reason: "测试",
      cookie: "secret",
    }),
  );
});
