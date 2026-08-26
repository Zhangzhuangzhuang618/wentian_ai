import assert from "node:assert/strict";
import test from "node:test";

import {
  ConsumerObservationWorkflowService,
  WentianApplicationError,
} from "@wentian/application";
import {
  createCaptureTokenClaims,
  createConsumerCaptureEvidenceArtifact,
  createConsumerObservationTask,
  createWentianPrincipal,
} from "@wentian/domain";

import {
  InMemoryCaptureTokenNonceRepository,
  InMemoryCaptureTokenVerifier,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationTaskRepository,
} from "../src/index.ts";

const ids = {
  task: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  run: "31111111-1111-4111-8111-111111111111",
  query: "41111111-1111-4111-8111-111111111111",
  surface: "51111111-1111-4111-8111-111111111111",
  user: "61111111-1111-4111-8111-111111111111",
  artifact: "71111111-1111-4111-8111-111111111111",
  response: "81111111-1111-4111-8111-111111111111",
} as const;

test("纯内存工作流完成领取、提交和服务端确认闭环", async () => {
  const { service, principal } = createFixture();
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const needsReview = await service.submitCapture(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
    captureToken: "capture-token-1",
    requestOrigin: "https://wentian.example.com",
    artifact: artifactBinding(),
  });
  const confirmed = await service.confirm(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: needsReview.version,
    occurredAt: "2026-08-22T10:03:00.000Z",
    response: responseBinding(),
  });

  assert.equal(capturing.status, "capturing");
  assert.equal(needsReview.status, "needs_review");
  assert.equal(confirmed.task.status, "confirmed");
  assert.equal(confirmed.evidenceGrade, "web_confirmed_capture");
});

test("已经消费的capture token nonce不能再次提交", async () => {
  const { service, principal, captureTokenNonces } = createFixture();
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  await captureTokenNonces.consumeOnce("nonce-1");

  await assert.rejects(
    () =>
      service.submitCapture(principal, {
        scopeId: ids.scope,
        taskId: ids.task,
        taskVersion: capturing.version,
        occurredAt: "2026-08-22T10:02:00.000Z",
        captureToken: "capture-token-1",
        requestOrigin: "https://wentian.example.com",
        artifact: artifactBinding(),
      }),
    /CAPTURE_TOKEN_ALREADY_CONSUMED/,
  );
});

test("绑定校验失败时不消费capture token", async () => {
  const { service, principal } = createFixture();
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const command = {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
    captureToken: "capture-token-1",
    requestOrigin: "https://wentian.example.com",
  } as const;

  await assert.rejects(() =>
    service.submitCapture(principal, {
      ...command,
      artifact: {
        ...artifactBinding(),
        scopeId: "99999999-9999-4999-8999-999999999999",
      },
    }),
  );
  const submitted = await service.submitCapture(principal, {
    ...command,
    artifact: artifactBinding(),
  });

  assert.equal(submitted.status, "needs_review");
});

test("完整证据artifact的服务端创建时间必须等于采集提交时间", async () => {
  const { service, principal } = createFixture();
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const command = {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
    captureToken: "capture-token-1",
    requestOrigin: "https://wentian.example.com",
  } as const;

  await assert.rejects(
    () =>
      service.submitCapture(principal, {
        ...command,
        artifact: evidenceArtifact("2026-08-22T10:01:59.000Z"),
      }),
    /CAPTURE_ARTIFACT_TIMESTAMP_MISMATCH/,
  );
  const submitted = await service.submitCapture(principal, {
    ...command,
    artifact: evidenceArtifact("2026-08-22T10:02:00.000Z"),
  });
  assert.equal(submitted.status, "needs_review");
});

test("确认前再次复核完整证据artifact完整性", async () => {
  const { service, principal } = createFixture({ corruptArtifactOnRead: true });
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const needsReview = await service.submitCapture(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
    captureToken: "capture-token-1",
    requestOrigin: "https://wentian.example.com",
    artifact: evidenceArtifact("2026-08-22T10:02:00.000Z"),
  });

  await assert.rejects(
    () =>
      service.confirm(principal, {
        scopeId: ids.scope,
        taskId: ids.task,
        taskVersion: needsReview.version,
        occurredAt: "2026-08-22T10:03:00.000Z",
        response: responseBinding(),
      }),
    /CAPTURE_EVIDENCE_ARTIFACT_INTEGRITY_MISMATCH/,
  );
});

test("调用方不能用自造字符串绕过capture token验证", async () => {
  const { service, principal } = createFixture();
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });

  await assert.rejects(
    () =>
      service.submitCapture(principal, {
        scopeId: ids.scope,
        taskId: ids.task,
        taskVersion: capturing.version,
        occurredAt: "2026-08-22T10:02:00.000Z",
        captureToken: "forged-token",
        requestOrigin: "https://wentian.example.com",
        artifact: artifactBinding(),
      }),
    /CAPTURE_TOKEN_INVALID/,
  );
});

