import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { consumeRenderBudget } from "@/server/lib/render/render-budget";
import {
  RenderError,
  renderParamsSchema,
  renderReport,
} from "@/server/lib/render/render-report";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { buildDashboardUrl } from "@/server/mcp/urls";

// The rendered PNG is 80–140 KB; base64 it into an MCP response and the same
// bytes cross the wire twice (mcpResponse puts the payload in `text` AND
// `structuredContent`) for ~30,000 tokens a call. So the tool answers with a
// link to `/api/render-image`, which serves the durable R2 copy that
// `renderReport` has just written.

const IMAGE_ROUTE = "/api/render-image";

const REPORT_LABELS = {
  overview: "Domain Overview",
  backlinks: "Backlinks",
  competitors: "Compare Domains",
  keywords: "Keyword Research",
} as const;

// A rendered report is always well over 1 KB and well under 1 MB, so plain
// rounded kilobytes read correctly without a formatter.
const sizeKb = (bytes: number) => `${Math.round(bytes / 1000)} KB`;

// Declared clean rather than reused from `renderParamsSchema`: that schema's
// `competitors` is a `string | string[]` union behind a `.transform().pipe()`,
// which exists only because a query string can carry CSV, and which has no
// clean JSON-Schema projection for `tools/list`. The handler re-parses through
// `renderParamsSchema` so defaults and competitor normalization stay owned by
// one module.
const inputSchema = {
  projectId: projectIdSchema,
  report: z
    .enum(["overview", "backlinks", "competitors", "keywords"])
    .describe(
      "Which report to render. `overview`: one-page domain summary — 5 KPI tiles, country distribution, two charts. `backlinks`: referring-domain profile — top referrers, anchor-text split, follow/nofollow. `competitors`: side-by-side comparison of `domain` against up to two competitors, with the overlap panel. `keywords`: keyword-research table for a seed — topic rail, summary bar, highest-volume ideas.",
    ),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .describe(
      "The domain to report on, e.g. 'example.com' — bare hostname, no scheme or path. On report: 'keywords' this is ignored when `keyword` is set, and used as the seed phrase when it is not.",
    ),
  keyword: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The seed phrase for report: 'keywords'. Ignored by every other report.",
    ),
  country: z
    .string()
    .trim()
    .length(2)
    .optional()
    .describe(
      "Two-letter market code, e.g. 'US', 'ES', 'GB'. Defaults to 'ES'. An unrecognised code falls back to Spain rather than failing, so pass the real market.",
    ),
  device: z
    .enum(["desktop", "mobile", "tablet"])
    .optional()
    .describe(
      "Label shown on the report header. It does not change the layout — the capture is always 1280px wide. Choose the label you want printed.",
    ),
  competitors: z
    .array(z.string().trim().min(1))
    .max(2)
    .optional()
    .describe(
      "Up to two competitor domains for report: 'competitors'. Deduplicated and sorted before rendering. Omit for a single-domain view. Ignored by every other report.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

const outputSchema = z.looseObject({
  url: z.string(),
  report: z.string(),
  subject: z.string(),
  country: z.string(),
  device: z.string(),
  competitors: z.array(z.string()).optional(),
  imageBytes: z.number(),
  ...optionalMetaOutputSchema,
});

export const renderReportImageTool = {
  name: "render_report_image",
  config: {
    title: "Render report image",
    description:
      "Renders one of four pre-built SEO reports as a branded PNG chart image — Domain Overview, Backlinks, Compare Domains, or Keyword Research — and returns a link to it. Use this when the user wants a visual, presentation-ready snapshot of a domain or keyword, not when they want the underlying numbers: for numbers call get_domain_overview, get_backlinks_profile or research_keywords, which return data you can reason over. The image is not returned inline and cannot be embedded in a saved report; reply with the returned url and one line naming what the report shows. Each render fetches live data from DataForSEO and takes up to 30 seconds; the same coordinates are then served from cache for days at no cost, so re-requesting the same report is free. Rendering many different reports in a row is not: a per-organization protection limit refuses further renders once it is reached.",
    inputSchema,
    outputSchema,
    annotations: {
      // Not read-only: it fetches live provider data and writes the PNG to
      // storage. Open-world, unlike every other tool here, because it renders
      // an arbitrary third-party domain rather than the workspace's own data.
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const params = renderParamsSchema.parse({
      report: args.report,
      domain: args.domain,
      keyword: args.keyword,
      country: args.country,
      device: args.device,
      competitors: args.competitors,
    });

    // Authorize (above, in withMcpProjectAuth) → brake → spend. The brake has
    // to sit before renderReport: a check that runs after it has already paid
    // DataForSEO for the data stops nothing.
    await consumeRenderBudget(context.auth.organizationId);

    let png: Uint8Array;
    try {
      png = await renderReport(params);
    } catch (error) {
      // Mirrors the n8n route's 502. UPSTREAM_UNAVAILABLE is non-reportable,
      // so a renderer outage does not flood PostHog with our own alarm.
      if (error instanceof RenderError) {
        throw new AppError("UPSTREAM_UNAVAILABLE", error.message);
      }
      throw error;
    }

    // What the report is ABOUT. This must match renderReport's own derivation
    // exactly — it is what the cache key is built from, so a divergence here
    // hands back a link that resolves to a different PNG than the one just
    // rendered. `render-image.ts` derives it a third time, for the same key.
    const subject =
      params.report === "keywords"
        ? (params.keyword ?? params.domain)
        : params.domain;

    const url = buildDashboardUrl(context.baseUrl, IMAGE_ROUTE, {
      projectId: args.projectId,
      report: params.report,
      domain: params.domain,
      keyword: params.keyword,
      country: params.country,
      device: params.device,
      competitors: params.competitors?.join(","),
    });

    const text = [
      `${REPORT_LABELS[params.report]} for ${subject} (${params.country} · ${params.device}) — ${sizeKb(png.byteLength)} PNG.`,
      `Open it at ${url}`,
      "Reply with this link and one line naming what the report shows; the image is not in this response.",
    ].join("\n");

    return mcpResponse({
      text,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: {
        url,
        report: params.report,
        subject,
        country: params.country,
        device: params.device,
        competitors: params.competitors,
        imageBytes: png.byteLength,
      },
    });
  }),
};
