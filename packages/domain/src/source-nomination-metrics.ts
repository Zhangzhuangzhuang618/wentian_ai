export const SOURCE_NOMINATION_METHODOLOGY_VERSION =
  "ai-source-observatory@1" as const;

export const SOURCE_NOMINATION_EVIDENCE_WARNING =
  "SELF_REPORTED_NOMINATION_NOT_OBSERVED_RETRIEVAL_OR_CITATION" as const;

export type SourceNominationContext =
  "unaided" | "search_assisted" | "surface_unknown";

export type SourceNominationValidationStatus =
  "schema_validated" | "human_confirmed" | "needs_review" | "rejected";

export interface SourceNominationMetricItem {
  readonly registrableDomain: string;
  readonly position: number | null;
}

export interface SourceNominationMetricSample {
  readonly id: string;
  readonly querySnapshotItemId: string;
  readonly nominationContext: SourceNominationContext;
  readonly validationStatus: SourceNominationValidationStatus;
  readonly nominations: readonly SourceNominationMetricItem[];
}

export interface SourceNominationSampleBasis {
  readonly planned: number;
  readonly successful: number;
  readonly failed: number;
}

export interface ComputeSourceNominationMetricsInput {
  readonly scopeId: string;
  readonly querySetSnapshotHash: string;
  readonly normalizationVersion: string;
  readonly computedAt: string;
  readonly sampleBasis: SourceNominationSampleBasis;
  readonly samples: readonly SourceNominationMetricSample[];
}

export interface AvailableNominationRatio {
  readonly availability: "available";
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
}

export interface UnavailableFirstNominationRate {
  readonly availability: "not_available";
  readonly numerator: null;
  readonly denominator: null;
  readonly value: null;
  readonly reason: "NO_VALID_NOMINATION_ORDER";
}

export interface SourceNominationDomainMetric {
  readonly registrableDomain: string;
  readonly nominationRate: AvailableNominationRatio;
  readonly firstNominationRate:
    AvailableNominationRatio | UnavailableFirstNominationRate;
  readonly nominationShare: AvailableNominationRatio;
}

export interface SourceNominationQuestionStability {
  readonly querySnapshotItemId: string;
  readonly value: number;
  readonly pairCount: number;
  readonly noNominationPairCount: number;
}

export type SourceNominationStability =
  | {
      readonly availability: "available";
      readonly value: number;
      readonly questionCount: number;
      readonly pairCount: number;
      readonly noNominationPairCount: number;
      readonly questions: readonly SourceNominationQuestionStability[];
    }
  | {
      readonly availability: "not_available";
      readonly value: null;
      readonly questionCount: 0;
      readonly pairCount: 0;
      readonly noNominationPairCount: number;
      readonly questions: readonly SourceNominationQuestionStability[];
      readonly reason:
        | "INSUFFICIENT_REPEATED_SAMPLES"
        | "ALL_SAMPLE_PAIRS_HAVE_NO_NOMINATIONS";
    };

export interface SourceNominationMetricGroup {
  readonly nominationContext: SourceNominationContext;
  readonly validatedSampleCount: number;
  readonly validationMethodSampleCounts: Readonly<{
    schemaValidated: number;
    humanConfirmed: number;
  }>;
  readonly nominationEventCount: number;
  readonly domains: readonly SourceNominationDomainMetric[];
  readonly stability: SourceNominationStability;
}

export interface SourceNominationMetricReport {
  readonly methodologyVersion: typeof SOURCE_NOMINATION_METHODOLOGY_VERSION;
  readonly normalizationVersion: string;
  readonly scopeId: string;
  readonly querySetSnapshotHash: string;
  readonly computedAt: string;
  readonly sampleBasis: SourceNominationSampleBasis;
  readonly availability: "available" | "not_available";
  readonly unavailableReason: "NO_VALIDATED_NOMINATION_SAMPLES" | null;
  readonly validatedSampleCount: number;
  readonly excludedParseCounts: Readonly<{
    needsReview: number;
    rejected: number;
  }>;
  readonly groups: readonly SourceNominationMetricGroup[];
  readonly warnings: readonly [typeof SOURCE_NOMINATION_EVIDENCE_WARNING];
}

interface NormalizedNominationSample extends Omit<
  SourceNominationMetricSample,
  "nominations"
> {
  readonly nominations: readonly SourceNominationMetricItem[];
  readonly domainSet: ReadonlySet<string>;
  readonly hasValidOrder: boolean;
}

