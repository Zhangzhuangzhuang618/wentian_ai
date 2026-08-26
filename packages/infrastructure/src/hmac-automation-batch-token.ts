import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface AutomationBatchTokenClaims {
  readonly systemInstanceId: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly userId: string;
  readonly audienceOrigin: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export class HmacAutomationBatchTokenService {
  private readonly secret: Buffer;

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("AUTOMATION_BATCH_TOKEN_SECRET_TOO_SHORT");
    }
    this.secret = Buffer.from(secret, "utf8");
  }

  issue(input: Omit<AutomationBatchTokenClaims, "nonce">): {
    readonly token: string;
    readonly claims: AutomationBatchTokenClaims;
  } {
    const claims = normalizeClaims({
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

  async verify(token: string): Promise<AutomationBatchTokenClaims> {
    const [payload, signature, extra] = token.trim().split(".");
    if (!payload || !signature || extra || payload.length > 4_096) {
      throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
    }
    const expected = Buffer.from(this.sign(payload), "utf8");
    const actual = Buffer.from(signature, "utf8");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
    }
    try {
      return normalizeClaims(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch {
      throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(`wentian-automation-batch-token@1:${payload}`, "utf8")
      .digest("base64url");
  }
}

function normalizeClaims(value: unknown): AutomationBatchTokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
  }
  const input = value as Record<string, unknown>;
  const expectedKeys = [
    "audienceOrigin",
    "expiresAt",
    "issuedAt",
    "nonce",
    "runId",
    "scopeId",
    "systemInstanceId",
    "userId",
  ];
  if (Object.keys(input).sort().join("\n") !== expectedKeys.join("\n")) {
    throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
  }
  const claims = {
    systemInstanceId: requiredText(input.systemInstanceId),
    scopeId: requiredText(input.scopeId),
    runId: requiredText(input.runId),
    userId: requiredText(input.userId),
    audienceOrigin: new URL(requiredText(input.audienceOrigin)).origin,
    nonce: requiredText(input.nonce),
    issuedAt: requiredIsoTime(input.issuedAt),
    expiresAt: requiredIsoTime(input.expiresAt),
  };
  if (Date.parse(claims.expiresAt) <= Date.parse(claims.issuedAt)) {
    throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
  }
  return Object.freeze(claims);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) {
    throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
  }
  return value.trim();
}

function requiredIsoTime(value: unknown): string {
  const text = requiredText(value);
  if (
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString() !== text
  ) {
    throw new Error("AUTOMATION_BATCH_TOKEN_INVALID");
  }
  return text;
}
