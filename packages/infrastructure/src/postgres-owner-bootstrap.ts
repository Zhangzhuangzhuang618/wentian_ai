import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { hashLocalPassword } from "./local-password.ts";

export interface InitializeOwnerInput {
  readonly plaintextToken: string;
  readonly expectedTokenSha256: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
}

export interface InitializedOwner {
  readonly userId: string;
  readonly emailNormalized: string;
  readonly initializedAt: string;
}

export class PostgresOwnerBootstrapService {
  private readonly pool: Pick<Pool, "connect">;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(options: {
    readonly pool: Pick<Pool, "connect">;
    readonly newId?: () => string;
    readonly now?: () => string;
  }) {
    this.pool = options.pool;
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async execute(input: InitializeOwnerInput): Promise<InitializedOwner> {
    assertBootstrapToken(input.plaintextToken, input.expectedTokenSha256);
    const emailNormalized = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    const passwordHash = await hashLocalPassword(input.password);
    const userId = this.newId();
    const initializedAt = normalizeTimestamp(this.now());
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const instance = await client.query<{
        readonly id: string;
        readonly owner_initialized_at: Date | string | null;
      }>(
        `SELECT id, owner_initialized_at
         FROM wentian_instances
         WHERE singleton = true
         FOR UPDATE`,
      );
      if (instance.rowCount !== 1) {
        throw new Error("WENTIAN_INSTANCE_NOT_INITIALIZED");
      }
      if (instance.rows[0]!.owner_initialized_at !== null) {
        throw new Error("OWNER_ALREADY_INITIALIZED");
      }

      await client.query(
        `INSERT INTO local_users
          (id, email_normalized, display_name, password_hash, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
        [userId, emailNormalized, displayName, passwordHash, initializedAt],
      );
      await client.query(
        `INSERT INTO instance_memberships (user_id, role, created_at)
         VALUES ($1, 'owner', $2)`,
        [userId, initializedAt],
      );
      const updated = await client.query(
        `UPDATE wentian_instances
         SET owner_user_id = $1, owner_initialized_at = $2
         WHERE id = $3 AND owner_initialized_at IS NULL`,
        [userId, initializedAt, instance.rows[0]!.id],
      );
      if (updated.rowCount !== 1) {
        throw new Error("OWNER_ALREADY_INITIALIZED");
      }
      await client.query("COMMIT");
      return Object.freeze({ userId, emailNormalized, initializedAt });
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function assertBootstrapToken(
  plaintextToken: string,
  expectedTokenSha256: string,
): void {
  const expected = expectedTokenSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("INVALID_OWNER_INIT_TOKEN_DIGEST");
  }
  if (typeof plaintextToken !== "string" || plaintextToken.length < 32) {
    throw new Error("INVALID_OWNER_INIT_TOKEN");
  }
  const actual = createHash("sha256").update(plaintextToken, "utf8").digest();
  if (!timingSafeEqual(actual, Buffer.from(expected, "hex"))) {
    throw new Error("OWNER_INIT_TOKEN_MISMATCH");
  }
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)
  ) {
    throw new Error("INVALID_OWNER_EMAIL");
  }
  return normalized;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new Error("INVALID_OWNER_DISPLAY_NAME");
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("INVALID_OWNER_INITIALIZED_AT");
  }
  return value;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