export function computeSourceNominationMetrics(
  input: ComputeSourceNominationMetricsInput,
): SourceNominationMetricReport {
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
  if (input.samples.length !== sampleBasis.successful) {
    throw new Error("NOMINATION_SUCCESSFUL_SAMPLE_COVERAGE_MISMATCH");
  }

  const sampleIds = new Set<string>();
  const eligibleSamples: NormalizedNominationSample[] = [];
  const excludedParseCounts = { needsReview: 0, rejected: 0 };
  for (const sample of input.samples) {
    const id = normalizeRequiredText(sample.id, "INVALID_NOMINATION_SAMPLE_ID");
    if (sampleIds.has(id)) {
      throw new Error("DUPLICATE_NOMINATION_SAMPLE_ID");
    }
    sampleIds.add(id);
    assertNominationContext(sample.nominationContext);
    assertValidationStatus(sample.validationStatus);
    if (
      sample.validationStatus === "needs_review" ||
      sample.validationStatus === "rejected"
    ) {
      if (sample.nominations.length > 0) {
        throw new Error("UNVALIDATED_NOMINATIONS_FORBIDDEN");
      }
      excludedParseCounts[
        sample.validationStatus === "needs_review" ? "needsReview" : "rejected"
      ] += 1;
      continue;
    }
    eligibleSamples.push(normalizeSample(sample, id));
  }

  const samplesByContext = new Map<
    SourceNominationContext,
    NormalizedNominationSample[]
  >();
  for (const sample of eligibleSamples) {
    const samples = samplesByContext.get(sample.nominationContext) ?? [];
    samples.push(sample);
    samplesByContext.set(sample.nominationContext, samples);
  }
  const groups = [...samplesByContext.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([context, samples]) => computeGroup(context, samples));

  return Object.freeze({
    methodologyVersion: SOURCE_NOMINATION_METHODOLOGY_VERSION,
    normalizationVersion,
    scopeId,
    querySetSnapshotHash,
    computedAt,
    sampleBasis,
    availability: groups.length > 0 ? "available" : "not_available",
    unavailableReason:
      groups.length > 0 ? null : "NO_VALIDATED_NOMINATION_SAMPLES",
    validatedSampleCount: eligibleSamples.length,
    excludedParseCounts: Object.freeze(excludedParseCounts),
    groups: Object.freeze(groups),
    warnings: Object.freeze([SOURCE_NOMINATION_EVIDENCE_WARNING] as const),
  });
}

function normalizeSample(
  sample: SourceNominationMetricSample,
  id: string,
): NormalizedNominationSample {
  if (sample.nominations.length > 10) {
    throw new Error("TOO_MANY_NOMINATIONS");
  }
  const querySnapshotItemId = normalizeRequiredText(
    sample.querySnapshotItemId,
    "INVALID_QUERY_SNAPSHOT_ITEM_ID",
  );
  const nominations = sample.nominations.map((nomination) =>
    Object.freeze({
      registrableDomain: normalizeDomain(nomination.registrableDomain),
      position: normalizePosition(nomination.position),
    }),
  );
  const positionedCount = nominations.filter(
    (nomination) => nomination.position !== null,
  ).length;
  if (positionedCount > 0 && positionedCount !== nominations.length) {
    throw new Error("NOMINATION_POSITION_ALL_OR_NONE_REQUIRED");
  }
  if (positionedCount > 0) {
    const positions = nominations.map((nomination) => nomination.position!);
    const uniquePositions = new Set(positions);
    if (
      uniquePositions.size !== positions.length ||
      positions.some((position) => position > positions.length)
    ) {
      throw new Error("INVALID_NOMINATION_POSITION_SEQUENCE");
    }
  }
  return Object.freeze({
    ...sample,
    id,
    querySnapshotItemId,
    nominations: Object.freeze(nominations),
    domainSet: new Set(
      nominations.map((nomination) => nomination.registrableDomain),
    ),
    hasValidOrder: nominations.length > 0 && positionedCount > 0,
  });
}

