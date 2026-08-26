import { createWentianApiServer } from "./server.ts";
import {
  loadDoubaoAutomationRuntime,
  loadQianwenAutomationRuntime,
} from "./doubao-automation-runtime.ts";
import {
  createStandalonePostgresPool,
  createStandaloneReadinessChecker,
  HmacAutomationBatchTokenService,
  HmacCaptureTokenService,
  PostgresCaptureTokenNonceRepository,
  PostgresConsumerCaptureArtifactRepository,
  PostgresConsumerCaptureSubmissionTransactionRepository,
  PostgresConsumerObservationRepository,
  PostgresConsumerObservationRunDeletionService,
  PostgresConsumerSurfaceProfileVersionRepository,
  PostgresEvidenceMediaAssetRepository,
  PostgresGeoConnectorService,
  PostgresLocalAccessService,
  PostgresQuerySetSnapshotRepository,
  PostgresScopeRepository,
  PostgresScopeDeletionService,
  PostgresSourceNominationRepository,
  S3EvidenceObjectStore,
} from "@wentian/infrastructure";

const port = parsePort(process.env.PORT);
const host = process.env.WENTIAN_BIND_HOST ?? "127.0.0.1";
const version = process.env.WENTIAN_VERSION ?? "0.0.0-dev";
const databaseUrl = process.env.WENTIAN_DATABASE_URL?.trim();
const databasePool = databaseUrl
  ? createStandalonePostgresPool(databaseUrl)
  : null;
const sessionSecret = process.env.WENTIAN_SESSION_SECRET?.trim();
if (databasePool && !sessionSecret) {
  throw new Error("WENTIAN_SESSION_SECRET_REQUIRED");
}
const publicOrigin =
  process.env.WENTIAN_PUBLIC_ORIGIN?.trim() ?? `http://127.0.0.1:${port}`;
const doubaoAutomationRuntime = loadDoubaoAutomationRuntime(process.env);
const qianwenAutomationRuntime = loadQianwenAutomationRuntime(process.env);
const localAccessService =
  databasePool && sessionSecret
    ? new PostgresLocalAccessService({
        pool: databasePool,
        sessionSecret,
      })
    : null;
const objectStoreEndpoint = process.env.WENTIAN_OBJECT_STORE_ENDPOINT?.trim();
const objectStoreBucket = process.env.WENTIAN_OBJECT_STORE_BUCKET?.trim();
const s3AccessKey = process.env.WENTIAN_S3_ACCESS_KEY?.trim();
const s3SecretKey = process.env.WENTIAN_S3_SECRET_KEY?.trim();
const systemInstanceId = databasePool
  ? await loadSystemInstanceId(databasePool)
  : null;
const evidenceObjects =
  systemInstanceId &&
  objectStoreEndpoint &&
  objectStoreBucket &&
  s3AccessKey &&
  s3SecretKey
    ? new S3EvidenceObjectStore({
        endpoint: objectStoreEndpoint,
        bucket: objectStoreBucket,
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey,
        instanceId: systemInstanceId,
      })
    : null;
const scopeDeletionService =
  databasePool && systemInstanceId && evidenceObjects
    ? new PostgresScopeDeletionService({
        pool: databasePool,
        objects: evidenceObjects,
        instanceId: systemInstanceId,
      })
    : null;
const geoConnectorMasterSecret =
  process.env.WENTIAN_GEO_CONNECTOR_MASTER_SECRET?.trim();
const geoConnectorService =
  databasePool && geoConnectorMasterSecret
    ? new PostgresGeoConnectorService({
        pool: databasePool,
        snapshots: new PostgresQuerySetSnapshotRepository(databasePool),
        masterSecret: geoConnectorMasterSecret,
        publicOrigin,
      })
    : null;
const standaloneConsumerObservationApi =
  databasePool &&
  localAccessService &&
  sessionSecret &&
  systemInstanceId &&
  evidenceObjects
    ? createStandaloneConsumerRuntime({
        databasePool,
        localAccessService,
        sessionSecret,
        systemInstanceId,
        evidenceObjects,
        publicOrigin,
        automationRuntime: doubaoAutomationRuntime,
        qianwenAutomationRuntime,
      })
    : null;
