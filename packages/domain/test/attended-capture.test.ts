import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAttendedCapture,
  type AttendedCaptureContext,
} from "../src/index.ts";

const validContext: AttendedCaptureContext = {
  surfaceCode: "consumer_web_example",
  expectedSurfaceCode: "consumer_web_example",
  pageOrigin: "https://example.com",
  expectedPageOrigin: "https://example.com",
  userInitiated: true,
  currentTaskId: "11111111-1111-4111-8111-111111111111",
  tokenTaskId: "11111111-1111-4111-8111-111111111111",
  isCurrentVisiblePage: true,
  pageSignatureStatus: "matched",
  answerState: "complete",
  sourcePanelState: "loaded",
  requestedDataKinds: [
    "answer_text",
    "visible_citations",
    "visible_metadata",
    "viewport_screenshot",
  ],
};

test("用户主动采集仍要求预览和最终确认", () => {
  assert.deepEqual(evaluateAttendedCapture(validContext), {
    allowed: true,
    requiresUserPreview: true,
    requiresFinalConfirmation: true,
  });
});

test("非用户触发、Surface、来源、任务和可见页不匹配时失败关闭", () => {
  const cases: Array<Partial<AttendedCaptureContext>> = [
    { userInitiated: false },
    { surfaceCode: "another_surface" },
    { pageOrigin: "https://another.example" },
    { pageOrigin: "not-a-valid-origin" },
    { tokenTaskId: "21111111-1111-4111-8111-111111111111" },
    { isCurrentVisiblePage: false },
  ];

  for (const changes of cases) {
    assert.equal(
      evaluateAttendedCapture({ ...validContext, ...changes }).allowed,
      false,
    );
  }
});

test("页面签名未知时回退人工录入", () => {
  assert.deepEqual(
    evaluateAttendedCapture({
      ...validContext,
      pageSignatureStatus: "unknown",
    }),
    {
      allowed: false,
      errorCode: "CAPTURE_PAGE_SIGNATURE_UNRECOGNIZED",
      fallback: "manual_import",
    },
  );
});

test("回答或来源仍在生成时等待", () => {
  assert.equal(
    evaluateAttendedCapture({
      ...validContext,
      answerState: "generating",
    }).allowed,
    false,
  );
  assert.equal(
    evaluateAttendedCapture({
      ...validContext,
      sourcePanelState: "loading",
    }).allowed,
    false,
  );
});

test("请求非白名单数据或缺少必需证据时拒绝", () => {
  assert.deepEqual(
    evaluateAttendedCapture({
      ...validContext,
      requestedDataKinds: [
        "answer_text",
        "visible_metadata",
        "viewport_screenshot",
        "cookie",
      ],
    }),
    {
      allowed: false,
      errorCode: "CAPTURE_FORBIDDEN_DATA_REQUESTED",
      fallback: "wait",
    },
  );
  assert.deepEqual(
    evaluateAttendedCapture({
      ...validContext,
      requestedDataKinds: ["answer_text", "visible_metadata"],
    }),
    {
      allowed: false,
      errorCode: "CAPTURE_REQUIRED_DATA_MISSING",
      fallback: "wait",
    },
  );
});
