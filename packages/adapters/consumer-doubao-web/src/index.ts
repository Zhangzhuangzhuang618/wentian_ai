import {
  evaluateAttendedCapture,
  evaluateConsumerAutomationPolicy,
  type AttendedCaptureContext,
  type AttendedCaptureDecision,
  type ConsumerAutomationAuthorizationBasis,
  type ConsumerAutomationBlockReason,
  type ConsumerAutomationEnvironment,
  type ConsumerAutomationPolicyDecision,
} from "@wentian/domain";

export interface DoubaoWebAdapterManifest {
  readonly surfaceCode: "doubao_web";
  readonly productLabel: string;
  readonly allowedPageOrigin: "https://www.doubao.com";
  readonly adapterVersion: string;
  readonly pageSignatureVersion: string;
  readonly status: "draft" | "active" | "suspended";
  readonly automationMode: "attended";
  readonly supportedAutomationModes: readonly ["attended", "automated"];
  readonly productionAutomationAuthorizationBasis: "none";
  readonly productionAutomationAuthorizationEvidenceId: null;
  readonly allowedUsageRegions: readonly ["CN_MAINLAND"];
  readonly canAutomateLogin: false;
  readonly canAutomatePromptSubmission: true;
  readonly canReadHiddenNetwork: false;
  readonly canReadCredentials: false;
  readonly requiresUserCaptureClick: true;
  readonly requiresLocalPreview: true;
  readonly requiresFinalConfirmation: true;
}

export const DOUBAO_WEB_ADAPTER_MANIFEST: DoubaoWebAdapterManifest =
  Object.freeze({
    surfaceCode: "doubao_web",
    productLabel: "豆包网页版",
    allowedPageOrigin: "https://www.doubao.com",
    adapterVersion: "doubao-web@1-attended",
    pageSignatureVersion: "doubao-web-signature@7-visible-search-trace",
    status: "active",
    automationMode: "attended",
    supportedAutomationModes: Object.freeze(["attended", "automated"] as const),
    productionAutomationAuthorizationBasis: "none",
    productionAutomationAuthorizationEvidenceId: null,
    allowedUsageRegions: Object.freeze(["CN_MAINLAND"] as const),
    canAutomateLogin: false,
    canAutomatePromptSubmission: true,
    canReadHiddenNetwork: false,
    canReadCredentials: false,
    requiresUserCaptureClick: true,
    requiresLocalPreview: true,
    requiresFinalConfirmation: true,
  });

export type DoubaoCaptureContext = Omit<
  AttendedCaptureContext,
  "expectedSurfaceCode" | "expectedPageOrigin"
>;

export function preflightDoubaoAttendedCapture(
  context: DoubaoCaptureContext,
): AttendedCaptureDecision {
  if (DOUBAO_WEB_ADAPTER_MANIFEST.status !== "active") {
    return Object.freeze({
      allowed: false,
      errorCode: "CAPTURE_ADAPTER_NOT_ACTIVE",
      fallback: "manual_import",
    });
  }
  return evaluateAttendedCapture({
    ...context,
    expectedSurfaceCode: DOUBAO_WEB_ADAPTER_MANIFEST.surfaceCode,
    expectedPageOrigin: DOUBAO_WEB_ADAPTER_MANIFEST.allowedPageOrigin,
  });
}

export function preflightDoubaoAutomationPolicy(input: {
  readonly automationEnabled?: boolean;
  readonly environment: ConsumerAutomationEnvironment;
  readonly currentRegion: string;
  readonly authorizationBasis?: ConsumerAutomationAuthorizationBasis;
  readonly authorizationEvidenceId?: string | null;
}): ConsumerAutomationPolicyDecision {
  return evaluateConsumerAutomationPolicy({
    automationEnabled: input.automationEnabled,
    environment: input.environment,
    surfaceStatus: DOUBAO_WEB_ADAPTER_MANIFEST.status,
    adapterSupportsAutomation:
      DOUBAO_WEB_ADAPTER_MANIFEST.canAutomatePromptSubmission,
    authorizationBasis:
      input.authorizationBasis ??
      DOUBAO_WEB_ADAPTER_MANIFEST.productionAutomationAuthorizationBasis,
    authorizationEvidenceId:
      input.authorizationEvidenceId ??
      DOUBAO_WEB_ADAPTER_MANIFEST.productionAutomationAuthorizationEvidenceId,
    currentRegion: input.currentRegion,
    allowedRegions: DOUBAO_WEB_ADAPTER_MANIFEST.allowedUsageRegions,
  });
}

export interface DoubaoPromptAutomationDriverInput {
  readonly prompt: string;
  readonly expectedPageOrigin: "https://www.doubao.com";
  readonly pageSignatureVersion: string;
}

export interface DoubaoPromptAutomationDriverResult {
  readonly answerText: string;
  readonly visibleCitations: readonly {
    readonly url: string;
    readonly label: string;
    readonly position: number;
  }[];
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly observedAt: string;
  readonly completionStatus: "complete";
  readonly screenshotPngDataUrl: string;
}

