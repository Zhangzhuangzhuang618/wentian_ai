import { Pool } from "pg";

import { PostgresOwnerBootstrapService } from "../packages/infrastructure/src/index.ts";

const pool = new Pool({
  connectionString: requiredEnvironment("WENTIAN_DATABASE_URL"),
  max: 1,
});

try {
  const owner = await new PostgresOwnerBootstrapService({ pool }).execute({
    plaintextToken: requiredEnvironment("WENTIAN_OWNER_INIT_TOKEN"),
    expectedTokenSha256: requiredEnvironment("WENTIAN_OWNER_INIT_TOKEN_SHA256"),
    email: requiredEnvironment("WENTIAN_OWNER_EMAIL"),
    displayName: requiredEnvironment("WENTIAN_OWNER_DISPLAY_NAME"),
    password: requiredEnvironment("WENTIAN_OWNER_PASSWORD"),
  });
  process.stdout.write(`owner initialized: ${owner.userId}\n`);
} finally {
  await pool.end();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`MISSING_ENVIRONMENT:${name}`);
  }
  return value;
}
