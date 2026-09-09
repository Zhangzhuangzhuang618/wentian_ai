import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_CAPTURE_DRAFT_SCHEMA_VERSION,
  adaptConfirmedBrowserCaptureDraftToSubmission,
  submitConsumerCaptureInputSchema,
} from "../src/index.ts";

const confirmedDraft = {
  schema_version: BROWSER_CAPTURE_DRAFT_SCHEMA_VERSION,
  adapter_status: "draft",
  surface_code: "doubao_web",
  collection_method: "browser_assisted",
  confirmation_status: "confirmed_local_export",
  confirmed_at: "2026-08-22T10:01:00.000Z",
  answer_text: "合成回答。参考来源：买购网。",
  visible_citations: [
    {
      url: "https://cx9966.cn/",
      label: "cx9966.cn",
      position: 1,
      observed_url:
        "https://link.wtturl.cn/?target=https%3A%2F%2Fcx9966.cn&scene=im",
      resolution: "known_redirect_target",
    },
  ],
  visible_search_trace: {
    status: "complete",
    summary_text: "搜索 2 个关键词，参考 6 篇资料",
    declared_keyword_count: 2,
    keywords: [
      { position: 1, text: "广州搬家公司推荐" },
      { position: 2, text: "广州搬家公司避坑" },
    ],
    declared_reference_count: 6,
  },
  source_mention_hints: [
    {
      label: "买购网",
      position: 1,
      evidenceText: "参考来源：买购网。",
      classification: "unverified_text_mention",
    },
  ],
  visible_metadata: {
    product_label: "豆包网页版",
    page_title: "合成回答 - 豆包",
    page_origin: "https://www.doubao.com",
    search_mode: "unknown",
    observed_at: "2026-08-22T10:00:00.000Z",
  },
  screenshot: {
    scope: "selected_visible_region",
    media_type: "image/png",
    data_url: "data:image/png;base64,AA==",
  },
} as const;

const context = {
  task_version: 2,
  screenshot_media_asset_id: "11111111-1111-4111-8111-111111111111",
  adapter_version: "doubao-web@0-draft",
  reviewed_session_metadata: {
    surface_model_label: null,
    is_new_conversation: true,
    is_logged_in: true,
    memory_enabled: null,
    personalization_enabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
  },
} as const;

test("已本地确认草稿可适配为正式观察提交DTO", () => {
  const submission = adaptConfirmedBrowserCaptureDraftToSubmission(
    confirmedDraft,
    context,
  );

  assert.doesNotThrow(() => submitConsumerCaptureInputSchema.parse(submission));
  assert.equal(submission.collection_method, "browser_assisted");
  assert.equal(submission.visible_metadata.search_mode, "unknown");
  assert.equal(
    submission.screenshot_media_asset_id,
    context.screenshot_media_asset_id,
  );
  assert.deepEqual(submission.visible_citations, [
    {
      url: "https://cx9966.cn/",
      label: "cx9966.cn",
      position: 1,
      observed_url:
        "https://link.wtturl.cn/?target=https%3A%2F%2Fcx9966.cn&scene=im",
      resolution: "known_redirect_target",
    },
  ]);
  assert.deepEqual(
    submission.visible_search_trace,
    confirmedDraft.visible_search_trace,
  );
});

test("正式DTO不携带截图Data URL、页面标题或文本信源提示", () => {
  const submission = adaptConfirmedBrowserCaptureDraftToSubmission(
    confirmedDraft,
    context,
  ) as Record<string, unknown>;

  assert.equal("screenshot" in submission, false);
  assert.equal("source_mention_hints" in submission, false);
  assert.equal("page_title" in submission, false);
  assert.equal(JSON.stringify(submission).includes("data:image/png"), false);
  assert.equal(JSON.stringify(submission).includes("合成回答 - 豆包"), false);
});

test("未完成本地确认的草稿不能生成正式提交DTO", () => {
  assert.throws(
    () =>
      adaptConfirmedBrowserCaptureDraftToSubmission(
        {
          ...confirmedDraft,
          confirmation_status: "needs_review",
          confirmed_at: undefined,
        },
        context,
      ),
    /BROWSER_CAPTURE_LOCAL_CONFIRMATION_REQUIRED/,
  );
});

test("人工补充会话元数据仍严格拒绝Cookie等额外字段", () => {
  assert.throws(() =>
    adaptConfirmedBrowserCaptureDraftToSubmission(confirmedDraft, {
      ...context,
      reviewed_session_metadata: {
        ...context.reviewed_session_metadata,
        cookie: "secret",
      },
    }),
  );
});

test("引用包装地址和解析类型必须成对出现", () => {
  const submission = adaptConfirmedBrowserCaptureDraftToSubmission(
    confirmedDraft,
    context,
  );

  assert.equal(
    submitConsumerCaptureInputSchema.safeParse({
      ...submission,
      visible_citations: [
        {
          ...submission.visible_citations[0],
          resolution: undefined,
        },
      ],
    }).success,
    false,
  );
});
