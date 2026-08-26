import assert from "node:assert/strict";
import test from "node:test";

import { S3EvidenceObjectStore } from "../src/index.ts";

test("S3证据存储拒绝越界对象键和非PNG正文", async () => {
  const store = new S3EvidenceObjectStore({
    endpoint: "http://127.0.0.1:9000",
    bucket: "wentian-evidence",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    instanceId: "wentian-instance",
  });
  await assert.rejects(
    () =>
      store.putScreenshot({
        scopeId: "scope-1",
        assetId: "asset-1",
        bytes: Buffer.from("not-png"),
        observedAt: "2026-08-23T12:00:00.000Z",
      }),
    /INVALID_SCREENSHOT_PNG/,
  );
  await assert.rejects(
    () => store.deleteObject("another-instance/private.png"),
    /EVIDENCE_OBJECT_KEY_OUTSIDE_INSTANCE/,
  );
  await assert.rejects(
    () => store.deleteScopeObjects("../another-scope"),
    /INVALID_SCOPE_ID/,
  );
  store.destroy();
});

test("S3凭证或实例标识为空时拒绝启动", () => {
  assert.throws(
    () =>
      new S3EvidenceObjectStore({
        endpoint: "http://127.0.0.1:9000",
        bucket: "wentian-evidence",
        accessKeyId: "",
        secretAccessKey: "test-secret",
        instanceId: "wentian-instance",
      }),
    /S3_CREDENTIAL_REQUIRED/,
  );
});
