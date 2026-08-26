import {
  assertSourceNominationParseReviewIntegrity,
  hasScopeAccess,
  type SourceNominationParseReview,
  type SourceNominationParseReviewStatus,
  type WentianPrincipal,
} from "@wentian/domain";

import type { SourceNominationParseReviewRepository } from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface ListSourceNominationParseReviewsCommand {
  readonly scopeId: string;
  readonly status: SourceNominationParseReviewStatus;
}

export class ListSourceNominationParseReviewsService {
  private readonly reviews: SourceNominationParseReviewRepository;

  constructor(reviews: SourceNominationParseReviewRepository) {
    this.reviews = reviews;
  }

  async execute(
    principal: WentianPrincipal,
    command: ListSourceNominationParseReviewsCommand,
  ): Promise<readonly SourceNominationParseReview[]> {
    if (!hasScopeAccess(principal, command.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    assertReviewStatus(command.status);
    const reviews = await this.reviews.listByStatus(
      command.scopeId,
      command.status,
    );
    const ids = new Set<string>();
    const responseIds = new Set<string>();
    for (const review of reviews) {
      assertSourceNominationParseReviewIntegrity(review);
      if (
        review.scopeId !== command.scopeId ||
        review.status !== command.status ||
        ids.has(review.id) ||
        responseIds.has(review.responseId)
      ) {
        throw new Error("SOURCE_NOMINATION_REVIEW_QUERY_RESULT_MISMATCH");
      }
      ids.add(review.id);
      responseIds.add(review.responseId);
    }
    return Object.freeze([...reviews]);
  }
}

function assertReviewStatus(status: SourceNominationParseReviewStatus): void {
  if (
    status !== "needs_review" &&
    status !== "confirmed" &&
    status !== "rejected"
  ) {
    throw new Error("INVALID_SOURCE_NOMINATION_REVIEW_STATUS");
  }
}
