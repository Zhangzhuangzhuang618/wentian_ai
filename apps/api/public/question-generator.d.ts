export const QUESTION_GENERATOR_VERSION: "industry-question-generator@1";

export interface GeneratedIndustryQuestion {
  readonly text: string;
  readonly intentCode:
    | "brand_recognition"
    | "exploration"
    | "recommendation"
    | "comparison"
    | "education"
    | "procurement";
}

export function generateIndustryQuestions(input: {
  readonly industry: string;
  readonly region: string;
  readonly count: number | string;
}): readonly GeneratedIndustryQuestion[];
