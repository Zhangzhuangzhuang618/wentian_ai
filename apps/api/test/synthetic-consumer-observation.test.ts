import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { ConsumerObservationWorkflowService } from "@wentian/application";
import {
  createCaptureTokenClaims,
  createConsumerObservationTask,
  createWentianPrincipal,
} from "@wentian/domain";
import {
  InMemoryCaptureTokenNonceRepository,
  InMemoryCaptureTokenVerifier,
  InMemoryConsumerCaptureArtifactBindingRepository,
  InMemoryConsumerObservationTaskRepository,
} from "@wentian/infrastructure";

import { createWentianApiServer } from "../src/server.ts";

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

const taskPath = `/dev/synthetic/consumer-observation/tasks/${ids.task}`;

test("合成HTTP接口完成领取、采集和幂等确认闭环", async () => {
  await withSyntheticServer({}, async (baseUrl) => {
    const claimed = await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    assert.equal(claimed.response.status, 200);
    assert.deepEqual(claimed.body, {
      schema_version: "wentian-synthetic-consumer-api@0",
      synthetic: true,
      task_id: ids.task,
      task_version: 2,
      status: "capturing",
      capture_token: "synthetic-capture-token",
    });

    const captured = await post(baseUrl, `${taskPath}/captures`, {
      scope_id: ids.scope,
      task_version: 2,
      capture_token: "synthetic-capture-token",
    });
    assert.equal(captured.response.status, 202);
    assert.equal(captured.body.status, "needs_review");
    assert.equal(captured.body.capture_artifact_id, ids.artifact);

    const missingKey = await post(baseUrl, `${taskPath}/confirm`, {
      scope_id: ids.scope,
      task_version: 3,
    });
    assert.equal(missingKey.response.status, 400);
    assert.equal(missingKey.body.error, "IDEMPOTENCY_KEY_REQUIRED");

    const confirmed = await post(
      baseUrl,
      `${taskPath}/confirm`,
      { scope_id: ids.scope, task_version: 3 },
      "confirm-1",
    );
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.status, "confirmed");
    assert.equal(confirmed.body.task_version, 4);
    assert.equal(confirmed.body.confirmed_response_id, ids.response);
    assert.equal(confirmed.body.evidence_grade, "web_confirmed_capture");

    const replayed = await post(
      baseUrl,
      `${taskPath}/confirm`,
      { scope_id: ids.scope, task_version: 3 },
      "confirm-1",
    );
    assert.equal(replayed.response.status, 200);
    assert.deepEqual(replayed.body, confirmed.body);

    const conflicting = await post(
      baseUrl,
      `${taskPath}/confirm`,
      { scope_id: ids.scope, task_version: 4 },
      "confirm-1",
    );
    assert.equal(conflicting.response.status, 409);
    assert.equal(conflicting.body.error, "IDEMPOTENCY_KEY_CONFLICT");
  });
});

test("合成拒绝接口清除暂存绑定且不返回证据等级", async () => {
  await withSyntheticServer({}, async (baseUrl) => {
    await claimAndCapture(baseUrl);
    const rejected = await post(
      baseUrl,
      `${taskPath}/reject`,
      {
        scope_id: ids.scope,
        task_version: 3,
        rejection_reason: "合成截图需要重采",
      },
      "reject-1",
    );

    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.body.status, "rejected");
    assert.equal(rejected.body.purged_capture_artifact_id, ids.artifact);
    assert.equal("evidence_grade" in rejected.body, false);

    const replayed = await post(
      baseUrl,
      `${taskPath}/reject`,
      {
        scope_id: ids.scope,
        task_version: 3,
        rejection_reason: "合成截图需要重采",
      },
      "reject-1",
    );
    assert.deepEqual(replayed.body, rejected.body);
  });
});

