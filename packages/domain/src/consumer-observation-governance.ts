export const CONSUMER_OBSERVATION_GOVERNANCE_POLICY_VERSION =
  "consumer-observation-governance@1" as const;

export const DEFAULT_CONSUMER_OBSERVATION_GOVERNANCE_POLICY = deepFreeze({
  policyVersion: CONSUMER_OBSERVATION_GOVERNANCE_POLICY_VERSION,
  dataRegion: "CN_MAINLAND",
  allowedUsageRegions: ["CN_MAINLAND"],
  retention: {
    pendingCaptureHours: 24,
    rejectedEvidenceDeletion: "immediate",
    confirmedScreenshotDays: 30,
    confirmedAnswerDays: 180,
    confirmedVisibleCitationDays: 180,
    confirmedVisibleMetadataDays: 180,
    sanitizedDomEnabled: false,
    sanitizedDomDays: null,
    formalSourceEvents: "until_scope_deletion",
    derivedMetrics: "until_scope_deletion",
    scopeDeletionPurgeMaxDays: 30,
  },
  responsibility: {
    projectPolicyOwnerRole: "owner",
    deletionOperatorRole: "system_admin",
    productionAuthorizationReviewRoles: ["owner", "compliance_owner"],
    termsReviewIntervalDays: 90,
  },
} as const);

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
