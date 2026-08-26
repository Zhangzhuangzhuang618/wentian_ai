import { createHash } from "node:crypto";

export const QUERY_INTENT_CODES = [
  "brand_recognition",
  "exploration",
  "recommendation",
  "comparison",
  "education",
  "procurement",
] as const;

export const COMMERCIAL_VALUES = ["low", "medium", "high"] as const;
export const QUERY_SET_SOURCE_TYPES = [
  "local",
  "geo_sync",
  "imported",
] as const;

export type QueryIntentCode = (typeof QUERY_INTENT_CODES)[number];
export type CommercialValue = (typeof COMMERCIAL_VALUES)[number];
export type QuerySetSourceType = (typeof QUERY_SET_SOURCE_TYPES)[number];

export interface QuerySetQueryInput {
  readonly externalKey?: string;
  readonly queryText: string;
  readonly intentCode: QueryIntentCode;
  readonly commercialValue: CommercialValue;
}

export interface QuerySetSnapshotSource {
  readonly type: QuerySetSourceType;
  readonly ref?: string | null;
  readonly revision?: string | null;
  readonly geoBindingId?: string | null;
  readonly contractVersion?: string | null;
}

export interface QuerySetSnapshotItem {
  readonly id: string;
  readonly ordinal: number;
  readonly externalKey: string;
  readonly queryText: string;
  readonly intentCode: QueryIntentCode;
  readonly commercialValue: CommercialValue;
  readonly itemHash: string;
}

export interface QuerySetSnapshot {
  readonly id: string;
  readonly scopeId: string;
  readonly title: string;
  readonly locale: string;
  readonly market: string | null;
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly source: QuerySetSnapshotSource;
  readonly snapshotHash: string;
  readonly queryCount: number;
  readonly items: readonly QuerySetSnapshotItem[];
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateQuerySetSnapshotInput {
  readonly id: string;
  readonly itemIds: readonly string[];
  readonly scopeId: string;
  readonly title: string;
  readonly locale: string;
  readonly market?: string | null;
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly source: QuerySetSnapshotSource;
  readonly queries: readonly QuerySetQueryInput[];
  readonly createdBy: string;
  readonly createdAt: string;
}

export function createQuerySetSnapshot(
  input: CreateQuerySetSnapshotInput,
): QuerySetSnapshot {
  if (input.queries.length < 1 || input.queries.length > 100) {
    throw new Error("INVALID_QUERY_COUNT");
  }
  if (input.itemIds.length !== input.queries.length) {
    throw new Error("QUERY_ITEM_ID_COUNT_MISMATCH");
  }

  const title = normalizeRequiredText(input.title, "INVALID_SNAPSHOT_TITLE");
  const locale = normalizeRequiredText(input.locale, "INVALID_LOCALE");
  const market = normalizeOptionalText(input.market);
  const hasBusinessMetadata =
    input.industry !== undefined || input.region !== undefined;
  const industry = normalizeOptionalBusinessLabel(
    input.industry,
    "INVALID_INDUSTRY",
  );
  const region = normalizeOptionalBusinessLabel(input.region, "INVALID_REGION");
  const source = normalizeSource(input.source);
  const externalKeys = new Set<string>();

  const normalizedQueries = input.queries.map((query, index) => {
    const ordinal = index + 1;
    const externalKey =
      normalizeOptionalText(query.externalKey) ?? toQueryKey(ordinal);
    if (externalKeys.has(externalKey)) {
      throw new Error("DUPLICATE_QUERY_EXTERNAL_KEY");
    }
    externalKeys.add(externalKey);

    const normalizedQuery = {
      queryText: normalizeRequiredText(query.queryText, "INVALID_QUERY_TEXT"),
      intentCode: query.intentCode,
      commercialValue: query.commercialValue,
    } as const;

    return Object.freeze({
      id: normalizeRequiredText(input.itemIds[index]!, "INVALID_QUERY_ITEM_ID"),
      ordinal,
      externalKey,
      ...normalizedQuery,
      itemHash: sha256(stableJson(normalizedQuery)),
    });
  });

  const snapshotHash = sha256(
    stableJson({
      title,
      locale,
      market,
      ...(hasBusinessMetadata ? { industry, region } : {}),
      queries: normalizedQueries.map((query) => ({
        queryText: query.queryText,
        intentCode: query.intentCode,
        commercialValue: query.commercialValue,
      })),
    }),
  );

  return Object.freeze({
    id: normalizeRequiredText(input.id, "INVALID_SNAPSHOT_ID"),
    scopeId: normalizeRequiredText(input.scopeId, "INVALID_SCOPE_ID"),
    title,
    locale,
    market,
    ...(hasBusinessMetadata ? { industry, region } : {}),
    source,
    snapshotHash,
    queryCount: normalizedQueries.length,
    items: Object.freeze(normalizedQueries),
    createdBy: normalizeRequiredText(input.createdBy, "INVALID_CREATED_BY"),
    createdAt: normalizeRequiredText(input.createdAt, "INVALID_CREATED_AT"),
  });
}

function normalizeSource(
  source: QuerySetSnapshotSource,
): QuerySetSnapshotSource {
  const normalized = {
    type: source.type,
    ref: normalizeOptionalText(source.ref),
    revision: normalizeOptionalText(source.revision),
    geoBindingId: normalizeOptionalText(source.geoBindingId),
    contractVersion: normalizeOptionalText(source.contractVersion),
  } as const;

  if (normalized.type === "geo_sync") {
    if (!normalized.geoBindingId || !normalized.contractVersion) {
      throw new Error("GEO_SOURCE_METADATA_REQUIRED");
    }
  } else if (normalized.geoBindingId || normalized.contractVersion) {
    throw new Error("GEO_SOURCE_METADATA_FORBIDDEN");
  }

  return Object.freeze(normalized);
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeOptionalBusinessLabel(
  value: string | null | undefined,
  errorCode: string,
): string | null {
  const normalized = normalizeOptionalText(value);
  if (normalized !== null && normalized.length > 80) {
    throw new Error(errorCode);
  }
  return normalized;
}

function toQueryKey(ordinal: number): string {
  return `q${String(ordinal).padStart(3, "0")}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
