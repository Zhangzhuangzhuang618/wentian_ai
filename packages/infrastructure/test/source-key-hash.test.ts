import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_KEY_HASH_VERSION,
  deriveSourceKeyHash,
  normalizeSourceUrl,
} from "../src/index.ts";

test("完整URL优先生成版本化normalized_url来源键", () => {
  const normalizedSource = normalizeSourceUrl(
    "HTTPS://WWW.Example.COM:443/path?b=2&utm_source=x&a=1#fragment",
  );
  assert.equal(normalizedSource.status, "normalized");
  if (normalizedSource.status !== "normalized") {
    return;
  }

  const first = deriveSourceKeyHash({ normalizedSource });
  const second = deriveSourceKeyHash({ normalizedSource });

  assert.deepEqual(first, second);
  assert.equal(first.keyType, "normalized_url");
  assert.equal(first.hashVersion, SOURCE_KEY_HASH_VERSION);
  assert.equal(first.normalizationVersion, "url-normalization@1");
  assert.equal(
    first.sourceKeyHash,
    "e21dca1862e47649d864fd2b85b3ae6c638d149664cb1fa0c6ee1c0f204439c7",
  );
});

test("没有URL的提名按规范可注册域名生成来源键", () => {
  const ascii = deriveSourceKeyHash({
    normalizedSource: null,
    registrableDomain: "xn--fsqu00a.xn--fiqs8s",
    normalizationVersion: "url-normalization@1",
  });
  const unicode = deriveSourceKeyHash({
    normalizedSource: null,
    registrableDomain: "例子.中国.",
    normalizationVersion: "url-normalization@1",
  });

  assert.deepEqual(ascii, unicode);
  assert.equal(ascii.keyType, "registrable_domain");
  assert.match(ascii.sourceKeyHash, /^[0-9a-f]{64}$/);
});

test("键类型和归一化版本都参与哈希隔离", () => {
  const domainVersionOne = deriveSourceKeyHash({
    normalizedSource: null,
    registrableDomain: "example.com",
    normalizationVersion: "url-normalization@1",
  });
  assert.equal(
    domainVersionOne.sourceKeyHash,
    "b47c6be1b6914211da5a378825972b8117e367bdbba482986c74191023c963ed",
  );
  const domainVersionTwo = deriveSourceKeyHash({
    normalizedSource: null,
    registrableDomain: "example.com",
    normalizationVersion: "url-normalization@2",
  });
  const normalizedSource = normalizeSourceUrl("https://example.com/");
  assert.equal(normalizedSource.status, "normalized");
  if (normalizedSource.status !== "normalized") {
    return;
  }
  const urlKey = deriveSourceKeyHash({ normalizedSource });

  assert.notEqual(
    domainVersionOne.sourceKeyHash,
    domainVersionTwo.sourceKeyHash,
  );
  assert.notEqual(domainVersionOne.sourceKeyHash, urlKey.sourceKeyHash);
});

test("伪造未归一化URL和非可注册域名失败关闭", () => {
  const normalizedSource = normalizeSourceUrl("https://example.com/path?a=1");
  assert.equal(normalizedSource.status, "normalized");
  if (normalizedSource.status !== "normalized") {
    return;
  }

  assert.throws(
    () =>
      deriveSourceKeyHash({
        normalizedSource: {
          ...normalizedSource,
          normalizedUrl: "https://EXAMPLE.com/path?utm_source=x&a=1#fragment",
        },
      }),
    /SOURCE_KEY_NORMALIZED_URL_REQUIRED/,
  );
  assert.throws(
    () =>
      deriveSourceKeyHash({
        normalizedSource: null,
        registrableDomain: "www.example.com",
        normalizationVersion: "url-normalization@1",
      }),
    /SOURCE_KEY_REGISTRABLE_DOMAIN_INVALID/,
  );
  assert.throws(
    () =>
      deriveSourceKeyHash({
        normalizedSource: null,
        registrableDomain: "foo.internal",
        normalizationVersion: "url-normalization@1",
      }),
    /SOURCE_KEY_REGISTRABLE_DOMAIN_INVALID/,
  );
});
