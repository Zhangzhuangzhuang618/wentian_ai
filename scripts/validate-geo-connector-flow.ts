import { randomBytes, randomUUID } from "node:crypto";

import {
  createGeoConnectorSignature,
  type GeoConnectorSignatureInput,
} from "../packages/infrastructure/src/index.ts";

const CONTRACT_VERSION = "wentian-geo-connector@1" as const;
const baseUrl = requiredEnvironment("WENTIAN_VALIDATION_BASE_URL").replace(
  /\/$/,
  "",
);
const email = requiredEnvironment("WENTIAN_VALIDATION_OWNER_EMAIL");
const password = requiredEnvironment("WENTIAN_VALIDATION_OWNER_PASSWORD");
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const projectKey = `geo-validation-${suffix}`;

const login = await localJsonRequest("/api/v1/auth/login", {
  method: "POST",
  body: { email, password },
});
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
const loginBody = login.body as { readonly csrf_token: string };
if (!cookie || !loginBody.csrf_token) {
  throw new Error("VALIDATION_LOGIN_SESSION_MISSING");
}

const localHeaders = {
  cookie,
  origin: baseUrl,
  "x-wentian-csrf-token": loginBody.csrf_token,
} as const;

const scope = (
  await localJsonRequest("/api/v1/scopes", {
    method: "POST",
    headers: localHeaders,
    body: {
      project_key: projectKey,
      display_name: "GEO连接器闭环演练",
    },
  })
).body as {
  readonly id: string;
  readonly version: number;
};

const geoTenantRef = randomUUID();
const geoWorkspaceRef = randomUUID();
const geoProjectRef = randomUUID();
const connectorCreated = (
  await localJsonRequest("/api/v1/integrations/geo/connectors", {
    method: "POST",
    headers: localHeaders,
    body: {
      geo_instance_ref: `geo-validation-${suffix}`,
      geo_tenant_ref: geoTenantRef,
      display_name: "GEO验证连接器",
      allowed_geo_origins: ["https://geo.validation.local"],
      callback_base_url: null,
    },
  })
).body as {
  readonly connector: { readonly id: string };
  readonly client_secret: string;
};

const signedClient = createSignedClient({
  connectorId: connectorCreated.connector.id,
  clientSecret: connectorCreated.client_secret,
});

const pendingBinding = (
  await signedClient.request(
    "POST",
    "/api/v1/integrations/geo/project-binding-requests",
    {
      geo_workspace_ref: geoWorkspaceRef,
      geo_project_ref: geoProjectRef,
      geo_project_display_name: "GEO演练项目",
    },
  )
).body as BindingResponse;
assert(
  pendingBinding.status === "pending_wentian" &&
    pendingBinding.scope_id === null,
  "VALIDATION_BINDING_NOT_PENDING",
);

const approvedBinding = (
  await localJsonRequest(
    `/api/v1/integrations/geo/project-binding-requests/${pendingBinding.id}/approve`,
    {
      method: "POST",
      headers: localHeaders,
      body: { scope_id: scope.id, version: pendingBinding.version },
    },
  )
).body as BindingResponse;
assert(
  approvedBinding.status === "active" && approvedBinding.scope_id === scope.id,
  "VALIDATION_BINDING_NOT_ACTIVE",
);

const refreshedBinding = (
  await signedClient.request(
    "POST",
    "/api/v1/integrations/geo/project-binding-status",
    { geo_project_ref: geoProjectRef },
  )
).body as BindingResponse;
assert(
  refreshedBinding.id === approvedBinding.id &&
    refreshedBinding.status === "active" &&
    refreshedBinding.version === approvedBinding.version,
  "VALIDATION_BINDING_REFRESH_MISMATCH",
);

const syncPath = `/api/v1/integrations/geo/project-bindings/${approvedBinding.id}/query-set-snapshots`;
const syncBody = {
  geo_query_set_ref: randomUUID(),
  geo_revision: "validation-revision-1",
  title: "GEO同步问题集演练",
  locale: "zh-CN",
  market: "CN_MAINLAND",
  queries: [
    {
      external_key: "q001",
      text: "广州搬家公司哪家好？",
      intent: "recommendation",
      commercial_value: "high",
    },
    {
      external_key: "q002",
      text: "请推荐几家广州搬家公司。",
      intent: "recommendation",
      commercial_value: "high",
    },
  ],
} as const;
const syncIdempotencyKey = `query-sync-${suffix}`;
const firstSync = (
  await signedClient.request("PUT", syncPath, syncBody, {
    idempotencyKey: syncIdempotencyKey,
  })
).body as QuerySyncResponse;
const replayedSync = (
  await signedClient.request("PUT", syncPath, syncBody, {
    idempotencyKey: syncIdempotencyKey,
  })
).body as QuerySyncResponse;
assert(
  firstSync.created === true &&
    replayedSync.created === false &&
    firstSync.snapshot_id === replayedSync.snapshot_id &&
    firstSync.snapshot_hash === replayedSync.snapshot_hash &&
    firstSync.query_count === 2,
  "VALIDATION_QUERY_SYNC_IDEMPOTENCY_FAILED",
);

