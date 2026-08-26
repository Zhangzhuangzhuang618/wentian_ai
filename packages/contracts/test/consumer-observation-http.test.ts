import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSUMER_OBSERVATION_API_ROUTES,
  CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
  claimConsumerObservationTaskInputSchema,
  claimConsumerObservationTaskResponseSchema,
  confirmConsumerObservationHttpInputSchema,
  confirmConsumerObservationResponseSchema,
  consumerCaptureAuthorizationSchema,
  consumerObservationIdempotencySchema,
  createConsumerObservationResponseSchema,
  rejectConsumerObservationHttpInputSchema,
  rejectConsumerObservationResponseSchema,
  submitConsumerCaptureMultipartMetadataSchema,
  submitConsumerCaptureResponseSchema,
} from "../src/index.ts";

const ids = {
  task: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  query: "31111111-1111-4111-8111-111111111111",
  artifact: "41111111-1111-4111-8111-111111111111",
  response: "51111111-1111-4111-8111-111111111111",
  run: "61111111-1111-4111-8111-111111111111",
} as const;

test("正式路由固定使用批准基线中的消费端观察路径", () => {
  assert.deepEqual(CONSUMER_OBSERVATION_API_ROUTES, {
    create: "/ai-visibility/consumer-observations",
    claim: "/ai-visibility/consumer-observations/tasks/{id}/claim",
    captures: "/ai-visibility/consumer-observations/tasks/{id}/captures",
    confirm: "/ai-visibility/consumer-observations/tasks/{id}/confirm",
    reject: "/ai-visibility/consumer-observations/tasks/{id}/reject",
  });
  assert.equal(Object.isFrozen(CONSUMER_OBSERVATION_API_ROUTES), true);
});

test("领取契约返回标准问题、采集条件和短期token", () => {
  assert.deepEqual(claimConsumerObservationTaskInputSchema.parse({}), {});
  assert.throws(() =>
    claimConsumerObservationTaskInputSchema.parse({ task_version: 1 }),
  );

  const response = {
    contract_version: CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
    task_id: ids.task,
    task_version: 2,
    status: "capturing",
    scope_id: ids.scope,
    query_snapshot_item_id: ids.query,
    query_text: "广州搬家公司哪家好？",
    surface_code: "doubao_web",
    collection_method: "browser_assisted",
    session_conditions: {
      search_mode: "unknown",
      is_new_conversation: true,
      is_logged_in: true,
      memory_enabled: null,
      personalization_enabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    capture_token: "short-lived-token",
    token_expires_at: "2026-08-22T10:10:00.000Z",
  } as const;

  assert.deepEqual(
    claimConsumerObservationTaskResponseSchema.parse(response),
    response,
  );
});

test("创建响应只固化已定义的web_observed运行身份与逐题任务", () => {
  const response = {
    contract_version: CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
    run: {
      id: ids.run,
      scope_id: ids.scope,
      query_set_snapshot_id: ids.query,
      retrieval_mode: "web_observed",
      collection_method: "browser_assisted",
      experiment_kind: "natural_answer",
      requested_sample_count: 1,
    },
    tasks: [
      {
        id: ids.task,
        task_version: 1,
        status: "waiting_user",
        query_snapshot_item_id: ids.query,
        sample_index: 1,
      },
    ],
  } as const;

  assert.deepEqual(
    createConsumerObservationResponseSchema.parse(response),
    response,
  );
  assert.equal("status" in response.run, false);
});

test("Capture Token和幂等键作为独立传输凭据严格校验", () => {
  assert.deepEqual(
    consumerCaptureAuthorizationSchema.parse({ capture_token: "token" }),
    { capture_token: "token" },
  );
  assert.deepEqual(
    consumerObservationIdempotencySchema.parse({
      idempotency_key: "confirm-1",
    }),
    { idempotency_key: "confirm-1" },
  );
  assert.throws(() =>
    consumerCaptureAuthorizationSchema.parse({
      capture_token: "token",
      cookie: "secret",
    }),
  );
  assert.throws(() =>
    consumerObservationIdempotencySchema.parse({
      idempotency_key: "x".repeat(201),
    }),
  );
});

test("提交、确认和拒绝响应明确分离确认状态与证据等级", () => {
  const identity = {
    contract_version: CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION,
    task_id: ids.task,
    task_version: 3,
  } as const;
  const submitted = submitConsumerCaptureResponseSchema.parse({
    ...identity,
    status: "needs_review",
    verification_status: "needs_review",
    evidence_grade: null,
    capture_artifact_id: ids.artifact,
  });
  const confirmed = confirmConsumerObservationResponseSchema.parse({
    ...identity,
    task_version: 4,
    status: "confirmed",
    verification_status: "confirmed",
    evidence_grade: "web_confirmed_capture",
    confirmed_response_id: ids.response,
  });
  const rejected = rejectConsumerObservationResponseSchema.parse({
    ...identity,
    task_version: 4,
    status: "rejected",
    verification_status: "rejected",
    evidence_grade: null,
  });

  assert.equal(submitted.evidence_grade, null);
  assert.equal(confirmed.evidence_grade, "web_confirmed_capture");
  assert.equal(rejected.evidence_grade, null);
});

test("HTTP multipart元数据与服务端存储引用保持分离", () => {
  const metadata = {
    task_version: 2,
    answer_text: "合成回答",
    visible_citations: [],
    visible_metadata: {
      product_label: "豆包",
      surface_model_label: null,
      search_mode: "unknown",
      is_new_conversation: true,
      is_logged_in: true,
      memory_enabled: null,
      personalization_enabled: null,
      locale: "zh-CN",
      region: null,
      observed_at: "2026-08-22T10:00:00.000Z",
    },
    adapter_version: "doubao-web@0-draft",
    collection_method: "browser_assisted",
  } as const;

  assert.deepEqual(
    submitConsumerCaptureMultipartMetadataSchema.parse(metadata),
    metadata,
  );
  assert.throws(() =>
    submitConsumerCaptureMultipartMetadataSchema.parse({
      ...metadata,
      screenshot_media_asset_id: ids.artifact,
    }),
  );
  assert.deepEqual(
    confirmConsumerObservationHttpInputSchema.parse({
      task_version: 3,
    }),
    { task_version: 3 },
  );
  assert.deepEqual(
    rejectConsumerObservationHttpInputSchema.parse({
      task_version: 3,
      rejection_reason: "合成拒绝原因",
    }),
    {
      task_version: 3,
      rejection_reason: "合成拒绝原因",
    },
  );
});
