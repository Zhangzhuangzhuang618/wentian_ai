import {
  CONSUMER_COLLECTION_METHODS,
  OBSERVATION_EVIDENCE_GRADES,
  OBSERVATION_VERIFICATION_STATUSES,
  evidenceGradeForConsumerCollectionMethod,
  isDefaultConsumerMetricEligible,
  type ConsumerCollectionMethod,
  type ConsumerSessionConditions,
  type ObservationEvidenceGrade,
  type ObservationVerificationStatus,
} from "./consumer-observation.ts";

export const CONSUMER_OBSERVATION_METHODOLOGY_VERSION =
  "ai-source-observatory@1" as const;

export const CONSUMER_OBSERVATION_EVIDENCE_WARNING =
  "WEB_VISIBLE_EVIDENCE_ONLY_NOT_HIDDEN_SEARCH_OR_INTERNAL_CRAWL" as const;

export type ConsumerSearchMode = ConsumerSessionConditions["searchMode"];

export interface ConsumerObservationMetricConfiguration extends ConsumerSessionConditions {
  readonly surfaceCode: string;
  readonly surfaceModelLabel: string | null;
}

export interface ConsumerObservationMetricCitation {
  readonly registrableDomain: string;
  readonly position: number | null;
}

export interface ConsumerObservationMetricSample {
  readonly id: string;
  readonly querySnapshotItemId: string;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly verificationStatus: ObservationVerificationStatus;
  readonly evidenceGrade: ObservationEvidenceGrade | null;
  readonly configuration: ConsumerObservationMetricConfiguration;
  readonly sourceOrderAvailable: boolean;
  readonly citations: readonly ConsumerObservationMetricCitation[];
}

export interface ComputeConsumerObservationMetricsInput {
  readonly scopeId: string;
  readonly querySetSnapshotHash: string;
  readonly normalizationVersion: string;
  readonly computedAt: string;
  readonly sampleBasis: ConsumerObservationSampleBasis;
  readonly samples: readonly ConsumerObservationMetricSample[];
}

export interface ConsumerObservationSampleBasis {
  readonly planned: number;
  readonly successful: number;
  readonly failed: number;
}

export interface AvailableRatioMetric {
  readonly availability: "available";
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
}

export interface UnavailableRatioMetric {
  readonly availability: "not_available";
  readonly numerator: null;
  readonly denominator: null;
  readonly value: null;
  readonly reason: "SOURCE_ORDER_NOT_AVAILABLE";
}

export type FirstVisibleCitationRate =
  AvailableRatioMetric | UnavailableRatioMetric;

export interface ConsumerDomainMetric {
  readonly registrableDomain: string;
  readonly webVisibleCitationRate: AvailableRatioMetric;
  readonly firstVisibleCitationRate: FirstVisibleCitationRate;
}

export interface ConsumerQuestionSourceStability {
  readonly querySnapshotItemId: string;
  readonly value: number;
  readonly pairCount: number;
  readonly noSourcePairCount: number;
}

export type ConsumerSourceStability =
  | {
      readonly availability: "available";
      readonly value: number;
      readonly questionCount: number;
      readonly pairCount: number;
      readonly noSourcePairCount: number;
      readonly questions: readonly ConsumerQuestionSourceStability[];
    }
  | {
      readonly availability: "not_available";
      readonly value: null;
      readonly questionCount: 0;
      readonly pairCount: 0;
      readonly noSourcePairCount: number;
      readonly questions: readonly ConsumerQuestionSourceStability[];
      readonly reason:
        "INSUFFICIENT_REPEATED_SAMPLES" | "ALL_SAMPLE_PAIRS_HAVE_NO_SOURCES";
    };

export type ConsumerSampleAssessment =
  | "individual_observation"
  | "descriptive_trend_insufficient_sample"
  | "descriptive_only";

export interface ConsumerObservationMetricGroup {
  readonly configuration: ConsumerObservationMetricConfiguration;
  readonly confirmedSampleCount: number;
  readonly sampleAssessment: ConsumerSampleAssessment;
  readonly evidenceGradeSampleCounts: Readonly<{
    webConfirmedCapture: number;
    webConfirmedManual: number;
  }>;
  readonly domains: readonly ConsumerDomainMetric[];
  readonly sourceStability: ConsumerSourceStability;
}

