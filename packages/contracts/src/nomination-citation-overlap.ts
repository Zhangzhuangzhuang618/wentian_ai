import { z } from "zod";

export const NOMINATION_CITATION_OVERLAP_CONTRACT_VERSION =
  "wentian-nomination-citation-overlap@0-draft" as const;

const domainSchema = z.string().trim().min(1).max(253);

export const nominationCitationOverlapResponseSchema = z
  .object({
    contract_version: z.literal(NOMINATION_CITATION_OVERLAP_CONTRACT_VERSION),
    methodology_version: z.literal("nomination-citation-overlap@1"),
    query_snapshot_item_id: z.uuid(),
    k: z.number().int().min(1).max(10),
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().min(1).max(10),
    value: z.number().min(0).max(1),
    nomination_effective_set_size: z.number().int().min(0).max(10),
    citation_effective_set_size: z.number().int().min(0).max(10),
    nomination_top_k_domains: z.array(domainSchema).max(10),
    citation_top_k_domains: z.array(domainSchema).max(10),
    overlap_domains: z.array(domainSchema).max(10),
    warning: z.literal("OBSERVED_SET_OVERLAP_NOT_CAUSAL_OR_INTERNAL_RETRIEVAL"),
  })
  .strict()
  .superRefine((response, context) => {
    const nominationSet = new Set(response.nomination_top_k_domains);
    const citationSet = new Set(response.citation_top_k_domains);
    const expectedOverlap = response.nomination_top_k_domains.filter((domain) =>
      citationSet.has(domain),
    );
    const allDomains = [
      ...response.nomination_top_k_domains,
      ...response.citation_top_k_domains,
      ...response.overlap_domains,
    ];
    if (allDomains.some((domain) => !isNormalizedDomain(domain))) {
      context.addIssue({
        code: "custom",
        path: ["nomination_top_k_domains"],
        message: "OVERLAP_DOMAIN_NOT_NORMALIZED",
      });
    }
    if (
      nominationSet.size !== response.nomination_top_k_domains.length ||
      citationSet.size !== response.citation_top_k_domains.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["nomination_top_k_domains"],
        message: "DUPLICATE_OVERLAP_TOP_K_DOMAIN",
      });
    }
    if (
      response.denominator !== response.k ||
      response.numerator > response.k ||
      response.nomination_top_k_domains.length > response.k ||
      response.citation_top_k_domains.length > response.k ||
      response.numerator !== response.overlap_domains.length ||
      response.nomination_effective_set_size !==
        response.nomination_top_k_domains.length ||
      response.citation_effective_set_size !==
        response.citation_top_k_domains.length ||
      !sameOrderedValues(response.overlap_domains, expectedOverlap) ||
      !approximatelyEqual(
        response.value,
        response.numerator / response.denominator,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "NOMINATION_CITATION_OVERLAP_NOT_RECOMPUTABLE",
      });
    }
  });

export type NominationCitationOverlapResponseDto = z.infer<
  typeof nominationCitationOverlapResponseSchema
>;

export interface NominationCitationOverlapReportLike {
  readonly methodologyVersion: "nomination-citation-overlap@1";
  readonly querySnapshotItemId: string;
  readonly k: number;
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
  readonly nominationEffectiveSetSize: number;
  readonly citationEffectiveSetSize: number;
  readonly nominationTopKDomains: readonly string[];
  readonly citationTopKDomains: readonly string[];
  readonly overlapDomains: readonly string[];
  readonly warning: "OBSERVED_SET_OVERLAP_NOT_CAUSAL_OR_INTERNAL_RETRIEVAL";
}

export function adaptNominationCitationOverlapReportToResponse(
  report: NominationCitationOverlapReportLike,
): NominationCitationOverlapResponseDto {
  return nominationCitationOverlapResponseSchema.parse({
    contract_version: NOMINATION_CITATION_OVERLAP_CONTRACT_VERSION,
    methodology_version: report.methodologyVersion,
    query_snapshot_item_id: report.querySnapshotItemId,
    k: report.k,
    numerator: report.numerator,
    denominator: report.denominator,
    value: report.value,
    nomination_effective_set_size: report.nominationEffectiveSetSize,
    citation_effective_set_size: report.citationEffectiveSetSize,
    nomination_top_k_domains: report.nominationTopKDomains,
    citation_top_k_domains: report.citationTopKDomains,
    overlap_domains: report.overlapDomains,
    warning: report.warning,
  });
}

function isNormalizedDomain(value: string): boolean {
  return (
    value === value.trim().toLowerCase() &&
    !value.endsWith(".") &&
    !value.includes("://") &&
    !value.includes("/") &&
    !/\s/u.test(value)
  );
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * 10;
}
