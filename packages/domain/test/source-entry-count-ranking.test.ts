import assert from "node:assert/strict";
import test from "node:test";

import {
  rankSourceEntriesByDomain,
  SOURCE_ENTRY_COUNT_RANKING_METHODOLOGY_VERSION,
  type SourceEntryForRanking,
} from "../src/source-entry-count-ranking.ts";

function entries(
  registrableDomain: string,
  count: number,
  startAt: number,
  role: SourceEntryForRanking["role"] = "cited",
): SourceEntryForRanking[] {
  return Array.from({ length: count }, (_, offset) => ({
    entryId: `entry-${startAt + offset}`,
    querySnapshotItemId: "query-1",
    role,
    registrableDomain,
  }));
}

test("按所有回答中的正式信源条目累计得到A、D、C、B排名", () => {
  const report = rankSourceEntriesByDomain({
    querySnapshotItemId: "query-1",
    role: "cited",
    entries: [
      ...entries("a.example", 5, 1),
      ...entries("b.example", 3, 6),
      ...entries("c.example", 2, 9),
      ...entries("a.example", 2, 11),
      ...entries("c.example", 2, 13),
      ...entries("d.example", 6, 15),
    ],
  });

  assert.equal(
    report.methodologyVersion,
    SOURCE_ENTRY_COUNT_RANKING_METHODOLOGY_VERSION,
  );
  assert.equal(report.totalEntryCount, 20);
  assert.deepEqual(report.domains, [
    { rank: 1, registrableDomain: "a.example", entryCount: 7 },
    { rank: 2, registrableDomain: "d.example", entryCount: 6 },
    { rank: 3, registrableDomain: "c.example", entryCount: 4 },
    { rank: 4, registrableDomain: "b.example", entryCount: 3 },
  ]);
});

test("同域名条目不去重且并列时按域名字典序确定排名", () => {
  const report = rankSourceEntriesByDomain({
    querySnapshotItemId: " query-1 ",
    role: "nominated",
    entries: [
      ...entries("B.EXAMPLE.", 2, 1, "nominated"),
      ...entries("a.example", 2, 3, "nominated"),
    ],
  });

  assert.deepEqual(report.domains, [
    { rank: 1, registrableDomain: "a.example", entryCount: 2 },
    { rank: 2, registrableDomain: "b.example", entryCount: 2 },
  ]);
});

test("空输入返回空排名且结果不可变", () => {
  const report = rankSourceEntriesByDomain({
    querySnapshotItemId: "query-1",
    role: "cited",
    entries: [],
  });

  assert.equal(report.totalEntryCount, 0);
  assert.deepEqual(report.domains, []);
  assert.throws(() => (report.domains as Array<unknown>).push({}), TypeError);
});

test("跨题、跨角色、重复条目ID和非法域名失败关闭", () => {
  const base = entries("a.example", 1, 1)[0]!;

  assert.throws(
    () =>
      rankSourceEntriesByDomain({
        querySnapshotItemId: "query-2",
        role: "cited",
        entries: [base],
      }),
    /SOURCE_RANKING_QUERY_MISMATCH/,
  );
  assert.throws(
    () =>
      rankSourceEntriesByDomain({
        querySnapshotItemId: "query-1",
        role: "nominated",
        entries: [base],
      }),
    /SOURCE_RANKING_ROLE_MISMATCH/,
  );
  assert.throws(
    () =>
      rankSourceEntriesByDomain({
        querySnapshotItemId: "query-1",
        role: "cited",
        entries: [base, base],
      }),
    /DUPLICATE_SOURCE_RANKING_ENTRY_ID/,
  );
  assert.throws(
    () =>
      rankSourceEntriesByDomain({
        querySnapshotItemId: "query-1",
        role: "cited",
        entries: [{ ...base, registrableDomain: "https://a.example/source" }],
      }),
    /INVALID_SOURCE_RANKING_REGISTRABLE_DOMAIN/,
  );
});
