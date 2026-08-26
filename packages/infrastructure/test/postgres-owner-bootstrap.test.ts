import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { PostgresOwnerBootstrapService } from "../src/index.ts";

const token = "0123456789abcdef0123456789abcdef";
const tokenDigest = createHash("sha256").update(token).digest("hex");

test("Owner初始化在单一事务内创建账号和实例角色", async () => {
  const client = fakeClient();
  const service = new PostgresOwnerBootstrapService({
    pool: { connect: async () => client } as never,
    newId: () => "11111111-1111-4111-8111-111111111111",
    now: () => "2026-08-23T12:00:00.000Z",
  });

  const owner = await service.execute({
    plaintextToken: token,
    expectedTokenSha256: tokenDigest,
    email: " Owner@Example.COM ",
    displayName: "Owner",
    password: "a-long-unique-owner-password",
  });

  assert.equal(owner.emailNormalized, "owner@example.com");
  assert.deepEqual(client.commands.slice(0, 2), ["BEGIN", "SELECT"]);
  assert.deepEqual(client.commands.slice(-2), ["UPDATE", "COMMIT"]);
  assert.equal(client.commands.includes("INSERT_USER"), true);
  assert.equal(client.commands.includes("INSERT_MEMBERSHIP"), true);
  assert.equal(client.released, true);
});

test("令牌不匹配时不连接数据库", async () => {
  let connected = false;
  const service = new PostgresOwnerBootstrapService({
    pool: {
      connect: async () => {
        connected = true;
        return fakeClient();
      },
    } as never,
  });

  await assert.rejects(
    () =>
      service.execute({
        plaintextToken: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        expectedTokenSha256: tokenDigest,
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-long-unique-owner-password",
      }),
    /OWNER_INIT_TOKEN_MISMATCH/,
  );
  assert.equal(connected, false);
});

test("已初始化实例拒绝第二个Owner并回滚", async () => {
  const client = fakeClient(true);
  const service = new PostgresOwnerBootstrapService({
    pool: { connect: async () => client } as never,
  });

  await assert.rejects(
    () =>
      service.execute({
        plaintextToken: token,
        expectedTokenSha256: tokenDigest,
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-long-unique-owner-password",
      }),
    /OWNER_ALREADY_INITIALIZED/,
  );
  assert.deepEqual(client.commands, ["BEGIN", "SELECT", "ROLLBACK"]);
});

function fakeClient(initialized = false) {
  return {
    commands: [] as string[],
    released: false,
    async query(sql: string) {
      const normalized = sql.trim();
      if (
        normalized === "BEGIN" ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        this.commands.push(normalized);
        return { rowCount: null, rows: [] };
      }
      if (normalized.startsWith("SELECT id, owner_initialized_at")) {
        this.commands.push("SELECT");
        return {
          rowCount: 1,
          rows: [
            {
              id: "instance-1",
              owner_initialized_at: initialized
                ? "2026-08-22T00:00:00.000Z"
                : null,
            },
          ],
        };
      }
      if (normalized.startsWith("INSERT INTO local_users")) {
        this.commands.push("INSERT_USER");
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("INSERT INTO instance_memberships")) {
        this.commands.push("INSERT_MEMBERSHIP");
        return { rowCount: 1, rows: [] };
      }
      if (normalized.startsWith("UPDATE wentian_instances")) {
        this.commands.push("UPDATE");
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`UNEXPECTED_SQL:${normalized}`);
    },
    release() {
      this.released = true;
    },
  };
}
