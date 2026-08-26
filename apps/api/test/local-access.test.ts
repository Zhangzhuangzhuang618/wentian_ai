import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  AuthenticatedLocalUser,
  ConsumerAutomationSettingsRecord,
  GeoConnectorRecord,
  GeoProjectBindingRecord,
  LocalSessionResult,
  ScopeDeletionJobRecord,
  StandaloneScopeRecord,
} from "@wentian/infrastructure";

import type {
  LocalAccessApiService,
  GeoConnectorAdminApiService,
  ScopeDeletionApiService,
} from "../src/local-access-api.ts";
import { createWentianApiServer } from "../src/server.ts";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  connector: "31111111-1111-4111-8111-111111111111",
  binding: "41111111-1111-4111-8111-111111111111",
} as const;
const sessionToken = "a".repeat(43);
const csrfToken = "b".repeat(43);

test("本地Owner登录后可创建项目且自动化默认关闭", async () => {
  await withLocalAccessServer(async (baseUrl, service) => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
      },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "a-long-owner-password",
      }),
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { csrf_token: string };
    assert.equal(loginBody.csrf_token, csrfToken);
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(login.headers.get("set-cookie")!, /SameSite=Strict/);

    const created = await fetch(`${baseUrl}/api/v1/scopes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: baseUrl,
        "x-wentian-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        project_key: "guangzhou-moving",
        display_name: "广州搬家",
        industry: "搬家",
        region: "广州",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).project_key, "guangzhou-moving");

    const metadata = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/metadata`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: baseUrl,
          "x-wentian-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          industry: "搬家服务",
          region: "广州",
          version: 1,
        }),
      },
    );
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).industry, "搬家服务");

    const settings = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/consumer-settings`,
      { headers: { cookie } },
    );
    assert.equal(settings.status, 200);
    assert.equal((await settings.json()).automation_enabled, false);

    const updated = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/consumer-settings`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: baseUrl,
          "x-wentian-csrf-token": csrfToken,
        },
        body: JSON.stringify({ automation_enabled: true, version: 1 }),
      },
    );
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).automation_enabled, true);
    assert.equal(service.settings.version, 2);
  });
});

test("项目写操作缺少同源或CSRF时失败关闭", async () => {
  await withLocalAccessServer(async (baseUrl) => {
    const cookie = `wentian_session=${sessionToken}`;
    const missingOrigin = await fetch(`${baseUrl}/api/v1/scopes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-wentian-csrf-token": csrfToken,
      },
      body: JSON.stringify({ project_key: "test", display_name: "测试" }),
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).error, "REQUEST_ORIGIN_INVALID");

    const missingCsrf = await fetch(`${baseUrl}/api/v1/scopes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: baseUrl,
      },
      body: JSON.stringify({ project_key: "test", display_name: "测试" }),
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).error, "CSRF_TOKEN_INVALID");
  });
});

