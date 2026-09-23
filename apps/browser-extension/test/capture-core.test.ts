import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { browserCaptureDraftSchema } from "../../../packages/contracts/src/index.ts";

interface CaptureCore {
  readonly selectReferenceUrlCandidate: (
    values: readonly string[],
    pageUrl: string,
  ) => string | null;
  readonly createDraftCapturePayload: (input: {
    readonly userInitiated: boolean;
    readonly pageOrigin: string;
    readonly pageUrl: string;
    readonly pageTitle: string;
    readonly observedAt: string;
    readonly answerText: string;
    readonly visibleLinks: readonly {
      readonly url: string;
      readonly label: string;
      readonly visible?: boolean;
    }[];
    readonly selectedRegionScreenshotDataUrl: string;
    readonly visibleSearchTrace?: {
      readonly status: "complete" | "partial" | "not_present";
      readonly summaryText: string | null;
      readonly declaredKeywordCount: number | null;
      readonly keywords: readonly {
        readonly position: number;
        readonly text: string;
      }[];
      readonly declaredReferenceCount: number | null;
    };
  }) => {
    readonly adapter_status: string;
    readonly surface_code: string;
    readonly confirmation_status: string;
    readonly answer_text: string;
    readonly visible_citations: readonly {
      readonly url: string;
      readonly label: string;
      readonly position: number;
      readonly observed_url?: string;
      readonly resolution?: string;
    }[];
    readonly source_mention_hints: readonly SourceMentionHint[];
    readonly visible_search_trace: {
      readonly status: string;
      readonly summary_text: string | null;
      readonly declared_keyword_count: number | null;
      readonly keywords: readonly {
        readonly position: number;
        readonly text: string;
      }[];
      readonly declared_reference_count: number | null;
    };
    readonly screenshot: { readonly scope: string };
    readonly visible_metadata: {
      readonly product_label: string;
      readonly page_origin: string;
    };
  };
  readonly extractSourceMentionHints: (
    text: string,
  ) => readonly SourceMentionHint[];
  readonly countSourceEvidenceSignals: (text: string) => number;
}

interface SourceMentionHint {
  readonly label: string;
  readonly position: number;
  readonly evidenceText: string;
  readonly classification: string;
  readonly url?: string;
}

const coreSource = await readFile(
  new URL("../capture-core.js", import.meta.url),
  "utf8",
);
const fixture = await readFile(
  new URL("./fixtures/doubao-guangzhou-moving-answer.txt", import.meta.url),
  "utf8",
);
const context = { URL } as Record<string, unknown>;
runInNewContext(coreSource, context);
const core = context.WentianCaptureCore as CaptureCore;

test("来源卡片同时包含站内跳转和外部地址时优先采用外部地址", () => {
  assert.equal(
    core.selectReferenceUrlCandidate(
      ["/chat/38438399923815938", "https://www.zgswcn.com/article/123#section"],
      "https://www.doubao.com/chat/38438399923815938",
    ),
    "https://www.zgswcn.com/article/123",
  );
});

test("来源地址候选只包含当前豆包对话时不生成引用", () => {
  assert.equal(
    core.selectReferenceUrlCandidate(
      ["/chat/38438399923815938"],
      "https://www.doubao.com/chat/38438399923815938",
    ),
    null,
  );
});

test("豆包样本中的来源名称只生成未验证文本提示", () => {
  const hints = core.extractSourceMentionHints(fixture);
  const labels = hints.map((item) => item.label);

  assert.ok(labels.includes("买购网广州搬家企业榜单"));
  assert.ok(labels.includes("xinpont行业评测文章"));
  assert.ok(labels.includes("gree8本地服务资讯"));
  assert.ok(labels.includes("新浪财经2026广州搬家实测文章"));
  assert.ok(labels.includes("cx9966.cn搬家行业实测文章"));
  assert.ok(labels.includes("企业官网行业科普评测页"));
  assert.ok(
    hints.every((item) => item.classification === "unverified_text_mention"),
  );
  assert.ok(hints.every((item) => item.url === undefined));
  assert.equal(hints.length, 11);
});

test("浏览器渲染文本丢失列表序号时仍解析来源汇总", () => {
  const renderedText = fixture
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+[.、]\s+/gm, "");
  const labels = core
    .extractSourceMentionHints(renderedText)
    .map((item) => item.label);

  assert.equal(labels.length, 11);
  assert.ok(labels.includes("买购网"));
  assert.ok(labels.includes("新浪财经"));
  assert.ok(labels.includes("xinpont"));
  assert.ok(labels.includes("gree8"));
  assert.ok(labels.includes("cx9966.cn"));
});

