export const WENTIAN_PROJECT_ROLES = [
  "owner",
  "admin",
  "analyst",
  "viewer",
] as const;

export const SCOPE_STATUSES = ["active", "archived", "deleting"] as const;

export type WentianProjectRole = (typeof WENTIAN_PROJECT_ROLES)[number];
export type ScopeStatus = (typeof SCOPE_STATUSES)[number];

export interface WentianPrincipal {
  readonly userId: string;
  readonly role: WentianProjectRole;
  readonly allowedScopeIds: readonly string[];
}

export interface Scope {
  readonly id: string;
  readonly projectKey: string;
  readonly displayName: string;
  readonly status: ScopeStatus;
  readonly retentionPolicyCode: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export function createWentianPrincipal(
  input: WentianPrincipal,
): WentianPrincipal {
  const allowedScopeIds = [...new Set(input.allowedScopeIds.map(normalizeId))];

  return Object.freeze({
    userId: normalizeId(input.userId),
    role: input.role,
    allowedScopeIds: Object.freeze(allowedScopeIds),
  });
}

export function hasScopeAccess(
  principal: WentianPrincipal,
  scopeId: string,
): boolean {
  return principal.allowedScopeIds.includes(scopeId);
}

export function createScope(input: Scope): Scope {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("INVALID_SCOPE_VERSION");
  }

  return Object.freeze({
    ...input,
    id: normalizeId(input.id),
    projectKey: normalizeRequiredText(input.projectKey, "INVALID_PROJECT_KEY"),
    displayName: normalizeRequiredText(
      input.displayName,
      "INVALID_SCOPE_DISPLAY_NAME",
    ),
    retentionPolicyCode: normalizeRequiredText(
      input.retentionPolicyCode,
      "INVALID_RETENTION_POLICY_CODE",
    ),
    createdBy: normalizeId(input.createdBy),
  });
}

function normalizeId(value: string): string {
  return normalizeRequiredText(value, "INVALID_ID");
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(errorCode);
  }
  return normalized;
}
