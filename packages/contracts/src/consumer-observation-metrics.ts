import { z } from "zod";

export const CONSUMER_OBSERVATION_METRICS_CONTRACT_VERSION =
  "wentian-consumer-observation-metrics@0-draft" as const;

const availableRatioSchema = z
  .object({
    availability: z.literal("available"),
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
    value: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((ratio, context) => {
    if (ratio.numerator > ratio.denominator) {
      context.addIssue({
        code: "custom",
        path: ["numerator"],
        message: "METRIC_NUMERATOR_EXCEEDS_DENOMINATOR",
      });
    }
    if (!approximatelyEqual(ratio.value, ratio.numerator / ratio.denominator)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "METRIC_RATIO_VALUE_MISMATCH",
      });
    }
  });

const unavailableFirstCitationRateSchema = z
  .object({
    availability: z.literal("not_available"),
    numerator: z.null(),
    denominator: z.null(),
    value: z.null(),
    reason: z.literal("SOURCE_ORDER_NOT_AVAILABLE"),
  })
  .strict();

const firstVisibleCitationRateSchema = z.discriminatedUnion("availability", [
  availableRatioSchema,
  unavailableFirstCitationRateSchema,
]);

const consumerMetricConfigurationSchema = z
  .object({
    surface_code: z.string().trim().min(1).max(80),
    surface_model_label: z.string().trim().min(1).max(120).nullable(),
    search_mode: z.enum(["enabled", "disabled", "unknown"]),
    is_new_conversation: z.boolean(),
    is_logged_in: z.boolean(),
    memory_enabled: z.boolean().nullable(),
    personalization_enabled: z.boolean().nullable(),
    locale: z.string().trim().min(2).max(16),
    region: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

const consumerDomainMetricSchema = z
  .object({
    registrable_domain: z.string().trim().min(1).max(253),
    web_visible_citation_rate: availableRatioSchema,
    first_visible_citation_rate: firstVisibleCitationRateSchema,
  })
  .strict();

const consumerQuestionSourceStabilitySchema = z
  .object({
    query_snapshot_item_id: z.uuid(),
    value: z.number().min(0).max(1),
    pair_count: z.number().int().positive(),
    no_source_pair_count: z.number().int().nonnegative(),
  })
  .strict();

const availableSourceStabilitySchema = z
  .object({
    availability: z.literal("available"),
    value: z.number().min(0).max(1),
    question_count: z.number().int().positive(),
    pair_count: z.number().int().positive(),
    no_source_pair_count: z.number().int().nonnegative(),
    questions: z.array(consumerQuestionSourceStabilitySchema).min(1),
  })
  .strict()
  .superRefine((stability, context) => {
    if (stability.question_count !== stability.questions.length) {
      context.addIssue({
        code: "custom",
        path: ["question_count"],
        message: "STABILITY_QUESTION_COUNT_MISMATCH",
      });
    }
    if (
      stability.pair_count !==
      stability.questions.reduce(
        (sum, question) => sum + question.pair_count,
        0,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["pair_count"],
        message: "STABILITY_PAIR_COUNT_MISMATCH",
      });
    }
    if (
      stability.no_source_pair_count <
      stability.questions.reduce(
        (sum, question) => sum + question.no_source_pair_count,
        0,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["no_source_pair_count"],
        message: "STABILITY_NO_SOURCE_PAIR_COUNT_MISMATCH",
      });
    }
    if (
      !approximatelyEqual(
        stability.value,
        stability.questions.reduce((sum, question) => sum + question.value, 0) /
          stability.questions.length,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "STABILITY_VALUE_MISMATCH",
      });
    }
  });

const unavailableSourceStabilitySchema = z
  .object({
    availability: z.literal("not_available"),
    value: z.null(),
    question_count: z.literal(0),
    pair_count: z.literal(0),
    no_source_pair_count: z.number().int().nonnegative(),
    questions: z.array(z.never()).max(0),
    reason: z.enum([
      "INSUFFICIENT_REPEATED_SAMPLES",
      "ALL_SAMPLE_PAIRS_HAVE_NO_SOURCES",
    ]),
  })
  .strict();

const consumerSourceStabilitySchema = z.discriminatedUnion("availability", [
  availableSourceStabilitySchema,
  unavailableSourceStabilitySchema,
]);

