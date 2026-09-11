import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { renderBacklinksReport } from "@/server/lib/render/templates/backlinks";
import type {
  AnchorRow,
  AttributeRow,
  AuthorityBucketRow,
  BacklinksGraphLink,
  BacklinksGraphNode,
  BacklinksReportData,
  CategoryRow,
  TypeRow,
} from "@/server/lib/render/reports/backlinks-report";

/**
 * Screenshot the Backlinks template with realistic sample data — no
 * DataForSEO calls, no billing risk. Only the template + renderer
 * microservice are involved; `backlinks-report.ts` (the real data-fetching
 * service) is never imported.
 *
 * **Every number it renders is fabricated** and it is never served to a user.
 * The magnitudes are lifted from the parity reference capture so that every
 * module renders at a realistic shape (a word cloud needs a wide spread of
 * weights, a bucket distribution needs a long tail); they describe no real
 * domain, and the preview domain is deliberately a `.test` name.
 *
 * Two modes:
 *
 *   pnpm preview:backlinks
 *     → `.dev/designer/backlinks-with-sample-data.png`, every source `ok`.
 *
 *   pnpm preview:backlinks --degraded
 *     → `.dev/designer/backlinks-degraded.png`, the SAME fixture with every
 *       source flipped to `error`/`empty`. The two captures must have the
 *       same height: a module that collapses when its endpoint fails reflows
 *       the page under it, which is the bug the playbook's step 5 exists to
 *       catch and which no populated capture can show.
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const RENDERER_DIR = path.join(REPO_ROOT, "renderer");
const RENDERER_URL = process.env.RENDERER_URL ?? "http://localhost:3100";
const DEGRADED = process.argv.includes("--degraded");
/** Render the strip with the six metrics we can actually source, instead of
 *  the reference's six (two of which DataForSEO does not expose and which
 *  therefore render `n/a` against live data). Lets the two candidate strips be
 *  compared as images rather than as descriptions. */
const ALT_KPI = process.argv.includes("--alt-kpi");
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  DEGRADED
    ? ".dev/designer/backlinks-degraded.png"
    : ALT_KPI
      ? ".dev/designer/backlinks-alt-kpi.png"
      : ".dev/designer/backlinks-with-sample-data.png",
);
/** The sourced alternative to `KPI_CELLS`, swapping the two cells that have no
 *  upstream source for the two that do. */
const ALT_KPI_CELLS = [
  "referringDomains",
  "backlinks",
  "referringPages",
  "organicTraffic",
  "brokenBacklinks",
  "toxicity",
] as const;
/** The renderer's screenshot width, which the template is written against. */
const VIEWPORT_WIDTH = 1280;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

