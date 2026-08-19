import { z } from "zod";
import {
  RENDER_TTL_SECONDS,
  buildReportCacheKey,
  getCachedReport,
  setCachedReport,
} from "@/server/lib/render/cache";
import {
  RenderError,
  renderHtmlToPng,
} from "@/server/lib/render/renderer-client";
import { renderReportShell } from "@/server/lib/render/templates/shell";
import { renderBacklinksReport } from "@/server/lib/render/templates/backlinks";
import { buildBacklinksReportData } from "@/server/lib/render/reports/backlinks-report";
import { uploadPng } from "@/server/lib/render/r2-upload";

/**
 * Input validation for the render endpoint. The route layer runs this and
 * returns 400 on failure. Defaults match the product decision (ES / desktop).
 */
export const renderParamsSchema = z.object({
  report: z.enum(["backlinks", "competitors", "overview"]),
  domain: z.string().trim().min(1, { message: "domain is required" }),
  country: z.string().trim().min(1).default("ES"),
  device: z.enum(["desktop", "mobile", "tablet"]).default("desktop"),
});

export type RenderParams = z.infer<typeof renderParamsSchema>;

/**
 * Render a report PNG.
 *
 * Pure orchestration (no auth — that lives at the route layer):
 *   1. build cache key from the report coordinates
 *   2. cache hit → return the cached PNG bytes
 *   3. cache miss → fetch the report's data (DataForSEO) → render its HTML
 *      → POST to the renderer → store the PNG in the TTL cache + upload the
 *      durable copy to R2 → return the bytes
 *
 * Cache write and R2 upload are awaited so workerd does not cancel them when
 * the response is sent; the PNGs are small (~tens of KB) and R2 puts are
 * fast. A `waitUntil` background-write pass can be added later if latency
 * matters.
 *
 * Note: env is intentionally not a parameter. The cache/r2-upload/renderer
 * modules resolve `env` from `cloudflare:workers` directly, matching the
 * pattern in `src/server/lib/r2-cache.ts` and `DomainService.ts`. Tests mock
 * `cloudflare:workers` to supply `env.R2`, `env.RENDERER_URL`, etc.
 */
export async function renderReport(params: RenderParams): Promise<Uint8Array> {
  const { report, domain, country, device } = params;

  const cacheKey = await buildReportCacheKey(report, domain, country, device);

  const cached = await getCachedReport(cacheKey);
  if (cached) return cached;

  const html = await buildReportHtml(report, domain, country, device);
  const png = await renderHtmlToPng(html);

  await setCachedReport(cacheKey, png, RENDER_TTL_SECONDS[report]);
  await uploadPng(`rendered/${report}/${cacheKey}.png`, png);

  return png;
}

/**
 * Dispatch to the appropriate report template + data pipeline.
 *
 * E1 implements `backlinks`; competitors/overview keep the E0 generic shell
 * until E2/E3 land.
 */
async function buildReportHtml(
  report: RenderParams["report"],
  domain: string,
  country: string,
  device: string,
): Promise<string> {
  if (report === "backlinks") {
    const data = await buildBacklinksReportData({ domain, country });
    return renderBacklinksReport({ report, domain, country, device, data });
  }
  return renderReportShell({ report, domain, country, device });
}

/** Re-exported so the route can map renderer failures to HTTP 502. */
export { RenderError };
