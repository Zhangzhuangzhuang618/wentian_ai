import {
  assessPairedConsumerRunComparability,
  computeNominationCitationOverlap,
  hasScopeAccess,
  rankSourceEntriesByDomain,
  type AiVisibilityCitedSourceEvent,
  type AiVisibilityNominatedSourceEvent,
  type NominationCitationOverlapReport,
  type PairedConsumerRunComparabilityReport,
  type QuerySetSnapshot,
  type SourceEntryCountRanking,
  type SourceNominationParseReview,
  type WentianPrincipal,
} from "@wentian/domain";

import type {
  AiVisibilityCitedSourceEventRepository,
  AiVisibilityNominatedSourceEventRepository,
  ConfirmedConsumerObservationSampleReference,
  ConfirmedConsumerObservationRecordRepository,
  ConsumerObservationRunRepository,
  QuerySetSnapshotRepository,
  SourceNominationParseReviewRepository,
} from "./ports.ts";
import { WentianApplicationError } from "./services.ts";

export const CONSUMER_NOMINATION_CITATION_COMPARISON_METHODOLOGY_VERSION =
  "consumer-nomination-citation-comparison@1" as const;

export type ConsumerNominationCitationQuestionUnavailableReason =
  "NO_CONFIRMED_CITATION_SAMPLES" | "NO_VALIDATED_NOMINATION_SAMPLES";

export interface ConsumerNominationCitationQuestionComparison {
  readonly querySnapshotItemId: string;
  readonly availability: "available" | "not_available";
  readonly unavailableReasons: readonly ConsumerNominationCitationQuestionUnavailableReason[];
  readonly citationConfirmedSampleCount: number;
  readonly nominationValidatedSampleCount: number;
  readonly citationRanking: SourceEntryCountRanking;
  readonly nominationRanking: SourceEntryCountRanking;
  readonly overlap: NominationCitationOverlapReport | null;
}

export interface ConsumerNominationCitationComparisonReport {
  readonly methodologyVersion: typeof CONSUMER_NOMINATION_CITATION_COMPARISON_METHODOLOGY_VERSION;
  readonly scopeId: string;
  readonly naturalAnswerRunId: string;
  readonly sourceNominationRunId: string;
  readonly k: number;
  readonly comparability: PairedConsumerRunComparabilityReport;
  readonly questions: readonly ConsumerNominationCitationQuestionComparison[];
}

export interface GetConsumerNominationCitationComparisonCommand {
  readonly scopeId: string;
  readonly naturalAnswerRunId: string;
  readonly sourceNominationRunId: string;
  readonly k?: number;
}

export interface GetConsumerNominationCitationComparisonDependencies {
  readonly runs: ConsumerObservationRunRepository;
  readonly snapshots: QuerySetSnapshotRepository;
  readonly records: ConfirmedConsumerObservationRecordRepository;
  readonly citationEvents: AiVisibilityCitedSourceEventRepository;
  readonly nominationEvents: AiVisibilityNominatedSourceEventRepository;
  readonly nominationReviews: SourceNominationParseReviewRepository;
}

export class GetConsumerNominationCitationComparisonService {
  private readonly dependencies: GetConsumerNominationCitationComparisonDependencies;

