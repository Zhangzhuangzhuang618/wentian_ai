import { z } from "zod";

import {
  submitConsumerCaptureInputSchema,
  type SubmitConsumerCaptureInputDto,
} from "./consumer-observation.ts";

export const MANUAL_CONSUMER_OBSERVATION_ADAPTER_VERSION =
  "wentian-manual-import@1" as const;

export const manualConsumerObservationSubmissionInputSchema =
  submitConsumerCaptureInputSchema.omit({
    collection_method: true,
    adapter_version: true,
    sanitized_dom_object_key: true,
  });

export type ManualConsumerObservationSubmissionInputDto = z.infer<
  typeof manualConsumerObservationSubmissionInputSchema
>;

export function adaptManualConsumerObservationToSubmission(
  input: unknown,
): SubmitConsumerCaptureInputDto {
  const manualInput =
    manualConsumerObservationSubmissionInputSchema.parse(input);
  return submitConsumerCaptureInputSchema.parse({
    ...manualInput,
    collection_method: "manual_import",
    adapter_version: MANUAL_CONSUMER_OBSERVATION_ADAPTER_VERSION,
  });
}
