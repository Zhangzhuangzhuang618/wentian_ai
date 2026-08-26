import assert from "node:assert/strict";
import test from "node:test";

import { hashLocalPassword, verifyLocalPassword } from "../src/index.ts";

test("本地密码使用独立随机盐摘要且不保存明文", async () => {
  const password = "a-long-unique-owner-password";
  const first = await hashLocalPassword(password);
  const second = await hashLocalPassword(password);

  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.equal(first.includes(password), false);
  assert.notEqual(first, second);
  assert.equal(await verifyLocalPassword(password, first), true);
  assert.equal(await verifyLocalPassword("wrong-password-value", first), false);
});

test("本地密码拒绝过短输入和未知摘要格式", async () => {
  await assert.rejects(
    () => hashLocalPassword("too-short"),
    /INVALID_LOCAL_PASSWORD/,
  );
  assert.equal(
    await verifyLocalPassword("a-long-enough-password", "unknown"),
    false,
  );
});
