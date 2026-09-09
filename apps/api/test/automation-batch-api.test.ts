import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  createConsumerCaptureEvidenceArtifact,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
  submitConsumerCaptureArtifact,
} from "@wentian/domain";
import {
  HmacAutomationBatchTokenService,
  HmacCaptureTokenService,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
  InMemoryScopeRepository,
  InMemorySourceNominationParseReviewRepository,
} from "@wentian/infrastructure";

import type { LocalAccessApiService } from "../src/local-access-api.ts";
import type { StandaloneConsumerObservationApiOptions } from "../src/standalone-consumer-observation-api.ts";
import { createWentianApiServer } from "../src/server.ts";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  snapshot: "21111111-1111-4111-8111-111111111111",
  query: "31111111-1111-4111-8111-111111111111",
  surface: "41111111-1111-4111-8111-111111111111",
  run: "51111111-1111-4111-8111-111111111111",
  task1: "61111111-1111-4111-8111-111111111111",
  task2: "62111111-1111-4111-8111-111111111111",
  user: "71111111-1111-4111-8111-111111111111",
  artifact1: "81111111-1111-4111-8111-111111111111",
  artifact2: "82111111-1111-4111-8111-111111111111",
  screenshot1: "91111111-1111-4111-8111-111111111111",
  screenshot2: "92111111-1111-4111-8111-111111111111",
} as const;

const publicOrigin = "http://127.0.0.1";
const sessionToken = "local-session-token";
const csrfToken = "local-csrf-token";

test("整批接口签发运行级接入码并逐题恢复、领取直至完成", async () => {
  const fixture = await createFixture();
  const server = createWentianApiServer({
    version: "0.0.0-test",
    standaloneConsumerObservationApi: fixture.options,
  });
  await withServer(server, async (baseUrl) => {
    const created = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/runs/${ids.run}/automation-batch`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `wentian_session=${sessionToken}`,
          origin: publicOrigin,
          "x-wentian-csrf-token": csrfToken,
        },
        body: "{}",
      },
    );
    assert.equal(created.status, 201);
    const batch = (await created.json()) as {
      readonly status: string;
      readonly total_task_count: number;
      readonly remaining_task_count: number;
      readonly batch_handoff_code: string;
    };
    assert.equal(batch.status, "ready");
    assert.equal(batch.total_task_count, 2);
    assert.equal(batch.remaining_task_count, 2);
    const handoff = JSON.parse(
      Buffer.from(batch.batch_handoff_code, "base64url").toString("utf8"),
    ) as { readonly version: string; readonly batch_token: string };
    assert.equal(handoff.version, "wentian-extension-batch-handoff@1");

    const first = await nextTask(baseUrl, handoff.batch_token);
    assert.equal(first.status, "task_ready");
    assert.equal(first.claim.task.id, ids.task1);
    assert.equal(first.claim.task.status, "capturing");
    assert.equal(first.remaining_task_count, 1);

    const resumed = await nextTask(baseUrl, handoff.batch_token);
    assert.equal(resumed.claim.task.id, ids.task1);
    assert.notEqual(
      resumed.claim.extension_handoff_code,
      first.claim.extension_handoff_code,
    );

    await fixture.markCaptured(ids.task1, ids.artifact1);
    const preview = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/runs/${ids.run}/tasks/${ids.task1}/preview`,
      { headers: { cookie: `wentian_session=${sessionToken}` } },
    );
    assert.equal(preview.status, 200);
    assert.deepEqual(await preview.json(), {
      task_id: ids.task1,
      task_version: 3,
      status: "needs_review",
      answer_text: "第 1 次豆包可见回答。",
      visible_citations: [
        {
          url: "https://example.com/source",
          label: "示例信源",
          position: 1,
          observed_url: null,
          resolution: null,
        },
      ],
      visible_metadata: {
        product_label: "豆包网页版",
        surface_model_label: null,
        search_mode: "unknown",
        is_new_conversation: true,
        is_logged_in: true,
        locale: "zh-CN",
        region: "CN_MAINLAND",
        observed_at: "2026-08-25T08:01:01.000Z",
      },
      screenshot_evidence_saved: true,
    });
    const second = await nextTask(baseUrl, handoff.batch_token);
    assert.equal(second.claim.task.id, ids.task2);
    assert.equal(second.completed_task_count, 1);
    assert.equal(second.remaining_task_count, 0);

    await fixture.markCaptured(ids.task2, ids.artifact2);
    const complete = await nextTask(baseUrl, handoff.batch_token);
    assert.deepEqual(complete, {
      status: "complete",
      run_id: ids.run,
      total_task_count: 2,
      completed_task_count: 2,
      remaining_task_count: 0,
    });
  });
});

