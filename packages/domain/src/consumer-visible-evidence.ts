import { createHash } from "node:crypto";

import type { ConsumerSessionConditions } from "./consumer-observation.ts";

export interface ConsumerVisibleCitation {
  readonly url: string;
  readonly label: string | null;
  readonly position: number;
  readonly observedUrl: string | null;
  readonly resolution: "known_redirect_target" | null;
}

export interface ConsumerVisibleCitationInput {
  readonly url: string;
  readonly label?: string | null;
  readonly position: number;
  readonly observedUrl?: string | null;
  readonly resolution?: "known_redirect_target" | null;
}

export interface ConsumerVisibleObservationMetadata extends ConsumerSessionConditions {
  readonly productLabel: string;
  readonly surfaceModelLabel: string | null;
  readonly observedAt: string;
}

export type ConsumerVisibleSearchTraceStatus =
  "complete" | "partial" | "not_present";

export interface ConsumerVisibleSearchKeyword {
  readonly position: number;
  readonly text: string;
}

export interface ConsumerVisibleSearchTrace {
  readonly status: ConsumerVisibleSearchTraceStatus;
  readonly summaryText: string | null;
  readonly declaredKeywordCount: number | null;
  readonly keywords: readonly ConsumerVisibleSearchKeyword[];
  readonly declaredReferenceCount: number | null;
}

export interface ConsumerVisibleSearchTraceInput {
  readonly status: ConsumerVisibleSearchTraceStatus;
  readonly summaryText?: string | null;
  readonly declaredKeywordCount?: number | null;
  readonly keywords?: readonly {
    readonly position: number;
    readonly text: string;
  }[];
  readonly declaredReferenceCount?: number | null;
}

export function normalizeConsumerVisibleCitations(
  input: readonly ConsumerVisibleCitationInput[],
): readonly ConsumerVisibleCitation[] {
  if (input.length > 100) {
    throw new Error("TOO_MANY_VISIBLE_CITATIONS");
  }
  const positions = new Set<number>();
  const citations = input.map((citation) => {
    if (!Number.isInteger(citation.position) || citation.position < 1) {
      throw new Error("INVALID_VISIBLE_CITATION_POSITION");
    }
    if (positions.has(citation.position)) {
      throw new Error("DUPLICATE_VISIBLE_CITATION_POSITION");
    }
    positions.add(citation.position);
    const url = normalizeHttpUrl(citation.url);
    const observedUrl = citation.observedUrl
      ? normalizeHttpUrl(citation.observedUrl)
      : null;
    const resolution = citation.resolution ?? null;
    if (resolution !== null && resolution !== "known_redirect_target") {
      throw new Error("INVALID_VISIBLE_CITATION_RESOLUTION");
    }
    if ((observedUrl === null) !== (resolution === null)) {
      throw new Error("VISIBLE_CITATION_RESOLUTION_PAIR_REQUIRED");
    }
    return Object.freeze({
      url,
      label: normalizeOptionalText(citation.label, 500),
      position: citation.position,
      observedUrl,
      resolution,
    });
  });
  if (positions.size > 0 && !positions.has(1)) {
    throw new Error("VISIBLE_CITATION_FIRST_POSITION_REQUIRED");
  }
  citations.sort((left, right) => left.position - right.position);
  return Object.freeze(citations);
}

export function normalizeConsumerVisibleMetadata(
  input: ConsumerVisibleObservationMetadata,
): ConsumerVisibleObservationMetadata {
  if (
    input.searchMode !== "enabled" &&
    input.searchMode !== "disabled" &&
    input.searchMode !== "unknown"
  ) {
    throw new Error("INVALID_CONSUMER_SEARCH_MODE");
  }
  if (
    typeof input.isNewConversation !== "boolean" ||
    typeof input.isLoggedIn !== "boolean"
  ) {
    throw new Error("INVALID_CONSUMER_SESSION_BOOLEAN");
  }
  if (
    (input.memoryEnabled !== null &&
      typeof input.memoryEnabled !== "boolean") ||
    (input.personalizationEnabled !== null &&
      typeof input.personalizationEnabled !== "boolean")
  ) {
    throw new Error("INVALID_CONSUMER_SESSION_NULLABLE_BOOLEAN");
  }
  return Object.freeze({
    productLabel: normalizeRequiredText(
      input.productLabel,
      "INVALID_PRODUCT_LABEL",
    ),
    surfaceModelLabel: normalizeOptionalText(input.surfaceModelLabel, 120),
    searchMode: input.searchMode,
    isNewConversation: input.isNewConversation,
    isLoggedIn: input.isLoggedIn,
    memoryEnabled: input.memoryEnabled,
    personalizationEnabled: input.personalizationEnabled,
    locale: normalizeRequiredText(input.locale, "INVALID_LOCALE"),
    region: normalizeOptionalText(input.region, 120),
    observedAt: normalizeTimestamp(input.observedAt),
  });
}

