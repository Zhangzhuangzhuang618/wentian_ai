import type { IncomingMessage, ServerResponse } from "node:http";

import {
  consumerAutomationSettingsSchema,
  approveGeoProjectBindingInputSchema,
  createGeoConnectorInputSchema,
  createGeoConnectorResponseSchema,
  createStandaloneScopeInputSchema,
  localLoginInputSchema,
  localSessionResponseSchema,
  requestScopeDeletionInputSchema,
  rejectGeoProjectBindingInputSchema,
  retryScopeDeletionInputSchema,
  rotateGeoConnectorSecretInputSchema,
  rotateGeoConnectorSecretResponseSchema,
  scopeDeletionJobSchema,
  geoProjectBindingSchema,
  geoProjectBindingStatusSchema,
  geoConnectorListResponseSchema,
  standaloneScopeListResponseSchema,
  standaloneScopeSchema,
  updateStandaloneScopeMetadataInputSchema,
  updateConsumerAutomationSettingsInputSchema,
} from "@wentian/contracts";
import type {
  AuthenticatedLocalUser,
  ConsumerAutomationSettingsRecord,
  LocalSessionResult,
  ScopeDeletionJobRecord,
  GeoConnectorRecord,
  GeoProjectBindingRecord,
  StandaloneScopeRecord,
} from "@wentian/infrastructure";

const SESSION_COOKIE = "wentian_session";
const JSON_BODY_LIMIT = 64 * 1_024;

export interface LocalAccessApiService {
  login(email: string, password: string): Promise<LocalSessionResult>;
  authenticate(sessionToken: string): Promise<LocalSessionResult>;
  verifyCsrfToken(sessionToken: string, csrfToken: string): boolean;
  logout(sessionToken: string): Promise<void>;
  listScopes(userId: string): Promise<readonly StandaloneScopeRecord[]>;
  createScope(input: {
    readonly user: AuthenticatedLocalUser;
    readonly projectKey: string;
    readonly displayName: string;
    readonly industry: string;
    readonly region: string;
  }): Promise<StandaloneScopeRecord>;
  updateScopeMetadata(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly industry: string | null;
    readonly region: string | null;
    readonly expectedVersion: number;
  }): Promise<StandaloneScopeRecord>;
  getConsumerAutomationSettings(
    user: AuthenticatedLocalUser,
    scopeId: string,
  ): Promise<ConsumerAutomationSettingsRecord>;
  updateConsumerAutomationSettings(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly automationEnabled: boolean;
    readonly expectedVersion: number;
  }): Promise<ConsumerAutomationSettingsRecord>;
}

export interface LocalAccessApiOptions {
  readonly service: LocalAccessApiService;
  readonly scopeDeletion?: ScopeDeletionApiService;
  readonly geoConnectorAdmin?: GeoConnectorAdminApiService;
  readonly publicOrigin: string;
  readonly secureCookie?: boolean;
}

export interface GeoConnectorAdminApiService {
  listConnectors(
    user: AuthenticatedLocalUser,
  ): Promise<readonly GeoConnectorRecord[]>;
  createConnector(input: {
    readonly user: AuthenticatedLocalUser;
    readonly geoInstanceRef: string;
    readonly geoTenantRef: string;
    readonly displayName: string;
    readonly allowedGeoOrigins: readonly string[];
    readonly callbackBaseUrl?: string | null;
  }): Promise<{
    readonly connector: GeoConnectorRecord;
    readonly clientSecret: string;
  }>;
  rotateConnectorSecret(input: {
    readonly user: AuthenticatedLocalUser;
    readonly connectorId: string;
    readonly expectedVersion: number;
  }): Promise<{ readonly clientSecret: string; readonly version: number }>;
  listBindings(
    user: AuthenticatedLocalUser,
    status?: GeoProjectBindingRecord["status"],
  ): Promise<readonly GeoProjectBindingRecord[]>;
  approveBinding(input: {
    readonly user: AuthenticatedLocalUser;
    readonly bindingId: string;
    readonly scopeId: string;
    readonly expectedVersion: number;
  }): Promise<GeoProjectBindingRecord>;
  rejectBinding(input: {
    readonly user: AuthenticatedLocalUser;
    readonly bindingId: string;
    readonly reason: string;
    readonly expectedVersion: number;
  }): Promise<GeoProjectBindingRecord>;
}

