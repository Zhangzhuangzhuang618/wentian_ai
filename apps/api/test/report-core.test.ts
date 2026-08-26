import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

interface ReportCore {
  readonly buildNaturalReport: (input: unknown) => any;
  readonly buildComparisonReport: (input: unknown) => any;
}

const source = await readFile(
  new URL("../public/report-core.js", import.meta.url),
  "utf8",
);
const context = {} as Record<string, unknown>;
runInNewContext(source, context);
const core = context.WentianReportCore as ReportCore;

test("运行详情按任务、问题和域名生成可复算汇总", () => {
  const report = core.buildNaturalReport({
    questions: [
      { id: "q1", text: "问题一" },
      { id: "q2", text: "问题二" },
    ],
    tasks: [
      { query_snapshot_item_id: "q1", status: "confirmed" },
      { query_snapshot_item_id: "q1", status: "confirmed" },
      { query_snapshot_item_id: "q2", status: "needs_review" },
    ],
    rankings: [
      {
        query_snapshot_item_id: "q1",
        total_formal_source_entries: 5,
        ranking: [
          {
            registrable_domain: "a.example",
            display_origin: "https://www.a.example",
            formal_source_entry_count: 3,
          },
          {
            registrable_domain: "b.example",
            display_origin: "https://b.example",
            formal_source_entry_count: 2,
          },
        ],
      },
      {
        query_snapshot_item_id: "q2",
        total_formal_source_entries: 1,
        ranking: [
          {
            registrable_domain: "a.example",
            display_origin: "https://a.example",
            formal_source_entry_count: 1,
          },
        ],
      },
    ],
  });

  assert.equal(report.taskSummary.total, 3);
  assert.equal(report.taskSummary.confirmed, 2);
  assert.equal(report.totalEntries, 6);
  assert.equal(report.uniqueDomainCount, 2);
  assert.equal(report.questionsWithSources, 2);
  assert.equal(report.questions[0].averageEntriesPerConfirmedSample, 2.5);
  assert.equal(report.questions[0].topDomain, "https://www.a.example");
  assert.deepEqual(JSON.parse(JSON.stringify(report.domains)), [
    {
      position: 1,
      registrableDomain: "a.example",
      displayOrigin: "https://www.a.example",
      entryCount: 4,
      share: 4 / 6,
    },
    {
      position: 2,
      registrableDomain: "b.example",
      displayOrigin: "https://b.example",
      entryCount: 2,
      share: 2 / 6,
    },
  ]);
});

test("信源对照详情只对可用问题计算平均TopK重合", () => {
  const report = core.buildComparisonReport({
    naturalTasks: [{ status: "confirmed" }],
    nominationTasks: [{ status: "confirmed" }, { status: "rejected" }],
    questionNames: { q1: "问题一", q2: "问题二" },
    report: {
      questions: [
        {
          query_snapshot_item_id: "q1",
          availability: "available",
          overlap: { value: 0.4 },
          citation_ranking: {
            domains: [{ registrable_domain: "a.example", entry_count: 3 }],
          },
          nomination_ranking: {
            domains: [{ registrable_domain: "b.example", entry_count: 2 }],
          },
        },
        {
          query_snapshot_item_id: "q2",
          availability: "not_available",
          overlap: { value: 0 },
          citation_ranking: { domains: [] },
          nomination_ranking: { domains: [] },
        },
      ],
    },
  });

  assert.equal(report.availableQuestionCount, 1);
  assert.equal(report.averageOverlap, 0.4);
  assert.equal(report.naturalTaskSummary.confirmed, 1);
  assert.equal(report.nominationTaskSummary.rejected, 1);
  assert.equal(report.questions[0].text, "问题一");
});
