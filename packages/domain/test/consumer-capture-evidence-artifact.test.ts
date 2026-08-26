import assert from "node:assert/strict";
import test from "node:test";

import {
  assertConsumerCaptureEvidenceArtifactIntegrity,
  createConsumerCaptureEvidenceArtifact,
  isConsumerCaptureEvidenceArtifact,
  type ConsumerCaptureEvidenceArtifact,
} from "../src/index.ts";

test("创建不可变待复核证据并计算回答与引用包哈希", () => {
  const artifact = createArtifact();

  assert.equal(artifact.answerText, "  合成回答原文。\n");
  assert.match(artifact.answerHash, /^[0-9a-f]{64}$/);
  assert.match(artifact.captureSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.visibleCitations), true);
  assert.equal(Object.isFrozen(artifact.visibleMetadata), true);
  assert.equal(isConsumerCaptureEvidenceArtifact(artifact), true);
  assert.doesNotThrow(() =>
    assertConsumerCaptureEvidenceArtifactIntegrity(artifact),
  );
});

test("截图引用变化会改变capture哈希", () => {
  const first = createArtifact();
  const second = createArtifact({ screenshotMediaAssetId: "screenshot-2" });

  assert.equal(first.answerHash, second.answerHash);
  assert.notEqual(first.captureSha256, second.captureSha256);
});

test("DOM对象键与SHA-256必须成对存在", () => {
  assert.throws(
    () => createArtifact({ sanitizedDomObjectKey: "evidence/dom.html" }),
    /CAPTURE_DOM_REFERENCE_HASH_PAIR_REQUIRED/,
  );
  assert.throws(
    () => createArtifact({ domHash: "not-a-sha256" }),
    /INVALID_CAPTURE_DOM_HASH/,
  );
});

test("artifact创建时间不能早于页面观察时间", () => {
  assert.throws(
    () =>
      createArtifact({
        visibleMetadata: {
          ...metadata(),
          observedAt: "2026-08-22T10:02:01.000Z",
        },
      }),
    /CAPTURE_CREATED_BEFORE_OBSERVATION/,
  );
});

test("篡改回答哈希、capture哈希或追加敏感字段会被完整性校验拒绝", () => {
  const artifact = createArtifact();
  const candidates = [
    { ...artifact, answerHash: "0".repeat(64) },
    { ...artifact, captureSha256: "0".repeat(64) },
    { ...artifact, cookie: "forbidden" },
  ];

  for (const candidate of candidates) {
    assert.throws(
      () =>
        assertConsumerCaptureEvidenceArtifactIntegrity(
          candidate as ConsumerCaptureEvidenceArtifact,
        ),
      /CAPTURE_EVIDENCE_ARTIFACT_INTEGRITY_MISMATCH/,
    );
  }
});

function createArtifact(
  overrides: Partial<
    Parameters<typeof createConsumerCaptureEvidenceArtifact>[0]
  > = {},
) {
  return createConsumerCaptureEvidenceArtifact({
    id: "artifact-1",
    scopeId: "scope-1",
    observationTaskId: "task-1",
    capturedBy: "user-1",
    collectionMethod: "browser_assisted",
    answerText: "  合成回答原文。\n",
    visibleCitations: [{ url: "https://www.example.com/source", position: 1 }],
    visibleMetadata: metadata(),
    screenshotMediaAssetId: "screenshot-1",
    adapterVersion: "doubao-web@1",
    createdAt: "2026-08-22T10:02:00.000Z",
    ...overrides,
  });
}

function metadata() {
  return {
    productLabel: "豆包网页版",
    surfaceModelLabel: null,
    searchMode: "unknown" as const,
    isNewConversation: true,
    isLoggedIn: true,
    memoryEnabled: null,
    personalizationEnabled: null,
    locale: "zh-CN",
    region: "Guangzhou",
    observedAt: "2026-08-22T10:01:59.000Z",
  };
}
