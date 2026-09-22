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
import {
  competitorsFlagCodes,
  renderCompetitorsReport,
} from "@/server/lib/render/templates/competitors";
import {
  keywordsFlagCodes,
  renderKeywordsReport,
} from "@/server/lib/render/templates/keywords";
import {
  overviewFlagCodes,
  renderOverviewReport,
} from "@/server/lib/render/templates/overview";
import { buildBacklinksReportData } from "@/server/lib/render/reports/backlinks-report";
import { buildCompetitorsReportData } from "@/server/lib/render/reports/competitors-report";
import { buildOverviewReportData } from "@/server/lib/render/reports/overview-report";
import { buildKeywordsReportData } from "@/server/lib/render/reports/keywords-report";
import { loadCountryFlags } from "@/server/lib/render/country-flags";
import { uploadPng } from "@/server/lib/render/r2-upload";

/**
 * Input validation for the render endpoint. The route layer runs this and
 * returns 400 on failure. Defaults match the product decision (ES / desktop).
 *
 * E2: `competitors` is an optional comma-separated list (max 2) of competitor
 * domains. When omitted on the `competitors` report, the service degrades to a
 * single-domain report (see `buildCompetitorsReportData`).
 *
 * E5: `keyword` is the seed the `keywords` report analyses. Optional, so the
 * three domain reports keep their existing call shape; on the keyword report it
 * falls back to `domain`, which lets a caller with a single free-text field put
 * the seed there. Every other report ignores it.
 */
export const renderParamsSchema = z.object({
  report: z.enum(["backlinks", "competitors", "overview", "keywords"]),
  domain: z.string().trim().min(1, { message: "domain is required" }),
  keyword: z.string().trim().min(1).optional(),
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
  const { report, domain, country, device, competitors, keyword } = params;

  // What the report is ABOUT: the domain, except on the keyword report, where
  // it is the seed. Two seeds must never collide on one cached PNG — see
  // `buildReportCacheKey`.
  const subject = report === "keywords" ? (keyword ?? domain) : domain;

  const cacheKey = await buildReportCacheKey(
    report,
    subject,
    country,
    device,
    competitors,
  );

  const cached = await getCachedReport(cacheKey);
  if (cached) return cached;

  const html = await buildReportHtml(params);
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
 * distribution table, two charts; E3.4 historical traffic is a stub here);
 * E5 implements `keywords` (the keyword research table — topic rail, summary
 * bar and the highest-volume ideas for a seed).
 */
async function buildReportHtml({
  report,
  domain,
  country,
  device,
  competitors,
  keyword,
}: RenderParams): Promise<string> {
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
    const flags = await loadCountryFlags(competitorsFlagCodes(country));
    return renderCompetitorsReport({
      report,
      domain,
      country,
      device,
      data,
      flags,
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
  if (report === "keywords") {
    // The seed: an explicit `keyword` when the caller sent one, otherwise the
    // free-text `domain` field, which is where a single-input caller puts it.
    const seed = keyword ?? domain;
    const data = await buildKeywordsReportData({ keyword: seed, country });
    // Only the one market flag this report can draw gets loaded — the list
    // comes from the template so the two can't drift apart.
    const flags = await loadCountryFlags(keywordsFlagCodes(data.input.country));
    return renderKeywordsReport({
      keyword: seed,
      country: data.input.country,
      data,
      flags,
    });
  }
  return renderReportShell({ report, domain, country, device });
}

/** Re-exported so the route can map renderer failures to HTTP 502. */
export { RenderError };
