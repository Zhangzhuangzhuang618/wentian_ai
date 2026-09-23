import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { verifyLocalPassword } from "./local-password.ts";

const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const DUMMY_PASSWORD_HASH = [
  "scrypt",
  "16384",
  "8",
  "1",
  Buffer.alloc(16).toString("base64url"),
  Buffer.alloc(64).toString("base64url"),
].join("$");

export interface AuthenticatedLocalUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly instanceRole: "owner" | "admin" | null;
  readonly authorizationRole?: "owner" | "admin" | "analyst" | "viewer";
  readonly authSource?: "local" | "geo";
  readonly allowedScopeIds: readonly string[];
}

export interface LocalSessionResult {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
  readonly user: AuthenticatedLocalUser;
}

export interface StandaloneScopeRecord {
  readonly id: string;
  readonly projectKey: string;
  readonly displayName: string;
  readonly industry: string | null;
  readonly region: string | null;
  readonly status: "active" | "archived" | "deleting";
  readonly retentionPolicyCode: string;
  readonly role: "owner" | "admin" | "analyst" | "viewer";
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConsumerAutomationSettingsRecord {
  readonly scopeId: string;
  readonly automationEnabled: boolean;
  readonly allowedUsageRegion: "CN_MAINLAND";
  readonly governancePolicyVersion: "consumer-observation-governance@1";
  readonly version: number;
  readonly updatedAt: string;
}

export class PostgresLocalAccessService {
  private readonly pool: Pick<Pool, "query" | "connect">;
  private readonly sessionSecret: Buffer;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(options: {
    readonly pool: Pick<Pool, "query" | "connect">;
    readonly sessionSecret: string;
    readonly now?: () => string;
    readonly newId?: () => string;
  }) {
    this.pool = options.pool;
    if (Buffer.byteLength(options.sessionSecret, "utf8") < 32) {
      throw new Error("LOCAL_SESSION_SECRET_TOO_SHORT");
    }
    this.sessionSecret = Buffer.from(options.sessionSecret, "utf8");
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? randomUUID;
  }

