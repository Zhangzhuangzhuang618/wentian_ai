import assert from "node:assert/strict";
import test from "node:test";

import {
  standaloneAutomationBatchNextResponseSchema,
  standaloneBrowserCaptureUploadSchema,
  standaloneClaimTaskResponseSchema,
  standaloneCreateAutomationBatchResponseSchema,
  standaloneSourceRankingResponseSchema,
  standaloneConsumerTaskPreviewResponseSchema,
} from "../src/index.ts";

test("领取任务响应包含有长度上限的一次性扩展接入码", () => {
  const parsed = standaloneClaimTaskResponseSchema.parse({
    task: {
      id: "11111111-1111-4111-8111-111111111111",
      scope_id: "21111111-1111-4111-8111-111111111111",
      run_id: "31111111-1111-4111-8111-111111111111",
      query_snapshot_item_id: "41111111-1111-4111-8111-111111111111",
      query_text: "广州搬家公司哪家好？",
      sample_index: 1,
      status: "capturing",
      task_version: 2,
      collection_method: "browser_assisted",
      updated_at: "2026-08-23T12:00:00.000Z",
    },
    surface_code: "doubao_web",
    session_conditions: {
      search_mode: "unknown",
      is_new_conversation: true,
      is_logged_in: true,
      memory_enabled: null,
      personalization_enabled: null,
      locale: "zh-CN",
      region: "CN_MAINLAND",
    },
    capture_token: "signed-token",
    token_expires_at: "2026-08-23T12:10:00.000Z",
    extension_handoff_code: "one-time-handoff",
  });
  assert.equal(parsed.extension_handoff_code, "one-time-handoff");
});

test("整批接入码可描述待处理数量且连续领取返回单题接入信息", () => {
  const batch = standaloneCreateAutomationBatchResponseSchema.parse({
    status: "ready",
    run_id: "31111111-1111-4111-8111-111111111111",
    total_task_count: 3,
    remaining_task_count: 3,
    token_expires_at: "2026-08-23T14:00:00.000Z",
    batch_handoff_code: "reusable-batch-handoff",
  });
  const next = standaloneAutomationBatchNextResponseSchema.parse({
    status: "task_ready",
    run_id: batch.run_id,
    total_task_count: 3,
    completed_task_count: 0,
    remaining_task_count: 2,
    claim: {
      task: {
        id: "11111111-1111-4111-8111-111111111111",
        scope_id: "21111111-1111-4111-8111-111111111111",
        run_id: batch.run_id,
        query_snapshot_item_id: "41111111-1111-4111-8111-111111111111",
        query_text: "广州搬家公司哪家好？",
        sample_index: 1,
        status: "capturing",
        task_version: 2,
        collection_method: "browser_assisted",
        updated_at: "2026-08-23T12:00:00.000Z",
      },
      surface_code: "doubao_web",
      session_conditions: {
        search_mode: "unknown",
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: "CN_MAINLAND",
      },
      capture_token: "signed-token",
      token_expires_at: "2026-08-23T12:10:00.000Z",
      extension_handoff_code: "one-time-handoff",
    },
  });
  assert.equal(next.status, "task_ready");
  assert.equal(next.remaining_task_count, 2);
});

test("整批完成响应不再携带单题接入码", () => {
  const complete = standaloneAutomationBatchNextResponseSchema.parse({
    status: "complete",
    run_id: "31111111-1111-4111-8111-111111111111",
    total_task_count: 3,
    completed_task_count: 3,
    remaining_task_count: 0,
  });
  assert.equal(complete.status, "complete");
  assert.equal("claim" in complete, false);
});

test("独立消费端上传契约要求本地确认且拒绝额外凭证字段", () => {
  const draft = {
    schema_version: "wentian-consumer-capture@0-draft",
    adapter_status: "draft",
    surface_code: "doubao_web",
    collection_method: "browser_assisted",
    confirmation_status: "confirmed_local_export",
    confirmed_at: "2026-08-23T12:00:01.000Z",
    answer_text: "已完成的豆包回答正文。".repeat(10),
    visible_citations: [],
    source_mention_hints: [],
    visible_metadata: {
      product_label: "豆包网页版",
      page_title: "豆包",
      page_origin: "https://www.doubao.com",
      search_mode: "unknown",
      observed_at: "2026-08-23T12:00:00.000Z",
    },
    screenshot: {
      scope: "selected_visible_region",
      media_type: "image/png",
      data_url: "data:image/png;base64,iVBORw0KGgo=",
    },
  };
  assert.equal(
    standaloneBrowserCaptureUploadSchema.parse({
      capture_token: "signed-token",
      task_version: 2,
      draft,
      reviewed_session_metadata: {
        surface_model_label: null,
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: "CN_MAINLAND",
      },
    }).draft.confirmation_status,
    "confirmed_local_export",
  );
  assert.throws(() =>
    standaloneBrowserCaptureUploadSchema.parse({
      capture_token: "signed-token",
      task_version: 2,
      draft,
      reviewed_session_metadata: {
        surface_model_label: null,
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: "CN_MAINLAND",
        cookie: "forbidden",
      },
    }),
  );
});

test("独立排名响应固定披露证据边界", () => {
  const response = standaloneSourceRankingResponseSchema.parse({
    run_id: "11111111-1111-4111-8111-111111111111",
    scope_id: "21111111-1111-4111-8111-111111111111",
    query_snapshot_item_id: "31111111-1111-4111-8111-111111111111",
    experiment_kind: "natural_answer",
    total_formal_source_entries: 7,
    ranking: [
      {
        rank: 1,
        registrable_domain: "example.com",
        display_origin: "https://www.example.com",
        formal_source_entry_count: 7,
      },
    ],
    evidence_warning:
      "仅统计已确认回答中的正式可见信源条目，不代表隐藏抓取频率或平台内部权重。",
  });
  assert.equal(response.ranking[0]!.formal_source_entry_count, 7);
  assert.equal(response.ranking[0]!.display_origin, "https://www.example.com");
});

test("采集预览仅返回可见回答、引用和已保存证据状态", () => {
  const preview = {
    task_id: "11111111-1111-4111-8111-111111111111",
    task_version: 3,
    status: "needs_review",
    answer_text: "这是等待人工确认的豆包可见回答。",
    visible_citations: [
      {
        url: "https://example.com/source",
        label: "示例信源",
        position: 1,
        observed_url: null,
        resolution: null,
      },
    ],
    visible_metadata: {
      product_label: "豆包网页版",
      surface_model_label: null,
      search_mode: "unknown",
      is_new_conversation: true,
      is_logged_in: true,
      locale: "zh-CN",
      region: "CN_MAINLAND",
      observed_at: "2026-08-25T12:00:00.000Z",
    },
    screenshot_evidence_saved: true,
  };
  assert.equal(
    standaloneConsumerTaskPreviewResponseSchema.parse(preview).answer_text,
    preview.answer_text,
  );
  assert.throws(() =>
    standaloneConsumerTaskPreviewResponseSchema.parse({
      ...preview,
      cookie: "forbidden",
    }),
  );
});
