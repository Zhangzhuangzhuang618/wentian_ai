import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ConfirmConsumerObservationTransactionService,
  ConfirmSourceNominationParseReviewService,
  ConsumerObservationWorkflowService,
  CreateConsumerObservationRunService,
  CreateLocalQuerySetSnapshotService,
  CreateSourceNominationParseReviewService,
  GetConsumerNominationCitationComparisonService,
  ReconcileConsumerObservationRunService,
  RejectSourceNominationParseReviewService,
  assertConsumerCaptureEvidenceArtifactIntegrity,
  createConsumerCaptureEvidenceArtifact,
  createWentianPrincipal,
  isConsumerCaptureEvidenceArtifact,
  rankSourceEntriesByDomain,
  type AiVisibilityNominatedSourceEventRepository,
  type AiVisibilityCitedSourceEventRepository,
  type CaptureTokenClaims,
  type ConsumerCaptureArtifactBindingRepository,
  type ConsumerCaptureSubmissionTransactionRepository,
  type ConfirmedConsumerObservationRecordRepository,
  type ConsumerObservationRunRepository,
  type ConsumerObservationTaskRepository,
  type ConsumerSurfaceProfileVersionRepository,
  type QuerySetSnapshotRepository,
  type ScopeRepository,
  type ConsumerObservationRun,
  type QuerySetSnapshot,
  type SourceNominationParseReview,
  type SourceNominationParseReviewRepository,
  type SourceNominationParseReviewTransactionRepository,
  type WentianPrincipal,
} from "@wentian/application";
import {
  adaptConsumerNominationCitationComparisonToResponse,
  adaptConfirmedBrowserCaptureDraftToSubmission,
  createStandaloneConsumerRunInputSchema,
  createStandaloneQuerySetInputSchema,
  standaloneAutomationBatchNextInputSchema,
  standaloneAutomationBatchNextResponseSchema,
  standaloneAutomationPreflightInputSchema,
  standaloneAutomationPreflightResponseSchema,
  standaloneBrowserCaptureUploadSchema,
  standaloneCaptureUploadResponseSchema,
  standaloneClaimTaskResponseSchema,
  standaloneConfirmTaskInputSchema,
  standaloneConfirmNominationReviewInputSchema,
  standaloneConsumerCatalogResponseSchema,
  standaloneConsumerRunResponseSchema,
  standaloneDeleteConsumerRunResponseSchema,
  standaloneConsumerTaskListResponseSchema,
  standaloneConsumerTaskPreviewResponseSchema,
  standaloneCreateAutomationBatchInputSchema,
  standaloneCreateAutomationBatchResponseSchema,
  standaloneCreateNominationReviewResponseSchema,
  standaloneNominationReviewListResponseSchema,
  standaloneNominationReviewSchema,
  standaloneQuerySetResponseSchema,
  standaloneRejectNominationReviewInputSchema,
  standaloneRejectTaskInputSchema,
  standaloneSourceRankingResponseSchema,
  standaloneTerminalTaskResponseSchema,
  getConsumerWebSurface,
} from "@wentian/contracts";
import {
  ConfirmedConsumerObservationSourceEventProjector,
  DeterministicExplicitSourceNominationExtractor,
  type AuthenticatedLocalUser,
  type EvidenceMediaAsset,
  type HmacCaptureTokenService,
  type HmacAutomationBatchTokenService,
  type LocalSessionResult,
  SourceNominationEventProjector,
} from "@wentian/infrastructure";

import type { LocalAccessApiService } from "./local-access-api.ts";
import type {
  DeepseekAutomationRuntime,
  DoubaoAutomationRuntime,
  QianwenAutomationRuntime,
} from "./doubao-automation-runtime.ts";
import {
  buildConsumerExperimentPrompt,
  DoubaoAutomationPreflightService,
  type ConsumerAutomationSettingsReader,
} from "./doubao-automation-preflight.ts";

const SESSION_COOKIE = "wentian_session";
const JSON_BODY_LIMIT = 21 * 1_024 * 1_024;
const CAPTURE_TOKEN_TTL_MS = 10 * 60 * 1_000;
const AUTOMATION_BATCH_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;
const EXTENSION_HANDOFF_VERSION = "wentian-extension-handoff@1";
const EXTENSION_BATCH_HANDOFF_VERSION = "wentian-extension-batch-handoff@1";

interface EvidenceMediaAssetRepository {
  create(asset: EvidenceMediaAsset): Promise<void>;
  purge(scopeId: string, assetId: string): Promise<boolean>;
}

interface EvidenceObjectStore {
  putScreenshot(input: {
    readonly scopeId: string;
    readonly assetId: string;
    readonly bytes: Buffer;
    readonly observedAt: string;
  }): Promise<{
    readonly objectKey: string;
    readonly sha256: string;
    readonly byteSize: number;
  }>;
  deleteObject(objectKey: string): Promise<void>;
}

interface CaptureTokenNonceIssuer {
  issue(claims: CaptureTokenClaims): Promise<void>;
  consumeOnce(nonce: string): Promise<boolean>;
}

export interface StandaloneConsumerObservationApiOptions {
  readonly localAccess: LocalAccessApiService;
  readonly automationSettings: ConsumerAutomationSettingsReader;
  readonly automationRuntime: DoubaoAutomationRuntime;
  readonly qianwenAutomationRuntime?: QianwenAutomationRuntime;
  readonly deepseekAutomationRuntime?: DeepseekAutomationRuntime;
  readonly publicOrigin: string;
  readonly systemInstanceId: string;
  readonly scopes: ScopeRepository;
  readonly snapshots: QuerySetSnapshotRepository & {
    listByScope(scopeId: string): Promise<readonly QuerySetSnapshot[]>;
  };
  readonly surfaces: ConsumerSurfaceProfileVersionRepository;
  readonly observations: ConsumerObservationRunRepository &
    ConsumerObservationTaskRepository &
    ConfirmedConsumerObservationRecordRepository &
    AiVisibilityCitedSourceEventRepository & {
      listRunsByScope(
        scopeId: string,
      ): Promise<readonly ConsumerObservationRun[]>;
    };
  readonly runDeletion: {
    deleteUnstartedRun(input: {
      readonly user: AuthenticatedLocalUser;
      readonly scopeId: string;
      readonly runId: string;
    }): Promise<{ readonly deletedRunId: string }>;
  };
  readonly nominationReviews: SourceNominationParseReviewRepository &
    AiVisibilityNominatedSourceEventRepository &
    SourceNominationParseReviewTransactionRepository;
  readonly captureArtifacts: ConsumerCaptureArtifactBindingRepository;
  readonly captureSubmissions: ConsumerCaptureSubmissionTransactionRepository;
  readonly mediaAssets: EvidenceMediaAssetRepository;
  readonly objects: EvidenceObjectStore;
  readonly captureTokens: HmacCaptureTokenService;
  readonly automationBatchTokens: HmacAutomationBatchTokenService;
  readonly captureTokenNonces: CaptureTokenNonceIssuer;
  readonly confirmations: ConstructorParameters<
    typeof ConfirmConsumerObservationTransactionService
  >[0]["transactions"];
  readonly now?: () => string;
  readonly newId?: () => string;
}

