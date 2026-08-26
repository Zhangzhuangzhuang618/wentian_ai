import { z } from "zod";

import {
  adaptNominationCitationOverlapReportToResponse,
  nominationCitationOverlapResponseSchema,
  type NominationCitationOverlapReportLike,
} from "./nomination-citation-overlap.ts";

export const CONSUMER_NOMINATION_CITATION_COMPARISON_CONTRACT_VERSION =
  "wentian-consumer-nomination-citation-comparison@0-draft" as const;

const notComparableReasonSchema = z.enum([
  "RUN_EXPERIMENT_KIND_MISMATCH",
  "RUN_PAIR_LINK_MISMATCH",
  "RUN_SCOPE_MISMATCH",
  "RUN_CONFIGURATION_MISMATCH",
  "RUN_EFFECTIVE_NOMINATION_CONTEXT_MISMATCH",
  "RUN_NOT_TERMINAL",
  "RUN_TIMESTAMPS_INCOMPLETE",
  "RUN_START_GAP_EXCEEDED",
]);

const questionUnavailableReasonSchema = z.enum([
  "NO_CONFIRMED_CITATION_SAMPLES",
  "NO_VALIDATED_NOMINATION_SAMPLES",
]);

const rankedDomainSchema = z
  .object({
    rank: z.number().int().positive(),
    registrable_domain: z.string().trim().min(1).max(253),
    entry_count: z.number().int().positive(),
  })
  .strict();

const sourceEntryCountRankingSchema = z
  .object({
    methodology_version: z.literal("source-entry-count-ranking@1"),
    query_snapshot_item_id: z.uuid(),
    role: z.enum(["nominated", "cited"]),
    total_entry_count: z.number().int().nonnegative(),
    domains: z.array(rankedDomainSchema).max(1_000),
  })
  .strict()
  .superRefine((ranking, context) => {
    const expected = [...ranking.domains].sort(
      (left, right) =>
        right.entry_count - left.entry_count ||
        compareDomains(left.registrable_domain, right.registrable_domain),
    );
    const total = ranking.domains.reduce(
      (sum, domain) => sum + domain.entry_count,
      0,
    );
    if (
      total !== ranking.total_entry_count ||
      new Set(ranking.domains.map((domain) => domain.registrable_domain))
        .size !== ranking.domains.length ||
      ranking.domains.some(
        (domain, index) =>
          domain.rank !== index + 1 ||
          domain !== expected[index] ||
          !isNormalizedDomain(domain.registrable_domain),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["domains"],
        message: "SOURCE_ENTRY_COUNT_RANKING_NOT_RECOMPUTABLE",
      });
    }
  });

const comparabilitySchema = z
  .object({
    methodology_version: z.literal("paired-consumer-run-comparability@1"),
    natural_answer_run_id: z.uuid(),
    source_nomination_run_id: z.uuid(),
    status: z.enum(["comparable", "not_comparable"]),
    max_start_gap_seconds: z.literal(86_400),
    start_gap_seconds: z.number().nonnegative().nullable(),
    reasons: z.array(notComparableReasonSchema).max(8),
  })
  .strict()
  .superRefine((report, context) => {
    const uniqueReasons = new Set(report.reasons);
    const validComparable =
      report.status === "comparable" &&
      report.reasons.length === 0 &&
      report.start_gap_seconds !== null &&
      report.start_gap_seconds <= report.max_start_gap_seconds;
    const validNotComparable =
      report.status === "not_comparable" && report.reasons.length > 0;
    const startGapReasonMatches =
      report.start_gap_seconds === null
        ? report.reasons.includes("RUN_TIMESTAMPS_INCOMPLETE")
        : report.reasons.includes("RUN_START_GAP_EXCEEDED") ===
          report.start_gap_seconds > report.max_start_gap_seconds;
    if (
      uniqueReasons.size !== report.reasons.length ||
      (!validComparable && !validNotComparable) ||
      !startGapReasonMatches
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "PAIRED_RUN_COMPARABILITY_NOT_RECOMPUTABLE",
      });
    }
  });

