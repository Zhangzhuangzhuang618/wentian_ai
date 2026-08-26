import { z } from "zod";

import { browserCaptureDraftSchema } from "./browser-capture-draft.ts";
import { browserCaptureSubmissionContextSchema } from "./browser-capture-submission-adapter.ts";
import {
  consumerCollectionMethodSchema,
  consumerSessionConditionsSchema,
  createConsumerObservationInputSchema,
} from "./consumer-observation.ts";
import { localQueryInputSchema } from "./scope-query-set.ts";
import { consumerWebSurfaceCodeSchema } from "./consumer-web-surfaces.ts";

export const createStandaloneQuerySetInputSchema = z
  .object({
    scope_id: z.uuid(),
    title: z.string().trim().min(1).max(120),
    locale: z.string().trim().min(2).max(16),
    market: z.string().trim().min(1).max(120).nullable().optional(),
    industry: z.string().trim().min(1).max(80),
    region: z.string().trim().min(1).max(80),
    generator_version: z.literal("industry-question-generator@1").optional(),
    queries: z.array(localQueryInputSchema).min(1).max(100),
  })
  .strict();

export const standaloneQuerySetResponseSchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    title: z.string().min(1),
    industry: z.string().min(1).max(80),
    region: z.string().min(1).max(80),
    generator_version: z.literal("industry-question-generator@1").nullable(),
    snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
    query_count: z.number().int().positive(),
    created: z.boolean(),
    items: z.array(
      z
        .object({
          id: z.uuid(),
          ordinal: z.number().int().positive(),
          query_text: z.string().min(1),
          intent_code: localQueryInputSchema.shape.intent_code,
          commercial_value: localQueryInputSchema.shape.commercial_value,
        })
        .strict(),
    ),
  })
  .strict();

export const createStandaloneConsumerRunInputSchema =
  createConsumerObservationInputSchema;

export const standaloneConsumerRunResponseSchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    query_set_snapshot_id: z.uuid(),
    surface_code: consumerWebSurfaceCodeSchema,
    collection_method: consumerCollectionMethodSchema,
    experiment_kind: z.enum(["natural_answer", "source_nomination"]),
    requested_sample_count: z.number().int().min(1).max(5),
    planned_sample_count: z.number().int().positive(),
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "partial",
      "failed",
      "cancelled",
    ]),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const standaloneDeleteConsumerRunResponseSchema = z
  .object({ deleted_run_id: z.uuid() })
  .strict();

export const standaloneConsumerTaskSchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    run_id: z.uuid(),
    query_snapshot_item_id: z.uuid(),
    query_text: z.string().min(1),
    sample_index: z.number().int().positive(),
    status: z.enum([
      "waiting_user",
      "capturing",
      "needs_review",
      "confirmed",
      "rejected",
      "expired",
      "cancelled",
    ]),
    task_version: z.number().int().positive(),
    collection_method: consumerCollectionMethodSchema,
    capture_artifact_id: z.uuid().nullable().optional(),
    confirmed_response_id: z.uuid().nullable().optional(),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const standaloneConsumerTaskListResponseSchema = z
  .object({ tasks: z.array(standaloneConsumerTaskSchema) })
  .strict();

export const standaloneConsumerTaskPreviewResponseSchema = z
  .object({
    task_id: z.uuid(),
    task_version: z.number().int().positive(),
    status: z.enum(["needs_review", "confirmed"]),
    answer_text: z.string().min(1).max(200_000),
    visible_citations: z
      .array(
        z
          .object({
            url: z.url(),
            label: z.string().min(1).max(500).nullable(),
            position: z.number().int().positive(),
            observed_url: z.url().nullable(),
            resolution: z.literal("known_redirect_target").nullable(),
          })
          .strict(),
      )
      .max(100),
    visible_metadata: z
      .object({
        product_label: z.string().min(1),
        surface_model_label: z.string().min(1).max(120).nullable(),
        search_mode: z.enum(["enabled", "disabled", "unknown"]),
        is_new_conversation: z.boolean(),
        is_logged_in: z.boolean(),
        locale: z.string().min(2),
        region: z.string().min(1).max(120).nullable(),
        observed_at: z.iso.datetime({ offset: true }),
      })
      .strict(),
    screenshot_evidence_saved: z.literal(true),
  })
  .strict();

