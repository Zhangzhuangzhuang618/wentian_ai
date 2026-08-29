import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceRoots = [
  "packages/domain/src",
  "packages/contracts/src",
  "packages/application/src",
  "packages/infrastructure/src",
  "packages/adapters/consumer-doubao-web/src",
  "packages/adapters/consumer-qianwen-web/src",
  "packages/adapters/consumer-deepseek-web/src",
  "apps/api/src",
];

const allowedWentianImports = new Map([
  ["packages/domain/src", []],
  ["packages/contracts/src", []],
  ["packages/application/src", ["@wentian/domain"]],
  ["packages/infrastructure/src", ["@wentian/application", "@wentian/domain"]],
  ["packages/adapters/consumer-doubao-web/src", ["@wentian/domain"]],
  ["packages/adapters/consumer-qianwen-web/src", ["@wentian/domain"]],
  ["packages/adapters/consumer-deepseek-web/src", ["@wentian/domain"]],
  [
    "apps/api/src",
    [
      "@wentian/application",
      "@wentian/consumer-doubao-web",
      "@wentian/consumer-qianwen-web",
      "@wentian/consumer-deepseek-web",
      "@wentian/contracts",
      "@wentian/infrastructure",
    ],
  ],
]);

const forbiddenImportPatterns = [
  /geo-content-os/i,
  /geo_content_os/i,
  /@geo\//i,
  /\/geo(?:\/|$)/i,
  /host-adapter/i,
];

const failures = [];

for (const sourceRoot of sourceRoots) {
  const absoluteRoot = path.join(projectRoot, sourceRoot);
  for (const filePath of await collectTypeScriptFiles(absoluteRoot)) {
    const source = await readFile(filePath, "utf8");
    const imports = collectImportSpecifiers(source);

    for (const importSpecifier of imports) {
      if (
        forbiddenImportPatterns.some((pattern) => pattern.test(importSpecifier))
      ) {
        failures.push(
          `${path.relative(projectRoot, filePath)} imports forbidden dependency ${importSpecifier}`,
        );
      }
    }

    const allowedForRoot = allowedWentianImports.get(sourceRoot) ?? [];
    for (const importSpecifier of imports) {
      if (
        importSpecifier.startsWith("@wentian/") &&
        !allowedForRoot.includes(importSpecifier)
      ) {
        failures.push(
          `${path.relative(projectRoot, filePath)} violates dependency direction with ${importSpecifier}`,
        );
      }

      if (
        sourceRoot === "packages/domain/src" &&
        !importSpecifier.startsWith("./") &&
        !importSpecifier.startsWith("../") &&
        !importSpecifier.startsWith("node:")
      ) {
        failures.push(
          `${path.relative(projectRoot, filePath)} makes domain depend on ${importSpecifier}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Wentian source boundaries are valid.\n");
}

async function collectTypeScriptFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory)) {
    const entryPath = path.join(directory, entry);
    const entryStat = await stat(entryPath);

    if (entryStat.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
    } else if (entry.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectImportSpecifiers(source) {
  const imports = [];
  const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    imports.push(match[1]);
  }

  return imports;
}
