import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type {
  CaptureTokenNonceRepository,
  CaptureTokenVerifier,
} from "@wentian/application";
import {
  createCaptureTokenClaims,
  type CaptureTokenClaims,
} from "@wentian/domain";
import type { Pool } from "pg";

export class HmacCaptureTokenService implements CaptureTokenVerifier {
  private readonly secret: Buffer;

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("CAPTURE_TOKEN_SECRET_TOO_SHORT");
    }
    this.secret = Buffer.from(secret, "utf8");
  }

  issue(input: Omit<CaptureTokenClaims, "nonce">): {
    readonly token: string;
    readonly claims: CaptureTokenClaims;
  } {
    const claims = createCaptureTokenClaims({
      ...input,
      nonce: randomBytes(24).toString("base64url"),
    });
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
      "base64url",
    );
    return Object.freeze({
      token: `${payload}.${this.sign(payload)}`,
      claims,
    });
  }

  async verify(token: string): Promise<CaptureTokenClaims> {
    const [payload, signature, extra] = token.trim().split(".");
    if (!payload || !signature || extra || payload.length > 4_096) {
      throw new Error("CAPTURE_TOKEN_INVALID");
    }
    const expected = Buffer.from(this.sign(payload), "utf8");
    const actual = Buffer.from(signature, "utf8");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new Error("CAPTURE_TOKEN_INVALID");
    }
    try {
      return createCaptureTokenClaims(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch {
      throw new Error("CAPTURE_TOKEN_INVALID");
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(`wentian-capture-token@1:${payload}`, "utf8")
      .digest("base64url");
  }
}

export class PostgresCaptureTokenNonceRepository implements CaptureTokenNonceRepository {
  private readonly now: () => string;
  private readonly pool: Pick<Pool, "query">;

  constructor(
    pool: Pick<Pool, "query">,
    options: { readonly now?: () => string } = {},
  ) {
    this.pool = pool;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async issue(claims: CaptureTokenClaims): Promise<void> {
    const verified = createCaptureTokenClaims(claims);
    await this.pool.query(
      `INSERT INTO capture_token_nonces
        (nonce_hash, scope_id, observation_task_id, expires_at, consumed_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [
        sha256(verified.nonce),
        verified.scopeId,
        verified.taskId,
        verified.expiresAt,
        verified.issuedAt,
      ],
    );
  }

  async consumeOnce(nonce: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE capture_token_nonces
       SET consumed_at = $2
       WHERE nonce_hash = $1
         AND consumed_at IS NULL
         AND expires_at > $2`,
      [sha256(nonce), this.now()],
    );
    return result.rowCount === 1;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
