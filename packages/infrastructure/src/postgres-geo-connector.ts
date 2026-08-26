import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { QuerySetSnapshotRepository } from "@wentian/application";
import {
  createQuerySetSnapshot,
  type CommercialValue,
  type QueryIntentCode,
} from "@wentian/domain";
import type { Pool, PoolClient } from "pg";

import {
  createGeoConnectorClientSecret,
  GeoConnectorSecretVault,
  hashGeoConnectorRequestBody,
  verifyGeoConnectorSignature,
} from "./geo-connector-crypto.ts";
import type { AuthenticatedLocalUser } from "./postgres-local-access.ts";

export const GEO_CONNECTOR_CONTRACT_VERSION =
  "wentian-geo-connector@1" as const;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1_000;
const NONCE_TTL_MS = 10 * 60 * 1_000;
const SSO_TICKET_TTL_MS = 60 * 1_000;
const GEO_SESSION_TTL_MS = 30 * 60 * 1_000;

export interface GeoConnectorRecord {
  readonly id: string;
  readonly geoInstanceRef: string;
  readonly geoTenantRef: string;
  readonly displayName: string;
  readonly allowedGeoOrigins: readonly string[];
  readonly callbackBaseUrl: string | null;
  readonly status: "active" | "suspended" | "revoked";
  readonly contractVersion: typeof GEO_CONNECTOR_CONTRACT_VERSION;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeoProjectBindingRecord {
  readonly id: string;
  readonly connectorInstanceId: string;
  readonly geoWorkspaceRef: string;
  readonly geoProjectRef: string;
  readonly geoProjectDisplayName: string;
  readonly scopeId: string | null;
  readonly status:
    "pending_wentian" | "active" | "suspended" | "rejected" | "disconnected";
  readonly version: number;
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly decisionReason: string | null;
}

export interface AuthenticatedGeoConnector {
  readonly connector: GeoConnectorRecord;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface GeoSignedRequestInput {
  readonly connectorId: string;
  readonly contractVersion: string;
  readonly signature: string;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly method: string;
  readonly path: string;
  readonly rawBody: string;
}

export interface GeoSessionConsumption {
  readonly sessionToken: string;
  readonly expiresAt: string;
  readonly redirectPath: string;
}

export class PostgresGeoConnectorService {
  private readonly pool: Pick<Pool, "query" | "connect">;
  private readonly snapshots: QuerySetSnapshotRepository;
  private readonly vault: GeoConnectorSecretVault;
  private readonly publicOrigin: string;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(options: {
    readonly pool: Pick<Pool, "query" | "connect">;
    readonly snapshots: QuerySetSnapshotRepository;
    readonly masterSecret: string;
    readonly publicOrigin: string;
    readonly now?: () => string;
    readonly newId?: () => string;
  }) {
    this.pool = options.pool;
    this.snapshots = options.snapshots;
    this.vault = new GeoConnectorSecretVault(options.masterSecret);
    this.publicOrigin = normalizeOrigin(options.publicOrigin);
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? randomUUID;
  }

