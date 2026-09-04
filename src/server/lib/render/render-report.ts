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
import { renderCompetitorsReport } from "@/server/lib/render/templates/competitors";
import {
  overviewFlagCodes,
  renderOverviewReport,
} from "@/server/lib/render/templates/overview";
import { buildBacklinksReportData } from "@/server/lib/render/reports/backlinks-report";
import { buildCompetitorsReportData } from "@/server/lib/render/reports/competitors-report";
import { buildOverviewReportData } from "@/server/lib/render/reports/overview-report";
import { loadCountryFlags } from "@/server/lib/render/country-flags";
import { uploadPng } from "@/server/lib/render/r2-upload";

/**
 * Input validation for the render endpoint. The route layer runs this and
 * returns 400 on failure. Defaults match the product decision (ES / desktop).
 *
 * E2: `competitors` is an optional comma-separated list (max 2) of competitor
 * domains. When omitted on the `competitors` report, the service degrades to a
 * single-domain report (see `buildCompetitorsReportData`).
 */
export const renderParamsSchema = z.object({
  report: z.enum(["backlinks", "competitors", "overview"]),
  domain: z.string().trim().min(1, { message: "domain is required" }),
  country: z.string().trim().min(1).default("ES"),
  device: z.enum(["desktop", "mobile", "tablet"]).default("desktop"),
  competitors: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value == null) return undefined;
      const list = Array.isArray(value) ? value : value.split(",");
      const cleaned = list.map((s) => s.trim()).filter((s) => s.length > 0);
      // Dedupe + drop self-references + cap at 2.
      const deduped = Array.from(new Set(cleaned)).filter((c) => c.length > 0);
      const final = deduped.sort().slice(0, 2);
      return final.length > 0 ? final : undefined;
    })
    .pipe(z.array(z.string().min(1)).max(2).optional()),
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
  const { report, domain, country, device, competitors } = params;

  const cacheKey = await buildReportCacheKey(
    report,
    domain,
    country,
    device,
    competitors,
  );

  const cached = await getCachedReport(cacheKey);
  if (cached) return cached;

  const html = await buildReportHtml(
    report,
    domain,
    country,
    device,
    competitors,
  );
  // Reports are taller than the 1280×800 viewport — capture the full
  // document so nothing gets clipped at the bottom edge.
  const png = await renderHtmlToPng(html, { fullPage: true });

  await setCachedReport(cacheKey, png, RENDER_TTL_SECONDS[report]);
  await uploadPng(`rendered/${report}/${cacheKey}.png`, png);

  return png;
}

/**
 * Dispatch to the appropriate report template + data pipeline.
 *
 * E1 implements `backlinks`; E2 implements `competitors`; E3 implements
 * `overview` (the 1-page Domain Overview summary — 5 tiles, country
 * distribution table, two charts; E3.4 historical traffic is a stub here).
 */
async function buildReportHtml(
  report: RenderParams["report"],
  domain: string,
  country: string,
  device: string,
  competitors?: string[],
): Promise<string> {
  if (report === "backlinks") {
    const data = await buildBacklinksReportData({ domain, country });
    return renderBacklinksReport({ report, domain, country, device, data });
  }
  if (report === "competitors") {
    const data = await buildCompetitorsReportData({
      domain,
      country,
      competitors: competitors ?? [],
    });
    return renderCompetitorsReport({
      report,
      domain,
      country,
      device,
      data,
    });
  }
  if (report === "overview") {
    const data = await buildOverviewReportData({ domain, country });
    // Only the codes this report can actually draw get loaded — that's what
    // keeps the 174 kB flag set off the worker's startup graph. The list comes
    // from the template so the two can't drift apart.
    const flags = await loadCountryFlags(
      overviewFlagCodes(
        country,
        data.tables.countries.source === "ok"
          ? data.tables.countries.value
          : [],
      ),
    );
    return renderOverviewReport({
      report,
      domain,
      country,
      device,
      data,
      flags,
    });
  }
  return renderReportShell({ report, domain, country, device });
}

/** Re-exported so the route can map renderer failures to HTTP 502. */
export { RenderError };