export interface ScopeDeletionApiService {
  requestDeletion(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly projectKey: string;
    readonly password: string;
    readonly expectedVersion: number;
  }): Promise<ScopeDeletionJobRecord>;
  retryDeletion(input: {
    readonly user: AuthenticatedLocalUser;
    readonly jobId: string;
    readonly password: string;
  }): Promise<ScopeDeletionJobRecord>;
  getDeletionByScope(
    user: AuthenticatedLocalUser,
    scopeId: string,
  ): Promise<ScopeDeletionJobRecord>;
}

export function createLocalAccessApiHandler(options: LocalAccessApiOptions) {
  const expectedOrigin = normalizeOrigin(options.publicOrigin);
  const secureCookie =
    options.secureCookie ?? expectedOrigin.startsWith("https:");

  return async function handleLocalAccessApi(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<boolean> {
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/v1/")) {
      return false;
    }

    try {
      if (request.method === "POST" && path === "/api/v1/auth/login") {
        assertOrigin(request, expectedOrigin, false);
        const input = localLoginInputSchema.parse(await readJson(request));
        const session = await options.service.login(
          input.email,
          input.password,
        );
        response.setHeader(
          "set-cookie",
          serializeSessionCookie(
            session.sessionToken,
            session.expiresAt,
            secureCookie,
          ),
        );
        writeJson(response, 200, toSessionResponse(session));
        return true;
      }

      if (request.method === "GET" && path === "/api/v1/auth/session") {
        const session = await requireSession(request, options.service);
        writeJson(response, 200, toSessionResponse(session));
        return true;
      }

      if (request.method === "POST" && path === "/api/v1/auth/logout") {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        await options.service.logout(session.sessionToken);
        response.setHeader("set-cookie", clearSessionCookie(secureCookie));
        writeJson(response, 200, { status: "logged_out" });
        return true;
      }

      if (request.method === "GET" && path === "/api/v1/scopes") {
        const session = await requireSession(request, options.service);
        const scopes = await options.service.listScopes(session.user.id);
        writeJson(
          response,
          200,
          standaloneScopeListResponseSchema.parse({
            scopes: scopes.map(toScopeResponse),
          }),
        );
        return true;
      }

      if (request.method === "POST" && path === "/api/v1/scopes") {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = createStandaloneScopeInputSchema.parse(
          await readJson(request),
        );
        const scope = await options.service.createScope({
          user: session.user,
          projectKey: input.project_key,
          displayName: input.display_name,
          industry: input.industry,
          region: input.region,
        });
        writeJson(
          response,
          201,
          standaloneScopeSchema.parse(toScopeResponse(scope)),
        );
        return true;
      }

      const scopeMetadataMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/metadata$/,
      );
      if (scopeMetadataMatch && request.method === "PATCH") {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = updateStandaloneScopeMetadataInputSchema.parse(
          await readJson(request),
        );
        const scope = await options.service.updateScopeMetadata({
          user: session.user,
          scopeId: scopeMetadataMatch[1]!,
          industry: input.industry,
          region: input.region,
          expectedVersion: input.version,
        });
        writeJson(
          response,
          200,
          standaloneScopeSchema.parse(toScopeResponse(scope)),
        );
        return true;
      }

      if (
        request.method === "GET" &&
        path === "/api/v1/integrations/geo/connectors" &&
        options.geoConnectorAdmin
      ) {
        const session = await requireSession(request, options.service);
        const connectors = await options.geoConnectorAdmin.listConnectors(
          session.user,
        );
        writeJson(
          response,
          200,
          geoConnectorListResponseSchema.parse({
            connectors: connectors.map(toGeoConnectorResponse),
          }),
        );
        return true;
      }

      if (
        request.method === "POST" &&
        path === "/api/v1/integrations/geo/connectors" &&
        options.geoConnectorAdmin
      ) {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = createGeoConnectorInputSchema.parse(
          await readJson(request),
        );
        const created = await options.geoConnectorAdmin.createConnector({
          user: session.user,
          geoInstanceRef: input.geo_instance_ref,
          geoTenantRef: input.geo_tenant_ref,
          displayName: input.display_name,
          allowedGeoOrigins: input.allowed_geo_origins,
          callbackBaseUrl: input.callback_base_url,
        });
        writeJson(
          response,
          201,
          createGeoConnectorResponseSchema.parse({
            connector: toGeoConnectorResponse(created.connector),
            client_secret: created.clientSecret,
          }),
        );
        return true;
      }

      const connectorRotateMatch = path.match(
        /^\/api\/v1\/integrations\/geo\/connectors\/([0-9a-f-]{36})\/rotate-secret$/,
      );
      if (
        request.method === "POST" &&
        connectorRotateMatch &&
        options.geoConnectorAdmin
      ) {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = rotateGeoConnectorSecretInputSchema.parse(
          await readJson(request),
        );
        const rotated = await options.geoConnectorAdmin.rotateConnectorSecret({
          user: session.user,
          connectorId: connectorRotateMatch[1]!,
          expectedVersion: input.version,
        });
        writeJson(
          response,
          200,
          rotateGeoConnectorSecretResponseSchema.parse({
            client_secret: rotated.clientSecret,
            version: rotated.version,
          }),
        );
        return true;
      }

      if (
        request.method === "GET" &&
        path === "/api/v1/integrations/geo/project-binding-requests" &&
        options.geoConnectorAdmin
      ) {
        const session = await requireSession(request, options.service);
        const rawStatus = requestUrl.searchParams.get("status");
        const status = rawStatus
          ? geoProjectBindingStatusSchema.parse(rawStatus)
          : undefined;
        const bindings = await options.geoConnectorAdmin.listBindings(
          session.user,
          status as GeoProjectBindingRecord["status"] | undefined,
        );
        writeJson(response, 200, {
          bindings: bindings.map(toGeoBindingResponse),
        });
        return true;
      }

      const bindingAdminMatch = path.match(
        /^\/api\/v1\/integrations\/geo\/project-binding-requests\/([0-9a-f-]{36})\/(approve|reject)$/,
      );
      if (
        bindingAdminMatch &&
        request.method === "POST" &&
        options.geoConnectorAdmin
      ) {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const binding =
          bindingAdminMatch[2] === "approve"
            ? await (async () => {
                const input = approveGeoProjectBindingInputSchema.parse(
                  await readJson(request),
                );
                return options.geoConnectorAdmin!.approveBinding({
                  user: session.user,
                  bindingId: bindingAdminMatch[1]!,
                  scopeId: input.scope_id,
                  expectedVersion: input.version,
                });
              })()
            : await (async () => {
                const input = rejectGeoProjectBindingInputSchema.parse(
                  await readJson(request),
                );
                return options.geoConnectorAdmin!.rejectBinding({
                  user: session.user,
                  bindingId: bindingAdminMatch[1]!,
                  reason: input.reason,
                  expectedVersion: input.version,
                });
              })();
        writeJson(response, 200, toGeoBindingResponse(binding));
        return true;
      }

      const scopeDeletionMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/deletion$/,
      );
      if (
        scopeDeletionMatch &&
        request.method === "GET" &&
        options.scopeDeletion
      ) {
        const session = await requireSession(request, options.service);
        const job = await options.scopeDeletion.getDeletionByScope(
          session.user,
          scopeDeletionMatch[1]!,
        );
        writeJson(response, 200, toScopeDeletionResponse(job));
        return true;
      }

      if (
        scopeDeletionMatch &&
        request.method === "POST" &&
        options.scopeDeletion
      ) {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = requestScopeDeletionInputSchema.parse(
          await readJson(request),
        );
        const job = await options.scopeDeletion.requestDeletion({
          user: session.user,
          scopeId: scopeDeletionMatch[1]!,
          projectKey: input.project_key,
          password: input.password,
          expectedVersion: input.version,
        });
        writeJson(
          response,
          job.status === "succeeded" ? 200 : 202,
          toScopeDeletionResponse(job),
        );
        return true;
      }

      const scopeDeletionRetryMatch = path.match(
        /^\/api\/v1\/scope-deletions\/([0-9a-f-]{36})\/retry$/,
      );
      if (
        scopeDeletionRetryMatch &&
        request.method === "POST" &&
        options.scopeDeletion
      ) {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = retryScopeDeletionInputSchema.parse(
          await readJson(request),
        );
        const job = await options.scopeDeletion.retryDeletion({
          user: session.user,
          jobId: scopeDeletionRetryMatch[1]!,
          password: input.password,
        });
        writeJson(
          response,
          job.status === "succeeded" ? 200 : 202,
          toScopeDeletionResponse(job),
        );
        return true;
      }

      const settingsMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/consumer-settings$/,
      );
      if (settingsMatch && request.method === "GET") {
        const session = await requireSession(request, options.service);
        const settings = await options.service.getConsumerAutomationSettings(
          session.user,
          settingsMatch[1]!,
        );
        writeJson(
          response,
          200,
          consumerAutomationSettingsSchema.parse(
            toConsumerSettingsResponse(settings),
          ),
        );
        return true;
      }

      if (settingsMatch && request.method === "PATCH") {
        assertOrigin(request, expectedOrigin, true);
        const session = await requireSession(request, options.service);
        requireCsrf(request, session, options.service);
        const input = updateConsumerAutomationSettingsInputSchema.parse(
          await readJson(request),
        );
        const settings = await options.service.updateConsumerAutomationSettings(
          {
            user: session.user,
            scopeId: settingsMatch[1]!,
            automationEnabled: input.automation_enabled,
            expectedVersion: input.version,
          },
        );
        writeJson(
          response,
          200,
          consumerAutomationSettingsSchema.parse(
            toConsumerSettingsResponse(settings),
          ),
        );
        return true;
      }

      return false;
    } catch (error) {
      writeApiError(response, error);
      return true;
    }
  };
}

