import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPLICIT_SOURCE_NOMINATION_EXTRACTION_VERSION,
  EXPLICIT_SOURCE_NOMINATION_WARNING,
  extractExplicitSourceNominations,
} from "../src/index.ts";

test("按原文顺序提取显式HTTP URL和裸域名且不重复URL内部host", () => {
  const result = extractExplicitSourceNominations(
    "先看 https://www.example.com/report?utm_source=test，再核验 example.org，最后参照 https://example.com/other。",
  );

  assert.equal(
    result.extractionVersion,
    EXPLICIT_SOURCE_NOMINATION_EXTRACTION_VERSION,
  );
  assert.equal(result.status, "review_required");
  assert.deepEqual(
    result.candidates.map((candidate) => ({
      domain: candidate.registrableDomain,
      position: candidate.position,
      evidence: candidate.extractionEvidence,
    })),
    [
      { domain: "example.com", position: 1, evidence: "visible_http_url" },
      { domain: "example.org", position: 2, evidence: "visible_bare_domain" },
      { domain: "example.com", position: 3, evidence: "visible_http_url" },
    ],
  );
  assert.ok(
    result.candidates.every(
      (candidate) =>
        candidate.informationType === null && candidate.reason === null,
    ),
  );
});

test("同一域名的独立重复提及保留为不同顺序候选", () => {
  const result = extractExplicitSourceNominations(
    "1. example.com 2. EXAMPLE.COM. 3. https://example.com/path",
  );

  assert.equal(result.validExplicitOccurrenceCount, 3);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.registrableDomain),
    ["example.com", "example.com", "example.com"],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.position),
    [1, 2, 3],
  );
});

test("不把机构名称、邮箱、非HTTP scheme或不可注册host猜成域名", () => {
  const result = extractExplicitSourceNominations(
    "参考国家企业信用信息公示系统、大众点评，联系 name@example.com；另见 ftp://files.example.org 和 http://localhost/a。",
  );

  assert.equal(result.status, "no_explicit_source");
  assert.deepEqual(result.candidates, []);
  assert.equal(result.rejectedExplicitOccurrenceCount, 2);
  assert.equal(result.warning, EXPLICIT_SOURCE_NOMINATION_WARNING);
});

test("支持私有公共后缀和中文URL域名的可注册域归一化", () => {
  const result = extractExplicitSourceNominations(
    "参考 https://tenant.github.io/a 与 https://例子.公司.cn/资料。",
  );

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.registrableDomain),
    ["tenant.github.io", "xn--fsqu00a.xn--55qx5d.cn"],
  );
});

test("超过10个显式出现时只输出前10项并明确标记截断", () => {
  const answer = Array.from(
    { length: 12 },
    (_, index) => `https://source${index + 1}.com/page`,
  ).join(" ");
  const result = extractExplicitSourceNominations(answer);

  assert.equal(result.validExplicitOccurrenceCount, 12);
  assert.equal(result.candidates.length, 10);
  assert.equal(result.truncated, true);
  assert.equal(result.candidates[9]?.registrableDomain, "source10.com");
});

test("结果不可变且空白或超长回答失败关闭", () => {
  const result = extractExplicitSourceNominations("example.com");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.candidates));
  assert.ok(Object.isFrozen(result.candidates[0]));
  assert.throws(() => extractExplicitSourceNominations(" "));
  assert.throws(() => extractExplicitSourceNominations("x".repeat(200_001)));
});
