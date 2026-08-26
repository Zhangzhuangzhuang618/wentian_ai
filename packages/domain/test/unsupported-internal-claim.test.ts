import assert from "node:assert/strict";
import test from "node:test";

import {
  UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION,
  assessUnsupportedInternalClaim,
} from "../src/index.ts";

test("明确声称掌握内部抓取频率时生成版本化标记", () => {
  for (const answerText of [
    "我的抓取频率最高的前10个域名如下：example.com。",
    "内部检索频率统计显示，example.com排名最高。",
    "The model's crawl frequency ranking shows the top 10 domains.",
  ]) {
    assert.deepEqual(assessUnsupportedInternalClaim(answerText), {
      unsupportedInternalClaim: true,
      assessmentVersion: UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION,
    });
  }
});

test("明确说明无法访问内部统计时不误标记", () => {
  for (const answerText of [
    "我无法访问内部抓取频率统计，只能根据公开资料推荐来源。",
    "本模型没有内部数据或抓取日志，以下只是公开信源建议。",
    "I do not have access to internal crawl logs, so this is not a frequency ranking.",
  ]) {
    assert.equal(
      assessUnsupportedInternalClaim(answerText).unsupportedInternalClaim,
      false,
    );
  }
});

test("免责声明后另行作出肯定声明时仍标记", () => {
  const assessment = assessUnsupportedInternalClaim(
    "我无法访问内部统计，但我的抓取频率最高的前10个域名如下。",
  );
  assert.equal(assessment.unsupportedInternalClaim, true);
});

test("普通公开信源推荐不被解释为内部抓取声明", () => {
  const assessment = assessUnsupportedInternalClaim(
    "建议参考国家企业信用信息公示系统、消费者投诉平台和企业官网。",
  );
  assert.equal(assessment.unsupportedInternalClaim, false);
  assert.throws(() => assessUnsupportedInternalClaim("   "));
});
