import type {
  AiVisibilityCitedSourceEvent,
  AiVisibilityNominatedSourceEvent,
  CaptureTokenClaims,
  ConfirmedConsumerObservationRecord,
  ConsumerCaptureArtifact,
  ConsumerCollectionMethod,
  ConsumerNominationContext,
  ConsumerObservationExperimentKind,
  ConsumerObservationMetricSample,
  ConsumerObservationSampleBasis,
  ConsumerObservationRun,
  ConsumerObservationTask,
  ConsumerSurfaceProfileVersion,
  QuerySetSnapshot,
  QuerySetSourceType,
  Scope,
  NominationValidationMethod,
  SourceNominationMetricSample,
  SourceNominationParseReview,
  SourceNominationParseReviewStatus,
} from "@wentian/domain";

export interface AiVisibilityCitedSourceEventRepository {
  createMany(events: readonly AiVisibilityCitedSourceEvent[]): Promise<void>;
  listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityCitedSourceEvent[]>;
}

export interface SourceNominationParseReviewRepository {
  create(review: SourceNominationParseReview): Promise<void>;
  findById(
    scopeId: string,
    reviewId: string,
  ): Promise<SourceNominationParseReview | null>;
  findByResponseId(
    scopeId: string,
    responseId: string,
  ): Promise<SourceNominationParseReview | null>;
  listByStatus(
    scopeId: string,
    status: SourceNominationParseReviewStatus,
  ): Promise<readonly SourceNominationParseReview[]>;
  save(
    review: SourceNominationParseReview,
    expectedVersion: number,
  ): Promise<SourceNominationParseReview>;
}

export interface ExplicitSourceNominationExtraction {
  readonly extractionVersion: string;
  readonly status: "review_required" | "no_explicit_source";
  readonly candidates: readonly {
    readonly registrableDomain: string;
    readonly position: number;
    readonly informationType: null;
    readonly reason: null;
    readonly extractionEvidence: "visible_http_url" | "visible_bare_domain";
  }[];
  readonly validExplicitOccurrenceCount: number;
  readonly rejectedExplicitOccurrenceCount: number;
  readonly truncated: boolean;
  readonly warning: "EXPLICIT_ONLY_NO_NAME_TO_DOMAIN_INFERENCE";
}

export interface ExplicitSourceNominationExtractor {
  extract(answerText: string): ExplicitSourceNominationExtraction;
}

export interface AiVisibilityNominatedSourceEventRepository {
  createMany(
    events: readonly AiVisibilityNominatedSourceEvent[],
  ): Promise<void>;
  listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityNominatedSourceEvent[]>;
}

export interface AiVisibilityNominatedSourceEventProjector {
  project(input: {
    readonly scopeId: string;
    readonly runId: string;
    readonly responseId: string;
    readonly querySnapshotItemId: string;
    readonly sampleIndex: number;
    readonly validationMethod: NominationValidationMethod;
    readonly nominations: readonly {
      readonly registrableDomain: string;
      readonly position: number | null;
      readonly informationType?: string | null;
      readonly reason?: string | null;
    }[];
    readonly newId: () => string;
    readonly createdAt: string;
  }): readonly AiVisibilityNominatedSourceEvent[];
}

export interface SourceNominationParseReviewConfirmationCommit {
  readonly review: SourceNominationParseReview;
  readonly expectedReviewVersion: number;
  readonly response: ConfirmedConsumerObservationRecord;
  readonly sourceEvents: readonly AiVisibilityNominatedSourceEvent[];
}

export interface SourceNominationParseReviewRejectionCommit {
  readonly review: SourceNominationParseReview;
  readonly expectedReviewVersion: number;
  readonly response: ConfirmedConsumerObservationRecord;
}

export interface SourceNominationParseReviewTransactionRepository {
  commitConfirmation(
    input: SourceNominationParseReviewConfirmationCommit,
  ): Promise<void>;
  commitRejection(
    input: SourceNominationParseReviewRejectionCommit,
  ): Promise<void>;
}

export interface ConsumerObservationConfirmationCommit {
  readonly task: ConsumerObservationTask;
  readonly expectedTaskVersion: number;
  readonly record: ConfirmedConsumerObservationRecord;
  readonly sourceEvents: readonly AiVisibilityCitedSourceEvent[];
}

export interface ConsumerObservationConfirmationTransactionRepository {
  commitConfirmation(
    input: ConsumerObservationConfirmationCommit,
  ): Promise<void>;
}

export interface ConfirmedConsumerObservationSourceEventProjector {
  project(input: {
    readonly record: ConfirmedConsumerObservationRecord;
    readonly newId: () => string;
    readonly createdAt: string;
  }): readonly AiVisibilityCitedSourceEvent[];
}

export interface ConfirmedConsumerObservationMetricSampleProjector {
  readonly normalizationVersion: string;
  project(input: {
    readonly run: ConsumerObservationRun;
    readonly record: ConfirmedConsumerObservationRecord;
    readonly surfaceProfile: ConsumerSurfaceProfileVersion;
  }): ConsumerObservationMetricSample;
}

