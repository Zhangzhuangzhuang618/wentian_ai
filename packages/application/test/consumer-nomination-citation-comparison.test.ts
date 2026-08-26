import assert from "node:assert/strict";
import test from "node:test";

import {
  GetConsumerNominationCitationComparisonService,
  type GetConsumerNominationCitationComparisonDependencies,
} from "../src/index.ts";
import {
  createWentianPrincipal,
  type AiVisibilityCitedSourceEvent,
  type AiVisibilityNominatedSourceEvent,
  type ConfirmedConsumerObservationRecord,
  type ConsumerObservationRun,
  type QuerySetSnapshot,
  type SourceNominationParseReview,
} from "@wentian/domain";

const queryId = "21111111-1111-4111-8111-111111111111";
const scopeId = "scope-1";
const principal = createWentianPrincipal({
  userId: "user-1",
  role: "viewer",
  allowedScopeIds: [scopeId],
});

test("运行级链路逐条累计引用并复现A、D、C、B排名", async () => {
  const natural = run("natural_answer", "succeeded", 2, 0);
  const nomination = run("source_nomination", "partial", 1, 1);
  const citationRecords = [
    record("natural-1", natural.id, 1),
    record("natural-2", natural.id, 2),
  ];
  const nominationRecords = [record("nomination-1", nomination.id, 1)];
  const citationEvents = new Map([
    [
      "natural-1",
      [
        ...events("cited", "natural-1", natural.id, "a.example", 5, 1),
        ...events("cited", "natural-1", natural.id, "b.example", 3, 6),
        ...events("cited", "natural-1", natural.id, "c.example", 2, 9),
      ],
    ],
    [
      "natural-2",
      [
        ...events("cited", "natural-2", natural.id, "a.example", 2, 11),
        ...events("cited", "natural-2", natural.id, "c.example", 2, 13),
        ...events("cited", "natural-2", natural.id, "d.example", 6, 15),
      ],
    ],
  ]);
  const nominationSourceEvents = events(
    "nominated",
    "nomination-1",
    nomination.id,
    "a.example",
    1,
    100,
  );
  const service = serviceFor({
    natural,
    nomination,
    citationRecords,
    nominationRecords,
    citationEvents,
    nominationEvents: new Map([["nomination-1", nominationSourceEvents]]),
    reviews: new Map([
      ["nomination-1", review("nomination-1", "confirmed", ["a.example"])],
    ]),
  });

  const report = await service.execute(principal, {
    scopeId,
    naturalAnswerRunId: natural.id,
    sourceNominationRunId: nomination.id,
  });

  assert.equal(report.comparability.status, "comparable");
  assert.equal(report.questions[0]?.availability, "available");
  assert.equal(report.questions[0]?.citationConfirmedSampleCount, 2);
  assert.deepEqual(report.questions[0]?.citationRanking.domains, [
    { rank: 1, registrableDomain: "a.example", entryCount: 7 },
    { rank: 2, registrableDomain: "d.example", entryCount: 6 },
    { rank: 3, registrableDomain: "c.example", entryCount: 4 },
    { rank: 4, registrableDomain: "b.example", entryCount: 3 },
  ]);
  assert.equal(report.questions[0]?.overlap?.numerator, 1);
});

test("不可比时在读取快照和信源明细之前返回", async () => {
  let evidenceRead = false;
  const natural = run(
    "natural_answer",
    "succeeded",
    0,
    2,
    "2026-08-20T00:00:00.000Z",
  );
  const nomination = run(
    "source_nomination",
    "failed",
    0,
    2,
    "2026-08-23T00:00:00.000Z",
  );
  const dependencies = serviceDependencies({ natural, nomination });
  dependencies.snapshots.findById = async () => {
    evidenceRead = true;
    return snapshot;
  };
  const service = new GetConsumerNominationCitationComparisonService(
    dependencies,
  );

  const report = await service.execute(principal, {
    scopeId,
    naturalAnswerRunId: natural.id,
    sourceNominationRunId: nomination.id,
  });

  assert.equal(report.comparability.status, "not_comparable");
  assert.deepEqual(report.questions, []);
  assert.equal(evidenceRead, false);
});