export interface DoubaoPromptAutomationDriver {
  readonly transport: "official_interface" | "visible_page";
  execute(
    input: DoubaoPromptAutomationDriverInput,
  ): Promise<DoubaoPromptAutomationDriverResult>;
}

export interface DoubaoPromptAutomationExecutorOptions {
  readonly driver: DoubaoPromptAutomationDriver;
  readonly environment: ConsumerAutomationEnvironment;
  readonly currentRegion: string;
  readonly authorizationBasis?: ConsumerAutomationAuthorizationBasis;
  readonly authorizationEvidenceId?: string | null;
  readonly authorizationReviewedAt?: string | null;
  readonly now?: string;
}

export type DoubaoPromptAutomationPreflight = Readonly<{
  readonly allowed: boolean;
  readonly policy: ConsumerAutomationPolicyDecision;
  readonly blockReason:
    | ConsumerAutomationBlockReason
    | "AUTOMATION_SWITCH_DISABLED"
    | "PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH"
    | "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED"
    | "PRODUCTION_AUTHORIZATION_REVIEW_INVALID"
    | "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED"
    | null;
}>;

export function preflightDoubaoPromptAutomation(input: {
  readonly automationEnabled?: boolean;
  readonly environment: ConsumerAutomationEnvironment;
  readonly currentRegion: string;
  readonly authorizationBasis?: ConsumerAutomationAuthorizationBasis;
  readonly authorizationEvidenceId?: string | null;
  readonly authorizationReviewedAt?: string | null;
  readonly now?: string;
  readonly transport: DoubaoPromptAutomationDriver["transport"];
}): DoubaoPromptAutomationPreflight {
  const policy = preflightDoubaoAutomationPolicy(input);
  if (policy.requestedMode === "attended") {
    return Object.freeze({
      allowed: false,
      policy,
      blockReason: "AUTOMATION_SWITCH_DISABLED",
    });
  }
  if (!policy.allowed) {
    return Object.freeze({
      allowed: false,
      policy,
      blockReason: policy.blockReason!,
    });
  }
  if (
    input.environment === "production" &&
    !authorizationCoversDriver(input.authorizationBasis, input.transport)
  ) {
    return Object.freeze({
      allowed: false,
      policy,
      blockReason: "PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH",
    });
  }
  const reviewBlockReason = evaluateProductionAuthorizationReview({
    environment: input.environment,
    reviewedAt: input.authorizationReviewedAt,
    now: input.now,
  });
  if (reviewBlockReason) {
    return Object.freeze({
      allowed: false,
      policy,
      blockReason: reviewBlockReason,
    });
  }
  return Object.freeze({ allowed: true, policy, blockReason: null });
}

export type DoubaoPromptAutomationExecution =
  | {
      readonly status: "attended_required";
      readonly policy: ConsumerAutomationPolicyDecision;
      readonly blockReason: "AUTOMATION_SWITCH_DISABLED";
      readonly capture: null;
    }
  | {
      readonly status: "blocked";
      readonly policy: ConsumerAutomationPolicyDecision;
      readonly blockReason:
        | ConsumerAutomationBlockReason
        | "PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH"
        | "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED"
        | "PRODUCTION_AUTHORIZATION_REVIEW_INVALID"
        | "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED";
      readonly capture: null;
    }
  | {
      readonly status: "needs_review";
      readonly policy: ConsumerAutomationPolicyDecision;
      readonly blockReason: null;
      readonly capture: Readonly<
        DoubaoPromptAutomationDriverResult & {
          readonly surfaceCode: "doubao_web";
          readonly adapterVersion: string;
          readonly reviewStatus: "needs_review";
        }
      >;
    };

export class DoubaoPromptAutomationExecutor {
  private readonly options: DoubaoPromptAutomationExecutorOptions;

  constructor(options: DoubaoPromptAutomationExecutorOptions) {
    this.options = Object.freeze({ ...options });
  }

  async execute(input: {
    readonly automationEnabled?: boolean;
    readonly prompt: string;
  }): Promise<DoubaoPromptAutomationExecution> {
    const preflight = preflightDoubaoPromptAutomation({
      automationEnabled: input.automationEnabled,
      environment: this.options.environment,
      currentRegion: this.options.currentRegion,
      authorizationBasis: this.options.authorizationBasis,
      authorizationEvidenceId: this.options.authorizationEvidenceId,
      authorizationReviewedAt: this.options.authorizationReviewedAt,
      now: this.options.now,
      transport: this.options.driver.transport,
    });
    if (preflight.blockReason === "AUTOMATION_SWITCH_DISABLED") {
      return Object.freeze({
        status: "attended_required",
        policy: preflight.policy,
        blockReason: "AUTOMATION_SWITCH_DISABLED",
        capture: null,
      });
    }
    if (!preflight.allowed) {
      return Object.freeze({
        status: "blocked",
        policy: preflight.policy,
        blockReason: preflight.blockReason!,
        capture: null,
      });
    }

    const prompt = normalizePrompt(input.prompt);
    const driverResult = await this.options.driver.execute({
      prompt,
      expectedPageOrigin: DOUBAO_WEB_ADAPTER_MANIFEST.allowedPageOrigin,
      pageSignatureVersion: DOUBAO_WEB_ADAPTER_MANIFEST.pageSignatureVersion,
    });
    const capture = normalizeAutomationCapture(driverResult);
    return Object.freeze({
      status: "needs_review",
      policy: preflight.policy,
      blockReason: null,
      capture: Object.freeze({
        ...capture,
        surfaceCode: DOUBAO_WEB_ADAPTER_MANIFEST.surfaceCode,
        adapterVersion: DOUBAO_WEB_ADAPTER_MANIFEST.adapterVersion,
        reviewStatus: "needs_review",
      }),
    });
  }
}

