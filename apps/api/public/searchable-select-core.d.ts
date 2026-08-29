export const SEARCHABLE_SELECT_RESULT_LIMIT: 80;

export interface SearchableOptionDescription {
  readonly primary: string;
  readonly meta: string;
  readonly searchText: string;
}

export interface SearchableOption extends SearchableOptionDescription {
  readonly value: string;
  readonly label: string;
}

export interface SearchableOptionResult {
  readonly items: readonly SearchableOption[];
  readonly matchedCount: number;
  readonly totalCount: number;
  readonly truncated: boolean;
}

export function describeSearchableLabel(
  label: string,
  primaryParts?: number,
): SearchableOptionDescription;

export function filterSearchableOptions(
  options: readonly SearchableOption[],
  query: string,
  limit?: number,
): SearchableOptionResult;
