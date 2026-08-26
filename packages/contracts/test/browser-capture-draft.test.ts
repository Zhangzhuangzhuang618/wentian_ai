import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_CAPTURE_DRAFT_SCHEMA_VERSION,
  browserCaptureDraftSchema,
} from "../src/index.ts";

const previewCapture = {
  schema_version: BROWSER_CAPTURE_DRAFT_SCHEMA_VERSION,
  adapter_status: "draft",
  surface_code: "doubao_web",
  collection_method: "browser_assisted",
  confirmation_status: "needs_review",
  answer_text: "测试回答。参考来源：买购网。",
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
    page_title: "测试回答 - 豆包",
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

test("接受扩展生成的待复核草稿", () => {
  assert.deepEqual(
    browserCaptureDraftSchema.parse(previewCapture),
    previewCapture,
  );
});

test("接受带确认时间的本地确认导出", () => {
  const confirmedCapture = {
    ...previewCapture,
    confirmation_status: "confirmed_local_export",
    confirmed_at: "2026-08-22T10:01:00.000Z",
  } as const;

  assert.equal(
    browserCaptureDraftSchema.parse(confirmedCapture).confirmation_status,
    "confirmed_local_export",
  );
});

test("确认状态与确认时间必须一致", () => {
  assert.throws(
    () =>
      browserCaptureDraftSchema.parse({
        ...previewCapture,
        confirmation_status: "confirmed_local_export",
      }),
    /BROWSER_CAPTURE_CONFIRMATION_TIME_REQUIRED/,
  );
  assert.throws(
    () =>
      browserCaptureDraftSchema.parse({
        ...previewCapture,
        confirmed_at: "2026-08-22T10:01:00.000Z",
      }),
    /BROWSER_CAPTURE_PREVIEW_CONFIRMATION_TIME_FORBIDDEN/,
  );
});

test("已知跳转解析必须同时保留豆包页面包装地址", () => {
  const citation = previewCapture.visible_citations[0];

  assert.throws(
    () =>
      browserCaptureDraftSchema.parse({
        ...previewCapture,
        visible_citations: [{ ...citation, observed_url: undefined }],
      }),
    /BROWSER_CAPTURE_REDIRECT_OBSERVED_URL_REQUIRED/,
  );
  assert.throws(
    () =>
      browserCaptureDraftSchema.parse({
        ...previewCapture,
        visible_citations: [
          {
            ...citation,
            observed_url: "https://example.com/redirect",
          },
        ],
      }),
    /BROWSER_CAPTURE_UNKNOWN_REDIRECT_WRAPPER/,
  );
});

test("拒绝非HTTP引用、非PNG截图和额外敏感字段", () => {
  assert.throws(() =>
    browserCaptureDraftSchema.parse({
      ...previewCapture,
      visible_citations: [
        {
          url: "javascript:alert(1)",
          label: "无效链接",
          position: 1,
        },
      ],
    }),
  );
  assert.throws(() =>
    browserCaptureDraftSchema.parse({
      ...previewCapture,
      screenshot: {
        ...previewCapture.screenshot,
        data_url: "data:image/jpeg;base64,AA==",
      },
    }),
  );
  assert.throws(() =>
    browserCaptureDraftSchema.parse({
      ...previewCapture,
      authorization: "secret",
    }),
  );
  assert.throws(() =>
    browserCaptureDraftSchema.parse({
      ...previewCapture,
      visible_metadata: {
        ...previewCapture.visible_metadata,
        cookie: "secret",
      },
    }),
  );
});

test("无效页面包装地址返回契约错误而不是异常逃逸", () => {
  const result = browserCaptureDraftSchema.safeParse({
    ...previewCapture,
    visible_citations: [
      {
        ...previewCapture.visible_citations[0],
        observed_url: "not-a-url",
      },
    ],
  });

  assert.equal(result.success, false);
});
