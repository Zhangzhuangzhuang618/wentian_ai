export const SEARCHABLE_SELECT_RESULT_LIMIT = 80;

export function describeSearchableLabel(label, primaryParts = 1) {
  const normalizedLabel = String(label ?? "").trim();
  const parts = normalizedLabel
    .split(/\s+·\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const safePrimaryParts = Math.max(
    1,
    Math.min(Number(primaryParts) || 1, Math.max(parts.length, 1)),
  );
  return Object.freeze({
    primary: parts.slice(0, safePrimaryParts).join(" · ") || normalizedLabel,
    meta: parts.slice(safePrimaryParts).join(" · "),
    searchText: normalizeSearchableText(normalizedLabel),
  });
}

export function filterSearchableOptions(
  options,
  query,
  limit = SEARCHABLE_SELECT_RESULT_LIMIT,
) {
  const tokens = normalizeSearchableText(query).split(" ").filter(Boolean);
  const matched = options.filter((option) =>
    tokens.every((token) => option.searchText.includes(token)),
  );
  return Object.freeze({
    items: Object.freeze(matched.slice(0, limit)),
    matchedCount: matched.length,
    totalCount: options.length,
    truncated: matched.length > limit,
  });
}

function normalizeSearchableText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, " ")
    .trim();
}