export interface ConsumerSourceNominationMetricSampleProjector {
  readonly normalizationVersion: string;
  project(input: {
    readonly run: ConsumerObservationRun;
    readonly response: ConfirmedConsumerObservationRecord;
    readonly review: SourceNominationParseReview;
    readonly sourceEvents: readonly AiVisibilityNominatedSourceEvent[];
  }): SourceNominationMetricSample;
}

export interface ConfirmedConsumerObservationRecordRepository {
  create(record: ConfirmedConsumerObservationRecord): Promise<void>;
  findRecordById(
    scopeId: string,
    recordId: string,
  ): Promise<ConfirmedConsumerObservationRecord | null>;
  listByRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConfirmedConsumerObservationRecord[]>;
  listSampleReferencesByRun?(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConfirmedConsumerObservationSampleReference[]>;
}

export interface ConfirmedConsumerObservationSampleReference {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
}

export interface ConsumerSurfaceProfileVersionRepository {
  findById(
    surfaceProfileVersionId: string,
  ): Promise<ConsumerSurfaceProfileVersion | null>;
  findActiveBySurfaceCode(
    surfaceCode: string,
  ): Promise<ConsumerSurfaceProfileVersion | null>;
}

export interface ConsumerObservationRunRepository {
  findRunById(
    scopeId: string,
    runId: string,
  ): Promise<ConsumerObservationRun | null>;
  createWithTasks(
    run: ConsumerObservationRun,
    snapshot: QuerySetSnapshot,
    tasks: readonly ConsumerObservationTask[],
  ): Promise<void>;
  listTasksForRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConsumerObservationTask[]>;
  saveRun(
    run: ConsumerObservationRun,
    expectedVersion: number,
  ): Promise<ConsumerObservationRun>;
}

export interface ConsumerObservationMetricSampleBatch {
  readonly scopeId: string;
  readonly runId: string;
  readonly querySetSnapshotHash: string;
  readonly querySetSourceType: QuerySetSourceType;
  readonly geoConnectorContractVersion: string | null;
  readonly experimentKind: ConsumerObservationExperimentKind;
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly nominationContext: ConsumerNominationContext | null;
  readonly surfaceProfileVersionId: string;
  readonly consumerSurfaceCode: string;
  readonly normalizationVersion: string;
  readonly sampleBasis: ConsumerObservationSampleBasis;
  readonly samples: readonly ConsumerObservationMetricSample[];
}

export interface ConsumerObservationMetricSampleBatchRepository {
  findByScopeAndRunId(
    scopeId: string,
    runId: string,
  ): Promise<ConsumerObservationMetricSampleBatch | null>;
}

export interface ConsumerSourceNominationMetricSampleBatch {
  readonly scopeId: string;
  readonly runId: string;
  readonly querySetSnapshotHash: string;
  readonly querySetSourceType: QuerySetSourceType;
  readonly geoConnectorContractVersion: string | null;
  readonly experimentKind: "source_nomination";
  readonly collectionMethod: ConsumerCollectionMethod;
  readonly nominationContext: ConsumerNominationContext;
  readonly surfaceProfileVersionId: string;
  readonly consumerSurfaceCode: string;
  readonly normalizationVersion: string;
  readonly unsupportedInternalClaimSampleCount: number;
  readonly unsupportedInternalClaimAssessmentVersions: readonly string[];
  readonly sampleBasis: ConsumerObservationSampleBasis;
  readonly samples: readonly SourceNominationMetricSample[];
}

export interface ScopeRepository {
  findById(scopeId: string): Promise<Scope | null>;
  listByIds(scopeIds: readonly string[]): Promise<readonly Scope[]>;
}

export interface QuerySetSnapshotRepository {
  findById(
    scopeId: string,
    snapshotId: string,
  ): Promise<QuerySetSnapshot | null>;
  getOrCreate(snapshot: QuerySetSnapshot): Promise<{
    readonly snapshot: QuerySetSnapshot;
    readonly created: boolean;
  }>;
}

export interface ConsumerObservationTaskRepository {
  findById(
    scopeId: string,
    taskId: string,
  ): Promise<ConsumerObservationTask | null>;
  save(
    task: ConsumerObservationTask,
    expectedVersion: number,
  ): Promise<ConsumerObservationTask>;
}

export interface CaptureTokenNonceRepository {
  consumeOnce(nonce: string): Promise<boolean>;
}

export interface CaptureTokenVerifier {
  verify(token: string): Promise<CaptureTokenClaims>;
}

export interface ConsumerCaptureArtifactBindingRepository {
  create(artifact: ConsumerCaptureArtifact): Promise<void>;
  findById(
    scopeId: string,
    artifactId: string,
  ): Promise<ConsumerCaptureArtifact | null>;
  purge(scopeId: string, artifactId: string): Promise<boolean>;
}

export interface ConsumerCaptureSubmissionCommit {
  readonly task: ConsumerObservationTask;
  readonly expectedTaskVersion: number;
  readonly artifact: ConsumerCaptureArtifact;
  readonly captureTokenNonce: string;
  readonly consumedAt: string;
}

export interface ConsumerCaptureSubmissionTransactionRepository {
  commitCapture(input: ConsumerCaptureSubmissionCommit): Promise<void>;
}
