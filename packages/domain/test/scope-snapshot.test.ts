import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuerySetSnapshot,
  createWentianPrincipal,
  hasScopeAccess,
  type CreateQuerySetSnapshotInput,
} from "../src/index.ts";

const baseInput: CreateQuerySetSnapshotInput = {
  id: "11111111-1111-4111-8111-111111111111",
  itemIds: ["21111111-1111-4111-8111-111111111111"],
  scopeId: "31111111-1111-4111-8111-111111111111",
  title: "广州搬家公司问题集",
  locale: "zh-CN",
  market: "广州",
  source: { type: "local", ref: "local-set-1", revision: "1" },
  queries: [
    {
      externalKey: "local-q1",
      queryText: "广州搬家公司哪家好？",
      intentCode: "recommendation",
      commercialValue: "high",
    },
  ],
  createdBy: "41111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-21T00:00:00.000Z",
};

test("本地与GEO来源元数据不同但内容相同时hash一致", () => {
  const localSnapshot = createQuerySetSnapshot(baseInput);
  const geoSnapshot = createQuerySetSnapshot({
    ...baseInput,
    id: "51111111-1111-4111-8111-111111111111",
    itemIds: ["61111111-1111-4111-8111-111111111111"],
    source: {
      type: "geo_sync",
      ref: "geo-set-9",
      revision: "42",
      geoBindingId: "71111111-1111-4111-8111-111111111111",
      contractVersion: "wentian-geo-connector@1",
    },
    queries: [{ ...baseInput.queries[0]!, externalKey: "geo-query-a" }],
  });

  assert.equal(localSnapshot.snapshotHash, geoSnapshot.snapshotHash);
  assert.equal(
    localSnapshot.items[0]?.itemHash,
    geoSnapshot.items[0]?.itemHash,
  );
});

test("问题顺序变化会改变快照hash", () => {
  const first = createQuerySetSnapshot({
    ...baseInput,
    itemIds: [
      "81111111-1111-4111-8111-111111111111",
      "91111111-1111-4111-8111-111111111111",
    ],
    queries: [
      baseInput.queries[0]!,
      {
        queryText: "搬家公司如何收费？",
        intentCode: "procurement",
        commercialValue: "high",
      },
    ],
  });
  const reversed = createQuerySetSnapshot({
    ...baseInput,
    id: "a1111111-1111-4111-8111-111111111111",
    itemIds: [
      "b1111111-1111-4111-8111-111111111111",
      "c1111111-1111-4111-8111-111111111111",
    ],
    queries: [...first.items]
      .reverse()
      .map(({ queryText, intentCode, commercialValue }) => ({
        queryText,
        intentCode,
        commercialValue,
      })),
  });

  assert.notEqual(first.snapshotHash, reversed.snapshotHash);
});

test("业务地区或行业变化会改变新快照hash，旧输入仍保持旧结构", () => {
  const classified = createQuerySetSnapshot({
    ...baseInput,
    industry: "搬家",
    region: "广州",
  });
  const anotherRegion = createQuerySetSnapshot({
    ...baseInput,
    id: "d1111111-1111-4111-8111-111111111111",
    itemIds: ["e1111111-1111-4111-8111-111111111111"],
    industry: "搬家",
    region: "深圳",
  });
  const legacy = createQuerySetSnapshot(baseInput);

  assert.notEqual(classified.snapshotHash, anotherRegion.snapshotHash);
  assert.equal(classified.industry, "搬家");
  assert.equal(classified.region, "广州");
  assert.equal(Object.hasOwn(legacy, "industry"), false);
});

test("快照及其问题项在运行时不可修改", () => {
  const snapshot = createQuerySetSnapshot(baseInput);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.items), true);
  assert.equal(Object.isFrozen(snapshot.items[0]), true);
  assert.throws(() => {
    (snapshot.items as unknown as Array<unknown>).push({});
  }, TypeError);
});

test("GEO来源必须同时携带binding和契约版本", () => {
  assert.throws(
    () =>
      createQuerySetSnapshot({
        ...baseInput,
        source: {
          type: "geo_sync",
          geoBindingId: "71111111-1111-4111-8111-111111111111",
        },
      }),
    /GEO_SOURCE_METADATA_REQUIRED/,
  );
});

test("问题external key在同一快照内不能重复", () => {
  assert.throws(
    () =>
      createQuerySetSnapshot({
        ...baseInput,
        itemIds: [
          "81111111-1111-4111-8111-111111111111",
          "91111111-1111-4111-8111-111111111111",
        ],
        queries: [baseInput.queries[0]!, baseInput.queries[0]!],
      }),
    /DUPLICATE_QUERY_EXTERNAL_KEY/,
  );
});

test("非GEO来源不能携带GEO绑定字段", () => {
  assert.throws(
    () =>
      createQuerySetSnapshot({
        ...baseInput,
        source: {
          type: "local",
          geoBindingId: "71111111-1111-4111-8111-111111111111",
          contractVersion: "wentian-geo-connector@1",
        },
      }),
    /GEO_SOURCE_METADATA_FORBIDDEN/,
  );
});

test("Principal只认可服务端冻结的scope集合", () => {
  const principal = createWentianPrincipal({
    userId: "41111111-1111-4111-8111-111111111111",
    role: "analyst",
    allowedScopeIds: [
      "31111111-1111-4111-8111-111111111111",
      "31111111-1111-4111-8111-111111111111",
    ],
  });

  assert.deepEqual(principal.allowedScopeIds, [
    "31111111-1111-4111-8111-111111111111",
  ]);
  assert.equal(
    hasScopeAccess(principal, "31111111-1111-4111-8111-111111111111"),
    true,
  );
  assert.equal(
    hasScopeAccess(principal, "99999999-9999-4999-8999-999999999999"),
    false,
  );
});
