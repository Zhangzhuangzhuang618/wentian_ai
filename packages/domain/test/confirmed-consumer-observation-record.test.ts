import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertConfirmedConsumerObservationRecordIntegrity,
  createConfirmedConsumerObservationRecord,
} from "../src/index.ts";

test("创建不可变已确认证据并按原文计算回答哈希", () => {
  const input = recordInput();
  const record = createConfirmedConsumerObservationRecord(input);

  assert.equal(record.verificationStatus, "confirmed");
  assert.equal(record.evidenceGrade, "web_confirmed_capture");
  assert.equal(record.answerText, input.answerText);
  assert.equal(record.unsupportedInternalClaim, false);
  assert.equal(
    record.unsupportedInternalClaimAssessmentVersion,
    "unsupported-internal-claim@1",
  );
  assert.equal(
    record.answerHash,
    createHash("sha256").update(input.answerText, "utf8").digest("hex"),
  );
  assert.deepEqual(
    record.visibleCitations.map((citation) => citation.position),
    [1, 2],
  );
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.visibleMetadata), true);
  assert.equal(Object.isFrozen(record.visibleCitations), true);
});

test("人工录入证据等级由采集方式派生", () => {
  const record = createConfirmedConsumerObservationRecord({
    ...recordInput(),
    collectionMethod: "manual_import",
  });

  assert.equal(record.evidenceGrade, "web_confirmed_manual");
});

test("页面可见检索轨迹保持原词序且完整数量必须一致", () => {
  const record = createConfirmedConsumerObservationRecord({
    ...recordInput(),
    visibleSearchTrace: {
      status: "complete",
      summaryText: "搜索 2 个关键词，参考 6 篇资料",
      declaredKeywordCount: 2,
      keywords: [
        { position: 1, text: "广州搬家公司推荐" },
        { position: 2, text: "广州搬家公司避坑" },
      ],
      declaredReferenceCount: 6,
    },
  });

  assert.deepEqual(
    record.visibleSearchTrace?.keywords.map((keyword) => keyword.text),
    ["广州搬家公司推荐", "广州搬家公司避坑"],
  );
  assert.throws(
    () =>
      createConfirmedConsumerObservationRecord({
        ...recordInput(),
        visibleSearchTrace: {
          status: "complete",
          summaryText: "搜索 2 个关键词，参考 6 篇资料",
          declaredKeywordCount: 2,
          keywords: [{ position: 1, text: "广州搬家公司推荐" }],
          declaredReferenceCount: 6,
        },
      }),
    /VISIBLE_SEARCH_COMPLETE_KEYWORD_COUNT_MISMATCH/,
  );
});

test("输出白名单不包含截图正文、Cookie或账号字段", () => {
  const record = createConfirmedConsumerObservationRecord({
    ...recordInput(),
    screenshotDataUrl: "data:image/png;base64,secret",
    cookie: "secret",
    accountEmail: "person@example.com",
  } as Parameters<typeof createConfirmedConsumerObservationRecord>[0]);
  const serialized = JSON.stringify(record);

  assert.equal(serialized.includes("data:image/png"), false);
  assert.equal(serialized.includes("cookie"), false);
  assert.equal(serialized.includes("person@example.com"), false);
  assert.equal(record.screenshotMediaAssetId, "screenshot-1");
});

