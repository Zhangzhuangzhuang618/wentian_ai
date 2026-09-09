import { z } from "zod";

import { browserCaptureDraftSchema } from "./browser-capture-draft.ts";
import {
  submitConsumerCaptureInputSchema,
  type SubmitConsumerCaptureInputDto,
} from "./consumer-observation.ts";

export const browserCaptureSubmissionContextSchema = z
  .object({
    task_version: z.number().int().positive(),
    screenshot_media_asset_id: z.uuid(),
    adapter_version: z.string().trim().min(1).max(120),
    reviewed_session_metadata: z
      .object({
        surface_model_label: z.string().trim().min(1).max(120).nullable(),
        is_new_conversation: z.boolean(),
        is_logged_in: z.boolean(),
        memory_enabled: z.boolean().nullable(),
        personalization_enabled: z.boolean().nullable(),
        locale: z.string().trim().min(2).max(16),
        region: z.string().trim().min(1).max(120).nullable(),
      })
      .strict(),
  })
  .strict();

export type BrowserCaptureSubmissionContext = z.infer<
  typeof browserCaptureSubmissionContextSchema
>;

export function adaptConfirmedBrowserCaptureDraftToSubmission(
  draftInput: unknown,
  contextInput: unknown,
): SubmitConsumerCaptureInputDto {
  const draft = browserCaptureDraftSchema.parse(draftInput);
  if (draft.confirmation_status !== "confirmed_local_export") {
    throw new Error("BROWSER_CAPTURE_LOCAL_CONFIRMATION_REQUIRED");
  }
  const context = browserCaptureSubmissionContextSchema.parse(contextInput);

  return submitConsumerCaptureInputSchema.parse({
    task_version: context.task_version,
    answer_text: draft.answer_text,
    visible_citations: draft.visible_citations.map((citation) => ({
      url: citation.url,
      label: citation.label,
      position: citation.position,
      ...(citation.observed_url
        ? {
            observed_url: citation.observed_url,
            resolution: citation.resolution,
          }
        : {}),
    })),
    ...(draft.visible_search_trace
      ? { visible_search_trace: draft.visible_search_trace }
      : {}),
    visible_metadata: {
      product_label: draft.visible_metadata.product_label,
      surface_model_label:
        context.reviewed_session_metadata.surface_model_label,
      search_mode: draft.visible_metadata.search_mode,
      is_new_conversation:
        context.reviewed_session_metadata.is_new_conversation,
      is_logged_in: context.reviewed_session_metadata.is_logged_in,
      memory_enabled: context.reviewed_session_metadata.memory_enabled,
      personalization_enabled:
        context.reviewed_session_metadata.personalization_enabled,
      locale: context.reviewed_session_metadata.locale,
      region: context.reviewed_session_metadata.region,
      observed_at: draft.visible_metadata.observed_at,
    },
    screenshot_media_asset_id: context.screenshot_media_asset_id,
    adapter_version: context.adapter_version,
    collection_method: "browser_assisted",
  });
}