test("合成采集接口拒绝真实内容字段且失败不消费token", async () => {
  await withSyntheticServer({}, async (baseUrl) => {
    await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    const rejected = await post(baseUrl, `${taskPath}/captures`, {
      scope_id: ids.scope,
      task_version: 2,
      capture_token: "synthetic-capture-token",
      answer_text: "不应由合成接口接收的真实回答",
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error, "INVALID_REQUEST");

    const accepted = await post(baseUrl, `${taskPath}/captures`, {
      scope_id: ids.scope,
      task_version: 2,
      capture_token: "synthetic-capture-token",
    });
    assert.equal(accepted.response.status, 202);
  });
});

test("伪造token被拒绝且不影响随后合法提交", async () => {
  await withSyntheticServer({}, async (baseUrl) => {
    await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    const forged = await post(baseUrl, `${taskPath}/captures`, {
      scope_id: ids.scope,
      task_version: 2,
      capture_token: "forged-token",
    });
    assert.equal(forged.response.status, 401);
    assert.equal(forged.body.error, "CAPTURE_TOKEN_INVALID");

    const accepted = await post(baseUrl, `${taskPath}/captures`, {
      scope_id: ids.scope,
      task_version: 2,
      capture_token: "synthetic-capture-token",
    });
    assert.equal(accepted.response.status, 202);
  });
});

test("跨scope返回404而只读角色返回403", async () => {
  await withSyntheticServer({ allowedScopeIds: [] }, async (baseUrl) => {
    const response = await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    assert.equal(response.response.status, 404);
    assert.equal(response.body.error, "RESOURCE_NOT_FOUND");
  });
  await withSyntheticServer({ role: "viewer" }, async (baseUrl) => {
    const response = await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    assert.equal(response.response.status, 403);
    assert.equal(response.body.error, "ACTION_FORBIDDEN");
  });
});

test("合成路由默认关闭且只允许POST JSON", async () => {
  const server = createWentianApiServer({ version: "0.0.0-test" });
  await withListeningServer(server, async (baseUrl) => {
    const disabled = await fetch(`${baseUrl}${taskPath}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope_id: ids.scope, task_version: 1 }),
    });
    assert.equal(disabled.status, 404);
  });

  await withSyntheticServer({}, async (baseUrl) => {
    const wrongMethod = await fetch(`${baseUrl}${taskPath}/claim`);
    assert.equal(wrongMethod.status, 405);

    const wrongType = await fetch(`${baseUrl}${taskPath}/claim`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ scope_id: ids.scope, task_version: 1 }),
    });
    assert.equal(wrongType.status, 415);
  });
});

test("旧任务版本返回冲突且请求体限制为64KiB", async () => {
  await withSyntheticServer({}, async (baseUrl) => {
    await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    const stale = await post(baseUrl, `${taskPath}/claim`, {
      scope_id: ids.scope,
      task_version: 1,
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.error, "OBSERVATION_TASK_VERSION_CONFLICT");
  });

  await withSyntheticServer({}, async (baseUrl) => {
    const oversized = await fetch(`${baseUrl}${taskPath}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(70_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, "REQUEST_TOO_LARGE");
  });
});

async function claimAndCapture(baseUrl: string): Promise<void> {
  await post(baseUrl, `${taskPath}/claim`, {
    scope_id: ids.scope,
    task_version: 1,
  });
  await post(baseUrl, `${taskPath}/captures`, {
    scope_id: ids.scope,
    task_version: 2,
    capture_token: "synthetic-capture-token",
  });
}

async function post(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{
  readonly response: Response;
  readonly body: Record<string, unknown>;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wentian.example.com",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function withSyntheticServer(
  principalChanges: {
    readonly role?: "owner" | "admin" | "analyst" | "viewer";
    readonly allowedScopeIds?: readonly string[];
  },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
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
    role: principalChanges.role ?? "analyst",
    allowedScopeIds: principalChanges.allowedScopeIds ?? [ids.scope],
  });
  const workflow = new ConsumerObservationWorkflowService({
    tasks: new InMemoryConsumerObservationTaskRepository([task]),
    captureArtifacts: new InMemoryConsumerCaptureArtifactBindingRepository(),
    captureTokens: new InMemoryCaptureTokenVerifier([
      [
        "synthetic-capture-token",
        createCaptureTokenClaims({
          systemInstanceId: "wentian-instance-test",
          scopeId: ids.scope,
          taskId: ids.task,
          userId: ids.user,
          audienceOrigin: "https://wentian.example.com",
          nonce: "synthetic-nonce-1",
          issuedAt: "2026-08-22T10:00:00.000Z",
          expiresAt: "2026-08-22T10:10:00.000Z",
        }),
      ],
    ]),
    captureTokenNonces: new InMemoryCaptureTokenNonceRepository(),
    systemInstanceId: "wentian-instance-test",
  });
  const generatedIds = [ids.artifact, ids.response];
  let nowIndex = 0;
  const server = createWentianApiServer({
    version: "0.0.0-test",
    syntheticConsumerObservationApi: {
      workflow,
      task: {
        taskId: ids.task,
        scopeId: ids.scope,
        runId: ids.run,
        querySnapshotItemId: ids.query,
        sampleIndex: 1,
        collectionMethod: "browser_assisted",
      },
      captureToken: "synthetic-capture-token",
      resolvePrincipal: () => principal,
      newId: () => generatedIds.shift() ?? ids.response,
      now: () => {
        nowIndex += 1;
        return `2026-08-22T10:0${nowIndex}:00.000Z`;
      },
    },
  });

  await withListeningServer(server, run);
}

async function withListeningServer(
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
