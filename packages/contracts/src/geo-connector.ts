import { z } from "zod";

import {
  commercialValueSchema,
  queryIntentCodeSchema,
} from "./scope-query-set.ts";

export const WENTIAN_GEO_CONNECTOR_CONTRACT_VERSION =
  "wentian-geo-connector@1" as const;

export const geoConnectorStatusSchema = z.enum([
  "active",
  "suspended",
  "revoked",
]);
export const geoProjectBindingStatusSchema = z.enum([
  "pending_wentian",
  "active",
  "suspended",
  "rejected",
  "disconnected",
]);

export const createGeoConnectorInputSchema = z
  .object({
    geo_instance_ref: z.string().trim().min(1).max(160),
    geo_tenant_ref: z.string().trim().min(1).max(160),
    display_name: z.string().trim().min(1).max(160),
    allowed_geo_origins: z.array(z.url()).min(1).max(10),
    callback_base_url: z.url().nullable().optional(),
  })
  .strict();

export const geoConnectorSchema = z
  .object({
    id: z.uuid(),
    geo_instance_ref: z.string().min(1).max(160),
    geo_tenant_ref: z.string().min(1).max(160),
    display_name: z.string().min(1).max(160),
    allowed_geo_origins: z.array(z.url()).min(1).max(10),
    callback_base_url: z.url().nullable(),
    status: geoConnectorStatusSchema,
    contract_version: z.literal(WENTIAN_GEO_CONNECTOR_CONTRACT_VERSION),
    version: z.number().int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const createGeoConnectorResponseSchema = z
  .object({
    connector: geoConnectorSchema,
    client_secret: z.string().min(43).max(128),
  })
  .strict();

export const geoConnectorListResponseSchema = z
  .object({ connectors: z.array(geoConnectorSchema) })
  .strict();

export const rotateGeoConnectorSecretInputSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const rotateGeoConnectorSecretResponseSchema = z
  .object({
    client_secret: z.string().min(43).max(128),
    version: z.number().int().positive(),
  })
  .strict();

export const geoProjectBindingStatusRequestSchema = z
  .object({ geo_project_ref: z.string().trim().min(1).max(160) })
  .strict();

export const createGeoProjectBindingRequestSchema = z
  .object({
    geo_workspace_ref: z.string().trim().min(1).max(160),
    geo_project_ref: z.string().trim().min(1).max(160),
    geo_project_display_name: z.string().trim().min(1).max(200),
  })
  .strict();

export const geoProjectBindingSchema = z
  .object({
    id: z.uuid(),
    connector_instance_id: z.uuid(),
    geo_workspace_ref: z.string().min(1).max(160),
    geo_project_ref: z.string().min(1).max(160),
    geo_project_display_name: z.string().min(1).max(200),
    scope_id: z.uuid().nullable(),
    status: geoProjectBindingStatusSchema,
    version: z.number().int().positive(),
    requested_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    decision_reason: z.string().max(500).nullable(),
  })
  .strict();

export const approveGeoProjectBindingInputSchema = z
  .object({
    scope_id: z.uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const rejectGeoProjectBindingInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    version: z.number().int().positive(),
  })
  .strict();

export const geoSsoTicketRequestSchema = z
  .object({
    geo_user_ref: z.string().trim().min(1).max(160),
    geo_project_ref: z.string().trim().min(1).max(160),
    display_name: z.string().trim().min(1).max(120),
    role_codes: z
      .array(
        z.enum([
          "owner",
          "admin",
          "analyst",
          "viewer",
          "tenant_owner",
          "tenant_admin",
        ]),
      )
      .min(1)
      .max(10),
    requested_path: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const geoSsoTicketResponseSchema = z
  .object({
    launch_url: z.url(),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const geoQuerySetSyncInputSchema = z
  .object({
    geo_query_set_ref: z.string().trim().min(1).max(160),
    geo_revision: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(120),
    locale: z.string().trim().min(2).max(16),
    market: z.string().trim().min(1).max(120).nullable().optional(),
    queries: z
      .array(
        z
          .object({
            external_key: z.string().trim().min(1).max(120),
            text: z.string().trim().min(1).max(1_000),
            intent: queryIntentCodeSchema,
            commercial_value: commercialValueSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const geoQuerySetSyncResponseSchema = z
  .object({
    snapshot_id: z.uuid(),
    snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
    query_count: z.number().int().min(1).max(100),
    created: z.boolean(),
  })
  .strict();

export type GeoConnectorDto = z.infer<typeof geoConnectorSchema>;
export type GeoProjectBindingDto = z.infer<typeof geoProjectBindingSchema>;
export type GeoQuerySetSyncInputDto = z.infer<
  typeof geoQuerySetSyncInputSchema
>;