export function createStandaloneConsumerObservationApiHandler(
  options: StandaloneConsumerObservationApiOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? randomUUID;
  const publicOrigin = new URL(options.publicOrigin).origin;
  const createSnapshot = new CreateLocalQuerySetSnapshotService({
    scopes: options.scopes,
    snapshots: options.snapshots,
    newId,
    now,
  });
  const createRun = new CreateConsumerObservationRunService({
    scopes: options.scopes,
    snapshots: options.snapshots,
    surfaceProfiles: options.surfaces,
    runs: options.observations,
    newId,
    now,
  });
  const workflow = new ConsumerObservationWorkflowService({
    tasks: options.observations,
    captureArtifacts: options.captureArtifacts,
    captureTokens: options.captureTokens,
    captureTokenNonces: options.captureTokenNonces,
    captureSubmissions: options.captureSubmissions,
    systemInstanceId: options.systemInstanceId,
  });
  const automationPreflight = new DoubaoAutomationPreflightService({
    systemInstanceId: options.systemInstanceId,
    publicOrigin,
    captureTokens: options.captureTokens,
    tasks: options.observations,
    snapshots: options.snapshots,
    surfaces: options.surfaces,
    settings: options.automationSettings,
    runtime: options.automationRuntime,
    qianwenRuntime:
      options.qianwenAutomationRuntime ??
      Object.freeze({
        environment: "production",
        currentRegion: "CN_MAINLAND",
        authorizationBasis: "none",
        authorizationEvidenceId: null,
        authorizationReviewedAt: null,
      }),
    deepseekRuntime:
      options.deepseekAutomationRuntime ??
      Object.freeze({
        environment: "production",
        currentRegion: "CN_MAINLAND",
        authorizationBasis: "none",
        authorizationEvidenceId: null,
        authorizationReviewedAt: null,
      }),
    now,
  });
  const confirm = new ConfirmConsumerObservationTransactionService({
    tasks: options.observations,
    runs: options.observations,
    captureArtifacts: options.captureArtifacts,
    surfaceProfiles: options.surfaces,
    sourceEventProjector:
      new ConfirmedConsumerObservationSourceEventProjector(),
    transactions: options.confirmations,
    newId,
  });
  const reconcile = new ReconcileConsumerObservationRunService({
    runs: options.observations,
    snapshots: options.snapshots,
  });
  const createNominationReview = new CreateSourceNominationParseReviewService({
    reviews: options.nominationReviews,
    responses: options.observations,
    runs: options.observations,
    extractor: new DeterministicExplicitSourceNominationExtractor(),
    newId,
    now,
  });
  const confirmNominationReview = new ConfirmSourceNominationParseReviewService(
    {
      reviews: options.nominationReviews,
      responses: options.observations,
      runs: options.observations,
      projector: new SourceNominationEventProjector(),
      transactions: options.nominationReviews,
      newId,
    },
  );
  const rejectNominationReview = new RejectSourceNominationParseReviewService({
    reviews: options.nominationReviews,
    responses: options.observations,
    runs: options.observations,
    transactions: options.nominationReviews,
  });
  const compareNominationCitation =
    new GetConsumerNominationCitationComparisonService({
      runs: options.observations,
      snapshots: options.snapshots,
      records: options.observations,
      citationEvents: options.observations,
      nominationEvents: options.nominationReviews,
      nominationReviews: options.nominationReviews,
    });

  async function claimTaskForPrincipal(
    principal: WentianPrincipal,
    existing: NonNullable<
      Awaited<ReturnType<ConsumerObservationTaskRepository["findById"]>>
    >,
  ) {
    let task = existing;
    const occurredAt = now();
    if (existing.status === "waiting_user") {
      task = await workflow.claim(principal, {
        scopeId: existing.scopeId,
        taskId: existing.id,
        taskVersion: existing.version,
        occurredAt,
      });
    } else if (
      existing.status !== "capturing" ||
      existing.assignedTo !== principal.userId
    ) {
      throw new Error("OBSERVATION_TASK_NOT_CLAIMABLE");
    }
    const run = await options.observations.findRunById(
      task.scopeId,
      task.runId,
    );
    if (!run) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    const surface = await options.surfaces.findById(
      run.surfaceProfileVersionId,
    );
    if (!surface || !getConsumerWebSurface(surface.surfaceCode)) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    const snapshot = await options.snapshots.findById(
      task.scopeId,
      run.querySetSnapshotId,
    );
    const query = snapshot?.items.find(
      (item) => item.id === task.querySnapshotItemId,
    );
    if (!snapshot || !query) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    const expiresAt = new Date(
      Date.parse(occurredAt) + CAPTURE_TOKEN_TTL_MS,
    ).toISOString();
    const issued = options.captureTokens.issue({
      systemInstanceId: options.systemInstanceId,
      scopeId: task.scopeId,
      taskId: task.id,
      userId: principal.userId,
      audienceOrigin: publicOrigin,
      issuedAt: occurredAt,
      expiresAt,
    });
    await options.captureTokenNonces.issue(issued.claims);
    await reconcile.execute({
      scopeId: run.scopeId,
      runId: run.id,
      occurredAt,
    });
    return standaloneClaimTaskResponseSchema.parse({
      task: toTaskResponse(task, query.queryText, run.experimentKind),
      surface_code: surface.surfaceCode,
      session_conditions: {
        search_mode: run.sessionConditions.searchMode,
        is_new_conversation: run.sessionConditions.isNewConversation,
        is_logged_in: run.sessionConditions.isLoggedIn,
        memory_enabled: run.sessionConditions.memoryEnabled,
        personalization_enabled: run.sessionConditions.personalizationEnabled,
        locale: run.sessionConditions.locale,
        region: run.sessionConditions.region,
      },
      capture_token: issued.token,
      token_expires_at: expiresAt,
      extension_handoff_code: createExtensionHandoffCode({
        apiOrigin: publicOrigin,
        taskId: task.id,
        taskVersion: task.version,
        captureToken: issued.token,
        tokenExpiresAt: expiresAt,
        reviewedSessionMetadata: {
          surface_model_label: null,
          is_new_conversation: run.sessionConditions.isNewConversation,
          is_logged_in: run.sessionConditions.isLoggedIn,
          memory_enabled: run.sessionConditions.memoryEnabled,
          personalization_enabled: run.sessionConditions.personalizationEnabled,
          locale: run.sessionConditions.locale,
          region: run.sessionConditions.region,
        },
      }),
    });
  }

  return async function handleStandaloneConsumerObservationApi(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
  ): Promise<boolean> {
    const path = requestUrl.pathname;

    const captureMatch = path.match(
      /^\/api\/v1\/ai-visibility\/consumer-observations\/tasks\/([0-9a-f-]{36})\/captures$/,
    );
    const automationPreflightMatch = path.match(
      /^\/api\/v1\/ai-visibility\/consumer-observations\/tasks\/([0-9a-f-]{36})\/automation-preflight$/,
    );
    const automationBatchNextRequest =
      path ===
      "/api/v1/ai-visibility/consumer-observations/automation-batches/next";
    const browserExtensionRequest = Boolean(
      captureMatch || automationPreflightMatch || automationBatchNextRequest,
    );
    if (browserExtensionRequest && request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return true;
    }

    try {
      if (request.method === "POST" && path === "/api/v1/query-set-snapshots") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        const input = createStandaloneQuerySetInputSchema.parse(
          await readJson(request),
        );
        const result = await createSnapshot.execute(toPrincipal(session.user), {
          scopeId: input.scope_id,
          title: input.title,
          locale: input.locale,
          market: input.market,
          industry: input.industry,
          region: input.region,
          sourceRef: input.generator_version
            ? "industry-question-generator"
            : undefined,
          sourceRevision: input.generator_version ? "1" : undefined,
          queries: input.queries.map((query) => ({
            externalKey: query.external_key,
            queryText: query.query_text,
            intentCode: query.intent_code,
            commercialValue: query.commercial_value,
          })),
        });
        writeJson(
          response,
          result.created ? 201 : 200,
          standaloneQuerySetResponseSchema.parse({
            id: result.snapshot.id,
            scope_id: result.snapshot.scopeId,
            title: result.snapshot.title,
            industry: result.snapshot.industry,
            region: result.snapshot.region,
            generator_version: toGeneratorVersion(result.snapshot),
            snapshot_hash: result.snapshot.snapshotHash,
            query_count: result.snapshot.queryCount,
            created: result.created,
            items: result.snapshot.items.map((item) => ({
              id: item.id,
              ordinal: item.ordinal,
              query_text: item.queryText,
              intent_code: item.intentCode,
              commercial_value: item.commercialValue,
            })),
          }),
        );
        return true;
      }

      if (
        request.method === "POST" &&
        path === "/api/v1/ai-visibility/consumer-observations"
      ) {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        const input = createStandaloneConsumerRunInputSchema.parse(
          await readJson(request),
        );
        const result = await createRun.execute(toPrincipal(session.user), {
          scopeId: input.scope_id,
          querySetSnapshotId: input.query_set_snapshot_id,
          surfaceCode: input.surface_code,
          collectionMethod: input.collection_method,
          experimentKind: input.experiment_kind,
          sampleCount: input.sample_count,
          sessionConditions: {
            searchMode: input.session_conditions.search_mode,
            isNewConversation: input.session_conditions.is_new_conversation,
            isLoggedIn: input.session_conditions.is_logged_in,
            memoryEnabled: input.session_conditions.memory_enabled,
            personalizationEnabled:
              input.session_conditions.personalization_enabled,
            locale: input.session_conditions.locale,
            region: input.session_conditions.region,
          },
          pairedRunId: input.paired_run_id,
        });
        writeJson(
          response,
          201,
          standaloneConsumerRunResponseSchema.parse({
            id: result.run.id,
            scope_id: result.run.scopeId,
            query_set_snapshot_id: result.run.querySetSnapshotId,
            surface_code: input.surface_code,
            collection_method: result.run.collectionMethod,
            experiment_kind: result.run.experimentKind,
            requested_sample_count: result.run.requestedSampleCount,
            planned_sample_count: result.run.plannedSampleCount,
            status: result.run.status,
            created_at: result.run.createdAt,
          }),
        );
        return true;
      }

      const catalogMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/consumer-catalog$/,
      );
      if (catalogMatch && request.method === "GET") {
        const session = await requireSession(request, options.localAccess);
        const principal = toPrincipal(session.user);
        requireScope(principal, catalogMatch[1]!);
        const [snapshots, runs] = await Promise.all([
          options.snapshots.listByScope(catalogMatch[1]!),
          options.observations.listRunsByScope(catalogMatch[1]!),
        ]);
        const surfaceProfiles = await Promise.all(
          runs.map((run) =>
            options.surfaces.findById(run.surfaceProfileVersionId),
          ),
        );
        if (surfaceProfiles.some((surface) => !surface)) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        writeJson(
          response,
          200,
          standaloneConsumerCatalogResponseSchema.parse({
            snapshots: snapshots.map((snapshot) => ({
              id: snapshot.id,
              title: snapshot.title,
              industry: snapshot.industry ?? null,
              region: snapshot.region ?? null,
              generator_version: toGeneratorVersion(snapshot),
              query_count: snapshot.queryCount,
              snapshot_hash: snapshot.snapshotHash,
              created_at: snapshot.createdAt,
            })),
            runs: runs.map((run, index) => {
              const snapshot = snapshots.find(
                (item) => item.id === run.querySetSnapshotId,
              );
              if (!snapshot) {
                throw new Error("RESOURCE_NOT_FOUND");
              }
              return {
                id: run.id,
                query_set_snapshot_id: run.querySetSnapshotId,
                industry: snapshot.industry ?? null,
                region: snapshot.region ?? null,
                surface_code: surfaceProfiles[index]!.surfaceCode,
                experiment_kind: run.experimentKind,
                paired_run_id: run.pairedRunId,
                status: run.status,
                requested_sample_count: run.requestedSampleCount,
                planned_sample_count: run.plannedSampleCount,
                successful_sample_count: run.successfulSampleCount,
                session_conditions: {
                  search_mode: run.sessionConditions.searchMode,
                  is_new_conversation: run.sessionConditions.isNewConversation,
                  is_logged_in: run.sessionConditions.isLoggedIn,
                  memory_enabled: run.sessionConditions.memoryEnabled,
                  personalization_enabled:
                    run.sessionConditions.personalizationEnabled,
                  locale: run.sessionConditions.locale,
                  region: run.sessionConditions.region,
                },
                created_at: run.createdAt,
                started_at: run.startedAt,
                completed_at: run.completedAt,
              };
            }),
          }),
        );
        return true;
      }

      const taskListMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})\/tasks$/,
      );
      const runDeletionMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})$/,
      );
      const taskPreviewMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})\/tasks\/([0-9a-f-]{36})\/preview$/,
      );
      const createAutomationBatchMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})\/automation-batch$/,
      );
      if (runDeletionMatch && request.method === "DELETE") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        const scopeId = runDeletionMatch[1]!;
        const runId = runDeletionMatch[2]!;
        requireScope(toPrincipal(session.user), scopeId);
        const result = await options.runDeletion.deleteUnstartedRun({
          user: session.user,
          scopeId,
          runId,
        });
        writeJson(
          response,
          200,
          standaloneDeleteConsumerRunResponseSchema.parse({
            deleted_run_id: result.deletedRunId,
          }),
        );
        return true;
      }
      if (createAutomationBatchMatch && request.method === "POST") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        standaloneCreateAutomationBatchInputSchema.parse(
          await readJson(request),
        );
        const principal = toPrincipal(session.user);
        const scopeId = createAutomationBatchMatch[1]!;
        const runId = createAutomationBatchMatch[2]!;
        requireScope(principal, scopeId);
        const [run, tasks, settings] = await Promise.all([
          options.observations.findRunById(scopeId, runId),
          options.observations.listTasksForRun(scopeId, runId),
          options.automationSettings.getConsumerAutomationSettingsForCapture(
            scopeId,
          ),
        ]);
        if (!run) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        if (!settings.automationEnabled) {
          throw new Error("AUTOMATION_SWITCH_DISABLED");
        }
        const remainingTaskCount = tasks.filter(
          (task) =>
            task.status === "waiting_user" ||
            (task.status === "capturing" &&
              task.assignedTo === principal.userId),
        ).length;
        if (tasks.length === 0 || remainingTaskCount === 0) {
          throw new Error("AUTOMATION_BATCH_NO_TASKS");
        }
        const issuedAt = now();
        const expiresAt = new Date(
          Date.parse(issuedAt) + AUTOMATION_BATCH_TOKEN_TTL_MS,
        ).toISOString();
        const issued = options.automationBatchTokens.issue({
          systemInstanceId: options.systemInstanceId,
          scopeId,
          runId,
          userId: principal.userId,
          audienceOrigin: publicOrigin,
          issuedAt,
          expiresAt,
        });
        writeJson(
          response,
          201,
          standaloneCreateAutomationBatchResponseSchema.parse({
            status: "ready",
            run_id: run.id,
            total_task_count: tasks.length,
            remaining_task_count: remainingTaskCount,
            token_expires_at: expiresAt,
            batch_handoff_code: createExtensionBatchHandoffCode({
              apiOrigin: publicOrigin,
              runId: run.id,
              batchToken: issued.token,
              tokenExpiresAt: expiresAt,
            }),
          }),
        );
        return true;
      }

      if (taskListMatch && request.method === "GET") {
        const session = await requireSession(request, options.localAccess);
        const principal = toPrincipal(session.user);
        requireScope(principal, taskListMatch[1]!);
        const run = await options.observations.findRunById(
          taskListMatch[1]!,
          taskListMatch[2]!,
        );
        if (!run) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        const [tasks, snapshot] = await Promise.all([
          options.observations.listTasksForRun(run.scopeId, run.id),
          options.snapshots.findById(run.scopeId, run.querySetSnapshotId),
        ]);
        if (!snapshot) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        writeJson(
          response,
          200,
          standaloneConsumerTaskListResponseSchema.parse({
            tasks: tasks.map((task) =>
              toTaskResponse(
                task,
                snapshot.items.find(
                  (item) => item.id === task.querySnapshotItemId,
                )?.queryText,
                run.experimentKind,
              ),
            ),
          }),
        );
        return true;
      }

      if (taskPreviewMatch && request.method === "GET") {
        const session = await requireSession(request, options.localAccess);
        const principal = toPrincipal(session.user);
        const scopeId = taskPreviewMatch[1]!;
        const runId = taskPreviewMatch[2]!;
        const taskId = taskPreviewMatch[3]!;
        requireScope(principal, scopeId);
        const task = await options.observations.findById(scopeId, taskId);
        if (
          !task ||
          task.runId !== runId ||
          (task.status !== "needs_review" && task.status !== "confirmed") ||
          !task.captureArtifactId
        ) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        const artifact = await options.captureArtifacts.findById(
          scopeId,
          task.captureArtifactId,
        );
        if (
          !artifact ||
          !isConsumerCaptureEvidenceArtifact(artifact) ||
          artifact.observationTaskId !== task.id
        ) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        assertConsumerCaptureEvidenceArtifactIntegrity(artifact);
        writeJson(
          response,
          200,
          standaloneConsumerTaskPreviewResponseSchema.parse({
            task_id: task.id,
            task_version: task.version,
            status: task.status,
            answer_text: artifact.answerText,
            visible_citations: artifact.visibleCitations.map((citation) => ({
              url: citation.url,
              label: citation.label,
              position: citation.position,
              observed_url: citation.observedUrl,
              resolution: citation.resolution,
            })),
            visible_metadata: {
              product_label: artifact.visibleMetadata.productLabel,
              surface_model_label: artifact.visibleMetadata.surfaceModelLabel,
              search_mode: artifact.visibleMetadata.searchMode,
              is_new_conversation: artifact.visibleMetadata.isNewConversation,
              is_logged_in: artifact.visibleMetadata.isLoggedIn,
              locale: artifact.visibleMetadata.locale,
              region: artifact.visibleMetadata.region,
              observed_at: artifact.visibleMetadata.observedAt,
            },
            screenshot_evidence_saved: true,
          }),
        );
        return true;
      }

      if (automationBatchNextRequest && request.method === "POST") {
        const input = standaloneAutomationBatchNextInputSchema.parse(
          await readJson(request),
        );
        const claims = await options.automationBatchTokens.verify(
          input.batch_token,
        );
        const occurredAt = now();
        if (
          claims.systemInstanceId !== options.systemInstanceId ||
          claims.audienceOrigin !== publicOrigin ||
          Date.parse(claims.issuedAt) > Date.parse(occurredAt) ||
          Date.parse(claims.expiresAt) <= Date.parse(occurredAt)
        ) {
          throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
        }
        const principal = createWentianPrincipal({
          userId: claims.userId,
          role: "analyst",
          allowedScopeIds: [claims.scopeId],
        });
        const [run, tasks, settings] = await Promise.all([
          options.observations.findRunById(claims.scopeId, claims.runId),
          options.observations.listTasksForRun(claims.scopeId, claims.runId),
          options.automationSettings.getConsumerAutomationSettingsForCapture(
            claims.scopeId,
          ),
        ]);
        if (!run || tasks.length === 0) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        if (!settings.automationEnabled) {
          throw new Error("AUTOMATION_SWITCH_DISABLED");
        }
        const currentTask = tasks.find(
          (task) =>
            task.status === "capturing" && task.assignedTo === principal.userId,
        );
        const waitingTask = tasks.find(
          (task) => task.status === "waiting_user",
        );
        const task = currentTask ?? waitingTask;
        const completedTaskCount = tasks.filter(
          (item) =>
            item.status !== "waiting_user" && item.status !== "capturing",
        ).length;
        if (!task) {
          if (tasks.some((item) => item.status === "capturing")) {
            throw new Error("AUTOMATION_BATCH_TASK_BUSY");
          }
          writeCorsJson(
            response,
            200,
            standaloneAutomationBatchNextResponseSchema.parse({
              status: "complete",
              run_id: run.id,
              total_task_count: tasks.length,
              completed_task_count: completedTaskCount,
              remaining_task_count: 0,
            }),
          );
          return true;
        }
        const claim = await claimTaskForPrincipal(principal, task);
        const remainingTaskCount = tasks.filter(
          (item) => item.status === "waiting_user" && item.id !== task.id,
        ).length;
        writeCorsJson(
          response,
          200,
          standaloneAutomationBatchNextResponseSchema.parse({
            status: "task_ready",
            run_id: run.id,
            total_task_count: tasks.length,
            completed_task_count: completedTaskCount,
            remaining_task_count: remainingTaskCount,
            claim,
          }),
        );
        return true;
      }

      const claimMatch = path.match(
        /^\/api\/v1\/ai-visibility\/consumer-observations\/tasks\/([0-9a-f-]{36})\/claim$/,
      );
      if (claimMatch && request.method === "POST") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        await assertEmptyJson(request);
        const principal = toPrincipal(session.user);
        const existing = await findTaskInAllowedScopes(
          options.observations,
          principal,
          claimMatch[1]!,
        );
        writeJson(
          response,
          200,
          await claimTaskForPrincipal(principal, existing),
        );
        return true;
      }

      if (automationPreflightMatch && request.method === "POST") {
        const input = standaloneAutomationPreflightInputSchema.parse(
          await readJson(request),
        );
        const result = await automationPreflight.execute({
          taskId: automationPreflightMatch[1]!,
          taskVersion: input.task_version,
          captureToken: input.capture_token,
        });
        writeCorsJson(
          response,
          200,
          standaloneAutomationPreflightResponseSchema.parse({
            status: "ready",
            task_id: result.taskId,
            task_version: result.taskVersion,
            surface_code: result.surfaceCode,
            prompt: result.prompt,
            expected_page_origin: result.expectedPageOrigin,
            page_signature_version: result.pageSignatureVersion,
            token_expires_at: result.tokenExpiresAt,
            review_required: true,
          }),
        );
        return true;
      }

      if (captureMatch && request.method === "POST") {
        const input = standaloneBrowserCaptureUploadSchema.parse(
          await readJson(request),
        );
        const claims = await options.captureTokens.verify(input.capture_token);
        if (claims.taskId !== captureMatch[1]) {
          throw new Error("CAPTURE_TOKEN_TASK_MISMATCH");
        }
        const principal = createWentianPrincipal({
          userId: claims.userId,
          role: "analyst",
          allowedScopeIds: [claims.scopeId],
        });
        const task = await options.observations.findById(
          claims.scopeId,
          claims.taskId,
        );
        if (!task) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        const run = await options.observations.findRunById(
          task.scopeId,
          task.runId,
        );
        const surface = run
          ? await options.surfaces.findById(run.surfaceProfileVersionId)
          : null;
        const manifest = surface
          ? getConsumerWebSurface(surface.surfaceCode)
          : null;
        if (!run || !surface || !manifest) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        if (input.draft.surface_code !== surface.surfaceCode) {
          throw new Error("CAPTURE_SURFACE_MISMATCH");
        }
        const capturedAt = now();
        const assetId = newId();
        const artifactId = newId();
        const screenshotBytes = decodePngDataUrl(
          input.draft.screenshot.data_url,
        );
        let storedObjectKey: string | null = null;
        let mediaCreated = false;
        try {
          const stored = await options.objects.putScreenshot({
            scopeId: task.scopeId,
            assetId,
            bytes: screenshotBytes,
            observedAt: input.draft.visible_metadata.observed_at,
          });
          storedObjectKey = stored.objectKey;
          await options.mediaAssets.create({
            id: assetId,
            scopeId: task.scopeId,
            objectKey: stored.objectKey,
            contentType: "image/png",
            byteSize: stored.byteSize,
            sha256: stored.sha256,
            retentionClass: "pending_24h",
            expiresAt: new Date(
              Date.parse(capturedAt) + 24 * 60 * 60 * 1_000,
            ).toISOString(),
            createdBy: claims.userId,
            createdAt: capturedAt,
          });
          mediaCreated = true;
          const submission = adaptConfirmedBrowserCaptureDraftToSubmission(
            input.draft,
            {
              task_version: input.task_version,
              screenshot_media_asset_id: assetId,
              adapter_version: manifest.adapterVersion,
              reviewed_session_metadata: input.reviewed_session_metadata,
            },
          );
          const artifact = createConsumerCaptureEvidenceArtifact({
            id: artifactId,
            scopeId: task.scopeId,
            observationTaskId: task.id,
            capturedBy: claims.userId,
            collectionMethod: submission.collection_method,
            answerText: submission.answer_text,
            visibleCitations: submission.visible_citations.map((citation) => ({
              url: citation.url,
              label: citation.label,
              position: citation.position,
              observedUrl: citation.observed_url,
              resolution: citation.resolution,
            })),
            visibleMetadata: {
              productLabel: submission.visible_metadata.product_label,
              surfaceModelLabel:
                submission.visible_metadata.surface_model_label,
              searchMode: submission.visible_metadata.search_mode,
              isNewConversation:
                submission.visible_metadata.is_new_conversation,
              isLoggedIn: submission.visible_metadata.is_logged_in,
              memoryEnabled: submission.visible_metadata.memory_enabled,
              personalizationEnabled:
                submission.visible_metadata.personalization_enabled,
              locale: submission.visible_metadata.locale,
              region: submission.visible_metadata.region,
              observedAt: submission.visible_metadata.observed_at,
            },
            screenshotMediaAssetId: assetId,
            adapterVersion: manifest.adapterVersion,
            createdAt: capturedAt,
          });
          const savedTask = await workflow.submitCapture(principal, {
            scopeId: task.scopeId,
            taskId: task.id,
            taskVersion: input.task_version,
            occurredAt: capturedAt,
            captureToken: input.capture_token,
            requestOrigin: publicOrigin,
            artifact,
          });
          writeCorsJson(
            response,
            202,
            standaloneCaptureUploadResponseSchema.parse({
              task_id: savedTask.id,
              task_version: savedTask.version,
              status: savedTask.status,
              capture_artifact_id: artifactId,
              screenshot_media_asset_id: assetId,
            }),
          );
        } catch (error) {
          if (mediaCreated) {
            await options.mediaAssets
              .purge(task.scopeId, assetId)
              .catch(() => false);
          } else if (storedObjectKey) {
            await options.objects
              .deleteObject(storedObjectKey)
              .catch(() => undefined);
          }
          throw error;
        }
        return true;
      }

      const terminalMatch = path.match(
        /^\/api\/v1\/ai-visibility\/consumer-observations\/tasks\/([0-9a-f-]{36})\/(confirm|reject)$/,
      );
      if (terminalMatch && request.method === "POST") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        const principal = toPrincipal(session.user);
        const task = await findTaskInAllowedScopes(
          options.observations,
          principal,
          terminalMatch[1]!,
        );
        const occurredAt = now();
        if (terminalMatch[2] === "confirm") {
          const input = standaloneConfirmTaskInputSchema.parse(
            await readJson(request),
          );
          const result = await confirm.execute(principal, {
            scopeId: task.scopeId,
            taskId: task.id,
            taskVersion: input.task_version,
            occurredAt,
          });
          await reconcile.execute({
            scopeId: task.scopeId,
            runId: task.runId,
            occurredAt,
          });
          const confirmedRun = await options.observations.findRunById(
            task.scopeId,
            task.runId,
          );
          if (confirmedRun?.experimentKind === "source_nomination") {
            await createNominationReview.execute(principal, {
              scopeId: task.scopeId,
              responseId: result.record.id,
            });
          }
          writeJson(
            response,
            200,
            standaloneTerminalTaskResponseSchema.parse({
              task_id: result.task.id,
              task_version: result.task.version,
              status: result.task.status,
              confirmed_response_id: result.record.id,
              evidence_grade: result.evidenceGrade,
            }),
          );
        } else {
          const input = standaloneRejectTaskInputSchema.parse(
            await readJson(request),
          );
          const result = await workflow.reject(principal, {
            scopeId: task.scopeId,
            taskId: task.id,
            taskVersion: input.task_version,
            occurredAt,
            rejectionReason: input.rejection_reason,
          });
          await reconcile.execute({
            scopeId: task.scopeId,
            runId: task.runId,
            occurredAt,
          });
          writeJson(
            response,
            200,
            standaloneTerminalTaskResponseSchema.parse({
              task_id: result.task.id,
              task_version: result.task.version,
              status: result.task.status,
            }),
          );
        }
        return true;
      }

      const createNominationReviewMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/responses\/([0-9a-f-]{36})\/nomination-review$/,
      );
      if (createNominationReviewMatch && request.method === "POST") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        await assertEmptyJson(request);
        const result = await createNominationReview.execute(
          toPrincipal(session.user),
          {
            scopeId: createNominationReviewMatch[1]!,
            responseId: createNominationReviewMatch[2]!,
          },
        );
        writeJson(
          response,
          result.created ? 201 : 200,
          standaloneCreateNominationReviewResponseSchema.parse({
            review: toNominationReviewResponse(result.review),
            created: result.created,
            extraction_status: result.extractionStatus,
            warning: result.warning,
          }),
        );
        return true;
      }

      const nominationReviewListMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})\/nomination-reviews$/,
      );
      if (nominationReviewListMatch && request.method === "GET") {
        const session = await requireSession(request, options.localAccess);
        const principal = toPrincipal(session.user);
        requireScope(principal, nominationReviewListMatch[1]!);
        const run = await options.observations.findRunById(
          nominationReviewListMatch[1]!,
          nominationReviewListMatch[2]!,
        );
        if (!run || run.experimentKind !== "source_nomination") {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        const records = options.observations.listSampleReferencesByRun
          ? await options.observations.listSampleReferencesByRun(
              run.scopeId,
              run.id,
            )
          : await options.observations.listByRun(run.scopeId, run.id);
        const reviews = (
          await Promise.all(
            records.map((record) =>
              options.nominationReviews.findByResponseId(
                record.scopeId,
                record.id,
              ),
            ),
          )
        ).filter((review) => review !== null);
        writeJson(
          response,
          200,
          standaloneNominationReviewListResponseSchema.parse({
            reviews: reviews.map(toNominationReviewResponse),
          }),
        );
        return true;
      }

      const nominationReviewTerminalMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/nomination-reviews\/([0-9a-f-]{36})\/(confirm|reject)$/,
      );
      if (nominationReviewTerminalMatch && request.method === "POST") {
        const session = await requireAuthenticatedWrite(
          request,
          options.localAccess,
          publicOrigin,
        );
        const principal = toPrincipal(session.user);
        if (nominationReviewTerminalMatch[3] === "confirm") {
          const input = standaloneConfirmNominationReviewInputSchema.parse(
            await readJson(request),
          );
          const result = await confirmNominationReview.execute(principal, {
            scopeId: nominationReviewTerminalMatch[1]!,
            reviewId: nominationReviewTerminalMatch[2]!,
            reviewVersion: input.review_version,
            reviewedItems: input.reviewed_items.map((item) => ({
              registrableDomain: item.registrable_domain,
              position: item.position,
              informationType: item.information_type,
              reason: item.reason,
            })),
            occurredAt: now(),
          });
          writeJson(
            response,
            200,
            standaloneNominationReviewSchema.parse(
              toNominationReviewResponse(result.review),
            ),
          );
        } else {
          const input = standaloneRejectNominationReviewInputSchema.parse(
            await readJson(request),
          );
          const review = await rejectNominationReview.execute(principal, {
            scopeId: nominationReviewTerminalMatch[1]!,
            reviewId: nominationReviewTerminalMatch[2]!,
            reviewVersion: input.review_version,
            rejectionReason: input.rejection_reason,
            occurredAt: now(),
          });
          writeJson(
            response,
            200,
            standaloneNominationReviewSchema.parse(
              toNominationReviewResponse(review),
            ),
          );
        }
        return true;
      }

      const comparisonMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/comparisons\/nomination-citation$/,
      );
      if (comparisonMatch && request.method === "GET") {
        const session = await requireSession(request, options.localAccess);
        const principal = toPrincipal(session.user);
        const naturalAnswerRunId = requestUrl.searchParams.get(
          "natural_answer_run_id",
        );
        const sourceNominationRunId = requestUrl.searchParams.get(
          "source_nomination_run_id",
        );
        if (!naturalAnswerRunId || !sourceNominationRunId) {
          throw new Error("COMPARISON_RUN_IDS_REQUIRED");
        }
        const parsedK = Number(requestUrl.searchParams.get("k") ?? "10");
        const report = await compareNominationCitation.execute(principal, {
          scopeId: comparisonMatch[1]!,
          naturalAnswerRunId,
          sourceNominationRunId,
          k: parsedK,
        });
        writeJson(
          response,
          200,
          adaptConsumerNominationCitationComparisonToResponse(report),
        );
        return true;
      }

      const rankingMatch = path.match(
        /^\/api\/v1\/scopes\/([0-9a-f-]{36})\/runs\/([0-9a-f-]{36})\/source-ranking$/,
      );
      if (rankingMatch && request.method === "GET") {
        const session = await requireSession(request, options.localAccess);
        const principal = toPrincipal(session.user);
        requireScope(principal, rankingMatch[1]!);
        const querySnapshotItemId = requestUrl.searchParams.get(
          "query_snapshot_item_id",
        );
        if (!querySnapshotItemId) {
          throw new Error("QUERY_SNAPSHOT_ITEM_ID_REQUIRED");
        }
        const run = await options.observations.findRunById(
          rankingMatch[1]!,
          rankingMatch[2]!,
        );
        if (!run) {
          throw new Error("RESOURCE_NOT_FOUND");
        }
        if (run.experimentKind !== "natural_answer") {
          throw new Error("SOURCE_RANKING_NATURAL_ANSWER_REQUIRED");
        }
        const records = options.observations.listSampleReferencesByRun
          ? await options.observations.listSampleReferencesByRun(
              run.scopeId,
              run.id,
            )
          : await options.observations.listByRun(run.scopeId, run.id);
        const events = (
          await Promise.all(
            records
              .filter(
                (record) => record.querySnapshotItemId === querySnapshotItemId,
              )
              .map((record) =>
                options.observations.listByResponse(run.scopeId, record.id),
              ),
          )
        ).flat();
        const ranking = rankSourceEntriesByDomain({
          querySnapshotItemId,
          role: "cited",
          entries: events.map((event) => ({
            entryId: event.id,
            querySnapshotItemId: event.querySnapshotItemId,
            role: "cited",
            registrableDomain: event.registrableDomain,
          })),
        });
        writeJson(
          response,
          200,
          standaloneSourceRankingResponseSchema.parse({
            run_id: run.id,
            scope_id: run.scopeId,
            query_snapshot_item_id: querySnapshotItemId,
            experiment_kind: run.experimentKind,
            total_formal_source_entries: ranking.totalEntryCount,
            ranking: ranking.domains.map((domain) => ({
              rank: domain.rank,
              registrable_domain: domain.registrableDomain,
              display_origin: selectDisplayOrigin(
                events,
                domain.registrableDomain,
              ),
              formal_source_entry_count: domain.entryCount,
            })),
            evidence_warning:
              "仅统计已确认回答中的正式可见信源条目，不代表隐藏抓取频率或平台内部权重。",
          }),
        );
        return true;
      }

      return false;
    } catch (error) {
      writeConsumerError(response, error, browserExtensionRequest);
      return true;
    }
  };
}

