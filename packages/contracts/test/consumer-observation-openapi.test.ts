import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const checkerPath = path.join(
  projectRoot,
  "scripts/check-consumer-observation-openapi.mjs",
);
const documentPath = path.join(
  projectRoot,
  "docs/openapi/wentian-consumer-observation.openapi.json",
);

test("不可执行OpenAPI草案通过持续一致性检查", async () => {
  const result = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", checkerPath],
    { cwd: projectRoot },
  );
  assert.match(result.stdout, /matches routes and Zod contracts/);
});

test("一致性检查拒绝把草案标记为可执行", async () => {
  await expectDraftRejected((document) => {
    document["x-wentian-executable"] = true;
  }, /x-wentian-executable mismatch/);
});

test("一致性检查拒绝加入部署服务器", async () => {
  await expectDraftRejected((document) => {
    document.servers = [{ url: "https://api.example.invalid" }];
  }, /servers must be absent/);
});

test("一致性检查拒绝正式路径与路由常量漂移", async () => {
  await expectDraftRejected((document) => {
    const paths = document.paths as Record<string, unknown>;
    delete paths["/ai-visibility/consumer-observations/tasks/{id}/confirm"];
  }, /paths mismatch/);
});

test("一致性检查拒绝OpenAPI字段与Zod契约漂移", async () => {
  await expectDraftRejected((document) => {
    const schemas = (document.components as JsonRecord).schemas as JsonRecord;
    const request = schemas.CreateConsumerObservationRequest as JsonRecord;
    const properties = request.properties as JsonRecord;
    delete properties.sample_count;
  }, /CreateConsumerObservationRequest\.properties mismatch/);
});

type JsonRecord = Record<string, unknown>;

async function expectDraftRejected(
  mutate: (document: JsonRecord) => void,
  expectedMessage: RegExp,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "wentian-openapi-test-"),
  );
  const mutatedPath = path.join(temporaryDirectory, "openapi.json");
  try {
    const document = JSON.parse(
      await readFile(documentPath, "utf8"),
    ) as JsonRecord;
    mutate(document);
    await writeFile(mutatedPath, JSON.stringify(document), "utf8");

    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["--experimental-strip-types", checkerPath, mutatedPath],
        { cwd: projectRoot },
      ),
      (error: unknown) => {
        const processError = error as Error & { stderr?: string };
        assert.match(processError.stderr ?? "", expectedMessage);
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
