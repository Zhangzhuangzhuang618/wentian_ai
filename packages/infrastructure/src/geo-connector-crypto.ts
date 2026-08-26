import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const WENTIAN_GEO_CONNECTOR_CONTRACT_VERSION =
  "wentian-geo-connector@1" as const;

export interface GeoConnectorSignatureInput {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly rawBody: string;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly contractVersion?: typeof WENTIAN_GEO_CONNECTOR_CONTRACT_VERSION;
}

export class GeoConnectorSecretVault {
  private readonly key: Buffer;

  constructor(masterSecret: string) {
    if (Buffer.byteLength(masterSecret, "utf8") < 32) {
      throw new Error("GEO_CONNECTOR_MASTER_SECRET_TOO_SHORT");
    }
    this.key = createHash("sha256").update(masterSecret, "utf8").digest();
  }

  encrypt(secret: string): string {
    const normalized = normalizeSecret(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(normalized, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string): string {
    const [version, ivValue, tagValue, ciphertextValue, extra] =
      value.split(".");
    if (
      version !== "v1" ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue ||
      extra !== undefined
    ) {
      throw new Error("GEO_CONNECTOR_SECRET_CIPHERTEXT_INVALID");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(ivValue, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("GEO_CONNECTOR_SECRET_CIPHERTEXT_INVALID");
    }
  }
}

export function createGeoConnectorClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function createGeoConnectorSignature(
  input: GeoConnectorSignatureInput,
): string {
  return createHmac("sha256", normalizeSecret(input.secret))
    .update(canonicalGeoConnectorRequest(input), "utf8")
    .digest("base64url");
}

export function verifyGeoConnectorSignature(
  input: GeoConnectorSignatureInput,
  signature: string,
): boolean {
  const expected = Buffer.from(createGeoConnectorSignature(input), "utf8");
  const actual = Buffer.from(signature.trim(), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashGeoConnectorRequestBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function canonicalGeoConnectorRequest(
  input: GeoConnectorSignatureInput,
): string {
  const method = input.method.trim().toUpperCase();
  const path = input.path.trim();
  if (!method || !path.startsWith("/") || path.includes("\n")) {
    throw new Error("GEO_CONNECTOR_SIGNATURE_INPUT_INVALID");
  }
  const fields = [
    method,
    path,
    hashGeoConnectorRequestBody(input.rawBody),
    normalizeHeader(input.issuedAt),
    normalizeHeader(input.nonce),
    normalizeHeader(input.requestId),
    normalizeHeader(input.idempotencyKey),
    input.contractVersion ?? WENTIAN_GEO_CONNECTOR_CONTRACT_VERSION,
  ];
  return fields.join("\n");
}

function normalizeHeader(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\n") || normalized.includes("\r")) {
    throw new Error("GEO_CONNECTOR_SIGNATURE_INPUT_INVALID");
  }
  return normalized;
}

function normalizeSecret(value: string): string {
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") < 32) {
    throw new Error("GEO_CONNECTOR_CLIENT_SECRET_INVALID");
  }
  return normalized;
}
