import ExcelJS from "exceljs";

import type {
  ConfirmedConsumerObservationRecord,
  ConsumerObservationRun,
  ConsumerSurfaceProfileVersion,
  QuerySetSnapshot,
} from "@wentian/application";
import {
  VISIBLE_SEARCH_KEYWORD_INSIGHTS_SCHEMA_VERSION,
  visibleSearchKeywordInsightsResponseSchema,
  type VisibleSearchKeywordInsightsResponse,
} from "@wentian/contracts";

export interface VisibleSearchKeywordRunContext {
  readonly run: ConsumerObservationRun;
  readonly snapshot: QuerySetSnapshot;
  readonly surface: ConsumerSurfaceProfileVersion;
  readonly records: readonly ConfirmedConsumerObservationRecord[];
}

export interface VisibleSearchKeywordInsightFilters {
  readonly runId: string | null;
  readonly surfaceCode: string | null;
  readonly industry: string | null;
  readonly region: string | null;
  readonly query: string | null;
}

export function normalizeVisibleSearchKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

export function buildVisibleSearchKeywordInsights(input: {
  readonly scopeId: string;
  readonly contexts: readonly VisibleSearchKeywordRunContext[];
  readonly filters: VisibleSearchKeywordInsightFilters;
}): VisibleSearchKeywordInsightsResponse {
  const queryNeedle = input.filters.query
    ? normalizeVisibleSearchKeyword(input.filters.query)
    : null;
  const samples: VisibleSearchKeywordInsightsResponse["samples"] = [];

  for (const context of input.contexts) {
    if (
      context.run.scopeId !== input.scopeId ||
      context.snapshot.scopeId !== input.scopeId ||
      context.run.querySetSnapshotId !== context.snapshot.id ||
      context.run.surfaceProfileVersionId !== context.surface.id ||
      context.run.experimentKind !== "natural_answer"
    ) {
      continue;
    }
    if (
      (input.filters.runId && context.run.id !== input.filters.runId) ||
      (input.filters.surfaceCode &&
        context.surface.surfaceCode !== input.filters.surfaceCode) ||
      (input.filters.industry &&
        context.snapshot.industry !== input.filters.industry) ||
      (input.filters.region && context.snapshot.region !== input.filters.region)
    ) {
      continue;
    }
    const itemsById = new Map(
      context.snapshot.items.map((item) => [item.id, item]),
    );
    for (const record of context.records) {
      const item = itemsById.get(record.querySnapshotItemId);
      if (!item || record.runId !== context.run.id) {
        continue;
      }
      const trace = record.visibleSearchTrace;
      const keywords = (trace?.keywords ?? []).map((keyword) => ({
        position: keyword.position,
        text: keyword.text,
        normalized_text: normalizeVisibleSearchKeyword(keyword.text),
      }));
      if (
        queryNeedle &&
        !normalizeVisibleSearchKeyword(item.queryText).includes(queryNeedle) &&
        !keywords.some(
          (keyword) =>
            keyword.normalized_text.includes(queryNeedle) ||
            queryNeedle.includes(keyword.normalized_text),
        )
      ) {
        continue;
      }
      samples.push({
        response_id: record.id,
        run_id: record.runId,
        query_set_snapshot_id: context.snapshot.id,
        query_snapshot_item_id: record.querySnapshotItemId,
        query_text: item.queryText,
        sample_index: record.sampleIndex,
        surface_code: context.surface.surfaceCode as
          "doubao_web" | "qianwen_web" | "deepseek_web",
        product_label: record.visibleMetadata.productLabel,
        industry: context.snapshot.industry ?? null,
        region: context.snapshot.region ?? record.visibleMetadata.region,
        observed_at: record.visibleMetadata.observedAt,
        confirmed_at: record.confirmedAt,
        trace_status: trace?.status ?? "not_collected",
        summary_text: trace?.summaryText ?? null,
        declared_keyword_count: trace?.declaredKeywordCount ?? null,
        keywords,
        declared_reference_count: trace?.declaredReferenceCount ?? null,
        captured_reference_count: record.visibleCitations.length,
        references: record.visibleCitations.map((citation) => ({
          position: citation.position,
          title: citation.label,
          url: citation.url,
        })),
        eligible_for_default_export: trace?.status === "complete",
      });
    }
  }

  samples.sort(
    (left, right) =>
      Date.parse(right.observed_at) - Date.parse(left.observed_at) ||
      left.run_id.localeCompare(right.run_id) ||
      left.query_snapshot_item_id.localeCompare(right.query_snapshot_item_id) ||
      left.sample_index - right.sample_index,
  );

  const aggregates = new Map<
    string,
    {
      keyword: string;
      normalizedKeyword: string;
      sampleOccurrenceCount: number;
      questionIds: Set<string>;
      runIds: Set<string>;
      platforms: Set<"doubao_web" | "qianwen_web" | "deepseek_web">;
      industries: Set<string>;
      regions: Set<string>;
      firstSeenAt: string;
      lastSeenAt: string;
    }
  >();

  for (const sample of samples) {
    if (!sample.eligible_for_default_export) continue;
    const seenInSample = new Set<string>();
    for (const keyword of sample.keywords) {
      if (seenInSample.has(keyword.normalized_text)) continue;
      seenInSample.add(keyword.normalized_text);
      const aggregate = aggregates.get(keyword.normalized_text) ?? {
        keyword: keyword.text,
        normalizedKeyword: keyword.normalized_text,
        sampleOccurrenceCount: 0,
        questionIds: new Set<string>(),
        runIds: new Set<string>(),
        platforms: new Set<"doubao_web" | "qianwen_web" | "deepseek_web">(),
        industries: new Set<string>(),
        regions: new Set<string>(),
        firstSeenAt: sample.observed_at,
        lastSeenAt: sample.observed_at,
      };
      aggregate.sampleOccurrenceCount += 1;
      aggregate.questionIds.add(sample.query_snapshot_item_id);
      aggregate.runIds.add(sample.run_id);
      aggregate.platforms.add(sample.surface_code);
      if (sample.industry) aggregate.industries.add(sample.industry);
      if (sample.region) aggregate.regions.add(sample.region);
      if (Date.parse(sample.observed_at) < Date.parse(aggregate.firstSeenAt)) {
        aggregate.firstSeenAt = sample.observed_at;
        aggregate.keyword = keyword.text;
      }
      if (Date.parse(sample.observed_at) > Date.parse(aggregate.lastSeenAt)) {
        aggregate.lastSeenAt = sample.observed_at;
      }
      aggregates.set(keyword.normalized_text, aggregate);
    }
  }

  const keywords = [...aggregates.values()]
    .map((aggregate) => ({
      keyword: aggregate.keyword,
      normalized_keyword: aggregate.normalizedKeyword,
      sample_occurrence_count: aggregate.sampleOccurrenceCount,
      question_count: aggregate.questionIds.size,
      run_count: aggregate.runIds.size,
      platforms: [...aggregate.platforms].sort(),
      industries: [...aggregate.industries].sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
      regions: [...aggregate.regions].sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
      first_seen_at: aggregate.firstSeenAt,
      last_seen_at: aggregate.lastSeenAt,
    }))
    .sort(
      (left, right) =>
        right.sample_occurrence_count - left.sample_occurrence_count ||
        left.keyword.localeCompare(right.keyword, "zh-CN"),
    );

  return visibleSearchKeywordInsightsResponseSchema.parse({
    schema_version: VISIBLE_SEARCH_KEYWORD_INSIGHTS_SCHEMA_VERSION,
    scope_id: input.scopeId,
    filters: {
      run_id: input.filters.runId,
      surface_code: input.filters.surfaceCode,
      industry: input.filters.industry,
      region: input.filters.region,
      query: input.filters.query,
    },
    summary: {
      confirmed_sample_count: samples.length,
      complete_trace_count: samples.filter(
        (sample) => sample.trace_status === "complete",
      ).length,
      partial_trace_count: samples.filter(
        (sample) => sample.trace_status === "partial",
      ).length,
      not_present_trace_count: samples.filter(
        (sample) => sample.trace_status === "not_present",
      ).length,
      not_collected_trace_count: samples.filter(
        (sample) => sample.trace_status === "not_collected",
      ).length,
      keyword_occurrence_count: keywords.reduce(
        (total, keyword) => total + keyword.sample_occurrence_count,
        0,
      ),
      unique_keyword_count: keywords.length,
    },
    keywords,
    samples,
    methodology: {
      aggregation_version: "visible-search-keyword-count@1",
      default_export_rule: "confirmed_complete_trace_only",
      within_sample_deduplication: "normalized_exact_phrase",
      normalization: "unicode_nfkc_trim_space_casefold",
      evidence_warning:
        "仅记录消费端页面明确显示的检索词与参考资料，不代表平台内部真实抓取词、抓取频率、隐藏候选或权重。",
    },
  });
}