export interface ConsumerObservationMetricReport {
  readonly methodologyVersion: typeof CONSUMER_OBSERVATION_METHODOLOGY_VERSION;
  readonly normalizationVersion: string;
  readonly scopeId: string;
  readonly querySetSnapshotHash: string;
  readonly computedAt: string;
  readonly sampleBasis: ConsumerObservationSampleBasis;
  readonly availability: "available" | "not_available";
  readonly unavailableReason: "NO_CONFIRMED_WEB_EVIDENCE" | null;
  readonly confirmedSampleCount: number;
  readonly excludedSampleCounts: Readonly<{
    needsReview: number;
    rejected: number;
    notRequired: number;
  }>;
  readonly groups: readonly ConsumerObservationMetricGroup[];
  readonly warnings: readonly [typeof CONSUMER_OBSERVATION_EVIDENCE_WARNING];
}

export function computeConsumerObservationMetrics(
  input: ComputeConsumerObservationMetricsInput,
): ConsumerObservationMetricReport {
  const scopeId = normalizeRequiredText(input.scopeId, "INVALID_SCOPE_ID");
  const querySetSnapshotHash = normalizeRequiredText(
    input.querySetSnapshotHash,
    "INVALID_QUERY_SET_SNAPSHOT_HASH",
  );
  const normalizationVersion = normalizeRequiredText(
    input.normalizationVersion,
    "INVALID_NORMALIZATION_VERSION",
  );
  const computedAt = normalizeTimestamp(input.computedAt);
  const sampleBasis = normalizeSampleBasis(input.sampleBasis);
  const eligibleSamples: NormalizedMetricSample[] = [];
  const excludedSampleCounts = {
    needsReview: 0,
    rejected: 0,
    notRequired: 0,
  };

  const sampleIds = new Set<string>();
  for (const sample of input.samples) {
    assertMetricSampleState(sample);
    const sampleId = normalizeRequiredText(
      sample.id,
      "INVALID_METRIC_SAMPLE_ID",
    );
    if (sampleIds.has(sampleId)) {
      throw new Error("DUPLICATE_CONSUMER_METRIC_SAMPLE_ID");
    }
    sampleIds.add(sampleId);
    if (
      sample.verificationStatus === "confirmed" &&
      !isDefaultConsumerMetricEligible(
        sample.verificationStatus,
        sample.evidenceGrade,
      )
    ) {
      throw new Error("INVALID_CONFIRMED_CONSUMER_EVIDENCE_GRADE");
    }
    if (
      isDefaultConsumerMetricEligible(
        sample.verificationStatus,
        sample.evidenceGrade,
      )
    ) {
      if (
        sample.evidenceGrade !==
        evidenceGradeForConsumerCollectionMethod(sample.collectionMethod)
      ) {
        throw new Error("CONSUMER_EVIDENCE_COLLECTION_METHOD_MISMATCH");
      }
      eligibleSamples.push(normalizeSample(sample));
      continue;
    }
    if (sample.verificationStatus === "needs_review") {
      excludedSampleCounts.needsReview += 1;
    } else if (sample.verificationStatus === "rejected") {
      excludedSampleCounts.rejected += 1;
    } else {
      excludedSampleCounts.notRequired += 1;
    }
  }

  const groupsByConfiguration = new Map<string, NormalizedMetricSample[]>();
  for (const sample of eligibleSamples) {
    const key = JSON.stringify(sample.configuration);
    const group = groupsByConfiguration.get(key) ?? [];
    group.push(sample);
    groupsByConfiguration.set(key, group);
  }

  const groups = [...groupsByConfiguration.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, samples]) => computeMetricGroup(samples));
  assertSampleBasisCoverage(
    sampleBasis,
    eligibleSamples.length,
    excludedSampleCounts,
  );

  return Object.freeze({
    methodologyVersion: CONSUMER_OBSERVATION_METHODOLOGY_VERSION,
    normalizationVersion,
    scopeId,
    querySetSnapshotHash,
    computedAt,
    sampleBasis,
    availability: groups.length > 0 ? "available" : "not_available",
    unavailableReason: groups.length > 0 ? null : "NO_CONFIRMED_WEB_EVIDENCE",
    confirmedSampleCount: eligibleSamples.length,
    excludedSampleCounts: Object.freeze(excludedSampleCounts),
    groups: Object.freeze(groups),
    warnings: Object.freeze([CONSUMER_OBSERVATION_EVIDENCE_WARNING] as const),
  });
}

