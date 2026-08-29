import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSearchableLabel,
  filterSearchableOptions,
  SEARCHABLE_SELECT_RESULT_LIMIT,
} from "../public/searchable-select-core.js";

test("动态选择器把长运行标签拆成主要信息和完整元数据", () => {
  const description = describeSearchableLabel(
    "自然回答 · 千问 Web · 广州装修推荐 · 广州 · 装修 · 12次采样 · 已完成 · 2026/8/26 · 1a250654",
    3,
  );

  assert.equal(description.primary, "自然回答 · 千问 Web · 广州装修推荐");
  assert.match(description.meta, /12次采样/);
  assert.match(description.meta, /1a250654/);
});

test("大量动态选项限制首屏数量并支持多关键词收窄", () => {
  const options = Array.from({ length: 150 }, (_, index) => {
    const label = `${index % 2 ? "自然回答" : "信源自述"} · 千问 Web · 广州装修 ${index} · 已完成`;
    return {
      value: String(index),
      label,
      ...describeSearchableLabel(label, 3),
    };
  });

  const initial = filterSearchableOptions(options, "");
  assert.equal(initial.items.length, SEARCHABLE_SELECT_RESULT_LIMIT);
  assert.equal(initial.matchedCount, 150);
  assert.equal(initial.truncated, true);

  const searched = filterSearchableOptions(options, "自然回答 装修 149");
  assert.deepEqual(
    searched.items.map((item) => item.value),
    ["149"],
  );
  assert.equal(searched.truncated, false);
});