const ticket = (
  await signedClient.request("POST", "/api/v1/integrations/geo/sso-tickets", {
    geo_user_ref: randomUUID(),
    geo_project_ref: geoProjectRef,
    display_name: "GEO验证用户",
    role_codes: ["analyst"],
    requested_path: "/",
  })
).body as { readonly launch_url: string };
const firstLaunch = await fetch(ticket.launch_url, { redirect: "manual" });
assert(firstLaunch.status === 303, "VALIDATION_SSO_LAUNCH_FAILED");
assert(
  firstLaunch.headers.get("referrer-policy") === "no-referrer" &&
    firstLaunch.headers.get("set-cookie")?.includes("wentian_session="),
  "VALIDATION_SSO_RESPONSE_HARDENING_MISSING",
);
const replayedLaunch = await fetch(ticket.launch_url, { redirect: "manual" });
assert(replayedLaunch.status === 400, "VALIDATION_SSO_REPLAY_NOT_REJECTED");

const disconnectedBinding = (
  await signedClient.request(
    "POST",
    `/api/v1/integrations/geo/project-bindings/${approvedBinding.id}/disconnect`,
    {},
  )
).body as BindingResponse;
assert(
  disconnectedBinding.status === "disconnected" &&
    disconnectedBinding.version > approvedBinding.version,
  "VALIDATION_BINDING_NOT_DISCONNECTED",
);

const deniedTicket = await signedClient.request(
  "POST",
  "/api/v1/integrations/geo/sso-tickets",
  {
    geo_user_ref: randomUUID(),
    geo_project_ref: geoProjectRef,
    display_name: "GEO解绑后验证用户",
    role_codes: ["viewer"],
  },
  { expectedStatus: 404 },
);
assert(
  (deniedTicket.body as { readonly error?: string }).error ===
    "GEO_BINDING_NOT_FOUND",
  "VALIDATION_DISCONNECTED_BINDING_STILL_USABLE",
);

const deletion = (
  await localJsonRequest(`/api/v1/scopes/${scope.id}/deletion`, {
    method: "POST",
    headers: localHeaders,
    body: {
      project_key: projectKey,
      password,
      version: scope.version,
    },
  })
).body as { readonly status: string };
assert(deletion.status === "succeeded", "VALIDATION_SCOPE_DELETION_FAILED");

const scopes = (
  await localJsonRequest("/api/v1/scopes", {
    headers: { cookie },
  })
).body as { readonly scopes: readonly { readonly id: string }[] };
assert(
  !scopes.scopes.some((item) => item.id === scope.id),
  "VALIDATION_SCOPE_RESIDUE_FOUND",
);

process.stdout.write(
  `${JSON.stringify(
    {
      connector_id: connectorCreated.connector.id,
      binding_status: disconnectedBinding.status,
      binding_version: disconnectedBinding.version,
      query_snapshot_id: firstSync.snapshot_id,
      query_count: firstSync.query_count,
      query_sync_replay_created: replayedSync.created,
      sso_replay_rejected: true,
      disconnected_access_rejected: true,
      scope_deleted_without_residue: true,
    },
    null,
    2,
  )}\n`,
);

interface BindingResponse {
  readonly id: string;
  readonly scope_id: string | null;
  readonly status: string;
  readonly version: number;
}

interface QuerySyncResponse {
  readonly snapshot_id: string;
  readonly snapshot_hash: string;
  readonly query_count: number;
  readonly created: boolean;
}

interface JsonResponse {
  readonly body: unknown;
  readonly headers: Headers;
  readonly status: number;
}

function createSignedClient(input: {
  readonly connectorId: string;
  readonly clientSecret: string;
}) {
  return {
    async request(
      method: "POST" | "PUT" | "DELETE",
      path: string,
      body: unknown,
      options: {
        readonly idempotencyKey?: string;
        readonly expectedStatus?: number;
      } = {},
    ): Promise<JsonResponse> {
      const rawBody = method === "DELETE" ? "" : JSON.stringify(body);
      const issuedAt = new Date().toISOString();
      const nonce = randomBytes(24).toString("base64url");
      const requestId = randomUUID();
      const idempotencyKey =
        options.idempotencyKey ?? `geo-validation-${randomUUID()}`;
      const signatureInput: GeoConnectorSignatureInput = {
        secret: input.clientSecret,
        method,
        path,
        rawBody,
        issuedAt,
        nonce,
        requestId,
        idempotencyKey,
        contractVersion: CONTRACT_VERSION,
      };
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "x-wentian-connector-id": input.connectorId,
          "x-wentian-contract-version": CONTRACT_VERSION,
          "x-wentian-issued-at": issuedAt,
          "x-wentian-nonce": nonce,
          "x-wentian-request-id": requestId,
          "x-wentian-signature": createGeoConnectorSignature(signatureInput),
          "idempotency-key": idempotencyKey,
          ...(method === "DELETE"
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(method === "DELETE" ? {} : { body: rawBody }),
      });
      return parseResponse(response, options.expectedStatus);
    },
  };
}

async function localJsonRequest(
  path: string,
  options: {
    readonly method?: "GET" | "POST";
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: unknown;
  },
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...options.headers,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  return parseResponse(response);
}

async function parseResponse(
  response: Response,
  expectedStatus?: number,
): Promise<JsonResponse> {
  const body = (await response.json()) as unknown;
  const expected = expectedStatus ?? (response.status === 201 ? 201 : 200);
  if (response.status !== expected) {
    throw new Error(
      `VALIDATION_HTTP_${response.status}:${JSON.stringify(body)}`,
    );
  }
  return { body, headers: response.headers, status: response.status };
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ENVIRONMENT_REQUIRED:${name}`);
  return value;
}
