import assert from "node:assert/strict";
import test from "node:test";

import {
  livenessResponseSchema,
  readinessResponseSchema,
} from "../src/index.ts";

test("liveness契约拒绝空版本", () => {
  assert.equal(
    livenessResponseSchema.safeParse({
      status: "ok",
      service: "wentian-api",
      version: "",
    }).success,
    false,
  );
});

test("readiness契约明确区分未配置与不可用", () => {
  const parsed = readinessResponseSchema.parse({
    status: "not_ready",
    service: "wentian-api",
    version: "0.0.0-dev",
    checks: {
      database: "not_configured",
      objectStore: "ready",
    },
  });

  assert.equal(parsed.checks.database, "not_configured");
  assert.equal(parsed.checks.objectStore, "ready");
  assert.equal(
    readinessResponseSchema.safeParse({
      status: "not_ready",
      service: "wentian-api",
      version: "0.0.0-dev",
      checks: {
        database: "ready",
        objectStore: "ready",
        queue: "ready",
      },
    }).success,
    false,
  );
});
