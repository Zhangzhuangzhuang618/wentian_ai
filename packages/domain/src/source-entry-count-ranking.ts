export const SOURCE_ENTRY_COUNT_RANKING_METHODOLOGY_VERSION =
  "source-entry-count-ranking@1" as const;

export type SourceEntryRole = "nominated" | "cited";

export interface SourceEntryForRanking {
  readonly entryId: string;
  readonly querySnapshotItemId: string;
  readonly role: SourceEntryRole;
  readonly registrableDomain: string;
}

export interface RankSourceEntriesInput {
  readonly querySnapshotItemId: string;
  readonly role: SourceEntryRole;
  readonly entries: readonly SourceEntryForRanking[];
}

export interface RankedSourceDomain {
  readonly rank: number;
  readonly registrableDomain: string;
  readonly entryCount: number;
}

export interface SourceEntryCountRanking {
  readonly methodologyVersion: typeof SOURCE_ENTRY_COUNT_RANKING_METHODOLOGY_VERSION;
  readonly querySnapshotItemId: string;
  readonly role: SourceEntryRole;
  readonly totalEntryCount: number;
  readonly domains: readonly RankedSourceDomain[];
}

export function rankSourceEntriesByDomain(
  input: RankSourceEntriesInput,
): SourceEntryCountRanking {
  const querySnapshotItemId = normalizeRequiredText(
    input.querySnapshotItemId,
    "INVALID_RANKING_QUERY_SNAPSHOT_ITEM_ID",
  );
  const role = normalizeRole(input.role);
  if (!Array.isArray(input.entries)) {
    throw new Error("INVALID_SOURCE_RANKING_ENTRIES");
  }

  const entryIds = new Set<string>();
  const counts = new Map<string, number>();
  for (const entry of input.entries) {
    const entryId = normalizeRequiredText(
      entry.entryId,
      "INVALID_SOURCE_RANKING_ENTRY_ID",
    );
    if (entryIds.has(entryId)) {
      throw new Error("DUPLICATE_SOURCE_RANKING_ENTRY_ID");
    }
    entryIds.add(entryId);
    if (
      normalizeRequiredText(
        entry.querySnapshotItemId,
        "INVALID_SOURCE_RANKING_ENTRY_QUERY_SNAPSHOT_ITEM_ID",
      ) !== querySnapshotItemId
    ) {
      throw new Error("SOURCE_RANKING_QUERY_MISMATCH");
    }
    if (normalizeRole(entry.role) !== role) {
      throw new Error("SOURCE_RANKING_ROLE_MISMATCH");
    }
    const registrableDomain = normalizeDomain(entry.registrableDomain);
    counts.set(registrableDomain, (counts.get(registrableDomain) ?? 0) + 1);
  }

  const domains = Object.freeze(
    [...counts.entries()]
      .sort(
        ([leftDomain, leftCount], [rightDomain, rightCount]) =>
          rightCount - leftCount || compareDomains(leftDomain, rightDomain),
      )
      .map(([registrableDomain, entryCount], index) =>
        Object.freeze({
          rank: index + 1,
          registrableDomain,
          entryCount,
        }),
      ),
  );

  return Object.freeze({
    methodologyVersion: SOURCE_ENTRY_COUNT_RANKING_METHODOLOGY_VERSION,
    querySnapshotItemId,
    role,
    totalEntryCount: input.entries.length,
    domains,
  });
}

function compareDomains(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRole(value: SourceEntryRole): SourceEntryRole {
  if (value !== "nominated" && value !== "cited") {
    throw new Error("INVALID_SOURCE_RANKING_ROLE");
  }
  return value;
}

function normalizeDomain(value: string): string {
  const normalized = normalizeRequiredText(
    value,
    "INVALID_SOURCE_RANKING_REGISTRABLE_DOMAIN",
  )
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    normalized.includes("://") ||
    normalized.includes("/") ||
    /\s/u.test(normalized)
  ) {
    throw new Error("INVALID_SOURCE_RANKING_REGISTRABLE_DOMAIN");
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