function selectDisplayOrigin(
  events: readonly {
    readonly originalUrl: string;
    readonly registrableDomain: string;
  }[],
  registrableDomain: string,
): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.registrableDomain !== registrableDomain) continue;
    const origin = new URL(event.originalUrl).origin;
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  const selected = [...counts.entries()].sort(
    ([leftOrigin, leftCount], [rightOrigin, rightCount]) =>
      rightCount - leftCount ||
      Number(rightOrigin.startsWith("https://")) -
        Number(leftOrigin.startsWith("https://")) ||
      leftOrigin.localeCompare(rightOrigin),
  )[0]?.[0];
  if (!selected) {
    throw new Error("SOURCE_RANKING_DISPLAY_ORIGIN_REQUIRED");
  }
  return selected;
}

function createExtensionHandoffCode(input: {
  readonly apiOrigin: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly captureToken: string;
  readonly tokenExpiresAt: string;
  readonly reviewedSessionMetadata: {
    readonly surface_model_label: null;
    readonly is_new_conversation: boolean;
    readonly is_logged_in: boolean;
    readonly memory_enabled: boolean | null;
    readonly personalization_enabled: boolean | null;
    readonly locale: string;
    readonly region: string | null;
  };
}): string {
  return Buffer.from(
    JSON.stringify({
      version: EXTENSION_HANDOFF_VERSION,
      api_origin: input.apiOrigin,
      task_id: input.taskId,
      task_version: input.taskVersion,
      capture_token: input.captureToken,
      token_expires_at: input.tokenExpiresAt,
      reviewed_session_metadata: input.reviewedSessionMetadata,
    }),
    "utf8",
  ).toString("base64url");
}