  async createConnector(input: {
    readonly user: AuthenticatedLocalUser;
    readonly geoInstanceRef: string;
    readonly geoTenantRef: string;
    readonly displayName: string;
    readonly allowedGeoOrigins: readonly string[];
    readonly callbackBaseUrl?: string | null;
  }): Promise<{
    readonly connector: GeoConnectorRecord;
    readonly clientSecret: string;
  }> {
    requireInstanceOwner(input.user);
    const id = this.newId();
    const now = normalizeTimestamp(this.now());
    const clientSecret = createGeoConnectorClientSecret();
    const allowedOrigins = Object.freeze(
      [...new Set(input.allowedGeoOrigins.map(normalizeOrigin))].sort(),
    );
    if (allowedOrigins.length < 1 || allowedOrigins.length > 10) {
      throw new Error("INVALID_GEO_ALLOWED_ORIGINS");
    }
    const callbackBaseUrl = normalizeCallbackUrl(input.callbackBaseUrl);
    try {
      const result = await this.pool.query<GeoConnectorRow>(
        `INSERT INTO geo_connector_instances
          (id, geo_instance_ref, geo_tenant_ref, display_name,
           allowed_geo_origins_json, callback_base_url, status,
           contract_version, current_secret_ciphertext,
           previous_secret_ciphertext, previous_secret_expires_at,
           created_by, created_at, updated_at, version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', $7, $8,
                 NULL, NULL, $9, $10, $10, 1)
         RETURNING id, geo_instance_ref, geo_tenant_ref, display_name,
                   allowed_geo_origins_json, callback_base_url, status,
                   contract_version, version, created_at, updated_at`,
        [
          id,
          normalizeText(input.geoInstanceRef, 160, "INVALID_GEO_INSTANCE_REF"),
          normalizeText(input.geoTenantRef, 160, "INVALID_GEO_TENANT_REF"),
          normalizeText(input.displayName, 160, "INVALID_DISPLAY_NAME"),
          JSON.stringify(allowedOrigins),
          callbackBaseUrl,
          GEO_CONNECTOR_CONTRACT_VERSION,
          this.vault.encrypt(clientSecret),
          input.user.id,
          now,
        ],
      );
      return Object.freeze({
        connector: toConnectorRecord(result.rows[0]!),
        clientSecret,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error("GEO_CONNECTOR_CONFLICT");
      }
      throw error;
    }
  }

  async listConnectors(
    user: AuthenticatedLocalUser,
  ): Promise<readonly GeoConnectorRecord[]> {
    requireInstanceAdmin(user);
    const result = await this.pool.query<GeoConnectorRow>(
      `SELECT id, geo_instance_ref, geo_tenant_ref, display_name,
              allowed_geo_origins_json, callback_base_url, status,
              contract_version, version, created_at, updated_at
       FROM geo_connector_instances
       ORDER BY created_at, id`,
    );
    return Object.freeze(result.rows.map(toConnectorRecord));
  }

  async rotateConnectorSecret(input: {
    readonly user: AuthenticatedLocalUser;
    readonly connectorId: string;
    readonly expectedVersion: number;
  }): Promise<{ readonly clientSecret: string; readonly version: number }> {
    requireInstanceOwner(input.user);
    const clientSecret = createGeoConnectorClientSecret();
    const now = normalizeTimestamp(this.now());
    const previousExpiresAt = new Date(
      Date.parse(now) + 24 * 60 * 60 * 1_000,
    ).toISOString();
    const result = await this.pool.query<{ readonly version: number }>(
      `UPDATE geo_connector_instances
       SET previous_secret_ciphertext = current_secret_ciphertext,
           previous_secret_expires_at = $1,
           current_secret_ciphertext = $2,
           updated_at = $3,
           version = version + 1
       WHERE id = $4 AND version = $5 AND status <> 'revoked'
       RETURNING version`,
      [
        previousExpiresAt,
        this.vault.encrypt(clientSecret),
        now,
        normalizeId(input.connectorId, "INVALID_GEO_CONNECTOR_ID"),
        input.expectedVersion,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("GEO_CONNECTOR_VERSION_CONFLICT");
    }
    return Object.freeze({ clientSecret, version: result.rows[0].version });
  }

  async authenticateSignedRequest(
    input: GeoSignedRequestInput,
  ): Promise<AuthenticatedGeoConnector> {
    if (input.contractVersion !== GEO_CONNECTOR_CONTRACT_VERSION) {
      throw new Error("GEO_CONTRACT_VERSION_UNSUPPORTED");
    }
    const issuedAt = normalizeTimestamp(input.issuedAt);
    const now = normalizeTimestamp(this.now());
    if (
      Math.abs(Date.parse(now) - Date.parse(issuedAt)) > SIGNATURE_WINDOW_MS
    ) {
      throw new Error("GEO_CONNECTOR_SIGNATURE_EXPIRED");
    }
    const connectorId = normalizeId(
      input.connectorId,
      "INVALID_GEO_CONNECTOR_ID",
    );
    const requestId = normalizeToken(input.requestId, "INVALID_REQUEST_ID");
    const nonce = normalizeToken(input.nonce, "INVALID_GEO_NONCE");
    const idempotencyKey = normalizeToken(
      input.idempotencyKey,
      "INVALID_IDEMPOTENCY_KEY",
    );
    const result = await this.pool.query<GeoConnectorSecretRow>(
      `SELECT id, geo_instance_ref, geo_tenant_ref, display_name,
              allowed_geo_origins_json, callback_base_url, status,
              contract_version, version, created_at, updated_at,
              current_secret_ciphertext, previous_secret_ciphertext,
              previous_secret_expires_at
       FROM geo_connector_instances
       WHERE id = $1`,
      [connectorId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("GEO_CONNECTOR_UNAUTHORIZED");
    }
    if (row.status !== "active") {
      throw new Error("GEO_CONNECTOR_SUSPENDED");
    }
    const signatureInput = {
      method: input.method,
      path: input.path,
      rawBody: input.rawBody,
      issuedAt,
      nonce,
      requestId,
      idempotencyKey,
      contractVersion: GEO_CONNECTOR_CONTRACT_VERSION,
    } as const;
    const currentSecret = this.vault.decrypt(row.current_secret_ciphertext);
    let valid = verifyGeoConnectorSignature(
      { ...signatureInput, secret: currentSecret },
      input.signature,
    );
    if (
      !valid &&
      row.previous_secret_ciphertext &&
      row.previous_secret_expires_at &&
      Date.parse(toIso(row.previous_secret_expires_at)) > Date.parse(now)
    ) {
      valid = verifyGeoConnectorSignature(
        {
          ...signatureInput,
          secret: this.vault.decrypt(row.previous_secret_ciphertext),
        },
        input.signature,
      );
    }
    if (!valid) {
      throw new Error("GEO_CONNECTOR_UNAUTHORIZED");
    }
    try {
      await this.pool.query(
        `INSERT INTO geo_connector_request_nonces
          (connector_instance_id, nonce, issued_at, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          connectorId,
          nonce,
          issuedAt,
          new Date(Date.parse(now) + NONCE_TTL_MS).toISOString(),
          now,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error("GEO_CONNECTOR_REQUEST_REPLAYED");
      }
      throw error;
    }
    return Object.freeze({
      connector: toConnectorRecord(row),
      requestId,
      idempotencyKey,
      requestHash: hashGeoConnectorRequestBody(input.rawBody),
    });
  }

  async requestBinding(input: {
    readonly auth: AuthenticatedGeoConnector;
    readonly geoWorkspaceRef: string;
    readonly geoProjectRef: string;
    readonly geoProjectDisplayName: string;
  }): Promise<GeoProjectBindingRecord> {
    const existing = await this.findIdempotentBinding(input.auth);
    if (existing) return existing;
    const id = this.newId();
    const now = normalizeTimestamp(this.now());
    try {
      const result = await this.pool.query<GeoProjectBindingRow>(
        `INSERT INTO geo_project_bindings
          (id, connector_instance_id, geo_workspace_ref, geo_project_ref,
           geo_project_display_name, scope_id, status, request_id,
           idempotency_key, request_hash, requested_at, decided_by,
           decided_at, decision_reason, updated_at, version)
         VALUES ($1, $2, $3, $4, $5, NULL, 'pending_wentian', $6, $7,
                 $8, $9, NULL, NULL, NULL, $9, 1)
         RETURNING ${BINDING_COLUMNS}`,
        [
          id,
          input.auth.connector.id,
          normalizeText(
            input.geoWorkspaceRef,
            160,
            "INVALID_GEO_WORKSPACE_REF",
          ),
          normalizeText(input.geoProjectRef, 160, "INVALID_GEO_PROJECT_REF"),
          normalizeText(
            input.geoProjectDisplayName,
            200,
            "INVALID_DISPLAY_NAME",
          ),
          input.auth.requestId,
          input.auth.idempotencyKey,
          input.auth.requestHash,
          now,
        ],
      );
      return toBindingRecord(result.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findIdempotentBinding(input.auth);
        if (replay) return replay;
        throw new Error("GEO_BINDING_CONFLICT");
      }
      throw error;
    }
  }

  async listBindings(
    user: AuthenticatedLocalUser,
    status?: GeoProjectBindingRecord["status"],
  ): Promise<readonly GeoProjectBindingRecord[]> {
    requireInstanceAdmin(user);
    const values: unknown[] = [];
    const condition = status ? "WHERE status = $1" : "";
    if (status) values.push(status);
    const result = await this.pool.query<GeoProjectBindingRow>(
      `SELECT ${BINDING_COLUMNS}
       FROM geo_project_bindings ${condition}
       ORDER BY requested_at, id`,
      values,
    );
    return Object.freeze(result.rows.map(toBindingRecord));
  }

  async approveBinding(input: {
    readonly user: AuthenticatedLocalUser;
    readonly bindingId: string;
    readonly scopeId: string;
    readonly expectedVersion: number;
  }): Promise<GeoProjectBindingRecord> {
    requireInstanceAdmin(input.user);
    requireScopeAccess(input.user, input.scopeId);
    const now = normalizeTimestamp(this.now());
    try {
      const result = await this.pool.query<GeoProjectBindingRow>(
        `UPDATE geo_project_bindings b
         SET scope_id = $1, status = 'active', decided_by = $2,
             decided_at = $3, decision_reason = NULL, updated_at = $3,
             version = b.version + 1
         FROM scopes s
         WHERE b.id = $4 AND b.version = $5
           AND b.status = 'pending_wentian'
           AND s.id = $1 AND s.status = 'active'
           AND EXISTS (
             SELECT 1 FROM scope_memberships membership
             WHERE membership.scope_id = s.id
               AND membership.user_id = $2
               AND membership.role IN ('owner', 'admin')
           )
         RETURNING ${BINDING_COLUMNS_PREFIXED}`,
        [
          normalizeId(input.scopeId, "INVALID_SCOPE_ID"),
          input.user.id,
          now,
          normalizeId(input.bindingId, "INVALID_GEO_BINDING_ID"),
          input.expectedVersion,
        ],
      );
      if (!result.rows[0]) {
        throw new Error("GEO_BINDING_VERSION_CONFLICT");
      }
      return toBindingRecord(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error("GEO_BINDING_CONFLICT");
      }
      throw error;
    }
  }

  async rejectBinding(input: {
    readonly user: AuthenticatedLocalUser;
    readonly bindingId: string;
    readonly reason: string;
    readonly expectedVersion: number;
  }): Promise<GeoProjectBindingRecord> {
    requireInstanceAdmin(input.user);
    const now = normalizeTimestamp(this.now());
    const result = await this.pool.query<GeoProjectBindingRow>(
      `UPDATE geo_project_bindings
       SET status = 'rejected', decided_by = $1, decided_at = $2,
           decision_reason = $3, updated_at = $2, version = version + 1
       WHERE id = $4 AND version = $5 AND status = 'pending_wentian'
       RETURNING ${BINDING_COLUMNS}`,
      [
        input.user.id,
        now,
        normalizeText(input.reason, 500, "INVALID_REJECTION_REASON"),
        normalizeId(input.bindingId, "INVALID_GEO_BINDING_ID"),
        input.expectedVersion,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("GEO_BINDING_VERSION_CONFLICT");
    }
    return toBindingRecord(result.rows[0]);
  }

  async withdrawBinding(
    auth: AuthenticatedGeoConnector,
    bindingId: string,
  ): Promise<GeoProjectBindingRecord> {
    const now = normalizeTimestamp(this.now());
    const result = await this.pool.query<GeoProjectBindingRow>(
      `UPDATE geo_project_bindings
       SET status = 'disconnected', decided_at = $1,
           decision_reason = 'withdrawn_by_geo', updated_at = $1,
           version = version + 1
       WHERE id = $2 AND connector_instance_id = $3
         AND status = 'pending_wentian'
       RETURNING ${BINDING_COLUMNS}`,
      [
        now,
        normalizeId(bindingId, "INVALID_GEO_BINDING_ID"),
        auth.connector.id,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("GEO_BINDING_NOT_FOUND");
    }
    return toBindingRecord(result.rows[0]);
  }

  async findBindingByGeoProject(
    auth: AuthenticatedGeoConnector,
    geoProjectRef: string,
  ): Promise<GeoProjectBindingRecord> {
    const result = await this.pool.query<GeoProjectBindingRow>(
      `SELECT ${BINDING_COLUMNS}
       FROM geo_project_bindings
       WHERE connector_instance_id = $1 AND geo_project_ref = $2
       ORDER BY requested_at DESC, id DESC
       LIMIT 1`,
      [
        auth.connector.id,
        normalizeText(geoProjectRef, 160, "INVALID_GEO_PROJECT_REF"),
      ],
    );
    if (!result.rows[0]) {
      throw new Error("GEO_BINDING_NOT_FOUND");
    }
    return toBindingRecord(result.rows[0]);
  }

  async disconnectBinding(
    auth: AuthenticatedGeoConnector,
    bindingId: string,
  ): Promise<GeoProjectBindingRecord> {
    const id = normalizeId(bindingId, "INVALID_GEO_BINDING_ID");
    const now = normalizeTimestamp(this.now());
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<GeoProjectBindingRow>(
        `SELECT ${BINDING_COLUMNS}
         FROM geo_project_bindings
         WHERE id = $1 AND connector_instance_id = $2
         FOR UPDATE`,
        [id, auth.connector.id],
      );
      const binding = found.rows[0];
      if (!binding || !["active", "suspended"].includes(binding.status)) {
        throw new Error("GEO_BINDING_NOT_FOUND");
      }
      await revokeBindingAccess(client, id, binding.scope_id, now);
      const updated = await client.query<GeoProjectBindingRow>(
        `UPDATE geo_project_bindings
         SET status = 'disconnected', decided_at = $2,
             decision_reason = 'disconnected_by_geo', updated_at = $2,
             version = version + 1
         WHERE id = $1
         RETURNING ${BINDING_COLUMNS}`,
        [id, now],
      );
      await client.query("COMMIT");
      return toBindingRecord(updated.rows[0]!);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async issueSsoTicket(input: {
    readonly auth: AuthenticatedGeoConnector;
    readonly geoUserRef: string;
    readonly geoProjectRef: string;
    readonly displayName: string;
    readonly roleCodes: readonly string[];
    readonly requestedPath?: string;
  }): Promise<{ readonly launchUrl: string; readonly expiresAt: string }> {
    const existing = await this.findIdempotentTicket(input.auth);
    if (existing) return existing;
    const role = mapGeoRoles(input.roleCodes);
    const requestedPath = normalizeRequestedPath(input.requestedPath);
    const now = normalizeTimestamp(this.now());
    const expiresAt = new Date(
      Date.parse(now) + SSO_TICKET_TTL_MS,
    ).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const bindingResult = await client.query<GeoProjectBindingRow>(
        `SELECT ${BINDING_COLUMNS}
         FROM geo_project_bindings
         WHERE connector_instance_id = $1 AND geo_project_ref = $2
           AND status = 'active'
         FOR UPDATE`,
        [
          input.auth.connector.id,
          normalizeText(input.geoProjectRef, 160, "INVALID_GEO_PROJECT_REF"),
        ],
      );
      const binding = bindingResult.rows[0];
      if (!binding?.scope_id) {
        throw new Error("GEO_BINDING_NOT_FOUND");
      }
      const identity = await this.getOrCreateIdentity(client, {
        connectorId: input.auth.connector.id,
        geoUserRef: input.geoUserRef,
        displayName: input.displayName,
        now,
      });
      const access = await upsertGeoAccess(client, {
        newId: this.newId,
        bindingId: binding.id,
        identityId: identity.identityId,
        localUserId: identity.localUserId,
        scopeId: binding.scope_id,
        role,
        now,
      });
      const code = randomBytes(32).toString("base64url");
      await client.query(
        `INSERT INTO geo_sso_tickets
          (id, connector_instance_id, project_binding_id, access_binding_id,
           code_hash, code_ciphertext, request_id, idempotency_key,
           request_hash, requested_path, binding_version, access_version,
           expires_at, consumed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, NULL, $14)`,
        [
          this.newId(),
          input.auth.connector.id,
          binding.id,
          access.id,
          sha256(code),
          this.vault.encrypt(code),
          input.auth.requestId,
          input.auth.idempotencyKey,
          input.auth.requestHash,
          requestedPath,
          binding.version,
          access.accessVersion,
          expiresAt,
          now,
        ],
      );
      await client.query("COMMIT");
      return Object.freeze({
        launchUrl: this.launchUrl(code),
        expiresAt,
      });
    } catch (error) {
      await rollback(client);
      if (isUniqueViolation(error)) {
        const replay = await this.findIdempotentTicket(input.auth);
        if (replay) return replay;
        throw new Error("GEO_BINDING_CONFLICT");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeSsoTicket(code: string): Promise<GeoSessionConsumption> {
    const normalizedCode = normalizeLaunchCode(code);
    const now = normalizeTimestamp(this.now());
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.parse(now) + GEO_SESSION_TTL_MS,
    ).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<GeoTicketConsumptionRow>(
        `SELECT t.id, t.requested_path, t.binding_version, t.access_version,
                t.expires_at, t.consumed_at, b.id AS binding_id,
                b.scope_id, b.status AS binding_status, b.version,
                a.id AS access_id, a.status AS access_status,
                a.access_version AS current_access_version,
                i.local_user_id, c.status AS connector_status
         FROM geo_sso_tickets t
         JOIN geo_connector_instances c ON c.id = t.connector_instance_id
         JOIN geo_project_bindings b ON b.id = t.project_binding_id
         JOIN geo_project_access_bindings a ON a.id = t.access_binding_id
         JOIN geo_identity_bindings i ON i.id = a.identity_binding_id
         WHERE t.code_hash = $1
         FOR UPDATE OF t`,
        [sha256(normalizedCode)],
      );
      const row = result.rows[0];
      if (!row || Date.parse(toIso(row.expires_at)) <= Date.parse(now)) {
        throw new Error("GEO_SSO_TICKET_EXPIRED");
      }
      if (row.consumed_at !== null) {
        throw new Error("GEO_SSO_TICKET_REPLAYED");
      }
      if (
        row.connector_status !== "active" ||
        row.binding_status !== "active" ||
        row.access_status !== "active" ||
        !row.scope_id ||
        row.version !== row.binding_version ||
        row.current_access_version !== row.access_version
      ) {
        throw new Error("GEO_BINDING_NOT_FOUND");
      }
      await client.query(
        "UPDATE geo_sso_tickets SET consumed_at = $2 WHERE id = $1",
        [row.id, now],
      );
      await client.query(
        `INSERT INTO local_sessions
          (id, user_id, token_hash, expires_at, revoked_at, created_at,
           auth_source, geo_project_binding_id, geo_access_binding_id,
           binding_version, access_version)
         VALUES ($1, $2, $3, $4, NULL, $5, 'geo', $6, $7, $8, $9)`,
        [
          this.newId(),
          row.local_user_id,
          sha256(sessionToken),
          expiresAt,
          now,
          row.binding_id,
          row.access_id,
          row.binding_version,
          row.access_version,
        ],
      );
      await client.query("COMMIT");
      return Object.freeze({
        sessionToken,
        expiresAt,
        redirectPath: row.requested_path ?? "/",
      });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async syncQuerySet(input: {
    readonly auth: AuthenticatedGeoConnector;
    readonly bindingId: string;
    readonly geoQuerySetRef: string;
    readonly geoRevision: string;
    readonly title: string;
    readonly locale: string;
    readonly market?: string | null;
    readonly queries: readonly {
      readonly externalKey: string;
      readonly text: string;
      readonly intent: QueryIntentCode;
      readonly commercialValue?: CommercialValue;
    }[];
  }): Promise<{
    readonly snapshotId: string;
    readonly snapshotHash: string;
    readonly queryCount: number;
    readonly created: boolean;
  }> {
    const bindingId = normalizeId(input.bindingId, "INVALID_GEO_BINDING_ID");
    const existing = await this.findIdempotentSync(input.auth, {
      bindingId,
      geoQuerySetRef: input.geoQuerySetRef,
      geoRevision: input.geoRevision,
    });
    if (existing) return existing;
    const binding = await this.pool.query<GeoProjectBindingRow>(
      `SELECT ${BINDING_COLUMNS}
       FROM geo_project_bindings
       WHERE id = $1 AND connector_instance_id = $2 AND status = 'active'`,
      [bindingId, input.auth.connector.id],
    );
    const bindingRow = binding.rows[0];
    if (!bindingRow?.scope_id || !bindingRow.decided_by) {
      throw new Error("GEO_BINDING_NOT_FOUND");
    }
    const scope = await this.pool.query<{ readonly status: string }>(
      "SELECT status FROM scopes WHERE id = $1",
      [bindingRow.scope_id],
    );
    if (scope.rows[0]?.status !== "active") {
      throw new Error("GEO_BINDING_NOT_FOUND");
    }
    const queries = [...input.queries]
      .map((query) => ({
        externalKey: normalizeText(
          query.externalKey,
          120,
          "GEO_QUERY_SET_INVALID",
        ),
        queryText: normalizeText(query.text, 1_000, "GEO_QUERY_SET_INVALID"),
        intentCode: query.intent,
        commercialValue: query.commercialValue ?? "medium",
      }))
      .sort((left, right) =>
        left.externalKey.localeCompare(right.externalKey, "en"),
      );
    const snapshot = createQuerySetSnapshot({
      id: this.newId(),
      itemIds: queries.map(() => this.newId()),
      scopeId: bindingRow.scope_id,
      title: input.title,
      locale: input.locale,
      market: input.market,
      source: {
        type: "geo_sync",
        ref: normalizeText(input.geoQuerySetRef, 160, "GEO_QUERY_SET_INVALID"),
        revision: normalizeText(
          input.geoRevision,
          160,
          "GEO_QUERY_SET_INVALID",
        ),
        geoBindingId: bindingId,
        contractVersion: GEO_CONNECTOR_CONTRACT_VERSION,
      },
      queries,
      createdBy: bindingRow.decided_by,
      createdAt: normalizeTimestamp(this.now()),
    });
    const stored = await this.snapshots.getOrCreate(snapshot);
    try {
      await this.pool.query(
        `INSERT INTO geo_query_set_syncs
          (id, connector_instance_id, project_binding_id, geo_query_set_ref,
           geo_revision, request_id, idempotency_key, request_hash,
           snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          this.newId(),
          input.auth.connector.id,
          bindingId,
          input.geoQuerySetRef,
          input.geoRevision,
          input.auth.requestId,
          input.auth.idempotencyKey,
          input.auth.requestHash,
          stored.snapshot.id,
          normalizeTimestamp(this.now()),
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findIdempotentSync(input.auth, {
          bindingId,
          geoQuerySetRef: input.geoQuerySetRef,
          geoRevision: input.geoRevision,
        });
        if (replay) return replay;
        throw new Error("GEO_QUERY_SET_INVALID");
      }
      throw error;
    }
    return Object.freeze({
      snapshotId: stored.snapshot.id,
      snapshotHash: stored.snapshot.snapshotHash,
      queryCount: stored.snapshot.queryCount,
      created: stored.created,
    });
  }

  private async findIdempotentBinding(
    auth: AuthenticatedGeoConnector,
  ): Promise<GeoProjectBindingRecord | null> {
    const result = await this.pool.query<GeoProjectBindingRow>(
      `SELECT ${BINDING_COLUMNS}
       FROM geo_project_bindings
       WHERE connector_instance_id = $1
         AND (idempotency_key = $2 OR request_id = $3)
       ORDER BY (idempotency_key = $2) DESC
       LIMIT 1`,
      [auth.connector.id, auth.idempotencyKey, auth.requestId],
    );
    if (!result.rows[0]) return null;
    if (result.rows[0].request_hash !== auth.requestHash) {
      throw new Error("GEO_IDEMPOTENCY_CONFLICT");
    }
    return toBindingRecord(result.rows[0]);
  }

  private async findIdempotentTicket(auth: AuthenticatedGeoConnector): Promise<{
    readonly launchUrl: string;
    readonly expiresAt: string;
  } | null> {
    const result = await this.pool.query<GeoTicketIdempotencyRow>(
      `SELECT code_ciphertext, request_hash, expires_at
       FROM geo_sso_tickets
       WHERE connector_instance_id = $1
         AND (idempotency_key = $2 OR request_id = $3)
       ORDER BY (idempotency_key = $2) DESC
       LIMIT 1`,
      [auth.connector.id, auth.idempotencyKey, auth.requestId],
    );
    if (!result.rows[0]) return null;
    if (result.rows[0].request_hash !== auth.requestHash) {
      throw new Error("GEO_IDEMPOTENCY_CONFLICT");
    }
    return Object.freeze({
      launchUrl: this.launchUrl(
        this.vault.decrypt(result.rows[0].code_ciphertext),
      ),
      expiresAt: toIso(result.rows[0].expires_at),
    });
  }

  private async findIdempotentSync(
    auth: AuthenticatedGeoConnector,
    key: {
      readonly bindingId: string;
      readonly geoQuerySetRef: string;
      readonly geoRevision: string;
    },
  ): Promise<{
    readonly snapshotId: string;
    readonly snapshotHash: string;
    readonly queryCount: number;
    readonly created: false;
  } | null> {
    const result = await this.pool.query<{
      readonly request_hash: string;
      readonly snapshot_id: string;
      readonly snapshot_json: {
        readonly snapshotHash: string;
        readonly queryCount: number;
      };
    }>(
      `SELECT sync.request_hash, sync.snapshot_id, snapshot.snapshot_json
       FROM geo_query_set_syncs sync
       JOIN query_set_snapshots snapshot ON snapshot.id = sync.snapshot_id
       WHERE sync.connector_instance_id = $1
         AND (
           sync.idempotency_key = $2 OR sync.request_id = $3
           OR (
             sync.project_binding_id = $4
             AND sync.geo_query_set_ref = $5
             AND sync.geo_revision = $6
           )
         )
       ORDER BY (sync.idempotency_key = $2) DESC
       LIMIT 1`,
      [
        auth.connector.id,
        auth.idempotencyKey,
        auth.requestId,
        key.bindingId,
        key.geoQuerySetRef,
        key.geoRevision,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.request_hash !== auth.requestHash) {
      throw new Error("GEO_IDEMPOTENCY_CONFLICT");
    }
    return Object.freeze({
      snapshotId: row.snapshot_id,
      snapshotHash: row.snapshot_json.snapshotHash,
      queryCount: row.snapshot_json.queryCount,
      created: false,
    });
  }

  private async getOrCreateIdentity(
    client: PoolClient,
    input: {
      readonly connectorId: string;
      readonly geoUserRef: string;
      readonly displayName: string;
      readonly now: string;
    },
  ): Promise<{ readonly identityId: string; readonly localUserId: string }> {
    const geoUserRef = normalizeText(
      input.geoUserRef,
      160,
      "INVALID_GEO_USER_REF",
    );
    const displayName = normalizeText(
      input.displayName,
      120,
      "INVALID_DISPLAY_NAME",
    );
    const existing = await client.query<{
      readonly id: string;
      readonly local_user_id: string;
    }>(
      `SELECT id, local_user_id
       FROM geo_identity_bindings
       WHERE connector_instance_id = $1 AND geo_user_ref = $2
       FOR UPDATE`,
      [input.connectorId, geoUserRef],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE geo_identity_bindings
         SET display_name = $2, status = 'active', updated_at = $3
         WHERE id = $1`,
        [existing.rows[0].id, displayName, input.now],
      );
      await client.query(
        `UPDATE local_users
         SET display_name = $2, status = 'active', updated_at = $3
         WHERE id = $1 AND auth_source = 'geo'`,
        [existing.rows[0].local_user_id, displayName, input.now],
      );
      return {
        identityId: existing.rows[0].id,
        localUserId: existing.rows[0].local_user_id,
      };
    }
    const localUserId = this.newId();
    const identityId = this.newId();
    const syntheticEmail = `geo-${sha256(`${input.connectorId}:${geoUserRef}`).slice(0, 32)}@external.invalid`;
    await client.query(
      `INSERT INTO local_users
        (id, email_normalized, display_name, password_hash, status,
         created_at, updated_at, auth_source)
       VALUES ($1, $2, $3, NULL, 'active', $4, $4, 'geo')`,
      [localUserId, syntheticEmail, displayName, input.now],
    );
    await client.query(
      `INSERT INTO geo_identity_bindings
        (id, connector_instance_id, geo_user_ref, local_user_id,
         display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
      [
        identityId,
        input.connectorId,
        geoUserRef,
        localUserId,
        displayName,
        input.now,
      ],
    );
    return { identityId, localUserId };
  }

  private launchUrl(code: string): string {
    return `${this.publicOrigin}/connect/geo?code=${encodeURIComponent(code)}`;
  }
}

async function upsertGeoAccess(
  client: PoolClient,
  input: {
    readonly newId: () => string;
    readonly bindingId: string;
    readonly identityId: string;
    readonly localUserId: string;
    readonly scopeId: string;
    readonly role: "admin" | "analyst" | "viewer";
    readonly now: string;
  },
): Promise<{ readonly id: string; readonly accessVersion: number }> {
  const existing = await client.query<{
    readonly id: string;
    readonly role: "admin" | "analyst" | "viewer";
    readonly status: "active" | "revoked";
    readonly access_version: number;
  }>(
    `SELECT id, role, status, access_version
     FROM geo_project_access_bindings
     WHERE project_binding_id = $1 AND identity_binding_id = $2
     FOR UPDATE`,
    [input.bindingId, input.identityId],
  );
  let id: string;
  let accessVersion: number;
  if (existing.rows[0]) {
    id = existing.rows[0].id;
    const changed =
      existing.rows[0].role !== input.role ||
      existing.rows[0].status !== "active";
    accessVersion = existing.rows[0].access_version + (changed ? 1 : 0);
    await client.query(
      `UPDATE geo_project_access_bindings
       SET role = $2, status = 'active', access_version = $3, updated_at = $4
       WHERE id = $1`,
      [id, input.role, accessVersion, input.now],
    );
  } else {
    id = input.newId();
    accessVersion = 1;
    await client.query(
      `INSERT INTO geo_project_access_bindings
        (id, project_binding_id, identity_binding_id, role, status,
         access_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', 1, $5, $5)`,
      [id, input.bindingId, input.identityId, input.role, input.now],
    );
  }
  await client.query(
    `INSERT INTO scope_memberships (scope_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (scope_id, user_id)
     DO UPDATE SET role = EXCLUDED.role`,
    [input.scopeId, input.localUserId, input.role, input.now],
  );
  return { id, accessVersion };
}

async function revokeBindingAccess(
  client: PoolClient,
  bindingId: string,
  scopeId: string | null,
  now: string,
): Promise<void> {
  await client.query(
    `UPDATE local_sessions
     SET revoked_at = COALESCE(revoked_at, $2)
     WHERE geo_project_binding_id = $1`,
    [bindingId, now],
  );
  if (scopeId) {
    await client.query(
      `DELETE FROM scope_memberships membership
       USING geo_project_access_bindings access,
             geo_identity_bindings identity
       WHERE access.project_binding_id = $1
         AND identity.id = access.identity_binding_id
         AND membership.scope_id = $2
         AND membership.user_id = identity.local_user_id`,
      [bindingId, scopeId],
    );
  }
  await client.query(
    `UPDATE geo_project_access_bindings
     SET status = 'revoked', access_version = access_version + 1,
         updated_at = $2
     WHERE project_binding_id = $1 AND status = 'active'`,
    [bindingId, now],
  );
}

const BINDING_COLUMNS = `id, connector_instance_id, geo_workspace_ref,
  geo_project_ref, geo_project_display_name, scope_id, status, request_id,
  idempotency_key, request_hash, requested_at, decided_by, decided_at,
  decision_reason, updated_at, version`;
const BINDING_COLUMNS_PREFIXED = `b.id, b.connector_instance_id,
  b.geo_workspace_ref, b.geo_project_ref, b.geo_project_display_name,
  b.scope_id, b.status, b.request_id, b.idempotency_key, b.request_hash,
  b.requested_at, b.decided_by, b.decided_at, b.decision_reason,
  b.updated_at, b.version`;

interface GeoConnectorRow {
  readonly id: string;
  readonly geo_instance_ref: string;
  readonly geo_tenant_ref: string;
  readonly display_name: string;
  readonly allowed_geo_origins_json: unknown;
  readonly callback_base_url: string | null;
  readonly status: "active" | "suspended" | "revoked";
  readonly contract_version: string;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface GeoConnectorSecretRow extends GeoConnectorRow {
  readonly current_secret_ciphertext: string;
  readonly previous_secret_ciphertext: string | null;
  readonly previous_secret_expires_at: Date | string | null;
}

interface GeoProjectBindingRow {
  readonly id: string;
  readonly connector_instance_id: string;
  readonly geo_workspace_ref: string;
  readonly geo_project_ref: string;
  readonly geo_project_display_name: string;
  readonly scope_id: string | null;
  readonly status: GeoProjectBindingRecord["status"];
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly request_hash: string;
  readonly requested_at: Date | string;
  readonly decided_by: string | null;
  readonly decided_at: Date | string | null;
  readonly decision_reason: string | null;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface GeoTicketIdempotencyRow {
  readonly code_ciphertext: string;
  readonly request_hash: string;
  readonly expires_at: Date | string;
}

interface GeoTicketConsumptionRow {
  readonly id: string;
  readonly requested_path: string | null;
  readonly binding_version: number;
  readonly access_version: number;
  readonly expires_at: Date | string;
  readonly consumed_at: Date | string | null;
  readonly binding_id: string;
  readonly scope_id: string | null;
  readonly binding_status: string;
  readonly version: number;
  readonly access_id: string;
  readonly access_status: string;
  readonly current_access_version: number;
  readonly local_user_id: string;
  readonly connector_status: string;
}

function toConnectorRecord(row: GeoConnectorRow): GeoConnectorRecord {
  if (row.contract_version !== GEO_CONNECTOR_CONTRACT_VERSION) {
    throw new Error("GEO_CONTRACT_VERSION_UNSUPPORTED");
  }
  const origins = row.allowed_geo_origins_json;
  if (
    !Array.isArray(origins) ||
    !origins.every((item) => typeof item === "string")
  ) {
    throw new Error("GEO_CONNECTOR_DATA_INVALID");
  }
  return Object.freeze({
    id: row.id,
    geoInstanceRef: row.geo_instance_ref,
    geoTenantRef: row.geo_tenant_ref,
    displayName: row.display_name,
    allowedGeoOrigins: Object.freeze(origins.map(normalizeOrigin)),
    callbackBaseUrl: row.callback_base_url,
    status: row.status,
    contractVersion: GEO_CONNECTOR_CONTRACT_VERSION,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function toBindingRecord(row: GeoProjectBindingRow): GeoProjectBindingRecord {
  return Object.freeze({
    id: row.id,
    connectorInstanceId: row.connector_instance_id,
    geoWorkspaceRef: row.geo_workspace_ref,
    geoProjectRef: row.geo_project_ref,
    geoProjectDisplayName: row.geo_project_display_name,
    scopeId: row.scope_id,
    status: row.status,
    version: row.version,
    requestedAt: toIso(row.requested_at),
    updatedAt: toIso(row.updated_at),
    decisionReason: row.decision_reason,
  });
}

function mapGeoRoles(
  roleCodes: readonly string[],
): "admin" | "analyst" | "viewer" {
  const roles = new Set(roleCodes);
  if (
    roles.has("owner") ||
    roles.has("admin") ||
    roles.has("tenant_owner") ||
    roles.has("tenant_admin")
  ) {
    return "admin";
  }
  if (roles.has("analyst")) return "analyst";
  if (roles.has("viewer")) return "viewer";
  throw new Error("GEO_ROLE_NOT_MAPPED");
}

function normalizeRequestedPath(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized === "/") return normalized;
  if (
    /^\/scopes\/[0-9a-f-]{36}$/i.test(normalized) &&
    !normalized.includes("\\")
  ) {
    return normalized;
  }
  throw new Error("INVALID_GEO_REQUESTED_PATH");
}

function normalizeLaunchCode(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new Error("GEO_SSO_TICKET_EXPIRED");
  }
  return normalized;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value.replace(/\/$/, "") || url.username || url.password) {
    throw new Error("INVALID_GEO_ORIGIN");
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  ) {
    throw new Error("INVALID_GEO_ORIGIN");
  }
  return url.origin;
}

function normalizeCallbackUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("INVALID_GEO_CALLBACK_URL");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeText(value: string, max: number, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(errorCode);
  return normalized;
}

function normalizeToken(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeId(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error("INVALID_TIMESTAMP");
  return new Date(value).toISOString();
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireInstanceOwner(user: AuthenticatedLocalUser): void {
  if (user.instanceRole !== "owner") throw new Error("ACTION_FORBIDDEN");
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
