import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createGeoProjectBindingRequestSchema,
  geoProjectBindingSchema,
  geoProjectBindingStatusRequestSchema,
  geoQuerySetSyncInputSchema,
  geoQuerySetSyncResponseSchema,
  geoSsoTicketRequestSchema,
  geoSsoTicketResponseSchema,
  WENTIAN_GEO_CONNECTOR_CONTRACT_VERSION,
} from "@wentian/contracts";
import type {
  AuthenticatedGeoConnector,
  GeoProjectBindingRecord,
  GeoSessionConsumption,
  GeoSignedRequestInput,
} from "@wentian/infrastructure";

const JSON_BODY_LIMIT = 128 * 1_024;

export interface GeoIntegrationApiService {
  authenticateSignedRequest(
    input: GeoSignedRequestInput,
  ): Promise<AuthenticatedGeoConnector>;
  requestBinding(input: {
    readonly auth: AuthenticatedGeoConnector;
    readonly geoWorkspaceRef: string;
    readonly geoProjectRef: string;
    readonly geoProjectDisplayName: string;
  }): Promise<GeoProjectBindingRecord>;
  withdrawBinding(
    auth: AuthenticatedGeoConnector,
    bindingId: string,
  ): Promise<GeoProjectBindingRecord>;
  findBindingByGeoProject(
    auth: AuthenticatedGeoConnector,
    geoProjectRef: string,
  ): Promise<GeoProjectBindingRecord>;
  disconnectBinding(
    auth: AuthenticatedGeoConnector,
    bindingId: string,
  ): Promise<GeoProjectBindingRecord>;
  issueSsoTicket(input: {
    readonly auth: AuthenticatedGeoConnector;
    readonly geoUserRef: string;
    readonly geoProjectRef: string;
    readonly displayName: string;
    readonly roleCodes: readonly string[];
    readonly requestedPath?: string;
  }): Promise<{ readonly launchUrl: string; readonly expiresAt: string }>;
  consumeSsoTicket(code: string): Promise<GeoSessionConsumption>;
  syncQuerySet(input: {
    readonly auth: AuthenticatedGeoConnector;
    readonly bindingId: string;
    readonly geoQuerySetRef: string;
    readonly geoRevision: string;
    readonly title: string;
    readonly locale: string;
    readonly market?: string | null;
    readonly queries: readonly {
      readonly externalKey: string;
      readonly text: string;
      readonly intent:
        | "brand_recognition"
        | "exploration"
        | "recommendation"
        | "comparison"
        | "education"
        | "procurement";
      readonly commercialValue?: "low" | "medium" | "high";
    }[];
  }): Promise<{
    readonly snapshotId: string;
    readonly snapshotHash: string;
    readonly queryCount: number;
    readonly created: boolean;
  }>;
}

export interface GeoIntegrationApiOptions {
  readonly service: GeoIntegrationApiService;
  readonly secureCookie?: boolean;
}

