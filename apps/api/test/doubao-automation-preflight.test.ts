import assert from "node:assert/strict";
import test from "node:test";

import {
  claimConsumerObservationTask,
  createCaptureTokenClaims,
  createConsumerObservationRun,
  createConsumerObservationTask,
  createConsumerSurfaceProfileVersion,
  createQuerySetSnapshot,
} from "@wentian/domain";
import {
  InMemoryCaptureTokenVerifier,
  InMemoryConsumerObservationRunRepository,
  InMemoryConsumerSurfaceProfileVersionRepository,
  InMemoryQuerySetSnapshotRepository,
} from "@wentian/infrastructure";

import { DoubaoAutomationPreflightService } from "../src/doubao-automation-preflight.ts";

const ids = {
  scope: "11111111-1111-4111-8111-111111111111",
  snapshot: "21111111-1111-4111-8111-111111111111",
  query: "31111111-1111-4111-8111-111111111111",
  surface: "41111111-1111-4111-8111-111111111111",
  run: "51111111-1111-4111-8111-111111111111",
  task: "61111111-1111-4111-8111-111111111111",
  user: "71111111-1111-4111-8111-111111111111",
} as const;

test("生产书面授权、项目开关和任务令牌同时满足时返回当前问题", async () => {
  const fixture = await createFixture({
    automationEnabled: true,
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-001",
  });

  const result = await fixture.service.execute({
    taskId: ids.task,
    taskVersion: 2,
    captureToken: "capture-token",
  });

  assert.equal(result.prompt, "广州搬家公司哪家好？");
  assert.equal(result.expectedPageOrigin, "https://www.doubao.com");
  assert.equal(result.taskVersion, 2);
});

test("千问任务返回千问官网页面签名且使用独立自动化门禁", async () => {
  const fixture = await createFixture({
    automationEnabled: true,
    surfaceCode: "qianwen_web",
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-QIANWEN-001",
  });

  const result = await fixture.service.execute({
    taskId: ids.task,
    taskVersion: 2,
    captureToken: "capture-token",
  });

  assert.equal(result.surfaceCode, "qianwen_web");
  assert.equal(result.expectedPageOrigin, "https://www.qianwen.com");
  assert.equal(
    result.pageSignatureVersion,
    "qianwen-web-signature@2-visible-reference-panel",
  );
});

test("项目开关关闭或生产授权缺失时失败关闭", async () => {
  const disabled = await createFixture({ automationEnabled: false });
  await assert.rejects(
    disabled.service.execute({
      taskId: ids.task,
      taskVersion: 2,
      captureToken: "capture-token",
    }),
    /AUTOMATION_SWITCH_DISABLED/,
  );

  const unauthorized = await createFixture({ automationEnabled: true });
  await assert.rejects(
    unauthorized.service.execute({
      taskId: ids.task,
      taskVersion: 2,
      captureToken: "capture-token",
    }),
    /PRODUCTION_AUTHORIZATION_REQUIRED/,
  );
});

test("官方接口授权不能放行可见页面驱动", async () => {
  const fixture = await createFixture({
    automationEnabled: true,
    authorizationBasis: "official_interface",
    authorizationEvidenceId: "AUTH-API-001",
  });

  await assert.rejects(
    fixture.service.execute({
      taskId: ids.task,
      taskVersion: 2,
      captureToken: "capture-token",
    }),
    /PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH/,
  );
});

test("生产授权缺少复核时间或超过90天时失败关闭", async () => {
  const missingReview = await createFixture({
    automationEnabled: true,
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-001",
    authorizationReviewedAt: null,
  });
  await assert.rejects(
    missingReview.service.execute({
      taskId: ids.task,
      taskVersion: 2,
      captureToken: "capture-token",
    }),
    /PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED/,
  );

  const expiredReview = await createFixture({
    automationEnabled: true,
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-001",
    authorizationReviewedAt: "2026-05-25T23:59:59.999Z",
  });
  await assert.rejects(
    expiredReview.service.execute({
      taskId: ids.task,
      taskVersion: 2,
      captureToken: "capture-token",
    }),
    /PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED/,
  );
});

test("过期令牌或任务版本变化时不返回问题", async () => {
  const expired = await createFixture({
    automationEnabled: true,
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-001",
    tokenExpiresAt: "2026-08-23T23:59:59.000Z",
  });
  await assert.rejects(
    expired.service.execute({
      taskId: ids.task,
      taskVersion: 2,
      captureToken: "capture-token",
    }),
    /CAPTURE_TOKEN_EXPIRED/,
  );

  const stale = await createFixture({
    automationEnabled: true,
    authorizationBasis: "written_permission",
    authorizationEvidenceId: "AUTH-001",
  });
  await assert.rejects(
    stale.service.execute({
      taskId: ids.task,
      taskVersion: 1,
      captureToken: "capture-token",
    }),
    /TASK_VERSION_CONFLICT/,
  );
});

