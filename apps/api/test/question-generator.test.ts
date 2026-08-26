import assert from "node:assert/strict";
import test from "node:test";

import {
  generateIndustryQuestions,
  QUESTION_GENERATOR_VERSION,
} from "../public/question-generator.js";

test("行业问题生成器按地区、行业和数量生成可编辑问题", () => {
  const questions = generateIndustryQuestions({
    industry: "装修行业",
    region: "广州",
    count: 10,
  });

  assert.equal(QUESTION_GENERATOR_VERSION, "industry-question-generator@1");
  assert.equal(questions.length, 10);
  assert.equal(new Set(questions.map((item) => item.text)).size, 10);
  assert.match(questions[0]!.text, /广州装修/);
  assert.equal(questions[0]!.intentCode, "recommendation");
  assert.equal(questions[5]!.intentCode, "procurement");
});

test("行业问题生成器只接受批准数量并拒绝空行业", () => {
  assert.throws(
    () =>
      generateIndustryQuestions({ industry: "搬家", region: "广州", count: 8 }),
    /生成数量只支持5、10或20个/,
  );
  assert.throws(
    () => generateIndustryQuestions({ industry: "", region: "广州", count: 5 }),
    /请先填写行业/,
  );
});
