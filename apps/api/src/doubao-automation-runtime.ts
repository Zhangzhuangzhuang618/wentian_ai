export interface DoubaoAutomationRuntime {
  readonly environment: "synthetic" | "production";
  readonly currentRegion: "CN_MAINLAND";
  readonly authorizationBasis:
    "none" | "official_interface" | "written_permission";
  readonly authorizationEvidenceId: string | null;
  readonly authorizationReviewedAt: string | null;
}

export type QianwenAutomationRuntime = DoubaoAutomationRuntime;

export function loadDoubaoAutomationRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): DoubaoAutomationRuntime {
  return loadConsumerAutomationRuntime(environment, "DOUBAO");
}

export function loadQianwenAutomationRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): QianwenAutomationRuntime {
  return loadConsumerAutomationRuntime(environment, "QIANWEN");
}

function loadConsumerAutomationRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  surface: "DOUBAO" | "QIANWEN",
): DoubaoAutomationRuntime {
  const runtimeEnvironment =
    environment[`WENTIAN_${surface}_AUTOMATION_ENVIRONMENT`]?.trim() ||
    "production";
  if (
    runtimeEnvironment !== "synthetic" &&
    runtimeEnvironment !== "production"
  ) {
    throw new Error(`INVALID_${surface}_AUTOMATION_ENVIRONMENT`);
  }

  const authorizationBasis =
    environment[`WENTIAN_${surface}_AUTOMATION_AUTHORIZATION_BASIS`]?.trim() ||
    "none";
  if (
    authorizationBasis !== "none" &&
    authorizationBasis !== "official_interface" &&
    authorizationBasis !== "written_permission"
  ) {
    throw new Error(`INVALID_${surface}_AUTOMATION_AUTHORIZATION_BASIS`);
  }

  const evidence =
    environment[
      `WENTIAN_${surface}_AUTOMATION_AUTHORIZATION_EVIDENCE_ID`
    ]?.trim() || null;
  if (evidence && evidence.length > 500) {
    throw new Error(`INVALID_${surface}_AUTOMATION_AUTHORIZATION_EVIDENCE_ID`);
  }
  const reviewedAt =
    environment[
      `WENTIAN_${surface}_AUTOMATION_AUTHORIZATION_REVIEWED_AT`
    ]?.trim() || null;
  if (
    reviewedAt &&
    (!Number.isFinite(Date.parse(reviewedAt)) ||
      new Date(Date.parse(reviewedAt)).toISOString() !== reviewedAt)
  ) {
    throw new Error(`INVALID_${surface}_AUTOMATION_AUTHORIZATION_REVIEWED_AT`);
  }

  return Object.freeze({
    environment: runtimeEnvironment,
    currentRegion: "CN_MAINLAND",
    authorizationBasis,
    authorizationEvidenceId: evidence,
    authorizationReviewedAt: reviewedAt,
  });
}
