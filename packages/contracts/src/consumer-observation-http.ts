import { z } from "zod";

import {
  confirmConsumerObservationInputSchema,
  consumerCollectionMethodSchema,
  consumerSessionConditionsSchema,
  createConsumerObservationInputSchema,
  rejectConsumerObservationInputSchema,
  submitConsumerCaptureInputSchema,
} from "./consumer-observation.ts";

export const CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION =
  "wentian-consumer-observation-http@0-draft" as const;

export const CONSUMER_OBSERVATION_API_ROUTES = Object.freeze({
  create: "/ai-visibility/consumer-observations",
  claim: "/ai-visibility/consumer-observations/tasks/{id}/claim",
  captures: "/ai-visibility/consumer-observations/tasks/{id}/captures",
  confirm: "/ai-visibility/consumer-observations/tasks/{id}/confirm",
  reject: "/ai-visibility/consumer-observations/tasks/{id}/reject",
} as const);

const formalResponseIdentityFields = {
  contract_version: z.literal(CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION),
  task_id: z.uuid(),
  task_version: z.number().int().positive(),
} as const;

export const consumerObservationTaskPathSchema = z
  .object({ id: z.uuid() })
  .strict();

export const consumerObservationRunSummarySchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    query_set_snapshot_id: z.uuid(),
    retrieval_mode: z.literal("web_observed"),
    collection_method: consumerCollectionMethodSchema,
    experiment_kind: createConsumerObservationInputSchema.shape.experiment_kind,
    requested_sample_count:
      createConsumerObservationInputSchema.shape.sample_count,
  })
  .strict();

export const consumerObservationTaskSummarySchema = z
  .object({
    id: z.uuid(),
    task_version: z.number().int().positive(),
    status: z.literal("waiting_user"),
    query_snapshot_item_id: z.uuid(),
    sample_index: z.number().int().positive(),
  })
  .strict();

export const createConsumerObservationResponseSchema = z
  .object({
    contract_version: z.literal(CONSUMER_OBSERVATION_HTTP_CONTRACT_VERSION),
    run: consumerObservationRunSummarySchema,
    tasks: z.array(consumerObservationTaskSummarySchema).min(1),
  })
  .strict();

export const claimConsumerObservationTaskInputSchema = z.object({}).strict();

export const claimConsumerObservationTaskResponseSchema = z
  .object({
    ...formalResponseIdentityFields,
    status: z.literal("capturing"),
    scope_id: z.uuid(),
    query_snapshot_item_id: z.uuid(),
    query_text: z.string().trim().min(1).max(20_000),
    surface_code: z.string().trim().min(1).max(80),
    collection_method: consumerCollectionMethodSchema,
    session_conditions: consumerSessionConditionsSchema,
    capture_token: z.string().min(1).max(4_096),
    token_expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const consumerCaptureAuthorizationSchema = z
  .object({ capture_token: z.string().trim().min(1).max(4_096) })
  .strict();

export const consumerObservationIdempotencySchema = z
  .object({ idempotency_key: z.string().trim().min(1).max(200) })
  .strict();

export const submitConsumerCaptureMultipartMetadataSchema =
  submitConsumerCaptureInputSchema.omit({
    screenshot_media_asset_id: true,
    sanitized_dom_object_key: true,
  });

export const confirmConsumerObservationHttpInputSchema =
  confirmConsumerObservationInputSchema;

export const rejectConsumerObservationHttpInputSchema =
  rejectConsumerObservationInputSchema;

export const submitConsumerCaptureResponseSchema = z
  .object({
    ...formalResponseIdentityFields,
    status: z.literal("needs_review"),
    verification_status: z.literal("needs_review"),
    evidence_grade: z.null(),
    capture_artifact_id: z.uuid(),
  })
  .strict();

export const confirmConsumerObservationResponseSchema = z
  .object({
    ...formalResponseIdentityFields,
    status: z.literal("confirmed"),
    verification_status: z.literal("confirmed"),
    evidence_grade: z.enum(["web_confirmed_capture", "web_confirmed_manual"]),
    confirmed_response_id: z.uuid(),
  })
  .strict();

export const rejectConsumerObservationResponseSchema = z
  .object({
    ...formalResponseIdentityFields,
    status: z.literal("rejected"),
    verification_status: z.literal("rejected"),
    evidence_grade: z.null(),
  })
  .strict();
