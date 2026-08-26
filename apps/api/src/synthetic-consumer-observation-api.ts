import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ConsumerObservationWorkflowService,
  WentianApplicationError,
} from "@wentian/application";
import {
  SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION,
  syntheticClaimObservationTaskInputSchema,
  syntheticClaimObservationTaskResponseSchema,
  syntheticConfirmObservationInputSchema,
  syntheticConfirmObservationResponseSchema,
  syntheticRejectObservationInputSchema,
  syntheticRejectObservationResponseSchema,
  syntheticSubmitCaptureInputSchema,
  syntheticSubmitCaptureResponseSchema,
} from "@wentian/contracts";

const MAX_SYNTHETIC_REQUEST_BYTES = 64 * 1_024;

export interface SyntheticApiPrincipal {
  readonly userId: string;
  readonly role: "owner" | "admin" | "analyst" | "viewer";
  readonly allowedScopeIds: readonly string[];
}

export interface SyntheticConsumerObservationTaskDescriptor {
  readonly taskId: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly querySnapshotItemId: string;
  readonly sampleIndex: number;
  readonly collectionMethod: "browser_assisted" | "manual_import";
}

export interface SyntheticConsumerObservationApiOptions {
  readonly workflow: ConsumerObservationWorkflowService;
  readonly task: SyntheticConsumerObservationTaskDescriptor;
  readonly captureToken: string;
  readonly resolvePrincipal:
    | ((request: IncomingMessage) => SyntheticApiPrincipal)
    | ((request: IncomingMessage) => Promise<SyntheticApiPrincipal>);
  readonly newId: () => string;
  readonly now: () => string;
}

interface CachedIdempotentResponse {
  readonly fingerprint: string;
  readonly statusCode: number;
  readonly body: unknown;
}

type SyntheticAction = "claim" | "captures" | "confirm" | "reject";

export function createSyntheticConsumerObservationHandler(
  options: SyntheticConsumerObservationApiOptions,
): (
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
) => Promise<boolean> {
  const captureArtifactIdByTaskId = new Map<string, string>();
  const idempotentResponses = new Map<string, CachedIdempotentResponse>();

  return async (request, response, requestUrl) => {
    const match = requestUrl.pathname.match(
      /^\/dev\/synthetic\/consumer-observation\/tasks\/([^/]+)\/(claim|captures|confirm|reject)$/,
    );
    if (!match) {
      return false;
    }
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return true;
    }

    let taskId: string;
    try {
      taskId = decodeURIComponent(match[1]);
    } catch {
      writeJson(response, 404, { error: "NOT_FOUND" });
      return true;
    }
    if (taskId !== options.task.taskId) {
      writeJson(response, 404, { error: "NOT_FOUND" });
      return true;
    }

    try {
      const principal = await options.resolvePrincipal(request);
      const rawBody = await readJsonBody(request);
      const action = match[2] as SyntheticAction;

      if (action === "claim") {
        const input = parseInput(
          syntheticClaimObservationTaskInputSchema,
          rawBody,
        );
        const task = await options.workflow.claim(principal, {
          scopeId: input.scope_id,
          taskId,
          taskVersion: input.task_version,
          occurredAt: options.now(),
        });
        const body = syntheticClaimObservationTaskResponseSchema.parse({
          schema_version: SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION,
          synthetic: true,
          task_id: task.id,
          task_version: task.version,
          status: task.status,
          capture_token: options.captureToken,
        });
        writeJson(response, 200, body);
        return true;
      }

      if (action === "captures") {
        const input = parseInput(syntheticSubmitCaptureInputSchema, rawBody);
        const captureArtifactId = options.newId();
        const task = await options.workflow.submitCapture(principal, {
          scopeId: input.scope_id,
          taskId,
          taskVersion: input.task_version,
          occurredAt: options.now(),
          captureToken: input.capture_token,
          requestOrigin: requestOrigin(request),
          artifact: {
            id: captureArtifactId,
            scopeId: input.scope_id,
            observationTaskId: taskId,
            capturedBy: principal.userId,
            collectionMethod: options.task.collectionMethod,
          },
        });
        captureArtifactIdByTaskId.set(taskId, captureArtifactId);
        const body = syntheticSubmitCaptureResponseSchema.parse({
          schema_version: SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION,
          synthetic: true,
          task_id: task.id,
          task_version: task.version,
          status: task.status,
          capture_artifact_id: captureArtifactId,
        });
        writeJson(response, 202, body);
        return true;
      }

      if (action === "confirm") {
        const input = parseInput(
          syntheticConfirmObservationInputSchema,
          rawBody,
        );
        await handleIdempotentAction(
          request,
          response,
          principal,
          taskId,
          action,
          input,
          async () => {
            const captureArtifactId =
              captureArtifactIdByTaskId.get(taskId) ?? "";
            const result = await options.workflow.confirm(principal, {
              scopeId: input.scope_id,
              taskId,
              taskVersion: input.task_version,
              occurredAt: options.now(),
              response: {
                id: options.newId(),
                scopeId: input.scope_id,
                runId: options.task.runId,
                querySnapshotItemId: options.task.querySnapshotItemId,
                sampleIndex: options.task.sampleIndex,
                captureArtifactId,
              },
            });
            return {
              statusCode: 200,
              body: syntheticConfirmObservationResponseSchema.parse({
                schema_version: SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION,
                synthetic: true,
                task_id: result.task.id,
                task_version: result.task.version,
                status: result.task.status,
                confirmed_response_id: result.task.confirmedResponseId,
                evidence_grade: result.evidenceGrade,
              }),
            };
          },
        );
        return true;
      }

      const input = parseInput(syntheticRejectObservationInputSchema, rawBody);
      await handleIdempotentAction(
        request,
        response,
        principal,
        taskId,
        action,
        input,
        async () => {
          const result = await options.workflow.reject(principal, {
            scopeId: input.scope_id,
            taskId,
            taskVersion: input.task_version,
            occurredAt: options.now(),
            rejectionReason: input.rejection_reason,
          });
          captureArtifactIdByTaskId.delete(taskId);
          return {
            statusCode: 200,
            body: syntheticRejectObservationResponseSchema.parse({
              schema_version: SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION,
              synthetic: true,
              task_id: result.task.id,
              task_version: result.task.version,
              status: result.task.status,
              purged_capture_artifact_id: result.artifactIdToPurge,
            }),
          };
        },
      );
      return true;
    } catch (error) {
      const mapped = mapError(error);
      writeJson(response, mapped.statusCode, { error: mapped.errorCode });
      return true;
    }
  };

  async function handleIdempotentAction(
    request: IncomingMessage,
    response: ServerResponse,
    principal: SyntheticApiPrincipal,
    taskId: string,
    action: "confirm" | "reject",
    input: unknown,
    execute: () => Promise<{
      readonly statusCode: number;
      readonly body: unknown;
    }>,
  ): Promise<void> {
    const idempotencyKey = singleHeader(request, "idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new SyntheticHttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
    }
    const cacheKey = `${principal.userId}:${idempotencyKey}`;
    const fingerprint = JSON.stringify({ action, taskId, input });
    const cached = idempotentResponses.get(cacheKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        throw new SyntheticHttpError(409, "IDEMPOTENCY_KEY_CONFLICT");
      }
      writeJson(response, cached.statusCode, cached.body);
      return;
    }
    const result = await execute();
    idempotentResponses.set(cacheKey, { fingerprint, ...result });
    writeJson(response, result.statusCode, result.body);
  }
}