  constructor(
    dependencies: GetConsumerNominationCitationComparisonDependencies,
  ) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: GetConsumerNominationCitationComparisonCommand,
  ): Promise<ConsumerNominationCitationComparisonReport> {
    if (!hasScopeAccess(principal, command.scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    const k = command.k ?? 10;
    assertValidK(k);
    const [naturalAnswerRun, sourceNominationRun] = await Promise.all([
      this.dependencies.runs.findRunById(
        command.scopeId,
        command.naturalAnswerRunId,
      ),
      this.dependencies.runs.findRunById(
        command.scopeId,
        command.sourceNominationRunId,
      ),
    ]);
    if (!naturalAnswerRun || !sourceNominationRun) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    if (
      naturalAnswerRun.id !== command.naturalAnswerRunId ||
      sourceNominationRun.id !== command.sourceNominationRunId ||
      naturalAnswerRun.scopeId !== command.scopeId ||
      sourceNominationRun.scopeId !== command.scopeId
    ) {
      throw new Error("COMPARISON_RUN_IDENTITY_MISMATCH");
    }

    const comparability = assessPairedConsumerRunComparability({
      naturalAnswerRun,
      sourceNominationRun,
    });
    if (comparability.status === "not_comparable") {
      return freezeReport({
        methodologyVersion:
          CONSUMER_NOMINATION_CITATION_COMPARISON_METHODOLOGY_VERSION,
        scopeId: command.scopeId,
        naturalAnswerRunId: naturalAnswerRun.id,
        sourceNominationRunId: sourceNominationRun.id,
        k,
        comparability,
        questions: [],
      });
    }

    const [snapshot, citationRecords, nominationRecords] = await Promise.all([
      this.dependencies.snapshots.findById(
        command.scopeId,
        naturalAnswerRun.querySetSnapshotId,
      ),
      listSampleReferences(
        this.dependencies.records,
        command.scopeId,
        naturalAnswerRun.id,
      ),
      listSampleReferences(
        this.dependencies.records,
        command.scopeId,
        sourceNominationRun.id,
      ),
    ]);
    if (!snapshot) {
      throw new Error("COMPARISON_QUERY_SET_SNAPSHOT_NOT_FOUND");
    }
    assertSnapshotBinding(
      snapshot,
      command.scopeId,
      naturalAnswerRun.querySetSnapshotId,
      naturalAnswerRun.querySetSnapshotHash,
      naturalAnswerRun.queryCount,
    );
    assertRecordSet(
      citationRecords,
      naturalAnswerRun.id,
      command.scopeId,
      naturalAnswerRun.successfulSampleCount,
      naturalAnswerRun.requestedSampleCount,
      snapshot,
    );
    assertRecordSet(
      nominationRecords,
      sourceNominationRun.id,
      command.scopeId,
      sourceNominationRun.successfulSampleCount,
      sourceNominationRun.requestedSampleCount,
      snapshot,
    );

    const citationEvidence = await this.loadCitationEvidence(citationRecords);
    const nominationEvidence =
      await this.loadValidatedNominationEvidence(nominationRecords);
    const questions = snapshot.items.map((item) => {
      const citationSampleCount = countRecordsForQuery(
        citationRecords,
        item.id,
      );
      const nominationSampleCount =
        nominationEvidence.validatedResponseIdsByQuery.get(item.id)?.size ?? 0;
      const citationEntries = citationEvidence.filter(
        (event) => event.querySnapshotItemId === item.id,
      );
      const nominationEntries = nominationEvidence.events.filter(
        (event) => event.querySnapshotItemId === item.id,
      );
      const citationRanking = rankSourceEntriesByDomain({
        querySnapshotItemId: item.id,
        role: "cited",
        entries: citationEntries.map((event) => ({
          entryId: event.id,
          querySnapshotItemId: event.querySnapshotItemId,
          role: event.role,
          registrableDomain: event.registrableDomain,
        })),
      });
      const nominationRanking = rankSourceEntriesByDomain({
        querySnapshotItemId: item.id,
        role: "nominated",
        entries: nominationEntries.map((event) => ({
          entryId: event.id,
          querySnapshotItemId: event.querySnapshotItemId,
          role: event.role,
          registrableDomain: event.registrableDomain,
        })),
      });
      const unavailableReasons: ConsumerNominationCitationQuestionUnavailableReason[] =
        [];
      if (citationSampleCount === 0) {
        unavailableReasons.push("NO_CONFIRMED_CITATION_SAMPLES");
      }
      if (nominationSampleCount === 0) {
        unavailableReasons.push("NO_VALIDATED_NOMINATION_SAMPLES");
      }
      const overlap =
        unavailableReasons.length === 0
          ? computeNominationCitationOverlap({
              querySnapshotItemId: item.id,
              k,
              rankedNominationDomains: nominationRanking.domains.map(
                (domain) => domain.registrableDomain,
              ),
              rankedCitationDomains: citationRanking.domains.map(
                (domain) => domain.registrableDomain,
              ),
            })
          : null;
      return Object.freeze({
        querySnapshotItemId: item.id,
        availability:
          unavailableReasons.length === 0 ? "available" : "not_available",
        unavailableReasons: Object.freeze(unavailableReasons),
        citationConfirmedSampleCount: citationSampleCount,
        nominationValidatedSampleCount: nominationSampleCount,
        citationRanking,
        nominationRanking,
        overlap,
      });
    });

    return freezeReport({
      methodologyVersion:
        CONSUMER_NOMINATION_CITATION_COMPARISON_METHODOLOGY_VERSION,
      scopeId: command.scopeId,
      naturalAnswerRunId: naturalAnswerRun.id,
      sourceNominationRunId: sourceNominationRun.id,
      k,
      comparability,
      questions,
    });
  }

  private async loadCitationEvidence(
    records: readonly ConfirmedConsumerObservationSampleReference[],
  ): Promise<readonly AiVisibilityCitedSourceEvent[]> {
    const batches = await Promise.all(
      records.map((record) =>
        this.dependencies.citationEvents.listByResponse(
          record.scopeId,
          record.id,
        ),
      ),
    );
    const events = batches.flat();
    assertEventSet(events, records, "cited");
    return events;
  }

  private async loadValidatedNominationEvidence(
    records: readonly ConfirmedConsumerObservationSampleReference[],
  ): Promise<{
    readonly events: readonly AiVisibilityNominatedSourceEvent[];
    readonly validatedResponseIdsByQuery: ReadonlyMap<
      string,
      ReadonlySet<string>
    >;
  }> {
    const results = await Promise.all(
      records.map(async (record) => ({
        record,
        review: await this.dependencies.nominationReviews.findByResponseId(
          record.scopeId,
          record.id,
        ),
        events: await this.dependencies.nominationEvents.listByResponse(
          record.scopeId,
          record.id,
        ),
      })),
    );
    const events: AiVisibilityNominatedSourceEvent[] = [];
    const mutableValidated = new Map<string, Set<string>>();
    for (const result of results) {
      if (!result.review) {
        throw new Error("COMPARISON_NOMINATION_REVIEW_MISSING");
      }
      assertReviewBinding(result.review, result.record);
      assertNominationReviewEvents(result.review, result.record, result.events);
      if (result.review.status !== "confirmed") {
        continue;
      }
      events.push(...result.events);
      const responseIds =
        mutableValidated.get(result.record.querySnapshotItemId) ??
        new Set<string>();
      responseIds.add(result.record.id);
      mutableValidated.set(result.record.querySnapshotItemId, responseIds);
    }
    assertUniqueEventIds(events);
    return Object.freeze({
      events: Object.freeze(events),
      validatedResponseIdsByQuery: new Map(
        [...mutableValidated.entries()].map(([queryId, responseIds]) => [
          queryId,
          new Set(responseIds),
        ]),
      ),
    });
  }
}

function assertSnapshotBinding(
  snapshot: QuerySetSnapshot,
  expectedScopeId: string,
  expectedSnapshotId: string,
  expectedHash: string,
  expectedQueryCount: number,
): void {
  if (
    snapshot.scopeId !== expectedScopeId ||
    snapshot.id !== expectedSnapshotId ||
    snapshot.snapshotHash !== expectedHash ||
    snapshot.queryCount !== expectedQueryCount ||
    snapshot.items.length !== expectedQueryCount
  ) {
    throw new Error("COMPARISON_QUERY_SET_SNAPSHOT_MISMATCH");
  }
}

function assertRecordSet(
  records: readonly ConfirmedConsumerObservationSampleReference[],
  runId: string,
  scopeId: string,
  expectedCount: number,
  requestedSampleCount: number,
  snapshot: QuerySetSnapshot,
): void {
  if (records.length !== expectedCount) {
    throw new Error("COMPARISON_CONFIRMED_RECORD_COVERAGE_MISMATCH");
  }
  const queryIds = new Set(snapshot.items.map((item) => item.id));
  const slots = new Set<string>();
  const responseIds = new Set<string>();
  for (const record of records) {
    if (
      record.scopeId !== scopeId ||
      record.runId !== runId ||
      !queryIds.has(record.querySnapshotItemId) ||
      !Number.isInteger(record.sampleIndex) ||
      record.sampleIndex < 1 ||
      record.sampleIndex > requestedSampleCount
    ) {
      throw new Error("COMPARISON_CONFIRMED_RECORD_BINDING_MISMATCH");
    }
    const slot = JSON.stringify([
      record.querySnapshotItemId,
      record.sampleIndex,
    ]);
    if (slots.has(slot) || responseIds.has(record.id)) {
      throw new Error("COMPARISON_DUPLICATE_CONFIRMED_RECORD");
    }
    slots.add(slot);
    responseIds.add(record.id);
  }
}

function assertEventSet(
  events: readonly (
    AiVisibilityCitedSourceEvent | AiVisibilityNominatedSourceEvent
  )[],
  records: readonly ConfirmedConsumerObservationSampleReference[],
  role: "cited" | "nominated",
): void {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  assertUniqueEventIds(events);
  for (const event of events) {
    const record = recordsById.get(event.responseId);
    if (
      !record ||
      event.role !== role ||
      event.scopeId !== record.scopeId ||
      event.runId !== record.runId ||
      event.querySnapshotItemId !== record.querySnapshotItemId ||
      event.sampleIndex !== record.sampleIndex
    ) {
      throw new Error("COMPARISON_SOURCE_EVENT_BINDING_MISMATCH");
    }
  }
}

function assertReviewBinding(
  review: SourceNominationParseReview,
  record: ConfirmedConsumerObservationSampleReference,
): void {
  if (review.scopeId !== record.scopeId || review.responseId !== record.id) {
    throw new Error("COMPARISON_NOMINATION_REVIEW_BINDING_MISMATCH");
  }
}

function assertNominationReviewEvents(
  review: SourceNominationParseReview,
  record: ConfirmedConsumerObservationSampleReference,
  events: readonly AiVisibilityNominatedSourceEvent[],
): void {
  assertEventSet(events, [record], "nominated");
  if (review.status !== "confirmed") {
    if (events.length > 0) {
      throw new Error("COMPARISON_UNCONFIRMED_NOMINATION_EVENTS");
    }
    return;
  }
  const expected = review.proposedItems
    .map((item) => nominationItemKey(item.registrableDomain, item.position))
    .sort();
  const actual = events
    .map((event) =>
      nominationItemKey(event.registrableDomain, event.sourcePosition),
    )
    .sort();
  if (!sameValues(expected, actual)) {
    throw new Error("COMPARISON_NOMINATION_EVENT_SET_MISMATCH");
  }
}

function nominationItemKey(
  registrableDomain: string,
  position: number | null,
): string {
  return JSON.stringify([registrableDomain, position]);
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

function assertUniqueEventIds(
  events: readonly { readonly id: string }[],
): void {
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    throw new Error("COMPARISON_DUPLICATE_SOURCE_EVENT_ID");
  }
}

function countRecordsForQuery(
  records: readonly ConfirmedConsumerObservationSampleReference[],
  querySnapshotItemId: string,
): number {
  return records.filter(
    (record) => record.querySnapshotItemId === querySnapshotItemId,
  ).length;
}

async function listSampleReferences(
  repository: ConfirmedConsumerObservationRecordRepository,
  scopeId: string,
  runId: string,
): Promise<readonly ConfirmedConsumerObservationSampleReference[]> {
  if (repository.listSampleReferencesByRun) {
    return repository.listSampleReferencesByRun(scopeId, runId);
  }
  return repository.listByRun(scopeId, runId);
}

function assertValidK(k: number): void {
  if (!Number.isInteger(k) || k < 1 || k > 10) {
    throw new Error("INVALID_NOMINATION_CITATION_COMPARISON_K");
  }
}

function freezeReport(
  report: ConsumerNominationCitationComparisonReport,
): ConsumerNominationCitationComparisonReport {
  return Object.freeze({
    ...report,
    questions: Object.freeze(report.questions),
  });
}
