import { z } from "zod";

export const wentianProjectRoleSchema = z.enum([
  "owner",
  "admin",
  "analyst",
  "viewer",
]);

export const queryIntentCodeSchema = z.enum([
  "brand_recognition",
  "exploration",
  "recommendation",
  "comparison",
  "education",
  "procurement",
]);

export const commercialValueSchema = z.enum(["low", "medium", "high"]);

export const localQueryInputSchema = z
  .object({
    external_key: z.string().trim().min(1).max(120).optional(),
    query_text: z.string().trim().min(1).max(1_000),
    intent_code: queryIntentCodeSchema,
    commercial_value: commercialValueSchema,
  })
  .strict();

export const createLocalQuerySetSnapshotInputSchema = z
  .object({
    scope_id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    locale: z.string().trim().min(2).max(16),
    market: z.string().trim().min(1).max(120).nullable().optional(),
    industry: z.string().trim().min(1).max(80).nullable().optional(),
    region: z.string().trim().min(1).max(80).nullable().optional(),
    source_ref: z.string().trim().min(1).max(200).optional(),
    source_revision: z.string().trim().min(1).max(120).optional(),
    queries: z.array(localQueryInputSchema).min(1).max(100),
  })
  .strict();

export type WentianProjectRoleDto = z.infer<typeof wentianProjectRoleSchema>;
export type QueryIntentCodeDto = z.infer<typeof queryIntentCodeSchema>;
export type CommercialValueDto = z.infer<typeof commercialValueSchema>;
export type CreateLocalQuerySetSnapshotInputDto = z.infer<
  typeof createLocalQuerySetSnapshotInputSchema
>;