function normalizeSampleBasis(
  input: ConsumerObservationSampleBasis,
): ConsumerObservationSampleBasis {
  for (const [name, value] of [
    ["planned", input.planned],
    ["successful", input.successful],
    ["failed", input.failed],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`INVALID_CONSUMER_SAMPLE_BASIS:${name}`);
    }
  }
  if (input.successful + input.failed > input.planned) {
    throw new Error("CONSUMER_SAMPLE_BASIS_EXCEEDS_PLANNED");
  }
  return Object.freeze({
    planned: input.planned,
    successful: input.successful,
    failed: input.failed,
  });
}

function assertSampleBasisCoverage(
  sampleBasis: ConsumerObservationSampleBasis,
  confirmedSampleCount: number,
  excluded: Readonly<{
    needsReview: number;
    rejected: number;
    notRequired: number;
  }>,
): void {
  const representedSampleCount =
    confirmedSampleCount +
    excluded.needsReview +
    excluded.rejected +
    excluded.notRequired;
  const pending =
    sampleBasis.planned - sampleBasis.successful - sampleBasis.failed;
  if (
    representedSampleCount > sampleBasis.planned ||
    confirmedSampleCount + excluded.notRequired > sampleBasis.successful ||
    excluded.rejected > sampleBasis.failed ||
    excluded.needsReview > pending
  ) {
    throw new Error("CONSUMER_SAMPLE_BASIS_COVERAGE_MISMATCH");
  }
}

interface NormalizedMetricSample extends Omit<
  ConsumerObservationMetricSample,
  "configuration" | "citations"
> {
  readonly configuration: ConsumerObservationMetricConfiguration;
  readonly citations: readonly ConsumerObservationMetricCitation[];
  readonly domainSet: ReadonlySet<string>;
}

function normalizeSample(
  sample: ConsumerObservationMetricSample,
): NormalizedMetricSample {
  const id = normalizeRequiredText(sample.id, "INVALID_METRIC_SAMPLE_ID");
  const querySnapshotItemId = normalizeRequiredText(
    sample.querySnapshotItemId,
    "INVALID_QUERY_SNAPSHOT_ITEM_ID",
  );
  const configuration = normalizeConfiguration(sample.configuration);
  if (typeof sample.sourceOrderAvailable !== "boolean") {
    throw new Error("INVALID_SOURCE_ORDER_AVAILABILITY");
  }
  const citations = sample.citations.map((citation) => {
    const registrableDomain = normalizeDomain(citation.registrableDomain);
    if (
      citation.position !== null &&
      (!Number.isInteger(citation.position) || citation.position < 1)
    ) {
      throw new Error("INVALID_VISIBLE_CITATION_POSITION");
    }
    return Object.freeze({
      registrableDomain,
      position: citation.position,
    });
  });
  if (sample.sourceOrderAvailable) {
    if (citations.some((citation) => citation.position === null)) {
      throw new Error("VISIBLE_CITATION_POSITION_REQUIRED");
    }
    if (
      citations.length > 0 &&
      Math.min(
        ...citations.map((citation) => citation.position ?? Infinity),
      ) !== 1
    ) {
      throw new Error("VISIBLE_CITATION_FIRST_POSITION_REQUIRED");
    }
  }

  return Object.freeze({
    ...sample,
    id,
    querySnapshotItemId,
    configuration,
    citations: Object.freeze(citations),
    domainSet: new Set(citations.map((citation) => citation.registrableDomain)),
  });
}