export const standaloneClaimTaskResponseSchema = z
  .object({
    task: standaloneConsumerTaskSchema,
    surface_code: consumerWebSurfaceCodeSchema,
    session_conditions: consumerSessionConditionsSchema,
    capture_token: z.string().min(1).max(4_096),
    token_expires_at: z.iso.datetime({ offset: true }),
    extension_handoff_code: z.string().min(1).max(16_384),
  })
  .strict();

export const standaloneCreateAutomationBatchInputSchema = z.object({}).strict();

export const standaloneCreateAutomationBatchResponseSchema = z
  .object({
    status: z.literal("ready"),
    run_id: z.uuid(),
    total_task_count: z.number().int().positive(),
    remaining_task_count: z.number().int().positive(),
    token_expires_at: z.iso.datetime({ offset: true }),
    batch_handoff_code: z.string().min(1).max(16_384),
  })
  .strict();

export const standaloneAutomationBatchNextInputSchema = z
  .object({
    batch_token: z.string().trim().min(1).max(4_096),
  })
  .strict();

export const standaloneAutomationBatchNextResponseSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("task_ready"),
        run_id: z.uuid(),
        total_task_count: z.number().int().positive(),
        completed_task_count: z.number().int().nonnegative(),
        remaining_task_count: z.number().int().nonnegative(),
        claim: standaloneClaimTaskResponseSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("complete"),
        run_id: z.uuid(),
        total_task_count: z.number().int().positive(),
        completed_task_count: z.number().int().nonnegative(),
        remaining_task_count: z.literal(0),
      })
      .strict(),
  ],
);

export const standaloneAutomationPreflightInputSchema = z
  .object({
    capture_token: z.string().trim().min(1).max(4_096),
    task_version: z.number().int().positive(),
  })
  .strict();

export const standaloneAutomationPreflightResponseSchema = z
  .object({
    status: z.literal("ready"),
    task_id: z.uuid(),
    task_version: z.number().int().positive(),
    surface_code: consumerWebSurfaceCodeSchema,
    prompt: z.string().trim().min(1).max(2_000),
    expected_page_origin: z.enum([
      "https://www.doubao.com",
      "https://www.qianwen.com",
    ]),
    page_signature_version: z.string().min(1).max(120),
    token_expires_at: z.iso.datetime({ offset: true }),
    review_required: z.literal(true),
  })
  .strict();

export const standaloneBrowserCaptureUploadSchema = z
  .object({
    capture_token: z.string().trim().min(1).max(4_096),
    task_version: z.number().int().positive(),
    draft: browserCaptureDraftSchema,
    reviewed_session_metadata:
      browserCaptureSubmissionContextSchema.shape.reviewed_session_metadata,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.draft.confirmation_status !== "confirmed_local_export") {
      context.addIssue({
        code: "custom",
        path: ["draft", "confirmation_status"],
        message: "BROWSER_CAPTURE_LOCAL_CONFIRMATION_REQUIRED",
      });
    }
  });

export const standaloneCaptureUploadResponseSchema = z
  .object({
    task_id: z.uuid(),
    task_version: z.number().int().positive(),
    status: z.literal("needs_review"),
    capture_artifact_id: z.uuid(),
    screenshot_media_asset_id: z.uuid(),
  })
  .strict();

export const standaloneConfirmTaskInputSchema = z
  .object({ task_version: z.number().int().positive() })
  .strict();