test("没有通过复核的提名样本时保留引用排名但不计算重合", async () => {
  const natural = run("natural_answer", "partial", 1, 1);
  const nomination = run("source_nomination", "partial", 1, 1);
  const citationRecord = record("natural-1", natural.id, 1);
  const nominationRecord = record("nomination-1", nomination.id, 1);
  const service = serviceFor({
    natural,
    nomination,
    citationRecords: [citationRecord],
    nominationRecords: [nominationRecord],
    citationEvents: new Map([
      [
        citationRecord.id,
        events("cited", citationRecord.id, natural.id, "a.example", 1, 1),
      ],
    ]),
    nominationEvents: new Map([[nominationRecord.id, []]]),
    reviews: new Map([
      [nominationRecord.id, review(nominationRecord.id, "needs_review", [])],
    ]),
  });

  const report = await service.execute(principal, {
    scopeId,
    naturalAnswerRunId: natural.id,
    sourceNominationRunId: nomination.id,
  });

  assert.equal(report.questions[0]?.availability, "not_available");
  assert.deepEqual(report.questions[0]?.unavailableReasons, [
    "NO_VALIDATED_NOMINATION_SAMPLES",
  ]);
  assert.equal(report.questions[0]?.citationRanking.totalEntryCount, 1);
  assert.equal(report.questions[0]?.nominationRanking.totalEntryCount, 0);
  assert.equal(report.questions[0]?.overlap, null);
});

test("错绑到其他运行的正式事件失败关闭", async () => {
  const natural = run("natural_answer", "partial", 1, 1);
  const nomination = run("source_nomination", "partial", 1, 1);
  const citationRecord = record("natural-1", natural.id, 1);
  const service = serviceFor({
    natural,
    nomination,
    citationRecords: [citationRecord],
    nominationRecords: [record("nomination-1", nomination.id, 1)],
    citationEvents: new Map([
      [
        citationRecord.id,
        events("cited", citationRecord.id, "wrong-run", "a.example", 1, 1),
      ],
    ]),
    nominationEvents: new Map([["nomination-1", []]]),
    reviews: new Map([
      ["nomination-1", review("nomination-1", "confirmed", [])],
    ]),
  });

  await assert.rejects(
    () =>
      service.execute(principal, {
        scopeId,
        naturalAnswerRunId: natural.id,
        sourceNominationRunId: nomination.id,
      }),
    /COMPARISON_SOURCE_EVENT_BINDING_MISMATCH/,
  );
});

test("原始回答清理后仍使用样本引用和正式事件复算对照", async () => {
  const natural = run("natural_answer", "partial", 1, 1);
  const nomination = run("source_nomination", "partial", 1, 1);
  const citationRecord = record("natural-1", natural.id, 1);
  const nominationRecord = record("nomination-1", nomination.id, 1);
  const service = serviceFor({
    natural,
    nomination,
    citationRecords: [citationRecord],
    nominationRecords: [nominationRecord],
    useSampleReferences: true,
    citationEvents: new Map([
      [
        citationRecord.id,
        events("cited", citationRecord.id, natural.id, "a.example", 1, 1),
      ],
    ]),
    nominationEvents: new Map([
      [
        nominationRecord.id,
        events(
          "nominated",
          nominationRecord.id,
          nomination.id,
          "a.example",
          1,
          100,
        ),
      ],
    ]),
    reviews: new Map([
      [
        nominationRecord.id,
        review(nominationRecord.id, "confirmed", ["a.example"]),
      ],
    ]),
  });

  const report = await service.execute(principal, {
    scopeId,
    naturalAnswerRunId: natural.id,
    sourceNominationRunId: nomination.id,
  });

  assert.equal(report.questions[0]?.availability, "available");
  assert.equal(report.questions[0]?.overlap?.numerator, 1);
});

