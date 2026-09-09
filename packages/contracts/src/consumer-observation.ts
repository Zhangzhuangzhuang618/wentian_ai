import { z } from "zod";

export const consumerCollectionMethodSchema = z.enum([
  "browser_assisted",
  "manual_import",
]);

export const consumerSurfaceProfileStatusSchema = z.enum([
  "draft",
  "active",
  "suspended",
]);

export const surfaceEquivalenceLevelSchema = z.enum([
  "exact",
  "approximate",
  "unknown",
]);

export const observationTaskStatusSchema = z.enum([
  "waiting_user",
  "capturing",
  "needs_review",
  "confirmed",
  "rejected",
  "expired",
  "cancelled",
]);

export const observationVerificationStatusSchema = z.enum([
  "not_required",
  "needs_review",
  "confirmed",
  "rejected",
]);

export const observationEvidenceGradeSchema = z.enum([
  "api_structured",
  "web_confirmed_capture",
  "web_confirmed_manual",
  "imported_declared",
]);

export const attendedCaptureDataKindSchema = z.enum([
  "answer_text",
  "visible_citations",
  "visible_metadata",
  "visible_search_trace",
  "viewport_screenshot",
  "sanitized_visible_dom",
]);

export const attendedCapturePreflightInputSchema = z
  .object({
    surface_code: z.string().trim().min(1).max(80),
    page_origin: z.url(),
    user_initiated: z.boolean(),
    current_task_id: z.uuid(),
    token_task_id: z.uuid(),
    is_current_visible_page: z.boolean(),
    page_signature_status: z.enum(["matched", "mismatched", "unknown"]),
    answer_state: z.enum(["complete", "generating", "unknown"]),
    source_panel_state: z.enum(["loaded", "not_present", "loading", "unknown"]),
    requested_data_kinds: z.array(attendedCaptureDataKindSchema).min(1).max(6),
  })
  .strict()
  .superRefine((input, context) => {
    const pageUrl = new URL(input.page_origin);
    if (
      input.page_origin !== pageUrl.origin &&
      input.page_origin !== `${pageUrl.origin}/`
    ) {
      context.addIssue({
        code: "custom",
        path: ["page_origin"],
        message: "CAPTURE_PAGE_ORIGIN_ONLY",
      });
    }

    for (const dataKind of [
      "answer_text",
      "visible_metadata",
      "viewport_screenshot",
    ] as const) {
      if (!input.requested_data_kinds.includes(dataKind)) {
        context.addIssue({
          code: "custom",
          path: ["requested_data_kinds"],
          message: `CAPTURE_REQUIRED_DATA_MISSING:${dataKind}`,
        });
      }
    }
  });

const httpUrlSchema = z
  .url()
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
  );

export const visibleSourceCapabilitiesSchema = z
  .object({
    visible_citations: z.boolean(),
    source_panel: z.boolean(),
    screenshot: z.boolean(),
    sanitized_dom: z.boolean(),
  })
  .strict();

export const publishConsumerSurfaceProfileInputSchema = z
  .object({
    surface_code: z.string().trim().min(1).max(80),
    product_label: z.string().trim().min(1).max(120),
    adapter_version: z.string().trim().min(1).max(120),
    allowed_collection_methods: z.array(consumerCollectionMethodSchema).max(2),
    visible_source_capabilities: visibleSourceCapabilitiesSchema,
    comparison_surface_model_label: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable(),
    comparison_provider_code: z.string().trim().min(1).max(80).nullable(),
    comparison_model_key: z.string().trim().min(1).max(120).nullable(),
    equivalence_level: surfaceEquivalenceLevelSchema,
    equivalence_basis: z.string().trim().min(1).max(1_000).nullable(),
    equivalence_evidence_url: httpUrlSchema.nullable(),
    equivalence_reviewed_at: z.iso.datetime({ offset: true }).nullable(),
    terms_reviewed_at: z.iso.datetime({ offset: true }).nullable(),
    status: consumerSurfaceProfileStatusSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.status !== "draft" &&
      input.allowed_collection_methods.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowed_collection_methods"],
        message: "SURFACE_COLLECTION_METHOD_REQUIRED",
      });
    }
    if (input.status === "active" && !input.terms_reviewed_at) {
      context.addIssue({
        code: "custom",
        path: ["terms_reviewed_at"],
        message: "ACTIVE_SURFACE_TERMS_REVIEW_REQUIRED",
      });
    }
    if (input.equivalence_level === "unknown") {
      if (input.comparison_provider_code || input.comparison_model_key) {
        context.addIssue({
          code: "custom",
          path: ["equivalence_level"],
          message: "UNKNOWN_EQUIVALENCE_API_MAPPING_FORBIDDEN",
        });
      }
      return;
    }
    if (
      !input.comparison_surface_model_label ||
      !input.comparison_provider_code ||
      !input.comparison_model_key ||
      !input.equivalence_basis ||
      !input.equivalence_reviewed_at
    ) {
      context.addIssue({
        code: "custom",
        path: ["equivalence_level"],
        message: "EQUIVALENCE_MAPPING_INCOMPLETE",
      });
    }
    if (
      input.equivalence_level === "exact" &&
      !input.equivalence_evidence_url
    ) {
      context.addIssue({
        code: "custom",
        path: ["equivalence_evidence_url"],
        message: "EXACT_EQUIVALENCE_EVIDENCE_REQUIRED",
      });
    }
  });

