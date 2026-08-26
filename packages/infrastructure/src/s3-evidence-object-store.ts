import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const MAX_SCREENSHOT_BYTES = 10 * 1_024 * 1_024;

export interface StoredEvidenceObject {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export class S3EvidenceObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly instanceId: string;

  constructor(options: {
    readonly endpoint: string;
    readonly region?: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly instanceId: string;
  }) {
    this.bucket = normalizeSegment(options.bucket, "INVALID_S3_BUCKET");
    this.instanceId = normalizeSegment(
      options.instanceId,
      "INVALID_INSTANCE_ID",
    );
    this.client = new S3Client({
      endpoint: new URL(options.endpoint).origin,
      region: options.region ?? "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: normalizeSecret(options.accessKeyId),
        secretAccessKey: normalizeSecret(options.secretAccessKey),
      },
    });
  }

  async putScreenshot(input: {
    readonly scopeId: string;
    readonly assetId: string;
    readonly bytes: Buffer;
    readonly observedAt: string;
  }): Promise<StoredEvidenceObject> {
    if (
      !Buffer.isBuffer(input.bytes) ||
      input.bytes.length < 1 ||
      input.bytes.length > MAX_SCREENSHOT_BYTES ||
      input.bytes[0] !== 0x89 ||
      input.bytes.subarray(1, 4).toString("ascii") !== "PNG"
    ) {
      throw new Error("INVALID_SCREENSHOT_PNG");
    }
    const observedAt = new Date(input.observedAt);
    if (!Number.isFinite(observedAt.getTime())) {
      throw new Error("INVALID_SCREENSHOT_OBSERVED_AT");
    }
    const scopeId = normalizeSegment(input.scopeId, "INVALID_SCOPE_ID");
    const assetId = normalizeSegment(input.assetId, "INVALID_ASSET_ID");
    const month = observedAt.toISOString().slice(0, 7);
    const objectKey = `instances/${this.instanceId}/scopes/${scopeId}/consumer-screenshots/${month}/${assetId}.png`;
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: input.bytes,
        ContentType: "image/png",
        Metadata: { sha256 },
      }),
    );
    return Object.freeze({
      objectKey,
      sha256,
      byteSize: input.bytes.length,
    });
  }

  async deleteObject(objectKey: string): Promise<void> {
    const normalized = objectKey.trim();
    if (!normalized.startsWith(`instances/${this.instanceId}/scopes/`)) {
      throw new Error("EVIDENCE_OBJECT_KEY_OUTSIDE_INSTANCE");
    }
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: normalized }),
    );
  }

  async deleteScopeObjects(scopeId: string): Promise<number> {
    const normalizedScopeId = normalizeSegment(scopeId, "INVALID_SCOPE_ID");
    const prefix = `instances/${this.instanceId}/scopes/${normalizedScopeId}/`;
    let continuationToken: string | undefined;
    let deletedCount = 0;

    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of listed.Contents ?? []) {
        const key = item.Key?.trim();
        if (!key || !key.startsWith(prefix)) {
          throw new Error("SCOPE_OBJECT_LIST_OUTSIDE_PREFIX");
        }
        await this.client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        deletedCount += 1;
      }
      if (listed.IsTruncated && !listed.NextContinuationToken) {
        throw new Error("SCOPE_OBJECT_LIST_INCOMPLETE");
      }
      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return deletedCount;
  }

  destroy(): void {
    this.client.destroy();
  }
}

function normalizeSegment(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function normalizeSecret(value: string): string {
  if (!value.trim()) {
    throw new Error("S3_CREDENTIAL_REQUIRED");
  }
  return value;
}