test("无会话不能读取项目且非法请求返回400", async () => {
  await withLocalAccessServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/v1/scopes`);
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ email: "not-an-email", password: "short" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "INVALID_REQUEST");
  });
});

test("Owner二次确认后删除项目并返回跨存储作业", async () => {
  await withLocalAccessServer(async (baseUrl, service) => {
    service.allowScope();
    const cookie = `wentian_session=${sessionToken}`;
    const response = await fetch(
      `${baseUrl}/api/v1/scopes/${ids.scope}/deletion`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: baseUrl,
          "x-wentian-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          project_key: "guangzhou-moving",
          password: "a-long-owner-password",
          version: 1,
        }),
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "succeeded");
    assert.equal(service.deletedProjectKey, "guangzhou-moving");
  });
});

test("问天管理员可建立连接器并审批待确认项目", async () => {
  await withLocalAccessServer(async (baseUrl, service) => {
    service.allowScope();
    const headers = {
      "content-type": "application/json",
      cookie: `wentian_session=${sessionToken}`,
      origin: baseUrl,
      "x-wentian-csrf-token": csrfToken,
    };
    const created = await fetch(
      `${baseUrl}/api/v1/integrations/geo/connectors`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          geo_instance_ref: "geo-instance-1",
          geo_tenant_ref: "tenant-1",
          display_name: "GEO Content OS",
          allowed_geo_origins: ["https://geo.example.com"],
          callback_base_url: null,
        }),
      },
    );
    assert.equal(created.status, 201);
    assert.equal((await created.json()).client_secret, "s".repeat(43));

    const listed = await fetch(
      `${baseUrl}/api/v1/integrations/geo/connectors`,
      { headers: { cookie: `wentian_session=${sessionToken}` } },
    );
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).connectors.length, 1);

    const approved = await fetch(
      `${baseUrl}/api/v1/integrations/geo/project-binding-requests/${ids.binding}/approve`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ scope_id: ids.scope, version: 1 }),
      },
    );
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).status, "active");

    const invalidStatus = await fetch(
      `${baseUrl}/api/v1/integrations/geo/project-binding-requests?status=unknown`,
      { headers: { cookie: `wentian_session=${sessionToken}` } },
    );
    assert.equal(invalidStatus.status, 400);
  });
});

class FakeLocalAccessService
  implements
    LocalAccessApiService,
    ScopeDeletionApiService,
    GeoConnectorAdminApiService
{
  private allowedScopeIds: readonly string[] = [];
  private scopeIndustry = "搬家";
  private scopeRegion = "广州";
  private scopeVersion = 1;
  deletedProjectKey: string | null = null;
  settings: ConsumerAutomationSettingsRecord = {
    scopeId: ids.scope,
    automationEnabled: false,
    allowedUsageRegion: "CN_MAINLAND",
    governancePolicyVersion: "consumer-observation-governance@1",
    version: 1,
    updatedAt: "2030-01-01T00:00:00.000Z",
  };

  async login(email: string, password: string): Promise<LocalSessionResult> {
    if (email !== "owner@example.com" || password !== "a-long-owner-password") {
      throw new Error("LOCAL_LOGIN_INVALID");
    }
    return this.session();
  }

  async authenticate(token: string): Promise<LocalSessionResult> {
    if (token !== sessionToken) {
      throw new Error("LOCAL_SESSION_INVALID");
    }
    return this.session();
  }

  verifyCsrfToken(token: string, csrf: string): boolean {
    return token === sessionToken && csrf === csrfToken;
  }

  async logout(): Promise<void> {}

  async listScopes(): Promise<readonly StandaloneScopeRecord[]> {
    return this.allowedScopeIds.length === 0 ? [] : [this.scope()];
  }

  async createScope(): Promise<StandaloneScopeRecord> {
    this.allowedScopeIds = [ids.scope];
    return this.scope();
  }

  async updateScopeMetadata(input: {
    readonly industry: string | null;
    readonly region: string | null;
    readonly expectedVersion: number;
  }): Promise<StandaloneScopeRecord> {
    if (input.expectedVersion !== this.scopeVersion) {
      throw new Error("SCOPE_VERSION_CONFLICT");
    }
    this.scopeIndustry = input.industry ?? "";
    this.scopeRegion = input.region ?? "";
    this.scopeVersion += 1;
    return this.scope();
  }

  allowScope(): void {
    this.allowedScopeIds = [ids.scope];
  }

  async requestDeletion(input: {
    readonly projectKey: string;
  }): Promise<ScopeDeletionJobRecord> {
    this.deletedProjectKey = input.projectKey;
    this.allowedScopeIds = [];
    return this.deletionJob("succeeded");
  }

  async retryDeletion(): Promise<ScopeDeletionJobRecord> {
    return this.deletionJob("succeeded");
  }

  async getDeletionByScope(): Promise<ScopeDeletionJobRecord> {
    return this.deletionJob("failed");
  }

  async listConnectors(): Promise<readonly GeoConnectorRecord[]> {
    return [this.connector()];
  }

  async createConnector() {
    return { connector: this.connector(), clientSecret: "s".repeat(43) };
  }

  async rotateConnectorSecret() {
    return { clientSecret: "r".repeat(43), version: 2 };
  }

  async listBindings(): Promise<readonly GeoProjectBindingRecord[]> {
    return [this.binding("pending_wentian")];
  }

  async approveBinding(): Promise<GeoProjectBindingRecord> {
    return this.binding("active");
  }

  async rejectBinding(): Promise<GeoProjectBindingRecord> {
    return this.binding("rejected");
  }

  async getConsumerAutomationSettings(
    user: AuthenticatedLocalUser,
    scopeId: string,
  ): Promise<ConsumerAutomationSettingsRecord> {
    if (!user.allowedScopeIds.includes(scopeId)) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    return this.settings;
  }

  async updateConsumerAutomationSettings(input: {
    readonly scopeId: string;
    readonly automationEnabled: boolean;
    readonly expectedVersion: number;
  }): Promise<ConsumerAutomationSettingsRecord> {
    if (input.expectedVersion !== this.settings.version) {
      throw new Error("SETTINGS_VERSION_CONFLICT");
    }
    this.settings = {
      ...this.settings,
      automationEnabled: input.automationEnabled,
      version: this.settings.version + 1,
    };
    return this.settings;
  }

  private session(): LocalSessionResult {
    return {
      sessionToken,
      csrfToken,
      expiresAt: "2030-01-01T08:00:00.000Z",
      user: {
        id: ids.user,
        email: "owner@example.com",
        displayName: "Owner",
        instanceRole: "owner",
        allowedScopeIds: this.allowedScopeIds,
      },
    };
  }

  private scope(): StandaloneScopeRecord {
    return {
      id: ids.scope,
      projectKey: "guangzhou-moving",
      displayName: "广州搬家",
      industry: this.scopeIndustry || null,
      region: this.scopeRegion || null,
      status: "active",
      retentionPolicyCode: "consumer-observation-governance@1",
      role: "owner",
      version: this.scopeVersion,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
  }

  private deletionJob(status: "failed" | "succeeded"): ScopeDeletionJobRecord {
    return {
      id: "41111111-1111-4111-8111-111111111111",
      scopeId: ids.scope,
      projectKey: "guangzhou-moving",
      status,
      attemptCount: 1,
      requestedAt: "2030-01-01T00:00:00.000Z",
      completedAt: "2030-01-01T00:00:01.000Z",
      lastErrorCode: status === "failed" ? "SCOPE_OBJECT_DELETE_FAILED" : null,
    };
  }

  private connector(): GeoConnectorRecord {
    return {
      id: ids.connector,
      geoInstanceRef: "geo-instance-1",
      geoTenantRef: "tenant-1",
      displayName: "GEO Content OS",
      allowedGeoOrigins: ["https://geo.example.com"],
      callbackBaseUrl: null,
      status: "active",
      contractVersion: "wentian-geo-connector@1",
      version: 1,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    };
  }

  private binding(
    status: GeoProjectBindingRecord["status"],
  ): GeoProjectBindingRecord {
    return {
      id: ids.binding,
      connectorInstanceId: ids.connector,
      geoWorkspaceRef: "workspace-1",
      geoProjectRef: "project-1",
      geoProjectDisplayName: "广州搬家",
      scopeId: status === "active" ? ids.scope : null,
      status,
      version: status === "pending_wentian" ? 1 : 2,
      requestedAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
      decisionReason: status === "rejected" ? "项目无法确认" : null,
    };
  }
}

async function withLocalAccessServer(
  run: (baseUrl: string, service: FakeLocalAccessService) => Promise<void>,
): Promise<void> {
  const service = new FakeLocalAccessService();
  const server = createWentianApiServer({
    version: "0.0.0-test",
    localAccessApi: {
      service,
      scopeDeletion: service,
      geoConnectorAdmin: service,
      publicOrigin: "http://127.0.0.1",
      secureCookie: false,
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  // 测试服务器使用随机端口，处理器须使用同一实际Origin。
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  const actualServer = createWentianApiServer({
    version: "0.0.0-test",
    localAccessApi: {
      service,
      scopeDeletion: service,
      geoConnectorAdmin: service,
      publicOrigin: baseUrl,
      secureCookie: false,
    },
  });
  await new Promise<void>((resolve, reject) => {
    actualServer.once("error", reject);
    actualServer.listen(address.port, "127.0.0.1", resolve);
  });
  try {
    await run(baseUrl, service);
  } finally {
    await new Promise<void>((resolve, reject) => {
      actualServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