function computeGroup(
  nominationContext: SourceNominationContext,
  samples: readonly NormalizedNominationSample[],
): SourceNominationMetricGroup {
  const validatedSampleCount = samples.length;
  const nominationEventCount = samples.reduce(
    (sum, sample) => sum + sample.nominations.length,
    0,
  );
  const orderedSamples = samples.filter((sample) => sample.hasValidOrder);
  const domains = new Set<string>();
  for (const sample of samples) {
    for (const domain of sample.domainSet) {
      domains.add(domain);
    }
  }

  const domainMetrics = [...domains]
    .sort((left, right) => left.localeCompare(right))
    .map((registrableDomain) => {
      const nominatedSampleCount = samples.filter((sample) =>
        sample.domainSet.has(registrableDomain),
      ).length;
      const firstNominationCount = orderedSamples.filter((sample) =>
        sample.nominations.some(
          (nomination) =>
            nomination.registrableDomain === registrableDomain &&
            nomination.position === 1,
        ),
      ).length;
      const eventCount = samples.reduce(
        (sum, sample) =>
          sum +
          sample.nominations.filter(
            (nomination) => nomination.registrableDomain === registrableDomain,
          ).length,
        0,
      );
      return Object.freeze({
        registrableDomain,
        nominationRate: availableRatio(
          nominatedSampleCount,
          validatedSampleCount,
        ),
        firstNominationRate:
          orderedSamples.length > 0
            ? availableRatio(firstNominationCount, orderedSamples.length)
            : unavailableFirstNominationRate(),
        nominationShare: availableRatio(eventCount, nominationEventCount),
      });
    });

  return Object.freeze({
    nominationContext,
    validatedSampleCount,
    validationMethodSampleCounts: Object.freeze({
      schemaValidated: samples.filter(
        (sample) => sample.validationStatus === "schema_validated",
      ).length,
      humanConfirmed: samples.filter(
        (sample) => sample.validationStatus === "human_confirmed",
      ).length,
    }),
    nominationEventCount,
    domains: Object.freeze(domainMetrics),
    stability: computeStability(samples),
  });
}

function computeStability(
  samples: readonly NormalizedNominationSample[],
): SourceNominationStability {
  const samplesByQuery = new Map<string, NormalizedNominationSample[]>();
  for (const sample of samples) {
    const querySamples = samplesByQuery.get(sample.querySnapshotItemId) ?? [];
    querySamples.push(sample);
    samplesByQuery.set(sample.querySnapshotItemId, querySamples);
  }

  const questions: SourceNominationQuestionStability[] = [];
  let totalPairCandidates = 0;
  let totalPairCount = 0;
  let totalNoNominationPairCount = 0;
  for (const [querySnapshotItemId, querySamples] of [...samplesByQuery].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const values: number[] = [];
    let noNominationPairCount = 0;
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
          noNominationPairCount += 1;
          totalNoNominationPairCount += 1;
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
          noNominationPairCount,
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
      noNominationPairCount: totalNoNominationPairCount,
      questions: Object.freeze([]),
      reason:
        totalPairCandidates === 0
          ? "INSUFFICIENT_REPEATED_SAMPLES"
          : "ALL_SAMPLE_PAIRS_HAVE_NO_NOMINATIONS",
    });
  }
  return Object.freeze({
    availability: "available",
    value: mean(questions.map((question) => question.value)),
    questionCount: questions.length,
    pairCount: totalPairCount,
    noNominationPairCount: totalNoNominationPairCount,
    questions: Object.freeze(questions),
  });
}

function normalizeSampleBasis(
  input: SourceNominationSampleBasis,
): SourceNominationSampleBasis {
  for (const [name, value] of [
    ["planned", input.planned],
    ["successful", input.successful],
    ["failed", input.failed],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`INVALID_NOMINATION_SAMPLE_BASIS:${name}`);
    }
  }
  if (input.successful + input.failed > input.planned) {
    throw new Error("NOMINATION_SAMPLE_BASIS_EXCEEDS_PLANNED");
  }
  return Object.freeze({ ...input });
}

function assertNominationContext(context: SourceNominationContext): void {
  if (
    context !== "unaided" &&
    context !== "search_assisted" &&
    context !== "surface_unknown"
  ) {
    throw new Error("INVALID_NOMINATION_CONTEXT");
  }
}

function assertValidationStatus(
  status: SourceNominationValidationStatus,
): void {
  if (
    status !== "schema_validated" &&
    status !== "human_confirmed" &&
    status !== "needs_review" &&
    status !== "rejected"
  ) {
    throw new Error("INVALID_NOMINATION_VALIDATION_STATUS");
  }
}

function normalizePosition(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("INVALID_NOMINATION_POSITION");
  }
  return value;
}

function availableRatio(
  numerator: number,
  denominator: number,
): AvailableNominationRatio {
  if (denominator <= 0 || numerator < 0 || numerator > denominator) {
    throw new Error("INVALID_NOMINATION_RATIO");
  }
  return Object.freeze({
    availability: "available",
    numerator,
    denominator,
    value: numerator / denominator,
  });
}

function unavailableFirstNominationRate(): UnavailableFirstNominationRate {
  return Object.freeze({
    availability: "not_available",
    numerator: null,
    denominator: null,
    value: null,
    reason: "NO_VALID_NOMINATION_ORDER",
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
  for (const item of left) {
    if (right.has(item)) {
      intersectionSize += 1;
    }
  }
  return intersectionSize / union.size;
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
  if (typeof value !== "string") {
    throw new Error(errorCode);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const normalized = normalizeRequiredText(value, "INVALID_TIMESTAMP");
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return normalized;
}