function createExtensionBatchHandoffCode(input: {
  readonly apiOrigin: string;
  readonly runId: string;
  readonly batchToken: string;
  readonly tokenExpiresAt: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      version: EXTENSION_BATCH_HANDOFF_VERSION,
      api_origin: input.apiOrigin,
      run_id: input.runId,
      batch_token: input.batchToken,
      token_expires_at: input.tokenExpiresAt,
    }),
    "utf8",
  ).toString("base64url");
}

async function findTaskInAllowedScopes(
  tasks: ConsumerObservationTaskRepository,
  principal: WentianPrincipal,
  taskId: string,
) {
  for (const scopeId of principal.allowedScopeIds) {
    const task = await tasks.findById(scopeId, taskId);
    if (task) {
      return task;
    }
  }
  throw new Error("RESOURCE_NOT_FOUND");
}

function toTaskResponse(
  task: Awaited<ReturnType<ConsumerObservationTaskRepository["findById"]>> & {},
  queryText: string | undefined,
  experimentKind: "natural_answer" | "source_nomination",
) {
  if (!queryText) {
    throw new Error("QUERY_SNAPSHOT_ITEM_NOT_FOUND");
  }
  return {
    id: task.id,
    scope_id: task.scopeId,
    run_id: task.runId,
    query_snapshot_item_id: task.querySnapshotItemId,
    query_text: buildConsumerExperimentPrompt(queryText, experimentKind),
    sample_index: task.sampleIndex,
    status: task.status,
    task_version: task.version,
    collection_method: task.collectionMethod,
    capture_artifact_id: task.captureArtifactId,
    confirmed_response_id: task.confirmedResponseId,
    updated_at: task.updatedAt,
  };
}

