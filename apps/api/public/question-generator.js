export const QUESTION_GENERATOR_VERSION = "industry-question-generator@1";

const templates = Object.freeze([
  ["recommendation", ({ region, topic }) => `${region}${topic}服务哪家好？`],
  [
    "recommendation",
    ({ region, topic }) => `请推荐几家${region}靠谱的${topic}服务商。`,
  ],
  [
    "brand_recognition",
    ({ region, topic }) => `${region}${topic}行业有哪些知名品牌或公司？`,
  ],
  [
    "exploration",
    ({ region, topic }) => `${region}${topic}服务有哪些常见类型？`,
  ],
  [
    "comparison",
    ({ region, topic }) => `比较${region}${topic}公司时应该看哪些指标？`,
  ],
  ["procurement", ({ region, topic }) => `${region}${topic}服务一般怎么收费？`],
  [
    "procurement",
    ({ region, topic }) => `向${region}${topic}公司询价时需要确认哪些项目？`,
  ],
  [
    "procurement",
    ({ region, topic }) => `与${region}${topic}公司签约前要确认哪些费用？`,
  ],
  [
    "education",
    ({ region, topic }) => `选择${region}${topic}服务商需要核验哪些资质？`,
  ],
  [
    "education",
    ({ region, topic }) => `${region}${topic}服务有哪些常见风险和避坑要点？`,
  ],
  [
    "comparison",
    ({ region, topic }) => `${region}${topic}本地公司和全国连锁有什么区别？`,
  ],
  [
    "education",
    ({ region, topic }) => `如何核验${region}${topic}公司的真实用户评价？`,
  ],
  [
    "comparison",
    ({ region, topic }) => `${region}${topic}公司通常提供哪些售后保障？`,
  ],
  [
    "education",
    ({ region, topic }) => `${region}${topic}服务的价格通常由哪些部分组成？`,
  ],
  [
    "recommendation",
    ({ region, topic }) => `不同需求应该怎样选择${region}${topic}服务商？`,
  ],
  [
    "comparison",
    ({ region, topic }) => `${region}${topic}公司规模大小会影响哪些服务环节？`,
  ],
  [
    "education",
    ({ region, topic }) => `如何核验${region}${topic}公司的案例和服务能力？`,
  ],
  [
    "exploration",
    ({ region, topic }) => `${region}${topic}服务常见投诉集中在哪些方面？`,
  ],
  [
    "education",
    ({ region, topic }) => `${region}${topic}服务从咨询到完成通常有哪些流程？`,
  ],
  [
    "procurement",
    ({ region, topic }) => `联系${region}${topic}公司时应该准备哪些问题？`,
  ],
]);

export function generateIndustryQuestions(input) {
  const industry = normalizeLabel(input.industry, "请先填写行业");
  const region = normalizeLabel(input.region, "请先填写地区");
  const count = Number(input.count);
  if (![5, 10, 20].includes(count)) {
    throw new Error("生成数量只支持5、10或20个");
  }
  const topic = industry.replace(/行业$/u, "");
  return Object.freeze(
    templates.slice(0, count).map(([intentCode, render]) =>
      Object.freeze({
        text: render({ region, topic }),
        intentCode,
      }),
    ),
  );
}

function normalizeLabel(value, errorMessage) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(errorMessage);
  return normalized;
}
