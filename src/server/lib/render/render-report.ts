import { z } from "zod";
import {
  RENDER_TTL_SECONDS,
  buildReportCacheKey,
  getCachedReport,
  setCachedReport,
} from "@/server/lib/render/cache";
import { RenderError, renderHtmlToPng } from "@/server/lib/render/renderer-client";
import { renderReportShell } from "@/server/lib/render/templates/shell";
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
 *   3. cache miss → render the shell HTML → POST to the renderer → store the
 *      PNG in the TTL cache + upload the durable copy to R2 → return the bytes
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

  const html = renderReportShell({ report, domain, country, device });
  const png = await renderHtmlToPng(html);

  await setCachedReport(cacheKey, png, RENDER_TTL_SECONDS[report]);
  await uploadPng(`rendered/${report}/${cacheKey}.png`, png);

  return png;
}

/** Re-exported so the route can map renderer failures to HTTP 502. */
export { RenderError };
