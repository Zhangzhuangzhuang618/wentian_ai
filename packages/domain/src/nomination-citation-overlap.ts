export const NOMINATION_CITATION_OVERLAP_METHODOLOGY_VERSION =
  "nomination-citation-overlap@1" as const;

export const DEFAULT_NOMINATION_CITATION_OVERLAP_K = 10 as const;

export const NOMINATION_CITATION_OVERLAP_WARNING =
  "OBSERVED_SET_OVERLAP_NOT_CAUSAL_OR_INTERNAL_RETRIEVAL" as const;

export interface ComputeNominationCitationOverlapInput {
  readonly querySnapshotItemId: string;
  readonly k?: number;
  readonly rankedNominationDomains: readonly string[];
  readonly rankedCitationDomains: readonly string[];
}

export interface NominationCitationOverlapReport {
  readonly methodologyVersion: typeof NOMINATION_CITATION_OVERLAP_METHODOLOGY_VERSION;
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
  readonly warning: typeof NOMINATION_CITATION_OVERLAP_WARNING;
}

export function computeNominationCitationOverlap(
  input: ComputeNominationCitationOverlapInput,
): NominationCitationOverlapReport {
  const querySnapshotItemId = normalizeRequiredText(
    input.querySnapshotItemId,
    "INVALID_OVERLAP_QUERY_SNAPSHOT_ITEM_ID",
  );
  const k = input.k ?? DEFAULT_NOMINATION_CITATION_OVERLAP_K;
  if (!Number.isInteger(k) || k < 1 || k > 10) {
    throw new Error("INVALID_NOMINATION_CITATION_OVERLAP_K");
  }
  const rankedNominationDomains = normalizeRankedDomains(
    input.rankedNominationDomains,
    "NOMINATION",
  );
  const rankedCitationDomains = normalizeRankedDomains(
    input.rankedCitationDomains,
    "CITATION",
  );
  const nominationTopKDomains = Object.freeze(
    rankedNominationDomains.slice(0, k),
  );
  const citationTopKDomains = Object.freeze(rankedCitationDomains.slice(0, k));
  const citationSet = new Set(citationTopKDomains);
  const overlapDomains = Object.freeze(
    nominationTopKDomains.filter((domain) => citationSet.has(domain)),
  );

  return Object.freeze({
    methodologyVersion: NOMINATION_CITATION_OVERLAP_METHODOLOGY_VERSION,
    querySnapshotItemId,
    k,
    numerator: overlapDomains.length,
    denominator: k,
    value: overlapDomains.length / k,
    nominationEffectiveSetSize: nominationTopKDomains.length,
    citationEffectiveSetSize: citationTopKDomains.length,
    nominationTopKDomains,
    citationTopKDomains,
    overlapDomains,
    warning: NOMINATION_CITATION_OVERLAP_WARNING,
  });
}

function normalizeRankedDomains(
  values: readonly string[],
  side: "NOMINATION" | "CITATION",
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new Error(`INVALID_${side}_RANKED_DOMAINS`);
  }
  const normalized = values.map((value) => normalizeDomain(value));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`DUPLICATE_${side}_RANKED_DOMAIN`);
  }
  return Object.freeze(normalized);
}

function normalizeDomain(value: string): string {
  const normalized = normalizeRequiredText(
    value,
    "INVALID_OVERLAP_REGISTRABLE_DOMAIN",
  )
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    normalized.includes("://") ||
    normalized.includes("/") ||
    /\s/u.test(normalized)
  ) {
    throw new Error("INVALID_OVERLAP_REGISTRABLE_DOMAIN");
  }
  return normalized;
}

function normalizeRequiredText(value: string, errorCode: string): string {
  if (typeof value !== "string") {
    throw new Error(errorCode);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}
