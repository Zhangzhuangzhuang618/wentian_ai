import assert from "node:assert/strict";
import test from "node:test";

import {
  RUN_MODE_COMBINATIONS,
  assertValidRunModeCombination,
  isValidRunModeCombination,
  type RunModeCombination,
} from "../src/index.ts";

test("批准基线中的五个运行组合全部有效", () => {
  assert.equal(RUN_MODE_COMBINATIONS.length, 5);

  for (const combination of RUN_MODE_COMBINATIONS) {
    assert.equal(isValidRunModeCombination(combination), true);
  }
});

test("消费端人工录入不能伪装成外部数据集之外的组合", () => {
  const invalidCombination: RunModeCombination = {
    retrievalMode: "imported",
    executionTargetType: "consumer_surface",
    collectionMethod: "manual_import",
  };

  assert.equal(isValidRunModeCombination(invalidCombination), false);
  assert.throws(
    () => assertValidRunModeCombination(invalidCombination),
    /INVALID_RUN_MODE_COMBINATION/,
  );
});

test("联网API不能使用浏览器采集方式", () => {
  assert.equal(
    isValidRunModeCombination({
      retrievalMode: "search_api",
      executionTargetType: "provider",
      collectionMethod: "browser_assisted",
    }),
    false,
  );
});