function toNominationReviewResponse(review: SourceNominationParseReview) {
  return {
    id: review.id,
    scope_id: review.scopeId,
    response_id: review.responseId,
    proposed_items: review.proposedItems.map((item) => ({
      registrable_domain: item.registrableDomain,
      position: item.position,
      information_type: item.informationType,
      reason: item.reason,
    })),
    extraction_version: review.extractionVersion,
    valid_explicit_occurrence_count: review.validExplicitOccurrenceCount,
    rejected_explicit_occurrence_count: review.rejectedExplicitOccurrenceCount,
    extraction_truncated: review.extractionTruncated,
    status: review.status,
    rejection_reason: review.rejectionReason,
    version: review.version,
    created_at: review.createdAt,
    updated_at: review.updatedAt,
  };
}

function toPrincipal(user: AuthenticatedLocalUser): WentianPrincipal {
  return createWentianPrincipal({
    userId: user.id,
    role: user.authorizationRole ?? user.instanceRole ?? "viewer",
    allowedScopeIds: user.allowedScopeIds,
  });
}

function requireScope(principal: WentianPrincipal, scopeId: string): void {
  if (!principal.allowedScopeIds.includes(scopeId)) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
}

async function requireAuthenticatedWrite(
  request: IncomingMessage,
  service: LocalAccessApiService,
  publicOrigin: string,
): Promise<LocalSessionResult> {
  if (request.headers.origin !== publicOrigin) {
    throw new Error("REQUEST_ORIGIN_INVALID");
  }
  const session = await requireSession(request, service);
  const csrf = request.headers["x-wentian-csrf-token"];
  if (
    typeof csrf !== "string" ||
    !service.verifyCsrfToken(session.sessionToken, csrf)
  ) {
    throw new Error("CSRF_TOKEN_INVALID");
  }
  return session;
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

async function assertEmptyJson(request: IncomingMessage): Promise<void> {
  const body = await readJson(request);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  ) {
    throw new Error("INVALID_REQUEST");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const type = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (type !== "application/json") {
    throw new Error("JSON_CONTENT_TYPE_REQUIRED");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > JSON_BODY_LIMIT) {
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

function decodePngDataUrl(value: string): Buffer {
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) {
    throw new Error("INVALID_SCREENSHOT_PNG");
  }
  const bytes = Buffer.from(value.slice(prefix.length), "base64");
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes.subarray(1, 4).toString("ascii") !== "PNG"
  ) {
    throw new Error("INVALID_SCREENSHOT_PNG");
  }
  return bytes;
}

function toGeneratorVersion(
  snapshot: QuerySetSnapshot,
): "industry-question-generator@1" | null {
  return snapshot.source.type === "local" &&
    snapshot.source.ref === "industry-question-generator" &&
    snapshot.source.revision === "1"
    ? "industry-question-generator@1"
    : null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      return separator < 1
        ? []
        : [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
    }),
  );
}

