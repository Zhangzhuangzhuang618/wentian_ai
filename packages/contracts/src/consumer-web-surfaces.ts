import { z } from "zod";

export const consumerWebSurfaceCodeSchema = z.enum([
  "doubao_web",
  "qianwen_web",
  "deepseek_web",
]);

export type ConsumerWebSurfaceCode = z.infer<
  typeof consumerWebSurfaceCodeSchema
>;

export const CONSUMER_WEB_SURFACES = Object.freeze({
  doubao_web: Object.freeze({
    surfaceCode: "doubao_web" as const,
    productLabel: "豆包网页版" as const,
    allowedPageOrigin: "https://www.doubao.com" as const,
    adapterVersion: "doubao-web@1-attended" as const,
    pageSignatureVersion:
      "doubao-web-signature@7-visible-search-trace" as const,
  }),
  qianwen_web: Object.freeze({
    surfaceCode: "qianwen_web" as const,
    productLabel: "千问网页版" as const,
    allowedPageOrigin: "https://www.qianwen.com" as const,
    adapterVersion: "qianwen-web@2-visible-reference-panel" as const,
    pageSignatureVersion:
      "qianwen-web-signature@2-visible-reference-panel" as const,
  }),
  deepseek_web: Object.freeze({
    surfaceCode: "deepseek_web" as const,
    productLabel: "DeepSeek 网页版" as const,
    allowedPageOrigin: "https://chat.deepseek.com" as const,
    adapterVersion: "deepseek-web@1-visible-page" as const,
    pageSignatureVersion: "deepseek-web-signature@2-visible-page" as const,
  }),
});

export function getConsumerWebSurface(surfaceCode: string) {
  const parsed = consumerWebSurfaceCodeSchema.safeParse(surfaceCode);
  return parsed.success ? CONSUMER_WEB_SURFACES[parsed.data] : null;
}
