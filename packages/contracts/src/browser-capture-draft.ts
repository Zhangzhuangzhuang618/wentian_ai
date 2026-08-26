import { z } from "zod";

import {
  CONSUMER_WEB_SURFACES,
  consumerWebSurfaceCodeSchema,
} from "./consumer-web-surfaces.ts";

export const BROWSER_CAPTURE_DRAFT_SCHEMA_VERSION =
  "wentian-consumer-capture@0-draft" as const;

const browserDraftHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "BROWSER_CAPTURE_HTTP_URL_REQUIRED");

function isKnownDoubaoRedirectWrapper(value: string): boolean {
  try {
    return new URL(value).hostname === "link.wtturl.cn";
  } catch {
    return false;
  }
}

export const browserCaptureVisibleCitationSchema = z
  .object({
    url: browserDraftHttpUrlSchema,
    label: z.string().trim().min(1).max(500),
    position: z.number().int().positive(),
    observed_url: browserDraftHttpUrlSchema.optional(),
    resolution: z.literal("known_redirect_target").optional(),
  })
  .strict()
  .superRefine((citation, context) => {
    if (citation.resolution && !citation.observed_url) {
      context.addIssue({
        code: "custom",
        path: ["observed_url"],
        message: "BROWSER_CAPTURE_REDIRECT_OBSERVED_URL_REQUIRED",
      });
    }
    if (citation.observed_url && !citation.resolution) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "BROWSER_CAPTURE_REDIRECT_RESOLUTION_REQUIRED",
      });
    }
    if (
      citation.observed_url &&
      !isKnownDoubaoRedirectWrapper(citation.observed_url)
    ) {
      context.addIssue({
        code: "custom",
        path: ["observed_url"],
        message: "BROWSER_CAPTURE_UNKNOWN_REDIRECT_WRAPPER",
      });
    }
  });

export const browserCaptureSourceMentionHintSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    position: z.number().int().positive(),
    evidenceText: z.string().trim().min(1).max(1_000),
    classification: z.literal("unverified_text_mention"),
  })
  .strict();

export const browserCaptureDraftSchema = z
  .object({
    schema_version: z.literal(BROWSER_CAPTURE_DRAFT_SCHEMA_VERSION),
    adapter_status: z.literal("draft"),
    surface_code: consumerWebSurfaceCodeSchema,
    collection_method: z.literal("browser_assisted"),
    confirmation_status: z.enum(["needs_review", "confirmed_local_export"]),
    confirmed_at: z.iso.datetime({ offset: true }).optional(),
    answer_text: z.string().trim().min(1).max(200_000),
    visible_citations: z.array(browserCaptureVisibleCitationSchema).max(100),
    source_mention_hints: z
      .array(browserCaptureSourceMentionHintSchema)
      .max(100),
    visible_metadata: z
      .object({
        product_label: z.enum(["豆包网页版", "千问网页版"]),
        page_title: z.string().trim().min(1).max(500),
        page_origin: z.enum([
          "https://www.doubao.com",
          "https://www.qianwen.com",
        ]),
        search_mode: z.literal("unknown"),
        observed_at: z.iso.datetime({ offset: true }),
      })
      .strict(),
    screenshot: z
      .object({
        scope: z.literal("selected_visible_region"),
        media_type: z.literal("image/png"),
        data_url: z
          .string()
          .min("data:image/png;base64,AA==".length)
          .max(15_000_000)
          .regex(
            /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/,
            "BROWSER_CAPTURE_PNG_DATA_URL_REQUIRED",
          ),
      })
      .strict(),
  })
  .strict()
  .superRefine((capture, context) => {
    const surface = CONSUMER_WEB_SURFACES[capture.surface_code];
    if (capture.visible_metadata.product_label !== surface.productLabel) {
      context.addIssue({
        code: "custom",
        path: ["visible_metadata", "product_label"],
        message: "BROWSER_CAPTURE_PRODUCT_LABEL_MISMATCH",
      });
    }
    if (capture.visible_metadata.page_origin !== surface.allowedPageOrigin) {
      context.addIssue({
        code: "custom",
        path: ["visible_metadata", "page_origin"],
        message: "BROWSER_CAPTURE_ORIGIN_MISMATCH",
      });
    }
    if (
      capture.confirmation_status === "confirmed_local_export" &&
      !capture.confirmed_at
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmed_at"],
        message: "BROWSER_CAPTURE_CONFIRMATION_TIME_REQUIRED",
      });
    }
    if (
      capture.confirmation_status === "needs_review" &&
      capture.confirmed_at
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmed_at"],
        message: "BROWSER_CAPTURE_PREVIEW_CONFIRMATION_TIME_FORBIDDEN",
      });
    }
  });

export type BrowserCaptureDraft = z.infer<typeof browserCaptureDraftSchema>;
export type BrowserCaptureVisibleCitation = z.infer<
  typeof browserCaptureVisibleCitationSchema
>;
export type BrowserCaptureSourceMentionHint = z.infer<
  typeof browserCaptureSourceMentionHintSchema
>;
