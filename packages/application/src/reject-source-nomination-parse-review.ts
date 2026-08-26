import {
  assertConfirmedConsumerObservationRecordIntegrity,
  hasScopeAccess,
  rejectSourceNominationParseReview,
  type SourceNominationParseReview,
  type WentianPrincipal,
} from "@wentian/domain";

import { assertConsumerSourceNominationReviewBindings } from "./confirm-source-nomination-parse-review.ts";
import type {
  ConfirmedConsumerObservationRecordRepository,
  ConsumerObservationRunRepository,
  SourceNominationParseReviewRepository,
  SourceNominationParseReviewTransactionRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface RejectSourceNominationParseReviewCommand {
  readonly scopeId: string;
  readonly reviewId: string;
  readonly reviewVersion: number;
  readonly rejectionReason: string;
  readonly occurredAt: string;
}

export interface RejectSourceNominationParseReviewDependencies {
  readonly reviews: SourceNominationParseReviewRepository;
  readonly responses: ConfirmedConsumerObservationRecordRepository;
  readonly runs: ConsumerObservationRunRepository;
  readonly transactions: SourceNominationParseReviewTransactionRepository;
}

export class RejectSourceNominationParseReviewService {
  private readonly dependencies: RejectSourceNominationParseReviewDependencies;

  constructor(dependencies: RejectSourceNominationParseReviewDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: RejectSourceNominationParseReviewCommand,
  ): Promise<SourceNominationParseReview> {
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

    const rejected = rejectSourceNominationParseReview(
      review,
      command.rejectionReason,
      {
        scopeId: command.scopeId,
        reviewedBy: principal.userId,
        expectedVersion: command.reviewVersion,
        occurredAt: command.occurredAt,
      },
    );
    await this.dependencies.transactions.commitRejection({
      review: rejected,
      expectedReviewVersion: review.version,
      response,
    });
    return rejected;
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
