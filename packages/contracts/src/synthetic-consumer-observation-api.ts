import { z } from "zod";

export const SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION =
  "wentian-synthetic-consumer-api@0" as const;

const syntheticTaskCommandFields = {
  scope_id: z.uuid(),
  task_version: z.number().int().positive(),
} as const;

export const syntheticClaimObservationTaskInputSchema = z
  .object(syntheticTaskCommandFields)
  .strict();

export const syntheticSubmitCaptureInputSchema = z
  .object({
    ...syntheticTaskCommandFields,
    capture_token: z.string().trim().min(1).max(4_096),
  })
  .strict();

export const syntheticConfirmObservationInputSchema = z
  .object(syntheticTaskCommandFields)
  .strict();

export const syntheticRejectObservationInputSchema = z
  .object({
    ...syntheticTaskCommandFields,
    rejection_reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

const syntheticResponseIdentityFields = {
  schema_version: z.literal(SYNTHETIC_CONSUMER_OBSERVATION_API_VERSION),
  synthetic: z.literal(true),
  task_id: z.uuid(),
  task_version: z.number().int().positive(),
} as const;

export const syntheticClaimObservationTaskResponseSchema = z
  .object({
    ...syntheticResponseIdentityFields,
    status: z.literal("capturing"),
    capture_token: z.string().min(1),
  })
  .strict();

export const syntheticSubmitCaptureResponseSchema = z
  .object({
    ...syntheticResponseIdentityFields,
    status: z.literal("needs_review"),
    capture_artifact_id: z.uuid(),
  })
  .strict();

export const syntheticConfirmObservationResponseSchema = z
  .object({
    ...syntheticResponseIdentityFields,
    status: z.literal("confirmed"),
    confirmed_response_id: z.uuid(),
    evidence_grade: z.enum(["web_confirmed_capture", "web_confirmed_manual"]),
  })
  .strict();

export const syntheticRejectObservationResponseSchema = z
  .object({
    ...syntheticResponseIdentityFields,
    status: z.literal("rejected"),
    purged_capture_artifact_id: z.uuid(),
  })
  .strict();

export type SyntheticClaimObservationTaskInput = z.infer<
  typeof syntheticClaimObservationTaskInputSchema
>;
export type SyntheticSubmitCaptureInput = z.infer<
  typeof syntheticSubmitCaptureInputSchema
>;
export type SyntheticConfirmObservationInput = z.infer<
  typeof syntheticConfirmObservationInputSchema
>;
export type SyntheticRejectObservationInput = z.infer<
  typeof syntheticRejectObservationInputSchema
>;
