import assert from "node:assert/strict";
import test from "node:test";

import {
  ListAccessibleScopesService,
  type ScopeRepository,
} from "../src/index.ts";
import { createScope, createWentianPrincipal } from "@wentian/domain";

const scope = createScope({
  id: "31111111-1111-4111-8111-111111111111",
  projectKey: "guangzhou-moving",
  displayName: "广州搬家",
  status: "active",
  retentionPolicyCode: "default",
  createdBy: "41111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  version: 1,
});

test("Scope列表只使用Principal允许集合", async () => {
  let requestedIds: readonly string[] = [];
  const repository: ScopeRepository = {
    async findById() {
      return null;
    },
    async listByIds(scopeIds) {
      requestedIds = scopeIds;
      return [scope];
    },
  };
  const service = new ListAccessibleScopesService(repository);
  const principal = createWentianPrincipal({
    userId: "41111111-1111-4111-8111-111111111111",
    role: "viewer",
    allowedScopeIds: [scope.id],
  });

  const result = await service.execute(principal);

  assert.deepEqual(requestedIds, [scope.id]);
  assert.deepEqual(result, [scope]);
});