const consumerObservationMetricGroupSchema = z
  .object({
    configuration: consumerMetricConfigurationSchema,
    confirmed_sample_count: z.number().int().positive(),
    sample_assessment: z.enum([
      "individual_observation",
      "descriptive_trend_insufficient_sample",
      "descriptive_only",
    ]),
    evidence_grade_sample_counts: z
      .object({
        web_confirmed_capture: z.number().int().nonnegative(),
        web_confirmed_manual: z.number().int().nonnegative(),
      })
      .strict(),
    domains: z.array(consumerDomainMetricSchema),
    source_stability: consumerSourceStabilitySchema,
  })
  .strict()
  .superRefine((group, context) => {
    const evidenceCount =
      group.evidence_grade_sample_counts.web_confirmed_capture +
      group.evidence_grade_sample_counts.web_confirmed_manual;
    if (evidenceCount !== group.confirmed_sample_count) {
      context.addIssue({
        code: "custom",
        path: ["evidence_grade_sample_counts"],
        message: "EVIDENCE_SAMPLE_COUNT_MISMATCH",
      });
    }
    const expectedAssessment =
      group.confirmed_sample_count < 5
        ? "individual_observation"
        : group.confirmed_sample_count < 20
          ? "descriptive_trend_insufficient_sample"
          : "descriptive_only";
    if (group.sample_assessment !== expectedAssessment) {
      context.addIssue({
        code: "custom",
        path: ["sample_assessment"],
        message: "SAMPLE_ASSESSMENT_MISMATCH",
      });
    }
    const seenDomains = new Set<string>();
    for (const [index, domain] of group.domains.entries()) {
      if (seenDomains.has(domain.registrable_domain)) {
        context.addIssue({
          code: "custom",
          path: ["domains", index, "registrable_domain"],
          message: "DUPLICATE_REGISTRABLE_DOMAIN",
        });
      }
      seenDomains.add(domain.registrable_domain);
      if (
        domain.web_visible_citation_rate.denominator !==
        group.confirmed_sample_count
      ) {
        context.addIssue({
          code: "custom",
          path: ["domains", index, "web_visible_citation_rate", "denominator"],
          message: "VISIBLE_CITATION_DENOMINATOR_MISMATCH",
        });
      }
    }
  });

const consumerObservationSampleBasisSchema = z
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
        message: "SAMPLE_BASIS_EXCEEDS_PLANNED",
      });
    }
  });

export const consumerObservationMetricsResponseSchema = z
  .object({
    contract_version: z.literal(CONSUMER_OBSERVATION_METRICS_CONTRACT_VERSION),
    run_id: z.uuid(),
    methodology_version: z.literal("ai-source-observatory@1"),
    normalization_version: z.string().trim().min(1).max(64),
    scope_id: z.uuid(),
    query_set_snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
    query_set_source_type: z.enum(["local", "geo_sync", "imported"]),
    geo_connector_contract_version: z.string().trim().min(1).max(64).nullable(),
    experiment_kind: z.literal("natural_answer"),
    collection_method: z.enum(["browser_assisted", "manual_import"]),
    nomination_context: z.null(),
    surface_profile_version_id: z.uuid(),
    consumer_surface_code: z.string().trim().min(1).max(80),
    provider_source_granularity: z.null(),
    candidate_data_available: z.null(),
    observation_verification_status: z.literal("confirmed").nullable(),
    evidence_grades: z
      .array(z.enum(["web_confirmed_capture", "web_confirmed_manual"]))
      .max(1),
    comparison_tier: z.null(),
    model_equivalence_version: z.null(),
    log_verification_level: z.null(),
    computed_at: z.iso.datetime({ offset: true }),
    sample_basis: consumerObservationSampleBasisSchema,
    availability: z.enum(["available", "not_available"]),
    unavailable_reason: z.literal("NO_CONFIRMED_WEB_EVIDENCE").nullable(),
    confirmed_sample_count: z.number().int().nonnegative(),
    excluded_sample_counts: z
      .object({
        needs_review: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        not_required: z.number().int().nonnegative(),
      })
      .strict(),
    groups: z.array(consumerObservationMetricGroupSchema),
    warnings: z.tuple([
      z.literal(
        "WEB_VISIBLE_EVIDENCE_ONLY_NOT_HIDDEN_SEARCH_OR_INTERNAL_CRAWL",
      ),
    ]),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      (response.query_set_source_type === "geo_sync") !==
      (response.geo_connector_contract_version !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["geo_connector_contract_version"],
        message: "GEO_CONTRACT_VERSION_SOURCE_MISMATCH",
      });
    }
    const groupedSampleCount = response.groups.reduce(
      (sum, group) => sum + group.confirmed_sample_count,
      0,
    );
    if (groupedSampleCount !== response.confirmed_sample_count) {
      context.addIssue({
        code: "custom",
        path: ["confirmed_sample_count"],
        message: "CONFIRMED_SAMPLE_COUNT_MISMATCH",
      });
    }
    const representedSampleCount =
      response.confirmed_sample_count +
      response.excluded_sample_counts.needs_review +
      response.excluded_sample_counts.rejected +
      response.excluded_sample_counts.not_required;
    const pendingSampleCount =
      response.sample_basis.planned -
      response.sample_basis.successful -
      response.sample_basis.failed;
    if (
      representedSampleCount > response.sample_basis.planned ||
      response.confirmed_sample_count +
        response.excluded_sample_counts.not_required >
        response.sample_basis.successful ||
      response.excluded_sample_counts.rejected > response.sample_basis.failed ||
      response.excluded_sample_counts.needs_review > pendingSampleCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["sample_basis"],
        message: "SAMPLE_BASIS_COVERAGE_MISMATCH",
      });
    }
    if (
      response.availability === "available" &&
      (response.unavailable_reason !== null ||
        response.groups.length === 0 ||
        response.observation_verification_status !== "confirmed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["availability"],
        message: "AVAILABLE_METRICS_GROUP_REQUIRED",
      });
    }
    if (
      response.availability === "not_available" &&
      (response.unavailable_reason !== "NO_CONFIRMED_WEB_EVIDENCE" ||
        response.groups.length > 0 ||
        response.confirmed_sample_count !== 0 ||
        response.observation_verification_status !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["availability"],
        message: "UNAVAILABLE_METRICS_STATE_INVALID",
      });
    }
    const expectedEvidenceGrade =
      response.collection_method === "browser_assisted"
        ? "web_confirmed_capture"
        : "web_confirmed_manual";
    if (
      (response.availability === "available" &&
        (response.evidence_grades.length !== 1 ||
          response.evidence_grades[0] !== expectedEvidenceGrade)) ||
      (response.availability === "not_available" &&
        response.evidence_grades.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence_grades"],
        message: "METRIC_EVIDENCE_GRADES_MISMATCH",
      });
    }
    for (const [index, group] of response.groups.entries()) {
      const captureCount =
        group.evidence_grade_sample_counts.web_confirmed_capture;
      const manualCount =
        group.evidence_grade_sample_counts.web_confirmed_manual;
      if (
        group.configuration.surface_code !== response.consumer_surface_code ||
        (response.collection_method === "browser_assisted" &&
          (captureCount !== group.confirmed_sample_count ||
            manualCount !== 0)) ||
        (response.collection_method === "manual_import" &&
          (manualCount !== group.confirmed_sample_count || captureCount !== 0))
      ) {
        context.addIssue({
          code: "custom",
          path: ["groups", index],
          message: "METRIC_GROUP_RUN_CONTEXT_MISMATCH",
        });
      }
    }
  });