async function createFixture(options: {
  readonly automationEnabled: boolean;
  readonly authorizationBasis?:
    "none" | "official_interface" | "written_permission";
  readonly authorizationEvidenceId?: string | null;
  readonly tokenExpiresAt?: string;
  readonly authorizationReviewedAt?: string | null;
  readonly surfaceCode?: "doubao_web" | "qianwen_web";
}) {
  const surfaceCode = options.surfaceCode ?? "doubao_web";
  const snapshot = createQuerySetSnapshot({
    id: ids.snapshot,
    itemIds: [ids.query],
    scopeId: ids.scope,
    title: "广州搬家",
    locale: "zh-CN",
    market: "Guangzhou",
    source: { type: "local" },
    queries: [
      {
        queryText: "广州搬家公司哪家好？",
        intentCode: "recommendation",
        commercialValue: "high",
      },
    ],
    createdBy: ids.user,
    createdAt: "2026-08-23T23:50:00.000Z",
  });
  const surface = createConsumerSurfaceProfileVersion({
    id: ids.surface,
    surfaceCode,
    productLabel: surfaceCode === "qianwen_web" ? "千问网页版" : "豆包网页版",
    adapterVersion:
      surfaceCode === "qianwen_web"
        ? "qianwen-web@2-visible-reference-panel"
        : "doubao-web@1-attended",
    allowedCollectionMethods: ["browser_assisted"],
    visibleSourceCapabilities: {
      visibleCitations: true,
      sourcePanel: true,
      screenshot: true,
      sanitizedDom: false,
    },
    equivalenceLevel: "unknown",
    termsReviewedAt: "2026-08-23T23:50:00.000Z",
    status: "active",
    createdBy: ids.user,
    createdAt: "2026-08-23T23:50:00.000Z",
  });
  const run = createConsumerObservationRun({
    id: ids.run,
    snapshot,
    surfaceProfile: surface,
    collectionMethod: "browser_assisted",
    experimentKind: "natural_answer",
    requestedSampleCount: 1,
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
    createdAt: "2026-08-23T23:50:00.000Z",
  });
  const waitingTask = createConsumerObservationTask({
    id: ids.task,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    assignedTo: ids.user,
    createdAt: "2026-08-23T23:50:00.000Z",
  });
  const task = claimConsumerObservationTask(waitingTask, {
    scopeId: ids.scope,
    userId: ids.user,
    taskVersion: 1,
    occurredAt: "2026-08-23T23:51:00.000Z",
  });
  const tasks = new InMemoryConsumerObservationRunRepository();
  await tasks.createWithTasks(run, snapshot, [task]);
  const snapshots = new InMemoryQuerySetSnapshotRepository();
  await snapshots.getOrCreate(snapshot);
  const claims = createCaptureTokenClaims({
    systemInstanceId: "wentian-test",
    scopeId: ids.scope,
    taskId: ids.task,
    userId: ids.user,
    audienceOrigin: "http://127.0.0.1:3000",
    nonce: "test-nonce",
    issuedAt: "2026-08-23T23:51:00.000Z",
    expiresAt: options.tokenExpiresAt ?? "2026-08-24T00:10:00.000Z",
  });
  return {
    service: new DoubaoAutomationPreflightService({
      systemInstanceId: "wentian-test",
      publicOrigin: "http://127.0.0.1:3000",
      captureTokens: new InMemoryCaptureTokenVerifier([
        ["capture-token", claims],
      ]),
      tasks,
      snapshots,
      surfaces: new InMemoryConsumerSurfaceProfileVersionRepository([surface]),
      settings: {
        async getConsumerAutomationSettingsForCapture() {
          return {
            automationEnabled: options.automationEnabled,
            allowedUsageRegion: "CN_MAINLAND" as const,
          };
        },
      },
      runtime: {
        environment: "production",
        currentRegion: "CN_MAINLAND",
        authorizationBasis: options.authorizationBasis ?? "none",
        authorizationEvidenceId:
          options.authorizationEvidenceId === undefined
            ? null
            : options.authorizationEvidenceId,
        authorizationReviewedAt:
          options.authorizationReviewedAt === undefined
            ? options.authorizationEvidenceId
              ? "2026-08-24T00:00:00.000Z"
              : null
            : options.authorizationReviewedAt,
      },
      qianwenRuntime: {
        environment: "production",
        currentRegion: "CN_MAINLAND",
        authorizationBasis: options.authorizationBasis ?? "none",
        authorizationEvidenceId:
          options.authorizationEvidenceId === undefined
            ? null
            : options.authorizationEvidenceId,
        authorizationReviewedAt:
          options.authorizationReviewedAt === undefined
            ? options.authorizationEvidenceId
              ? "2026-08-24T00:00:00.000Z"
              : null
            : options.authorizationReviewedAt,
      },
      now: () => "2026-08-24T00:00:00.000Z",
    }),
  };
}