function authorizationCoversDriver(
  authorizationBasis: ConsumerAutomationAuthorizationBasis | undefined,
  transport: DoubaoPromptAutomationDriver["transport"],
): boolean {
  return (
    (transport === "official_interface" &&
      authorizationBasis === "official_interface") ||
    (transport === "visible_page" &&
      authorizationBasis === "written_permission")
  );
}

function evaluateProductionAuthorizationReview(input: {
  readonly environment: ConsumerAutomationEnvironment;
  readonly reviewedAt?: string | null;
  readonly now?: string;
}):
  | "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED"
  | "PRODUCTION_AUTHORIZATION_REVIEW_INVALID"
  | "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED"
  | null {
  if (input.environment !== "production") {
    return null;
  }
  const reviewedAt = input.reviewedAt?.trim();
  if (!reviewedAt) {
    return "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED";
  }
  const reviewedAtMs = Date.parse(reviewedAt);
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  if (
    !Number.isFinite(reviewedAtMs) ||
    !Number.isFinite(nowMs) ||
    new Date(reviewedAtMs).toISOString() !== reviewedAt ||
    reviewedAtMs > nowMs
  ) {
    return "PRODUCTION_AUTHORIZATION_REVIEW_INVALID";
  }
  if (nowMs - reviewedAtMs > 90 * 24 * 60 * 60 * 1_000) {
    return "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED";
  }
  return null;
}

function normalizePrompt(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_000) {
    throw new Error("INVALID_DOUBAO_AUTOMATION_PROMPT");
  }
  return normalized;
}

function normalizeAutomationCapture(
  value: DoubaoPromptAutomationDriverResult,
): DoubaoPromptAutomationDriverResult {
  const answerText = value.answerText.trim();
  if (!answerText || answerText.length > 200_000) {
    throw new Error("DOUBAO_AUTOMATION_ANSWER_INVALID");
  }
  const pageUrl = normalizeDoubaoPageUrl(value.pageUrl);
  const pageTitle = value.pageTitle.trim();
  if (!pageTitle || pageTitle.length > 500) {
    throw new Error("DOUBAO_AUTOMATION_PAGE_TITLE_INVALID");
  }
  const observedAt = new Date(value.observedAt).toISOString();
  if (
    observedAt !== value.observedAt ||
    value.completionStatus !== "complete"
  ) {
    throw new Error("DOUBAO_AUTOMATION_CAPTURE_INCOMPLETE");
  }
  if (
    !value.screenshotPngDataUrl.startsWith("data:image/png;base64,") ||
    value.screenshotPngDataUrl.length > 15_000_000
  ) {
    throw new Error("DOUBAO_AUTOMATION_SCREENSHOT_INVALID");
  }
  if (value.visibleCitations.length > 100) {
    throw new Error("DOUBAO_AUTOMATION_CITATIONS_INVALID");
  }
  const positions = new Set<number>();
  const visibleCitations = value.visibleCitations.map((citation) => {
    const url = normalizeHttpUrl(citation.url);
    const label = citation.label.trim();
    if (
      !label ||
      label.length > 500 ||
      !Number.isInteger(citation.position) ||
      citation.position < 1 ||
      positions.has(citation.position)
    ) {
      throw new Error("DOUBAO_AUTOMATION_CITATIONS_INVALID");
    }
    positions.add(citation.position);
    return Object.freeze({ url, label, position: citation.position });
  });
  return Object.freeze({
    answerText,
    visibleCitations: Object.freeze(visibleCitations),
    pageUrl,
    pageTitle,
    observedAt,
    completionStatus: "complete",
    screenshotPngDataUrl: value.screenshotPngDataUrl,
  });
}

function normalizeDoubaoPageUrl(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== DOUBAO_WEB_ADAPTER_MANIFEST.allowedPageOrigin ||
    (url.pathname !== "/chat" && !url.pathname.startsWith("/chat/")) ||
    url.username ||
    url.password
  ) {
    throw new Error("DOUBAO_AUTOMATION_PAGE_NOT_ALLOWED");
  }
  return url.toString();
}

function normalizeHttpUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    value.length > 4_096
  ) {
    throw new Error("DOUBAO_AUTOMATION_CITATIONS_INVALID");
  }
  return url.toString();
}