export type ConsumerObservationMetricsResponseDto = z.infer<
  typeof consumerObservationMetricsResponseSchema
>;

interface RatioLike {
  readonly availability: "available";
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
}

interface UnavailableRatioLike {
  readonly availability: "not_available";
  readonly numerator: null;
  readonly denominator: null;
  readonly value: null;
  readonly reason: "SOURCE_ORDER_NOT_AVAILABLE";
}

interface StabilityQuestionLike {
  readonly querySnapshotItemId: string;
  readonly value: number;
  readonly pairCount: number;
  readonly noSourcePairCount: number;
}

type StabilityLike =
  | {
      readonly availability: "available";
      readonly value: number;
      readonly questionCount: number;
      readonly pairCount: number;
      readonly noSourcePairCount: number;
      readonly questions: readonly StabilityQuestionLike[];
    }
  | {
      readonly availability: "not_available";
      readonly value: null;
      readonly questionCount: 0;
      readonly pairCount: 0;
      readonly noSourcePairCount: number;
      readonly questions: readonly StabilityQuestionLike[];
      readonly reason:
        "INSUFFICIENT_REPEATED_SAMPLES" | "ALL_SAMPLE_PAIRS_HAVE_NO_SOURCES";
    };

export interface ConsumerObservationMetricReportLike {
  readonly runId: string;
  readonly methodologyVersion: "ai-source-observatory@1";
  readonly normalizationVersion: string;
  readonly scopeId: string;
  readonly querySetSnapshotHash: string;
  readonly querySetSourceType: "local" | "geo_sync" | "imported";
  readonly geoConnectorContractVersion: string | null;
  readonly experimentKind: "natural_answer";
  readonly collectionMethod: "browser_assisted" | "manual_import";
  readonly nominationContext: null;
  readonly surfaceProfileVersionId: string;
  readonly consumerSurfaceCode: string;
  readonly computedAt: string;
  readonly sampleBasis: Readonly<{
    planned: number;
    successful: number;
    failed: number;
  }>;
  readonly availability: "available" | "not_available";
  readonly unavailableReason: "NO_CONFIRMED_WEB_EVIDENCE" | null;
  readonly confirmedSampleCount: number;
  readonly excludedSampleCounts: Readonly<{
    needsReview: number;
    rejected: number;
    notRequired: number;
  }>;
  readonly groups: readonly {
    readonly configuration: Readonly<{
      surfaceCode: string;
      surfaceModelLabel: string | null;
      searchMode: "enabled" | "disabled" | "unknown";
      isNewConversation: boolean;
      isLoggedIn: boolean;
      memoryEnabled: boolean | null;
      personalizationEnabled: boolean | null;
      locale: string;
      region: string | null;
    }>;
    readonly confirmedSampleCount: number;
    readonly sampleAssessment:
      | "individual_observation"
      | "descriptive_trend_insufficient_sample"
      | "descriptive_only";
    readonly evidenceGradeSampleCounts: Readonly<{
      webConfirmedCapture: number;
      webConfirmedManual: number;
    }>;
    readonly domains: readonly {
      readonly registrableDomain: string;
      readonly webVisibleCitationRate: RatioLike;
      readonly firstVisibleCitationRate: RatioLike | UnavailableRatioLike;
    }[];
    readonly sourceStability: StabilityLike;
  }[];
  readonly warnings: readonly [
    "WEB_VISIBLE_EVIDENCE_ONLY_NOT_HIDDEN_SEARCH_OR_INTERNAL_CRAWL",
  ];
}