const questionComparisonSchema = z
  .object({
    query_snapshot_item_id: z.uuid(),
    availability: z.enum(["available", "not_available"]),
    unavailable_reasons: z.array(questionUnavailableReasonSchema).max(2),
    citation_confirmed_sample_count: z.number().int().nonnegative(),
    nomination_validated_sample_count: z.number().int().nonnegative(),
    citation_ranking: sourceEntryCountRankingSchema,
    nomination_ranking: sourceEntryCountRankingSchema,
    overlap: nominationCitationOverlapResponseSchema.nullable(),
  })
  .strict()
  .superRefine((question, context) => {
    const expectedReasons = [
      ...(question.citation_confirmed_sample_count === 0
        ? (["NO_CONFIRMED_CITATION_SAMPLES"] as const)
        : []),
      ...(question.nomination_validated_sample_count === 0
        ? (["NO_VALIDATED_NOMINATION_SAMPLES"] as const)
        : []),
    ];
    const expectedAvailable = expectedReasons.length === 0;
    const rankingsMatch =
      question.citation_ranking.query_snapshot_item_id ===
        question.query_snapshot_item_id &&
      question.citation_ranking.role === "cited" &&
      question.nomination_ranking.query_snapshot_item_id ===
        question.query_snapshot_item_id &&
      question.nomination_ranking.role === "nominated";
    const overlapMatches =
      question.overlap === null ||
      (question.overlap.query_snapshot_item_id ===
        question.query_snapshot_item_id &&
        sameValues(
          question.overlap.citation_top_k_domains,
          question.citation_ranking.domains
            .slice(0, question.overlap.k)
            .map((domain) => domain.registrable_domain),
        ) &&
        sameValues(
          question.overlap.nomination_top_k_domains,
          question.nomination_ranking.domains
            .slice(0, question.overlap.k)
            .map((domain) => domain.registrable_domain),
        ));
    if (
      question.availability !==
        (expectedAvailable ? "available" : "not_available") ||
      !sameValues(question.unavailable_reasons, expectedReasons) ||
      expectedAvailable !== (question.overlap !== null) ||
      !rankingsMatch ||
      !overlapMatches
    ) {
      context.addIssue({
        code: "custom",
        path: ["availability"],
        message: "QUESTION_COMPARISON_NOT_RECOMPUTABLE",
      });
    }
  });

export const consumerNominationCitationComparisonResponseSchema = z
  .object({
    contract_version: z.literal(
      CONSUMER_NOMINATION_CITATION_COMPARISON_CONTRACT_VERSION,
    ),
    methodology_version: z.literal("consumer-nomination-citation-comparison@1"),
    scope_id: z.uuid(),
    natural_answer_run_id: z.uuid(),
    source_nomination_run_id: z.uuid(),
    k: z.number().int().min(1).max(10),
    comparability: comparabilitySchema,
    questions: z.array(questionComparisonSchema).max(100),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.comparability.natural_answer_run_id !==
        report.natural_answer_run_id ||
      report.comparability.source_nomination_run_id !==
        report.source_nomination_run_id ||
      (report.comparability.status === "not_comparable" &&
        report.questions.length > 0) ||
      (report.comparability.status === "comparable" &&
        report.questions.length === 0) ||
      new Set(
        report.questions.map((question) => question.query_snapshot_item_id),
      ).size !== report.questions.length ||
      report.questions.some(
        (question) => question.overlap && question.overlap.k !== report.k,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "COMPARISON_REPORT_BINDING_MISMATCH",
      });
    }
  });

export type ConsumerNominationCitationComparisonResponseDto = z.infer<
  typeof consumerNominationCitationComparisonResponseSchema
>;

