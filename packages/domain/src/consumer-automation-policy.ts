import type { ConsumerSurfaceProfileStatus } from "./consumer-observation.ts";

export const CONSUMER_AUTOMATION_POLICY_VERSION =
  "consumer-automation-policy@1" as const;

export type ConsumerAutomationEnvironment = "synthetic" | "production";
export type ConsumerAutomationMode = "attended" | "automated";
export type ConsumerAutomationAuthorizationBasis =
  "none" | "official_interface" | "written_permission";

export type ConsumerAutomationBlockReason =
  | "SURFACE_NOT_ACTIVE"
  | "ADAPTER_AUTOMATION_UNSUPPORTED"
  | "REGION_NOT_ALLOWED"
  | "PRODUCTION_AUTHORIZATION_REQUIRED"
  | "PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED";

export interface EvaluateConsumerAutomationPolicyInput {
  readonly automationEnabled?: boolean;
  readonly environment: ConsumerAutomationEnvironment;
  readonly surfaceStatus: ConsumerSurfaceProfileStatus;
  readonly adapterSupportsAutomation: boolean;
  readonly authorizationBasis: ConsumerAutomationAuthorizationBasis;
  readonly authorizationEvidenceId?: string | null;
  readonly currentRegion: string;
  readonly allowedRegions: readonly string[];
}

export interface ConsumerAutomationPolicyDecision {
  readonly policyVersion: typeof CONSUMER_AUTOMATION_POLICY_VERSION;
  readonly automationEnabled: boolean;
  readonly requestedMode: ConsumerAutomationMode;
  readonly environment: ConsumerAutomationEnvironment;
  readonly allowed: boolean;
  readonly blockReason: ConsumerAutomationBlockReason | null;
  readonly productionAuthorizationSatisfied: boolean;
  readonly requiresUserPromptSubmission: boolean;
  readonly requiresUserCaptureClick: boolean;
  readonly requiresLocalPreview: boolean;
  readonly requiresFinalReview: true;
}

export function evaluateConsumerAutomationPolicy(
  input: EvaluateConsumerAutomationPolicyInput,
): ConsumerAutomationPolicyDecision {
  const automationEnabled = input.automationEnabled ?? false;
  if (typeof automationEnabled !== "boolean") {
    throw new Error("INVALID_CONSUMER_AUTOMATION_SWITCH");
  }
  const requestedMode: ConsumerAutomationMode = automationEnabled
    ? "automated"
    : "attended";
  assertEnvironment(input.environment);
  assertAuthorizationBasis(input.authorizationBasis);
  if (!input.currentRegion.trim() || input.allowedRegions.length === 0) {
    throw new Error("INVALID_CONSUMER_AUTOMATION_REGION_POLICY");
  }
  const regionAllowed = input.allowedRegions.includes(input.currentRegion);
  const productionAuthorizationSatisfied =
    input.authorizationBasis !== "none" &&
    Boolean(input.authorizationEvidenceId?.trim());

  let blockReason: ConsumerAutomationBlockReason | null = null;
  if (input.environment === "production" && input.surfaceStatus !== "active") {
    blockReason = "SURFACE_NOT_ACTIVE";
  } else if (automationEnabled && !input.adapterSupportsAutomation) {
    blockReason = "ADAPTER_AUTOMATION_UNSUPPORTED";
  } else if (input.environment === "production" && !regionAllowed) {
    blockReason = "REGION_NOT_ALLOWED";
  } else if (
    input.environment === "production" &&
    automationEnabled &&
    input.authorizationBasis === "none"
  ) {
    blockReason = "PRODUCTION_AUTHORIZATION_REQUIRED";
  } else if (
    input.environment === "production" &&
    automationEnabled &&
    !productionAuthorizationSatisfied
  ) {
    blockReason = "PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED";
  }

  return Object.freeze({
    policyVersion: CONSUMER_AUTOMATION_POLICY_VERSION,
    automationEnabled,
    requestedMode,
    environment: input.environment,
    allowed: blockReason === null,
    blockReason,
    productionAuthorizationSatisfied,
    requiresUserPromptSubmission: !automationEnabled,
    requiresUserCaptureClick: !automationEnabled,
    requiresLocalPreview: !automationEnabled,
    requiresFinalReview: true,
  });
}

function assertEnvironment(value: ConsumerAutomationEnvironment): void {
  if (value !== "synthetic" && value !== "production") {
    throw new Error("INVALID_CONSUMER_AUTOMATION_ENVIRONMENT");
  }
}

function assertAuthorizationBasis(
  value: ConsumerAutomationAuthorizationBasis,
): void {
  if (
    value !== "none" &&
    value !== "official_interface" &&
    value !== "written_permission"
  ) {
    throw new Error("INVALID_CONSUMER_AUTOMATION_AUTHORIZATION_BASIS");
  }
}
