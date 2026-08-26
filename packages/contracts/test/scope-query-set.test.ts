import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalQuerySetSnapshotInputSchema,
  queryIntentCodeSchema,
} from "../src/index.ts";

const validInput = {
  scope_id: "31111111-1111-4111-8111-111111111111",
  title: "广州搬家公司问题集",
  locale: "zh-CN",
  market: "广州",
  industry: "搬家",
  region: "广州",
  queries: [
    {
      query_text: "广州搬家公司哪家好？",
      intent_code: "recommendation",
      commercial_value: "high",
    },
  ],
};

test("问题集输入只接受批准的六类意图", () => {
  assert.equal(queryIntentCodeSchema.options.length, 6);
  assert.equal(
    createLocalQuerySetSnapshotInputSchema.safeParse(validInput).success,
    true,
  );
  assert.equal(
    createLocalQuerySetSnapshotInputSchema.safeParse({
      ...validInput,
      queries: [{ ...validInput.queries[0], intent_code: "transactional" }],
    }).success,
    false,
  );
});

test("普通本地创建契约拒绝客户端提交GEO归属", () => {
  assert.equal(
    createLocalQuerySetSnapshotInputSchema.safeParse({
      ...validInput,
      geo_project_ref: "geo-project-1",
    }).success,
    false,
  );
});

test("问题数量限制为1至100", () => {
  assert.equal(
    createLocalQuerySetSnapshotInputSchema.safeParse({
      ...validInput,
      queries: [],
    }).success,
    false,
  );
  assert.equal(
    createLocalQuerySetSnapshotInputSchema.safeParse({
      ...validInput,
      queries: Array.from({ length: 101 }, () => validInput.queries[0]),
    }).success,
    false,
  );
});
