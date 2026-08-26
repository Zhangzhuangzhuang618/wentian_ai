import assert from "node:assert/strict";
import test from "node:test";

import { hashLocalPassword, PostgresLocalAccessService } from "../src/index.ts";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  scope: "21111111-1111-4111-8111-111111111111",
  session: "31111111-1111-4111-8111-111111111111",
} as const;
const sessionSecret = "s".repeat(32);

test("本地登录只保存会话摘要并返回确定性CSRF能力", async () => {
  const password = "a-long-owner-password";
  const passwordHash = await hashLocalPassword(password);
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const pool = {
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("FROM local_users u")) {
        return {
          rows: [
            {
              id: ids.user,
              email_normalized: "owner@example.com",
              display_name: "Owner",
              password_hash: passwordHash,
              status: "active",
              role: "owner",
            },
          ],
        };
      }
      if (sql.includes("FROM scope_memberships")) {
        return { rows: [{ scope_id: ids.scope }] };
      }
      if (sql.includes("INSERT INTO local_sessions")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error("UNEXPECTED_SQL");
    },
    async connect() {
      throw new Error("UNEXPECTED_CONNECT");
    },
  };
  const service = new PostgresLocalAccessService({
    pool: pool as never,
    sessionSecret,
    newId: () => ids.session,
    now: () => "2026-08-23T12:00:00.000Z",
  });

  const session = await service.login(" Owner@Example.COM ", password);

  assert.equal(session.user.email, "owner@example.com");
  assert.deepEqual(session.user.allowedScopeIds, [ids.scope]);
  assert.equal(
    service.verifyCsrfToken(session.sessionToken, session.csrfToken),
    true,
  );
  assert.equal(
    service.verifyCsrfToken(session.sessionToken, "x".repeat(43)),
    false,
  );
  const insert = calls.find((call) =>
    call.sql.includes("INSERT INTO local_sessions"),
  );
  assert.equal(insert?.values?.includes(session.sessionToken), false);
  assert.match(String(insert?.values?.[2]), /^[0-9a-f]{64}$/);
});

test("项目创建以单一事务写入项目、成员和默认关闭设置", async () => {
  const commands: string[] = [];
  const client = {
    async query(sql: string) {
      const normalized = sql.trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
        commands.push(normalized);
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO scopes")) {
        commands.push("INSERT_SCOPE");
        return {
          rows: [
            {
              id: ids.scope,
              project_key: "guangzhou-moving",
              display_name: "广州搬家",
              industry: "搬家",
              region: "广州",
              status: "active",
              retention_policy_code: "consumer-observation-governance@1",
              role: "owner",
              version: 1,
              created_at: "2026-08-23T12:00:00.000Z",
              updated_at: "2026-08-23T12:00:00.000Z",
            },
          ],
        };
      }
      if (normalized.startsWith("INSERT INTO scope_memberships")) {
        commands.push("INSERT_MEMBERSHIP");
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO scope_consumer_settings")) {
        commands.push("INSERT_SETTINGS_DEFAULT_OFF");
        assert.match(normalized, /VALUES \(\$1, false, 'CN_MAINLAND'/);
        return { rows: [] };
      }
      throw new Error(`UNEXPECTED_SQL:${normalized}`);
    },
    release() {
      commands.push("RELEASE");
    },
  };
  const service = new PostgresLocalAccessService({
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => client,
    } as never,
    sessionSecret,
    newId: () => ids.scope,
    now: () => "2026-08-23T12:00:00.000Z",
  });

  const scope = await service.createScope({
    user: owner([]),
    projectKey: "guangzhou-moving",
    displayName: "广州搬家",
    industry: "搬家",
    region: "广州",
  });

  assert.equal(scope.id, ids.scope);
  assert.equal(scope.industry, "搬家");
  assert.equal(scope.region, "广州");
  assert.deepEqual(commands, [
    "BEGIN",
    "INSERT_SCOPE",
    "INSERT_MEMBERSHIP",
    "INSERT_SETTINGS_DEFAULT_OFF",
    "COMMIT",
    "RELEASE",
  ]);
});

test("会话密钥不足32字节时拒绝启动", () => {
  assert.throws(
    () =>
      new PostgresLocalAccessService({
        pool: {} as never,
        sessionSecret: "too-short",
      }),
    /LOCAL_SESSION_SECRET_TOO_SHORT/,
  );
});

test("GEO会话只在绑定与项目访问版本仍有效时成立", async () => {
  let currentAccessVersion = 3;
  const pool = {
    async query(sql: string) {
      if (!sql.includes("FROM local_sessions s")) {
        throw new Error("UNEXPECTED_SQL");
      }
      return {
        rows: [
          {
            id: ids.user,
            email_normalized: "geo-user@external.invalid",
            display_name: "GEO 分析员",
            status: "active",
            role: null,
            expires_at: "2026-08-23T13:00:00.000Z",
            auth_source: "geo",
            geo_project_binding_id: "41111111-1111-4111-8111-111111111111",
            binding_version: 2,
            access_version: 3,
            binding_status: "active",
            current_binding_version: 2,
            scope_id: ids.scope,
            access_status: "active",
            current_access_version: currentAccessVersion,
            access_role: "analyst",
          },
        ],
      };
    },
    async connect() {
      throw new Error("UNEXPECTED_CONNECT");
    },
  };
  const service = new PostgresLocalAccessService({
    pool: pool as never,
    sessionSecret,
    now: () => "2026-08-23T12:00:00.000Z",
  });

  const session = await service.authenticate("g".repeat(43));
  assert.equal(session.user.authSource, "geo");
  assert.equal(session.user.authorizationRole, "analyst");
  assert.deepEqual(session.user.allowedScopeIds, [ids.scope]);

  currentAccessVersion = 4;
  await assert.rejects(
    () => service.authenticate("g".repeat(43)),
    /LOCAL_SESSION_INVALID/,
  );
});

function owner(allowedScopeIds: readonly string[]) {
  return {
    id: ids.user,
    email: "owner@example.com",
    displayName: "Owner",
    instanceRole: "owner" as const,
    allowedScopeIds,
  };
}