test("可见引用URL、位置和跳转解析必须完整有效", () => {
  const input = recordInput();

  for (const url of [
    "ftp://example.com/file",
    "https://user:secret@example.com/",
    "not-a-url",
  ]) {
    assert.throws(
      () =>
        createConfirmedConsumerObservationRecord({
          ...input,
          visibleCitations: [{ url, position: 1 }],
        }),
      /INVALID_VISIBLE_CITATION_URL/,
    );
  }
  assert.throws(
    () =>
      createConfirmedConsumerObservationRecord({
        ...input,
        visibleCitations: [
          { url: "https://example.com/a", position: 1 },
          { url: "https://example.org/b", position: 1 },
        ],
      }),
    /DUPLICATE_VISIBLE_CITATION_POSITION/,
  );
  assert.throws(
    () =>
      createConfirmedConsumerObservationRecord({
        ...input,
        visibleCitations: [{ url: "https://example.com/a", position: 2 }],
      }),
    /VISIBLE_CITATION_FIRST_POSITION_REQUIRED/,
  );
  assert.throws(
    () =>
      createConfirmedConsumerObservationRecord({
        ...input,
        visibleCitations: [
          {
            url: "https://example.com/a",
            observedUrl: "https://redirect.example/a",
            position: 1,
          },
        ],
      }),
    /VISIBLE_CITATION_RESOLUTION_PAIR_REQUIRED/,
  );
  assert.throws(
    () =>
      createConfirmedConsumerObservationRecord({
        ...input,
        visibleCitations: [
          {
            url: "https://example.com/a",
            observedUrl: "https://redirect.example/a",
            resolution: "forged" as "known_redirect_target",
            position: 1,
          },
        ],
      }),
    /INVALID_VISIBLE_CITATION_RESOLUTION/,
  );
});

test("确认时间不能早于页面观察时间", () => {
  assert.throws(
    () =>
      createConfirmedConsumerObservationRecord({
        ...recordInput(),
        confirmedAt: "2026-08-22T09:59:59.000Z",
      }),
    /CONFIRMATION_BEFORE_OBSERVATION/,
  );
});

test("回答哈希或额外字段被篡改时记录完整性校验失败", () => {
  const record = createConfirmedConsumerObservationRecord(recordInput());
  assert.throws(
    () =>
      assertConfirmedConsumerObservationRecordIntegrity({
        ...record,
        unsupportedInternalClaim: true,
      }),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_INTEGRITY_MISMATCH/,
  );
  assert.throws(
    () =>
      assertConfirmedConsumerObservationRecordIntegrity({
        ...record,
        answerHash: "0".repeat(64),
      }),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_INTEGRITY_MISMATCH/,
  );
  assert.throws(
    () =>
      assertConfirmedConsumerObservationRecordIntegrity({
        ...record,
        cookie: "forbidden",
      } as typeof record),
    /CONFIRMED_CONSUMER_OBSERVATION_RECORD_INTEGRITY_MISMATCH/,
  );
});

test("不可核验内部抓取频率声明保留原文并生成标记", () => {
  const input = {
    ...recordInput(),
    answerText: "我的抓取频率最高的前10个域名如下：example.com。",
  };
  const record = createConfirmedConsumerObservationRecord(input);

  assert.equal(record.answerText, input.answerText);
  assert.equal(record.unsupportedInternalClaim, true);
  assert.equal(
    record.unsupportedInternalClaimAssessmentVersion,
    "unsupported-internal-claim@1",
  );
});

function recordInput() {
  return {
    id: "response-1",
    scopeId: "scope-1",
    runId: "run-1",
    querySnapshotItemId: "query-1",
    sampleIndex: 1,
    observationTaskId: "task-1",
    captureArtifactId: "artifact-1",
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted" as const,
    answerText: "合成可见回答。",
    visibleCitations: [
      { url: "https://example.org/b", label: "B", position: 2 },
      {
        url: "https://example.com/a",
        label: "A",
        position: 1,
        observedUrl: "https://redirect.example/a",
        resolution: "known_redirect_target" as const,
      },
    ],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      searchMode: "unknown" as const,
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
      observedAt: "2026-08-22T10:00:00.000Z",
    },
    screenshotMediaAssetId: "screenshot-1",
    sanitizedDomObjectKey: null,
    adapterVersion: "doubao-web@1",
    confirmedBy: "user-1",
    confirmedAt: "2026-08-22T10:03:00.000Z",
  };
}
