import { z } from "zod";

export const localLoginInputSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(200),
  })
  .strict();

export const localUserSchema = z
  .object({
    id: z.uuid(),
    email: z.string().email().max(320),
    display_name: z.string().trim().min(1).max(120),
    instance_role: z.enum(["owner", "admin"]).nullable(),
    authorization_role: z.enum(["owner", "admin", "analyst", "viewer"]),
    auth_source: z.enum(["local", "geo"]),
  })
  .strict();

export const localSessionResponseSchema = z
  .object({
    user: localUserSchema,
    csrf_token: z.string().min(43).max(128),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const standaloneScopeSchema = z
  .object({
    id: z.uuid(),
    project_key: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/),
    display_name: z.string().trim().min(1).max(160),
    industry: z.string().trim().min(1).max(80).nullable(),
    region: z.string().trim().min(1).max(80).nullable(),
    status: z.enum(["active", "archived", "deleting"]),
    retention_policy_code: z.string().trim().min(1).max(80),
    role: z.enum(["owner", "admin", "analyst", "viewer"]),
    version: z.number().int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const standaloneScopeListResponseSchema = z
  .object({ scopes: z.array(standaloneScopeSchema) })
  .strict();

export const createStandaloneScopeInputSchema = z
  .object({
    project_key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/),
    display_name: z.string().trim().min(1).max(160),
    industry: z.string().trim().min(1).max(80),
    region: z.string().trim().min(1).max(80),
  })
  .strict();

export const updateStandaloneScopeMetadataInputSchema = z
  .object({
    industry: z.string().trim().min(1).max(80).nullable(),
    region: z.string().trim().min(1).max(80).nullable(),
    version: z.number().int().positive(),
  })
  .strict();

export const consumerAutomationSettingsSchema = z
  .object({
    scope_id: z.uuid(),
    automation_enabled: z.boolean(),
    allowed_usage_region: z.literal("CN_MAINLAND"),
    governance_policy_version: z.literal("consumer-observation-governance@1"),
    version: z.number().int().positive(),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const updateConsumerAutomationSettingsInputSchema = z
  .object({
    automation_enabled: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();

export const requestScopeDeletionInputSchema = z
  .object({
    project_key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/),
    password: z.string().min(12).max(200),
    version: z.number().int().positive(),
  })
  .strict();

export const retryScopeDeletionInputSchema = z
  .object({ password: z.string().min(12).max(200) })
  .strict();

export const scopeDeletionJobSchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    project_key: z.string().min(1).max(80),
    status: z.enum(["running", "failed", "succeeded"]),
    attempt_count: z.number().int().positive(),
    requested_at: z.iso.datetime({ offset: true }),
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    last_error_code: z.string().min(1).max(160).nullable(),
  })
  .strict();

export type LocalLoginInput = z.infer<typeof localLoginInputSchema>;
export type LocalUserDto = z.infer<typeof localUserSchema>;
export type LocalSessionResponse = z.infer<typeof localSessionResponseSchema>;
export type StandaloneScopeDto = z.infer<typeof standaloneScopeSchema>;
export type ConsumerAutomationSettingsDto = z.infer<
  typeof consumerAutomationSettingsSchema
>;
export type ScopeDeletionJobDto = z.infer<typeof scopeDeletionJobSchema>;
