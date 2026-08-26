import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceNominationEventProjector,
  assertProjectedNominatedSourceEventIntegrity,
  deriveSourceKeyHash,
} from "../src/index.ts";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "21111111-1111-4111-8111-111111111111",
  "31111111-1111-4111-8111-111111111111",
];

test("结构化域名投影为服务端来源键的nominated事件", () => {
  const generatedIds = [...ids];
  const events = new SourceNominationEventProjector().project({
    ...identity,
    validationMethod: "schema_validated",
    nominations: [
      {
        registrableDomain: "Example.COM.",
        position: 1,
        informationType: "官方信息",
        reason: "核验公司公开资料",
      },
      { registrableDomain: "example.com", position: 2 },
    ],
    newId: () => generatedIds.shift()!,
    createdAt: "2026-08-22T12:00:00.000Z",
  });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.sourcePosition),
    [1, 2],
  );
  assert.ok(events.every((event) => event.registrableDomain === "example.com"));
  const expectedKey = deriveSourceKeyHash({
    normalizedSource: null,
    registrableDomain: "example.com",
    normalizationVersion: "url-normalization@1",
  }).sourceKeyHash;
  assert.ok(events.every((event) => event.sourceKeyHash === expectedKey));
  assert.ok(events.every((event) => event.originalUrl === null));
  assert.doesNotThrow(() =>
    assertProjectedNominatedSourceEventIntegrity(events[0]),
  );
  assert.throws(() =>
    assertProjectedNominatedSourceEventIntegrity({
      ...events[0],
      sourceKeyHash: "b".repeat(64),
    }),
  );
});

test("人工确认验证方式和未知顺序被原样保留", () => {
  const events = new SourceNominationEventProjector().project({
    ...identity,
    validationMethod: "human_confirmed",
    nominations: [
      { registrableDomain: "example.com", position: null },
      { registrableDomain: "example.org", position: null },
    ],
    newId: idGenerator(),
    createdAt: "2026-08-22T12:00:00.000Z",
  });

  assert.ok(
    events.every(
      (event) =>
        event.sourcePosition === null &&
        event.nominationValidationMethod === "human_confirmed",
    ),
  );
});

test("非法域名、混合顺序、重复无序域名和事件身份冲突失败关闭", () => {
  for (const [nominations, newId] of [
    [[{ registrableDomain: "localhost", position: 1 }], idGenerator()],
    [
      [
        { registrableDomain: "example.com", position: 1 },
        { registrableDomain: "example.org", position: null },
      ],
      idGenerator(),
    ],
    [
      [
        { registrableDomain: "example.com", position: null },
        { registrableDomain: "EXAMPLE.COM", position: null },
      ],
      idGenerator(),
    ],
    [
      [
        { registrableDomain: "example.com", position: 1 },
        { registrableDomain: "example.org", position: 2 },
      ],
      () => ids[0],
    ],
  ] as const) {
    assert.throws(() =>
      new SourceNominationEventProjector().project({
        ...identity,
        validationMethod: "schema_validated",
        nominations,
        newId,
        createdAt: "2026-08-22T12:00:00.000Z",
      }),
    );
  }
});

const identity = {
  scopeId: "41111111-1111-4111-8111-111111111111",
  runId: "51111111-1111-4111-8111-111111111111",
  responseId: "61111111-1111-4111-8111-111111111111",
  querySnapshotItemId: "71111111-1111-4111-8111-111111111111",
  sampleIndex: 1,
} as const;

function idGenerator() {
  const generatedIds = [...ids];
  return () => generatedIds.shift()!;
}
