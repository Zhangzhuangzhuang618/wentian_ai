import { z } from "zod";

export const SOURCE_NOMINATION_METRICS_CONTRACT_VERSION =
  "wentian-source-nomination-metrics@0-draft" as const;

const availableNominationRatioSchema = z
  .object({
    availability: z.literal("available"),
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
    value: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((ratio, context) => {
    if (
      ratio.numerator > ratio.denominator ||
      !approximatelyEqual(ratio.value, ratio.numerator / ratio.denominator)
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "NOMINATION_RATIO_NOT_RECOMPUTABLE",
      });
    }
  });

const unavailableFirstNominationRateSchema = z
  .object({
    availability: z.literal("not_available"),
    numerator: z.null(),
    denominator: z.null(),
    value: z.null(),
    reason: z.literal("NO_VALID_NOMINATION_ORDER"),
  })
  .strict();

const firstNominationRateSchema = z.discriminatedUnion("availability", [
  availableNominationRatioSchema,
  unavailableFirstNominationRateSchema,
]);

const sourceNominationDomainMetricSchema = z
  .object({
    registrable_domain: z.string().trim().min(1).max(253),
    nomination_rate: availableNominationRatioSchema,
    first_nomination_rate: firstNominationRateSchema,
    nomination_share: availableNominationRatioSchema,
  })
  .strict();

const sourceNominationQuestionStabilitySchema = z
  .object({
    query_snapshot_item_id: z.uuid(),
    value: z.number().min(0).max(1),
    pair_count: z.number().int().positive(),
    no_nomination_pair_count: z.number().int().nonnegative(),
  })
  .strict();

const availableSourceNominationStabilitySchema = z
  .object({
    availability: z.literal("available"),
    value: z.number().min(0).max(1),
    question_count: z.number().int().positive(),
    pair_count: z.number().int().positive(),
    no_nomination_pair_count: z.number().int().nonnegative(),
    questions: z.array(sourceNominationQuestionStabilitySchema).min(1),
  })
  .strict()
  .superRefine((stability, context) => {
    if (
      stability.question_count !== stability.questions.length ||
      stability.pair_count !==
        stability.questions.reduce(
          (sum, question) => sum + question.pair_count,
          0,
        ) ||
      stability.no_nomination_pair_count <
        stability.questions.reduce(
          (sum, question) => sum + question.no_nomination_pair_count,
          0,
        ) ||
      !approximatelyEqual(
        stability.value,
        stability.questions.reduce((sum, question) => sum + question.value, 0) /
          stability.questions.length,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "NOMINATION_STABILITY_NOT_RECOMPUTABLE",
      });
    }
  });

const unavailableSourceNominationStabilitySchema = z
  .object({
    availability: z.literal("not_available"),
    value: z.null(),
    question_count: z.literal(0),
    pair_count: z.literal(0),
    no_nomination_pair_count: z.number().int().nonnegative(),
    questions: z.array(z.never()).max(0),
    reason: z.enum([
      "INSUFFICIENT_REPEATED_SAMPLES",
      "ALL_SAMPLE_PAIRS_HAVE_NO_NOMINATIONS",
    ]),
  })
  .strict();

const sourceNominationStabilitySchema = z.discriminatedUnion("availability", [
  availableSourceNominationStabilitySchema,
  unavailableSourceNominationStabilitySchema,
]);

