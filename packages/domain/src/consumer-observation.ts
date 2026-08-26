import type { CollectionMethod } from "./run-mode.ts";

export const CONSUMER_COLLECTION_METHODS = [
  "browser_assisted",
  "manual_import",
] as const satisfies readonly CollectionMethod[];

export const CONSUMER_SURFACE_PROFILE_STATUSES = [
  "draft",
  "active",
  "suspended",
] as const;

export const SURFACE_EQUIVALENCE_LEVELS = [
  "exact",
  "approximate",
  "unknown",
] as const;

export const CONSUMER_COMPARISON_TIERS = [
  "exact",
  "approximate",
  "query_only",
] as const;

export const OBSERVATION_TASK_STATUSES = [
  "waiting_user",
  "capturing",
  "needs_review",
  "confirmed",
  "rejected",
  "expired",
  "cancelled",
] as const;

export const OBSERVATION_VERIFICATION_STATUSES = [
  "not_required",
  "needs_review",
  "confirmed",
  "rejected",
] as const;

export const OBSERVATION_EVIDENCE_GRADES = [
  "api_structured",
  "web_confirmed_capture",
  "web_confirmed_manual",
  "imported_declared",
] as const;

export type ConsumerCollectionMethod =
  (typeof CONSUMER_COLLECTION_METHODS)[number];
export type ConsumerSurfaceProfileStatus =
  (typeof CONSUMER_SURFACE_PROFILE_STATUSES)[number];
export type SurfaceEquivalenceLevel =
  (typeof SURFACE_EQUIVALENCE_LEVELS)[number];
export type ConsumerComparisonTier = (typeof CONSUMER_COMPARISON_TIERS)[number];
export type ObservationTaskStatus = (typeof OBSERVATION_TASK_STATUSES)[number];
export type ObservationVerificationStatus =
  (typeof OBSERVATION_VERIFICATION_STATUSES)[number];
export type ObservationEvidenceGrade =
  (typeof OBSERVATION_EVIDENCE_GRADES)[number];

export interface ConsumerSessionConditions {
  readonly searchMode: "enabled" | "disabled" | "unknown";
  readonly isNewConversation: boolean;
  readonly isLoggedIn: boolean;
  readonly memoryEnabled: boolean | null;
  readonly personalizationEnabled: boolean | null;
  readonly locale: string;
  readonly region: string | null;
}

export interface VisibleSourceCapabilities {
  readonly visibleCitations: boolean;
  readonly sourcePanel: boolean;
  readonly screenshot: boolean;
  readonly sanitizedDom: boolean;
}

