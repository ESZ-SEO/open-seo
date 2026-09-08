import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  overviewFlagCodes,
  renderOverviewReport,
} from "@/server/lib/render/templates/overview";
import type {
  BucketTrendPoint,
  OverviewReportData,
  TopKeywordRow,
} from "@/server/lib/render/reports/overview-report";
import {
  renderMultiLineChart,
  renderStackedAreaChart,
  type TimeSeries,
} from "@/server/lib/render/charts/charts";
import { loadCountryFlags } from "@/server/lib/render/country-flags";

/**
 * Screenshot the Domain Overview template with realistic sample data — no
 * DataForSEO calls, no billing risk. Only the template + renderer
 * microservice are involved; `overview-report.ts` (the real data-fetching
 * service) is never imported.
 *
 * Produces two PNGs:
 *
 *  1. `overview-with-sample-data.png` — the real template, exactly as a user
 *     would receive it, over a fixture with 24 months of sample history so the
 *     wired Traffic and Keywords charts are the ones on screen.
 *  2. `overview-keywords-area-preview.png` — a chart bench for
 *     `renderStackedAreaChart` / `renderMultiLineChart` in isolation, useful
 *     for judging the drawing itself (axis, grid, smoothing) without the rest
 *     of the report around it.
 *
 * **Every number either page renders is fabricated** and neither is ever
 * served to a user.
 *
 * Usage: pnpm preview:overview
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const RENDERER_DIR = path.join(REPO_ROOT, "renderer");
const RENDERER_URL = process.env.RENDERER_URL ?? "http://localhost:3100";
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/overview-with-sample-data.png",
);
/** The parity audit's reference viewport. Captured clipped (not full-page) so
 *  the shot answers the only question that matters for the bottom grid: does
 *  it fit above 1231px? */
const PARITY_VIEWPORT = { width: 1316, height: 1231 } as const;
/** Always the *current* state, never a milestone name: the milestone captures
 *  (`overview-parity-p0-final.png`) are the evidence a checkpoint was met, and
 *  a script that overwrites them on every run makes their names a lie. */
const PARITY_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/overview-parity-current.png",
);
const CHART_BENCH_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/overview-keywords-area-preview.png",
);
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

await main();

async function main() {
  await ensureRendererRunning();

  const data = sampleOverviewData();
  const html = renderOverviewReport({
    report: "overview",
    domain: "example-preview.test",
    country: "es",
    device: "desktop",
    data,
    flags: await loadCountryFlags(
      overviewFlagCodes(
        "es",
        data.tables.countries.source === "ok"
          ? data.tables.countries.value
          : [],
      ),
    ),
  });
  await screenshot(html, OUTPUT_PATH, {
    width: PARITY_VIEWPORT.width,
    fullPage: true,
  });
  await screenshot(html, PARITY_PATH, { ...PARITY_VIEWPORT, fullPage: false });
  await screenshot(chartBenchHtml(), CHART_BENCH_PATH, {
    width: 1280,
    fullPage: true,
  });
}

