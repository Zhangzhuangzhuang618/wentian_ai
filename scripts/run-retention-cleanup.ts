import { Pool } from "pg";

import {
  PostgresRetentionCleanupService,
  S3EvidenceObjectStore,
} from "../packages/infrastructure/src/index.ts";

const pool = new Pool({
  connectionString: requiredEnvironment("WENTIAN_DATABASE_URL"),
  max: 4,
});
let objects: S3EvidenceObjectStore | null = null;

try {
  const instance = await pool.query<{ readonly id: string }>(
    "SELECT id FROM wentian_instances WHERE singleton = true",
  );
  if (instance.rowCount !== 1) {
    throw new Error("WENTIAN_INSTANCE_NOT_INITIALIZED");
  }
  objects = new S3EvidenceObjectStore({
    endpoint: requiredEnvironment("WENTIAN_OBJECT_STORE_ENDPOINT"),
    bucket: requiredEnvironment("WENTIAN_OBJECT_STORE_BUCKET"),
    accessKeyId: requiredEnvironment("WENTIAN_S3_ACCESS_KEY"),
    secretAccessKey: requiredEnvironment("WENTIAN_S3_SECRET_KEY"),
    instanceId: instance.rows[0]!.id,
  });
  const result = await new PostgresRetentionCleanupService({
    pool,
    objects,
  }).runOnce(process.env.WENTIAN_RETENTION_CUTOFF?.trim());
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  objects?.destroy();
  await pool.end();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`MISSING_ENVIRONMENT:${name}`);
  }
  return value;
}
