import {
  createQuerySetSnapshot,
  hasScopeAccess,
  type QuerySetQueryInput,
  type QuerySetSnapshot,
  type Scope,
  type WentianPrincipal,
} from "@wentian/domain";

import type { QuerySetSnapshotRepository, ScopeRepository } from "./ports.ts";

export type WentianApplicationErrorCode =
  "ACTION_FORBIDDEN" | "RESOURCE_NOT_FOUND" | "SCOPE_INACTIVE";

export class WentianApplicationError extends Error {
  readonly code: WentianApplicationErrorCode;

  constructor(code: WentianApplicationErrorCode) {
    super(code);
    this.name = "WentianApplicationError";
    this.code = code;
  }
}

export class ListAccessibleScopesService {
  private readonly scopes: ScopeRepository;

  constructor(scopes: ScopeRepository) {
    this.scopes = scopes;
  }

  execute(principal: WentianPrincipal): Promise<readonly Scope[]> {
    return this.scopes.listByIds(principal.allowedScopeIds);
  }
}

export interface CreateLocalQuerySetSnapshotCommand {
  readonly scopeId: string;
  readonly title: string;
  readonly locale: string;
  readonly market?: string | null;
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly sourceRef?: string;
  readonly sourceRevision?: string;
  readonly queries: readonly QuerySetQueryInput[];
}

export interface CreateLocalQuerySetSnapshotResult {
  readonly snapshot: QuerySetSnapshot;
  readonly created: boolean;
}

export interface CreateLocalQuerySetSnapshotDependencies {
  readonly scopes: ScopeRepository;
  readonly snapshots: QuerySetSnapshotRepository;
  readonly newId: () => string;
  readonly now: () => string;
}

export class CreateLocalQuerySetSnapshotService {
  private readonly dependencies: CreateLocalQuerySetSnapshotDependencies;

  constructor(dependencies: CreateLocalQuerySetSnapshotDependencies) {
    this.dependencies = dependencies;
  }

  async execute(
    principal: WentianPrincipal,
    command: CreateLocalQuerySetSnapshotCommand,
  ): Promise<CreateLocalQuerySetSnapshotResult> {
    const scope = await requireActiveScope(
      principal,
      command.scopeId,
      this.dependencies.scopes,
    );

    const snapshot = createQuerySetSnapshot({
      id: this.dependencies.newId(),
      itemIds: command.queries.map(() => this.dependencies.newId()),
      scopeId: scope.id,
      title: command.title,
      locale: command.locale,
      market: command.market,
      industry: command.industry,
      region: command.region,
      source: {
        type: "local",
        ref: command.sourceRef,
        revision: command.sourceRevision,
      },
      queries: command.queries,
      createdBy: principal.userId,
      createdAt: this.dependencies.now(),
    });

    return this.dependencies.snapshots.getOrCreate(snapshot);
  }
}

export class GetQuerySetSnapshotService {
  private readonly scopes: ScopeRepository;
  private readonly snapshots: QuerySetSnapshotRepository;

  constructor(scopes: ScopeRepository, snapshots: QuerySetSnapshotRepository) {
    this.scopes = scopes;
    this.snapshots = snapshots;
  }

  async execute(
    principal: WentianPrincipal,
    scopeId: string,
    snapshotId: string,
  ): Promise<QuerySetSnapshot> {
    if (!hasScopeAccess(principal, scopeId)) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }

    const snapshot = await this.snapshots.findById(scopeId, snapshotId);
    if (!snapshot) {
      throw new WentianApplicationError("RESOURCE_NOT_FOUND");
    }
    return snapshot;
  }
}

async function requireActiveScope(
  principal: WentianPrincipal,
  scopeId: string,
  scopes: ScopeRepository,
): Promise<Scope> {
  if (!hasScopeAccess(principal, scopeId)) {
    throw new WentianApplicationError("RESOURCE_NOT_FOUND");
  }

  const scope = await scopes.findById(scopeId);
  if (!scope) {
    throw new WentianApplicationError("RESOURCE_NOT_FOUND");
  }
  if (scope.status !== "active") {
    throw new WentianApplicationError("SCOPE_INACTIVE");
  }
  return scope;
}
