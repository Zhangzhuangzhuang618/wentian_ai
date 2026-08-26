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