async function main() {
  await ensureRendererRunning();

  const data = sampleBacklinksData();
  const html = renderBacklinksReport({
    report: "backlinks",
    domain: "example-preview.test",
    country: "ES",
    device: "desktop",
    data: DEGRADED ? degrade(data) : data,
    ...(ALT_KPI ? { kpiCells: ALT_KPI_CELLS } : {}),
  });
  await screenshot(html, OUTPUT_PATH, {
    width: VIEWPORT_WIDTH,
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
 *  `renderer/` (build + run — the README's documented local flow) and wait. */
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
 * The same payload with every source failed and every value emptied.
 *
 * Values are emptied as well as flagged, because a template that reads
 * `value` without checking `source` would otherwise still draw a populated
 * chart here and the check would pass for the wrong reason.
 */
function degrade(data: BacklinksReportData): BacklinksReportData {
  const noSeries = { source: "error" as const, value: { points: [] } };
  return {
    ...data,
    healthy: false,
    tiles: {
      authority: { source: "error", value: null },
      authorityComposition: { rank: null, spamPenalty: 0 },
      referringDomains: { source: "error", value: null },
      backlinks: { source: "error", value: null },
      monthlyVisits: { source: "empty", value: null },
      organicTraffic: { source: "error", value: null },
      outboundDomains: { source: "empty", value: null },
      referringPages: { source: "error", value: null },
      brokenBacklinks: { source: "error", value: null },
      toxicity: { source: "error", value: null },
      deltas: { referringDomains: null, backlinks: null },
    },
    charts: {
      authorityProfile: {
        source: "error",
        value: { score: null, badge: null, axes: [] },
      },
      authorityTrend: noSeries,
      networkGraph: { source: "error", value: { nodes: [], links: [] } },
      referringDomainsArea: noSeries,
      backlinksArea: noSeries,
      referringDomainsBars: { source: "error", value: { points: [] } },
      backlinksBars: { source: "error", value: { points: [] } },
    },
    tables: {
      categories: { source: "error", value: [] },
      categoriesDimension: data.tables.categoriesDimension,
      topAnchors: { source: "error", value: [] },
      authorityDistribution: { source: "error", value: [] },
      authorityDistributionSample: 0,
      types: { source: "error", value: [] },
      attributes: { source: "error", value: [] },
    },
  };
}

/* --------------------------- the fixture --------------------------- */

const REFERRING_DOMAINS = 77_200;
const BACKLINKS = 1_800_000;

/**
 * Bucket counts for "Referring Domains by Authority Score", highest band
 * first — a long tail piled into 0-10, which is what a real backlink profile
 * looks like and what makes the colour ramp readable.
 */
const AUTHORITY_BUCKETS: [string, number][] = [
  ["91 - 100", 93],
  ["81 - 90", 167],
  ["71 - 80", 462],
  ["61 - 70", 803],
  ["51 - 60", 1_700],
  ["41 - 50", 4_100],
  ["31 - 40", 7_700],
  ["21 - 30", 11_400],
  ["11 - 20", 10_100],
  ["0 - 10", 41_200],
];

const AUTHORITY_SAMPLE = AUTHORITY_BUCKETS.reduce((acc, [, n]) => acc + n, 0);

function authorityDistribution(): AuthorityBucketRow[] {
  return AUTHORITY_BUCKETS.map(([range, count]) => ({
    range,
    count,
    share: count / AUTHORITY_SAMPLE,
  }));
}

function sampleBacklinksData(): BacklinksReportData {
  /* Industry labels, paired with a `categoriesDimension` that names them, so
     the card renders at the width real labels would take. Production groups
     these by TLD — DataForSEO publishes no industry classification — and the
     template prints whatever dimension the service reports. */
  const categories: CategoryRow[] = [
    { category: "Mass Media", share: 0.23, count: 2_300 },
    { category: "Education", share: 0.15, count: 1_500 },
    { category: "Online Services", share: 0.06, count: 550 },
    { category: "Nonprofit Organizations", share: 0.04, count: 445 },
    { category: "Travel & Tourism", share: 0.04, count: 432 },
  ];
  const types: TypeRow[] = [
    { type: "Text", share: 0.76, count: 1_400_000 },
    { type: "Image", share: 0.23, count: 424_000 },
    { type: "Form", share: 0.004, count: 6_600 },
    { type: "Frame", share: 0.0001, count: 37 },
  ];
  const attributes: AttributeRow[] = [
    { attribute: "Follow", share: 0.84, count: 1_500_000 },
    { attribute: "Nofollow", share: 0.16, count: 291_000 },
    { attribute: "Sponsored", share: 0.0002, count: 433 },
    { attribute: "UGC", share: 0.003, count: 5_700 },
  ];
  /* Weights spread across two orders of magnitude so the cloud has range:
     one dominant phrase, a few mid-weight ones, a tail of small labels, and
     a couple of long URLs to exercise truncation. */
  const topAnchors: AnchorRow[] = [
    { anchor: "world wildlife fund", backlinks: 214_000, domains: 9_400 },
    { anchor: "Empty Anchor", backlinks: 96_000, domains: 5_100 },
    { anchor: "wwf", backlinks: 61_000, domains: 3_800 },
    { anchor: "worldwildlife.org", backlinks: 34_000, domains: 2_700 },
    { anchor: "world wildlife fund (wwf)", backlinks: 21_000, domains: 1_900 },
    { anchor: "worldwildlife.org/travel", backlinks: 14_500, domains: 1_240 },
    {
      anchor: "one-third of alway and chimaera",
      backlinks: 11_800,
      domains: 980,
    },
    {
      anchor: "https://www.worldwildlife.org/broadleaf-forests",
      backlinks: 8_600,
      domains: 760,
    },
    { anchor: "donate", backlinks: 5_400, domains: 610 },
    { anchor: "wildlife", backlinks: 3_900, domains: 480 },
    { anchor: "read more", backlinks: 2_700, domains: 355 },
    { anchor: "source", backlinks: 1_600, domains: 240 },
  ];

  return {
    input: {
      domain: "example-preview.test",
      country: "ES",
      countryLabel: "ES",
    },
    healthy: true,
    tiles: {
      authority: { value: 73, source: "ok" },
      authorityComposition: { rank: 79, spamPenalty: 6 },
      referringDomains: { value: REFERRING_DOMAINS, source: "ok" },
      backlinks: { value: BACKLINKS, source: "ok" },
      monthlyVisits: { value: 858_000, source: "ok" },
      organicTraffic: { value: 3_100_000, source: "ok" },
      outboundDomains: { value: 2_500, source: "ok" },
      /* The sourced alternatives to the two cells above, populated so the
         preview renders fully whichever six `KPI_CELLS` names. Kept in
         proportion with the rest: more pages than domains, far fewer than
         total backlinks, and broken links a small slice of the profile. */
      referringPages: { value: 412_000, source: "ok" },
      brokenBacklinks: { value: 96_400, source: "ok" },
      toxicity: { value: 14, source: "ok" },
      deltas: { referringDomains: -0.03, backlinks: -0.08 },
    },
    charts: {
      authorityProfile: {
        source: "ok",
        value: {
          score: 73,
          badge: "Industry leader",
          axes: [
            { label: "Link Power", value: 82 },
            { label: "Organic Traffic", value: 74 },
            { label: "Natural Profile", value: 88 },
          ],
        },
      },
      authorityTrend: { source: "ok", value: { points: flatSeries(73, 1) } },
      networkGraph: { source: "ok", value: organicGraph() },
      referringDomainsArea: {
        source: "ok",
        value: { points: decliningSeries(85_000, REFERRING_DOMAINS, 2) },
      },
      backlinksArea: {
        source: "ok",
        value: { points: decliningSeries(3_400_000, BACKLINKS, 3) },
      },
      referringDomainsBars: {
        source: "ok",
        value: { points: flowBars(1_900, 966, 4) },
      },
      backlinksBars: {
        source: "ok",
        value: { points: flowBars(155_000, 51_700, 5) },
      },
    },
    tables: {
      categories: { source: "ok", value: categories },
      categoriesDimension: "industry",
      topAnchors: { source: "ok", value: topAnchors },
      authorityDistribution: { source: "ok", value: authorityDistribution() },
      authorityDistributionSample: AUTHORITY_SAMPLE,
      types: { source: "ok", value: types },
      attributes: { source: "ok", value: attributes },
    },
  };
}

/** Weekly dates ending 2026-09-07, fixed so two runs produce comparable
 *  captures. Functions rather than consts because `main()` runs at the top of
 *  this module, before any `const` below it is initialised. */
function weeks(count: number): string[] {
  const end = Date.UTC(2026, 8, 7);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
  );
}

/** 13 weekly samples — the window the real service asks DataForSEO for, so
 *  the range pill reads "12W" the way production will. */
const SERIES_WEEKS = 13;
/** New/Lost is drawn over a longer span, matching the density of the
 *  reference's bar charts. */
const FLOW_WEEKS = 26;

/** Deterministic value noise. `Math.random` would make every capture differ
 *  from the last for reasons that have nothing to do with the template. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A near-flat series around `base`, for the 0-100 authority trend. */
function flatSeries(
  base: number,
  seed: number,
): { date: string; value: number | null }[] {
  return weeks(SERIES_WEEKS).map((date, i) => ({
    date,
    value: Math.round(base + noise(seed + i) * 2),
  }));
}

/** A series that falls from `from` to exactly `to` across the window, so the
 *  last sample agrees with the KPI above it. */
function decliningSeries(
  from: number,
  to: number,
  seed: number,
): { date: string; value: number | null }[] {
  const dates = weeks(SERIES_WEEKS);
  return dates.map((date, i) => {
    const progress = i / (dates.length - 1);
    const trend = from + (to - from) * progress;
    const wobble = i === dates.length - 1 ? 1 : 0.99 + noise(seed + i) * 0.02;
    return { date, value: Math.round(trend * wobble) };
  });
}

/** New/lost pairs where the first periods spike and the rest settle — the
 *  shape the reference's diverging bars have. */
function flowBars(
  newPeak: number,
  lostPeak: number,
  seed: number,
): { date: string; new: number; lost: number }[] {
  return weeks(FLOW_WEEKS).map((date, i) => {
    const decay = i < 3 ? 1 - i * 0.15 : 0.42 + noise(seed + i) * 0.2;
    return {
      date,
      new: Math.round(newPeak * decay),
      lost: Math.round(lostPeak * (0.3 + noise(seed + 100 + i) * 0.7)),
    };
  });
}

/**
 * A dense referring-domain network: ~90 ordinary domains, ~25 reputable ones
 * (clean and high-ranked), and links between the secondaries as well as to
 * the target. A graph of pure spokes reads as a wheel; the point of this
 * module is that the neighbourhood is interconnected.
 */
const ORDINARY_NODES = 90;
const REPUTABLE_NODES = 25;
const CROSS_LINKS = 70;

function organicGraph(): {
  nodes: BacklinksGraphNode[];
  links: BacklinksGraphLink[];
} {
  const target = "example-preview.test";

  const reputable = Array.from({ length: REPUTABLE_NODES }, (_, i) => ({
    id: `authority-${i + 1}.test`,
    rank: Math.round(78 + noise(400 + i) * 20),
    spamSeverity: 0 as const,
    backlinks: Math.round(3_000 + noise(500 + i) * 40_000),
  }));
  const ordinary = Array.from({ length: ORDINARY_NODES }, (_, i) => ({
    id: `referrer-${i + 1}.test`,
    rank: Math.round(8 + noise(200 + i) * 55),
    spamSeverity: (1 + Math.floor(noise(300 + i) * 4)) as 1 | 2 | 3 | 4,
    backlinks: Math.round(40 + noise(600 + i) * 4_000),
  }));
  const referrers = [...reputable, ...ordinary];

  const links: BacklinksGraphLink[] = referrers.map((node) => ({
    source: target,
    target: node.id,
  }));
  for (let i = 0; i < CROSS_LINKS; i++) {
    const a = referrers[Math.floor(noise(700 + i) * referrers.length)];
    const b = referrers[Math.floor(noise(900 + i) * referrers.length)];
    if (a === undefined || b === undefined || a.id === b.id) continue;
    links.push({ source: a.id, target: b.id });
  }

  return {
    nodes: [
      { id: target, rank: 79, spamSeverity: 0, backlinks: BACKLINKS },
      ...referrers,
    ],
    links,
  };
}

// Entry point last: the fixture below is built from `const` bindings, which —
// unlike function declarations — are not hoisted. Calling `main()` from the top
// of the module evaluates it before they initialise and throws a TDZ
// ReferenceError that no unit test can catch, because nothing imports this file.
await main();
