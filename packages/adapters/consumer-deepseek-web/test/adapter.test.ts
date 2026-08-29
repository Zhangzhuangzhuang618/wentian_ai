import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEPSEEK_WEB_ADAPTER_MANIFEST,
  preflightDeepseekPromptAutomation,
} from "../src/index.ts";

test("DeepSeek Web 适配器使用独立 Surface 和页面签名", () => {
  assert.equal(DEEPSEEK_WEB_ADAPTER_MANIFEST.surfaceCode, "deepseek_web");
  assert.equal(
    DEEPSEEK_WEB_ADAPTER_MANIFEST.allowedPageOrigin,
    "https://chat.deepseek.com",
  );
  assert.equal(
    DEEPSEEK_WEB_ADAPTER_MANIFEST.adapterVersion,
    "deepseek-web@1-visible-page",
  );
  assert.equal(
    DEEPSEEK_WEB_ADAPTER_MANIFEST.pageSignatureVersion,
    "deepseek-web-signature@1-visible-page",
  );
});

test("DeepSeek Web 生产自动化默认失败关闭", () => {
  const result = preflightDeepseekPromptAutomation({
    automationEnabled: true,
    environment: "production",
    currentRegion: "CN_MAINLAND",
    transport: "visible_page",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.blockReason, "PRODUCTION_AUTHORIZATION_REQUIRED");
});

test("DeepSeek Web 合成环境可用于小规模页面驱动测试", () => {
  const result = preflightDeepseekPromptAutomation({
    automationEnabled: true,
    environment: "synthetic",
    currentRegion: "CN_MAINLAND",
    transport: "visible_page",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blockReason, null);
});
