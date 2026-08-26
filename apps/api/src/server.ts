import { createServer, type Server, type ServerResponse } from "node:http";

import {
  livenessResponseSchema,
  readinessResponseSchema,
  type ReadinessChecks,
} from "@wentian/contracts";

import {
  createSyntheticConsumerObservationHandler,
  type SyntheticConsumerObservationApiOptions,
} from "./synthetic-consumer-observation-api.ts";
import {
  createLocalAccessApiHandler,
  type LocalAccessApiOptions,
} from "./local-access-api.ts";
import {
  createStandaloneConsumerObservationApiHandler,
  type StandaloneConsumerObservationApiOptions,
} from "./standalone-consumer-observation-api.ts";
import { handleStandaloneWebUi } from "./standalone-web-ui.ts";
import {
  createGeoIntegrationApiHandler,
  type GeoIntegrationApiOptions,
} from "./geo-integration-api.ts";

const defaultReadinessChecks: ReadinessChecks = {
  database: "not_configured",
  objectStore: "not_configured",
};

export interface WentianApiServerOptions {
  readonly version?: string;
  readonly getReadinessChecks?:
    (() => ReadinessChecks) | (() => Promise<ReadinessChecks>);
  readonly syntheticConsumerObservationApi?: SyntheticConsumerObservationApiOptions;
  readonly localAccessApi?: LocalAccessApiOptions;
  readonly standaloneConsumerObservationApi?: StandaloneConsumerObservationApiOptions;
  readonly geoIntegrationApi?: GeoIntegrationApiOptions;
}

export function createWentianApiServer(
  options: WentianApiServerOptions = {},
): Server {
  const version = options.version ?? "0.0.0-dev";
  const getReadinessChecks =
    options.getReadinessChecks ?? (() => defaultReadinessChecks);
  const handleSyntheticConsumerObservation =
    options.syntheticConsumerObservationApi === undefined
      ? null
      : createSyntheticConsumerObservationHandler(
          options.syntheticConsumerObservationApi,
        );
  const handleLocalAccessApi =
    options.localAccessApi === undefined
      ? null
      : createLocalAccessApiHandler(options.localAccessApi);
  const handleStandaloneConsumerObservationApi =
    options.standaloneConsumerObservationApi === undefined
      ? null
      : createStandaloneConsumerObservationApiHandler(
          options.standaloneConsumerObservationApi,
        );
  const handleGeoIntegrationApi =
    options.geoIntegrationApi === undefined
      ? null
      : createGeoIntegrationApiHandler(options.geoIntegrationApi);

  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://wentian.local");

    if (request.method === "GET" && requestUrl.pathname === "/health/live") {
      const body = livenessResponseSchema.parse({
        status: "ok",
        service: "wentian-api",
        version,
      });

      writeJson(response, 200, body);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/health/ready") {
      try {
        const checks = await getReadinessChecks();
        const ready = Object.values(checks).every((state) => state === "ready");
        const body = readinessResponseSchema.parse({
          status: ready ? "ready" : "not_ready",
          service: "wentian-api",
          version,
          checks,
        });

        writeJson(response, ready ? 200 : 503, body);
      } catch {
        writeJson(response, 500, {
          error: "READINESS_CHECK_FAILED",
        });
      }
      return;
    }

    if (
      handleGeoIntegrationApi &&
      (await handleGeoIntegrationApi(request, response, requestUrl))
    ) {
      return;
    }

    if (await handleStandaloneWebUi(request, response, requestUrl)) {
      return;
    }

    if (
      handleLocalAccessApi &&
      (await handleLocalAccessApi(request, response, requestUrl))
    ) {
      return;
    }

    if (
      handleStandaloneConsumerObservationApi &&
      (await handleStandaloneConsumerObservationApi(
        request,
        response,
        requestUrl,
      ))
    ) {
      return;
    }

    if (
      handleSyntheticConsumerObservation &&
      (await handleSyntheticConsumerObservation(request, response, requestUrl))
    ) {
      return;
    }

    writeJson(response, 404, {
      error: "NOT_FOUND",
    });
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