export const consumerSessionConditionsSchema = z
  .object({
    search_mode: z.enum(["enabled", "disabled", "unknown"]),
    is_new_conversation: z.boolean(),
    is_logged_in: z.boolean(),
    memory_enabled: z.boolean().nullable(),
    personalization_enabled: z.boolean().nullable(),
    locale: z.string().trim().min(2).max(16),
    region: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

export const createConsumerObservationInputSchema = z
  .object({
    scope_id: z.uuid(),
    query_set_snapshot_id: z.uuid(),
    surface_code: z.string().trim().min(1).max(80),
    collection_method: consumerCollectionMethodSchema,
    experiment_kind: z.enum(["natural_answer", "source_nomination"]),
    sample_count: z.number().int().min(1).max(5),
    session_conditions: consumerSessionConditionsSchema,
    paired_run_id: z.uuid().nullable().optional(),
  })
  .strict();

export const visibleCitationInputSchema = z
  .object({
    url: httpUrlSchema,
    label: z.string().trim().min(1).max(500).nullable().optional(),
    position: z.number().int().positive(),
    observed_url: httpUrlSchema.optional(),
    resolution: z.literal("known_redirect_target").optional(),
  })
  .strict()
  .superRefine((citation, context) => {
    if (citation.resolution && !citation.observed_url) {
      context.addIssue({
        code: "custom",
        path: ["observed_url"],
        message: "VISIBLE_CITATION_OBSERVED_URL_REQUIRED",
      });
    }
    if (citation.observed_url && !citation.resolution) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "VISIBLE_CITATION_RESOLUTION_REQUIRED",
      });
    }
  });

export const visibleObservationMetadataSchema = z
  .object({
    product_label: z.string().trim().min(1).max(120),
    surface_model_label: z.string().trim().min(1).max(120).nullable(),
    search_mode: z.enum(["enabled", "disabled", "unknown"]),
    is_new_conversation: z.boolean(),
    is_logged_in: z.boolean(),
    memory_enabled: z.boolean().nullable(),
    personalization_enabled: z.boolean().nullable(),
    locale: z.string().trim().min(2).max(16),
    region: z.string().trim().min(1).max(120).nullable(),
    observed_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const visibleSearchTraceInputSchema = z
  .object({
    status: z.enum(["complete", "partial", "not_present"]),
    summary_text: z.string().trim().min(1).max(500).nullable(),
    declared_keyword_count: z.number().int().min(0).max(100).nullable(),
    keywords: z
      .array(
        z
          .object({
            position: z.number().int().positive(),
            text: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
    declared_reference_count: z.number().int().min(0).max(100).nullable(),
  })
  .strict()
  .superRefine((trace, context) => {
    const contiguous = trace.keywords.every(
      (keyword, index) => keyword.position === index + 1,
    );
    if (!contiguous) {
      context.addIssue({
        code: "custom",
        path: ["keywords"],
        message: "VISIBLE_SEARCH_KEYWORD_POSITIONS_NOT_CONTIGUOUS",
      });
    }
    if (trace.status === "not_present") {
      if (
        trace.summary_text !== null ||
        trace.declared_keyword_count !== null ||
        trace.declared_reference_count !== null ||
        trace.keywords.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "VISIBLE_SEARCH_NOT_PRESENT_MUST_BE_EMPTY",
        });
      }
      return;
    }
    if (trace.summary_text === null || trace.declared_keyword_count === null) {
      context.addIssue({
        code: "custom",
        message: "VISIBLE_SEARCH_TRACE_SUMMARY_REQUIRED",
      });
    }
    if (
      trace.status === "complete" &&
      trace.declared_keyword_count !== trace.keywords.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["keywords"],
        message: "VISIBLE_SEARCH_COMPLETE_KEYWORD_COUNT_MISMATCH",
      });
    }
  });

export const submitConsumerCaptureInputSchema = z
  .object({
    task_version: z.number().int().positive(),
    answer_text: z.string().trim().min(1).max(200_000),
    visible_citations: z.array(visibleCitationInputSchema).max(100),
    visible_search_trace: visibleSearchTraceInputSchema.optional(),
    visible_metadata: visibleObservationMetadataSchema,
    screenshot_media_asset_id: z.uuid(),
    sanitized_dom_object_key: z.string().trim().min(1).max(500).optional(),
    adapter_version: z.string().trim().min(1).max(120),
    collection_method: consumerCollectionMethodSchema,
  })
  .strict();

export const confirmConsumerObservationInputSchema = z
  .object({
    task_version: z.number().int().positive(),
  })
  .strict();

export const rejectConsumerObservationInputSchema = z
  .object({
    task_version: z.number().int().positive(),
    rejection_reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type CreateConsumerObservationInputDto = z.infer<
  typeof createConsumerObservationInputSchema
>;
export type SubmitConsumerCaptureInputDto = z.infer<
  typeof submitConsumerCaptureInputSchema
>;
