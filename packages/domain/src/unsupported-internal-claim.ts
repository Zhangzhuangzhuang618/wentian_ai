export const UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION =
  "unsupported-internal-claim@1" as const;

export interface UnsupportedInternalClaimAssessment {
  readonly unsupportedInternalClaim: boolean;
  readonly assessmentVersion: typeof UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION;
}

const chineseMetric =
  "(?:抓取|爬取|检索|访问)(?:的)?(?:频率|次数|统计|排名|日志)";
const chineseAssertion = "(?:最高|最多|前\\s*\\d+|依次|如下|显示|表明|为|是)";
const chineseDisclaimerPatterns = [
  new RegExp(
    `(?:无法|不能|不可|无权|不可能).{0,20}(?:访问|获取|获知|查看|掌握|知道|提供|确认|声称|列出).{0,24}(?:内部|真实)?.{0,12}${chineseMetric}`,
    "u",
  ),
  new RegExp(
    `(?:不具备|没有).{0,20}(?:访问权限|内部数据|内部统计|抓取日志|爬取日志|${chineseMetric})`,
    "u",
  ),
];
const chineseClaimPatterns = [
  new RegExp(
    `(?:我|本模型|我们|本系统|本平台|平台).{0,24}${chineseMetric}.{0,24}${chineseAssertion}`,
    "u",
  ),
  new RegExp(
    `${chineseMetric}.{0,16}${chineseAssertion}.{0,16}(?:域名|网站|信源|来源)`,
    "u",
  ),
  new RegExp(
    `(?:内部|真实).{0,12}${chineseMetric}.{0,20}${chineseAssertion}`,
    "u",
  ),
];
const englishDisclaimerPatterns = [
  /\b(?:cannot|can't|unable to|do not|don't|no)\b.{0,40}\b(?:access|know|verify|provide|claim|list)\b.{0,40}\b(?:internal|actual|real)?\s*(?:crawl|fetch|retrieval|access)\s*(?:frequency|count|statistics|logs?)\b/iu,
  /\b(?:no access to|do not have access to|don't have access to)\b.{0,40}\b(?:internal data|internal statistics|crawl logs?|retrieval logs?)\b/iu,
];
const englishClaimPatterns = [
  /\b(?:i|we|this model|the model|our system|this system)\b.{0,40}\b(?:crawl|fetch|retrieve|access)\w*\b.{0,30}\b(?:frequency|count|ranking|most|top\s*\d+)\b/iu,
  /\b(?:crawl|fetch|retrieval|access)\s*(?:frequency|count|ranking|statistics)\b.{0,30}\b(?:highest|most|top\s*\d+|is|are|shows?)\b/iu,
  /\binternal\b.{0,20}\b(?:crawl|fetch|retrieval|access)\b.{0,30}\b(?:frequency|count|statistics|logs?)\b/iu,
];

export function assessUnsupportedInternalClaim(
  answerText: string,
): UnsupportedInternalClaimAssessment {
  if (
    typeof answerText !== "string" ||
    !answerText.trim() ||
    answerText.length > 200_000
  ) {
    throw new Error("INVALID_UNSUPPORTED_INTERNAL_CLAIM_TEXT");
  }
  const segments = answerText
    .split(/[\n。！？!?；;，,]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const unsupportedInternalClaim = segments.some((segment) => {
    const isDisclaimer = [
      ...chineseDisclaimerPatterns,
      ...englishDisclaimerPatterns,
    ].some((pattern) => pattern.test(segment));
    if (isDisclaimer) {
      return false;
    }
    return [...chineseClaimPatterns, ...englishClaimPatterns].some((pattern) =>
      pattern.test(segment),
    );
  });
  return Object.freeze({
    unsupportedInternalClaim,
    assessmentVersion: UNSUPPORTED_INTERNAL_CLAIM_ASSESSMENT_VERSION,
  });
}