function normalizeConfiguration(
  input: ConsumerObservationMetricConfiguration,
): ConsumerObservationMetricConfiguration {
  if (
    input.searchMode !== "enabled" &&
    input.searchMode !== "disabled" &&
    input.searchMode !== "unknown"
  ) {
    throw new Error("INVALID_CONSUMER_SEARCH_MODE");
  }
  for (const [name, value] of [
    ["isNewConversation", input.isNewConversation],
    ["isLoggedIn", input.isLoggedIn],
  ] as const) {
    if (typeof value !== "boolean") {
      throw new Error(`INVALID_CONSUMER_CONFIGURATION_BOOLEAN:${name}`);
    }
  }
  for (const [name, value] of [
    ["memoryEnabled", input.memoryEnabled],
    ["personalizationEnabled", input.personalizationEnabled],
  ] as const) {
    if (value !== null && typeof value !== "boolean") {
      throw new Error(`INVALID_CONSUMER_CONFIGURATION_BOOLEAN:${name}`);
    }
  }
  return Object.freeze({
    surfaceCode: normalizeRequiredText(
      input.surfaceCode,
      "INVALID_SURFACE_CODE",
    ),
    surfaceModelLabel: normalizeOptionalText(input.surfaceModelLabel),
    searchMode: input.searchMode,
    isNewConversation: input.isNewConversation,
    isLoggedIn: input.isLoggedIn,
    memoryEnabled: input.memoryEnabled,
    personalizationEnabled: input.personalizationEnabled,
    locale: normalizeRequiredText(input.locale, "INVALID_LOCALE"),
    region: normalizeOptionalText(input.region),
  });
}

function computeMetricGroup(
  samples: readonly NormalizedMetricSample[],
): ConsumerObservationMetricGroup {
  const confirmedSampleCount = samples.length;
  const orderAvailable = samples.every((sample) => sample.sourceOrderAvailable);
  const firstCitationDenominator = samples.filter(
    (sample) => sample.domainSet.size > 0,
  ).length;
  const domains = new Set<string>();
  for (const sample of samples) {
    for (const domain of sample.domainSet) {
      domains.add(domain);
    }
  }

  const domainMetrics = [...domains]
    .sort((left, right) => left.localeCompare(right))
    .map((registrableDomain) => {
      const citationNumerator = samples.filter((sample) =>
        sample.domainSet.has(registrableDomain),
      ).length;
      const firstCitationNumerator = samples.filter((sample) =>
        sample.citations.some(
          (citation) =>
            citation.registrableDomain === registrableDomain &&
            citation.position === 1,
        ),
      ).length;
      return Object.freeze({
        registrableDomain,
        webVisibleCitationRate: availableRatio(
          citationNumerator,
          confirmedSampleCount,
        ),
        firstVisibleCitationRate: orderAvailable
          ? availableRatio(firstCitationNumerator, firstCitationDenominator)
          : unavailableFirstCitationRate(),
      });
    });

  return Object.freeze({
    configuration: samples[0].configuration,
    confirmedSampleCount,
    sampleAssessment: assessSampleCount(confirmedSampleCount),
    evidenceGradeSampleCounts: Object.freeze({
      webConfirmedCapture: samples.filter(
        (sample) => sample.evidenceGrade === "web_confirmed_capture",
      ).length,
      webConfirmedManual: samples.filter(
        (sample) => sample.evidenceGrade === "web_confirmed_manual",
      ).length,
    }),
    domains: Object.freeze(domainMetrics),
    sourceStability: computeSourceStability(samples),
  });
}

