import assert from "node:assert/strict";
import test from "node:test";

import {
  DOUBAO_WEB_ADAPTER_MANIFEST,
  DoubaoPromptAutomationExecutor,
  preflightDoubaoAutomationPolicy,
  preflightDoubaoAttendedCapture,
  type DoubaoPromptAutomationDriver,
  type DoubaoCaptureContext,
} from "../src/index.ts";

const apparentlyValidContext: DoubaoCaptureContext = {
  surfaceCode: "doubao_web",
  pageOrigin: "https://www.doubao.com",
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

test("豆包适配器默认用户在场且自动化能力受独立门禁控制", () => {
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.status, "active");
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.automationMode, "attended");
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.canAutomateLogin, false);
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.canAutomatePromptSubmission, true);
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.canReadHiddenNetwork, false);
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.canReadCredentials, false);
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.requiresUserCaptureClick, true);
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.requiresLocalPreview, true);
  assert.equal(DOUBAO_WEB_ADAPTER_MANIFEST.requiresFinalConfirmation, true);
});

test("豆包合成自动化可演练但当前生产自动化被外部授权门禁阻断", () => {
  const synthetic = preflightDoubaoAutomationPolicy({
    automationEnabled: true,
    environment: "synthetic",
    currentRegion: "CN_MAINLAND",
  });
  const production = preflightDoubaoAutomationPolicy({
    automationEnabled: true,
    environment: "production",
    currentRegion: "CN_MAINLAND",
  });

  assert.equal(synthetic.allowed, true);
  assert.equal(synthetic.requestedMode, "automated");
  assert.equal(production.allowed, false);
  assert.equal(production.blockReason, "PRODUCTION_AUTHORIZATION_REQUIRED");
});

test("用户主动选择且页面条件匹配时允许用户在场采集", () => {
  assert.deepEqual(preflightDoubaoAttendedCapture(apparentlyValidContext), {
    allowed: true,
    requiresUserPreview: true,
    requiresFinalConfirmation: true,
  });
});

test("自动化开关默认关闭且不会调用执行驱动", async () => {
  const driver = new FakeAutomationDriver();
  const executor = new DoubaoPromptAutomationExecutor({
    driver,
    environment: "production",
    currentRegion: "CN_MAINLAND",
  });

  const result = await executor.execute({ prompt: "广州搬家公司哪家好？" });

  assert.equal(result.status, "attended_required");
  assert.equal(result.blockReason, "AUTOMATION_SWITCH_DISABLED");
  assert.equal(driver.executionCount, 0);
});

test("缺少平台授权时生产自动化失败关闭且不会调用驱动", async () => {
  const driver = new FakeAutomationDriver();
  const executor = new DoubaoPromptAutomationExecutor({
    driver,
    environment: "production",
    currentRegion: "CN_MAINLAND",
    authorizationBasis: "none",
  });

  const result = await executor.execute({
    automationEnabled: true,
    prompt: "广州搬家公司哪家好？",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blockReason, "PRODUCTION_AUTHORIZATION_REQUIRED");
  assert.equal(driver.executionCount, 0);
});

test("授权门禁满足后执行可见页面驱动但结果仍必须人工复核", async () => {
  const driver = new FakeAutomationDriver({
    pageUrl: "https://www.doubao.com/chat",
  });
  const executor = new DoubaoPromptAutomationExecutor({
    driver,
    environment: "production",
    currentRegion: "CN_MAINLAND",
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-DOUBAO-001",
    authorizationReviewedAt: "2026-08-23T12:00:00.000Z",
    now: "2026-08-23T12:00:00.000Z",
  });

  const result = await executor.execute({
    automationEnabled: true,
    prompt: "  广州搬家公司哪家好？  ",
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.policy.productionAuthorizationSatisfied, true);
  assert.equal(result.capture?.reviewStatus, "needs_review");
  assert.equal(result.capture?.answerText, "测试回答");
  assert.equal(driver.lastPrompt, "广州搬家公司哪家好？");
  assert.equal(driver.executionCount, 1);
});

test("官方接口授权不能被用于启动可见页面驱动", async () => {
  const driver = new FakeAutomationDriver();
  const executor = new DoubaoPromptAutomationExecutor({
    driver,
    environment: "production",
    currentRegion: "CN_MAINLAND",
    authorizationBasis: "official_interface",
    authorizationEvidenceId: "AUTH-DOUBAO-API-001",
  });

  const result = await executor.execute({
    automationEnabled: true,
    prompt: "广州搬家公司哪家好？",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blockReason, "PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH");
  assert.equal(driver.executionCount, 0);
});

test("合成环境可测试自动化链路且非法页面结果失败关闭", async () => {
  const driver = new FakeAutomationDriver({
    pageUrl: "https://example.com/chat/not-doubao",
  });
  const executor = new DoubaoPromptAutomationExecutor({
    driver,
    environment: "synthetic",
    currentRegion: "CN_MAINLAND",
  });

  await assert.rejects(
    executor.execute({
      automationEnabled: true,
      prompt: "广州搬家公司哪家好？",
    }),
    /DOUBAO_AUTOMATION_PAGE_NOT_ALLOWED/,
  );
});

class FakeAutomationDriver implements DoubaoPromptAutomationDriver {
  readonly transport = "visible_page" as const;
  executionCount = 0;
  lastPrompt: string | null = null;
  private readonly pageUrl: string;

  constructor(options: { readonly pageUrl?: string } = {}) {
    this.pageUrl =
      options.pageUrl ?? "https://www.doubao.com/chat/validation-session";
  }

  async execute(input: { readonly prompt: string }) {
    this.executionCount += 1;
    this.lastPrompt = input.prompt;
    return {
      answerText: "测试回答",
      visibleCitations: [
        { url: "https://example.com/source", label: "示例信源", position: 1 },
      ],
      pageUrl: this.pageUrl,
      pageTitle: "豆包测试会话",
      observedAt: "2026-08-23T12:00:00.000Z",
      completionStatus: "complete" as const,
      screenshotPngDataUrl: "data:image/png;base64,AA==",
    };
  }
}
