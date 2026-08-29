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

export const DEEPSEEK_WEB_ADAPTER_MANIFEST = Object.freeze({
  surfaceCode: "deepseek_web" as const,
  productLabel: "DeepSeek 网页版" as const,
  allowedPageOrigin: "https://chat.deepseek.com" as const,
  adapterVersion: "deepseek-web@1-visible-page" as const,
  pageSignatureVersion: "deepseek-web-signature@1-visible-page" as const,
  status: "active" as const,
  automationMode: "attended" as const,
  supportedAutomationModes: Object.freeze(["attended", "automated"] as const),
  productionAutomationAuthorizationBasis: "none" as const,
  productionAutomationAuthorizationEvidenceId: null,
  allowedUsageRegions: Object.freeze(["CN_MAINLAND"] as const),
  canAutomateLogin: false as const,
  canAutomatePromptSubmission: true as const,
  canReadHiddenNetwork: false as const,
  canReadCredentials: false as const,
  requiresUserCaptureClick: true as const,
  requiresLocalPreview: true as const,
  requiresFinalConfirmation: true as const,
});

export type DeepseekCaptureContext = Omit<
  AttendedCaptureContext,
  "expectedSurfaceCode" | "expectedPageOrigin"
>;

export function preflightDeepseekAttendedCapture(
  context: DeepseekCaptureContext,
): AttendedCaptureDecision {
  return evaluateAttendedCapture({
    ...context,
    expectedSurfaceCode: DEEPSEEK_WEB_ADAPTER_MANIFEST.surfaceCode,
    expectedPageOrigin: DEEPSEEK_WEB_ADAPTER_MANIFEST.allowedPageOrigin,
  });
}

export type DeepseekPromptAutomationPreflight = Readonly<{
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

export function preflightDeepseekPromptAutomation(input: {
  readonly automationEnabled?: boolean;
  readonly environment: ConsumerAutomationEnvironment;
  readonly currentRegion: string;
  readonly authorizationBasis?: ConsumerAutomationAuthorizationBasis;
  readonly authorizationEvidenceId?: string | null;
  readonly authorizationReviewedAt?: string | null;
  readonly now?: string;
  readonly transport: "official_interface" | "visible_page";
}): DeepseekPromptAutomationPreflight {
  const policy = evaluateConsumerAutomationPolicy({
    automationEnabled: input.automationEnabled,
    environment: input.environment,
    surfaceStatus: DEEPSEEK_WEB_ADAPTER_MANIFEST.status,
    adapterSupportsAutomation:
      DEEPSEEK_WEB_ADAPTER_MANIFEST.canAutomatePromptSubmission,
    authorizationBasis:
      input.authorizationBasis ??
      DEEPSEEK_WEB_ADAPTER_MANIFEST.productionAutomationAuthorizationBasis,
    authorizationEvidenceId:
      input.authorizationEvidenceId ??
      DEEPSEEK_WEB_ADAPTER_MANIFEST.productionAutomationAuthorizationEvidenceId,
    currentRegion: input.currentRegion,
    allowedRegions: DEEPSEEK_WEB_ADAPTER_MANIFEST.allowedUsageRegions,
  });
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
      blockReason: policy.blockReason,
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
  return Object.freeze({
    allowed: reviewBlockReason === null,
    policy,
    blockReason: reviewBlockReason,
  });
}

function authorizationCoversDriver(
  authorizationBasis: ConsumerAutomationAuthorizationBasis | undefined,
  transport: "official_interface" | "visible_page",
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
  if (input.environment !== "production") return null;
  const reviewedAt = input.reviewedAt?.trim();
  if (!reviewedAt) return "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED";
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
  return nowMs - reviewedAtMs > 90 * 24 * 60 * 60 * 1_000
    ? "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED"
    : null;
}
