import {
  assertConfirmedConsumerObservationRecordIntegrity,
  assertSourceNominationParseReviewIntegrity,
  createSourceNominationParseReview,
  hasScopeAccess,
  type SourceNominationParseReview,
  type WentianPrincipal,
} from "@wentian/domain";

import { assertConsumerSourceNominationResponseRunBindings } from "./confirm-source-nomination-parse-review.ts";
import type {
  ConfirmedConsumerObservationRecordRepository,
  ConsumerObservationRunRepository,
  ExplicitSourceNominationExtractor,
  SourceNominationParseReviewRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export interface CreateSourceNominationParseReviewCommand {
  readonly scopeId: string;
  readonly responseId: string;
}

export interface CreateSourceNominationParseReviewResult {
  readonly review: SourceNominationParseReview;
  readonly created: boolean;
  readonly extractionStatus: "review_required" | "no_explicit_source";
  readonly warning: "EXPLICIT_ONLY_NO_NAME_TO_DOMAIN_INFERENCE";
}

export interface CreateSourceNominationParseReviewDependencies {
  readonly reviews: SourceNominationParseReviewRepository;
  readonly responses: ConfirmedConsumerObservationRecordRepository;
  readonly runs: ConsumerObservationRunRepository;
  readonly extractor: ExplicitSourceNominationExtractor;
  readonly newId: () => string;
  readonly now: () => string;
}

export class CreateSourceNominationParseReviewService {
  private readonly dependencies: CreateSourceNominationParseReviewDependencies;

  constructor(dependencies: CreateSourceNominationParseReviewDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: CreateSourceNominationParseReviewCommand,
  ): Promise<CreateSourceNominationParseReviewResult> {
    assertWriteAccess(principal, command.scopeId);
    const response = await this.dependencies.responses.findRecordById(
      command.scopeId,
      command.responseId,
    );
    if (!response) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    assertConfirmedConsumerObservationRecordIntegrity(response);
    const run = await this.dependencies.runs.findRunById(
      command.scopeId,
      response.runId,
    );
    if (!run) {
      throw new Error("SOURCE_NOMINATION_RUN_NOT_FOUND");
    }
    assertConsumerSourceNominationResponseRunBindings(response, run);

    const existing = await this.dependencies.reviews.findByResponseId(
      command.scopeId,
      response.id,
    );
    if (existing) {
      assertSourceNominationParseReviewIntegrity(existing);
      return resultFromReview(existing, false);
    }

    const extraction = this.dependencies.extractor.extract(response.answerText);
    assertExtractionResult(extraction);
    const createdAt = this.dependencies.now();
    if (Date.parse(createdAt) < Date.parse(response.confirmedAt)) {
      throw new Error("NOMINATION_REVIEW_BEFORE_RESPONSE_CONFIRMATION");
    }
    const review = createSourceNominationParseReview({
      id: this.dependencies.newId(),
      scopeId: response.scopeId,
      responseId: response.id,
      proposedItems: extraction.candidates.map((candidate) => ({
        registrableDomain: candidate.registrableDomain,
        position: candidate.position,
        informationType: candidate.informationType,
        reason: candidate.reason,
      })),
      extractionVersion: extraction.extractionVersion,
      validExplicitOccurrenceCount: extraction.validExplicitOccurrenceCount,
      rejectedExplicitOccurrenceCount:
        extraction.rejectedExplicitOccurrenceCount,
      extractionTruncated: extraction.truncated,
      createdAt,
    });
    try {
      await this.dependencies.reviews.create(review);
      return Object.freeze({
        review,
        created: true,
        extractionStatus: extraction.status,
        warning: extraction.warning,
      });
    } catch (error) {
      const concurrent = await this.dependencies.reviews.findByResponseId(
        command.scopeId,
        response.id,
      );
      if (concurrent) {
        assertSourceNominationParseReviewIntegrity(concurrent);
        return resultFromReview(concurrent, false);
      }
      throw error;
    }
  }
}

function assertExtractionResult(
  extraction: ReturnType<ExplicitSourceNominationExtractor["extract"]>,
): void {
  const expectedStatus =
    extraction.candidates.length > 0 ? "review_required" : "no_explicit_source";
  if (
    extraction.status !== expectedStatus ||
    extraction.warning !== "EXPLICIT_ONLY_NO_NAME_TO_DOMAIN_INFERENCE" ||
    extraction.candidates.some(
      (candidate) =>
        candidate.extractionEvidence !== "visible_http_url" &&
        candidate.extractionEvidence !== "visible_bare_domain",
    )
  ) {
    throw new Error("SOURCE_NOMINATION_EXTRACTION_RESULT_MISMATCH");
  }
}

function resultFromReview(
  review: SourceNominationParseReview,
  created: boolean,
): CreateSourceNominationParseReviewResult {
  return Object.freeze({
    review,
    created,
    extractionStatus:
      review.initialProposedItemCount > 0
        ? "review_required"
        : "no_explicit_source",
    warning: "EXPLICIT_ONLY_NO_NAME_TO_DOMAIN_INFERENCE",
  });
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
