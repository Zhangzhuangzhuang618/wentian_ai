import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";
import {
  createConfirmedConsumerObservationRecord,
  type ConsumerObservationRun,
  type ConsumerSurfaceProfileVersion,
  type QuerySetSnapshot,
} from "@wentian/domain";

import {
  buildVisibleSearchKeywordInsights,
  buildVisibleSearchKeywordWorkbook,
  normalizeVisibleSearchKeyword,
} from "../src/visible-search-keyword-insights.ts";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  snapshot: "21111111-1111-4111-8111-111111111111",
  query: "31111111-1111-4111-8111-111111111111",
  surface: "41111111-1111-4111-8111-111111111111",
  run: "51111111-1111-4111-8111-111111111111",
  response1: "61111111-1111-4111-8111-111111111111",
  response2: "71111111-1111-4111-8111-111111111111",
  response3: "81111111-1111-4111-8111-111111111111",
} as const;

test("检索词按样本内规范化去重、跨样本累计且历史记录单独标记", () => {
  const report = buildReport();

  assert.equal(normalizeVisibleSearchKeyword("  AI　搬家  "), "ai 搬家");
  assert.equal(report.summary.confirmed_sample_count, 3);
  assert.equal(report.summary.complete_trace_count, 2);
  assert.equal(report.summary.not_collected_trace_count, 1);
  assert.equal(report.summary.unique_keyword_count, 2);
  assert.deepEqual(
    report.keywords.map((row) => [row.keyword, row.sample_occurrence_count]),
    [
      ["AI　搬家", 2],
      ["=危险关键词", 1],
    ],
  );
});

test("Excel导出固定四张表、保留完整URL并防止公式文本执行", async () => {
  const buffer = await buildVisibleSearchKeywordWorkbook(buildReport());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["关键词汇总", "关键词明细", "参考资料", "口径说明"],
  );
  const keywordSheet = workbook.getWorksheet("关键词汇总")!;
  assert.equal(keywordSheet.getCell("A3").value, "'=危险关键词");
  const referenceSheet = workbook.getWorksheet("参考资料")!;
  const urlCell = referenceSheet.getCell("G2").value as {
    readonly text: string;
    readonly hyperlink: string;
  };
  assert.equal(urlCell.text, "https://www.zgswcn.com/article?id=1");
  assert.equal(urlCell.hyperlink, "https://www.zgswcn.com/article?id=1");
});

function buildReport() {
  return buildVisibleSearchKeywordInsights({
    scopeId: ids.scope,
    filters: {
      runId: null,
      surfaceCode: null,
      industry: null,
      region: null,
      query: null,
    },
    contexts: [
      {
        run: run(),
        snapshot: snapshot(),
        surface: surface(),
        records: [
          record(ids.response1, 1, {
            status: "complete",
            summaryText: "搜索 3 个关键词，参考 17 篇资料",
            declaredKeywordCount: 3,
            keywords: [
              { position: 1, text: "AI　搬家" },
              { position: 2, text: "ai 搬家" },
              { position: 3, text: "=危险关键词" },
            ],
            declaredReferenceCount: 17,
          }),
          record(ids.response2, 2, {
            status: "complete",
            summaryText: "搜索 1 个关键词，参考 17 篇资料",
            declaredKeywordCount: 1,
            keywords: [{ position: 1, text: "ai 搬家" }],
            declaredReferenceCount: 17,
          }),
          record(ids.response3, 3),
        ],
      },
    ],
  });
}

function record(
  id: string,
  sampleIndex: number,
  visibleSearchTrace?: Parameters<
    typeof createConfirmedConsumerObservationRecord
  >[0]["visibleSearchTrace"],
) {
  return createConfirmedConsumerObservationRecord({
    id,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex,
    observationTaskId: `${sampleIndex}1111111-1111-4111-8111-111111111111`,
    captureArtifactId: `${sampleIndex}2111111-1111-4111-8111-111111111111`,
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    answerText: `合成回答${sampleIndex}`,
    visibleCitations: [
      {
        url: "https://www.zgswcn.com/article?id=1",
        label: "中国商务新闻网",
        position: 1,
      },
    ],
    visibleMetadata: {
      productLabel: "豆包网页版",
      surfaceModelLabel: null,
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "广州",
      observedAt: `2026-08-31T10:0${sampleIndex}:00.000Z`,
    },
    ...(visibleSearchTrace ? { visibleSearchTrace } : {}),
    screenshotMediaAssetId: `${sampleIndex}3111111-1111-4111-8111-111111111111`,
    adapterVersion: "doubao-web@1-attended",
    confirmedBy: "91111111-1111-4111-8111-111111111111",
    confirmedAt: `2026-08-31T10:0${sampleIndex}:30.000Z`,
  });
}

function run(): ConsumerObservationRun {
  return {
    id: ids.run,
    scopeId: ids.scope,
    querySetSnapshotId: ids.snapshot,
    surfaceProfileVersionId: ids.surface,
    experimentKind: "natural_answer",
  } as ConsumerObservationRun;
}

function snapshot(): QuerySetSnapshot {
  return {
    id: ids.snapshot,
    scopeId: ids.scope,
    industry: "搬家",
    region: "广州",
    items: [
      {
        id: ids.query,
        queryText: "广州搬家公司推荐",
      },
    ],
  } as unknown as QuerySetSnapshot;
}

function surface(): ConsumerSurfaceProfileVersion {
  return {
    id: ids.surface,
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
  } as ConsumerSurfaceProfileVersion;
}
