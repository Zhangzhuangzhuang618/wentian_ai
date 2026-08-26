import {
  assertConfirmedConsumerObservationRecordIntegrity,
  confirmSourceNominationParseReview,
  hasSameConsumerSessionConditions,
  hasScopeAccess,
  type AiVisibilityNominatedSourceEvent,
  type ConfirmedConsumerObservationRecord,
  type ConsumerObservationRun,
  type SourceNominationParseReview,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  AiVisibilityNominatedSourceEventProjector,
  ConfirmedConsumerObservationRecordRepository,
  ConsumerObservationRunRepository,
  SourceNominationParseReviewRepository,
  SourceNominationParseReviewTransactionRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface ConfirmSourceNominationParseReviewCommand {
  readonly scopeId: string;
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly reviewedItems: readonly {
    readonly registrableDomain: string;
    readonly position: number | null;
    readonly informationType?: string | null;
    readonly reason?: string | null;
  }[];
  readonly occurredAt: string;
}

export interface ConfirmSourceNominationParseReviewResult {
  readonly review: SourceNominationParseReview;
  readonly sourceEvents: readonly AiVisibilityNominatedSourceEvent[];
}

export interface ConfirmSourceNominationParseReviewDependencies {
  readonly reviews: SourceNominationParseReviewRepository;
  readonly responses: ConfirmedConsumerObservationRecordRepository;
  readonly runs: ConsumerObservationRunRepository;
  readonly projector: AiVisibilityNominatedSourceEventProjector;
  readonly transactions: SourceNominationParseReviewTransactionRepository;
  readonly newId: () => string;
}

export class ConfirmSourceNominationParseReviewService {
  private readonly dependencies: ConfirmSourceNominationParseReviewDependencies;

  constructor(dependencies: ConfirmSourceNominationParseReviewDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: ConfirmSourceNominationParseReviewCommand,
  ): Promise<ConfirmSourceNominationParseReviewResult> {
    assertWriteAccess(principal, command.scopeId);
    const review = await this.dependencies.reviews.findById(
      command.scopeId,
      command.reviewId,
    );
    if (!review) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    const response = await this.dependencies.responses.findRecordById(
      command.scopeId,
      review.responseId,
    );
    if (!response) {
      throw new Error("SOURCE_NOMINATION_RESPONSE_NOT_FOUND");
    }
    assertConfirmedConsumerObservationRecordIntegrity(response);
    const run = await this.dependencies.runs.findRunById(
      command.scopeId,
      response.runId,
    );
    if (!run) {
      throw new Error("SOURCE_NOMINATION_RUN_NOT_FOUND");
    }
    assertConsumerSourceNominationReviewBindings(review, response, run);

    const confirmed = confirmSourceNominationParseReview(
      review,
      command.reviewedItems,
      {
        scopeId: command.scopeId,
        reviewedBy: principal.userId,
        expectedVersion: command.reviewVersion,
        occurredAt: command.occurredAt,
      },
    );
    const sourceEvents = this.dependencies.projector.project({
      scopeId: response.scopeId,
      runId: response.runId,
      responseId: response.id,
      querySnapshotItemId: response.querySnapshotItemId,
      sampleIndex: response.sampleIndex,
      validationMethod: "human_confirmed",
      nominations: confirmed.proposedItems,
      newId: this.dependencies.newId,
      createdAt: confirmed.reviewedAt!,
    });

    await this.dependencies.transactions.commitConfirmation({
      review: confirmed,
      expectedReviewVersion: review.version,
      response,
      sourceEvents,
    });
    return Object.freeze({ review: confirmed, sourceEvents });
  }
}

export function assertConsumerSourceNominationReviewBindings(
  review: SourceNominationParseReview,
  response: ConfirmedConsumerObservationRecord,
  run: ConsumerObservationRun,
): void {
  if (
    review.scopeId !== response.scopeId ||
    review.responseId !== response.id
  ) {
    throw new Error("SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH");
  }
  assertConsumerSourceNominationResponseRunBindings(response, run);
}

export function assertConsumerSourceNominationResponseRunBindings(
  response: ConfirmedConsumerObservationRecord,
  run: ConsumerObservationRun,
): void {
  if (
    response.scopeId !== run.scopeId ||
    response.runId !== run.id ||
    response.surfaceProfileVersionId !== run.surfaceProfileVersionId ||
    response.collectionMethod !== run.collectionMethod ||
    response.sampleIndex > run.requestedSampleCount ||
    run.experimentKind !== "source_nomination" ||
    !run.nominationContext ||
    !hasSameConsumerSessionConditions(
      run.sessionConditions,
      response.visibleMetadata,
    )
  ) {
    throw new Error("SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH");
  }
}

function assertWriteAccess(principal: WentianPrincipal, scopeId: string): void {
  if (!hasScopeAccess(principal, scopeId)) {
    throw new WentianApplicationError("RESOURCE_NOT_FOUND");
  }
  if (
    principal.role !== "owner" &&
    principal.role !== "admin" &&
    principal.role !== "analyst"
  ) {
    throw new WentianApplicationError("ACTION_FORBIDDEN");
  }
}
