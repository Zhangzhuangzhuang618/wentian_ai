import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const databaseUrl = requiredEnvironment("WENTIAN_DATABASE_URL");
const migrationsDirectory = path.resolve(import.meta.dirname, "../migrations");
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('wentian-schema-migrations'))",
    );
    await ensureMigrationTable(client);
    const migrations = await loadMigrations();
    assertContiguousVersions(migrations);
    await assertAppliedMigrationsKnown(client, migrations);
    for (const migration of migrations) {
      await applyMigration(client, migration);
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('wentian-schema-migrations'))")
      .catch(() => undefined);
    client.release();
  }
} finally {
  await pool.end();
}

async function assertAppliedMigrationsKnown(
  client: PoolClient,
  migrations: readonly Migration[],
): Promise<void> {
  const applied = await client.query<{
    readonly version: number;
    readonly name: string;
    readonly checksum: string;
  }>(
    `SELECT version, name, checksum
     FROM wentian_schema_migrations
     ORDER BY version`,
  );
  for (const row of applied.rows) {
    const local = migrations[row.version - 1];
    if (!local) {
      throw new Error(`DATABASE_MIGRATION_AHEAD:${row.version}`);
    }
    if (local.name !== row.name || local.checksum !== row.checksum) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${local.filename}`);
    }
  }
}

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wentian_schema_migrations (
      version integer PRIMARY KEY,
      name varchar(160) NOT NULL,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function loadMigrations(): Promise<readonly Migration[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => migrationPattern.test(filename))
    .sort();
  return Promise.all(
    filenames.map(async (filename) => {
      const match = migrationPattern.exec(filename)!;
      const sql = await readFile(
        path.join(migrationsDirectory, filename),
        "utf8",
      );
      return Object.freeze({
        version: Number(match[1]),
        name: match[2]!,
        filename,
        sql,
        checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
      });
    }),
  );
}

function assertContiguousVersions(migrations: readonly Migration[]): void {
  if (migrations.length === 0 || migrations[0]?.version !== 1) {
    throw new Error("MIGRATIONS_MUST_START_AT_0001");
  }
  for (let index = 0; index < migrations.length; index += 1) {
    if (migrations[index]?.version !== index + 1) {
      throw new Error("MIGRATION_VERSION_GAP");
    }
  }
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
): Promise<void> {
  const existing = await client.query<{
    readonly name: string;
    readonly checksum: string;
  }>(
    "SELECT name, checksum FROM wentian_schema_migrations WHERE version = $1",
    [migration.version],
  );
  if (existing.rowCount === 1) {
    const row = existing.rows[0]!;
    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.filename}`);
    }
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO wentian_schema_migrations (version, name, checksum)
       VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum],
    );
    await client.query("COMMIT");
    process.stdout.write(`applied ${migration.filename}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`MISSING_ENVIRONMENT:${name}`);
  }
  return value;
}
