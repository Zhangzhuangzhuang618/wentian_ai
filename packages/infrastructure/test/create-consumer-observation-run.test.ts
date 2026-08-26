import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateConsumerObservationRunService,
  WentianApplicationError,
} from "@wentian/application";
import {
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  createScope,
  createWentianPrincipal,
} from "@wentian/domain";

import {
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
  InMemoryScopeRepository,
} from "../src/index.ts";

const ids = {
  scope: "21111111-1111-4111-8111-111111111111",
  archivedScope: "31111111-1111-4111-8111-111111111111",
  snapshot: "41111111-1111-4111-8111-111111111111",
  surface: "51111111-1111-4111-8111-111111111111",
  user: "61111111-1111-4111-8111-111111111111",
} as const;

const sessionConditions = {
  searchMode: "unknown",
  isNewConversation: true,
  isLoggedIn: true,
  memoryEnabled: null,
  personalizationEnabled: null,
  locale: "zh-CN",
  region: "Guangzhou",
} as const;

test("按问题和样本数原子创建完整运行任务槽位", async () => {
  const fixture = await createFixture();

  const result = await fixture.service.execute(fixture.principal, {
    ...baseCommand,
    sampleCount: 2,
  });

  assert.equal(result.run.plannedSampleCount, 4);
  assert.equal(result.tasks.length, 4);
  assert.deepEqual(
    result.tasks.map((task) => [task.querySnapshotItemId, task.sampleIndex]),
    [
      ["query-item-1", 1],
      ["query-item-1", 2],
      ["query-item-2", 1],
      ["query-item-2", 2],
    ],
  );
  assert.equal(
    await fixture.runs.findRunById(ids.scope, result.run.id),
    result.run,
  );
  assert.equal(
    await fixture.runs.findById(ids.scope, result.tasks[0].id),
    result.tasks[0],
  );
});

test("无scope权限统一隐藏，viewer不能创建运行", async () => {
  const fixture = await createFixture();
  const outsider = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [],
  });
  const viewer = createWentianPrincipal({
    userId: ids.user,
    role: "viewer",
    allowedScopeIds: [ids.scope],
  });

  await assert.rejects(
    () => fixture.service.execute(outsider, baseCommand),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
  await assert.rejects(
    () => fixture.service.execute(viewer, baseCommand),
    isApplicationError("ACTION_FORBIDDEN"),
  );
});

test("归档scope、缺失快照和未启用Surface失败关闭", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        scopeId: ids.archivedScope,
      }),
    isApplicationError("SCOPE_INACTIVE"),
  );
  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        querySetSnapshotId: "missing-snapshot",
      }),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        surfaceCode: "missing-surface",
      }),
    isApplicationError("RESOURCE_NOT_FOUND"),
  );
});

test("Surface未允许的采集方式不能创建运行", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        collectionMethod: "manual_import",
      }),
    /CONSUMER_COLLECTION_METHOD_NOT_ALLOWED/,
  );
});

test("自述配对只接受相同配置的自然回答运行", async () => {
  const fixture = await createFixture();
  const natural = await fixture.service.execute(fixture.principal, baseCommand);

  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        experimentKind: "source_nomination",
        pairedRunId: natural.run.id,
        sessionConditions: {
          ...sessionConditions,
          searchMode: "enabled",
        },
      }),
    /PAIRED_RUN_CONFIGURATION_MISMATCH/,
  );
  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        pairedRunId: natural.run.id,
      }),
    /PAIRED_RUN_ONLY_ALLOWED_FOR_SOURCE_NOMINATION/,
  );

  const nomination = await fixture.service.execute(fixture.principal, {
    ...baseCommand,
    experimentKind: "source_nomination",
    pairedRunId: natural.run.id,
  });
  assert.equal(nomination.run.pairedRunId, natural.run.id);
  assert.equal(nomination.run.nominationContext, "surface_unknown");
});

test("任务ID冲突时运行和任务都不落入内存仓储", async () => {
  const fixture = await createFixture({
    newId: (() => {
      let count = 0;
      return () => {
        count += 1;
        return count === 1 ? "run-conflict" : "duplicate-task";
      };
    })(),
  });

  await assert.rejects(
    () =>
      fixture.service.execute(fixture.principal, {
        ...baseCommand,
        sampleCount: 2,
      }),
    /OBSERVATION_TASK_ID_CONFLICT/,
  );
  assert.equal(await fixture.runs.findRunById(ids.scope, "run-conflict"), null);
  assert.equal(await fixture.runs.findById(ids.scope, "duplicate-task"), null);
});

const baseCommand = {
  scopeId: ids.scope,
  querySetSnapshotId: ids.snapshot,
  surfaceCode: "doubao_web",
  collectionMethod: "browser_assisted" as const,
  experimentKind: "natural_answer" as const,
  sampleCount: 1,
  sessionConditions,
};

async function createFixture(options: { readonly newId?: () => string } = {}) {
  const activeScope = createScope({
    id: ids.scope,
    projectKey: "guangzhou-moving",
    displayName: "广州搬家",
    status: "active",
    retentionPolicyCode: "default",
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z",
    version: 1,
  });
  const archivedScope = createScope({
    ...activeScope,
    id: ids.archivedScope,
    projectKey: "archived",
    displayName: "已归档",
    status: "archived",
  });
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: ["query-item-1", "query-item-2"],
    scopeId: ids.scope,
    title: "广州搬家问题集",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
    queries: [
      {
        queryText: "广州搬家公司哪家好？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
      {
        queryText: "推荐广州搬家公司",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const surface = createConsumerSurfaceProfileVersion({
    id: ids.surface,
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    adapterVersion: "doubao-web@1",
    allowedCollectionMethods: ["browser_assisted"],
    visibleSourceCapabilities: {
      visibleCitations: true,
      sourcePanel: true,
      screenshot: true,
      sanitizedDom: false,
    },
    equivalenceLevel: "unknown",
    termsReviewedAt: "2026-08-22T09:00:00.000Z",
    status: "active",
    createdBy: ids.user,
    createdAt: "2026-08-22T09:00:00.000Z",
  });
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  const runs = new InMemoryConsumerObservationRunRepository();
  let idCounter = 0;
  const newId =
    options.newId ??
    (() => {
      idCounter += 1;
      return `generated-${idCounter}`;
    });
  const principal = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [ids.scope, ids.archivedScope],
  });
  return {
    principal,
    runs,
    service: new CreateConsumerObservationRunService({
      scopes: new InMemoryScopeRepository([activeScope, archivedScope]),
      snapshots,
      surfaceProfiles: new InMemoryConsumerSurfaceProfileVersionRepository([
        surface,
      ]),
      runs,
      newId,
      now: () => "2026-08-22T10:00:00.000Z",
    }),
  };
}

function isApplicationError(code: WentianApplicationError["code"]) {
  return (error: unknown) =>
    error instanceof WentianApplicationError && error.code === code;
}