export function adaptConsumerObservationMetricReportToResponse(
  report: ConsumerObservationMetricReportLike,
): ConsumerObservationMetricsResponseDto {
  return consumerObservationMetricsResponseSchema.parse({
    contract_version: CONSUMER_OBSERVATION_METRICS_CONTRACT_VERSION,
    run_id: report.runId,
    methodology_version: report.methodologyVersion,
    normalization_version: report.normalizationVersion,
    scope_id: report.scopeId,
    query_set_snapshot_hash: report.querySetSnapshotHash,
    query_set_source_type: report.querySetSourceType,
    geo_connector_contract_version: report.geoConnectorContractVersion,
    experiment_kind: report.experimentKind,
    collection_method: report.collectionMethod,
    nomination_context: report.nominationContext,
    surface_profile_version_id: report.surfaceProfileVersionId,
    consumer_surface_code: report.consumerSurfaceCode,
    provider_source_granularity: null,
    candidate_data_available: null,
    observation_verification_status:
      report.availability === "available" ? "confirmed" : null,
    evidence_grades:
      report.availability === "available"
        ? [
            report.collectionMethod === "browser_assisted"
              ? "web_confirmed_capture"
              : "web_confirmed_manual",
          ]
        : [],
    comparison_tier: null,
    model_equivalence_version: null,
    log_verification_level: null,
    computed_at: report.computedAt,
    sample_basis: report.sampleBasis,
    availability: report.availability,
    unavailable_reason: report.unavailableReason,
    confirmed_sample_count: report.confirmedSampleCount,
    excluded_sample_counts: {
      needs_review: report.excludedSampleCounts.needsReview,
      rejected: report.excludedSampleCounts.rejected,
      not_required: report.excludedSampleCounts.notRequired,
    },
    groups: report.groups.map((group) => ({
      configuration: {
        surface_code: group.configuration.surfaceCode,
        surface_model_label: group.configuration.surfaceModelLabel,
        search_mode: group.configuration.searchMode,
        is_new_conversation: group.configuration.isNewConversation,
        is_logged_in: group.configuration.isLoggedIn,
        memory_enabled: group.configuration.memoryEnabled,
        personalization_enabled: group.configuration.personalizationEnabled,
        locale: group.configuration.locale,
        region: group.configuration.region,
      },
      confirmed_sample_count: group.confirmedSampleCount,
      sample_assessment: group.sampleAssessment,
      evidence_grade_sample_counts: {
        web_confirmed_capture:
          group.evidenceGradeSampleCounts.webConfirmedCapture,
        web_confirmed_manual:
          group.evidenceGradeSampleCounts.webConfirmedManual,
      },
      domains: group.domains.map((domain) => ({
        registrable_domain: domain.registrableDomain,
        web_visible_citation_rate: domain.webVisibleCitationRate,
        first_visible_citation_rate: domain.firstVisibleCitationRate,
      })),
      source_stability: adaptStability(group.sourceStability),
    })),
    warnings: report.warnings,
  });
}

function adaptStability(stability: StabilityLike) {
  const common = {
    availability: stability.availability,
    value: stability.value,
    question_count: stability.questionCount,
    pair_count: stability.pairCount,
    no_source_pair_count: stability.noSourcePairCount,
    questions: stability.questions.map((question) => ({
      query_snapshot_item_id: question.querySnapshotItemId,
      value: question.value,
      pair_count: question.pairCount,
      no_source_pair_count: question.noSourcePairCount,
    })),
  };
  return stability.availability === "available"
    ? common
    : { ...common, reason: stability.reason };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * 8;
}
