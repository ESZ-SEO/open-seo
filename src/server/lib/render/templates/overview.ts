/* eslint-disable max-lines, max-lines-per-function -- Domain Overview template mirrors the Semrush 2026 layout — query bar, KPI row (AI Search + SEO), analytics workspace (rail + stacked charts) and the 50/50 bottom grid. Splitting fragments the page narrative across files. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  AiSearchData,
  BucketTrendPoint,
  CountryRow,
  HistoricalKeywordBucket,
  KeywordBucket,
  OverviewReportData,
  SerpDistribution,
  TopKeywordRow,
} from "@/server/lib/render/reports/overview-report";
import { KEYWORD_BUCKETS } from "@/server/lib/render/reports/overview-report";
import {
  placeholderSvg,
  renderMultiLineChart,
  renderStackedAreaChart,
  renderStackedBar,
  type TimeSeries,
} from "@/server/lib/render/charts/charts";

/**
 * Domain Overview report template (E3).
 *
 * Self-contained HTML sent to the renderer microservice for screenshotting.
 * Same brand surface as E1/E2 (inline `<style>`, no external CSS, lucide-style
 * inline SVG icons). Composition follows the parity audit in
 * `.dev/designer/semrush-ui-parity-pack-2026-09-04/`, whose target viewport is
 * 1316×1231 — every height below is budgeted against that.
 *
 * All rendered copy is in English, matching the reference capture.
 *
 * Page regions, top to bottom:
 *
 *   1. Header (~185px): domain query bar, breadcrumb, title + export, filter
 *      chips, tab strip.
 *   2. KPI row — two equal-height cards on a 1fr/2fr grid:
 *        - "AI Search": mentions per generative surface, from the LLM-mentions
 *          database. AI visibility and cited pages have no source, so those
 *          cells render `—` and the card says so. Dropping the card instead
 *          would collapse the row back to the full-width SEO block the audit
 *          asked us to leave behind.
 *        - "SEO": the 8 KPIs in a 4×2 grid, values abbreviated (`1.1K`) with
 *          the exact figure on the cell's `title`.
 *   3. Analytics workspace (~505px) — one card, `22% / 78%` columns:
 *        - rail: "Distribution by Country", whose columns follow
 *          {@link OverviewTemplateInput.searchMode}.
 *        - main: "Traffic" over "Keywords", separated by a hairline. Both plot
 *          the monthly history from `historical_rank_overview` and degrade to
 *          an honest placeholder (Traffic) or today's distribution bar
 *          (Keywords) when there isn't enough of one — see
 *          {@link MIN_HISTORY_POINTS}.
 *   4. Bottom grid (~288px), 50/50: "Top Organic Keywords" (fed by the same
 *      `ranked_keywords` response the bucket chart uses) and "Key Topics".
 *
 * **Static-render caveat.** The output is a PNG, so no control here is
 * interactive: the query bar, the mode tabs, the range pills and the chart
 * legends are rendered in the state the report was generated for. Anything
 * that would have to *lie* about a state it can't reach — country quick-switch
 * pills for countries this report isn't about, for one — is left out rather
 * than drawn dead.
 */

const REPORT_TITLES: Record<ReportKind, string> = {
  backlinks: "Backlinks Report",
  competitors: "Domain Comparison",
  overview: "Domain Overview",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
};

/** English bucket labels for the keyword chart. The service's
 *  `KEYWORD_BUCKET_LABELS` is still Spanish and belongs to the data layer;
 *  rendered copy is the template's responsibility, so the legend text lives
 *  here while the ordering keeps coming from `KEYWORD_BUCKETS`. */
const BUCKET_LABELS: Record<KeywordBucket, string> = {
  top3: "Top 3",
  rank4to10: "4–10",
  rank11to20: "11–20",
  rank21to50: "21–50",
  rank51to100: "51–100",
  beyond100: "101+",
};

/**
 * Which search surface the workspace describes.
 *
 * `google` is the default and the only mode with data behind it. `ai` exists
 * because the reference capture is in that mode and the audit asks the rail to
 * swap columns rather than swap modules; it renders the same geometry with
 * `—` cells until an AI visibility source exists.
 */
export type SearchMode = "ai" | "google";

