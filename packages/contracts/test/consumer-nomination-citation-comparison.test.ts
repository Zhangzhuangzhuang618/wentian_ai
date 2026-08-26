import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPairedConsumerRunComparability,
  computeNominationCitationOverlap,
  rankSourceEntriesByDomain,
  type ConsumerObservationRun,
} from "../../domain/src/index.ts";
import {
  adaptConsumerNominationCitationComparisonToResponse,
  consumerNominationCitationComparisonResponseSchema,
} from "../src/index.ts";

const scopeId = "11111111-1111-4111-8111-111111111111";
const naturalRunId = "21111111-1111-4111-8111-111111111111";
const nominationRunId = "31111111-1111-4111-8111-111111111111";
const queryId = "41111111-1111-4111-8111-111111111111";

test("可比运行的累计排名和Top-K重合适配为严格响应", () => {
  const response = availableResponse();

  assert.equal(response.comparability.status, "comparable");
  assert.equal(response.questions[0]?.citation_ranking.total_entry_count, 3);
  assert.deepEqual(response.questions[0]?.citation_ranking.domains, [
    { rank: 1, registrable_domain: "a.example", entry_count: 2 },
    { rank: 2, registrable_domain: "b.example", entry_count: 1 },
  ]);
  assert.equal(response.questions[0]?.overlap?.numerator, 1);
  assert.deepEqual(
    consumerNominationCitationComparisonResponseSchema.parse(response),
    response,
  );
});

test("不可比运行只返回门禁原因且不携带问题结果", () => {
  const natural = run("natural_answer", "2026-08-20T00:00:00.000Z");
  const nomination = run("source_nomination", "2026-08-23T00:00:00.000Z");
  const response = adaptConsumerNominationCitationComparisonToResponse({
    methodologyVersion: "consumer-nomination-citation-comparison@1",
    scopeId,
    naturalAnswerRunId: natural.id,
    sourceNominationRunId: nomination.id,
    k: 10,
    comparability: assessPairedConsumerRunComparability({
      naturalAnswerRun: natural,
      sourceNominationRun: nomination,
    }),
    questions: [],
  });

  assert.equal(response.comparability.status, "not_comparable");
  assert.deepEqual(response.comparability.reasons, ["RUN_START_GAP_EXCEEDED"]);
  assert.deepEqual(response.questions, []);
});

test("契约拒绝额外结论、排名篡改、可用性矛盾和Top-K错绑", () => {
  const response = availableResponse();
  const question = response.questions[0]!;

  assert.throws(() =>
    consumerNominationCitationComparisonResponseSchema.parse({
      ...response,
      inferred_crawl_frequency: true,
    }),
  );
  assert.throws(() =>
    consumerNominationCitationComparisonResponseSchema.parse({
      ...response,
      questions: [
        {
          ...question,
          citation_ranking: {
            ...question.citation_ranking,
            total_entry_count: 99,
          },
        },
      ],
    }),
  );
  assert.throws(() =>
    consumerNominationCitationComparisonResponseSchema.parse({
      ...response,
      questions: [{ ...question, overlap: null }],
    }),
  );
  assert.throws(() =>
    consumerNominationCitationComparisonResponseSchema.parse({
      ...response,
      questions: [
        {
          ...question,
          overlap: {
            ...question.overlap!,
            citation_top_k_domains: ["other.example"],
            citation_effective_set_size: 1,
            overlap_domains: [],
            numerator: 0,
            value: 0,
          },
        },
      ],
    }),
  );
});

function availableResponse() {
  const natural = run("natural_answer", "2026-08-22T00:00:00.000Z");
  const nomination = run("source_nomination", "2026-08-22T01:00:00.000Z");
  const citationRanking = rankSourceEntriesByDomain({
    querySnapshotItemId: queryId,
    role: "cited",
    entries: [
      entry("citation-1", "cited", "a.example"),
      entry("citation-2", "cited", "a.example"),
      entry("citation-3", "cited", "b.example"),
    ],
  });
  const nominationRanking = rankSourceEntriesByDomain({
    querySnapshotItemId: queryId,
    role: "nominated",
    entries: [entry("nomination-1", "nominated", "a.example")],
  });
  const overlap = computeNominationCitationOverlap({
    querySnapshotItemId: queryId,
    rankedCitationDomains: citationRanking.domains.map(
      (domain) => domain.registrableDomain,
    ),
    rankedNominationDomains: nominationRanking.domains.map(
      (domain) => domain.registrableDomain,
    ),
  });
  return adaptConsumerNominationCitationComparisonToResponse({
    methodologyVersion: "consumer-nomination-citation-comparison@1",
    scopeId,
    naturalAnswerRunId: natural.id,
    sourceNominationRunId: nomination.id,
    k: 10,
    comparability: assessPairedConsumerRunComparability({
      naturalAnswerRun: natural,
      sourceNominationRun: nomination,
    }),
    questions: [
      {
        querySnapshotItemId: queryId,
        availability: "available",
        unavailableReasons: [],
        citationConfirmedSampleCount: 2,
        nominationValidatedSampleCount: 1,
        citationRanking,
        nominationRanking,
        overlap,
      },
    ],
  });
}

function entry(
  entryId: string,
  role: "cited" | "nominated",
  registrableDomain: string,
) {
  return { entryId, querySnapshotItemId: queryId, role, registrableDomain };
}

function run(
  experimentKind: "natural_answer" | "source_nomination",
  startedAt: string,
): ConsumerObservationRun {
  const nomination = experimentKind === "source_nomination";
  return {
    id: nomination ? nominationRunId : naturalRunId,
    scopeId,
    querySetSnapshotId: "51111111-1111-4111-8111-111111111111",
    querySetSnapshotHash: "hash-1",
    queryCount: 1,
    retrievalMode: "web_observed",
    executionTargetType: "consumer_surface",
    surfaceProfileVersionId: "61111111-1111-4111-8111-111111111111",
    collectionMethod: "browser_assisted",
    experimentKind,
    nominationContext: nomination ? "surface_unknown" : null,
    pairedRunId: nomination ? naturalRunId : null,
    requestedSampleCount: 2,
    plannedSampleCount: 2,
    successfulSampleCount: 2,
    failedSampleCount: 0,
    sessionConditions: {
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "Guangzhou",
    },
    status: "succeeded",
    createdBy: "user-1",
    createdAt: "2026-08-21T00:00:00.000Z",
    startedAt,
    completedAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    version: 2,
  };
}