function computeSourceStability(
  samples: readonly NormalizedMetricSample[],
): ConsumerSourceStability {
  const samplesByQuery = new Map<string, NormalizedMetricSample[]>();
  for (const sample of samples) {
    const querySamples = samplesByQuery.get(sample.querySnapshotItemId) ?? [];
    querySamples.push(sample);
    samplesByQuery.set(sample.querySnapshotItemId, querySamples);
  }

  const questions: ConsumerQuestionSourceStability[] = [];
  let totalPairCandidates = 0;
  let totalPairCount = 0;
  let totalNoSourcePairCount = 0;
  for (const [querySnapshotItemId, querySamples] of [...samplesByQuery].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const values: number[] = [];
    let noSourcePairCount = 0;
    for (let leftIndex = 0; leftIndex < querySamples.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < querySamples.length;
        rightIndex += 1
      ) {
        totalPairCandidates += 1;
        const value = jaccard(
          querySamples[leftIndex].domainSet,
          querySamples[rightIndex].domainSet,
        );
        if (value === null) {
          noSourcePairCount += 1;
          totalNoSourcePairCount += 1;
        } else {
          values.push(value);
          totalPairCount += 1;
        }
      }
    }
    if (values.length > 0) {
      questions.push(
        Object.freeze({
          querySnapshotItemId,
          value: mean(values),
          pairCount: values.length,
          noSourcePairCount,
        }),
      );
    }
  }

  if (questions.length === 0) {
    return Object.freeze({
      availability: "not_available",
      value: null,
      questionCount: 0,
      pairCount: 0,
      noSourcePairCount: totalNoSourcePairCount,
      questions: Object.freeze([]),
      reason:
        totalPairCandidates === 0
          ? "INSUFFICIENT_REPEATED_SAMPLES"
          : "ALL_SAMPLE_PAIRS_HAVE_NO_SOURCES",
    });
  }

  return Object.freeze({
    availability: "available",
    value: mean(questions.map((question) => question.value)),
    questionCount: questions.length,
    pairCount: totalPairCount,
    noSourcePairCount: totalNoSourcePairCount,
    questions: Object.freeze(questions),
  });
}

function jaccard(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number | null {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return null;
  }
  let intersectionSize = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersectionSize += 1;
    }
  }
  return intersectionSize / union.size;
}

function availableRatio(
  numerator: number,
  denominator: number,
): AvailableRatioMetric {
  if (denominator < 1) {
    throw new Error("METRIC_DENOMINATOR_REQUIRED");
  }
  return Object.freeze({
    availability: "available",
    numerator,
    denominator,
    value: numerator / denominator,
  });
}

function unavailableFirstCitationRate(): UnavailableRatioMetric {
  return Object.freeze({
    availability: "not_available",
    numerator: null,
    denominator: null,
    value: null,
    reason: "SOURCE_ORDER_NOT_AVAILABLE",
  });
}

function assessSampleCount(count: number): ConsumerSampleAssessment {
  if (count < 5) {
    return "individual_observation";
  }
  if (count < 20) {
    return "descriptive_trend_insufficient_sample";
  }
  return "descriptive_only";
}

function assertMetricSampleState(
  sample: ConsumerObservationMetricSample,
): void {
  if (
    !(OBSERVATION_VERIFICATION_STATUSES as readonly string[]).includes(
      sample.verificationStatus,
    )
  ) {
    throw new Error("INVALID_OBSERVATION_VERIFICATION_STATUS");
  }
  if (
    sample.evidenceGrade !== null &&
    !(OBSERVATION_EVIDENCE_GRADES as readonly string[]).includes(
      sample.evidenceGrade,
    )
  ) {
    throw new Error("INVALID_OBSERVATION_EVIDENCE_GRADE");
  }
  if (
    !(CONSUMER_COLLECTION_METHODS as readonly string[]).includes(
      sample.collectionMethod,
    )
  ) {
    throw new Error("INVALID_CONSUMER_COLLECTION_METHOD");
  }
  if (
    (sample.verificationStatus === "needs_review" ||
      sample.verificationStatus === "rejected") &&
    sample.evidenceGrade !== null
  ) {
    throw new Error("UNCONFIRMED_CONSUMER_EVIDENCE_GRADE_FORBIDDEN");
  }
  if (
    sample.verificationStatus !== "confirmed" &&
    (sample.evidenceGrade === "web_confirmed_capture" ||
      sample.evidenceGrade === "web_confirmed_manual")
  ) {
    throw new Error("UNCONFIRMED_CONSUMER_EVIDENCE_GRADE_FORBIDDEN");
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeDomain(value: string): string {
  const normalized = normalizeRequiredText(value, "INVALID_REGISTRABLE_DOMAIN")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    normalized.includes("://") ||
    normalized.includes("/") ||
    normalized.includes(" ")
  ) {
    throw new Error("INVALID_REGISTRABLE_DOMAIN");
  }
  return normalized;
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTimestamp(value: string): string {
  const normalized = normalizeRequiredText(value, "INVALID_COMPUTED_AT");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error("INVALID_COMPUTED_AT");
  }
  return normalized;
}
