import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PUBLIC_SUFFIX_LIBRARY_VERSION,
  SOURCE_URL_NORMALIZATION_VERSION,
  TRACKING_PARAMETER_POLICY,
  normalizeSourceUrl,
} from "../src/index.ts";

test("归一化scheme、host、默认端口、fragment和版本化追踪参数", () => {
  const original =
    "HTTP://WWW.Example.Co.Uk:80/path/?z=3&utm_source=x&a=2&fbclid=y&a=1#fragment";
  const result = normalizeSourceUrl(original);

  assert.deepEqual(result, {
    status: "normalized",
    originalUrl: original,
    normalizedUrl: "http://www.example.co.uk/path/?a=2&a=1&z=3",
    host: "www.example.co.uk",
    registrableDomain: "example.co.uk",
    normalizationVersion: SOURCE_URL_NORMALIZATION_VERSION,
    publicSuffixLibraryVersion: PUBLIC_SUFFIX_LIBRARY_VERSION,
    trackingParameterPolicyVersion: TRACKING_PARAMETER_POLICY.version,
    removedTrackingParameters: ["fbclid", "utm_source"],
  });
});

test("未知业务参数和重复值保留并只按键排序", () => {
  const result = normalizeSourceUrl(
    "https://example.com/search?sku=2&b=3&sku=1&a=hello%20world&GCLID=x",
  );
  assert.equal(result.status, "normalized");
  if (result.status === "normalized") {
    assert.equal(
      result.normalizedUrl,
      "https://example.com/search?a=hello+world&b=3&sku=2&sku=1",
    );
    assert.deepEqual(result.removedTrackingParameters, ["gclid"]);
  }
});

test("中文域名转为ASCII且编码路径保持确定性", () => {
  const original = "HTTPS://例子.中国/路径/%2F?a=1#片段";
  const first = normalizeSourceUrl(original);
  const second = normalizeSourceUrl(original);

  assert.deepEqual(first, second);
  assert.equal(first.status, "normalized");
  if (first.status === "normalized") {
    assert.equal(first.host, "xn--fsqu00a.xn--fiqs8s");
    assert.equal(first.registrableDomain, "xn--fsqu00a.xn--fiqs8s");
    assert.equal(
      first.normalizedUrl,
      "https://xn--fsqu00a.xn--fiqs8s/%E8%B7%AF%E5%BE%84/%2F?a=1",
    );
  }
});

test("PRIVATE公共后缀防止不同托管租户被合并", () => {
  const first = normalizeSourceUrl("https://first.github.io/docs");
  const second = normalizeSourceUrl("https://second.github.io/docs");

  assert.equal(first.status, "normalized");
  assert.equal(second.status, "normalized");
  if (first.status === "normalized" && second.status === "normalized") {
    assert.equal(first.registrableDomain, "first.github.io");
    assert.equal(second.registrableDomain, "second.github.io");
    assert.notEqual(first.registrableDomain, second.registrableDomain);
  }
});

test("不同业务路径和尾斜杠不会被合并", () => {
  const withoutSlash = normalizeSourceUrl("https://example.com/product");
  const withSlash = normalizeSourceUrl("https://example.com/product/");

  assert.equal(withoutSlash.status, "normalized");
  assert.equal(withSlash.status, "normalized");
  if (
    withoutSlash.status === "normalized" &&
    withSlash.status === "normalized"
  ) {
    assert.notEqual(withoutSlash.normalizedUrl, withSlash.normalizedUrl);
  }
});

test("非HTTP、无效URL、凭据、IP和无可注册域名均结构化拒绝", () => {
  const fixtures = [
    [null, "INPUT_NOT_STRING"],
    ["  ", "EMPTY_URL"],
    ["not a url", "INVALID_URL"],
    ["ftp://example.com/file", "UNSUPPORTED_SCHEME"],
    ["https://user:secret@example.com/", "URL_CREDENTIALS_FORBIDDEN"],
    ["http://127.0.0.1/", "REGISTRABLE_DOMAIN_NOT_AVAILABLE"],
    ["http://localhost/", "REGISTRABLE_DOMAIN_NOT_AVAILABLE"],
    ["http://foo.internal/", "REGISTRABLE_DOMAIN_NOT_AVAILABLE"],
    ["https://example.invalid/", "REGISTRABLE_DOMAIN_NOT_AVAILABLE"],
  ] as const;

  for (const [input, reason] of fixtures) {
    const result = normalizeSourceUrl(input);
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(result.reason, reason);
      assert.equal(result.originalUrl, null);
    }
  }
});

test("公共后缀依赖版本与包清单锁定值一致", async () => {
  const packageJson = JSON.parse(
    await readFile(
      path.resolve(import.meta.dirname, "../package.json"),
      "utf8",
    ),
  ) as { dependencies?: Record<string, string> };

  assert.equal(packageJson.dependencies?.tldts, "7.4.10");
  assert.equal(PUBLIC_SUFFIX_LIBRARY_VERSION, "tldts@7.4.10");
});