interface SourceEntryCountRankingLike {
  readonly methodologyVersion: "source-entry-count-ranking@1";
  readonly querySnapshotItemId: string;
  readonly role: "nominated" | "cited";
  readonly totalEntryCount: number;
  readonly domains: readonly {
    readonly rank: number;
    readonly registrableDomain: string;
    readonly entryCount: number;
  }[];
}

export interface ConsumerNominationCitationComparisonReportLike {
  readonly methodologyVersion: "consumer-nomination-citation-comparison@1";
  readonly scopeId: string;
  readonly naturalAnswerRunId: string;
  readonly sourceNominationRunId: string;
  readonly k: number;
  readonly comparability: {
    readonly methodologyVersion: "paired-consumer-run-comparability@1";
    readonly naturalAnswerRunId: string;
    readonly sourceNominationRunId: string;
    readonly status: "comparable" | "not_comparable";
    readonly maxStartGapSeconds: number;
    readonly startGapSeconds: number | null;
    readonly reasons: readonly z.infer<typeof notComparableReasonSchema>[];
  };
  readonly questions: readonly {
    readonly querySnapshotItemId: string;
    readonly availability: "available" | "not_available";
    readonly unavailableReasons: readonly z.infer<
      typeof questionUnavailableReasonSchema
    >[];
    readonly citationConfirmedSampleCount: number;
    readonly nominationValidatedSampleCount: number;
    readonly citationRanking: SourceEntryCountRankingLike;
    readonly nominationRanking: SourceEntryCountRankingLike;
    readonly overlap: NominationCitationOverlapReportLike | null;
  }[];
}

export function adaptConsumerNominationCitationComparisonToResponse(
  report: ConsumerNominationCitationComparisonReportLike,
): ConsumerNominationCitationComparisonResponseDto {
  return consumerNominationCitationComparisonResponseSchema.parse({
    contract_version: CONSUMER_NOMINATION_CITATION_COMPARISON_CONTRACT_VERSION,
    methodology_version: report.methodologyVersion,
    scope_id: report.scopeId,
    natural_answer_run_id: report.naturalAnswerRunId,
    source_nomination_run_id: report.sourceNominationRunId,
    k: report.k,
    comparability: {
      methodology_version: report.comparability.methodologyVersion,
      natural_answer_run_id: report.comparability.naturalAnswerRunId,
      source_nomination_run_id: report.comparability.sourceNominationRunId,
      status: report.comparability.status,
      max_start_gap_seconds: report.comparability.maxStartGapSeconds,
      start_gap_seconds: report.comparability.startGapSeconds,
      reasons: report.comparability.reasons,
    },
    questions: report.questions.map((question) => ({
      query_snapshot_item_id: question.querySnapshotItemId,
      availability: question.availability,
      unavailable_reasons: question.unavailableReasons,
      citation_confirmed_sample_count: question.citationConfirmedSampleCount,
      nomination_validated_sample_count:
        question.nominationValidatedSampleCount,
      citation_ranking: adaptRanking(question.citationRanking),
      nomination_ranking: adaptRanking(question.nominationRanking),
      overlap:
        question.overlap === null
          ? null
          : adaptNominationCitationOverlapReportToResponse(question.overlap),
    })),
  });
}

function adaptRanking(ranking: SourceEntryCountRankingLike) {
  return {
    methodology_version: ranking.methodologyVersion,
    query_snapshot_item_id: ranking.querySnapshotItemId,
    role: ranking.role,
    total_entry_count: ranking.totalEntryCount,
    domains: ranking.domains.map((domain) => ({
      rank: domain.rank,
      registrable_domain: domain.registrableDomain,
      entry_count: domain.entryCount,
    })),
  };
}

function isNormalizedDomain(value: string): boolean {
  return (
    value === value.trim().toLowerCase() &&
    !value.endsWith(".") &&
    !value.includes("://") &&
    !value.includes("/") &&
    !/\s/u.test(value)
  );
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function compareDomains(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
