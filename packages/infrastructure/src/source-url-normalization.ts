import { parse as parseDomain } from "tldts";

export const SOURCE_URL_NORMALIZATION_VERSION = "url-normalization@1" as const;

export const PUBLIC_SUFFIX_LIBRARY_VERSION = "tldts@7.4.10" as const;

export const TRACKING_PARAMETER_POLICY = Object.freeze({
  version: "url-tracking-parameters@1" as const,
  exactNames: Object.freeze(["gclid", "fbclid"] as const),
  prefixes: Object.freeze(["utm_"] as const),
});

export type SourceUrlRejectionReason =
  | "INPUT_NOT_STRING"
  | "EMPTY_URL"
  | "INVALID_URL"
  | "UNSUPPORTED_SCHEME"
  | "URL_CREDENTIALS_FORBIDDEN"
  | "HOST_REQUIRED"
  | "REGISTRABLE_DOMAIN_NOT_AVAILABLE";

export interface NormalizedSourceUrl {
  readonly status: "normalized";
  readonly originalUrl: string;
  readonly normalizedUrl: string;
  readonly host: string;
  readonly registrableDomain: string;
  readonly normalizationVersion: typeof SOURCE_URL_NORMALIZATION_VERSION;
  readonly publicSuffixLibraryVersion: typeof PUBLIC_SUFFIX_LIBRARY_VERSION;
  readonly trackingParameterPolicyVersion: typeof TRACKING_PARAMETER_POLICY.version;
  readonly removedTrackingParameters: readonly string[];
}

export interface RejectedSourceUrl {
  readonly status: "rejected";
  readonly originalUrl: null;
  readonly reason: SourceUrlRejectionReason;
  readonly normalizationVersion: typeof SOURCE_URL_NORMALIZATION_VERSION;
  readonly publicSuffixLibraryVersion: typeof PUBLIC_SUFFIX_LIBRARY_VERSION;
  readonly trackingParameterPolicyVersion: typeof TRACKING_PARAMETER_POLICY.version;
}

export type SourceUrlNormalizationResult =
  NormalizedSourceUrl | RejectedSourceUrl;

export function normalizeSourceUrl(
  input: unknown,
): SourceUrlNormalizationResult {
  if (typeof input !== "string") {
    return rejected("INPUT_NOT_STRING");
  }
  if (!input.trim()) {
    return rejected("EMPTY_URL");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return rejected("INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return rejected("UNSUPPORTED_SCHEME");
  }
  if (url.username || url.password) {
    return rejected("URL_CREDENTIALS_FORBIDDEN");
  }
  if (!url.hostname) {
    return rejected("HOST_REQUIRED");
  }

  const domainResult = parseDomain(url.hostname, {
    allowPrivateDomains: true,
  });
  if (
    domainResult.isIp ||
    !domainResult.domain ||
    (!domainResult.isIcann && !domainResult.isPrivate)
  ) {
    return rejected("REGISTRABLE_DOMAIN_NOT_AVAILABLE");
  }

  url.hash = "";
  const removedTrackingParameters = new Set<string>();
  for (const parameterName of [...url.searchParams.keys()]) {
    if (isTrackingParameter(parameterName)) {
      removedTrackingParameters.add(parameterName.toLowerCase());
      url.searchParams.delete(parameterName);
    }
  }
  url.searchParams.sort();

  return Object.freeze({
    status: "normalized",
    originalUrl: input,
    normalizedUrl: url.href,
    host: url.hostname,
    registrableDomain: domainResult.domain,
    normalizationVersion: SOURCE_URL_NORMALIZATION_VERSION,
    publicSuffixLibraryVersion: PUBLIC_SUFFIX_LIBRARY_VERSION,
    trackingParameterPolicyVersion: TRACKING_PARAMETER_POLICY.version,
    removedTrackingParameters: Object.freeze(
      [...removedTrackingParameters].sort((left, right) =>
        left.localeCompare(right),
      ),
    ),
  });
}

function isTrackingParameter(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    (TRACKING_PARAMETER_POLICY.exactNames as readonly string[]).includes(
      normalizedName,
    ) ||
    TRACKING_PARAMETER_POLICY.prefixes.some((prefix) =>
      normalizedName.startsWith(prefix),
    )
  );
}

function rejected(reason: SourceUrlRejectionReason): RejectedSourceUrl {
  return Object.freeze({
    status: "rejected",
    originalUrl: null,
    reason,
    normalizationVersion: SOURCE_URL_NORMALIZATION_VERSION,
    publicSuffixLibraryVersion: PUBLIC_SUFFIX_LIBRARY_VERSION,
    trackingParameterPolicyVersion: TRACKING_PARAMETER_POLICY.version,
  });
}
