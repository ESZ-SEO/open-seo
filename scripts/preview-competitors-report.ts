import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  competitorsFlagCodes,
  renderCompetitorsReport,
} from "@/server/lib/render/templates/competitors";
import { loadCountryFlags } from "@/server/lib/render/country-flags";
import type {
  CompetitorRow,
  CompetitorsReportData,
  KeywordGapRow,
  TrendSeries,
} from "@/server/lib/render/reports/competitors-report";

/**
 * Screenshot the competitors template — no DataForSEO calls, no billing risk.
 * Only the template and the renderer microservice are involved;
 * `competitors-report.ts` (the data-fetching builder) is never imported for its
 * behaviour, only for its types.
 *
 * **Unlike `preview-keywords-report.ts`, this fixture is synthetic.** There is
 * no reference capture for the domain-comparison report, so the numbers below
 * are plausible-but-invented values chosen to exercise the layout: three
 * domains with different orders of magnitude, brand/non-brand splits that don't
 * all land on the same bar length, and a keyword-gap table long enough to show
 * the row rhythm. They are not measurements of anything and must not be read as
 * such.
 *
 * Produces two PNGs:
 *
 *  1. `competitors-with-sample-data.png` — primary + 2 competitors, all cells ok.
 *  2. `competitors-degraded.png` — every source in error, for the empty states.
 *
 * Usage: pnpm preview:competitors
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const RENDERER_DIR = path.join(REPO_ROOT, "renderer");
const RENDERER_URL = process.env.RENDERER_URL ?? "http://localhost:3100";
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/competitors-with-sample-data.png",
);
const DEGRADED_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/competitors-degraded.png",
);
/** The width the rest of the report set is captured at. */
const RENDER_WIDTH = 1316;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

const DOMAIN = "bascake.es";
const COMPETITORS = ["tartasjohanas.es", "pasteleriamanolo.com"];
const COUNTRY = "ES";
const DEVICE = "desktop";

await main();

async function main() {
  await ensureRendererRunning();

  await screenshot(await html(sampleFixture()), OUTPUT_PATH);
  await screenshot(await html(degradedFixture()), DEGRADED_PATH);
}

async function html(data: CompetitorsReportData): Promise<string> {
  return renderCompetitorsReport({
    report: "competitors",
    domain: DOMAIN,
    country: COUNTRY,
    device: DEVICE,
    data,
    flags: await loadCountryFlags(competitorsFlagCodes(COUNTRY)),
    // The capture is deterministic: a moving date would change the header on
    // every run and make two captures impossible to diff.
    reportDate: "2026-09-21",
  });
}

