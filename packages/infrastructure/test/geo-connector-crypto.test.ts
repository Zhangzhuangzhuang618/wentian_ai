import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeoConnectorSignature,
  GeoConnectorSecretVault,
  verifyGeoConnectorSignature,
} from "../src/index.ts";

const signatureInput = {
  secret: "client-secret-that-is-at-least-32-bytes-long",
  method: "POST",
  path: "/api/v1/integrations/geo/sso-tickets",
  rawBody: '{"geo_user_ref":"user-1"}',
  issuedAt: "2026-08-23T12:00:00.000Z",
  nonce: "nonce-1",
  requestId: "request-1",
  idempotencyKey: "idempotency-1",
} as const;

test("连接器签名绑定方法、路径、正文和防重放字段", () => {
  const signature = createGeoConnectorSignature(signatureInput);
  assert.equal(verifyGeoConnectorSignature(signatureInput, signature), true);
  assert.equal(
    verifyGeoConnectorSignature(
      { ...signatureInput, rawBody: '{"geo_user_ref":"user-2"}' },
      signature,
    ),
    false,
  );
});

test("连接器凭证加密保存且错主密钥不能解密", () => {
  const vault = new GeoConnectorSecretVault("m".repeat(32));
  const encrypted = vault.encrypt(signatureInput.secret);
  assert.equal(encrypted.includes(signatureInput.secret), false);
  assert.equal(vault.decrypt(encrypted), signatureInput.secret);
  assert.throws(
    () => new GeoConnectorSecretVault("x".repeat(32)).decrypt(encrypted),
    /GEO_CONNECTOR_SECRET_CIPHERTEXT_INVALID/,
  );
});

test("连接器主密钥和客户端密钥不足32字节时失败关闭", () => {
  assert.throws(
    () => new GeoConnectorSecretVault("short"),
    /GEO_CONNECTOR_MASTER_SECRET_TOO_SHORT/,
  );
  assert.throws(
    () => createGeoConnectorSignature({ ...signatureInput, secret: "short" }),
    /GEO_CONNECTOR_CLIENT_SECRET_INVALID/,
  );
});