const getReadinessChecks = createStandaloneReadinessChecker({
  databasePool,
  objectStoreEndpoint,
});
const server = createWentianApiServer({
  version,
  getReadinessChecks,
  ...(localAccessService
    ? {
        localAccessApi: {
          service: localAccessService,
          ...(scopeDeletionService
            ? { scopeDeletion: scopeDeletionService }
            : {}),
          ...(geoConnectorService
            ? { geoConnectorAdmin: geoConnectorService }
            : {}),
          publicOrigin,
          secureCookie: process.env.WENTIAN_COOKIE_SECURE === "true",
        },
      }
    : {}),
  ...(standaloneConsumerObservationApi
    ? { standaloneConsumerObservationApi }
    : {}),
  ...(geoConnectorService
    ? {
        geoIntegrationApi: {
          service: geoConnectorService,
          secureCookie: process.env.WENTIAN_COOKIE_SECURE === "true",
        },
      }
    : {}),
});

server.listen(port, host, () => {
  process.stdout.write(`wentian-api listening on http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async (error) => {
      await databasePool?.end().catch(() => undefined);
      evidenceObjects?.destroy();
      process.exitCode = error ? 1 : 0;
    });
  });
}

async function loadSystemInstanceId(
  pool: NonNullable<typeof databasePool>,
): Promise<string> {
  const result = await pool.query<{ readonly id: string }>(
    "SELECT id FROM wentian_instances WHERE singleton = true",
  );
  if (result.rowCount !== 1) {
    throw new Error("WENTIAN_INSTANCE_NOT_INITIALIZED");
  }
  return result.rows[0]!.id;
}

function createStandaloneConsumerRuntime(input: {
  readonly databasePool: NonNullable<typeof databasePool>;
  readonly localAccessService: PostgresLocalAccessService;
  readonly sessionSecret: string;
  readonly systemInstanceId: string;
  readonly evidenceObjects: S3EvidenceObjectStore;
  readonly publicOrigin: string;
  readonly automationRuntime: ReturnType<typeof loadDoubaoAutomationRuntime>;
  readonly qianwenAutomationRuntime: ReturnType<
    typeof loadQianwenAutomationRuntime
  >;
}) {
  const observations = new PostgresConsumerObservationRepository(
    input.databasePool,
  );
  const captureArtifacts = new PostgresConsumerCaptureArtifactRepository(
    input.databasePool,
    input.evidenceObjects,
  );
  const mediaAssets = new PostgresEvidenceMediaAssetRepository(
    input.databasePool,
    input.evidenceObjects,
  );
  const captureTokenNonces = new PostgresCaptureTokenNonceRepository(
    input.databasePool,
  );
  const nominationReviews = new PostgresSourceNominationRepository(
    input.databasePool,
  );
  return {
    localAccess: input.localAccessService,
    automationSettings: input.localAccessService,
    automationRuntime: input.automationRuntime,
    qianwenAutomationRuntime: input.qianwenAutomationRuntime,
    publicOrigin: input.publicOrigin,
    systemInstanceId: input.systemInstanceId,
    scopes: new PostgresScopeRepository(input.databasePool),
    snapshots: new PostgresQuerySetSnapshotRepository(input.databasePool),
    surfaces: new PostgresConsumerSurfaceProfileVersionRepository(
      input.databasePool,
    ),
    observations,
    runDeletion: new PostgresConsumerObservationRunDeletionService(
      input.databasePool,
    ),
    nominationReviews,
    captureArtifacts,
    captureSubmissions:
      new PostgresConsumerCaptureSubmissionTransactionRepository(
        input.databasePool,
      ),
    mediaAssets,
    objects: input.evidenceObjects,
    automationBatchTokens: new HmacAutomationBatchTokenService(
      input.sessionSecret,
    ),
    captureTokens: new HmacCaptureTokenService(input.sessionSecret),
    captureTokenNonces,
    confirmations: observations,
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("INVALID_PORT");
  }

  return port;
}