export function normalizeConsumerVisibleSearchTrace(
  input: ConsumerVisibleSearchTraceInput,
): ConsumerVisibleSearchTrace {
  if (
    input.status !== "complete" &&
    input.status !== "partial" &&
    input.status !== "not_present"
  ) {
    throw new Error("INVALID_VISIBLE_SEARCH_TRACE_STATUS");
  }
  const summaryText = normalizeOptionalText(input.summaryText, 500);
  const declaredKeywordCount = normalizeOptionalCount(
    input.declaredKeywordCount,
    "INVALID_VISIBLE_SEARCH_DECLARED_KEYWORD_COUNT",
  );
  const declaredReferenceCount = normalizeOptionalCount(
    input.declaredReferenceCount,
    "INVALID_VISIBLE_SEARCH_DECLARED_REFERENCE_COUNT",
  );
  const positions = new Set<number>();
  const keywords = [...(input.keywords ?? [])].map((keyword) => {
    if (!Number.isInteger(keyword.position) || keyword.position < 1) {
      throw new Error("INVALID_VISIBLE_SEARCH_KEYWORD_POSITION");
    }
    if (positions.has(keyword.position)) {
      throw new Error("DUPLICATE_VISIBLE_SEARCH_KEYWORD_POSITION");
    }
    positions.add(keyword.position);
    const text = normalizeRequiredText(
      keyword.text,
      "INVALID_VISIBLE_SEARCH_KEYWORD_TEXT",
    );
    if (text.length > 500) {
      throw new Error("VISIBLE_SEARCH_KEYWORD_TEXT_TOO_LONG");
    }
    return Object.freeze({ position: keyword.position, text });
  });
  if (keywords.length > 100) {
    throw new Error("TOO_MANY_VISIBLE_SEARCH_KEYWORDS");
  }
  keywords.sort((left, right) => left.position - right.position);
  for (const [index, keyword] of keywords.entries()) {
    if (keyword.position !== index + 1) {
      throw new Error("VISIBLE_SEARCH_KEYWORD_POSITIONS_NOT_CONTIGUOUS");
    }
  }

  if (input.status === "not_present") {
    if (
      summaryText !== null ||
      declaredKeywordCount !== null ||
      declaredReferenceCount !== null ||
      keywords.length > 0
    ) {
      throw new Error("VISIBLE_SEARCH_NOT_PRESENT_MUST_BE_EMPTY");
    }
  } else if (summaryText === null || declaredKeywordCount === null) {
    throw new Error("VISIBLE_SEARCH_TRACE_SUMMARY_REQUIRED");
  }
  if (input.status === "complete" && declaredKeywordCount !== keywords.length) {
    throw new Error("VISIBLE_SEARCH_COMPLETE_KEYWORD_COUNT_MISMATCH");
  }

  return Object.freeze({
    status: input.status,
    summaryText,
    declaredKeywordCount,
    keywords: Object.freeze(keywords),
    declaredReferenceCount,
  });
}

export function normalizeRequiredText(
  value: string,
  errorCode: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

export function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new Error("OPTIONAL_TEXT_TOO_LONG");
  }
  return normalized;
}

export function normalizeTimestamp(value: string): string {
  const normalized = normalizeRequiredText(value, "INVALID_TIMESTAMP");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return normalized;
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeHttpUrl(value: string): string {
  const normalized = normalizeRequiredText(
    value,
    "INVALID_VISIBLE_CITATION_URL",
  );
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("INVALID_VISIBLE_CITATION_URL");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("INVALID_VISIBLE_CITATION_URL");
  }
  return normalized;
}

function normalizeOptionalCount(
  value: number | null | undefined,
  errorCode: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(errorCode);
  }
  return value;
}
