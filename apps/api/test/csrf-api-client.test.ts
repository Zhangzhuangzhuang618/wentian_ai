import assert from "node:assert/strict";
import test from "node:test";

import { requestJsonWithCsrfRecovery } from "../public/csrf-api-client.js";

test("写请求遇到过期CSRF时刷新令牌并只重试一次", async () => {
  const tokens: string[] = [];
  let attempts = 0;
  let refreshes = 0;
  const result = await requestJsonWithCsrfRecovery({
    path: "/api/v1/example",
    options: { method: "POST", body: { value: 1 } },
    csrfToken: "old-token",
    fetchImpl: async (_path, init) => {
      attempts += 1;
      tokens.push(new Headers(init?.headers).get("x-wentian-csrf-token") ?? "");
      return new Response(
        JSON.stringify(
          attempts === 1
            ? { error: "CSRF_TOKEN_INVALID" }
            : { status: "created" },
        ),
        {
          status: attempts === 1 ? 403 : 201,
          headers: { "content-type": "application/json" },
        },
      );
    },
    refreshCsrfToken: async () => {
      refreshes += 1;
      return "new-token";
    },
  });

  assert.deepEqual(result, { status: "created" });
  assert.deepEqual(tokens, ["old-token", "new-token"]);
  assert.equal(refreshes, 1);
});

test("刷新后仍被拒绝时停止而不循环重试", async () => {
  let attempts = 0;
  let refreshes = 0;
  await assert.rejects(
    requestJsonWithCsrfRecovery({
      path: "/api/v1/example",
      options: { method: "PATCH", body: {} },
      csrfToken: "old-token",
      fetchImpl: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: "CSRF_TOKEN_INVALID" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      },
      refreshCsrfToken: async () => {
        refreshes += 1;
        return "new-token";
      },
    }),
    /CSRF_TOKEN_INVALID/,
  );

  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
});

test("浏览器fetch始终使用全局对象作为调用接收者", async () => {
  let receiver: unknown;
  await requestJsonWithCsrfRecovery({
    path: "/api/v1/example",
    csrfToken: null,
    fetchImpl: async function () {
      receiver = this;
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    refreshCsrfToken: async () => "unused",
  });

  assert.equal(receiver, globalThis);
});