export function createGeoIntegrationApiHandler(
  options: GeoIntegrationApiOptions,
) {
  return async function handleGeoIntegrationApi(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<boolean> {
    if (request.method === "GET" && requestUrl.pathname === "/connect/geo") {
      try {
        const code = requestUrl.searchParams.get("code") ?? "";
        const session = await options.service.consumeSsoTicket(code);
        response.writeHead(303, {
          "cache-control": "no-store",
          location: session.redirectPath,
          "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'none'",
          "set-cookie": serializeSessionCookie(
            session.sessionToken,
            session.expiresAt,
            options.secureCookie ?? false,
          ),
        });
        response.end();
      } catch {
        writeJson(response, 400, { error: "GEO_SSO_TICKET_INVALID" }, true);
      }
      return true;
    }

    const path = requestUrl.pathname;
    if (!isSignedGeoIntegrationRoute(request.method, path)) return false;

    try {
      const rawBody = await readRawBody(
        request,
        request.method !== "GET" && request.method !== "DELETE",
      );
      const auth = await options.service.authenticateSignedRequest(
        signedRequestInput(request, path, rawBody),
      );

      if (
        request.method === "POST" &&
        path === "/api/v1/integrations/geo/project-binding-requests"
      ) {
        const input = createGeoProjectBindingRequestSchema.parse(
          parseJson(rawBody),
        );
        const binding = await options.service.requestBinding({
          auth,
          geoWorkspaceRef: input.geo_workspace_ref,
          geoProjectRef: input.geo_project_ref,
          geoProjectDisplayName: input.geo_project_display_name,
        });
        writeJson(response, 201, toBindingResponse(binding));
        return true;
      }

      const withdrawalMatch = path.match(
        /^\/api\/v1\/integrations\/geo\/project-binding-requests\/([0-9a-f-]{36})$/,
      );
      if (request.method === "DELETE" && withdrawalMatch) {
        const binding = await options.service.withdrawBinding(
          auth,
          withdrawalMatch[1]!,
        );
        writeJson(response, 200, toBindingResponse(binding));
        return true;
      }

      if (
        request.method === "POST" &&
        path === "/api/v1/integrations/geo/project-binding-status"
      ) {
        const input = geoProjectBindingStatusRequestSchema.parse(
          parseJson(rawBody),
        );
        const binding = await options.service.findBindingByGeoProject(
          auth,
          input.geo_project_ref,
        );
        writeJson(response, 200, toBindingResponse(binding));
        return true;
      }

      const disconnectMatch = path.match(
        /^\/api\/v1\/integrations\/geo\/project-bindings\/([0-9a-f-]{36})\/disconnect$/,
      );
      if (request.method === "POST" && disconnectMatch) {
        parseEmptyObject(rawBody);
        const binding = await options.service.disconnectBinding(
          auth,
          disconnectMatch[1]!,
        );
        writeJson(response, 200, toBindingResponse(binding));
        return true;
      }

      if (
        request.method === "POST" &&
        path === "/api/v1/integrations/geo/sso-tickets"
      ) {
        const input = geoSsoTicketRequestSchema.parse(parseJson(rawBody));
        const ticket = await options.service.issueSsoTicket({
          auth,
          geoUserRef: input.geo_user_ref,
          geoProjectRef: input.geo_project_ref,
          displayName: input.display_name,
          roleCodes: input.role_codes,
          ...(input.requested_path
            ? { requestedPath: input.requested_path }
            : {}),
        });
        writeJson(
          response,
          201,
          geoSsoTicketResponseSchema.parse({
            launch_url: ticket.launchUrl,
            expires_at: ticket.expiresAt,
          }),
        );
        return true;
      }

      const syncMatch = path.match(
        /^\/api\/v1\/integrations\/geo\/project-bindings\/([0-9a-f-]{36})\/query-set-snapshots$/,
      );
      if (request.method === "PUT" && syncMatch) {
        const input = geoQuerySetSyncInputSchema.parse(parseJson(rawBody));
        const result = await options.service.syncQuerySet({
          auth,
          bindingId: syncMatch[1]!,
          geoQuerySetRef: input.geo_query_set_ref,
          geoRevision: input.geo_revision,
          title: input.title,
          locale: input.locale,
          market: input.market,
          queries: input.queries.map((query) => ({
            externalKey: query.external_key,
            text: query.text,
            intent: query.intent,
            commercialValue: query.commercial_value,
          })),
        });
        writeJson(
          response,
          200,
          geoQuerySetSyncResponseSchema.parse({
            snapshot_id: result.snapshotId,
            snapshot_hash: result.snapshotHash,
            query_count: result.queryCount,
            created: result.created,
          }),
        );
        return true;
      }

      writeJson(response, 404, { error: "NOT_FOUND" });
      return true;
    } catch (error) {
      writeGeoError(response, error);
      return true;
    }
  };
}

function isSignedGeoIntegrationRoute(
  method: string | undefined,
  path: string,
): boolean {
  return (
    (method === "POST" &&
      (path === "/api/v1/integrations/geo/project-binding-requests" ||
        path === "/api/v1/integrations/geo/project-binding-status" ||
        path === "/api/v1/integrations/geo/sso-tickets" ||
        /^\/api\/v1\/integrations\/geo\/project-bindings\/[0-9a-f-]{36}\/disconnect$/.test(
          path,
        ))) ||
    (method === "DELETE" &&
      /^\/api\/v1\/integrations\/geo\/project-binding-requests\/[0-9a-f-]{36}$/.test(
        path,
      )) ||
    (method === "PUT" &&
      /^\/api\/v1\/integrations\/geo\/project-bindings\/[0-9a-f-]{36}\/query-set-snapshots$/.test(
        path,
      ))
  );
}

function signedRequestInput(
  request: IncomingMessage,
  path: string,
  rawBody: string,
): GeoSignedRequestInput {
  return {
    connectorId: requiredHeader(request, "x-wentian-connector-id"),
    contractVersion: requiredHeader(request, "x-wentian-contract-version"),
    signature: requiredHeader(request, "x-wentian-signature"),
    issuedAt: requiredHeader(request, "x-wentian-issued-at"),
    nonce: requiredHeader(request, "x-wentian-nonce"),
    requestId: requiredHeader(request, "x-wentian-request-id"),
    idempotencyKey: requiredHeader(request, "idempotency-key"),
    method: request.method ?? "GET",
    path,
    rawBody,
  };
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("GEO_CONNECTOR_UNAUTHORIZED");
  }
  return value;
}

async function readRawBody(
  request: IncomingMessage,
  jsonRequired: boolean,
): Promise<string> {
  if (jsonRequired) {
    const contentType = request.headers["content-type"]
      ?.split(";", 1)[0]
      ?.trim();
    if (contentType !== "application/json") {
      throw new Error("JSON_CONTENT_TYPE_REQUIRED");
    }
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > JSON_BODY_LIMIT) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

function parseEmptyObject(rawBody: string): void {
  const value = parseJson(rawBody);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw new Error("INVALID_REQUEST");
  }
}

function toBindingResponse(binding: GeoProjectBindingRecord) {
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
    `wentian_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function writeGeoError(response: ServerResponse, error: unknown): void {
  const rawCode =
    error instanceof Error && error.name === "ZodError"
      ? "INVALID_REQUEST"
      : error instanceof Error
        ? error.message
        : "INTERNAL_ERROR";
  const status =
    rawCode === "GEO_CONNECTOR_UNAUTHORIZED"
      ? 401
      : rawCode === "GEO_CONNECTOR_SUSPENDED"
        ? 403
        : rawCode === "GEO_BINDING_NOT_FOUND"
          ? 404
          : rawCode.includes("CONFLICT") || rawCode.endsWith("_REPLAYED")
            ? 409
            : rawCode.startsWith("INVALID_") ||
                rawCode === "GEO_CONTRACT_VERSION_UNSUPPORTED" ||
                rawCode === "GEO_CONNECTOR_SIGNATURE_EXPIRED" ||
                rawCode === "GEO_ROLE_NOT_MAPPED" ||
                rawCode === "GEO_QUERY_SET_INVALID" ||
                rawCode === "JSON_CONTENT_TYPE_REQUIRED"
              ? 400
              : rawCode === "REQUEST_BODY_TOO_LARGE"
                ? 413
                : 500;
  writeJson(response, status, {
    error: status === 500 ? "INTERNAL_ERROR" : rawCode,
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  noReferrer = false,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...(noReferrer ? { "referrer-policy": "no-referrer" } : {}),
  });
  response.end(JSON.stringify(body));
}
