import assert from "node:assert/strict";
import test from "node:test";

import {
  computeNominationCitationOverlap,
  DEFAULT_NOMINATION_CITATION_OVERLAP_K,
  NOMINATION_CITATION_OVERLAP_METHODOLOGY_VERSION,
  NOMINATION_CITATION_OVERLAP_WARNING,
} from "../src/nomination-citation-overlap.ts";

test("按固定K分母计算同题提名与引用Top-K重合", () => {
  const report = computeNominationCitationOverlap({
    querySnapshotItemId: "query-1",
    rankedNominationDomains: ["a.example", "b.example", "c.example"],
    rankedCitationDomains: ["b.example", "c.example", "d.example"],
  });

  assert.equal(
    report.methodologyVersion,
    NOMINATION_CITATION_OVERLAP_METHODOLOGY_VERSION,
  );
  assert.equal(report.k, DEFAULT_NOMINATION_CITATION_OVERLAP_K);
  assert.equal(report.numerator, 2);
  assert.equal(report.denominator, 10);
  assert.equal(report.value, 0.2);
  assert.equal(report.nominationEffectiveSetSize, 3);
  assert.equal(report.citationEffectiveSetSize, 3);
  assert.deepEqual(report.overlapDomains, ["b.example", "c.example"]);
  assert.equal(report.warning, NOMINATION_CITATION_OVERLAP_WARNING);
});

test("显式K只截取两侧排名前K且保留有效集合大小", () => {
  const report = computeNominationCitationOverlap({
    querySnapshotItemId: "query-1",
    k: 2,
    rankedNominationDomains: ["a.example", "b.example", "c.example"],
    rankedCitationDomains: ["c.example", "b.example", "a.example"],
  });

  assert.deepEqual(report.nominationTopKDomains, ["a.example", "b.example"]);
  assert.deepEqual(report.citationTopKDomains, ["c.example", "b.example"]);
  assert.deepEqual(report.overlapDomains, ["b.example"]);
  assert.equal(report.numerator, 1);
  assert.equal(report.denominator, 2);
  assert.equal(report.value, 0.5);
});

test("任一集合不足K仍使用固定K且空集合不伪装为不可用", () => {
  const report = computeNominationCitationOverlap({
    querySnapshotItemId: "query-1",
    rankedNominationDomains: [],
    rankedCitationDomains: ["a.example"],
  });

  assert.equal(report.numerator, 0);
  assert.equal(report.denominator, 10);
  assert.equal(report.value, 0);
  assert.equal(report.nominationEffectiveSetSize, 0);
  assert.equal(report.citationEffectiveSetSize, 1);
});

test("域名规范化后计算且结果不可变", () => {
  const report = computeNominationCitationOverlap({
    querySnapshotItemId: " query-1 ",
    rankedNominationDomains: ["Example.COM."],
    rankedCitationDomains: ["example.com"],
  });

  assert.equal(report.querySnapshotItemId, "query-1");
  assert.deepEqual(report.overlapDomains, ["example.com"]);
  assert.throws(
    () => (report.nominationTopKDomains as string[]).push("other.example"),
    TypeError,
  );
});

test("非法K、URL和规范化后重复域名失败关闭", () => {
  const base = {
    querySnapshotItemId: "query-1",
    rankedNominationDomains: ["a.example"],
    rankedCitationDomains: ["a.example"],
  } as const;

  assert.throws(
    () => computeNominationCitationOverlap({ ...base, k: 0 }),
    /INVALID_NOMINATION_CITATION_OVERLAP_K/,
  );
  assert.throws(
    () => computeNominationCitationOverlap({ ...base, k: 11 }),
    /INVALID_NOMINATION_CITATION_OVERLAP_K/,
  );
  assert.throws(
    () =>
      computeNominationCitationOverlap({
        ...base,
        rankedCitationDomains: ["https:\/\/a.example/source"],
      }),
    /INVALID_OVERLAP_REGISTRABLE_DOMAIN/,
  );
  assert.throws(
    () =>
      computeNominationCitationOverlap({
        ...base,
        rankedNominationDomains: ["Example.com", "example.com."],
      }),
    /DUPLICATE_NOMINATION_RANKED_DOMAIN/,
  );
});