async function requireSession(
  request: IncomingMessage,
  service: LocalAccessApiService,
): Promise<LocalSessionResult> {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!token) {
    throw new Error("LOCAL_SESSION_INVALID");
  }
  return service.authenticate(token);
}

function requireCsrf(
  request: IncomingMessage,
  session: LocalSessionResult,
  service: LocalAccessApiService,
): void {
  const token = request.headers["x-wentian-csrf-token"];
  if (
    typeof token !== "string" ||
    !service.verifyCsrfToken(session.sessionToken, token)
  ) {
    throw new Error("CSRF_TOKEN_INVALID");
  }
}

function assertOrigin(
  request: IncomingMessage,
  expectedOrigin: string,
  required: boolean,
): void {
  const actual = request.headers.origin;
  if (
    (required && !actual) ||
    (actual && normalizeOrigin(actual) !== expectedOrigin)
  ) {
    throw new Error("REQUEST_ORIGIN_INVALID");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new Error("JSON_CONTENT_TYPE_REQUIRED");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > JSON_BODY_LIMIT) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

function toSessionResponse(session: LocalSessionResult) {
  return localSessionResponseSchema.parse({
    user: {
      id: session.user.id,
      email: session.user.email,
      display_name: session.user.displayName,
      instance_role: session.user.instanceRole,
      authorization_role:
        session.user.authorizationRole ?? session.user.instanceRole ?? "viewer",
      auth_source: session.user.authSource ?? "local",
    },
    csrf_token: session.csrfToken,
    expires_at: session.expiresAt,
  });
}

function toScopeResponse(scope: StandaloneScopeRecord) {
  return {
    id: scope.id,
    project_key: scope.projectKey,
    display_name: scope.displayName,
    industry: scope.industry,
    region: scope.region,
    status: scope.status,
    retention_policy_code: scope.retentionPolicyCode,
    role: scope.role,
    version: scope.version,
    created_at: scope.createdAt,
    updated_at: scope.updatedAt,
  };
}

function toConsumerSettingsResponse(
  settings: ConsumerAutomationSettingsRecord,
) {
  return {
    scope_id: settings.scopeId,
    automation_enabled: settings.automationEnabled,
    allowed_usage_region: settings.allowedUsageRegion,
    governance_policy_version: settings.governancePolicyVersion,
    version: settings.version,
    updated_at: settings.updatedAt,
  };
}

function toScopeDeletionResponse(job: ScopeDeletionJobRecord) {
  return scopeDeletionJobSchema.parse({
    id: job.id,
    scope_id: job.scopeId,
    project_key: job.projectKey,
    status: job.status,
    attempt_count: job.attemptCount,
    requested_at: job.requestedAt,
    completed_at: job.completedAt,
    last_error_code: job.lastErrorCode,
  });
}

function toGeoConnectorResponse(connector: GeoConnectorRecord) {
  return {
    id: connector.id,
    geo_instance_ref: connector.geoInstanceRef,
    geo_tenant_ref: connector.geoTenantRef,
    display_name: connector.displayName,
    allowed_geo_origins: connector.allowedGeoOrigins,
    callback_base_url: connector.callbackBaseUrl,
    status: connector.status,
    contract_version: connector.contractVersion,
    version: connector.version,
    created_at: connector.createdAt,
    updated_at: connector.updatedAt,
  };
}

function toGeoBindingResponse(binding: GeoProjectBindingRecord) {
  return geoProjectBindingSchema.parse({
    id: binding.id,
    connector_instance_id: binding.connectorInstanceId,
    geo_workspace_ref: binding.geoWorkspaceRef,
    geo_project_ref: binding.geoProjectRef,
    geo_project_display_name: binding.geoProjectDisplayName,
    scope_id: binding.scopeId,
    status: binding.status,
    version: binding.version,
    requested_at: binding.requestedAt,
    updated_at: binding.updatedAt,
    decision_reason: binding.decisionReason,
  });
}

function serializeSessionCookie(
  token: string,
  expiresAt: string,
  secure: boolean,
): string {
  const maxAge = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000),
  );
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) {
        return [];
      }
      return [
        [part.slice(0, separator).trim(), part.slice(separator + 1).trim()],
      ];
    }),
  );
}

