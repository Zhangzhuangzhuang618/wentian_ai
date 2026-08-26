import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";

import { parse as parseDomain } from "tldts";

import {
  normalizeSourceUrl,
  type NormalizedSourceUrl,
} from "./source-url-normalization.ts";

export const SOURCE_KEY_HASH_VERSION = "source-key-hash@1" as const;

export type SourceKeyType = "normalized_url" | "registrable_domain";

export type SourceKeyMaterial =
  | {
      readonly normalizedSource: NormalizedSourceUrl;
    }
  | {
      readonly normalizedSource: null;
      readonly registrableDomain: string;
      readonly normalizationVersion: string;
    };

export interface DerivedSourceKey {
  readonly keyType: SourceKeyType;
  readonly sourceKeyHash: string;
  readonly hashVersion: typeof SOURCE_KEY_HASH_VERSION;
  readonly normalizationVersion: string;
}

export function deriveSourceKeyHash(
  material: SourceKeyMaterial,
): DerivedSourceKey {
  if (material.normalizedSource) {
    const normalizedSource = validateNormalizedSource(
      material.normalizedSource,
    );
    return derive(
      "normalized_url",
      normalizedSource.normalizationVersion,
      normalizedSource.normalizedUrl,
    );
  }

  return derive(
    "registrable_domain",
    normalizeRequiredText(
      material.normalizationVersion,
      "SOURCE_KEY_NORMALIZATION_VERSION_REQUIRED",
    ),
    normalizeSourceRegistrableDomain(material.registrableDomain),
  );
}

function derive(
  keyType: SourceKeyType,
  normalizationVersion: string,
  value: string,
): DerivedSourceKey {
  const canonicalInput = JSON.stringify([
    SOURCE_KEY_HASH_VERSION,
    keyType,
    normalizationVersion,
    value,
  ]);
  return Object.freeze({
    keyType,
    sourceKeyHash: createHash("sha256").update(canonicalInput).digest("hex"),
    hashVersion: SOURCE_KEY_HASH_VERSION,
    normalizationVersion,
  });
}

function validateNormalizedSource(
  input: NormalizedSourceUrl,
): NormalizedSourceUrl {
  const rerun = normalizeSourceUrl(input.normalizedUrl);
  if (
    input.status !== "normalized" ||
    rerun.status !== "normalized" ||
    rerun.normalizedUrl !== input.normalizedUrl ||
    rerun.registrableDomain !== input.registrableDomain ||
    rerun.normalizationVersion !== input.normalizationVersion
  ) {
    throw new Error("SOURCE_KEY_NORMALIZED_URL_REQUIRED");
  }
  return input;
}

export function normalizeSourceRegistrableDomain(value: string): string {
  const normalized = domainToASCII(
    normalizeRequiredText(value, "SOURCE_KEY_REGISTRABLE_DOMAIN_REQUIRED")
      .toLowerCase()
      .replace(/\.$/, ""),
  );
  if (!normalized) {
    throw new Error("SOURCE_KEY_REGISTRABLE_DOMAIN_INVALID");
  }
  const parsed = parseDomain(normalized, { allowPrivateDomains: true });
  if (
    !parsed.domain ||
    parsed.domain !== normalized ||
    (!parsed.isIcann && !parsed.isPrivate)
  ) {
    throw new Error("SOURCE_KEY_REGISTRABLE_DOMAIN_INVALID");
  }
  return normalized;
}

function normalizeRequiredText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}
