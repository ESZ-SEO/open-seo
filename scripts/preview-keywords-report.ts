import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  keywordsFlagCodes,
  renderKeywordsReport,
} from "@/server/lib/render/templates/keywords";
import type {
  KeywordRow,
  KeywordsReportData,
  TopicRow,
} from "@/server/lib/render/reports/keywords-report";
import type { KeywordIntent } from "@/types/keywords";
import { loadCountryFlags } from "@/server/lib/render/country-flags";

/**
 * Screenshot the keyword research template — no DataForSEO calls, no billing
 * risk. Only the template and the renderer microservice are involved;
 * `keywords-report.ts` (the data-fetching builder) is never imported for its
 * behaviour, only for its types.
 *
 * **The fixture is not invented.** Every value below was read off the reference
 * capture and recorded in
 * `.dev/designer/keyword-magic-reference-data.json` — the seed, the market, the
 * topic counts, the summary figures, the fifteen rows and the page count. It is
 * transcribed here rather than read at runtime so the preview stays a pure
 * TypeScript module with no file IO, the way `preview-overview-report.ts` is.
 * The point is a render that can be compared to the reference row by row: swap
 * in prettier numbers and the comparison stops meaning anything.
 *
 * Produces two PNGs:
 *
 *  1. `keywords-with-sample-data.png` — the reference fixture. Note that the
 *     reference is ITSELF partly degraded: only the first five rows carry SERP
 *     metrics, and the rest collapse into "For metrics, try to refresh". So
 *     this one capture shows both states side by side, which is playbook §5
 *     almost for free.
 *  2. `keywords-degraded.png` — every source in error, for the empty states.
 *
 * Usage: pnpm preview:keywords
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const RENDERER_DIR = path.join(REPO_ROOT, "renderer");
const RENDERER_URL = process.env.RENDERER_URL ?? "http://localhost:3100";
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/keywords-with-sample-data.png",
);
const DEGRADED_PATH = path.join(
  REPO_ROOT,
  ".dev/designer/keywords-degraded.png",
);
/** The width the rest of the report set is captured at. The page is a long
 *  table, so the height is whatever the content needs — captured fullPage. */
const RENDER_WIDTH = 1316;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

/** From the reference capture's own query bar and database selector. */
const SEED = "tartas de queso Zaragoza";
const COUNTRY = "ES";
const COUNTRY_NAME = "Spain";
const CURRENCY = "EUR";

await main();

async function main() {
  await ensureRendererRunning();

  await screenshot(html(referenceFixture()), OUTPUT_PATH);
  await screenshot(html(degradedFixture()), DEGRADED_PATH);
}

async function html(data: KeywordsReportData): Promise<string> {
  return renderKeywordsReport({
    keyword: SEED,
    country: COUNTRY,
    data,
    flags: await loadCountryFlags(keywordsFlagCodes(COUNTRY)),
  });
}