const sourceNominationMetricGroupSchema = z
  .object({
    nomination_context: z.enum([
      "unaided",
      "search_assisted",
      "surface_unknown",
    ]),
    validated_sample_count: z.number().int().positive(),
    validation_method_sample_counts: z
      .object({
        schema_validated: z.number().int().nonnegative(),
        human_confirmed: z.number().int().nonnegative(),
      })
      .strict(),
    nomination_event_count: z.number().int().nonnegative(),
    domains: z.array(sourceNominationDomainMetricSchema),
    stability: sourceNominationStabilitySchema,
  })
  .strict()
  .superRefine((group, context) => {
    if (
      group.validation_method_sample_counts.schema_validated +
        group.validation_method_sample_counts.human_confirmed !==
      group.validated_sample_count
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation_method_sample_counts"],
        message: "NOMINATION_VALIDATION_COUNT_MISMATCH",
      });
    }
    const seenDomains = new Set<string>();
    let shareNumerator = 0;
    let orderedDenominator: number | null = null;
    let firstNominationNumerator = 0;
    let firstRateAvailability: "available" | "not_available" | null = null;
    for (const [index, domain] of group.domains.entries()) {
      if (seenDomains.has(domain.registrable_domain)) {
        context.addIssue({
          code: "custom",
          path: ["domains", index, "registrable_domain"],
          message: "DUPLICATE_NOMINATION_DOMAIN",
        });
      }
      seenDomains.add(domain.registrable_domain);
      if (
        domain.nomination_rate.denominator !== group.validated_sample_count ||
        domain.nomination_share.denominator !== group.nomination_event_count
      ) {
        context.addIssue({
          code: "custom",
          path: ["domains", index],
          message: "NOMINATION_GROUP_DENOMINATOR_MISMATCH",
        });
      }
      shareNumerator += domain.nomination_share.numerator;
      firstRateAvailability ??= domain.first_nomination_rate.availability;
      if (domain.first_nomination_rate.availability !== firstRateAvailability) {
        context.addIssue({
          code: "custom",
          path: ["domains", index, "first_nomination_rate"],
          message: "FIRST_NOMINATION_AVAILABILITY_MISMATCH",
        });
      }
      if (domain.first_nomination_rate.availability === "available") {
        orderedDenominator ??= domain.first_nomination_rate.denominator;
        firstNominationNumerator += domain.first_nomination_rate.numerator;
        if (domain.first_nomination_rate.denominator !== orderedDenominator) {
          context.addIssue({
            code: "custom",
            path: ["domains", index, "first_nomination_rate", "denominator"],
            message: "FIRST_NOMINATION_DENOMINATOR_MISMATCH",
          });
        }
      }
    }
    if (
      shareNumerator !== group.nomination_event_count ||
      (group.nomination_event_count === 0 && group.domains.length > 0) ||
      (group.nomination_event_count > 0 && group.domains.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nomination_event_count"],
        message: "NOMINATION_EVENT_COUNT_MISMATCH",
      });
    }
    if (
      orderedDenominator !== null &&
      firstNominationNumerator !== orderedDenominator
    ) {
      context.addIssue({
        code: "custom",
        path: ["domains"],
        message: "FIRST_NOMINATION_COVERAGE_MISMATCH",
      });
    }
  });

const sourceNominationSampleBasisSchema = z
  .object({
    planned: z.number().int().nonnegative(),
    successful: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((basis, context) => {
    if (basis.successful + basis.failed > basis.planned) {
      context.addIssue({
        code: "custom",
        path: ["planned"],
        message: "NOMINATION_SAMPLE_BASIS_EXCEEDS_PLANNED",
      });
    }
  });

export const sourceNominationMetricsResponseSchema = z
  .object({
    contract_version: z.literal(SOURCE_NOMINATION_METRICS_CONTRACT_VERSION),
    methodology_version: z.literal("ai-source-observatory@1"),
    normalization_version: z.string().trim().min(1).max(64),
    scope_id: z.uuid(),
    query_set_snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
    computed_at: z.iso.datetime({ offset: true }),
    sample_basis: sourceNominationSampleBasisSchema,
    availability: z.enum(["available", "not_available"]),
    unavailable_reason: z.literal("NO_VALIDATED_NOMINATION_SAMPLES").nullable(),
    validated_sample_count: z.number().int().nonnegative(),
    excluded_parse_counts: z
      .object({
        needs_review: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
      })
      .strict(),
    groups: z.array(sourceNominationMetricGroupSchema),
    warnings: z.tuple([
      z.literal("SELF_REPORTED_NOMINATION_NOT_OBSERVED_RETRIEVAL_OR_CITATION"),
    ]),
  })
  .strict()
  .superRefine((response, context) => {
    const groupedSampleCount = response.groups.reduce(
      (sum, group) => sum + group.validated_sample_count,
      0,
    );
    if (
      groupedSampleCount !== response.validated_sample_count ||
      response.validated_sample_count +
        response.excluded_parse_counts.needs_review +
        response.excluded_parse_counts.rejected !==
        response.sample_basis.successful
    ) {
      context.addIssue({
        code: "custom",
        path: ["validated_sample_count"],
        message: "NOMINATION_SAMPLE_COVERAGE_MISMATCH",
      });
    }
    const contexts = new Set(
      response.groups.map((group) => group.nomination_context),
    );
    if (contexts.size !== response.groups.length) {
      context.addIssue({
        code: "custom",
        path: ["groups"],
        message: "DUPLICATE_NOMINATION_CONTEXT_GROUP",
      });
    }
    if (
      response.availability === "available" &&
      (response.unavailable_reason !== null || response.groups.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["availability"],
        message: "AVAILABLE_NOMINATION_GROUP_REQUIRED",
      });
    }
    if (
      response.availability === "not_available" &&
      (response.unavailable_reason !== "NO_VALIDATED_NOMINATION_SAMPLES" ||
        response.validated_sample_count !== 0 ||
        response.groups.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["availability"],
        message: "UNAVAILABLE_NOMINATION_STATE_INVALID",
      });
    }
  });

export type SourceNominationMetricsResponseDto = z.infer<
  typeof sourceNominationMetricsResponseSchema
>;

