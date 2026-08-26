import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  AuthenticatedGeoConnector,
  GeoProjectBindingRecord,
  GeoSignedRequestInput,
} from "@wentian/infrastructure";

import type { GeoIntegrationApiService } from "../src/geo-integration-api.ts";
import { createWentianApiServer } from "../src/server.ts";

const ids = {
  connector: "11111111-1111-4111-8111-111111111111",
  binding: "21111111-1111-4111-8111-111111111111",
  scope: "31111111-1111-4111-8111-111111111111",
  snapshot: "41111111-1111-4111-8111-111111111111",
} as const;

test("签名Integration API完成绑定、SSO票据和问题集同步路由", async () => {
  await withServer(async (baseUrl, service) => {
    const binding = await signedJson(
      baseUrl,
      "/api/v1/integrations/geo/project-binding-requests",
      "POST",
      {
        geo_workspace_ref: "workspace-1",
        geo_project_ref: "project-1",
        geo_project_display_name: "广州搬家",
      },
    );
    assert.equal(binding.status, "pending_wentian");

    const ticket = await signedJson(
      baseUrl,
      "/api/v1/integrations/geo/sso-tickets",
      "POST",
      {
        geo_user_ref: "user-1",
        geo_project_ref: "project-1",
        display_name: "分析员",
        role_codes: ["analyst"],
      },
    );
    assert.match(ticket.launch_url, /\/connect\/geo\?code=/);

    const synced = await signedJson(
      baseUrl,
      `/api/v1/integrations/geo/project-bindings/${ids.binding}/query-set-snapshots`,
      "PUT",
      {
        geo_query_set_ref: "set-1",
        geo_revision: "1",
        title: "广州搬家问题",
        locale: "zh-CN",
        queries: [
          {
            external_key: "q1",
            text: "广州搬家公司哪家好？",
            intent: "recommendation",
            commercial_value: "high",
          },
        ],
      },
    );
    assert.equal(synced.snapshot_id, ids.snapshot);
    assert.equal(service.authenticatedRequests, 3);
  });
});

test("一次性launch code建立HttpOnly会话并禁止Referer", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/connect/geo?code=${"a".repeat(43)}`,
      {
        redirect: "manual",
      },
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
    assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Strict/);
  });
});

test("签名接口不会拦截问天本地连接器管理路由", async () => {
  await withServer(async (baseUrl, service) => {
    const response = await fetch(
      `${baseUrl}/api/v1/integrations/geo/connectors`,
      { method: "POST" },
    );
    assert.equal(response.status, 404);
    assert.equal(service.authenticatedRequests, 0);
  });
});

class FakeGeoIntegrationService implements GeoIntegrationApiService {
  authenticatedRequests = 0;

  async authenticateSignedRequest(
    input: GeoSignedRequestInput,
  ): Promise<AuthenticatedGeoConnector> {
    assert.equal(input.connectorId, ids.connector);
    assert.equal(input.contractVersion, "wentian-geo-connector@1");
    this.authenticatedRequests += 1;
    return {
      connector: {
        id: ids.connector,
        geoInstanceRef: "geo-instance-1",
        geoTenantRef: "tenant-1",
        displayName: "GEO",
        allowedGeoOrigins: ["https://geo.example.com"],
        callbackBaseUrl: null,
        status: "active",
        contractVersion: "wentian-geo-connector@1",
        version: 1,
        createdAt: "2026-08-23T12:00:00.000Z",
        updatedAt: "2026-08-23T12:00:00.000Z",
      },
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      requestHash: "a".repeat(64),
    };
  }

  async requestBinding(): Promise<GeoProjectBindingRecord> {
    return binding("pending_wentian", null);
  }

  async withdrawBinding(): Promise<GeoProjectBindingRecord> {
    return binding("disconnected", null);
  }

  async findBindingByGeoProject(): Promise<GeoProjectBindingRecord> {
    return binding("active", ids.scope);
  }

  async disconnectBinding(): Promise<GeoProjectBindingRecord> {
    return binding("disconnected", ids.scope);
  }

  async issueSsoTicket() {
    return {
      launchUrl: `http://127.0.0.1/connect/geo?code=${"a".repeat(43)}`,
      expiresAt: "2026-08-23T12:01:00.000Z",
    };
  }

  async consumeSsoTicket() {
    return {
      sessionToken: "b".repeat(43),
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      redirectPath: "/",
    };
  }

  async syncQuerySet() {
    return {
      snapshotId: ids.snapshot,
      snapshotHash: "c".repeat(64),
      queryCount: 1,
      created: true,
    };
  }
}

function binding(
  status: GeoProjectBindingRecord["status"],
  scopeId: string | null,
): GeoProjectBindingRecord {
  return {
    id: ids.binding,
    connectorInstanceId: ids.connector,
    geoWorkspaceRef: "workspace-1",
    geoProjectRef: "project-1",
    geoProjectDisplayName: "广州搬家",
    scopeId,
    status,
    version: 1,
    requestedAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    decisionReason: null,
  };
}

async function signedJson(
  baseUrl: string,
  path: string,
  method: string,
  body: unknown,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-wentian-connector-id": ids.connector,
      "x-wentian-contract-version": "wentian-geo-connector@1",
      "x-wentian-signature": "signature",
      "x-wentian-issued-at": "2026-08-23T12:00:00.000Z",
      "x-wentian-nonce": `nonce-${Math.random()}`,
      "x-wentian-request-id": `request-${Math.random()}`,
      "idempotency-key": `idempotency-${Math.random()}`,
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();
  assert.equal(response.ok, true, responseBody);
  return JSON.parse(responseBody);
}

async function withServer(
  run: (baseUrl: string, service: FakeGeoIntegrationService) => Promise<void>,
): Promise<void> {
  const service = new FakeGeoIntegrationService();
  const server = createWentianApiServer({
    geoIntegrationApi: { service, secureCookie: false },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`, service);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