test("Owner带CSRF可以删除未开始运行", async () => {
  const fixture = await createFixture();
  const server = createWentianApiServer({
    version: "0.0.0-test",
    standaloneConsumerObservationApi: fixture.options,
  });
  await withServer(server, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/runs/${ids.run}`,
      {
        method: "DELETE",
        headers: {
          cookie: `wentian_session=${sessionToken}`,
          origin: publicOrigin,
          "x-wentian-csrf-token": csrfToken,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted_run_id: ids.run });
    assert.equal(fixture.deletedRunId(), ids.run);
  });
});

test("删除运行缺少CSRF时失败关闭", async () => {
  const fixture = await createFixture();
  const server = createWentianApiServer({
    version: "0.0.0-test",
    standaloneConsumerObservationApi: fixture.options,
  });
  await withServer(server, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/runs/${ids.run}`,
      {
        method: "DELETE",
        headers: {
          cookie: `wentian_session=${sessionToken}`,
          origin: publicOrigin,
        },
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "CSRF_TOKEN_INVALID" });
    assert.equal(fixture.deletedRunId(), null);
  });
});

test("检索词洞察接口按项目鉴权并导出真实Excel工作簿", async () => {
  const fixture = await createFixture();
  const server = createWentianApiServer({
    version: "0.0.0-test",
    standaloneConsumerObservationApi: fixture.options,
  });
  await withServer(server, async (baseUrl) => {
    const unauthorized = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/visible-search-keywords`,
    );
    assert.equal(unauthorized.status, 401);

    const headers = { cookie: `wentian_session=${sessionToken}` };
    const report = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/visible-search-keywords?surface_code=doubao_web&industry=%E6%90%AC%E5%AE%B6`,
      { headers },
    );
    assert.equal(report.status, 200);
    assert.match(report.headers.get("content-type") ?? "", /application\/json/);
    const reportBody = (await report.json()) as {
      readonly scope_id: string;
      readonly summary: {
        readonly confirmed_sample_count: number;
        readonly unique_keyword_count: number;
      };
    };
    assert.equal(reportBody.scope_id, ids.scope);
    assert.equal(reportBody.summary.confirmed_sample_count, 0);
    assert.equal(reportBody.summary.unique_keyword_count, 0);

    const workbook = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/visible-search-keywords.xlsx`,
      { headers },
    );
    assert.equal(workbook.status, 200);
    assert.match(
      workbook.headers.get("content-type") ?? "",
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
    assert.match(
      workbook.headers.get("content-disposition") ?? "",
      /attachment; filename\*=UTF-8''/,
    );
    const bytes = new Uint8Array(await workbook.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  });
});

async function createFixture() {
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "广州搬家",
    locale: "zh-CN",
    market: "CN_MAINLAND",
    source: { type: "local" },
    queries: [
      {
        queryText: "广州搬家公司哪家好？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: ids.user,
    createdAt: "2026-08-25T08:00:00.000Z",
  });
  const surface = createConsumerSurfaceProfileVersion({
    id: ids.surface,
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    adapterVersion: "doubao-web@1-attended",
    allowedCollectionMethods: ["browser_assisted"],
    visibleSourceCapabilities: {
      visibleCitations: true,
      sourcePanel: true,
      screenshot: true,
      sanitizedDom: false,
    },
    equivalenceLevel: "unknown",
    termsReviewedAt: "2026-08-25T08:00:00.000Z",
    status: "active",
    createdBy: ids.user,
    createdAt: "2026-08-25T08:00:00.000Z",
  });
  const run = createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile: surface,
    collectionMethod: "browser_assisted",
    experimentKind: "natural_answer",
    requestedSampleCount: 2,
    sessionConditions: {
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: true,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: "CN_MAINLAND",
    },
    createdBy: ids.user,
    createdAt: "2026-08-25T08:00:00.000Z",
  });
  const tasks = [
    createConsumerObservationTask({
      id: ids.task1,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: 1,
      surfaceProfileVersionId: ids.surface,
      collectionMethod: "browser_assisted",
      assignedTo: ids.user,
      createdAt: "2026-08-25T08:00:00.000Z",
    }),
    createConsumerObservationTask({
      id: ids.task2,
      scopeId: ids.scope,
      runId: ids.run,
      querySnapshotItemId: ids.query,
      sampleIndex: 2,
      surfaceProfileVersionId: ids.surface,
      collectionMethod: "browser_assisted",
      assignedTo: ids.user,
      createdAt: "2026-08-25T08:00:00.000Z",
    }),
  ];
  const observations = new InMemoryConsumerObservationRunRepository();
  const captureArtifacts =
    new InMemoryConsumerCaptureArtifactBindingRepository();
  await observations.createWithTasks(run, snapshot, tasks);
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  let now = "2026-08-25T08:01:00.000Z";
  let deletedRunId: string | null = null;
  const localAccess = {
    async authenticate(token: string) {
      if (token !== sessionToken) throw new Error("LOCAL_SESSION_INVALID");
      return {
        sessionToken,
        csrfToken,
        expiresAt: "2026-08-25T12:00:00.000Z",
        user: {
          id: ids.user,
          email: "owner@wentian.local",
          displayName: "问天 Owner",
          instanceRole: "owner" as const,
          allowedScopeIds: [ids.scope],
        },
      };
    },
    verifyCsrfToken(token: string, csrf: string) {
      return token === sessionToken && csrf === csrfToken;
    },
  } as unknown as LocalAccessApiService;
  const unused = {} as never;
  const options = {
    localAccess,
    automationSettings: {
      async getConsumerAutomationSettingsForCapture() {
        return {
          automationEnabled: true,
          allowedUsageRegion: "CN_MAINLAND" as const,
        };
      },
    },
    automationRuntime: {
      environment: "synthetic" as const,
      currentRegion: "CN_MAINLAND" as const,
      authorizationBasis: "none" as const,
      authorizationEvidenceId: null,
      authorizationReviewedAt: null,
    },
    publicOrigin,
    systemInstanceId: "wentian-instance-test",
    scopes: new InMemoryScopeRepository(),
    snapshots: Object.assign(snapshots, {
      async listByScope() {
        return [snapshot];
      },
    }),
    surfaces: new InMemoryConsumerSurfaceProfileVersionRepository([surface]),
    observations: Object.assign(observations, {
      async listRunsByScope() {
        return [run];
      },
    }),
    runDeletion: {
      async deleteUnstartedRun(input: { readonly runId: string }) {
        deletedRunId = input.runId;
        return { deletedRunId: input.runId };
      },
    },
    nominationReviews: new InMemorySourceNominationParseReviewRepository(),
    captureArtifacts,
    captureSubmissions: unused,
    mediaAssets: unused,
    objects: unused,
    captureTokens: new HmacCaptureTokenService("c".repeat(32)),
    automationBatchTokens: new HmacAutomationBatchTokenService("b".repeat(32)),
    captureTokenNonces: {
      async issue() {},
      async consumeOnce() {
        return true;
      },
    },
    confirmations: observations,
    now: () => now,
  } as unknown as StandaloneConsumerObservationApiOptions;

  return {
    options,
    deletedRunId: () => deletedRunId,
    async markCaptured(taskId: string, artifactId: string) {
      const task = await observations.findById(ids.scope, taskId);
      assert.ok(task);
      now = new Date(Date.parse(now) + 1_000).toISOString();
      const artifact = createConsumerCaptureEvidenceArtifact({
        id: artifactId,
        scopeId: ids.scope,
        observationTaskId: task.id,
        capturedBy: ids.user,
        collectionMethod: "browser_assisted",
        answerText: `第 ${task.sampleIndex} 次豆包可见回答。`,
        visibleCitations: [
          {
            url: "https://example.com/source",
            label: "示例信源",
            position: 1,
          },
        ],
        visibleMetadata: {
          productLabel: "豆包网页版",
          surfaceModelLabel: null,
          searchMode: "unknown",
          isNewConversation: true,
          isLoggedIn: true,
          memoryEnabled: null,
          personalizationEnabled: null,
          locale: "zh-CN",
          region: "CN_MAINLAND",
          observedAt: now,
        },
        screenshotMediaAssetId:
          taskId === ids.task1 ? ids.screenshot1 : ids.screenshot2,
        adapterVersion: "doubao-web@1-attended",
        createdAt: now,
      });
      await captureArtifacts.create(artifact);
      const captured = submitConsumerCaptureArtifact(task, artifact, {
        scopeId: ids.scope,
        userId: ids.user,
        taskVersion: task.version,
        occurredAt: now,
      });
      await observations.save(captured, task.version);
    },
  };
}

async function nextTask(baseUrl: string, batchToken: string) {
  const response = await fetch(
    `${baseUrl}/api/v1/ai-visibility/consumer-observations/automation-batches/next`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch_token: batchToken }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  return (await response.json()) as any;
}

async function withServer(
  server: ReturnType<typeof createWentianApiServer>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
