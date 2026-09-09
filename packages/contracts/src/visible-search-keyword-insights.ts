import { z } from "zod";

import { consumerWebSurfaceCodeSchema } from "./consumer-web-surfaces.ts";

export const VISIBLE_SEARCH_KEYWORD_INSIGHTS_SCHEMA_VERSION =
  "wentian-visible-search-keyword-insights@1" as const;

export const visibleSearchTraceReadStatusSchema = z.enum([
  "complete",
  "partial",
  "not_present",
  "not_collected",
]);

const insightKeywordSchema = z
  .object({
    position: z.number().int().positive(),
    text: z.string().min(1).max(500),
    normalized_text: z.string().min(1).max(500),
  })
  .strict();

const insightReferenceSchema = z
  .object({
    position: z.number().int().positive(),
    title: z.string().min(1).max(500).nullable(),
    url: z.url(),
  })
  .strict();

export const visibleSearchKeywordInsightSampleSchema = z
  .object({
    response_id: z.uuid(),
    run_id: z.uuid(),
    query_set_snapshot_id: z.uuid(),
    query_snapshot_item_id: z.uuid(),
    query_text: z.string().min(1).max(2_000),
    sample_index: z.number().int().positive(),
    surface_code: consumerWebSurfaceCodeSchema,
    product_label: z.string().min(1).max(120),
    industry: z.string().min(1).max(80).nullable(),
    region: z.string().min(1).max(120).nullable(),
    observed_at: z.iso.datetime({ offset: true }),
    confirmed_at: z.iso.datetime({ offset: true }),
    trace_status: visibleSearchTraceReadStatusSchema,
    summary_text: z.string().min(1).max(500).nullable(),
    declared_keyword_count: z.number().int().min(0).max(100).nullable(),
    keywords: z.array(insightKeywordSchema).max(100),
    declared_reference_count: z.number().int().min(0).max(100).nullable(),
    captured_reference_count: z.number().int().min(0).max(100),
    references: z.array(insightReferenceSchema).max(100),
    eligible_for_default_export: z.boolean(),
  })
  .strict();

export const visibleSearchKeywordInsightRowSchema = z
  .object({
    keyword: z.string().min(1).max(500),
    normalized_keyword: z.string().min(1).max(500),
    sample_occurrence_count: z.number().int().positive(),
    question_count: z.number().int().positive(),
    run_count: z.number().int().positive(),
    platforms: z.array(consumerWebSurfaceCodeSchema),
    industries: z.array(z.string().min(1).max(80)),
    regions: z.array(z.string().min(1).max(120)),
    first_seen_at: z.iso.datetime({ offset: true }),
    last_seen_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const visibleSearchKeywordInsightsResponseSchema = z
  .object({
    schema_version: z.literal(VISIBLE_SEARCH_KEYWORD_INSIGHTS_SCHEMA_VERSION),
    scope_id: z.uuid(),
    filters: z
      .object({
        run_id: z.uuid().nullable(),
        surface_code: consumerWebSurfaceCodeSchema.nullable(),
        industry: z.string().min(1).max(80).nullable(),
        region: z.string().min(1).max(120).nullable(),
        query: z.string().min(1).max(200).nullable(),
      })
      .strict(),
    summary: z
      .object({
        confirmed_sample_count: z.number().int().nonnegative(),
        complete_trace_count: z.number().int().nonnegative(),
        partial_trace_count: z.number().int().nonnegative(),
        not_present_trace_count: z.number().int().nonnegative(),
        not_collected_trace_count: z.number().int().nonnegative(),
        keyword_occurrence_count: z.number().int().nonnegative(),
        unique_keyword_count: z.number().int().nonnegative(),
      })
      .strict(),
    keywords: z.array(visibleSearchKeywordInsightRowSchema),
    samples: z.array(visibleSearchKeywordInsightSampleSchema),
    methodology: z
      .object({
        aggregation_version: z.literal("visible-search-keyword-count@1"),
        default_export_rule: z.literal("confirmed_complete_trace_only"),
        within_sample_deduplication: z.literal("normalized_exact_phrase"),
        normalization: z.literal("unicode_nfkc_trim_space_casefold"),
        evidence_warning: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export type VisibleSearchKeywordInsightsResponse = z.infer<
  typeof visibleSearchKeywordInsightsResponseSchema
>;
