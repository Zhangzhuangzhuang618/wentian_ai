import {
  assertCaptureTokenUsable,
  type CaptureTokenVerifier,
  type ConsumerObservationRunRepository,
  type ConsumerObservationTaskRepository,
  type ConsumerSurfaceProfileVersionRepository,
  type QuerySetSnapshotRepository,
} from "@wentian/application";
import {
  DOUBAO_WEB_ADAPTER_MANIFEST,
  preflightDoubaoPromptAutomation,
} from "@wentian/consumer-doubao-web";
import {
  QIANWEN_WEB_ADAPTER_MANIFEST,
  preflightQianwenPromptAutomation,
} from "@wentian/consumer-qianwen-web";

import type {
  DoubaoAutomationRuntime,
  QianwenAutomationRuntime,
} from "./doubao-automation-runtime.ts";

export interface ConsumerAutomationSettingsReader {
  getConsumerAutomationSettingsForCapture(scopeId: string): Promise<{
    readonly automationEnabled: boolean;
    readonly allowedUsageRegion: "CN_MAINLAND";
  }>;
}

export interface DoubaoAutomationPreflightDependencies {
  readonly systemInstanceId: string;
  readonly publicOrigin: string;
  readonly captureTokens: CaptureTokenVerifier;
  readonly tasks: ConsumerObservationTaskRepository &
    ConsumerObservationRunRepository;
  readonly snapshots: QuerySetSnapshotRepository;
  readonly surfaces: ConsumerSurfaceProfileVersionRepository;
  readonly settings: ConsumerAutomationSettingsReader;
  readonly runtime: DoubaoAutomationRuntime;
  readonly qianwenRuntime?: QianwenAutomationRuntime;
  readonly now?: () => string;
}

export class DoubaoAutomationPreflightService {
  private readonly dependencies: DoubaoAutomationPreflightDependencies;

  constructor(dependencies: DoubaoAutomationPreflightDependencies) {
    this.dependencies = dependencies;
  }

  async execute(input: {
    readonly taskId: string;
    readonly taskVersion: number;
    readonly captureToken: string;
  }) {
    const claims = await this.dependencies.captureTokens.verify(
      input.captureToken,
    );
    if (claims.taskId !== input.taskId) {
      throw new Error("CAPTURE_TOKEN_TASK_MISMATCH");
    }
    const occurredAt = (
      this.dependencies.now ?? (() => new Date().toISOString())
    )();
    assertCaptureTokenUsable(claims, {
      systemInstanceId: this.dependencies.systemInstanceId,
      scopeId: claims.scopeId,
      taskId: claims.taskId,
      userId: claims.userId,
      requestOrigin: new URL(this.dependencies.publicOrigin).origin,
      now: occurredAt,
      alreadyConsumed: false,
    });
    const task = await this.dependencies.tasks.findById(
      claims.scopeId,
      claims.taskId,
    );
    if (!task) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    if (task.version !== input.taskVersion) {
      throw new Error("TASK_VERSION_CONFLICT");
    }
    if (task.status !== "capturing" || task.assignedTo !== claims.userId) {
      throw new Error("OBSERVATION_TASK_NOT_CAPTURING");
    }

    const run = await this.dependencies.tasks.findRunById(
      task.scopeId,
      task.runId,
    );
    const snapshot = run
      ? await this.dependencies.snapshots.findById(
          task.scopeId,
          run.querySetSnapshotId,
        )
      : null;
    const query = snapshot?.items.find(
      (item) => item.id === task.querySnapshotItemId,
    );
    const surface = run
      ? await this.dependencies.surfaces.findById(run.surfaceProfileVersionId)
      : null;
    if (!run || !snapshot || !query || !surface) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    if (
      run.collectionMethod !== "browser_assisted" ||
      surface.status !== "active"
    ) {
      throw new Error("CONSUMER_WEB_AUTOMATION_TASK_INCOMPATIBLE");
    }
    const manifest =
      surface.surfaceCode === "doubao_web"
        ? DOUBAO_WEB_ADAPTER_MANIFEST
        : surface.surfaceCode === "qianwen_web"
          ? QIANWEN_WEB_ADAPTER_MANIFEST
          : null;
    if (!manifest) {
      throw new Error("CONSUMER_WEB_AUTOMATION_TASK_INCOMPATIBLE");
    }
    const runtime =
      manifest.surfaceCode === "qianwen_web"
        ? (this.dependencies.qianwenRuntime ??
          Object.freeze({
            environment: "production",
            currentRegion: "CN_MAINLAND",
            authorizationBasis: "none",
            authorizationEvidenceId: null,
            authorizationReviewedAt: null,
          }))
        : this.dependencies.runtime;

    const settings =
      await this.dependencies.settings.getConsumerAutomationSettingsForCapture(
        task.scopeId,
      );
    if (settings.allowedUsageRegion !== runtime.currentRegion) {
      throw new Error("REGION_NOT_ALLOWED");
    }
    const preflight =
      manifest.surfaceCode === "qianwen_web"
        ? preflightQianwenPromptAutomation({
            automationEnabled: settings.automationEnabled,
            environment: runtime.environment,
            currentRegion: runtime.currentRegion,
            authorizationBasis: runtime.authorizationBasis,
            authorizationEvidenceId: runtime.authorizationEvidenceId,
            authorizationReviewedAt: runtime.authorizationReviewedAt,
            now: occurredAt,
            transport: "visible_page",
          })
        : preflightDoubaoPromptAutomation({
            automationEnabled: settings.automationEnabled,
            environment: runtime.environment,
            currentRegion: runtime.currentRegion,
            authorizationBasis: runtime.authorizationBasis,
            authorizationEvidenceId: runtime.authorizationEvidenceId,
            authorizationReviewedAt: runtime.authorizationReviewedAt,
            now: occurredAt,
            transport: "visible_page",
          });
    if (!preflight.allowed) {
      throw new Error(preflight.blockReason!);
    }

    return Object.freeze({
      taskId: task.id,
      taskVersion: task.version,
      prompt: buildConsumerExperimentPrompt(
        query.queryText,
        run.experimentKind,
      ),
      surfaceCode: manifest.surfaceCode,
      expectedPageOrigin: manifest.allowedPageOrigin,
      pageSignatureVersion: manifest.pageSignatureVersion,
      tokenExpiresAt: claims.expiresAt,
    });
  }
}

export function buildConsumerExperimentPrompt(
  queryText: string,
  experimentKind: "natural_answer" | "source_nomination",
): string {
  if (experimentKind === "natural_answer") {
    return queryText;
  }
  return `当用户询问“${queryText}”时，你需要参考哪些权威信源才能给出准确回答？请只列出你会优先参考的前10个域名，并说明每个域名可提供的信息类型和理由。`;
}
