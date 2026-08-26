export const RETRIEVAL_MODES = [
  "model_only",
  "search_api",
  "web_observed",
  "imported",
] as const;

export const EXECUTION_TARGET_TYPES = [
  "provider",
  "consumer_surface",
  "external_dataset",
] as const;

export const COLLECTION_METHODS = [
  "provider_api",
  "browser_assisted",
  "manual_import",
] as const;

export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];
export type ExecutionTargetType = (typeof EXECUTION_TARGET_TYPES)[number];
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

export interface RunModeCombination {
  readonly retrievalMode: RetrievalMode;
  readonly executionTargetType: ExecutionTargetType;
  readonly collectionMethod: CollectionMethod;
}

export const RUN_MODE_COMBINATIONS = [
  {
    retrievalMode: "model_only",
    executionTargetType: "provider",
    collectionMethod: "provider_api",
  },
  {
    retrievalMode: "search_api",
    executionTargetType: "provider",
    collectionMethod: "provider_api",
  },
  {
    retrievalMode: "web_observed",
    executionTargetType: "consumer_surface",
    collectionMethod: "browser_assisted",
  },
  {
    retrievalMode: "web_observed",
    executionTargetType: "consumer_surface",
    collectionMethod: "manual_import",
  },
  {
    retrievalMode: "imported",
    executionTargetType: "external_dataset",
    collectionMethod: "manual_import",
  },
] as const satisfies readonly RunModeCombination[];

const allowedCombinationKeys = new Set(
  RUN_MODE_COMBINATIONS.map(toRunModeCombinationKey),
);

export function isValidRunModeCombination(
  combination: RunModeCombination,
): boolean {
  return allowedCombinationKeys.has(toRunModeCombinationKey(combination));
}

export function assertValidRunModeCombination(
  combination: RunModeCombination,
): void {
  if (!isValidRunModeCombination(combination)) {
    throw new Error("INVALID_RUN_MODE_COMBINATION");
  }
}

function toRunModeCombinationKey(combination: RunModeCombination): string {
  return [
    combination.retrievalMode,
    combination.executionTargetType,
    combination.collectionMethod,
  ].join(":");
}