export type OverviewTemplateInput = {
  report: ReportKind;
  domain: string;
  country: string;
  device: string;
  data: OverviewReportData;
  /** Flag SVG markup by ISO alpha-2 code, resolved by the caller via
   *  `loadCountryFlags`. Required rather than defaulted: a template that
   *  quietly renders no flags when nobody passes any is how the flags go
   *  missing again without anything failing. */
  flags: Record<string, string>;
  /** Defaults to `google` — the mode we actually have numbers for. */
  searchMode?: SearchMode;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NUMBER_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const PERCENT_FMT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const MONEY_FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const EMPTY_VALUE = "N/A";
/** The cell has a slot but no source behind it — distinct from `N/A`, which
 *  means a source we do query came back without the number. */
const NO_SOURCE = "—";

function fmtNumber(value: number | null): string {
  return value == null ? EMPTY_VALUE : NUMBER_FMT.format(value);
}

function fmtPercent(value: number | null): string {
  return value == null ? EMPTY_VALUE : PERCENT_FMT.format(value);
}

const COMPACT_UNITS = [
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/**
 * `384,600,000` → `384.6M`. The reference abbreviates every KPI, and a
 * nine-digit figure at 24px is what forced the old card to 266px tall.
 * The exact number survives on the cell's `title`.
 */
function fmtCompact(value: number | null): string {
  if (value == null) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const unit = COMPACT_UNITS.find((u) => abs >= u.at);
  if (unit === undefined) return NUMBER_FMT.format(value);
  // One decimal, the way the reference reads (`1.1K`, `6.7K`, `384.6M`), and
  // dropped when it would be a bare `.0`.
  const rendered = (value / unit.at).toFixed(1).replace(/\.0$/, "");
  return `${rendered}${unit.suffix}`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Inline flag markup for a country row. Flags must be *drawn*, not typed:
 *  the emoji this used to emit depends on a colour emoji font the renderer's
 *  Chromium image doesn't ship, so it degraded to bare "ES" letterforms. The
 *  artwork arrives pre-resolved via `flags` (see `country-flags.ts` for why it
 *  isn't imported here). "WW" (worldwide) is an aggregate, not a country — it
 *  gets the globe icon. A code with no artwork gets nothing rather than a
 *  wrong flag; the row's label already names the country. */
function countryFlagIcon(code: string, flags: Record<string, string>): string {
  const upper = code.toUpperCase();
  if (upper === "WW") return ICONS.globe;
  const flag = flags[upper];
  return flag === undefined ? "" : `<span class="flag">${flag}</span>`;
}

/** The service labels the aggregate row in Spanish ("Todo el mundo"); every
 *  other row is already the bare ISO code. Translate at render time so the
 *  data layer stays untouched. */
function countryDisplayLabel(row: CountryRow): string {
  return row.countryCode.toUpperCase() === "WW"
    ? "Worldwide"
    : row.countryLabel;
}

/* ----------------------------- Quick markets ----------------------------- */

/**
 * The market shortcuts the reference puts at the head of the filter row.
 *
 * Decorative, like every other control on this page: the output is a
 * screenshot, so these show the markets the product covers with the report's
 * own market highlighted — they are not a switch anybody can throw.
 *
 * `GB` is the ISO code the flag artwork is keyed by; "UK" is what the
 * reference labels it.
 */
const QUICK_MARKETS = [
  { code: "WW", label: "Worldwide" },
  { code: "US", label: "US" },
  { code: "GB", label: "UK" },
  { code: "ES", label: "ES" },
] as const;

/** The shortcut list for one report. A report whose market isn't one of the
 *  defaults appends it, because the row's whole job is to show which market is
 *  active — a highlighted pill that isn't there highlights nothing. */
function quickMarkets(countryCode: string): { code: string; label: string }[] {
  return QUICK_MARKETS.some((m) => m.code === countryCode)
    ? [...QUICK_MARKETS]
    : [...QUICK_MARKETS, { code: countryCode, label: countryCode }];
}

/**
 * Every ISO code this template can draw a flag for, given a report.
 *
 * The caller resolves the artwork and passes it in (see
 * {@link OverviewTemplateInput.flags}), so caller and template have to agree
 * on the list. Deriving it here is what stops a new flag slot from silently
 * rendering blank the way the country column once did.
 */
export function overviewFlagCodes(
  country: string,
  countries: CountryRow[],
): string[] {
  return [
    ...quickMarkets(country.toUpperCase()).map((m) => m.code),
    ...countries.map((row) => row.countryCode),
  ];
}

function quickMarketPills(
  countryCode: string,
  flags: Record<string, string>,
): string {
  const pills = quickMarkets(countryCode)
    .map(
      (m) =>
        `<span class="pill${m.code === countryCode ? " pill--active" : ""}">${countryFlagIcon(m.code, flags)}${escapeHtml(m.label)}</span>`,
    )
    .join("");
  return `<div class="markets">${pills}<span class="pill pill--more">…</span></div>`;
}

/* ----------------------------- Palette ----------------------------- */

/**
 * The report's colour tokens, in one place (audit §3 / VIS-01).
 *
 * They live in TypeScript rather than only in the `:root` block because half
 * of them are consumed outside CSS — chart series, donut segments and bucket
 * bands are passed to `charts.tsx` as literal colours. Declaring them twice is
 * how the navy the audit asked us to drop survived in the charts after the
 * stylesheet had already moved on.
 *
 * `charts.tsx` keeps its own `PALETTE`: it is the default for the Spanish
 * backlinks/competitors reports, which this work is not allowed to restyle.
 * Every colour the Overview cares about is passed in explicitly from here.
 */
const COLORS = {
  /** Near-black body ink. The audit's whole VIS-01 point: text is not blue. */
  ink: "#202020",
  muted: "#6b7280",
  /** Periwinkle. Links, active states, primary series — never body copy. */
  accent: "#6868d8",
  /** Pure blue, verified against the reference's real HTML dump
   *  (rgb(0,81,255), the market-pill active-state colour) — distinct from
   *  the periwinkle accent. The device/date/currency filter text uses this,
   *  not --brand: Pedro confirmed by eye that those specific controls read
   *  blue, not purple, in the reference. */
  filterBlue: "#0051ff",
  /** Cool lavender: selected controls (pills, tabs, segments). */
  lavender: "#e6e9fc",
  /** Warm lavender: tags and badges sitting on a white card. */
  lavenderWarm: "#eae5fe",
  /** A hair above white, for the selected side of a segmented toggle: the
   *  reference marks that selection with the inset border and lets the fill
   *  barely register. The stronger `lavender` there reads as a filled button
   *  and swallows the border it is supposed to sit behind. */
  lavenderFaint: "#f1f3fd",
  /** Reserved for the second traffic series and the non-AI SERP features
   *  slice. Deliberately teal rather than green — green stays available for a
   *  semantic positive (a delta), which is the one thing VIS-01 asks us to
   *  keep it for. */
  mint: "#14b8a6",
  /** AI Overviews, the reference's own hue for the generative slice. */
  magenta: "#d946ef",
} as const;

/* ----------------------------- Icons ----------------------------- */

const ICONS = {
  globe: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>`,
  donut: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor" stroke="none"></path></svg>`,
  info: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4M12 8h.01"></path></svg>`,
  external: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg>`,
  download: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"></path></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"></path></svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`,
  device: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 2.5 13.8 8 19.5 9.8 13.8 11.6 12 17.1 10.2 11.6 4.5 9.8 10.2 8z"></path><path d="M18.5 15.2 19.4 18l2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9z"></path></svg>`,
  /* Referential marks for the AI Search row labels — identifying whose
     product the row is about, the same way "Data via DataForSEO" names its
     source. Not decoration, not a Semrush asset: single-colour silhouettes
     from Simple Icons (CC0), rendered in the row's own ink via currentColor
     rather than each brand's real palette. */
  openai: `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path></svg>`,
  google: `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"></path></svg>`,
  gemini: `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"></path></svg>`,
} as const;

/* ----------------------------- SEO tiles ----------------------------- */

type Tile = {
  label: string;
  /** Already formatted for display — abbreviated where the reference is. */
  value: string;
  /** Exact/contextual figure, surfaced on the cell's `title` rather than as a
   *  subline: the reference card has no sublines and the row height budget
   *  (2 rows in ~175px) has no room for one. */
  hint: string;
  icon?: string;
};

const TILES_PER_ROW = 4;

/** 2 rows × 4 columns inside the right two thirds of the KPI row (audit §G). */
function renderTiles(tiles: Tile[]): string {
  const rows: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += TILES_PER_ROW) {
    rows.push(tiles.slice(i, i + TILES_PER_ROW));
  }
  return rows
    .map(
      (row) => `
    <div class="tiles-row">${row
      .map(
        (t) => `
      <div class="tile"${t.hint ? ` title="${escapeHtml(t.hint)}"` : ""}>
        <div class="tile-label">${t.icon ?? ""}${escapeHtml(t.label)}<span class="tile-info">${ICONS.info}</span></div>
        <div class="tile-value${t.value === EMPTY_VALUE ? " tile-value--empty" : ""}">${escapeHtml(t.value)}</div>
      </div>`,
      )
      .join("")}
    </div>`,
    )
    .join("");
}

/* ----------------------------- AI Search card ----------------------------- */

/** The generative surfaces the reference breaks its AI metrics down by, in the
 *  reference's order. Only the first two are in DataForSEO's LLM-mentions
 *  database, so the other two report `null` by construction — see
 *  {@link AiSearchData}. AI Overview and AI Mode are both Google surfaces,
 *  hence the shared icon. */
/** The card says `—` for "no source", never `fmtCompact`'s "N/A". */
function fmtAiMetric(value: number | null): string {
  return value == null ? NO_SOURCE : fmtCompact(value);
}

const AI_SOURCES = [
  {
    name: "ChatGPT",
    icon: ICONS.openai,
    mentionsOf: (ai: AiSearchData) => ai.chatGptMentions,
  },
  {
    name: "AI Overview",
    icon: ICONS.google,
    mentionsOf: (ai: AiSearchData) => ai.aiOverviewMentions,
  },
  { name: "AI Mode", icon: ICONS.google, mentionsOf: () => null },
  { name: "Gemini", icon: ICONS.gemini, mentionsOf: () => null },
] as const;

/**
 * The left third of the KPI row.
 *
 * Mentions come from `llm_mentions/aggregated_metrics`; Cited Pages from the
 * `total_count` of `llm_mentions/top_mentioned_pages` (the successor to
 * `top_pages`, which caps its page list at 10 and reports no total, so its
 * only count was a sample size that would have read as a total).
 *
 * AI Visibility stays `—` and is closed as unsourceable — see
 * {@link AiSearchData}, which records what the whole LLM Mentions surface
 * publishes. The audit is explicit that the answer to a missing source is to
 * keep the geometry and say nothing rather than invent a figure or drop the
 * card (which would take the whole 1fr/2fr row with it).
 */
function renderAiSearchCard(ai: OverviewReportData["aiSearch"]): string {
  const sources = AI_SOURCES.map(
    ({ name, icon, mentionsOf }) => `
      <div class="ai-row">
        <span class="ai-row-name"><span class="ai-icon">${icon}</span>${escapeHtml(name)}</span>
        <span>${fmtAiMetric(mentionsOf(ai.value))}</span>
        <span>${NO_SOURCE}</span>
      </div>`,
  ).join("");

  const note =
    ai.value.mentions == null && ai.value.citedPages == null
      ? "No AI Search data source connected"
      : "No AI Visibility source";

  return `
    <div class="card card-kpi card-ai">
      <div class="card-tab"><span class="badge badge-ai">AI Search</span></div>
      <div class="ai-grid">
        <div class="ai-head">AI Visibility</div>
        <div class="ai-head">Mentions</div>
        <div class="ai-head">Cited Pages</div>
        <div class="ai-value">${NO_SOURCE}</div>
        <div class="ai-value">${fmtAiMetric(ai.value.mentions)}</div>
        <div class="ai-value">${fmtAiMetric(ai.value.citedPages)}</div>
      </div>
      <div class="ai-rows">${sources}</div>
      <div class="ai-note">${note}</div>
    </div>`;
}

/* ----------------------------- Distribution rail ----------------------------- */

/**
 * Bucket colours: one periwinkle ramp, darkest at Top 3, fading to the pale
 * lavender the reference gives its long tail (VIS-01).
 *
 * A ramp rather than six unrelated hues because the buckets *are* a scale —
 * position 1 to position 100 — and the old palette (navy, teal, slate, orange,
 * green) read as five unrelated categories with a semantic green among them.
 * Declared up here because the rail's SERP donut reuses one of these (RAIL-03)
 * and a `const` read before its declaration is a load-time crash, not a lint
 * nit.
 */
const BUCKET_COLORS: Record<KeywordBucket, string> = {
  top3: "#3f3ab0",
  rank4to10: "#5a55ce",
  rank11to20: COLORS.accent,
  rank21to50: "#8e92e8",
  rank51to100: "#b3b9f2",
  beyond100: COLORS.mint,
};

/**
 * The "no rows" row (VIS-03).
 *
 * `is-empty` is what keeps the table's height: a bare one-line message
 * collapses a five-row table to ~30px, and a page whose modules change size
 * depending on whether an endpoint answered is a page that reflows in front of
 * whoever is reading it. The height comes from CSS keyed to the table, so the
 * empty state occupies exactly what the populated state would.
 */
function emptyRow(columns: number): string {
  return `<tr class="is-empty"><td colspan="${columns}" class="muted center">No data</td></tr>`;
}

/** Google mode: the share / traffic / keywords the report actually measures. */
function googleCountryRows(
  rows: CountryRow[],
  flags: Record<string, string>,
): string {
  if (rows.length === 0) {
    return emptyRow(4);
  }
  return rows
    .map(
      (r) => `<tr>
        <td>${countryFlagIcon(r.countryCode, flags)} ${escapeHtml(countryDisplayLabel(r))}</td>
        <td class="num">${fmtPercent(r.share)}</td>
        <td class="num">${fmtCompact(r.traffic)}</td>
        <td class="num">${fmtCompact(r.keywords)}</td>
      </tr>`,
    )
    .join("");
}

/** AI mode: same rows, columns the audit specifies, no numbers behind them. */
function aiCountryRows(
  rows: CountryRow[],
  flags: Record<string, string>,
): string {
  if (rows.length === 0) {
    return emptyRow(3);
  }
  return rows
    .map(
      (r) => `<tr>
        <td>${countryFlagIcon(r.countryCode, flags)} ${escapeHtml(countryDisplayLabel(r))}</td>
        <td class="num">${NO_SOURCE}</td>
        <td class="num">${NO_SOURCE}</td>
      </tr>`,
    )
    .join("");
}

/**
 * Top Cited Sources — the domains an AI answer cites when it mentions this one.
 *
 * Same situation as the AI Search card: no endpoint reports it, so the module
 * carries its columns and its height and nothing else. The body is sized for
 * the three rows the audit budgets, so filling it later moves nothing.
 */
function renderTopCitedSources(countryFlag: string): string {
  return `
        <div class="rail-block">
          <h3 class="rail-title">Top Cited Sources ${countryFlag}</h3>
          <div class="cited">
            <div class="cited-head">
              <span>Domain</span>
              <span class="num">Mentions</span>
            </div>
            <div class="cited-empty muted">No cited-source data</div>
          </div>
        </div>`;
}

/**
 * Google SERP Positions Distribution — how the domain's Google appearances
 * split between plain organic results, AI Overview citations and the other
 * SERP features Labs tracks.
 *
 * Each segment is a `total_count` from its own `ranked_keywords` request (see
 * {@link SerpDistribution}), so the three are on the same footing. The ring
 * only draws when all three arrived: two of three segments would silently
 * inflate both, and the reader has no way to see which one is missing.
 *
 * The ring is drawn here rather than through `renderDonutChart` because that
 * one is a 320px chart with its own legend and a centre "Total" — this is a
 * ~100px rail ornament whose legend has to align with the rail's other rows.
 */
const SERP_SEGMENTS = [
  {
    label: "Organic",
    color: COLORS.accent,
    countOf: (d: SerpDistribution) => d.organic,
  },
  {
    label: "AI Overviews",
    color: COLORS.magenta,
    countOf: (d: SerpDistribution) => d.aiOverviews,
  },
  {
    label: "Other SERP Features",
    color: COLORS.mint,
    countOf: (d: SerpDistribution) => d.otherFeatures,
  },
] as const;

const SERP_DONUT_RADIUS = 39;
const SERP_DONUT_CIRCUMFERENCE = 2 * Math.PI * SERP_DONUT_RADIUS;

/** One arc of the ring, `length` units long, starting `start` units around
 *  from twelve o'clock. Dash-array rather than a path: an arc that is exactly
 *  0 or exactly the whole circle degenerates into an invisible or malformed
 *  path, and a dashed stroke handles both without a special case. */
function serpArc(color: string, start: number, length: number): string {
  return `<circle cx="50" cy="50" r="${SERP_DONUT_RADIUS}" fill="none" stroke="${color}" stroke-width="13" stroke-dasharray="${length.toFixed(2)} ${(SERP_DONUT_CIRCUMFERENCE - length).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 50 50)"></circle>`;
}

function renderSerpDistribution(
  distribution: OverviewReportData["serpDistribution"],
): string {
  const counts = SERP_SEGMENTS.map((s) => s.countOf(distribution.value));
  const total = counts.reduce<number>((acc, n) => acc + (n ?? 0), 0);
  const drawable =
    distribution.source === "ok" && counts.every((n) => n != null) && total > 0;

  const legend = SERP_SEGMENTS.map(
    (s, i) => `
            <div class="serp-row">
              <span class="serp-key"><span class="serp-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>
              <span class="num muted">${drawable ? fmtPercent((counts[i] ?? 0) / total) : NO_SOURCE}</span>
            </div>`,
  ).join("");

  let consumed = 0;
  const ring = drawable
    ? SERP_SEGMENTS.map((s, i) => {
        const length = ((counts[i] ?? 0) / total) * SERP_DONUT_CIRCUMFERENCE;
        const arc = serpArc(s.color, consumed, length);
        consumed += length;
        return arc;
      }).join("")
    : `<circle cx="50" cy="50" r="${SERP_DONUT_RADIUS}" fill="none" stroke="#e9ebee" stroke-width="13"></circle>`;

  return `
        <div class="rail-block">
          <h3 class="rail-title">Google SERP Positions Distribution</h3>
          <div class="serp">
            <svg class="serp-donut" viewBox="0 0 100 100" width="86" height="86" role="img" aria-label="${drawable ? "Share of Google appearances by result type" : "No data"}">
              ${ring}
            </svg>
            <div class="serp-legend">${legend}</div>
          </div>
        </div>`;
}

function renderRail(
  mode: SearchMode,
  rows: CountryRow[],
  flags: Record<string, string>,
  countryFlag: string,
  serpDistribution: OverviewReportData["serpDistribution"],
): string {
  const distribution =
    mode === "ai"
      ? `<table class="data">
            <thead><tr>
              <th>Countries</th>
              <th class="num">Visibility</th>
              <th class="num">Mentions</th>
            </tr></thead>
            <tbody>${aiCountryRows(rows, flags)}</tbody>
          </table>`
      : `<table class="data">
            <thead><tr>
              <th>Country</th>
              <th class="num">Share</th>
              <th class="num">Traffic</th>
              <th class="num">Keywords</th>
            </tr></thead>
            <tbody>${googleCountryRows(rows, flags)}</tbody>
          </table>
          <div class="rail-foot">share = country traffic / worldwide traffic</div>`;

  return `
      <aside class="rail">
        <div class="rail-block">
          <h3 class="rail-title">Distribution by Country</h3>
          ${distribution}
        </div>
        ${mode === "ai" ? renderTopCitedSources(countryFlag) : ""}
        ${renderSerpDistribution(serpDistribution)}
      </aside>`;
}

/**
 * Nominal chart canvas — the width of the workspace's main column at the
 * reference viewport (1280 shell − 32 card padding = 1248 inner; 78% of that
 * is 973, less the 16px gutter left of the charts). `width:100%; height:auto`
 * then scales SVG text at the size it was authored at instead of stretching a
 * small canvas.
 */
/** The workspace's rail/charts split (audit §H). Declared once because the
 *  control row has to repeat it exactly: two grids that are "both 22/78" by
 *  coincidence drift the moment one of them is tuned. */
const WS_COLUMNS = "minmax(240px, 22%) minmax(0, 78%)";

const CHART_WIDTH = 956;
/** Compacted from 260: the workspace has to fit *both* charts in ~430px of
 *  body height (audit §H), which is the 240px saving that opens room for the
 *  bottom grid. */
const CHART_HEIGHT = 160;
/** Legend row + the 24px bar — the bucket split is a proportion, not a
 *  series, so it doesn't need a full canvas (design review finding F). */
const BAR_CHART_HEIGHT = 54;

function stackedBarFromBuckets(counts: Record<KeywordBucket, number>): string {
  const segments = KEYWORD_BUCKETS.map((b) => ({
    label: BUCKET_LABELS[b],
    value: counts[b] ?? 0,
    color: BUCKET_COLORS[b],
  }));
  // `renderStackedBar` is shared with the Spanish backlinks/competitors
  // templates and falls back to a Spanish placeholder on an all-zero chart —
  // render our own English one instead of leaking that string in here.
  if (segments.every((s) => s.value <= 0)) {
    return placeholderSvg("No data", {
      width: CHART_WIDTH,
      height: BAR_CHART_HEIGHT,
    });
  }
  return renderStackedBar(segments, { width: CHART_WIDTH });
}

/* ----------------------------- History ----------------------------- */

/**
 * How many real monthly samples a series needs before it is drawn as a trend.
 *
 * Three, for two reasons that agree: `smoothPath` only starts curving at three
 * points (two draw a bare segment, which reads as a claim about a direction
 * two samples cannot support), and a domain DataForSEO has tracked for one or
 * two months is exactly the case the "not enough history" copy was written
 * for. Below the threshold the block falls back rather than drawing a line
 * through almost nothing.
 */
const MIN_HISTORY_POINTS = 3;

function realPointCount(points: { value: number | null }[]): number {
  return points.filter((p) => p.value != null).length;
}

/** Series markup + the footnote that describes what was actually drawn — the
 *  two always change together, so a chart can never end up under a caption
 *  written for the other branch. */
type ChartBlock = { svg: string; foot: string };

const TRAFFIC_PLACEHOLDER =
  "Not enough history yet — accumulates from the first render";

function trafficChart(
  trend: OverviewReportData["charts"]["trafficTrend"],
): ChartBlock {
  const { points, paidPoints } = trend.value;
  if (trend.source !== "ok" || realPointCount(points) < MIN_HISTORY_POINTS) {
    return {
      svg: placeholderSvg(TRAFFIC_PLACEHOLDER, {
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
      }),
      foot: TRAFFIC_PLACEHOLDER,
    };
  }

  const series: TimeSeries[] = [
    { label: "Organic Traffic", color: COLORS.accent, points },
  ];
  // The chart samples every series on the first one's dates, so a paid series
  // of a different length would be read off the wrong months. A paid series
  // that is empty or too short is dropped entirely: `renderMultiLineChart`
  // floors a missing value at 0, so plotting it would draw a confident flat
  // line along the axis for a domain that simply has no ads data.
  //
  // The reference draws a third "Branded Traffic" line. No endpoint in this
  // report separates branded from non-branded queries, so there is no third
  // series to draw rather than a third series to fake.
  if (
    paidPoints.length === points.length &&
    realPointCount(paidPoints) >= MIN_HISTORY_POINTS
  ) {
    series.push({
      label: "Paid Traffic",
      color: COLORS.mint,
      points: paidPoints,
    });
  }

  return {
    svg: renderMultiLineChart(series, {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
    }),
    foot: `Estimated monthly traffic over the last ${points.length} months${
      series.length === 1 ? " · no paid presence in this window" : ""
    }`,
  };
}

/** Bottom-to-top stacking order, which is why the buckets run backwards from
 *  the legend order used by the distribution bar: the reference puts the
 *  fattest bucket (51–100) at the base and Top 3 as the thin band riding on
 *  top. `beyond100` is absent by design — the monthly history carries no
 *  counter for it (see `HistoricalKeywordBucket`), and back-filling one would
 *  be inventing data. */
function bucketTrendSeries(points: BucketTrendPoint[]): TimeSeries[] {
  return KEYWORD_BUCKETS.filter(
    (b): b is HistoricalKeywordBucket => b !== "beyond100",
  )
    .reverse()
    .map((bucket) => ({
      label: BUCKET_LABELS[bucket],
      color: BUCKET_COLORS[bucket],
      points: points.map((p) => ({ date: p.date, value: p.counts[bucket] })),
    }));
}

/** A month where every bucket is zero is a month the domain wasn't tracked,
 *  not a month it ranked for nothing. */
function trackedMonthCount(points: BucketTrendPoint[]): number {
  return points.filter((p) => Object.values(p.counts).some((n) => n > 0))
    .length;
}

/**
 * Keywords is one chart, not two: with history it is the stacked area, and
 * without it, today's distribution bar.
 *
 * They are alternatives rather than neighbours because they are not the same
 * measurement. The bar is a *proportion* of the `RANKED_KEYWORDS_LIMIT`
 * sampled keywords; the area plots the endpoint's *absolute* per-position
 * counts for the whole domain. Stacking one under the other in the same block
 * invites a reader to compare a 200-keyword sample against a six-figure total,
 * and the reference draws only the area here anyway.
 */
function keywordsChart(charts: OverviewReportData["charts"]): ChartBlock {
  const trend = charts.keywordBucketTrend;
  const months = trend.value.points;
  const counts = charts.keywordBuckets.value.counts;

  if (
    trend.source === "ok" &&
    trackedMonthCount(months) >= MIN_HISTORY_POINTS
  ) {
    const beyondToday = counts.beyond100;
    return {
      svg: renderStackedAreaChart(bucketTrendSeries(months), {
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
      }),
      foot:
        `Organic keywords by position over the last ${months.length} months` +
        (beyondToday > 0
          ? ` · ${NUMBER_FMT.format(beyondToday)} past position 100 today, excluded (no monthly history)`
          : ""),
    };
  }

  const sampled = Object.values(counts).reduce((acc, n) => acc + n, 0);
  return {
    svg: stackedBarFromBuckets(counts),
    foot: `Current distribution — ${NUMBER_FMT.format(sampled)} keywords sampled (${NUMBER_FMT.format(RANKED_KEYWORDS_SAMPLE)} max)`,
  };
}

/** Mirrors `RANKED_KEYWORDS_LIMIT` in the service — quoted in the bar's
 *  footnote so the sample size is never mistaken for the domain's total. */
const RANKED_KEYWORDS_SAMPLE = 200;

/* ----------------------------- Organic Research ----------------------------- */

/** DataForSEO reports `main_intent` as a full word; the reference badges it
 *  down to one letter. Anything outside the four known intents keeps its own
 *  initial rather than being forced into a bucket it didn't claim. */
const INTENT_INITIALS: Record<string, string> = {
  informational: "I",
  navigational: "N",
  commercial: "C",
  transactional: "T",
};

function intentBadge(intent: string | null): string {
  if (intent === null) return `<span class="muted">${NO_SOURCE}</span>`;
  const key = intent.toLowerCase();
  const letter = INTENT_INITIALS[key] ?? intent.slice(0, 1).toUpperCase();
  return `<span class="intent" title="${escapeHtml(intent)}">${escapeHtml(letter)}</span>`;
}

/** Five rows, because that is what fits the 288px card the audit budgets. */
const ORGANIC_ROWS = 5;

function organicKeywordRows(rows: TopKeywordRow[]): string {
  if (rows.length === 0) {
    return emptyRow(6);
  }
  return rows
    .slice(0, ORGANIC_ROWS)
    .map(
      (r) => `<tr>
        <td class="kw" title="${escapeHtml(r.keyword)}">${escapeHtml(r.keyword)}</td>
        <td class="center">${intentBadge(r.intent)}</td>
        <td class="num">${r.position == null ? NO_SOURCE : NUMBER_FMT.format(r.position)}</td>
        <td class="num">${fmtCompact(r.volume)}</td>
        <td class="num">${r.cpc == null ? NO_SOURCE : MONEY_FMT.format(r.cpc)}</td>
        <td class="num">${r.traffic == null ? NO_SOURCE : NUMBER_FMT.format(Math.round(r.traffic * 100) / 100)}</td>
      </tr>`,
    )
    .join("");
}

/* ----------------------------- Top-level ----------------------------- */

export function renderOverviewReport({
  report,
  domain,
  country,
  device,
  data,
  flags,
  searchMode = "google",
}: OverviewTemplateInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;
  const countryCode = country.toUpperCase();
  // 8 tiles in 2 rows × 4 columns inside the SEO card. No deltas (+/-%) are
  // shown: the tiles come from the present-day endpoints, and pairing them
  // with a prior month off the history series would compare two
  // differently-scoped measurements.
  const tiles: Tile[] = [
    {
      label: "Authority Score",
      value:
        data.tiles.authority.value != null
          ? String(data.tiles.authority.value)
          : EMPTY_VALUE,
      // The reference has no subline under Authority Score and the row budget
      // has no room for one, so the composition moves to the tooltip.
      hint: `Rank composition: ${data.tiles.authorityComposition.rank ?? NO_SOURCE}${
        data.tiles.authorityComposition.spamPenalty > 0
          ? ` · −${data.tiles.authorityComposition.spamPenalty} spam`
          : ""
      }`,
    },
    {
      label: "Organic Traffic",
      value: fmtCompact(data.tiles.organicTraffic.value),
      hint:
        data.tiles.organicTraffic.value == null
          ? "No data for this period"
          : `${fmtNumber(data.tiles.organicTraffic.value)} estimated monthly visits`,
    },
    {
      label: "Paid Traffic",
      value: fmtCompact(data.tiles.paidTraffic.value),
      hint:
        data.tiles.paidTraffic.value == null
          ? "No data for this period"
          : data.tiles.paidTraffic.value === 0
            ? "0 means no active campaign"
            : `${fmtNumber(data.tiles.paidTraffic.value)} estimated monthly visits`,
    },
    {
      label: "Ref. Domains",
      value: fmtCompact(data.tiles.referringDomains.value),
      hint:
        data.tiles.referringDomains.value == null
          ? "No data for this period"
          : `${fmtNumber(data.tiles.referringDomains.value)} referring domains`,
      icon: ICONS.globe,
    },
    {
      label: "Traffic Share",
      value:
        data.tiles.trafficShare.value != null
          ? PERCENT_FMT.format(data.tiles.trafficShare.value)
          : EMPTY_VALUE,
      hint:
        data.tiles.competitorsCount.value != null
          ? `Competitors ${NUMBER_FMT.format(data.tiles.competitorsCount.value)}`
          : "",
      icon: ICONS.donut,
    },
    {
      label: "Organic Keywords",
      value: fmtCompact(data.tiles.organicKeywords.value),
      hint:
        data.tiles.organicKeywords.value == null
          ? "No data for this period"
          : `${fmtNumber(data.tiles.organicKeywords.value)} ranking keywords`,
    },
    {
      label: "Paid Keywords",
      value: fmtCompact(data.tiles.paidKeywords.value),
      hint:
        data.tiles.paidKeywords.value == null
          ? "No data for this period"
          : `${fmtNumber(data.tiles.paidKeywords.value)} paid keywords`,
    },
    {
      label: "Backlinks",
      value: fmtCompact(data.tiles.backlinks.value),
      hint:
        data.tiles.backlinks.value == null
          ? "No data for this period"
          : `${fmtNumber(data.tiles.backlinks.value)} backlinks`,
      icon: ICONS.globe,
    },
  ];

  const traffic = trafficChart(data.charts.trafficTrend);
  const keywords = keywordsChart(data.charts);

  const countries =
    data.tables.countries.source === "ok" ? data.tables.countries.value : [];
  const topKeywords =
    data.tables.topKeywords.source === "ok"
      ? data.tables.topKeywords.value
      : [];
  const countryFlag = countryFlagIcon(countryCode, flags);

  const now = new Date();
  const generatedDate = DATE_FMT.format(now);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(domain)}</title>
<style>
  :root {
    --bg: #f4f5f5;
    --card: #ffffff;
    --text: ${COLORS.ink};
    --muted: ${COLORS.muted};
    --border: #eeeff0;
    --line: #e8e9ea;
    /* Darker than --border: the hairline around an interactive control (query
       bar, market group, toggles, outline buttons), which has to read as an
       edge rather than as a divider. */
    --control-border: #d6d8dc;
    --brand: ${COLORS.accent};
    --filter-blue: ${COLORS.filterBlue};
    /* Two lavenders, as the audit specifies: the warm one carries tags and
       badges, the cool one marks a selected control. */
    --brand-soft: ${COLORS.lavenderWarm};
    --brand-surface: ${COLORS.lavender};
    --brand-surface-soft: ${COLORS.lavenderFaint};
    --accent: ${COLORS.mint};
    --card-shadow: rgba(0, 21, 16, 0.07) 0 0 1px 0, rgba(0, 21, 16, 0.07) 0 1px 3px 0;
    /* Big panels sit 12px apart; the reference measures 10–12 (audit §A). */
    --gap: 10px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); padding: 18px;
    font-variant-numeric: tabular-nums;
  }
  .shell { max-width: 1280px; margin: 0 auto; }

  /* ---------- header ---------- */
  /* The query group takes only the width it needs; the rest of the row stays
     empty, the way the reference reads (audit §B). */
  .query {
    display: inline-flex; align-items: stretch; gap: 6px; margin-bottom: 8px;
  }
  .query-input {
    display: inline-flex; align-items: center; justify-content: space-between;
    gap: 24px; min-width: 320px; height: 30px; padding: 0 10px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
    font-size: 13px; color: var(--text);
  }
  .query-clear { color: var(--muted); font-size: 14px; line-height: 1; }
  .query-scope {
    display: inline-flex; align-items: center; gap: 8px; height: 30px;
    padding: 0 10px; background: var(--card); border: 1px solid var(--control-border);
    border-radius: 4px; font-size: 13px; color: var(--text);
  }
  .query-go {
    display: inline-flex; align-items: center; height: 30px; padding: 0 14px;
    background: #16181c; color: #fff; border: 0; border-radius: 4px;
    font-size: 13px; font-weight: 600;
  }

  .breadcrumb {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--muted); margin-bottom: 4px;
  }
  .breadcrumb .current { color: var(--text); }

  .title-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; margin-bottom: 6px;
  }
  h1 { font-size: 21px; margin: 0; letter-spacing: -0.02em; font-weight: 700; line-height: 1.2; }
  h1 .domain { color: var(--brand); font-weight: 700; }
  h1 .domain svg { vertical-align: -1px; margin-left: 3px; }
  .btn-outline {
    display: inline-flex; align-items: center; gap: 6px; height: 30px;
    padding: 0 12px; border-radius: 4px; font-size: 12.5px; font-weight: 500;
    background: var(--card); border: 1px solid var(--control-border); color: var(--text);
    white-space: nowrap;
  }

  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; align-items: center; }
  /* Device, date and currency are plain accent-coloured text with a chevron —
     no box. The reference reads them as a row of links; boxing each one turned
     three filters into three buttons competing with the market control beside
     them. The padding is what keeps them apart now that no border does it. */
  .filter {
    display: inline-flex; align-items: center; gap: 6px; height: 26px;
    padding: 0 3px; font-size: 12.5px; font-weight: 500; color: var(--filter-blue);
  }
  .filter svg { width: 13px; height: 13px; color: var(--filter-blue); }
  /* The one boxed item left in the row, because it is a status and not a
     filter: it has to read as an exception to the row, not a member of it. */
  .chip--warn {
    display: inline-flex; align-items: center; height: 26px; padding: 0 9px;
    border-radius: 4px; font-size: 12.5px; font-weight: 500;
    background: #fdf8ec; border: 1px solid #f3e0b5; color: #92660a;
  }

  /* The markets are one segmented control, not four loose labels: a single
     bordered container with hairline dividers between the items, and the
     active market highlighted *inside* it (HDR-03 / design review H10). The
     pills are 24px so the container plus its border matches the 26px chips
     standing next to it. */
  .markets {
    display: inline-flex; align-items: center; margin-right: 6px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
    overflow: hidden;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 5px; height: 24px;
    padding: 0 8px; font-size: 12.5px; font-weight: 500;
    color: var(--text); white-space: nowrap;
  }
  .pill + .pill { border-left: 1px solid var(--control-border); }
  .pill svg { width: 13px; height: 13px; color: var(--muted); }
  .pill--active { background: var(--brand-surface); color: var(--brand); font-weight: 600; }
  .pill--active svg { color: var(--brand); }
  .pill--more { color: var(--muted); letter-spacing: 1px; padding: 0 6px; }

  .tabs {
    display: flex; gap: 18px; border-bottom: 1px solid var(--border);
    margin-bottom: var(--gap);
  }
  .tab {
    padding: 6px 0 9px; font-size: 13px; font-weight: 500;
    color: var(--muted); border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab.active { color: var(--text); font-weight: 600; border-bottom-color: var(--brand); }

  /* ---------- cards ---------- */
  /* Cards carry a double hairline shadow, no border — verified against the
     reference dump (design review §1 bis). */
  .card {
    background: var(--card); border: 0;
    border-radius: 10px; padding: 16px;
    box-shadow: var(--card-shadow);
  }

  /* ---------- KPI row (1fr / 2fr, equal height) ---------- */
  .kpi-row {
    display: grid; grid-template-columns: minmax(340px, 1fr) minmax(0, 2fr);
    gap: var(--gap); align-items: stretch; margin-bottom: var(--gap);
  }
  .card-kpi { display: flex; flex-direction: column; min-height: 175px; }
  /* The badge is a corner tab, not a chip floating inside the card: measured
     on the reference crop its origin is the card's own origin (0,0), so it
     has to escape the card's padding. The asymmetric radius only makes sense
     in that position. */
  .card-tab { margin: -16px 0 6px -16px; }
  .badge {
    display: inline-flex; align-items: center; height: 24px; padding: 0 14px;
    font-size: 12.5px; font-weight: 500; line-height: 20px;
    background: var(--brand-soft); color: var(--brand);
    border-radius: 10px 0 12px 0;
  }
  /* Cooler lavender so the two cards' corner tabs stay distinguishable at a
     glance without a second accent hue. */
  .badge-ai { background: var(--brand-surface); }

  /* AI Search — three metric columns over four source rows. Same column
     rhythm for both, so the source numbers sit under Mentions and Cited Pages
     the way the reference does (left-aligned under their own header, not
     ragged against the card's right edge). */
  .ai-grid, .ai-row {
    display: grid; grid-template-columns: minmax(0, 1fr) 78px 82px;
    align-items: baseline; column-gap: 8px;
  }
  .ai-head { font-size: 12px; color: var(--muted); font-weight: 500; }
  .ai-value { font-size: 19px; font-weight: 700; color: var(--text); margin-top: 2px; }
  .ai-rows { margin-top: 6px; display: flex; flex-direction: column; gap: 1px; }
  .ai-row { font-size: 12px; line-height: 15px; color: var(--text); }
  .ai-row-name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .ai-icon { display: inline-flex; flex-shrink: 0; color: var(--muted); }
  .ai-icon svg { width: 12px; height: 12px; }
  .ai-note { margin-top: auto; padding-top: 4px; font-size: 10.5px; color: var(--muted); }

  /* SEO — 2 rows × 4 columns, hairline dividers between tiles. */
  .tiles { display: flex; flex-direction: column; gap: 12px; }
  .tiles-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 0; }
  .tile { min-width: 0; padding: 0 14px; }
  .tile:first-child { padding-left: 0; }
  .tile-label {
    display: flex; align-items: center; gap: 5px;
    font-size: 12.5px; font-weight: 500; line-height: 17px;
    color: var(--text); margin-bottom: 5px; white-space: nowrap;
  }
  .tile-label svg { color: var(--muted); width: 13px; height: 13px; flex-shrink: 0; }
  .tile-info { display: inline-flex; color: #b7bcc4; }
  .tile-info svg { width: 12px; height: 12px; color: inherit; }
  /* Periwinkle, not near-black: verified against the reference's real HTML
     dump (oklch(0.53 0.157 279.2), see H7 in the original design review) —
     KPI values ARE the accent colour in the reference, confirmed by
     measurement, not inferred from a screenshot. VIS-01 (ee2fc10) briefly
     switched this to --text reasoning from a screenshot read alone; reverted
     once the ground-truth HTML measurement was checked against it. */
  .tile-value { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; color: var(--brand); }
  .tile-value--empty { color: var(--muted); font-weight: 600; }

  /* ---------- analytics workspace ---------- */
  .workspace { margin-bottom: var(--gap); }
  /* The controls need air under them before the section titles start; at 12px
     "Distribution by Country" and "Traffic" read as a caption to the tab row
     rather than the heads of their own modules. The 8px is *taken* from the
     hairline between the two charts below, not added to the card: the
     workspace has a ~508px budget and the bottom grid has ~11px of clearance
     over the 1231 fold, so growing the card spends someone else's room. */
  /* The control row is not one shared strip: it is two groups, each sitting
     over the column it drives. The mode toggle belongs to the rail, the range
     and granularity to the charts — so the row repeats the body's grid
     (WS_COLUMNS) and its 16px gutter, and the left edge of "1M" lands on the
     left edge of "Traffic". Laid out as one flex row, the range floated into
     the rail's third of the page and read as a control over the country
     table, which it isn't. */
  .ws-head {
    display: grid; grid-template-columns: ${WS_COLUMNS}; align-items: center;
    margin-bottom: 20px;
  }
  .ws-head-rail { padding-right: 16px; }
  .ws-head-main { display: flex; align-items: center; gap: 20px; padding-left: 16px; }
  /* Both toggles in this row — AI Search / Google Search and Days / Months —
     are the same control in the reference: one container with a hairline
     border, and the selected side an *inset* box with a lavender fill and its
     own accent hairline. Both labels keep the body ink: the box marks the
     selection, not the colour, which is why the inactive side doesn't grey
     out. 22px item + 1px padding + 1px border = the 26px the rest of the row
     stands at. */
  .seg {
    display: inline-flex; align-items: center; padding: 1px;
    background: var(--card); border: 1px solid var(--control-border);
    border-radius: 5px;
  }
  .seg-item {
    display: inline-flex; align-items: center; height: 22px; padding: 0 9px;
    border-radius: 4px; font-size: 12.5px; font-weight: 500; color: var(--text);
  }
  .seg-item.active {
    background: var(--brand-surface-soft); font-weight: 600;
    box-shadow: inset 0 0 0 1px rgba(104, 104, 216, 0.35);
  }
  /* Granularity + export sit at the far end of the workspace header (ANA-03).
     "Months" is the active one because the series behind both charts is
     monthly — a highlighted "Days" would describe a resolution this report
     never asked the API for. */
  .ws-tools { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
  .ws-tools .btn-outline { height: 26px; }
  .range { display: inline-flex; gap: 14px; font-size: 12.5px; color: var(--muted); }
  .range .active { color: var(--brand); font-weight: 600; border-bottom: 2px solid var(--brand); padding-bottom: 2px; }

  .ws-body { display: grid; grid-template-columns: ${WS_COLUMNS}; min-height: 418px; }
  .rail { padding-right: 16px; border-right: 1px solid var(--border); min-width: 0; }
  .rail-block + .rail-block { margin-top: 12px; }
  .rail-title {
    margin: 0 0 8px; font-size: 15px; font-weight: 700;
    display: flex; align-items: center; gap: 6px;
  }
  .rail-foot { font-size: 10.5px; color: var(--muted); margin-top: 8px; }

  /* Top Cited Sources — the body is sized for the three rows the audit
     budgets, so the module keeps its height whether or not it ever fills. */
  .cited-head, .cited-row {
    display: flex; justify-content: space-between; gap: 8px;
    font-size: 12.5px; padding: 6px 0; border-bottom: 1px solid var(--line);
  }
  .cited-head { font-size: 11px; color: var(--muted); font-weight: 500; padding-bottom: 5px; }
  .cited-empty {
    display: flex; align-items: center; justify-content: center;
    min-height: 78px; font-size: 11px; text-align: center;
  }

  /* SERP donut + legend, side by side inside the rail's width. */
  .serp { display: flex; align-items: center; gap: 12px; }
  .serp-donut { flex-shrink: 0; }
  .serp-legend { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .serp-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; }
  .serp-key { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .serp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .ws-main { padding-left: 16px; display: flex; flex-direction: column; min-width: 0; }
  .chart-block + .chart-block {
    margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
  }
  .chart-block h3 { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
  .chart-body { display: block; }
  .chart-body svg { width: 100%; height: auto; }
  /* Keywords is the one block whose two states draw at different heights (the
     stacked area is ${CHART_HEIGHT}px tall, today's distribution bar
     ${BAR_CHART_HEIGHT}px). The slot is pinned to the area's aspect so the
     shorter state sits inside it instead of pulling the bottom grid ~100px up
     the page — the reflow VIS-03 exists to prevent. Aspect rather than a fixed
     height because the SVG scales with the column, so the two have to be
     expressed in the same terms. */
  .chart-body--keywords {
    display: flex; align-items: center;
    aspect-ratio: ${CHART_WIDTH} / ${CHART_HEIGHT};
  }
  .chart-body--keywords svg { flex: 1; }
  .chart-foot { font-size: 10.5px; color: var(--muted); margin-top: 4px; }

  /* ---------- bottom grid ---------- */
  .section-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .section-head h2 { margin: 0; font-size: 15.5px; font-weight: 700; }
  .section-head .country { font-size: 12.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
  .bottom-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }
  .card-bottom { min-height: 288px; display: flex; flex-direction: column; }
  .bottom-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
  .bottom-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
  .bottom-head .count { font-size: 14px; color: var(--muted); font-weight: 500; }
  .btn-dark {
    display: inline-flex; align-items: center; align-self: flex-start;
    height: 28px; padding: 0 12px; margin-top: auto;
    background: #16181c; color: #fff; border-radius: 4px;
    font-size: 12.5px; font-weight: 600;
  }

  /* ---------- tables ---------- */
  table.data { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.data th, table.data td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  table.data th { font-size: 11px; color: var(--muted); font-weight: 500; padding-bottom: 5px; }
  table.data td { color: var(--text); }
  table.data td.num, table.data th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data td.center, table.data th.center { text-align: center; }
  table.data tr:last-child td { border-bottom: 0; }
  /* An empty table keeps the height of a populated one (VIS-03): the rail
     budgets two country rows, Top Organic Keywords five. */
  table.data tr.is-empty td { height: 64px; }
  table.data--organic tr.is-empty td { height: 148px; }
  table.data td:first-child, table.data th:first-child { padding-left: 0; }
  table.data td:last-child, table.data th:last-child { padding-right: 0; }
  /* Fixed layout so the keyword column keeps its share of the half-width card
     instead of collapsing to fit the numeric ones (audit §P: truncate with a
     tooltip, don't starve the column). */
  table.data--organic { table-layout: fixed; }
  table.data--organic th:nth-child(1) { width: 36%; }
  table.data--organic th:nth-child(2) { width: 11%; }
  table.data--organic th:nth-child(3) { width: 10%; }
  table.data--organic th:nth-child(4) { width: 14%; }
  table.data--organic th:nth-child(5) { width: 15%; }
  td.kw {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--brand);
  }
  .intent {
    display: inline-flex; align-items: center; justify-content: center;
    width: 19px; height: 19px; border-radius: 4px;
    background: var(--brand-soft); color: var(--brand);
    font-size: 10.5px; font-weight: 700;
  }

  /* 3:2 is the aspect the flag SVGs are authored at; the hairline ring keeps
     the white-heavy flags (JP, PL) from dissolving into the row. */
  .flag {
    display: inline-block; width: 17px; height: 11px; vertical-align: -1px;
    border-radius: 2px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 12, 8, 0.12);
  }
  .flag svg { display: block; width: 100%; height: 100%; }
  .muted { color: var(--muted); }
  .center { text-align: center; }

  /* ---------- key topics ---------- */
  /* Our own placeholder art: two blurred lavender panels behind the copy. No
     third-party asset is reproduced, and nothing in it reads as data. */
  .topics-body {
    position: relative; flex: 1; margin-top: 4px; border-radius: 8px;
    overflow: hidden; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(110deg, #eef0ff 0%, #f4f0ff 55%, #efe9ff 100%);
  }
  .topics-skeleton { position: absolute; inset: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; filter: blur(2.5px); opacity: 0.75; }
  .topics-pane { border-radius: 8px; background: rgba(255, 255, 255, 0.5); padding: 12px; display: flex; flex-direction: column; gap: 7px; }
  .topics-bar { height: 7px; border-radius: 4px; background: rgba(104, 104, 216, 0.22); }
  .topics-bar.w70 { width: 70%; }
  .topics-bar.w45 { width: 45%; }
  .topics-bar.w85 { width: 85%; }
  .topics-copy { position: relative; text-align: center; font-size: 13px; color: var(--text); }
  .btn-violet {
    display: inline-flex; align-items: center; height: 26px; padding: 0 12px;
    margin-top: 10px; background: var(--brand); color: #fff;
    border-radius: 4px; font-size: 12.5px; font-weight: 600;
  }

</style>
</head>
<body>
  <div class="shell">
    <div class="query">
      <span class="query-input">${escapeHtml(domain)}<span class="query-clear">×</span></span>
      <span class="query-scope">Root Domain ${ICONS.chevron}</span>
      <span class="query-go">Analyze</span>
    </div>

    <nav class="breadcrumb">
      <span>Home</span>
      <span>›</span>
      <span>SEO</span>
      <span>›</span>
      <span class="current">Domain Overview</span>
    </nav>

    <div class="title-row">
      <h1>${escapeHtml(title)}: <span class="domain">${escapeHtml(domain)}${ICONS.external}</span></h1>
      <span class="btn-outline">${ICONS.download}Export to PDF</span>
    </div>

    <div class="filters">
      ${quickMarketPills(countryCode, flags)}
      <span class="filter">${ICONS.device}${escapeHtml(deviceLabel)} ${ICONS.chevron}</span>
      <span class="filter">${escapeHtml(generatedDate)} ${ICONS.chevron}</span>
      <span class="filter">USD ${ICONS.chevron}</span>
      ${data.healthy ? "" : `<span class="chip--warn">Partial data</span>`}
    </div>

    <div class="tabs">
      <span class="tab active">Overview</span>
      <span class="tab">Growth report</span>
      <span class="tab">Compare by countries</span>
    </div>

    <div class="kpi-row">
      ${renderAiSearchCard(data.aiSearch)}
      <div class="card card-kpi card-seo">
        <div class="card-tab"><span class="badge">SEO</span></div>
        <div class="tiles">${renderTiles(tiles)}</div>
      </div>
    </div>

    <div class="card workspace">
      <div class="ws-head">
        <div class="ws-head-rail">
          <span class="seg">
            <span class="seg-item${searchMode === "ai" ? " active" : ""}">AI Search</span>
            <span class="seg-item${searchMode === "google" ? " active" : ""}">Google Search</span>
          </span>
        </div>
        <div class="ws-head-main">
          <div class="range">
            <span>1M</span><span>6M</span><span>1Y</span><span class="active">2Y</span><span>All time</span>
          </div>
          <div class="ws-tools">
            <span class="seg">
              <span class="seg-item">Days</span>
              <span class="seg-item active">Months</span>
            </span>
            <span class="btn-outline">${ICONS.upload}Export</span>
          </div>
        </div>
      </div>
      <div class="ws-body">
        ${renderRail(searchMode, countries, flags, countryFlag, data.serpDistribution)}
        <div class="ws-main">
          <div class="chart-block">
            <h3>Traffic</h3>
            <div class="chart-body">${traffic.svg}</div>
            <div class="chart-foot">${escapeHtml(traffic.foot)}</div>
          </div>
          <div class="chart-block">
            <h3>Keywords</h3>
            <div class="chart-body chart-body--keywords">${keywords.svg}</div>
            <div class="chart-foot">${escapeHtml(keywords.foot)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section-head">
      <h2>Organic Research</h2>
      <span class="country">${countryFlag}${escapeHtml(countryCode)}</span>
    </div>
    <div class="bottom-grid">
      <div class="card card-bottom">
        <div class="bottom-head">
          <h3>Top Organic Keywords</h3>
          <span class="count">${fmtNumber(data.tiles.organicKeywords.value)}</span>
        </div>
        <table class="data data--organic">
          <thead><tr>
            <th>Keyword</th>
            <th class="center">Intent</th>
            <th class="num">Pos.</th>
            <th class="num">Volume</th>
            <th class="num">CPC (USD)</th>
            <th class="num">Traffic</th>
          </tr></thead>
          <tbody>${organicKeywordRows(topKeywords)}</tbody>
        </table>
        <span class="btn-dark">View details</span>
      </div>

      <div class="card card-bottom">
        <div class="bottom-head">
          <h3><span style="color:var(--brand);vertical-align:-2px;">${ICONS.sparkle}</span> Key Topics</h3>
        </div>
        <div class="topics-body">
          <div class="topics-skeleton">
            <div class="topics-pane">
              <div class="topics-bar w70"></div>
              <div class="topics-bar w45"></div>
              <div class="topics-bar w85"></div>
            </div>
            <div class="topics-pane">
              <div class="topics-bar w45"></div>
              <div class="topics-bar w85"></div>
              <div class="topics-bar w70"></div>
            </div>
          </div>
          <div class="topics-copy">
            View <strong>${escapeHtml(domain)}</strong> key topics
            <div><span class="btn-violet">Get topics</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
