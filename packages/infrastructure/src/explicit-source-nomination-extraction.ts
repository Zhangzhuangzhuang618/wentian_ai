import type { ExplicitSourceNominationExtractor } from "@wentian/application";

import { normalizeSourceUrl } from "./source-url-normalization.ts";

export const EXPLICIT_SOURCE_NOMINATION_EXTRACTION_VERSION =
  "wentian-explicit-source-nomination@1" as const;

export const EXPLICIT_SOURCE_NOMINATION_WARNING =
  "EXPLICIT_ONLY_NO_NAME_TO_DOMAIN_INFERENCE" as const;

export interface ExplicitSourceNominationCandidate {
  readonly registrableDomain: string;
  readonly position: number;
  readonly informationType: null;
  readonly reason: null;
  readonly extractionEvidence: "visible_http_url" | "visible_bare_domain";
}

export interface ExplicitSourceNominationExtractionResult {
  readonly extractionVersion: typeof EXPLICIT_SOURCE_NOMINATION_EXTRACTION_VERSION;
  readonly status: "review_required" | "no_explicit_source";
  readonly candidates: readonly ExplicitSourceNominationCandidate[];
  readonly validExplicitOccurrenceCount: number;
  readonly rejectedExplicitOccurrenceCount: number;
  readonly truncated: boolean;
  readonly warning: typeof EXPLICIT_SOURCE_NOMINATION_WARNING;
}

interface SourceOccurrence {
  readonly start: number;
  readonly end: number;
  readonly registrableDomain: string;
  readonly extractionEvidence: ExplicitSourceNominationCandidate["extractionEvidence"];
}

const SCHEME_URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/giu;
const BARE_DOMAIN_PATTERN =
  /(?<![@\p{L}\p{N}_-])(?:xn--[a-z0-9-]+|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:xn--[a-z0-9-]+|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+(?![\p{L}\p{N}_-])/giu;
const TRAILING_TEXT_PUNCTUATION = /[),.;:!?，。；：！？、）】》」』]+$/u;
const MAX_EXPLICIT_NOMINATIONS = 10;

export function extractExplicitSourceNominations(
  answerText: string,
): ExplicitSourceNominationExtractionResult {
  if (
    typeof answerText !== "string" ||
    !answerText.trim() ||
    answerText.length > 200_000
  ) {
    throw new Error("INVALID_SOURCE_NOMINATION_ANSWER_TEXT");
  }

  const occurrences: SourceOccurrence[] = [];
  const schemeUrlRanges: { readonly start: number; readonly end: number }[] =
    [];
  let rejectedExplicitOccurrenceCount = 0;
  for (const match of answerText.matchAll(SCHEME_URL_PATTERN)) {
    const start = match.index;
    const raw = match[0];
    const candidate = raw.replace(TRAILING_TEXT_PUNCTUATION, "");
    const end = start + raw.length;
    schemeUrlRanges.push({ start, end });
    const normalized = normalizeSourceUrl(candidate);
    if (normalized.status === "rejected") {
      rejectedExplicitOccurrenceCount += 1;
      continue;
    }
    occurrences.push({
      start,
      end,
      registrableDomain: normalized.registrableDomain,
      extractionEvidence: "visible_http_url",
    });
  }

  for (const match of answerText.matchAll(BARE_DOMAIN_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      schemeUrlRanges.some((range) => start >= range.start && end <= range.end)
    ) {
      continue;
    }
    const normalized = normalizeSourceUrl(`https://${match[0]}`);
    if (normalized.status === "rejected") {
      rejectedExplicitOccurrenceCount += 1;
      continue;
    }
    occurrences.push({
      start,
      end,
      registrableDomain: normalized.registrableDomain,
      extractionEvidence: "visible_bare_domain",
    });
  }

  occurrences.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.extractionEvidence.localeCompare(right.extractionEvidence),
  );
  const selected = occurrences.slice(0, MAX_EXPLICIT_NOMINATIONS);
  const candidates = Object.freeze(
    selected.map((occurrence, index) =>
      Object.freeze({
        registrableDomain: occurrence.registrableDomain,
        position: index + 1,
        informationType: null,
        reason: null,
        extractionEvidence: occurrence.extractionEvidence,
      }),
    ),
  );
  return Object.freeze({
    extractionVersion: EXPLICIT_SOURCE_NOMINATION_EXTRACTION_VERSION,
    status: candidates.length > 0 ? "review_required" : "no_explicit_source",
    candidates,
    validExplicitOccurrenceCount: occurrences.length,
    rejectedExplicitOccurrenceCount,
    truncated: occurrences.length > MAX_EXPLICIT_NOMINATIONS,
    warning: EXPLICIT_SOURCE_NOMINATION_WARNING,
  });
}

export class DeterministicExplicitSourceNominationExtractor implements ExplicitSourceNominationExtractor {
  extract(answerText: string): ExplicitSourceNominationExtractionResult {
    return extractExplicitSourceNominations(answerText);
  }
}
