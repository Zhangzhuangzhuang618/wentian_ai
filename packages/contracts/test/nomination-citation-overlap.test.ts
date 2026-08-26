import assert from "node:assert/strict";
import test from "node:test";

import { computeNominationCitationOverlap } from "../../domain/src/index.ts";
import {
  NOMINATION_CITATION_OVERLAP_CONTRACT_VERSION,
  adaptNominationCitationOverlapReportToResponse,
  nominationCitationOverlapResponseSchema,
} from "../src/index.ts";

const queryId = "21111111-1111-4111-8111-111111111111";

test("Top-K领域报告适配为严格可复算响应", () => {
  const response = adaptNominationCitationOverlapReportToResponse(
    computeNominationCitationOverlap({
      querySnapshotItemId: queryId,
      rankedNominationDomains: ["a.example", "b.example", "c.example"],
      rankedCitationDomains: ["b.example", "c.example", "d.example"],
    }),
  );

  assert.equal(
    response.contract_version,
    NOMINATION_CITATION_OVERLAP_CONTRACT_VERSION,
  );
  assert.equal(response.numerator, 2);
  assert.equal(response.denominator, 10);
  assert.equal(response.nomination_effective_set_size, 3);
  assert.equal(response.citation_effective_set_size, 3);
  assert.deepEqual(response.overlap_domains, ["b.example", "c.example"]);
  assert.deepEqual(
    nominationCitationOverlapResponseSchema.parse(response),
    response,
  );
});

test("不足K的两侧集合仍保留独立有效大小和固定分母", () => {
  const response = adaptNominationCitationOverlapReportToResponse(
    computeNominationCitationOverlap({
      querySnapshotItemId: queryId,
      rankedNominationDomains: [],
      rankedCitationDomains: ["a.example"],
    }),
  );

  assert.equal(response.value, 0);
  assert.equal(response.denominator, 10);
  assert.equal(response.nomination_effective_set_size, 0);
  assert.equal(response.citation_effective_set_size, 1);
});

test("响应拒绝额外结论、篡改比例、集合大小和交集顺序", () => {
  const response = adaptNominationCitationOverlapReportToResponse(
    computeNominationCitationOverlap({
      querySnapshotItemId: queryId,
      k: 3,
      rankedNominationDomains: ["a.example", "b.example"],
      rankedCitationDomains: ["b.example", "a.example"],
    }),
  );

  assert.throws(() =>
    nominationCitationOverlapResponseSchema.parse({
      ...response,
      causal_consistency: true,
    }),
  );
  assert.throws(() =>
    nominationCitationOverlapResponseSchema.parse({
      ...response,
      denominator: 2,
      value: 1,
    }),
  );
  assert.throws(() =>
    nominationCitationOverlapResponseSchema.parse({
      ...response,
      nomination_effective_set_size: 1,
    }),
  );
  assert.throws(() =>
    nominationCitationOverlapResponseSchema.parse({
      ...response,
      overlap_domains: ["b.example", "a.example"],
    }),
  );
  assert.throws(() =>
    nominationCitationOverlapResponseSchema.parse({
      ...response,
      nomination_top_k_domains: ["a.example", "a.example"],
    }),
  );
  assert.throws(() =>
    nominationCitationOverlapResponseSchema.parse({
      ...response,
      k: 1,
      denominator: 1,
      numerator: 0,
      value: 0,
      citation_top_k_domains: ["c.example", "d.example"],
      overlap_domains: [],
    }),
  );
});