test("来源信号更多的完整回答优先于局部段落", () => {
  const partial = "参考来源：企业官网行业科普评测页。";

  assert.ok(
    core.countSourceEvidenceSignals(fixture) >
      core.countSourceEvidenceSignals(partial),
  );
  assert.equal(
    core.countSourceEvidenceSignals("搜索 4 个关键词，参考 22 篇资料"),
    1,
  );
  assert.equal(core.countSourceEvidenceSignals("6篇来源"), 1);
  assert.equal(core.countSourceEvidenceSignals("参考来源 (6)"), 1);
});

test("只有所选区域内可见的HTTP链接进入引用候选", () => {
  const payload = core.createDraftCapturePayload({
    userInitiated: true,
    pageOrigin: "https://www.doubao.com",
    pageUrl: "https://www.doubao.com/chat",
    pageTitle: "广州搬家公司推荐 - 豆包",
    observedAt: "2026-08-21T10:00:00.000Z",
    answerText: fixture,
    visibleLinks: [
      {
        url: "https://www.maigoo.com/example#source",
        label: "买购网",
      },
      {
        url: "https://www.maigoo.com/example",
        label: "重复链接",
      },
      { url: "javascript:alert(1)", label: "无效链接" },
      {
        url: "https://hidden.example/source",
        label: "隐藏链接",
        visible: false,
      },
    ],
    selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
    visibleSearchTrace: {
      status: "complete",
      summaryText: "搜索 3 个关键词，参考 17 篇资料",
      declaredKeywordCount: 3,
      keywords: [
        { position: 1, text: "广州搬家公司推荐 正规 口碑 2026" },
        { position: 2, text: "广州靠谱搬家公司 收费 避坑要点" },
        { position: 3, text: "广州搬家公司平台和自营区别" },
      ],
      declaredReferenceCount: 17,
    },
  });

  assert.equal(payload.adapter_status, "draft");
  assert.equal(payload.confirmation_status, "needs_review");
  assert.equal(payload.answer_text.length > 0, true);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.visible_citations)), [
    {
      url: "https://www.maigoo.com/example",
      label: "买购网",
      position: 1,
    },
  ]);
  assert.equal(payload.screenshot.scope, "selected_visible_region");
  assert.ok(payload.source_mention_hints.length > 0);
  assert.equal(payload.visible_search_trace.status, "complete");
  assert.equal(payload.visible_search_trace.keywords.length, 3);
  assert.equal(payload.visible_search_trace.declared_reference_count, 17);
  assert.doesNotThrow(() => browserCaptureDraftSchema.parse(payload));
});

test("检索词数量不一致时降级为不完整且未显示时明确记为not_present", () => {
  const base = {
    userInitiated: true,
    pageOrigin: "https://www.doubao.com",
    pageUrl: "https://www.doubao.com/chat/example",
    pageTitle: "豆包",
    observedAt: "2026-08-31T10:00:00.000Z",
    answerText: fixture,
    visibleLinks: [],
    selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
  };
  const partial = core.createDraftCapturePayload({
    ...base,
    visibleSearchTrace: {
      status: "complete",
      summaryText: "搜索 3 个关键词，参考 17 篇资料",
      declaredKeywordCount: 3,
      keywords: [{ position: 1, text: "广州搬家公司推荐" }],
      declaredReferenceCount: 17,
    },
  });
  const absent = core.createDraftCapturePayload(base);

  assert.equal(partial.visible_search_trace.status, "partial");
  assert.equal(absent.visible_search_trace.status, "not_present");
  assert.deepEqual(
    JSON.parse(JSON.stringify(absent.visible_search_trace.keywords)),
    [],
  );
});

test("千问官网回答生成独立Surface草稿并通过严格契约", () => {
  const payload = core.createDraftCapturePayload({
    userInitiated: true,
    pageOrigin: "https://www.qianwen.com",
    pageUrl: "https://www.qianwen.com/",
    pageTitle: "千问-阿里 AI 助手",
    observedAt: "2026-08-26T10:00:00.000Z",
    answerText: fixture,
    visibleLinks: [{ url: "https://example.com/source", label: "示例信源" }],
    selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
  });

  assert.equal(payload.surface_code, "qianwen_web");
  assert.equal(payload.visible_metadata.product_label, "千问网页版");
  assert.equal(payload.visible_metadata.page_origin, "https://www.qianwen.com");
  assert.doesNotThrow(() => browserCaptureDraftSchema.parse(payload));
});

