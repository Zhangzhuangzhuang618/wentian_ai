import assert from "node:assert/strict";
import test from "node:test";

import { createStandaloneReadinessChecker } from "../src/index.ts";

test("未配置独立依赖时明确返回not_configured", async () => {
  const checks = await createStandaloneReadinessChecker({})();

  assert.deepEqual(checks, {
    database: "not_configured",
    objectStore: "not_configured",
  });
});

test("数据库和对象存储真实探测成功时返回ready", async () => {
  let requestedUrl = "";
  const checks = await createStandaloneReadinessChecker({
    databasePool: {
      query: async () => ({ rows: [{ "?column?": 1 }] }),
    } as never,
    objectStoreEndpoint: "http://object-store:9000/",
    fetchImpl: (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  })();

  assert.deepEqual(checks, { database: "ready", objectStore: "ready" });
  assert.equal(requestedUrl, "http://object-store:9000/minio/health/ready");
});

test("探测异常和非成功响应返回unavailable", async () => {
  const checks = await createStandaloneReadinessChecker({
    databasePool: {
      query: async () => {
        throw new Error("offline");
      },
    } as never,
    objectStoreEndpoint: "http://object-store:9000",
    fetchImpl: (async () =>
      new Response(null, { status: 503 })) as typeof fetch,
  })();

  assert.deepEqual(checks, {
    database: "unavailable",
    objectStore: "unavailable",
  });
});