function normalizeOrigin(value: string): string {
  const origin = new URL(value).origin;
  if (origin !== value.replace(/\/$/, "")) {
    throw new Error("INVALID_PUBLIC_ORIGIN");
  }
  return origin;
}

function writeApiError(response: ServerResponse, error: unknown): void {
  const code =
    error instanceof Error && error.name === "ZodError"
      ? "INVALID_REQUEST"
      : error instanceof Error
        ? error.message
        : "INTERNAL_ERROR";
  const status =
    code === "LOCAL_SESSION_INVALID" ||
    code === "LOCAL_LOGIN_INVALID" ||
    code === "LOCAL_REAUTH_INVALID"
      ? 401
      : code === "ACTION_FORBIDDEN" ||
          code === "CSRF_TOKEN_INVALID" ||
          code === "REQUEST_ORIGIN_INVALID"
        ? 403
        : code === "RESOURCE_NOT_FOUND"
          ? 404
          : code === "SETTINGS_VERSION_CONFLICT" ||
              code === "SCOPE_VERSION_CONFLICT" ||
              code === "SCOPE_DELETION_IN_PROGRESS" ||
              code.endsWith("_CONFLICT")
            ? 409
            : code === "REQUEST_BODY_TOO_LARGE"
              ? 413
              : code.startsWith("INVALID_") ||
                  code === "JSON_CONTENT_TYPE_REQUIRED"
                ? 400
                : 500;
  writeJson(response, status, {
    error: status === 500 ? "INTERNAL_ERROR" : code,
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}