async function screenshot(
  markup: Promise<string>,
  outputPath: string,
): Promise<void> {
  const response = await fetch(`${RENDERER_URL}/screenshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      html: await markup,
      width: RENDER_WIDTH,
      fullPage: true,
    }),
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

/* ------------------------- Reference fixture ------------------------- */

/** A function rather than a `const` because `main()` runs at the top of this
 *  module, before any `const` below it is initialised — the same reason
 *  `preview-overview-report.ts` declares its month list as one. */
function referenceInput(): KeywordsReportData["input"] {
  return {
    keyword: SEED,
    country: COUNTRY,
    countryName: COUNTRY_NAME,
    currency: CURRENCY,
  };
}

/**
 * The reference capture, transcribed.
 *
 * Source: `.dev/designer/keyword-magic-reference-data.json`. Summary figures,
 * topic counts and page count are the reference's own; nothing here is rounded,
 * prettified or filled in.
 */
function referenceFixture(): KeywordsReportData {
  return {
    input: referenceInput(),
    healthy: true,
    sampleSize: 46_774,
    summary: {
      keywordCount: { value: 46_774, source: "ok" },
      totalVolume: { value: 839_160, source: "ok" },
      averageDifficulty: { value: 22, source: "ok" },
    },
    tables: {
      keywords: { value: referenceRows(), source: "ok" },
      topics: { value: referenceTopics(), source: "ok" },
    },
    // The reference's own counters, read off the capture.
    actionBadges: { updateMetrics: "489/1,000", manageColumns: "9/11" },
    pagination: { currentPage: 1, totalPages: 468 },
    // The reference's own wording, because this fixture IS the reference. The
    // real builder says something different and truer — see `SERP_NOT_FETCHED`
    // in `keywords-report.ts`.
    staleLabel: "For metrics, try to refresh",
  };
}

/** Every source in error — the capture that proves the empty states hold their
 *  geometry rather than collapsing the page. */
function degradedFixture(): KeywordsReportData {
  return {
    input: referenceInput(),
    healthy: false,
    sampleSize: 0,
    summary: {
      keywordCount: { value: null, source: "error" },
      totalVolume: { value: null, source: "error" },
      averageDifficulty: { value: null, source: "error" },
    },
    tables: {
      keywords: { value: [], source: "error" },
      topics: { value: [], source: "error" },
    },
    actionBadges: { updateMetrics: null, manageColumns: null },
    pagination: { currentPage: 1, totalPages: 1 },
    staleLabel: "For metrics, try to refresh",
  };
}

/**
 * The reference's first fifteen rows.
 *
 * The badge letters the capture shows (`I`, `C`) are expanded to the intents
 * they stand for. `normalizeIntent` cannot do this — it matches on substrings
 * of DataForSEO's full words, and a bare "I" resolves to `unknown` — so the
 * expansion is spelled out here, which is honest: it is a reading of the
 * reference's badge, not a classification anybody computed.
 *
 * Rows 4 and 6-15 carry no SERP-side metrics in the reference itself. They are
 * left null so the template collapses those three columns into its stale
 * message, which is exactly what the capture shows.
 */
function referenceRows(): KeywordRow[] {
  type Full = [
    string,
    KeywordIntent,
    number,
    number,
    number,
    number,
    number,
    string,
  ];
  type Stale = [string, number, number];

  const withMetrics: Full[] = [
    // keyword, intent, relevance, volume, kd, cpc, serpFeatures, updated
    [
      "tartas de queso zaragoza",
      "informational",
      100,
      720,
      13,
      0,
      5,
      "1 month",
    ],
    ["tarta de queso zaragoza", "commercial", 91, 590, 15, 0, 6, "1 month"],
    [
      "mejores tartas de queso zaragoza",
      "commercial",
      89,
      40,
      17,
      0,
      5,
      "1 month",
    ],
    [
      "saque cakes tartas de queso artesanales",
      "commercial",
      86,
      260,
      39,
      0,
      4,
      "1 month",
    ],
  ];
  const results: Record<string, number> = {
    "tartas de queso zaragoza": 134,
    "tarta de queso zaragoza": 134,
    "mejores tartas de queso zaragoza": 121,
    "saque cakes tartas de queso artesanales": 108,
  };

  const stale: Stale[] = [
    // keyword, relevance, volume — the rest never refreshed in the reference
    ["mejor tarta de queso zaragoza", 87, 30],
    ["bascake zaragoza fotos", 86, 30],
    ["tarta de queso actur zaragoza", 86, 30],
    ["tartas de queso zaragoza nuevo", 86, 30],
    ["bascake en zaragoza", 86, 20],
    ["bascake menú", 86, 20],
    ["bascake precio", 86, 20],
    ["bascake precios", 86, 20],
    ["bascake tartas", 86, 20],
    ["bascake zaragoza horario", 86, 20],
    ["bascake zaragoza menú", 86, 20],
  ];

  const full = withMetrics.map(
    ([keyword, intent, relevance, volume, kd, cpc, features, updated]) => ({
      keyword,
      intent,
      relevance,
      volume,
      difficulty: kd,
      cpc,
      serpFeatureCount: features,
      results: results[keyword] ?? null,
      updated,
    }),
  );

  const degraded = stale.map(([keyword, relevance, volume]) => ({
    keyword,
    intent: "unknown" as const,
    relevance,
    volume,
    difficulty: null,
    cpc: 0,
    serpFeatureCount: null,
    results: null,
    updated: null,
  }));

  // The reference sorts by Relevance descending, and "mejor tarta de queso
  // zaragoza" (87) sits between the third and fourth metric-bearing rows.
  return [...full, ...degraded].sort(
    (a, b) => (b.relevance ?? -1) - (a.relevance ?? -1),
  );
}

/** The reference rail's nineteen topics, in the order it lists them. The "All"
 *  row is not here: the template derives it from the summary count, which is
 *  where the reference's exact `46,774` lives (the rail only shows `46.8K`). */
function referenceTopics(): TopicRow[] {
  return [
    { topic: "bascake zaragoza", keywords: 207 },
    { topic: "tarta fest zaragoza", keywords: 315 },
    { topic: "panaderías y pastelerías en zaragoza", keywords: 2_200 },
    { topic: "cafés en zaragoza", keywords: 550 },
    { topic: "churrerías y chocolaterías zaragoza", keywords: 288 },
    { topic: "bocadillos en zaragoza", keywords: 613 },
    { topic: "croissant gigante zaragoza", keywords: 209 },
    { topic: "pastelería nava", keywords: 251 },
    { topic: "desayunos y brunch en zaragoza", keywords: 551 },
    { topic: "restaurante mexicano en zaragoza", keywords: 389 },
    { topic: "mediterránea café", keywords: 35 },
    { topic: "la tortilla zaragoza", keywords: 165 },
    { topic: "heladerías zaragoza y tortosa", keywords: 343 },
    { topic: "la zaragozana", keywords: 251 },
    { topic: "comida en zaragoza", keywords: 277 },
    { topic: "gastronomía de zaragoza", keywords: 614 },
    { topic: "tartas johanas zaragoza", keywords: 178 },
    { topic: "sin gluten zaragoza", keywords: 428 },
  ];
}