export interface ConsumerSurfaceProfileVersion {
  readonly id: string;
  readonly surfaceCode: string;
  readonly productLabel: string;
  readonly adapterVersion: string;
  readonly allowedCollectionMethods: readonly ConsumerCollectionMethod[];
  readonly visibleSourceCapabilities: VisibleSourceCapabilities;
  readonly comparisonSurfaceModelLabel: string | null;
  readonly comparisonProviderCode: string | null;
  readonly comparisonModelKey: string | null;
  readonly equivalenceLevel: SurfaceEquivalenceLevel;
  readonly equivalenceBasis: string | null;
  readonly equivalenceEvidenceUrl: string | null;
  readonly equivalenceReviewedAt: string | null;
  readonly termsReviewedAt: string | null;
  readonly status: ConsumerSurfaceProfileStatus;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateConsumerSurfaceProfileVersionInput {
  readonly id: string;
  readonly surfaceCode: string;
  readonly productLabel: string;
  readonly adapterVersion: string;
  readonly allowedCollectionMethods: readonly ConsumerCollectionMethod[];
  readonly visibleSourceCapabilities: VisibleSourceCapabilities;
  readonly comparisonSurfaceModelLabel?: string | null;
  readonly comparisonProviderCode?: string | null;
  readonly comparisonModelKey?: string | null;
  readonly equivalenceLevel: SurfaceEquivalenceLevel;
  readonly equivalenceBasis?: string | null;
  readonly equivalenceEvidenceUrl?: string | null;
  readonly equivalenceReviewedAt?: string | null;
  readonly termsReviewedAt?: string | null;
  readonly status: ConsumerSurfaceProfileStatus;
  readonly createdBy: string;
  readonly createdAt: string;
}

export function createConsumerSurfaceProfileVersion(
  input: CreateConsumerSurfaceProfileVersionInput,
): ConsumerSurfaceProfileVersion {
  const allowedCollectionMethods = [...new Set(input.allowedCollectionMethods)];
  if (input.status !== "draft" && allowedCollectionMethods.length === 0) {
    throw new Error("SURFACE_COLLECTION_METHOD_REQUIRED");
  }

  const profile = {
    id: normalizeRequiredText(input.id, "INVALID_SURFACE_PROFILE_ID"),
    surfaceCode: normalizeRequiredText(
      input.surfaceCode,
      "INVALID_SURFACE_CODE",
    ),
    productLabel: normalizeRequiredText(
      input.productLabel,
      "INVALID_PRODUCT_LABEL",
    ),
    adapterVersion: normalizeRequiredText(
      input.adapterVersion,
      "INVALID_ADAPTER_VERSION",
    ),
    allowedCollectionMethods: Object.freeze(allowedCollectionMethods),
    visibleSourceCapabilities: Object.freeze({
      ...input.visibleSourceCapabilities,
    }),
    comparisonSurfaceModelLabel: normalizeOptionalText(
      input.comparisonSurfaceModelLabel,
    ),
    comparisonProviderCode: normalizeOptionalText(input.comparisonProviderCode),
    comparisonModelKey: normalizeOptionalText(input.comparisonModelKey),
    equivalenceLevel: input.equivalenceLevel,
    equivalenceBasis: normalizeOptionalText(input.equivalenceBasis),
    equivalenceEvidenceUrl: normalizeOptionalText(input.equivalenceEvidenceUrl),
    equivalenceReviewedAt: normalizeOptionalText(input.equivalenceReviewedAt),
    termsReviewedAt: normalizeOptionalText(input.termsReviewedAt),
    status: input.status,
    createdBy: normalizeRequiredText(input.createdBy, "INVALID_CREATED_BY"),
    createdAt: normalizeRequiredText(input.createdAt, "INVALID_CREATED_AT"),
  } as const;

  if (profile.status === "active" && !profile.termsReviewedAt) {
    throw new Error("ACTIVE_SURFACE_TERMS_REVIEW_REQUIRED");
  }

  if (profile.equivalenceLevel === "unknown") {
    if (profile.comparisonProviderCode || profile.comparisonModelKey) {
      throw new Error("UNKNOWN_EQUIVALENCE_API_MAPPING_FORBIDDEN");
    }
  } else {
    if (
      !profile.comparisonSurfaceModelLabel ||
      !profile.comparisonProviderCode ||
      !profile.comparisonModelKey ||
      !profile.equivalenceBasis ||
      !profile.equivalenceReviewedAt
    ) {
      throw new Error("EQUIVALENCE_MAPPING_INCOMPLETE");
    }
    if (
      profile.equivalenceLevel === "exact" &&
      !profile.equivalenceEvidenceUrl
    ) {
      throw new Error("EXACT_EQUIVALENCE_EVIDENCE_REQUIRED");
    }
  }

  return Object.freeze(profile);
}

export function deriveConsumerComparisonTier(
  profile: ConsumerSurfaceProfileVersion,
  observedSurfaceModelLabel: string | null | undefined,
): ConsumerComparisonTier {
  const observedLabel = normalizeOptionalText(observedSurfaceModelLabel);
  if (
    profile.equivalenceLevel === "unknown" ||
    !profile.comparisonSurfaceModelLabel ||
    observedLabel !== profile.comparisonSurfaceModelLabel
  ) {
    return "query_only";
  }
  return profile.equivalenceLevel;
}

const observationTaskTransitions = {
  waiting_user: ["capturing", "cancelled"],
  capturing: ["needs_review", "expired", "cancelled"],
  needs_review: ["confirmed", "rejected"],
  confirmed: [],
  rejected: [],
  expired: [],
  cancelled: [],
} as const satisfies Readonly<
  Record<ObservationTaskStatus, readonly ObservationTaskStatus[]>
>;

export function canTransitionObservationTask(
  from: ObservationTaskStatus,
  to: ObservationTaskStatus,
): boolean {
  const allowedTransitions = observationTaskTransitions[
    from
  ] as readonly ObservationTaskStatus[];
  return allowedTransitions.includes(to);
}

export function assertObservationTaskTransition(
  from: ObservationTaskStatus,
  to: ObservationTaskStatus,
): void {
  if (!canTransitionObservationTask(from, to)) {
    throw new Error("INVALID_OBSERVATION_TASK_TRANSITION");
  }
}

export function evidenceGradeForConsumerCollectionMethod(
  method: ConsumerCollectionMethod,
): Extract<
  ObservationEvidenceGrade,
  "web_confirmed_capture" | "web_confirmed_manual"
> {
  if (method === "browser_assisted") {
    return "web_confirmed_capture";
  }
  if (method === "manual_import") {
    return "web_confirmed_manual";
  }
  throw new Error("INVALID_CONSUMER_COLLECTION_METHOD");
}

export function isDefaultConsumerMetricEligible(
  verificationStatus: ObservationVerificationStatus,
  evidenceGrade: ObservationEvidenceGrade | null,
): boolean {
  return (
    verificationStatus === "confirmed" &&
    (evidenceGrade === "web_confirmed_capture" ||
      evidenceGrade === "web_confirmed_manual")
  );
}

export const ATTENDED_CAPTURE_DATA_KINDS = [
  "answer_text",
  "visible_citations",
  "visible_metadata",
  "viewport_screenshot",
  "sanitized_visible_dom",
] as const;

export type AttendedCaptureDataKind =
  (typeof ATTENDED_CAPTURE_DATA_KINDS)[number];
export type CaptureAnswerState = "complete" | "generating" | "unknown";
export type CaptureSourcePanelState =
  "loaded" | "not_present" | "loading" | "unknown";
export type CapturePageSignatureStatus = "matched" | "mismatched" | "unknown";

export type AttendedCaptureErrorCode =
  | "CAPTURE_ADAPTER_NOT_ACTIVE"
  | "CAPTURE_NOT_USER_INITIATED"
  | "CAPTURE_SURFACE_MISMATCH"
  | "CAPTURE_ORIGIN_MISMATCH"
  | "CAPTURE_TASK_MISMATCH"
  | "CAPTURE_NOT_CURRENT_VISIBLE_PAGE"
  | "CAPTURE_FORBIDDEN_DATA_REQUESTED"
  | "CAPTURE_REQUIRED_DATA_MISSING"
  | "CAPTURE_PAGE_SIGNATURE_UNRECOGNIZED"
  | "CAPTURE_ANSWER_INCOMPLETE"
  | "CAPTURE_SOURCE_PANEL_NOT_READY";

export interface AttendedCaptureContext {
  readonly surfaceCode: string;
  readonly expectedSurfaceCode: string;
  readonly pageOrigin: string;
  readonly expectedPageOrigin: string;
  readonly userInitiated: boolean;
  readonly currentTaskId: string;
  readonly tokenTaskId: string;
  readonly isCurrentVisiblePage: boolean;
  readonly pageSignatureStatus: CapturePageSignatureStatus;
  readonly answerState: CaptureAnswerState;
  readonly sourcePanelState: CaptureSourcePanelState;
  readonly requestedDataKinds: readonly string[];
}

export type AttendedCaptureDecision =
  | {
      readonly allowed: true;
      readonly requiresUserPreview: true;
      readonly requiresFinalConfirmation: true;
    }
  | {
      readonly allowed: false;
      readonly errorCode: AttendedCaptureErrorCode;
      readonly fallback: "wait" | "manual_import";
    };

const attendedCaptureDataKindSet = new Set<string>(ATTENDED_CAPTURE_DATA_KINDS);
const attendedRequiredDataKinds = [
  "answer_text",
  "visible_metadata",
  "viewport_screenshot",
] as const satisfies readonly AttendedCaptureDataKind[];

export function evaluateAttendedCapture(
  context: AttendedCaptureContext,
): AttendedCaptureDecision {
  if (!context.userInitiated) {
    return denyCapture("CAPTURE_NOT_USER_INITIATED", "wait");
  }
  if (context.surfaceCode !== context.expectedSurfaceCode) {
    return denyCapture("CAPTURE_SURFACE_MISMATCH", "manual_import");
  }
  if (!originsMatch(context.pageOrigin, context.expectedPageOrigin)) {
    return denyCapture("CAPTURE_ORIGIN_MISMATCH", "manual_import");
  }
  if (context.currentTaskId !== context.tokenTaskId) {
    return denyCapture("CAPTURE_TASK_MISMATCH", "wait");
  }
  if (!context.isCurrentVisiblePage) {
    return denyCapture("CAPTURE_NOT_CURRENT_VISIBLE_PAGE", "manual_import");
  }
  if (
    context.requestedDataKinds.some(
      (dataKind) => !attendedCaptureDataKindSet.has(dataKind),
    )
  ) {
    return denyCapture("CAPTURE_FORBIDDEN_DATA_REQUESTED", "wait");
  }
  if (
    attendedRequiredDataKinds.some(
      (dataKind) => !context.requestedDataKinds.includes(dataKind),
    )
  ) {
    return denyCapture("CAPTURE_REQUIRED_DATA_MISSING", "wait");
  }
  if (context.pageSignatureStatus !== "matched") {
    return denyCapture("CAPTURE_PAGE_SIGNATURE_UNRECOGNIZED", "manual_import");
  }
  if (context.answerState !== "complete") {
    return denyCapture("CAPTURE_ANSWER_INCOMPLETE", "wait");
  }
  if (
    context.sourcePanelState === "loading" ||
    context.sourcePanelState === "unknown"
  ) {
    return denyCapture("CAPTURE_SOURCE_PANEL_NOT_READY", "wait");
  }
  return Object.freeze({
    allowed: true,
    requiresUserPreview: true,
    requiresFinalConfirmation: true,
  });
}

function denyCapture(
  errorCode: AttendedCaptureErrorCode,
  fallback: "wait" | "manual_import",
): AttendedCaptureDecision {
  return Object.freeze({ allowed: false, errorCode, fallback });
}

function originsMatch(first: string, second: string): boolean {
  try {
    return normalizeOrigin(first) === normalizeOrigin(second);
  } catch {
    return false;
  }
}

export interface CaptureTokenClaims {
  readonly systemInstanceId: string;
  readonly scopeId: string;
  readonly taskId: string;
  readonly userId: string;
  readonly audienceOrigin: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CaptureTokenUseContext {
  readonly systemInstanceId: string;
  readonly scopeId: string;
  readonly taskId: string;
  readonly userId: string;
  readonly requestOrigin: string;
  readonly now: string;
  readonly alreadyConsumed: boolean;
}

export function createCaptureTokenClaims(
  claims: CaptureTokenClaims,
): CaptureTokenClaims {
  const normalized = Object.freeze({
    systemInstanceId: normalizeRequiredText(
      claims.systemInstanceId,
      "INVALID_SYSTEM_INSTANCE_ID",
    ),
    scopeId: normalizeRequiredText(claims.scopeId, "INVALID_SCOPE_ID"),
    taskId: normalizeRequiredText(claims.taskId, "INVALID_TASK_ID"),
    userId: normalizeRequiredText(claims.userId, "INVALID_USER_ID"),
    audienceOrigin: normalizeOrigin(claims.audienceOrigin),
    nonce: normalizeRequiredText(claims.nonce, "INVALID_TOKEN_NONCE"),
    issuedAt: normalizeRequiredText(claims.issuedAt, "INVALID_ISSUED_AT"),
    expiresAt: normalizeRequiredText(claims.expiresAt, "INVALID_EXPIRES_AT"),
  });

  if (toTimestamp(normalized.expiresAt) <= toTimestamp(normalized.issuedAt)) {
    throw new Error("INVALID_CAPTURE_TOKEN_LIFETIME");
  }
  return normalized;
}

export function assertCaptureTokenUsable(
  claims: CaptureTokenClaims,
  context: CaptureTokenUseContext,
): void {
  if (context.alreadyConsumed) {
    throw new Error("CAPTURE_TOKEN_ALREADY_CONSUMED");
  }
  if (toTimestamp(context.now) >= toTimestamp(claims.expiresAt)) {
    throw new Error("CAPTURE_TOKEN_EXPIRED");
  }
  if (claims.systemInstanceId !== context.systemInstanceId) {
    throw new Error("CAPTURE_TOKEN_SYSTEM_MISMATCH");
  }
  if (claims.scopeId !== context.scopeId) {
    throw new Error("CAPTURE_TOKEN_SCOPE_MISMATCH");
  }
  if (claims.taskId !== context.taskId) {
    throw new Error("CAPTURE_TOKEN_TASK_MISMATCH");
  }
  if (claims.userId !== context.userId) {
    throw new Error("CAPTURE_TOKEN_USER_MISMATCH");
  }
  if (claims.audienceOrigin !== normalizeOrigin(context.requestOrigin)) {
    throw new Error("CAPTURE_TOKEN_ORIGIN_MISMATCH");
  }
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return timestamp;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INVALID_CAPTURE_TOKEN_ORIGIN");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_CAPTURE_TOKEN_ORIGIN");
  }
  return url.origin;
}
