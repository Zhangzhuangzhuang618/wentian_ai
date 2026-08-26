import { z } from "zod";

export * from "./consumer-observation.ts";
export * from "./consumer-web-surfaces.ts";
export * from "./consumer-nomination-citation-comparison.ts";
export * from "./consumer-observation-metrics.ts";
export * from "./consumer-source-nomination-run-metrics.ts";
export * from "./browser-capture-draft.ts";
export * from "./browser-capture-submission-adapter.ts";
export * from "./scope-query-set.ts";
export * from "./source-nomination-metrics.ts";
export * from "./source-nomination-review.ts";
export * from "./consumer-observation-http.ts";
export * from "./manual-consumer-observation-submission.ts";
export * from "./nomination-citation-overlap.ts";
export * from "./synthetic-consumer-observation-api.ts";
export * from "./standalone-local-access.ts";
export * from "./standalone-consumer-observation-api.ts";
export * from "./geo-connector.ts";

export const WENTIAN_SYSTEM_ID = "wentian" as const;
export const WENTIAN_CORE_CONTRACT_VERSION = "wentian-core@0" as const;

export const dependencyStateSchema = z.enum([
  "ready",
  "not_configured",
  "unavailable",
]);

export const readinessChecksSchema = z
  .object({
    database: dependencyStateSchema,
    objectStore: dependencyStateSchema,
  })
  .strict();

export const livenessResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("wentian-api"),
  version: z.string().min(1),
});

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("wentian-api"),
  version: z.string().min(1),
  checks: readinessChecksSchema,
});

export type DependencyState = z.infer<typeof dependencyStateSchema>;
export type ReadinessChecks = z.infer<typeof readinessChecksSchema>;
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
