import assert from "node:assert/strict";
import test from "node:test";

import {
  QIANWEN_WEB_ADAPTER_MANIFEST,
  preflightQianwenPromptAutomation,
} from "../src/index.ts";

test("千问适配器固定官网Surface且生产自动化默认失败关闭", () => {
  assert.equal(QIANWEN_WEB_ADAPTER_MANIFEST.surfaceCode, "qianwen_web");
  assert.equal(
    QIANWEN_WEB_ADAPTER_MANIFEST.allowedPageOrigin,
    "https://www.qianwen.com",
  );
  assert.equal(
    QIANWEN_WEB_ADAPTER_MANIFEST.adapterVersion,
    "qianwen-web@2-visible-reference-panel",
  );
  assert.equal(
    QIANWEN_WEB_ADAPTER_MANIFEST.pageSignatureVersion,
    "qianwen-web-signature@2-visible-reference-panel",
  );
  const result = preflightQianwenPromptAutomation({
    automationEnabled: true,
    environment: "production",
    currentRegion: "CN_MAINLAND",
    transport: "visible_page",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.blockReason, "PRODUCTION_AUTHORIZATION_REQUIRED");
});

test("千问合成环境可验证可见页面驱动但仍要求最终复核", () => {
  const result = preflightQianwenPromptAutomation({
    automationEnabled: true,
    environment: "synthetic",
    currentRegion: "CN_MAINLAND",
    transport: "visible_page",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.policy.requiresFinalReview, true);
});