function writeConsumerError(
  response: ServerResponse,
  error: unknown,
  cors: boolean,
): void {
  const rawCode =
    error instanceof Error && error.name === "ZodError"
      ? "INVALID_REQUEST"
      : error instanceof Error
        ? error.message
        : "INTERNAL_ERROR";
  const databaseCode = (error as { readonly code?: string })?.code;
  const code = databaseCode === "23505" ? "RESOURCE_CONFLICT" : rawCode;
  const status =
    code === "LOCAL_SESSION_INVALID" ||
    code === "CAPTURE_TOKEN_INVALID" ||
    code === "AUTOMATION_BATCH_TOKEN_INVALID"
      ? 401
      : code === "ACTION_FORBIDDEN" ||
          code === "CSRF_TOKEN_INVALID" ||
          code === "REQUEST_ORIGIN_INVALID" ||
          code === "AUTOMATION_SWITCH_DISABLED" ||
          code === "SURFACE_NOT_ACTIVE" ||
          code === "ADAPTER_AUTOMATION_UNSUPPORTED" ||
          code === "REGION_NOT_ALLOWED" ||
          code === "PRODUCTION_AUTHORIZATION_REQUIRED" ||
          code === "PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED" ||
          code === "PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH" ||
          code === "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED" ||
          code === "PRODUCTION_AUTHORIZATION_REVIEW_INVALID" ||
          code === "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED"
        ? 403
        : code === "RESOURCE_NOT_FOUND"
          ? 404
          : code.includes("VERSION_CONFLICT") ||
              code === "RESOURCE_CONFLICT" ||
              code === "CAPTURE_TOKEN_ALREADY_CONSUMED" ||
              code === "DOUBAO_AUTOMATION_TASK_INCOMPATIBLE" ||
              code === "OBSERVATION_TASK_NOT_CAPTURING" ||
              code === "AUTOMATION_BATCH_NO_TASKS" ||
              code === "AUTOMATION_BATCH_TASK_BUSY" ||
              code === "CONSUMER_OBSERVATION_RUN_NOT_DELETABLE" ||
              code === "SCOPE_NOT_ACTIVE"
            ? 409
            : code === "REQUEST_BODY_TOO_LARGE"
              ? 413
              : code.startsWith("INVALID_") ||
                  code.endsWith("_REQUIRED") ||
                  code.includes("MISMATCH") ||
                  code === "JSON_CONTENT_TYPE_REQUIRED"
                ? 400
                : 500;
  const body = { error: status === 500 ? "INTERNAL_ERROR" : code };
  if (status === 500) {
    process.stderr.write(
      `standalone-consumer-api error: ${error instanceof Error ? `${error.name}:${error.message}` : "unknown"}\n`,
    );
  }
  if (cors) {
    writeCorsJson(response, status, body);
  } else {
    writeJson(response, status, body);
  }
}

function writeCorsPreflight(response: ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "cache-control": "no-store",
  });
  response.end();
}

function writeCorsJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
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
