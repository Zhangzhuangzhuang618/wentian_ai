import {
  deriveConsumerNominationContext,
  type ConsumerObservationRun,
  type ConsumerObservationRunStatus,
} from "./consumer-observation-run.ts";
import type { ConsumerSessionConditions } from "./consumer-observation.ts";

export const PAIRED_CONSUMER_RUN_COMPARABILITY_METHODOLOGY_VERSION =
  "paired-consumer-run-comparability@1" as const;

export const MAX_PAIRED_RUN_START_GAP_SECONDS = 24 * 60 * 60;

export const PAIRED_RUN_NOT_COMPARABLE_REASONS = [
  "RUN_EXPERIMENT_KIND_MISMATCH",
  "RUN_PAIR_LINK_MISMATCH",
  "RUN_SCOPE_MISMATCH",
  "RUN_CONFIGURATION_MISMATCH",
  "RUN_EFFECTIVE_NOMINATION_CONTEXT_MISMATCH",
  "RUN_NOT_TERMINAL",
  "RUN_TIMESTAMPS_INCOMPLETE",
  "RUN_START_GAP_EXCEEDED",
] as const;

export type PairedRunNotComparableReason =
  (typeof PAIRED_RUN_NOT_COMPARABLE_REASONS)[number];

export interface AssessPairedConsumerRunComparabilityInput {
  readonly naturalAnswerRun: ConsumerObservationRun;
  readonly sourceNominationRun: ConsumerObservationRun;
}

export interface PairedConsumerRunComparabilityReport {
  readonly methodologyVersion: typeof PAIRED_CONSUMER_RUN_COMPARABILITY_METHODOLOGY_VERSION;
  readonly naturalAnswerRunId: string;
  readonly sourceNominationRunId: string;
  readonly status: "comparable" | "not_comparable";
  readonly maxStartGapSeconds: typeof MAX_PAIRED_RUN_START_GAP_SECONDS;
  readonly startGapSeconds: number | null;
  readonly reasons: readonly PairedRunNotComparableReason[];
}

export function assessPairedConsumerRunComparability(
  input: AssessPairedConsumerRunComparabilityInput,
): PairedConsumerRunComparabilityReport {
  const natural = input.naturalAnswerRun;
  const nomination = input.sourceNominationRun;
  const reasons: PairedRunNotComparableReason[] = [];

  if (
    natural.experimentKind !== "natural_answer" ||
    nomination.experimentKind !== "source_nomination"
  ) {
    reasons.push("RUN_EXPERIMENT_KIND_MISMATCH");
  }
  if (nomination.pairedRunId !== natural.id) {
    reasons.push("RUN_PAIR_LINK_MISMATCH");
  }
  if (nomination.scopeId !== natural.scopeId) {
    reasons.push("RUN_SCOPE_MISMATCH");
  }
  if (!sameConfiguration(natural, nomination)) {
    reasons.push("RUN_CONFIGURATION_MISMATCH");
  }
  if (!sameEffectiveNominationContext(natural, nomination)) {
    reasons.push("RUN_EFFECTIVE_NOMINATION_CONTEXT_MISMATCH");
  }
  if (!isTerminal(natural.status) || !isTerminal(nomination.status)) {
    reasons.push("RUN_NOT_TERMINAL");
  }

  const naturalStartedAt = parseTimestamp(natural.startedAt);
  const nominationStartedAt = parseTimestamp(nomination.startedAt);
  const naturalCompletedAt = parseTimestamp(natural.completedAt);
  const nominationCompletedAt = parseTimestamp(nomination.completedAt);
  let startGapSeconds: number | null = null;
  if (
    naturalStartedAt === null ||
    nominationStartedAt === null ||
    naturalCompletedAt === null ||
    nominationCompletedAt === null
  ) {
    reasons.push("RUN_TIMESTAMPS_INCOMPLETE");
  } else {
    startGapSeconds = Math.abs(naturalStartedAt - nominationStartedAt) / 1_000;
    if (startGapSeconds > MAX_PAIRED_RUN_START_GAP_SECONDS) {
      reasons.push("RUN_START_GAP_EXCEEDED");
    }
  }

  return Object.freeze({
    methodologyVersion: PAIRED_CONSUMER_RUN_COMPARABILITY_METHODOLOGY_VERSION,
    naturalAnswerRunId: normalizeRequiredText(natural.id),
    sourceNominationRunId: normalizeRequiredText(nomination.id),
    status: reasons.length === 0 ? "comparable" : "not_comparable",
    maxStartGapSeconds: MAX_PAIRED_RUN_START_GAP_SECONDS,
    startGapSeconds,
    reasons: Object.freeze(reasons),
  });
}

function sameConfiguration(
  natural: ConsumerObservationRun,
  nomination: ConsumerObservationRun,
): boolean {
  return (
    natural.querySetSnapshotId === nomination.querySetSnapshotId &&
    natural.querySetSnapshotHash === nomination.querySetSnapshotHash &&
    natural.queryCount === nomination.queryCount &&
    natural.surfaceProfileVersionId === nomination.surfaceProfileVersionId &&
    natural.collectionMethod === nomination.collectionMethod &&
    natural.requestedSampleCount === nomination.requestedSampleCount &&
    natural.plannedSampleCount === nomination.plannedSampleCount &&
    sameSessionConditions(
      natural.sessionConditions,
      nomination.sessionConditions,
    )
  );
}

function sameEffectiveNominationContext(
  natural: ConsumerObservationRun,
  nomination: ConsumerObservationRun,
): boolean {
  if (nomination.experimentKind !== "source_nomination") {
    return false;
  }
  const naturalEffectiveContext = deriveConsumerNominationContext(
    "source_nomination",
    natural.sessionConditions.searchMode,
  );
  return nomination.nominationContext === naturalEffectiveContext;
}

function sameSessionConditions(
  left: ConsumerSessionConditions,
  right: ConsumerSessionConditions,
): boolean {
  return (
    left.searchMode === right.searchMode &&
    left.isNewConversation === right.isNewConversation &&
    left.isLoggedIn === right.isLoggedIn &&
    left.memoryEnabled === right.memoryEnabled &&
    left.personalizationEnabled === right.personalizationEnabled &&
    left.locale === right.locale &&
    left.region === right.region
  );
}

function isTerminal(status: ConsumerObservationRunStatus): boolean {
  return (
    status === "succeeded" ||
    status === "partial" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function parseTimestamp(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
}

function normalizeRequiredText(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("INVALID_PAIRED_RUN_ID");
  }
  return value.trim();
}