export async function buildVisibleSearchKeywordWorkbook(
  report: VisibleSearchKeywordInsightsResponse,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "问天 AI 信源探测系统";
  workbook.created = new Date();
  workbook.modified = new Date();

  const keywordSheet = workbook.addWorksheet("关键词汇总", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  keywordSheet.columns = [
    { header: "页面可见检索词", key: "keyword", width: 48 },
    { header: "采样出现次数", key: "occurrences", width: 14 },
    { header: "覆盖问题数", key: "questions", width: 12 },
    { header: "覆盖运行数", key: "runs", width: 12 },
    { header: "平台", key: "platforms", width: 22 },
    { header: "行业", key: "industries", width: 24 },
    { header: "地区", key: "regions", width: 24 },
    { header: "首次观察", key: "first", width: 24 },
    { header: "最近观察", key: "last", width: 24 },
  ];
  for (const row of report.keywords) {
    keywordSheet.addRow({
      keyword: safeSpreadsheetText(row.keyword),
      occurrences: row.sample_occurrence_count,
      questions: row.question_count,
      runs: row.run_count,
      platforms: row.platforms.join("、"),
      industries: row.industries.map(safeSpreadsheetText).join("、"),
      regions: row.regions.map(safeSpreadsheetText).join("、"),
      first: row.first_seen_at,
      last: row.last_seen_at,
    });
  }

  const detailSheet = workbook.addWorksheet("关键词明细", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detailSheet.columns = [
    { header: "原问题", key: "query", width: 44 },
    { header: "页面可见检索词", key: "keyword", width: 48 },
    { header: "词序", key: "position", width: 8 },
    { header: "平台", key: "platform", width: 16 },
    { header: "行业", key: "industry", width: 18 },
    { header: "地区", key: "region", width: 18 },
    { header: "运行ID", key: "run", width: 38 },
    { header: "采样序号", key: "sample", width: 10 },
    { header: "观察时间", key: "observed", width: 24 },
  ];
  for (const sample of report.samples.filter(
    (item) => item.eligible_for_default_export,
  )) {
    const seen = new Set<string>();
    for (const keyword of sample.keywords) {
      if (seen.has(keyword.normalized_text)) continue;
      seen.add(keyword.normalized_text);
      detailSheet.addRow({
        query: safeSpreadsheetText(sample.query_text),
        keyword: safeSpreadsheetText(keyword.text),
        position: keyword.position,
        platform: sample.product_label,
        industry: safeSpreadsheetText(sample.industry ?? ""),
        region: safeSpreadsheetText(sample.region ?? ""),
        run: sample.run_id,
        sample: sample.sample_index,
        observed: sample.observed_at,
      });
    }
  }

  const referenceSheet = workbook.addWorksheet("参考资料", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  referenceSheet.columns = [
    { header: "原问题", key: "query", width: 44 },
    { header: "检索词", key: "keywords", width: 54 },
    { header: "声明资料数", key: "declared", width: 12 },
    { header: "已采集链接数", key: "captured", width: 14 },
    { header: "资料序号", key: "position", width: 10 },
    { header: "资料标题", key: "title", width: 48 },
    { header: "完整URL", key: "url", width: 72 },
    { header: "平台", key: "platform", width: 16 },
    { header: "运行ID", key: "run", width: 38 },
    { header: "采样序号", key: "sample", width: 10 },
    { header: "观察时间", key: "observed", width: 24 },
  ];
  for (const sample of report.samples.filter(
    (item) => item.eligible_for_default_export,
  )) {
    for (const reference of sample.references) {
      const row = referenceSheet.addRow({
        query: safeSpreadsheetText(sample.query_text),
        keywords: sample.keywords
          .map((keyword) => safeSpreadsheetText(keyword.text))
          .join("｜"),
        declared: sample.declared_reference_count,
        captured: sample.captured_reference_count,
        position: reference.position,
        title: safeSpreadsheetText(reference.title ?? ""),
        url: reference.url,
        platform: sample.product_label,
        run: sample.run_id,
        sample: sample.sample_index,
        observed: sample.observed_at,
      });
      row.getCell("url").value = {
        text: reference.url,
        hyperlink: reference.url,
        tooltip: reference.url,
      };
      row.getCell("url").font = {
        color: { argb: "FF3658D6" },
        underline: true,
      };
    }
  }

  const methodSheet = workbook.addWorksheet("口径说明");
  methodSheet.columns = [
    { header: "项目", key: "item", width: 28 },
    { header: "说明", key: "description", width: 100 },
  ];
  const methodRows = [
    ["证据边界", report.methodology.evidence_warning],
    ["默认导出范围", "仅包含已确认且页面可见检索轨迹为完整的采样。"],
    ["样本内去重", "同一采样内，规范化后完全相同的检索词只累计一次。"],
    ["跨样本累计", "同一检索词在不同采样中出现时逐次累计。"],
    [
      "规范化",
      "Unicode NFKC、去除首尾空白、连续空白合并、大小写归一化；不合并同义词。",
    ],
    [
      "历史数据",
      "历史记录没有该字段时标记为“当时未采集”，不会从回答或引用反推。",
    ],
    ["筛选条件", JSON.stringify(report.filters)],
    ["生成时间", new Date().toISOString()],
  ];
  for (const [item, description] of methodRows) {
    methodSheet.addRow({
      item: safeSpreadsheetText(item),
      description: safeSpreadsheetText(description),
    });
  }

  for (const sheet of workbook.worksheets) {
    styleWorksheet(sheet);
  }
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

function safeSpreadsheetText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function styleWorksheet(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4F46E5" },
  };
  header.alignment = { vertical: "middle", horizontal: "left" };
  header.height = 24;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(sheet.rowCount, 1), column: sheet.columnCount },
  };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "top", wrapText: true };
    }
  });
}