test("DeepSeek 聊天回答生成独立 Surface 草稿并通过严格契约", () => {
  const payload = core.createDraftCapturePayload({
    userInitiated: true,
    pageOrigin: "https://chat.deepseek.com",
    pageUrl: "https://chat.deepseek.com/a/chat/s/example",
    pageTitle: "DeepSeek",
    observedAt: "2026-08-29T10:00:00.000Z",
    answerText: fixture,
    visibleLinks: [
      {
        url: "http://www.gzbm.com/bianmin/9151.html",
        label: "-1",
      },
      {
        url: "http://www.gzbm.com/bianmin/9151.html",
        label: "重复序号",
      },
      {
        url: "https://m.sohu.com/a/example",
        label: "-2",
      },
    ],
    selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
  });

  assert.equal(payload.surface_code, "deepseek_web");
  assert.equal(payload.visible_metadata.product_label, "DeepSeek 网页版");
  assert.equal(
    payload.visible_metadata.page_origin,
    "https://chat.deepseek.com",
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(payload.visible_citations.map((citation) => citation.url)),
    ),
    ["http://www.gzbm.com/bianmin/9151.html", "https://m.sohu.com/a/example"],
  );
  assert.doesNotThrow(() => browserCaptureDraftSchema.parse(payload));
});

test("DeepSeek 登录页不属于可采集聊天路径", () => {
  assert.throws(
    () =>
      core.createDraftCapturePayload({
        userInitiated: true,
        pageOrigin: "https://chat.deepseek.com",
        pageUrl: "https://chat.deepseek.com/sign_in",
        pageTitle: "DeepSeek",
        observedAt: "2026-08-29T10:00:00.000Z",
        answerText: fixture,
        visibleLinks: [],
        selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
      }),
    /CAPTURE_PAGE_NOT_ALLOWED/,
  );
});

test("非用户触发、错误来源或无截图时失败关闭", () => {
  const baseInput = {
    userInitiated: true,
    pageOrigin: "https://www.doubao.com",
    pageUrl: "https://www.doubao.com/chat/example",
    pageTitle: "豆包",
    observedAt: "2026-08-21T10:00:00.000Z",
    answerText: fixture,
    visibleLinks: [],
    selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
  };

  assert.throws(
    () =>
      core.createDraftCapturePayload({ ...baseInput, userInitiated: false }),
    /CAPTURE_NOT_USER_INITIATED/,
  );
  assert.throws(
    () =>
      core.createDraftCapturePayload({
        ...baseInput,
        pageOrigin: "https://example.com",
      }),
    /CAPTURE_ORIGIN_MISMATCH/,
  );
  assert.throws(
    () =>
      core.createDraftCapturePayload({
        ...baseInput,
        pageUrl: "https://www.doubao.com/legal/terms",
      }),
    /CAPTURE_PAGE_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      core.createDraftCapturePayload({
        ...baseInput,
        selectedRegionScreenshotDataUrl: "",
      }),
    /CAPTURE_SCREENSHOT_REQUIRED/,
  );
});

test("豆包已知跳转链接保留页面地址并解析真实目标", () => {
  const payload = core.createDraftCapturePayload({
    userInitiated: true,
    pageOrigin: "https://www.doubao.com",
    pageUrl: "https://www.doubao.com/chat/example",
    pageTitle: "豆包",
    observedAt: "2026-08-22T10:00:00.000Z",
    answerText: fixture,
    visibleLinks: [
      {
        url: "https://link.wtturl.cn/?target=https%3A%2F%2Fcx9966.cn&scene=im",
        label: "cx9966.cn",
      },
    ],
    selectedRegionScreenshotDataUrl: "data:image/png;base64,AA==",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(payload.visible_citations)), [
    {
      url: "https://cx9966.cn/",
      label: "cx9966.cn",
      position: 1,
      observed_url:
        "https://link.wtturl.cn/?target=https%3A%2F%2Fcx9966.cn&scene=im",
      resolution: "known_redirect_target",
    },
  ]);
});