function parseInput<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SyntheticHttpError(400, "INVALID_REQUEST");
  }
  return result.data as T;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = singleHeader(request, "content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new SyntheticHttpError(415, "JSON_CONTENT_TYPE_REQUIRED");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_SYNTHETIC_REQUEST_BYTES) {
      throw new SyntheticHttpError(413, "REQUEST_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SyntheticHttpError(400, "INVALID_JSON");
  }
}

function requestOrigin(request: IncomingMessage): string {
  const origin = singleHeader(request, "origin");
  if (!origin) {
    throw new SyntheticHttpError(400, "ORIGIN_REQUIRED");
  }
  return origin;
}

function singleHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

function mapError(error: unknown): {
  readonly statusCode: number;
  readonly errorCode: string;
} {
  if (error instanceof SyntheticHttpError) {
    return { statusCode: error.statusCode, errorCode: error.errorCode };
  }
  if (error instanceof WentianApplicationError) {
    return {
      statusCode: error.code === "RESOURCE_NOT_FOUND" ? 404 : 403,
      errorCode: error.code,
    };
  }
  const errorCode = error instanceof Error ? error.message : "";
  if (
    errorCode === "CAPTURE_TOKEN_INVALID" ||
    errorCode === "CAPTURE_TOKEN_EXPIRED" ||
    (errorCode.startsWith("CAPTURE_TOKEN_") && errorCode.endsWith("_MISMATCH"))
  ) {
    return { statusCode: 401, errorCode: "CAPTURE_TOKEN_INVALID" };
  }
  if (
    errorCode === "CAPTURE_TOKEN_ALREADY_CONSUMED" ||
    errorCode === "INVALID_OBSERVATION_TASK_TRANSITION" ||
    errorCode === "OBSERVATION_TASK_VERSION_CONFLICT" ||
    errorCode === "CAPTURE_ARTIFACT_ALREADY_EXISTS" ||
    errorCode === "OBSERVATION_TASK_CAPTURE_REQUIRED"
  ) {
    return { statusCode: 409, errorCode };
  }
  if (errorCode === "CAPTURE_ARTIFACT_PURGE_FAILED") {
    return { statusCode: 500, errorCode: "INTERNAL_ERROR" };
  }
  if (
    errorCode.startsWith("CAPTURE_ARTIFACT_") ||
    errorCode.startsWith("CONFIRMED_RESPONSE_")
  ) {
    return { statusCode: 422, errorCode };
  }
  return { statusCode: 500, errorCode: "INTERNAL_ERROR" };
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

class SyntheticHttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, errorCode: string) {
    super(errorCode);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}