async function screenshot(
  html: string,
  outputPath: string,
  viewport: { width: number; height?: number; fullPage: boolean },
): Promise<void> {
  const response = await fetch(`${RENDERER_URL}/screenshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html, ...viewport }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `renderer returned HTTP ${response.status}: ${detail.slice(0, 500)}`,
    );
  }
  const png = Buffer.from(await response.arrayBuffer());

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, png);
  console.log(`Saved ${outputPath} (${png.byteLength} bytes)`);
}

/** Poll `/health`; if it's not already up, start it via `npm run dev` inside
 *  `renderer/` (build + run — README's documented local flow) and wait. */
async function ensureRendererRunning(): Promise<void> {
  if (await isHealthy()) return;

  console.log(`Renderer not running at ${RENDERER_URL} — starting it...`);
  const child = spawn("npm", ["run", "dev"], {
    cwd: RENDERER_DIR,
    stdio: "inherit",
    shell: true,
    detached: true,
  });
  child.unref();

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  throw new Error(
    `Renderer did not become healthy at ${RENDERER_URL} within ${HEALTH_TIMEOUT_MS}ms. ` +
      `Try starting it manually: cd renderer && npm run dev`,
  );
}

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${RENDERER_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Realistic-magnitude fixture for the 8 SEO tiles, country distribution and
 * keyword buckets — orders of magnitude only loosely inspired by
 * `.dev/Captura de pantalla domain overview.png` (a real Semrush capture),
 * NOT a copy of its numbers. No deltas: the template never fabricates
 * period-over-period deltas, so this fixture doesn't invent any either.
 *
 * The history series are populated (24 months, same generator as the bench)
 * so the capture shows the wired charts. To review the degraded paths
 * instead, empty `points` / `paidPoints` / `keywordBucketTrend`.
 */
function sampleOverviewData(): OverviewReportData {
  const worldTraffic = 4_231_000;
  const worldKeywords = 312_800;
  const share = 0.42;

  return {
    input: {
      domain: "example-preview.test",
      country: "ES",
      countryLabel: "ES",
    },
    healthy: true,
    aiSearch: {
      source: "ok",
      value: {
        mentions: 1_940,
        chatGptMentions: 1_260,
        aiOverviewMentions: 680,
      },
    },
    serpDistribution: {
      source: "ok",
      value: { organic: 312_800, aiOverviews: 41_600, otherFeatures: 18_900 },
    },
    tiles: {
      authority: { value: 82, source: "ok" },
      authorityComposition: { rank: 91, spamPenalty: 2 },
      organicTraffic: { value: worldTraffic, source: "ok" },
      paidTraffic: { value: 612, source: "ok" },
      backlinks: { value: 384_600_000, source: "ok" },
      referringDomains: { value: 218_400, source: "ok" },
      trafficShare: { value: share, source: "ok" },
      organicKeywords: { value: worldKeywords, source: "ok" },
      paidKeywords: { value: 47, source: "ok" },
      competitorsCount: { value: 8, source: "ok" },
    },
    tables: {
      countries: {
        source: "ok",
        value: [
          {
            countryCode: "WW",
            countryLabel: "Todo el mundo",
            share: 1,
            traffic: worldTraffic,
            keywords: worldKeywords,
          },
          {
            countryCode: "ES",
            countryLabel: "ES",
            share,
            traffic: Math.round(worldTraffic * share),
            keywords: Math.round(worldKeywords * share),
          },
        ],
      },
      topKeywords: { source: "ok", value: fakeTopKeywords() },
    },
    charts: {
      trafficTrend: {
        source: "ok",
        value: {
          points: fakeSeries(worldTraffic, 11, 0.3),
          paidPoints: fakeSeries(612_000, 12, 0.6),
        },
      },
      keywordBucketTrend: {
        source: "ok",
        value: { points: fakeBucketTrend() },
      },
      keywordBuckets: {
        source: "ok",
        value: {
          // Sums to 200 — the real service caps ranked-keyword sampling at
          // `RANKED_KEYWORDS_LIMIT` (200), which the chart footer echoes.
          counts: {
            top3: 22,
            rank4to10: 38,
            rank11to20: 45,
            rank21to50: 52,
            rank51to100: 28,
            beyond100: 15,
          },
        },
      },
    },
  };
}

/** FIXTURE — invented keywords for the "Top Organic Keywords" card, so the
 *  bottom grid can be judged with a full table. Never served to a user. */
function fakeTopKeywords(): TopKeywordRow[] {
  return [
    {
      keyword: "preview analytics platform",
      intent: "commercial",
      position: 1,
      volume: 60_500,
      cpc: 1.58,
      traffic: 4881.2,
    },
    {
      keyword: "example preview",
      intent: "navigational",
      position: 1,
      volume: 22_200,
      cpc: 0,
      traffic: 1790.4,
    },
    {
      keyword: "how to audit a domain",
      intent: "informational",
      position: 3,
      volume: 12_100,
      cpc: 0.89,
      traffic: 640.11,
    },
    {
      keyword: "best rank tracking tool for agencies",
      intent: "commercial",
      position: 4,
      volume: 9_900,
      cpc: 4.32,
      traffic: 388.06,
    },
    {
      keyword: "buy seo report template",
      intent: "transactional",
      position: 6,
      volume: 1_300,
      cpc: 2.14,
      traffic: 92.99,
    },
  ];
}

/* --------------------------- Chart bench (fake data) --------------------------- */

/**
 * A bare page holding only the two time-series charts, so their rendering can
 * be judged against the Semrush reference
 * (`.dev/designer/Captura de pantalla 2026-09-04 082346.png`) without the
 * report's tiles, sidebar and footnotes competing for attention.
 *
 * The banner is not decoration: this page and the report look alike, and the
 * only thing separating a review capture from a delivered report is knowing
 * which one you are looking at.
 */
function chartBenchHtml(): string {
  const width = 836;
  const keywords = renderStackedAreaChart(fakeKeywordBucketSeries(), {
    width,
    height: 300,
  });
  const traffic = renderMultiLineChart(fakeTrafficSeries(), {
    width,
    height: 260,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Chart bench · Domain Overview</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f7fa; color: #1f2933; margin: 0; padding: 32px;
  }
  .shell { max-width: 900px; margin: 0 auto; }
  .warning {
    background: #fdf8ec; border: 1px solid #f3e0b5; color: #92660a;
    border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;
    font-size: 13px; line-height: 1.5;
  }
  .card {
    background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 24px;
    box-shadow: rgba(0, 21, 16, 0.07) 0 0 1px 0, rgba(0, 21, 16, 0.07) 0 1px 3px 0;
  }
  h3 { margin: 0 0 12px; font-size: 16px; font-weight: 700; line-height: 24px; }
  .card svg { width: 100%; height: auto; }
  .foot { font-size: 11px; color: #6b7785; margin-top: 8px; }
</style>
</head>
<body>
  <div class="shell">
    <div class="warning">
      <strong>Chart bench — every number below is fabricated.</strong>
      Both charts are wired into the Domain Overview report; this page draws
      them in isolation so the rendering itself can be reviewed. It is never
      served to a user.
    </div>
    <div class="card">
      <h3>Keywords — renderStackedAreaChart</h3>
      ${keywords}
      <div class="foot">6 rank buckets stacked largest-first, 24 fabricated monthly samples.</div>
    </div>
    <div class="card">
      <h3>Traffic — renderMultiLineChart</h3>
      ${traffic}
      <div class="foot">2 unstacked series, 24 fabricated monthly samples.</div>
    </div>
  </div>
</body>
</html>`;
}

/** 24 monthly dates ending Sep 2026, in the `YYYY-MM` form the real service
 *  emits — fixed, so two runs produce comparable captures. A function rather
 *  than a `const` because `main()` runs at the top of this module, before any
 *  `const` below it is initialised. */
function benchMonths(): string[] {
  return Array.from({ length: 24 }, (_, i) =>
    new Date(Date.UTC(2024, 9 + i, 1)).toISOString().slice(0, 7),
  );
}

/** Deterministic value noise. `Math.random` would make every capture differ
 *  from the last for reasons that have nothing to do with the chart code. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A wobbling series that drifts by `drift` (as a fraction of `base`) across
 *  the window, so the shape has the slow rise-and-fall of the reference. */
function fakeSeries(
  base: number,
  seed: number,
  drift: number,
): TimeSeries["points"] {
  const months = benchMonths();
  return months.map((date, i) => {
    const progress = i / (months.length - 1);
    const trend = 1 + drift * Math.sin(progress * Math.PI);
    return {
      date,
      value: Math.round(base * trend * (0.94 + noise(seed + i) * 0.12)),
    };
  });
}

/** Bottom-to-top stacking order, which is why the list runs backwards from the
 *  legend order used elsewhere: the reference puts the fattest bucket (51–100)
 *  at the base and Top 3 as the thin band riding on top. Colours match
 *  `BUCKET_COLORS` in `templates/overview.ts`. */
function fakeKeywordBucketSeries(): TimeSeries[] {
  return [
    {
      label: "101+",
      color: "#22c55e",
      points: fakeSeries(4_200, 1, 0.2),
    },
    { label: "51–100", color: "#fb923c", points: fakeSeries(96_000, 2, 0.35) },
    { label: "21–50", color: "#94a3b8", points: fakeSeries(52_000, 3, 0.3) },
    { label: "11–20", color: "#0b3d91", points: fakeSeries(24_000, 4, 0.25) },
    { label: "4–10", color: "#14b8a6", points: fakeSeries(15_000, 5, 0.4) },
    { label: "Top 3", color: "#1f6feb", points: fakeSeries(7_400, 6, 0.5) },
  ];
}

/** The same five buckets in the shape the service hands the template — one
 *  row per month with a count per bucket, `beyond100` absent because the
 *  monthly history has no counter for it. */
function fakeBucketTrend(): BucketTrendPoint[] {
  const byBucket = {
    top3: fakeSeries(7_400, 6, 0.5),
    rank4to10: fakeSeries(15_000, 5, 0.4),
    rank11to20: fakeSeries(24_000, 4, 0.25),
    rank21to50: fakeSeries(52_000, 3, 0.3),
    rank51to100: fakeSeries(96_000, 2, 0.35),
  };
  return benchMonths().map((date, i) => ({
    date,
    counts: {
      top3: byBucket.top3[i]?.value ?? 0,
      rank4to10: byBucket.rank4to10[i]?.value ?? 0,
      rank11to20: byBucket.rank11to20[i]?.value ?? 0,
      rank21to50: byBucket.rank21to50[i]?.value ?? 0,
      rank51to100: byBucket.rank51to100[i]?.value ?? 0,
    },
  }));
}

function fakeTrafficSeries(): TimeSeries[] {
  return [
    {
      label: "Organic Traffic",
      color: "#1f6feb",
      points: fakeSeries(4_100_000, 11, 0.3),
    },
    {
      label: "Paid Traffic",
      color: "#14b8a6",
      points: fakeSeries(640_000, 12, 0.6),
    },
  ];
}