export interface SourceNominationMetricReportLike {
  readonly methodologyVersion: "ai-source-observatory@1";
  readonly normalizationVersion: string;
  readonly scopeId: string;
  readonly querySetSnapshotHash: string;
  readonly computedAt: string;
  readonly sampleBasis: Readonly<{
    planned: number;
    successful: number;
    failed: number;
  }>;
  readonly availability: "available" | "not_available";
  readonly unavailableReason: "NO_VALIDATED_NOMINATION_SAMPLES" | null;
  readonly validatedSampleCount: number;
  readonly excludedParseCounts: Readonly<{
    needsReview: number;
    rejected: number;
  }>;
  readonly groups: readonly {
    readonly nominationContext:
      "unaided" | "search_assisted" | "surface_unknown";
    readonly validatedSampleCount: number;
    readonly validationMethodSampleCounts: Readonly<{
      schemaValidated: number;
      humanConfirmed: number;
    }>;
    readonly nominationEventCount: number;
    readonly domains: readonly {
      readonly registrableDomain: string;
      readonly nominationRate: NominationRatioLike;
      readonly firstNominationRate:
        NominationRatioLike | UnavailableFirstNominationRateLike;
      readonly nominationShare: NominationRatioLike;
    }[];
    readonly stability: NominationStabilityLike;
  }[];
  readonly warnings: readonly [
    "SELF_REPORTED_NOMINATION_NOT_OBSERVED_RETRIEVAL_OR_CITATION",
  ];
}

interface NominationRatioLike {
  readonly availability: "available";
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
}

interface UnavailableFirstNominationRateLike {
  readonly availability: "not_available";
  readonly numerator: null;
  readonly denominator: null;
  readonly value: null;
  readonly reason: "NO_VALID_NOMINATION_ORDER";
}

type NominationStabilityLike =
  | {
      readonly availability: "available";
      readonly value: number;
      readonly questionCount: number;
      readonly pairCount: number;
      readonly noNominationPairCount: number;
      readonly questions: readonly NominationQuestionStabilityLike[];
    }
  | {
      readonly availability: "not_available";
      readonly value: null;
      readonly questionCount: 0;
      readonly pairCount: 0;
      readonly noNominationPairCount: number;
      readonly questions: readonly NominationQuestionStabilityLike[];
      readonly reason:
        | "INSUFFICIENT_REPEATED_SAMPLES"
        | "ALL_SAMPLE_PAIRS_HAVE_NO_NOMINATIONS";
    };

interface NominationQuestionStabilityLike {
  readonly querySnapshotItemId: string;
  readonly value: number;
  readonly pairCount: number;
  readonly noNominationPairCount: number;
}

export function adaptSourceNominationMetricReportToResponse(
  report: SourceNominationMetricReportLike,
): SourceNominationMetricsResponseDto {
  return sourceNominationMetricsResponseSchema.parse({
    contract_version: SOURCE_NOMINATION_METRICS_CONTRACT_VERSION,
    methodology_version: report.methodologyVersion,
    normalization_version: report.normalizationVersion,
    scope_id: report.scopeId,
    query_set_snapshot_hash: report.querySetSnapshotHash,
    computed_at: report.computedAt,
    sample_basis: report.sampleBasis,
    availability: report.availability,
    unavailable_reason: report.unavailableReason,
    validated_sample_count: report.validatedSampleCount,
    excluded_parse_counts: {
      needs_review: report.excludedParseCounts.needsReview,
      rejected: report.excludedParseCounts.rejected,
    },
    groups: report.groups.map((group) => ({
      nomination_context: group.nominationContext,
      validated_sample_count: group.validatedSampleCount,
      validation_method_sample_counts: {
        schema_validated: group.validationMethodSampleCounts.schemaValidated,
        human_confirmed: group.validationMethodSampleCounts.humanConfirmed,
      },
      nomination_event_count: group.nominationEventCount,
      domains: group.domains.map((domain) => ({
        registrable_domain: domain.registrableDomain,
        nomination_rate: domain.nominationRate,
        first_nomination_rate: domain.firstNominationRate,
        nomination_share: domain.nominationShare,
      })),
      stability: adaptNominationStability(group.stability),
    })),
    warnings: report.warnings,
  });
}

function adaptNominationStability(stability: NominationStabilityLike) {
  const common = {
    availability: stability.availability,
    value: stability.value,
    question_count: stability.questionCount,
    pair_count: stability.pairCount,
    no_nomination_pair_count: stability.noNominationPairCount,
    questions: stability.questions.map((question) => ({
      query_snapshot_item_id: question.querySnapshotItemId,
      value: question.value,
      pair_count: question.pairCount,
      no_nomination_pair_count: question.noNominationPairCount,
    })),
  };
  return stability.availability === "available"
    ? common
    : { ...common, reason: stability.reason };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * 8;
}