export const standaloneRejectTaskInputSchema = z
  .object({
    task_version: z.number().int().positive(),
    rejection_reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const standaloneTerminalTaskResponseSchema = z
  .object({
    task_id: z.uuid(),
    task_version: z.number().int().positive(),
    status: z.enum(["confirmed", "rejected"]),
    confirmed_response_id: z.uuid().optional(),
    evidence_grade: z
      .enum(["web_confirmed_capture", "web_confirmed_manual"])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const confirmed = value.status === "confirmed";
    if (
      confirmed !== Boolean(value.confirmed_response_id) ||
      confirmed !== Boolean(value.evidence_grade)
    ) {
      context.addIssue({
        code: "custom",
        message: "TERMINAL_TASK_RESPONSE_STATE_MISMATCH",
      });
    }
  });

const standaloneNominationReviewItemSchema = z
  .object({
    registrable_domain: z.string().trim().min(1).max(253),
    position: z.number().int().positive().nullable(),
    information_type: z.string().trim().min(1).max(500).nullable(),
    reason: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const standaloneNominationReviewSchema = z
  .object({
    id: z.uuid(),
    scope_id: z.uuid(),
    response_id: z.uuid(),
    proposed_items: z.array(standaloneNominationReviewItemSchema).max(10),
    extraction_version: z.string().min(1).max(120),
    valid_explicit_occurrence_count: z.number().int().nonnegative(),
    rejected_explicit_occurrence_count: z.number().int().nonnegative(),
    extraction_truncated: z.boolean(),
    status: z.enum(["needs_review", "confirmed", "rejected"]),
    rejection_reason: z.string().min(1).max(1_000).nullable(),
    version: z.number().int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const standaloneCreateNominationReviewResponseSchema = z
  .object({
    review: standaloneNominationReviewSchema,
    created: z.boolean(),
    extraction_status: z.enum(["review_required", "no_explicit_source"]),
    warning: z.literal("EXPLICIT_ONLY_NO_NAME_TO_DOMAIN_INFERENCE"),
  })
  .strict();

export const standaloneNominationReviewListResponseSchema = z
  .object({ reviews: z.array(standaloneNominationReviewSchema) })
  .strict();

export const standaloneConfirmNominationReviewInputSchema = z
  .object({
    review_version: z.number().int().positive(),
    reviewed_items: z.array(standaloneNominationReviewItemSchema).max(10),
  })
  .strict();

export const standaloneRejectNominationReviewInputSchema = z
  .object({
    review_version: z.number().int().positive(),
    rejection_reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const standaloneConsumerCatalogResponseSchema = z
  .object({
    snapshots: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().min(1).max(120),
          industry: z.string().min(1).max(80).nullable(),
          region: z.string().min(1).max(80).nullable(),
          generator_version: z
            .literal("industry-question-generator@1")
            .nullable(),
          query_count: z.number().int().positive(),
          snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
          created_at: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
    runs: z.array(
      z
        .object({
          id: z.uuid(),
          query_set_snapshot_id: z.uuid(),
          industry: z.string().min(1).max(80).nullable(),
          region: z.string().min(1).max(80).nullable(),
          surface_code: consumerWebSurfaceCodeSchema,
          experiment_kind: z.enum(["natural_answer", "source_nomination"]),
          paired_run_id: z.uuid().nullable(),
          status: z.enum([
            "queued",
            "running",
            "succeeded",
            "partial",
            "failed",
            "cancelled",
          ]),
          requested_sample_count: z.number().int().min(1).max(5),
          planned_sample_count: z.number().int().positive(),
          successful_sample_count: z.number().int().nonnegative(),
          session_conditions: consumerSessionConditionsSchema,
          created_at: z.iso.datetime({ offset: true }),
          started_at: z.iso.datetime({ offset: true }).nullable(),
          completed_at: z.iso.datetime({ offset: true }).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const standaloneSourceRankingResponseSchema = z
  .object({
    run_id: z.uuid(),
    scope_id: z.uuid(),
    query_snapshot_item_id: z.uuid(),
    experiment_kind: z.enum(["natural_answer", "source_nomination"]),
    total_formal_source_entries: z.number().int().nonnegative(),
    ranking: z.array(
      z
        .object({
          rank: z.number().int().positive(),
          registrable_domain: z.string().min(1),
          display_origin: z
            .url()
            .refine((value) => new URL(value).origin === value),
          formal_source_entry_count: z.number().int().positive(),
        })
        .strict(),
    ),
    evidence_warning: z.literal(
      "仅统计已确认回答中的正式可见信源条目，不代表隐藏抓取频率或平台内部权重。",
    ),
  })
  .strict();

export type StandaloneBrowserCaptureUpload = z.infer<
  typeof standaloneBrowserCaptureUploadSchema
>;