function run(
  experimentKind: "natural_answer" | "source_nomination",
  status: "succeeded" | "partial" | "failed",
  successfulSampleCount: number,
  failedSampleCount: number,
  startedAt = experimentKind === "natural_answer"
    ? "2026-08-22T00:00:00.000Z"
    : "2026-08-22T01:00:00.000Z",
): ConsumerObservationRun {
  const nomination = experimentKind === "source_nomination";
  return {
    id: nomination ? "nomination-run" : "natural-run",
    scopeId,
    querySetSnapshotId: snapshot.id,
    querySetSnapshotHash: snapshot.snapshotHash,
    queryCount: 1,
    retrievalMode: "web_observed",
    executionTargetType: "consumer_surface",
    surfaceProfileVersionId: "surface-1",
    collectionMethod: "browser_assisted",
    experimentKind,
    nominationContext: nomination ? "surface_unknown" : null,
    pairedRunId: nomination ? "natural-run" : null,
    requestedSampleCount: 2,
    plannedSampleCount: 2,
    successfulSampleCount,
    failedSampleCount,
    sessionConditions: {
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    status,
    createdBy: "user-1",
    createdAt: "2026-08-21T00:00:00.000Z",
    startedAt,
    completedAt: "2026-08-23T02:00:00.000Z",
    updatedAt: "2026-08-23T02:00:00.000Z",
    version: 2,
  };
}

function record(
  id: string,
  runId: string,
  sampleIndex: number,
): ConfirmedConsumerObservationRecord {
  return {
    id,
    scopeId,
    runId,
    querySnapshotItemId: queryId,
    sampleIndex,
  } as ConfirmedConsumerObservationRecord;
}

function events(
  role: "cited" | "nominated",
  responseId: string,
  runId: string,
  registrableDomain: string,
  count: number,
  startAt: number,
): Array<AiVisibilityCitedSourceEvent | AiVisibilityNominatedSourceEvent> {
  return Array.from({ length: count }, (_, offset) => ({
    id: `${role}-${startAt + offset}`,
    scopeId,
    runId,
    responseId,
    querySnapshotItemId: queryId,
    sampleIndex: responseId.endsWith("2") ? 2 : 1,
    role,
    registrableDomain,
    sourcePosition: startAt + offset,
  })) as Array<AiVisibilityCitedSourceEvent | AiVisibilityNominatedSourceEvent>;
}

function review(
  responseId: string,
  status: "needs_review" | "confirmed",
  domains: readonly string[],
): SourceNominationParseReview {
  return {
    scopeId,
    responseId,
    status,
    proposedItems: domains.map((registrableDomain, index) => ({
      registrableDomain,
      position: index + 100,
    })),
  } as unknown as SourceNominationParseReview;
}

const snapshot = {
  id: "snapshot-1",
  scopeId,
  snapshotHash: "hash-1",
  queryCount: 1,
  items: [{ id: queryId }],
} as unknown as QuerySetSnapshot;

function serviceFor(input: FixtureInput) {
  return new GetConsumerNominationCitationComparisonService(
    serviceDependencies(input),
  );
}

interface FixtureInput {
  readonly natural: ConsumerObservationRun;
  readonly nomination: ConsumerObservationRun;
  readonly citationRecords?: readonly ConfirmedConsumerObservationRecord[];
  readonly nominationRecords?: readonly ConfirmedConsumerObservationRecord[];
  readonly citationEvents?: ReadonlyMap<
    string,
    readonly (AiVisibilityCitedSourceEvent | AiVisibilityNominatedSourceEvent)[]
  >;
  readonly nominationEvents?: ReadonlyMap<
    string,
    readonly (AiVisibilityCitedSourceEvent | AiVisibilityNominatedSourceEvent)[]
  >;
  readonly reviews?: ReadonlyMap<string, SourceNominationParseReview>;
  readonly useSampleReferences?: boolean;
}

function serviceDependencies(
  input: FixtureInput,
): GetConsumerNominationCitationComparisonDependencies {
  return {
    runs: {
      findRunById: async (_scopeId: string, runId: string) =>
        runId === input.natural.id
          ? input.natural
          : runId === input.nomination.id
            ? input.nomination
            : null,
    },
    snapshots: { findById: async () => snapshot },
    records: {
      listByRun: async (_scopeId: string, runId: string) => {
        if (input.useSampleReferences) {
          throw new Error("RAW_RECORDS_MUST_NOT_BE_READ");
        }
        return runId === input.natural.id
          ? (input.citationRecords ?? [])
          : (input.nominationRecords ?? []);
      },
      ...(input.useSampleReferences
        ? {
            listSampleReferencesByRun: async (
              _scopeId: string,
              runId: string,
            ) =>
              runId === input.natural.id
                ? (input.citationRecords ?? [])
                : (input.nominationRecords ?? []),
          }
        : {}),
    },
    citationEvents: {
      listByResponse: async (_scopeId: string, responseId: string) =>
        (input.citationEvents?.get(responseId) ??
          []) as readonly AiVisibilityCitedSourceEvent[],
    },
    nominationEvents: {
      listByResponse: async (_scopeId: string, responseId: string) =>
        (input.nominationEvents?.get(responseId) ??
          []) as readonly AiVisibilityNominatedSourceEvent[],
    },
    nominationReviews: {
      findByResponseId: async (_scopeId: string, responseId: string) =>
        input.reviews?.get(responseId) ?? null,
    },
  } as unknown as GetConsumerNominationCitationComparisonDependencies;
}