  async login(email: string, password: string): Promise<LocalSessionResult> {
    const emailNormalized = normalizeEmail(email);
    const result = await this.pool.query<{
      readonly id: string;
      readonly email_normalized: string;
      readonly display_name: string;
      readonly password_hash: string;
      readonly status: "active" | "disabled";
      readonly role: "owner" | "admin";
    }>(
      `SELECT u.id, u.email_normalized, u.display_name, u.password_hash, u.status, m.role
       FROM local_users u
       JOIN instance_memberships m ON m.user_id = u.id
       WHERE u.email_normalized = $1`,
      [emailNormalized],
    );
    const row = result.rows[0];
    const valid = await verifyLocalPassword(
      password,
      row?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!row || !valid || row.status !== "active") {
      throw new Error("LOCAL_LOGIN_INVALID");
    }

    const now = normalizeTimestamp(this.now());
    const expiresAt = new Date(Date.parse(now) + SESSION_TTL_MS).toISOString();
    const sessionToken = randomBytes(32).toString("base64url");
    await this.pool.query(
      `INSERT INTO local_sessions
        (id, user_id, token_hash, expires_at, revoked_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [this.newId(), row.id, sha256(sessionToken), expiresAt, now],
    );
    const user = await this.toAuthenticatedUser(row);
    return Object.freeze({
      sessionToken,
      csrfToken: this.createCsrfToken(sessionToken),
      expiresAt,
      user,
    });
  }

  async authenticate(sessionToken: string): Promise<LocalSessionResult> {
    const normalizedToken = normalizeSessionToken(sessionToken);
    const now = normalizeTimestamp(this.now());
    const result = await this.pool.query<{
      readonly id: string;
      readonly email_normalized: string;
      readonly display_name: string;
      readonly status: "active" | "disabled";
      readonly role: "owner" | "admin" | null;
      readonly expires_at: Date | string;
      readonly auth_source: "local" | "geo";
      readonly geo_project_binding_id: string | null;
      readonly binding_version: number | null;
      readonly access_version: number | null;
      readonly binding_status: string | null;
      readonly current_binding_version: number | null;
      readonly scope_id: string | null;
      readonly access_status: string | null;
      readonly current_access_version: number | null;
      readonly access_role: "admin" | "analyst" | "viewer" | null;
    }>(
      `SELECT u.id, u.email_normalized, u.display_name, u.status, m.role,
              s.expires_at, s.auth_source, s.geo_project_binding_id,
              s.binding_version, s.access_version,
              binding.status AS binding_status,
              binding.version AS current_binding_version,
              binding.scope_id,
              access.status AS access_status,
              access.access_version AS current_access_version,
              access.role AS access_role
       FROM local_sessions s
       JOIN local_users u ON u.id = s.user_id
       LEFT JOIN instance_memberships m ON m.user_id = u.id
       LEFT JOIN geo_project_bindings binding
         ON binding.id = s.geo_project_binding_id
       LEFT JOIN geo_project_access_bindings access
         ON access.id = s.geo_access_binding_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > $2`,
      [sha256(normalizedToken), now],
    );
    const row = result.rows[0];
    const localValid = row?.auth_source === "local" && row.role !== null;
    const geoValid =
      row?.auth_source === "geo" &&
      row.geo_project_binding_id !== null &&
      row.binding_status === "active" &&
      row.scope_id !== null &&
      row.access_status === "active" &&
      row.access_role !== null &&
      row.binding_version === row.current_binding_version &&
      row.access_version === row.current_access_version;
    if (!row || row.status !== "active" || (!localValid && !geoValid)) {
      throw new Error("LOCAL_SESSION_INVALID");
    }
    const user =
      row.auth_source === "geo"
        ? Object.freeze({
            id: row.id,
            email: row.email_normalized,
            displayName: row.display_name,
            instanceRole: null,
            authorizationRole: row.access_role!,
            authSource: "geo" as const,
            allowedScopeIds: Object.freeze([row.scope_id!]),
          })
        : await this.toAuthenticatedUser({ ...row, role: row.role! });
    return Object.freeze({
      sessionToken: normalizedToken,
      csrfToken: this.createCsrfToken(normalizedToken),
      expiresAt: toIso(row.expires_at),
      user,
    });
  }

  verifyCsrfToken(sessionToken: string, csrfToken: string): boolean {
    const expected = Buffer.from(this.createCsrfToken(sessionToken), "utf8");
    const actual = Buffer.from(csrfToken.trim(), "utf8");
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  async logout(sessionToken: string): Promise<void> {
    const normalizedToken = normalizeSessionToken(sessionToken);
    await this.pool.query(
      `UPDATE local_sessions
       SET revoked_at = COALESCE(revoked_at, $2)
       WHERE token_hash = $1`,
      [sha256(normalizedToken), normalizeTimestamp(this.now())],
    );
  }

  async listScopes(userId: string): Promise<readonly StandaloneScopeRecord[]> {
    const result = await this.pool.query<ScopeRow>(
      `SELECT s.id, s.project_key, s.display_name, s.status,
              s.industry, s.region, s.retention_policy_code, sm.role, s.version,
              s.created_at, s.updated_at
       FROM scopes s
       JOIN scope_memberships sm ON sm.scope_id = s.id
       WHERE sm.user_id = $1
       ORDER BY s.created_at, s.id`,
      [userId],
    );
    return Object.freeze(result.rows.map(toScopeRecord));
  }

  async createScope(input: {
    readonly user: AuthenticatedLocalUser;
    readonly projectKey: string;
    readonly displayName: string;
    readonly industry: string;
    readonly region: string;
  }): Promise<StandaloneScopeRecord> {
    requireInstanceAdmin(input.user);
    const id = this.newId();
    const projectKey = normalizeProjectKey(input.projectKey);
    const displayName = normalizeDisplayName(input.displayName);
    const industry = normalizeBusinessLabel(input.industry, "INVALID_INDUSTRY");
    const region = normalizeBusinessLabel(input.region, "INVALID_REGION");
    const now = normalizeTimestamp(this.now());
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<ScopeRow>(
        `INSERT INTO scopes
          (id, project_key, display_name, industry, region, status,
           retention_policy_code, created_by, created_at, updated_at, version)
         VALUES ($1, $2, $3, $4, $5, 'active',
                 'consumer-observation-governance@1', $6, $7, $7, 1)
         RETURNING id, project_key, display_name, industry, region, status,
                   retention_policy_code, 'owner'::varchar AS role, version,
                   created_at, updated_at`,
        [id, projectKey, displayName, industry, region, input.user.id, now],
      );
      await client.query(
        `INSERT INTO scope_memberships (scope_id, user_id, role, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [id, input.user.id, now],
      );
      await client.query(
        `INSERT INTO scope_consumer_settings
          (scope_id, automation_enabled, allowed_usage_region,
           governance_policy_version, updated_by, updated_at, version)
         VALUES ($1, false, 'CN_MAINLAND',
                 'consumer-observation-governance@1', $2, $3, 1)`,
        [id, input.user.id, now],
      );
      await client.query("COMMIT");
      return toScopeRecord(inserted.rows[0]!);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateScopeMetadata(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly industry: string | null;
    readonly region: string | null;
    readonly expectedVersion: number;
  }): Promise<StandaloneScopeRecord> {
    requireInstanceAdmin(input.user);
    requireScopeAccess(input.user, input.scopeId);
    const industry = normalizeOptionalBusinessLabel(
      input.industry,
      "INVALID_INDUSTRY",
    );
    const region = normalizeOptionalBusinessLabel(
      input.region,
      "INVALID_REGION",
    );
    const result = await this.pool.query<ScopeRow>(
      `UPDATE scopes s
       SET industry = $1,
           region = $2,
           updated_at = $3,
           version = version + 1
       WHERE s.id = $4 AND s.version = $5
       RETURNING s.id, s.project_key, s.display_name, s.industry, s.region,
                 s.status, s.retention_policy_code,
                 (SELECT sm.role FROM scope_memberships sm
                  WHERE sm.scope_id = s.id AND sm.user_id = $6) AS role,
                 s.version, s.created_at, s.updated_at`,
      [
        industry,
        region,
        normalizeTimestamp(this.now()),
        input.scopeId,
        input.expectedVersion,
        input.user.id,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("SCOPE_VERSION_CONFLICT");
    }
    return toScopeRecord(result.rows[0]);
  }

  async getConsumerAutomationSettings(
    user: AuthenticatedLocalUser,
    scopeId: string,
  ): Promise<ConsumerAutomationSettingsRecord> {
    requireScopeAccess(user, scopeId);
    return this.getConsumerAutomationSettingsForCapture(scopeId);
  }

  async getConsumerAutomationSettingsForCapture(
    scopeId: string,
  ): Promise<ConsumerAutomationSettingsRecord> {
    const result = await this.pool.query<SettingsRow>(
      `SELECT scope_id, automation_enabled, allowed_usage_region,
              governance_policy_version, version, updated_at
       FROM scope_consumer_settings
       WHERE scope_id = $1`,
      [scopeId],
    );
    if (!result.rows[0]) {
      throw new Error("RESOURCE_NOT_FOUND");
    }
    return toSettingsRecord(result.rows[0]);
  }

  async updateConsumerAutomationSettings(input: {
    readonly user: AuthenticatedLocalUser;
    readonly scopeId: string;
    readonly automationEnabled: boolean;
    readonly expectedVersion: number;
  }): Promise<ConsumerAutomationSettingsRecord> {
    requireInstanceAdmin(input.user);
    requireScopeAccess(input.user, input.scopeId);
    const result = await this.pool.query<SettingsRow>(
      `UPDATE scope_consumer_settings
       SET automation_enabled = $1,
           updated_by = $2,
           updated_at = $3,
           version = version + 1
       WHERE scope_id = $4 AND version = $5
       RETURNING scope_id, automation_enabled, allowed_usage_region,
                 governance_policy_version, version, updated_at`,
      [
        input.automationEnabled,
        input.user.id,
        normalizeTimestamp(this.now()),
        input.scopeId,
        input.expectedVersion,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("SETTINGS_VERSION_CONFLICT");
    }
    return toSettingsRecord(result.rows[0]);
  }

  private createCsrfToken(sessionToken: string): string {
    return createHmac("sha256", this.sessionSecret)
      .update(`wentian-csrf@1:${sessionToken}`, "utf8")
      .digest("base64url");
  }

  private async toAuthenticatedUser(row: {
    readonly id: string;
    readonly email_normalized: string;
    readonly display_name: string;
    readonly role: "owner" | "admin";
  }): Promise<AuthenticatedLocalUser> {
    const scopes = await this.pool.query<{ readonly scope_id: string }>(
      `SELECT scope_id
       FROM scope_memberships
       WHERE user_id = $1
       ORDER BY scope_id`,
      [row.id],
    );
    return Object.freeze({
      id: row.id,
      email: row.email_normalized,
      displayName: row.display_name,
      instanceRole: row.role,
      authorizationRole: row.role,
      authSource: "local" as const,
      allowedScopeIds: Object.freeze(scopes.rows.map((item) => item.scope_id)),
    });
  }
}

interface ScopeRow {
  readonly id: string;
  readonly project_key: string;
  readonly display_name: string;
  readonly industry: string | null;
  readonly region: string | null;
  readonly status: "active" | "archived" | "deleting";
  readonly retention_policy_code: string;
  readonly role: "owner" | "admin" | "analyst" | "viewer";
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface SettingsRow {
  readonly scope_id: string;
  readonly automation_enabled: boolean;
  readonly allowed_usage_region: "CN_MAINLAND";
  readonly governance_policy_version: "consumer-observation-governance@1";
  readonly version: number;
  readonly updated_at: Date | string;
}

function toScopeRecord(row: ScopeRow): StandaloneScopeRecord {
  return Object.freeze({
    id: row.id,
    projectKey: row.project_key,
    displayName: row.display_name,
    industry: row.industry,
    region: row.region,
    status: row.status,
    retentionPolicyCode: row.retention_policy_code,
    role: row.role,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toSettingsRecord(row: SettingsRow): ConsumerAutomationSettingsRecord {
  if (
    row.allowed_usage_region !== "CN_MAINLAND" ||
    row.governance_policy_version !== "consumer-observation-governance@1"
  ) {
    throw new Error("CONSUMER_AUTOMATION_POLICY_DRIFT");
  }
  return Object.freeze({
    scopeId: row.scope_id,
    automationEnabled: row.automation_enabled,
    allowedUsageRegion: row.allowed_usage_region,
    governancePolicyVersion: row.governance_policy_version,
    version: row.version,
    updatedAt: toIso(row.updated_at),
  });
}

function requireInstanceAdmin(user: AuthenticatedLocalUser): void {
  if (user.instanceRole !== "owner" && user.instanceRole !== "admin") {
    throw new Error("ACTION_FORBIDDEN");
  }
}

function requireScopeAccess(
  user: AuthenticatedLocalUser,
  scopeId: string,
): void {
  if (!user.allowedScopeIds.includes(scopeId)) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)
  ) {
    throw new Error("INVALID_LOCAL_EMAIL");
  }
  return normalized;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new Error("INVALID_SCOPE_DISPLAY_NAME");
  }
  return normalized;
}

function normalizeBusinessLabel(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeOptionalBusinessLabel(
  value: string | null,
  errorCode: string,
): string | null {
  return value === null ? null : normalizeBusinessLabel(value, errorCode);
}

function normalizeProjectKey(value: string): string {
  const normalized = value.trim();
  if (
    !/^[a-z0-9\p{Script=Han}](?:[a-z0-9\p{Script=Han}-]{0,78}[a-z0-9\p{Script=Han}])?$/u.test(
      normalized,
    )
  ) {
    throw new Error("INVALID_PROJECT_KEY");
  }
  return normalized;
}

function normalizeSessionToken(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new Error("LOCAL_SESSION_INVALID");
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("INVALID_TIMESTAMP");
  }
  return new Date(value).toISOString();
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
