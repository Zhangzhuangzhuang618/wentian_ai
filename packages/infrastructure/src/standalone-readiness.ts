import { Pool } from "pg";

export type StandaloneDependencyState =
  "ready" | "not_configured" | "unavailable";

export interface StandaloneReadinessChecks {
  readonly database: StandaloneDependencyState;
  readonly objectStore: StandaloneDependencyState;
}

export function createStandalonePostgresPool(databaseUrl: string): Pool {
  const connectionString = databaseUrl.trim();
  if (!connectionString) {
    throw new Error("INVALID_WENTIAN_DATABASE_URL");
  }
  return new Pool({ connectionString });
}

export function createStandaloneReadinessChecker(input: {
  readonly databasePool?: Pick<Pool, "query"> | null;
  readonly objectStoreEndpoint?: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMilliseconds?: number;
}): () => Promise<StandaloneReadinessChecks> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 2_000;
  return async () => {
    const [database, objectStore] = await Promise.all([
      checkDatabase(input.databasePool),
      checkObjectStore(
        input.objectStoreEndpoint,
        fetchImpl,
        timeoutMilliseconds,
      ),
    ]);
    return Object.freeze({ database, objectStore });
  };
}

async function checkDatabase(
  pool: Pick<Pool, "query"> | null | undefined,
): Promise<StandaloneDependencyState> {
  if (!pool) {
    return "not_configured";
  }
  try {
    await pool.query("SELECT 1");
    return "ready";
  } catch {
    return "unavailable";
  }
}

async function checkObjectStore(
  endpoint: string | null | undefined,
  fetchImpl: typeof fetch,
  timeoutMilliseconds: number,
): Promise<StandaloneDependencyState> {
  if (!endpoint?.trim()) {
    return "not_configured";
  }
  try {
    const base = new URL(endpoint);
    base.pathname = `${base.pathname.replace(/\/$/, "")}/minio/health/ready`;
    const response = await fetchImpl(base, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    return response.ok ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}
