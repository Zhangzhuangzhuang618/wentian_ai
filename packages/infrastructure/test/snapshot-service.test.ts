import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateLocalQuerySetSnapshotService,
  GetQuerySetSnapshotService,
  WentianApplicationError,
} from "@wentian/application";
import { createScope, createWentianPrincipal } from "@wentian/domain";

import {
  InMemoryQuerySetSnapshotRepository,
  InMemoryScopeRepository,
} from "../src/index.ts";

const activeScope = createScope({
  id: "31111111-1111-4111-8111-111111111111",
  projectKey: "guangzhou-moving",
  displayName: "广州搬家",
  status: "active",
  retentionPolicyCode: "default",
  createdBy: "41111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  version: 1,
});

const archivedScope = createScope({
  ...activeScope,
  id: "51111111-1111-4111-8111-111111111111",
  projectKey: "archived-project",
  displayName: "已归档项目",
  status: "archived",
});

const principal = createWentianPrincipal({
  userId: "41111111-1111-4111-8111-111111111111",
  role: "analyst",
  allowedScopeIds: [activeScope.id, archivedScope.id],
});

const command = {
  scopeId: activeScope.id,
  title: "广州搬家公司问题集",
  locale: "zh-CN",
  market: "广州",
  queries: [
    {
      queryText: "广州搬家公司哪家好？",
      intentCode: "recommendation" as const,
      commercialValue: "high" as const,
    },
  ],
};

test("相同scope和内容幂等复用原快照", async () => {
  const { create, snapshots } = createFixture();

  const first = await create.execute(principal, command);
  const second = await create.execute(principal, command);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.snapshot.id, first.snapshot.id);

  const loaded = await snapshots.findById(activeScope.id, first.snapshot.id);
  assert.equal(loaded, first.snapshot);
});

test("无权访问的scope统一返回RESOURCE_NOT_FOUND", async () => {
  const { create } = createFixture();

  await assert.rejects(
    () =>
      create.execute(principal, {
        ...command,
        scopeId: "99999999-9999-4999-8999-999999999999",
      }),
    (error) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
});

test("归档scope禁止创建新快照", async () => {
  const { create } = createFixture();

  await assert.rejects(
    () => create.execute(principal, { ...command, scopeId: archivedScope.id }),
    (error) =>
      error instanceof WentianApplicationError &&
      error.code === "SCOPE_INACTIVE",
  );
});

test("快照查询按scope隔离", async () => {
  const { create, get } = createFixture();
  const created = await create.execute(principal, command);

  await assert.rejects(
    () => get.execute(principal, archivedScope.id, created.snapshot.id),
    (error) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
});

test("相同内容在不同scope分别创建快照", async () => {
  const secondScope = createScope({
    ...activeScope,
    id: "61111111-1111-4111-8111-111111111111",
    projectKey: "foshan-moving",
    displayName: "佛山搬家",
  });
  const scopes = new InMemoryScopeRepository([activeScope, secondScope]);
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  let idCounter = 0;
  const create = new CreateLocalQuerySetSnapshotService({
    scopes,
    snapshots,
    newId: () => {
      idCounter += 1;
      return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
    },
    now: () => "2026-08-21T00:00:00.000Z",
  });
  const twoScopePrincipal = createWentianPrincipal({
    ...principal,
    allowedScopeIds: [activeScope.id, secondScope.id],
  });

  const first = await create.execute(twoScopePrincipal, command);
  const second = await create.execute(twoScopePrincipal, {
    ...command,
    scopeId: secondScope.id,
  });

  assert.equal(first.snapshot.snapshotHash, second.snapshot.snapshotHash);
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.snapshot.id, second.snapshot.id);
});

test("有权访问时可按scope读取快照", async () => {
  const { create, get } = createFixture();
  const created = await create.execute(principal, command);

  const loaded = await get.execute(
    principal,
    activeScope.id,
    created.snapshot.id,
  );

  assert.equal(loaded, created.snapshot);
});

function createFixture() {
  const scopes = new InMemoryScopeRepository([activeScope, archivedScope]);
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  let idCounter = 0;
  const newId = () => {
    idCounter += 1;
    return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
  };
  return {
    create: new CreateLocalQuerySetSnapshotService({
      scopes,
      snapshots,
      newId,
      now: () => "2026-08-21T00:00:00.000Z",
    }),
    get: new GetQuerySetSnapshotService(scopes, snapshots),
    snapshots,
  };
}