test("无scope权限时统一隐藏任务是否存在", async () => {
  const { service } = createFixture();
  const outsider = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [],
  });

  await assert.rejects(
    () =>
      service.claim(outsider, {
        scopeId: ids.scope,
        taskId: ids.task,
        taskVersion: 1,
        occurredAt: "2026-08-22T10:01:00.000Z",
      }),
    (error) =>
      error instanceof WentianApplicationError &&
      error.code === "RESOURCE_NOT_FOUND",
  );
});

test("scope内只读角色不能领取或确认观察任务", async () => {
  const { service } = createFixture();
  const viewer = createWentianPrincipal({
    userId: ids.user,
    role: "viewer",
    allowedScopeIds: [ids.scope],
  });

  await assert.rejects(
    () =>
      service.claim(viewer, {
        scopeId: ids.scope,
        taskId: ids.task,
        taskVersion: 1,
        occurredAt: "2026-08-22T10:01:00.000Z",
      }),
    (error) =>
      error instanceof WentianApplicationError &&
      error.code === "ACTION_FORBIDDEN",
  );
});

test("拒绝流程返回待清除证据且不生成证据等级", async () => {
  const { service, principal, captureArtifacts } = createFixture();
  const capturing = await service.claim(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: 1,
    occurredAt: "2026-08-22T10:01:00.000Z",
  });
  const needsReview = await service.submitCapture(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: capturing.version,
    occurredAt: "2026-08-22T10:02:00.000Z",
    captureToken: "capture-token-1",
    requestOrigin: "https://wentian.example.com",
    artifact: evidenceArtifact("2026-08-22T10:02:00.000Z"),
  });
  const rejected = await service.reject(principal, {
    scopeId: ids.scope,
    taskId: ids.task,
    taskVersion: needsReview.version,
    occurredAt: "2026-08-22T10:03:00.000Z",
    rejectionReason: "截图需要重采",
  });

  assert.equal(rejected.task.status, "rejected");
  assert.equal(rejected.artifactIdToPurge, ids.artifact);
  assert.equal("evidenceGrade" in rejected, false);
  assert.equal(await captureArtifacts.findById(ids.scope, ids.artifact), null);
});

function createFixture(options: { corruptArtifactOnRead?: boolean } = {}) {
  const task = createConsumerObservationTask({
    id: ids.task,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    surfaceProfileVersionId: ids.surface,
    collectionMethod: "browser_assisted",
    assignedTo: ids.user,
    createdAt: "2026-08-22T10:00:00.000Z",
  });
  const principal = createWentianPrincipal({
    userId: ids.user,
    role: "analyst",
    allowedScopeIds: [ids.scope],
  });
  const captureArtifacts =
    new InMemoryConsumerCaptureArtifactBindingRepository();
  const workflowCaptureArtifacts = options.corruptArtifactOnRead
    ? {
        create: captureArtifacts.create.bind(captureArtifacts),
        async findById(scopeId: string, artifactId: string) {
          const artifact = await captureArtifacts.findById(scopeId, artifactId);
          return artifact && "answerHash" in artifact
            ? { ...artifact, answerHash: "0".repeat(64) }
            : artifact;
        },
        purge: captureArtifacts.purge.bind(captureArtifacts),
      }
    : captureArtifacts;
  const captureTokenNonces = new InMemoryCaptureTokenNonceRepository();
  const captureTokens = new InMemoryCaptureTokenVerifier([
    ["capture-token-1", tokenClaims()],
  ]);
  return {
    principal,
    captureArtifacts,
    captureTokenNonces,
    service: new ConsumerObservationWorkflowService({
      tasks: new InMemoryConsumerObservationTaskRepository([task]),
      captureArtifacts: workflowCaptureArtifacts,
      captureTokens,
      captureTokenNonces,
      systemInstanceId: "wentian-instance-1",
    }),
  };
}

function tokenClaims() {
  return createCaptureTokenClaims({
    systemInstanceId: "wentian-instance-1",
    scopeId: ids.scope,
    taskId: ids.task,
    userId: ids.user,
    audienceOrigin: "https://wentian.example.com",
    nonce: "nonce-1",
    issuedAt: "2026-08-22T10:00:00.000Z",
    expiresAt: "2026-08-22T10:10:00.000Z",
  });
}

function artifactBinding() {
  return {
    id: ids.artifact,
    scopeId: ids.scope,
    observationTaskId: ids.task,
    capturedBy: ids.user,
    collectionMethod: "browser_assisted" as const,
  };
}

function responseBinding() {
  return {
    id: ids.response,
    scopeId: ids.scope,
    runId: ids.run,
    querySnapshotItemId: ids.query,
    sampleIndex: 1,
    captureArtifactId: ids.artifact,
  };
}

function evidenceArtifact(createdAt: string) {
  return createConsumerCaptureEvidenceArtifact({
    ...artifactBinding(),
    answerText: "合成回答。",
    visibleCitations: [],
    visibleMetadata: {
      productLabel: "合成Surface",
      surfaceModelLabel: null,
      searchMode: "unknown",
      isNewConversation: true,
      isLoggedIn: false,
      memoryEnabled: null,
      personalizationEnabled: null,
      locale: "zh-CN",
      region: null,
      observedAt: "2026-08-22T10:01:59.000Z",
    },
    screenshotMediaAssetId: "screenshot-1",
    adapterVersion: "synthetic@1",
    createdAt,
  });
}
