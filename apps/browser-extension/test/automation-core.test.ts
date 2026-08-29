import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

interface AutomationCore {
  readonly PAGE_SIGNATURE_VERSION: string;
  readonly pageSignatureVersion: (surfaceCode: string) => string | null;
  readonly isBlankComposerText: (value: string, surfaceCode: string) => boolean;
  readonly isNewConversationLabel: (value: string) => boolean;
  readonly parseReferencePanelLabel: (value: string) => number | null;
  readonly selectComposer: (candidates: readonly unknown[]) => unknown;
  readonly selectNewAnswer: (
    candidates: readonly unknown[],
    baselineTexts: readonly string[],
  ) => unknown;
  readonly selectSubmitControl: (candidates: readonly unknown[]) => unknown;
  readonly selectReferencePanelTrigger: (
    candidates: readonly unknown[],
  ) => unknown;
  readonly selectReferencePanelLinkChange: (input: unknown) => unknown;
  readonly isStableCompleteAnswer: (input: unknown) => boolean;
}

const source = await readFile(
  new URL("../automation-core.js", import.meta.url),
  "utf8",
);
const context = {} as Record<string, unknown>;
runInNewContext(source, context);
const core = context.WentianAutomationCore as AutomationCore;

test("页面驱动优先选择可见、可用且靠近页面底部的输入框", () => {
  const hidden = {
    id: "hidden",
    kind: "textarea",
    visible: false,
    viewportBottomScore: 20,
  };
  const composer = {
    id: "composer",
    kind: "contenteditable",
    role: "textbox",
    label: "发送消息",
    visible: true,
    viewportBottomScore: 19,
  };

  assert.equal(core.selectComposer([hidden, composer]), composer);
  assert.equal(
    core.PAGE_SIGNATURE_VERSION,
    "doubao-web-signature@6-visible-reference-panel",
  );
});

test("参考资料入口只识别有界数量并优先绑定当前回答", () => {
  assert.equal(
    core.parseReferencePanelLabel("搜索 4 个关键词，参考 22 篇资料"),
    22,
  );
  assert.equal(core.parseReferencePanelLabel("参考来源：企业官网"), null);
  assert.equal(core.parseReferencePanelLabel("6篇来源"), 6);
  assert.equal(core.parseReferencePanelLabel("参考来源 (6)"), 6);
  assert.equal(core.parseReferencePanelLabel("参考来源（100）"), 100);
  assert.equal(core.parseReferencePanelLabel("101篇来源"), null);
  assert.equal(core.parseReferencePanelLabel("参考 101 篇资料"), null);
  assert.equal(
    core.pageSignatureVersion("qianwen_web"),
    "qianwen-web-signature@2-visible-reference-panel",
  );
  assert.equal(
    core.pageSignatureVersion("deepseek_web"),
    "deepseek-web-signature@1-visible-page",
  );

  const stale = {
    id: "stale",
    label: "参考 8 篇资料",
    visible: true,
    nearAnswer: true,
    insideAnswer: false,
    distance: 300,
    area: 4_000,
  };
  const current = {
    id: "current",
    label: "搜索 4 个关键词，参考 22 篇资料",
    visible: true,
    nearAnswer: true,
    insideAnswer: true,
    distance: 0,
    area: 5_000,
  };
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(core.selectReferencePanelTrigger([stale, current])),
    ),
    { ...current, expectedCount: 22 },
  );
});

test("参考资料链接按面板展开或收起产生的可见差异完整提取", () => {
  const sidebar = {
    key: "sidebar",
    url: "https://www.doubao.com/chat/example",
    visible: true,
  };
  const source1 = {
    key: "source-1",
    url: "https://example.com/one",
    visible: true,
  };
  const source2 = {
    key: "source-2",
    url: "https://example.com/two",
    visible: true,
  };
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        core.selectReferencePanelLinkChange({
          before: [sidebar],
          after: [sidebar, source1, source2],
          expectedCount: 2,
        }),
      ),
    ),
    { status: "complete", direction: "opened", links: [source1, source2] },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        core.selectReferencePanelLinkChange({
          before: [sidebar, source1, source2],
          after: [sidebar],
          expectedCount: 2,
        }),
      ),
    ),
    { status: "complete", direction: "closed", links: [source1, source2] },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        core.selectReferencePanelLinkChange({
          before: [sidebar],
          after: [sidebar, source1],
          expectedCount: 2,
        }),
      ),
    ),
    { status: "incomplete", direction: "opened", links: [source1] },
  );
});