async function screenshot(markup: string, outputPath: string): Promise<void> {
  const response = await fetch(`${RENDERER_URL}/screenshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: markup, width: RENDER_WIDTH, fullPage: true }),
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

/* --------------------------- Synthetic fixture --------------------------- */

type RowNumbers = {
  authority: number;
  rank: number;
  organicTraffic: number;
  organicKeywords: number;
  paidKeywords: number;
  paidTrafficCost: number;
  backlinks: number;
  referringDomains: number;
  brandShare: number;
};

function row(
  domain: string,
  role: CompetitorRow["role"],
  n: RowNumbers,
): CompetitorRow {
  const ok = <T>(value: T) => ({ value, source: "ok" as const });
  return {
    domain,
    role,
    authority: ok(n.authority),
    rank: ok(n.rank),
    organicTraffic: ok(n.organicTraffic),
    organicKeywords: ok(n.organicKeywords),
    paidKeywords: ok(n.paidKeywords),
    paidTrafficCost: ok(n.paidTrafficCost),
    backlinks: ok(n.backlinks),
    referringDomains: ok(n.referringDomains),
    brandShare: ok(n.brandShare),
    nonBrandShare: ok(1 - n.brandShare),
  };
}

/** Rows deliberately span an order of magnitude so the donut and the bars are
 *  not three identical slices. */
function sampleFixture(): CompetitorsReportData {
  return {
    input: {
      domain: DOMAIN,
      country: COUNTRY,
      countryLabel: COUNTRY,
      competitors: COMPETITORS,
    },
    healthy: true,
    rows: [
      row(DOMAIN, "primary", {
        authority: 34,
        rank: 412,
        organicTraffic: 1_840,
        organicKeywords: 612,
        paidKeywords: 0,
        paidTrafficCost: 0,
        backlinks: 1_207,
        referringDomains: 96,
        brandShare: 0.62,
      }),
      row(COMPETITORS[0]!, "competitor", {
        authority: 48,
        rank: 287,
        organicTraffic: 6_930,
        organicKeywords: 2_154,
        paidKeywords: 41,
        paidTrafficCost: 318.4,
        backlinks: 8_412,
        referringDomains: 431,
        brandShare: 0.28,
      }),
      row(COMPETITORS[1]!, "competitor", {
        authority: 21,
        rank: 908,
        organicTraffic: 740,
        organicKeywords: 289,
        paidKeywords: 7,
        paidTrafficCost: 44.9,
        backlinks: 306,
        referringDomains: 38,
        brandShare: 0.11,
      }),
    ],
    keywordGap: {
      missing: { value: missingRows(), source: "ok" },
      weak: { value: weakRows(), source: "ok" },
    },
    trafficTrend: { value: trendSeries(), source: "ok" },
    competitorCount: COMPETITORS.length,
    vennFromRealCalls: true,
    venn: {
      value: {
        primaryOnly: 418,
        comp1Only: 1_602,
        comp2Only: 173,
        primaryAndComp1: 194,
        primaryAndComp2: 61,
        comp1AndComp2: 0,
      },
      source: "ok",
    },
  };
}

/** Every source in error — the capture that proves the empty states hold their
 *  geometry rather than collapsing the page. */
function degradedFixture(): CompetitorsReportData {
  const dead = (domain: string, role: CompetitorRow["role"]): CompetitorRow => {
    const err = { value: null, source: "error" as const };
    return {
      domain,
      role,
      authority: err,
      rank: err,
      organicTraffic: err,
      organicKeywords: err,
      paidKeywords: err,
      paidTrafficCost: err,
      backlinks: err,
      referringDomains: err,
      brandShare: err,
      nonBrandShare: err,
    };
  };
  return {
    input: {
      domain: DOMAIN,
      country: COUNTRY,
      countryLabel: COUNTRY,
      competitors: COMPETITORS,
    },
    healthy: false,
    rows: [
      dead(DOMAIN, "primary"),
      dead(COMPETITORS[0]!, "competitor"),
      dead(COMPETITORS[1]!, "competitor"),
    ],
    keywordGap: {
      missing: { value: [], source: "error" },
      weak: { value: [], source: "error" },
    },
    trafficTrend: { value: [], source: "error" },
    competitorCount: COMPETITORS.length,
    vennFromRealCalls: false,
    venn: {
      value: {
        primaryOnly: 0,
        comp1Only: 0,
        comp2Only: 0,
        primaryAndComp1: 0,
        primaryAndComp2: 0,
        comp1AndComp2: null,
      },
      source: "error",
    },
  };
}

/**
 * Thirteen months of organic traffic per domain.
 *
 * Synthetic, like the rest of this fixture: the builder has no historical
 * fetch, so nothing real could fill this today. The shapes are deliberately
 * different from each other — one drifting down then recovering, one flat, one
 * slowly growing — because three parallel lines would not tell us whether the
 * chart actually separates its series.
 */
function trendSeries(): TrendSeries[] {
  const months = [
    "2025-09-01",
    "2025-10-01",
    "2025-11-01",
    "2025-12-01",
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
    "2026-06-01",
    "2026-07-01",
    "2026-08-01",
    "2026-09-01",
  ];
  const shapes: Record<string, number[]> = {
    [DOMAIN]: [
      2100, 2040, 1890, 1720, 1610, 1580, 1660, 1540, 1620, 1700, 1760, 1810,
      1840,
    ],
    [COMPETITORS[0]!]: [
      6100, 6250, 6380, 6120, 5890, 6040, 6410, 6680, 6520, 6740, 6810, 6900,
      6930,
    ],
    [COMPETITORS[1]!]: [
      410, 450, 480, 520, 560, 590, 610, 640, 660, 690, 710, 730, 740,
    ],
  };
  return Object.entries(shapes).map(([domain, values]) => ({
    domain,
    points: months.map((date, i) => ({ date, value: values[i] ?? null })),
  }));
}

/** Keywords a competitor ranks for and the primary does not. */
function missingRows(): KeywordGapRow[] {
  const rows: Array<[string, number, number]> = [
    // keyword, volume, competitor index
    ["tarta de queso a domicilio zaragoza", 880, 0],
    ["pasteleria artesanal zaragoza", 720, 0],
    ["tartas personalizadas zaragoza", 590, 0],
    ["tarta de cumpleaños zaragoza", 480, 0],
    ["obrador zaragoza centro", 390, 1],
    ["tartas sin gluten zaragoza", 320, 0],
    ["pasteles por encargo zaragoza", 260, 1],
    ["tarta de queso japonesa zaragoza", 210, 0],
    ["reposteria creativa zaragoza", 170, 1],
    ["tarta fondant zaragoza precio", 140, 0],
  ];
  return rows.map(([keyword, volume, owner]) => ({
    keyword,
    volume,
    ownedBy: COMPETITORS[owner]!,
  }));
}

/** Keywords both rank for, where the primary sits behind. */
function weakRows(): KeywordGapRow[] {
  const rows: Array<[string, number, number]> = [
    ["tartas de queso zaragoza", 720, 0],
    ["mejores tartas zaragoza", 480, 0],
    ["pasteleria zaragoza", 2_400, 0],
    ["tarta de queso cremosa", 1_300, 1],
    ["donde comprar tarta de queso", 590, 0],
    ["tarta de queso al horno", 3_600, 1],
    ["pastelerias abiertas domingo zaragoza", 210, 1],
    ["tarta de queso sin azucar", 320, 0],
  ];
  return rows.map(([keyword, volume, owner]) => ({
    keyword,
    volume,
    ownedBy: COMPETITORS[owner]!,
  }));
}
