import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

const assets = new Map([
  [
    "/",
    {
      file: new URL("../public/index.html", import.meta.url),
      contentType: "text/html; charset=utf-8",
    },
  ],
  [
    "/styles.css",
    {
      file: new URL("../public/styles.css", import.meta.url),
      contentType: "text/css; charset=utf-8",
    },
  ],
  [
    "/app.js",
    {
      file: new URL("../public/app.js", import.meta.url),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/report-core.js",
    {
      file: new URL("../public/report-core.js", import.meta.url),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
  [
    "/question-generator.js",
    {
      file: new URL("../public/question-generator.js", import.meta.url),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
] as const);

export async function handleStandaloneWebUi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
): Promise<boolean> {
  if (request.method !== "GET") {
    return false;
  }
  const asset = assets.get(requestUrl.pathname as never);
  if (!asset) {
    return false;
  }
  const body = await readFile(asset.file);
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "content-type": asset.contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(body);
  return true;
}