test("发送控件优先识别按钮标识并拒绝语音或停止按钮", () => {
  const voice = {
    id: "voice",
    label: "语音输入",
    iconOnly: true,
    visible: true,
    nearComposer: true,
    onComposerRight: true,
    proximityScore: 20,
  };
  const send = {
    id: "send",
    identifier: "chat-input-send-button",
    iconOnly: true,
    visible: true,
    nearComposer: true,
    onComposerRight: true,
    proximityScore: 18,
  };
  const stop = {
    id: "stop",
    label: "停止生成",
    submitType: true,
    visible: true,
  };

  assert.equal(core.selectSubmitControl([voice, send, stop]), send);
});

test("发送控件可以回退到输入框右侧的可用图标按钮", () => {
  const disabled = {
    id: "disabled",
    identifier: "send",
    visible: true,
    disabled: true,
  };
  const icon = {
    id: "icon",
    iconOnly: true,
    visible: true,
    nearComposer: true,
    onComposerRight: true,
    proximityScore: 20,
  };

  assert.equal(core.selectSubmitControl([disabled, icon]), icon);
});

test("回答候选必须是提交后新增的可见长文本", () => {
  const oldAnswer = {
    id: "old",
    key: "old-node",
    text: "旧回答".repeat(50),
    visible: true,
    viewportTop: 200,
    depth: 5,
  };
  const newAnswer = {
    id: "new",
    key: "new-node",
    text: "新回答及其可见信源".repeat(30),
    visible: true,
    viewportTop: 800,
    depth: 8,
  };

  assert.equal(
    core.selectNewAnswer([oldAnswer, newAnswer], [oldAnswer.key]),
    newAnswer,
  );
  assert.equal(
    (
      core.selectNewAnswer(
        [oldAnswer, { ...newAnswer, text: oldAnswer.text }],
        [oldAnswer.key],
      ) as { readonly id: string }
    ).id,
    "new",
  );
});

test("只有页面签名匹配、生成已停止且文本稳定5秒才完成", () => {
  const base = {
    answerText: "完整可见回答".repeat(30),
    visible: true,
    hasVisibleStopControl: false,
    stableForMs: 5_000,
    pageSignatureMatched: true,
  };

  assert.equal(core.isStableCompleteAnswer(base), true);
  assert.equal(
    core.isStableCompleteAnswer({ ...base, hasVisibleStopControl: true }),
    false,
  );
  assert.equal(
    core.isStableCompleteAnswer({ ...base, stableForMs: 4_999 }),
    false,
  );
  assert.equal(
    core.isStableCompleteAnswer({ ...base, pageSignatureMatched: false }),
    false,
  );
});

test("千问空白新对话占位文本不会被误判为已有输入", () => {
  assert.equal(core.isBlankComposerText("", "qianwen_web"), true);
  assert.equal(
    core.isBlankComposerText("\uFEFF\n向千问提问", "qianwen_web"),
    true,
  );
  assert.equal(core.isBlankComposerText("向千问提问", "doubao_web"), false);
  assert.equal(
    core.isBlankComposerText("广州搬家公司哪家好？", "qianwen_web"),
    false,
  );
});

test("DeepSeek 空白编辑器占位文本不会被误判为已有输入", () => {
  assert.equal(core.isBlankComposerText("", "deepseek_web"), true);
  assert.equal(
    core.isBlankComposerText("给 DeepSeek 发送消息", "deepseek_web"),
    true,
  );
  assert.equal(
    core.isBlankComposerText("Message DeepSeek", "deepseek_web"),
    true,
  );
  assert.equal(
    core.isBlankComposerText("广州搬家公司哪家好？", "deepseek_web"),
    false,
  );
});

test("千问展开侧边栏的新建对话入口可被识别", () => {
  assert.equal(core.isNewConversationLabel("新对话"), true);
  assert.equal(core.isNewConversationLabel("新建对话"), true);
  assert.equal(core.isNewConversationLabel("创建对话"), true);
  assert.equal(core.isNewConversationLabel("开启对话"), true);
  assert.equal(core.isNewConversationLabel("发起对话"), true);
  assert.equal(core.isNewConversationLabel("新建对话\n⌘ K"), true);
  assert.equal(core.isNewConversationLabel("新建新对话"), false);
  assert.equal(core.isNewConversationLabel("新建工作任务"), false);
  assert.equal(core.isNewConversationLabel("New chat"), true);
  assert.equal(core.isNewConversationLabel("New conversation"), true);
});
