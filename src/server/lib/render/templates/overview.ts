/* eslint-disable max-lines, max-lines-per-function -- Domain Overview template mirrors the Semrush 2026 layout — breadcrumb, full-width SEO card (8 tiles), and a single unified section (sidebar + stacked charts). Splitting fragments the section narrative across files. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  BucketTrendPoint,
  CountryRow,
  HistoricalKeywordBucket,
  KeywordBucket,
  OverviewReportData,
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
 * inline SVG icons). Mirrors the exact Semrush 2026 clone spec
 * (`.dev/specs/semrush-2026-exact-clone-spec.md`).
 *
 * All rendered copy is in English, matching the reference capture.
 *
 * Card count: the reference page has exactly 3 `Card` surfaces (AI Search,
 * SEO, and `#widgetDistribution`). AI Search is out of scope (no data
 * source), so we render **2**:
 *
 *   1. "SEO" — full width, 8 KPI tiles in 2 rows × 4 columns (Authority
 *      Score, Organic Traffic, Paid Traffic, Referring Domains, Traffic
 *      Share, Organic Keywords, Paid Keywords, Backlinks). Full width rather
 *      than the original's 2/3 because reserving a third of the page for an
 *      empty AI Search placeholder reads worse than not having it at all
 *      (design review §3).
 *   2. The unified section (`#widgetDistribution` equivalent) — a single card
 *      with `324px 1fr` columns and no internal card borders:
 *        - sidebar: "Distribution by Country" table + "Key Topics"
 *          placeholder (our own addition; the topics endpoint is out of scope
 *          for E3).
 *        - main column: "Traffic" over "Keywords", separated by a hairline.
 *          Both plot the monthly history from `historical_rank_overview` when
 *          the domain has enough of one, and degrade to an honest placeholder
 *          (Traffic) or today's distribution bar (Keywords) when it doesn't —
 *          see {@link MIN_HISTORY_POINTS}.
 *
 * Above them: breadcrumb + header chips (country, device, report date,
 * "Partial data" when degraded — the domain itself lives only in the `<h1>`,
 * see the design review's H10) and the decorative tab strip (only "Overview"
 * is active; the real Semrush tabs are `display:none` in the captured state,
 * so there is no better reference).
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
  serpFeatures: "SERP features",
};

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

const EMPTY_VALUE = "N/A";

function fmtNumber(value: number | null): string {
  return value == null ? EMPTY_VALUE : NUMBER_FMT.format(value);
}

function fmtPercent(value: number | null): string {
  return value == null ? EMPTY_VALUE : PERCENT_FMT.format(value);
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
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

/* ----------------------------- Icons ----------------------------- */

const ICONS = {
  globe: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>`,
  donut: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor" stroke="none"></path></svg>`,
} as const;

/* ----------------------------- Tiles ----------------------------- */

type Tile = {
  label: string;
  value: string;
  sub: string;
  icon?: string;
};

const TILES_PER_ROW = 4;

/** 2 rows × 4 columns, matching the confirmed Semrush 2026 "SEO" card grid
 *  (`.dev/specs/semrush-2026-exact-clone-spec.md` §6). */
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
      <div class="tile">
        <div class="tile-label">${t.icon ?? ""}${escapeHtml(t.label)}</div>
        <div class="tile-value${t.value === EMPTY_VALUE ? " tile-value--empty" : ""}">${escapeHtml(t.value)}</div>
        ${t.sub ? `<div class="tile-sub">${escapeHtml(t.sub)}</div>` : ""}
      </div>`,
      )
      .join("")}
    </div>`,
    )
    .join("");
}

/* ----------------------------- Distribution table ----------------------------- */

function countryRows(
  rows: CountryRow[],
  flags: Record<string, string>,
): string {
  if (rows.length === 0) {
    return `<tr><td colspan="4" class="muted center">No data</td></tr>`;
  }
  return rows
    .map((r) => {
      return `<tr>
        <td>${countryFlagIcon(r.countryCode, flags)} ${escapeHtml(countryDisplayLabel(r))}</td>
        <td class="num">${fmtPercent(r.share)}</td>
        <td class="num">${fmtNumber(r.traffic)}</td>
        <td class="num">${fmtNumber(r.keywords)}</td>
      </tr>`;
    })
    .join("");
}

/* ----------------------------- Buckets ----------------------------- */

/** Brand palette for the bucket segments — fixed order so the chart legend
 *  matches the spec example (Top 3 = brand, 4–10 = accent, then warn / brand
 *  dark / orange / teal for the smaller buckets).
 */
const BUCKET_COLORS: Record<KeywordBucket, string> = {
  top3: "#1f6feb",
  rank4to10: "#14b8a6",
  rank11to20: "#0b3d91",
  rank21to50: "#94a3b8",
  rank51to100: "#fb923c",
  serpFeatures: "#22c55e",
};

/** Nominal chart canvas — the full width of the unified section's main
 *  column (1216 shell − 40 padding − 324 sidebar − 16 gap = 836), so
 *  `width:100%; height:auto` scales SVG text at the size it was authored at
 *  instead of stretching a small canvas (see the design review's H3). */
const CHART_WIDTH = 836;
const CHART_HEIGHT = 260;
/** Legend row + the 24px bar — the bucket split is a proportion, not a
 *  series, so it doesn't need a 260px canvas (design review finding F). */
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
    { label: "Organic Traffic", color: "#1f6feb", points },
  ];
  // The chart samples every series on the first one's dates, so a paid series
  // of a different length would be read off the wrong months. A paid series
  // that is empty or too short is dropped entirely: `renderMultiLineChart`
  // floors a missing value at 0, so plotting it would draw a confident flat
  // line along the axis for a domain that simply has no ads data.
  if (
    paidPoints.length === points.length &&
    realPointCount(paidPoints) >= MIN_HISTORY_POINTS
  ) {
    series.push({ label: "Paid Traffic", color: "#14b8a6", points: paidPoints });
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
 *  top. `serpFeatures` is absent by design — the monthly history carries no
 *  counter for it (see `HistoricalKeywordBucket`), and back-filling one would
 *  be inventing data. */
function bucketTrendSeries(points: BucketTrendPoint[]): TimeSeries[] {
  return KEYWORD_BUCKETS.filter(
    (b): b is HistoricalKeywordBucket => b !== "serpFeatures",
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

  if (trend.source === "ok" && trackedMonthCount(months) >= MIN_HISTORY_POINTS) {
    const serpToday = counts.serpFeatures;
    return {
      svg: renderStackedAreaChart(bucketTrendSeries(months), {
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
      }),
      foot:
        `Organic keywords by position over the last ${months.length} months` +
        (serpToday > 0
          ? ` · ${NUMBER_FMT.format(serpToday)} SERP features today, excluded (no monthly history)`
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

/* ----------------------------- Top-level ----------------------------- */

export function renderOverviewReport({
  report,
  domain,
  country,
  device,
  data,
  flags,
}: OverviewTemplateInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;
  // 8 tiles in 2 rows × 4 columns, matching the Semrush 2026 "SEO" card
  // (`.dev/specs/semrush-2026-exact-clone-spec.md` §6) — not the 5-tile
  // single row from the old design. No deltas (+/-%) are shown: the tiles come
  // from the present-day endpoints, and pairing them with a prior month off
  // the history series would compare two differently-scoped measurements.
  const tiles: Tile[] = [
    {
      label: "Authority Score",
      value:
        data.tiles.authority.value != null
          ? String(data.tiles.authority.value)
          : EMPTY_VALUE,
      sub: `rank composition: ${data.tiles.authorityComposition.rank ?? "—"}${
        data.tiles.authorityComposition.spamPenalty > 0
          ? ` · −${data.tiles.authorityComposition.spamPenalty} spam`
          : ""
      }`,
    },
    {
      label: "Organic Traffic",
      value: fmtNumber(data.tiles.organicTraffic.value),
      sub:
        data.tiles.organicTraffic.value == null
          ? "no data for this period"
          : "",
    },
    {
      label: "Paid Traffic",
      value: fmtNumber(data.tiles.paidTraffic.value),
      sub:
        data.tiles.paidTraffic.value == null
          ? "no data for this period"
          : data.tiles.paidTraffic.value === 0
            ? "0 means no active campaign"
            : "",
    },
    {
      label: "Referring Domains",
      value: fmtNumber(data.tiles.referringDomains.value),
      sub:
        data.tiles.referringDomains.value == null
          ? "no data for this period"
          : "",
      icon: ICONS.globe,
    },
    {
      label: "Traffic Share",
      value:
        data.tiles.trafficShare.value != null
          ? PERCENT_FMT.format(data.tiles.trafficShare.value)
          : EMPTY_VALUE,
      sub:
        data.tiles.competitorsCount.value != null
          ? `Competitors ${NUMBER_FMT.format(data.tiles.competitorsCount.value)}`
          : "",
      icon: ICONS.donut,
    },
    {
      label: "Organic Keywords",
      value: fmtNumber(data.tiles.organicKeywords.value),
      sub:
        data.tiles.organicKeywords.value == null
          ? "no data for this period"
          : "",
    },
    {
      label: "Paid Keywords",
      value: fmtNumber(data.tiles.paidKeywords.value),
      sub:
        data.tiles.paidKeywords.value == null ? "no data for this period" : "",
    },
    {
      label: "Backlinks",
      value: fmtNumber(data.tiles.backlinks.value),
      sub: data.tiles.backlinks.value == null ? "no data for this period" : "",
      icon: ICONS.globe,
    },
  ];

  const traffic = trafficChart(data.charts.trafficTrend);
  const keywords = keywordsChart(data.charts);

  const countriesRows = countryRows(
    data.tables.countries.source === "ok" ? data.tables.countries.value : [],
    flags,
  );

  const now = new Date();
  const generatedDate = DATE_FMT.format(now);
  const generatedDateTime = DATETIME_FMT.format(now);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(domain)}</title>
<style>
  :root {
    --bg: #f5f7fa;
    --card: #ffffff;
    --text: #1f2933;
    --muted: #6b7785;
    --border: #e4e9f0;
    --brand: oklch(0.53 0.157 279.2);
    --accent: #14b8a6;
    --card-shadow: rgba(0, 21, 16, 0.07) 0 0 1px 0, rgba(0, 21, 16, 0.07) 0 1px 3px 0;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); padding: 32px;
  }
  .shell { max-width: 1216px; margin: 0 auto; }
  .breadcrumb {
    display: flex; align-items: center; gap: 6px;
    font-size: 14px; color: var(--muted); margin-bottom: 8px;
  }
  .breadcrumb .current { color: var(--text); }
  h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 24px 0 12px; color: var(--text); }
  .chips { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 24px; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; height: 28px;
    padding: 0 12px; border-radius: 6px; font-size: 13px; font-weight: 500;
    background: var(--card); border: 1px solid var(--border); color: var(--muted);
  }
  .chip svg { width: 14px; height: 14px; }

  .tabs {
    display: flex; gap: 0; border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
  }
  .tab {
    padding: 10px 16px; font-size: 13px; font-weight: 600;
    color: var(--muted); border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab.active {
    color: var(--brand);
    border-bottom-color: var(--brand);
  }

  /* 2 rows × 4 columns; proportional fr columns + a hairline divider
     between tiles (design review H5). */
  .tiles { display: flex; flex-direction: column; gap: 36px; }
  .tiles-row {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr 1fr;
    column-gap: 0;
  }
  .tile { min-width: 0; padding: 0 24px; border-radius: 6px; }
  .tile:first-child { padding-left: 0; }
  .tile + .tile { border-left: 1px solid rgba(0, 12, 8, 0.16); }
  .tile-label {
    display: flex; align-items: center; gap: 6px;
    font-size: 14px; font-weight: 400; line-height: 19.88px;
    color: rgba(1, 5, 0, 0.898); text-transform: capitalize;
    margin-bottom: 8px;
  }
  .tile-label svg { color: var(--muted); width: 14px; height: 14px; flex-shrink: 0; }
  .tile-value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; color: var(--brand); }
  .tile-value--empty { color: var(--muted); font-weight: 600; }
  .tile-sub { font-size: 11px; color: var(--muted); margin-top: 6px; line-height: 1.3; }

  /* Cards carry a double hairline shadow, no border — verified against the
     reference dump (design review §1 bis). */
  .card {
    background: var(--card); border: 0;
    border-radius: 8px; padding: 20px;
    box-shadow: var(--card-shadow);
    margin-bottom: 24px;
  }

  /* The unified lower section: one card, sidebar + stacked charts, no
     internal card surfaces (design review H1 — the 324px sidebar and 16px
     gap are literal values from the reference). */
  .section {
    display: grid; grid-template-columns: 324px 1fr;
    column-gap: 16px; align-items: start;
  }
  .section-side { display: flex; flex-direction: column; gap: 28px; min-width: 0; }
  .section-main { display: flex; flex-direction: column; min-width: 0; }
  .chart-block + .chart-block {
    margin-top: 32px; padding-top: 32px; border-top: 1px solid var(--border);
  }

  .card-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 12px;
  }
  .card-head h3 { margin: 0; font-size: 16px; font-weight: 700; line-height: 24px; color: rgba(1, 5, 0, 0.898); }
  .card-head .muted { font-size: 12px; color: var(--muted); }
  .muted { color: var(--muted); }
  .center { text-align: center; }
  .badge {
    display: inline-flex; align-items: center; height: 28px; padding: 0 20px;
    font-size: 14px; font-weight: 500; line-height: 20px;
    background: rgb(231, 229, 255); color: rgb(92, 83, 217);
    border-radius: 6px 0 12px 0;
  }
  /* The badge is a corner tab, not a chip floating inside the card: measured
     on the reference crop its origin is the card's own origin (0,0), so it
     has to escape the card's 20px padding. The asymmetric radius above only
     makes sense in that position. */
  .card-seo .card-head { margin: -20px 0 18px -20px; }
  .chart-body { display: block; }
  .chart-body svg { width: 100%; height: auto; }
  .chart-foot { font-size: 11px; color: var(--muted); margin-top: 8px; padding: 0 4px; }

  table.data { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.data th, table.data td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  table.data th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data tr:last-child td { border-bottom: 0; }
  /* 3:2 is the aspect the flag SVGs are authored at; the hairline ring keeps
     the white-heavy flags (JP, PL) from dissolving into the row. */
  .flag {
    display: inline-block; width: 18px; height: 12px; vertical-align: -1px;
    border-radius: 2px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 12, 8, 0.12);
  }
  .flag svg { display: block; width: 100%; height: 100%; }

  .topic-card {
    text-align: center;
    padding: 28px 18px;
    background: linear-gradient(180deg, #f0f6ff 0%, #fafbff 100%);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .topic-card .topic-help {
    display: inline-block; padding: 6px 12px; border-radius: 999px;
    background: #e0ecff; color: var(--brand); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em;
  }

  .footer {
    margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--border);
    font-size: 11px; color: var(--muted); display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="shell">
    <nav class="breadcrumb">
      <span>Home</span>
      <span>›</span>
      <span>SEO</span>
      <span>›</span>
      <span class="current">Domain Overview</span>
    </nav>
    <h1>${escapeHtml(title)}: <span style="font-weight:500;color:var(--muted)">${escapeHtml(domain)}</span></h1>
    <div class="chips">
      <span class="chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        Country: ${escapeHtml(country.toUpperCase())}
      </span>
      <span class="chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>
        ${escapeHtml(deviceLabel)}
      </span>
      <span class="chip">${escapeHtml(generatedDate)}</span>
      ${data.healthy ? "" : `<span class="chip" style="color:#92660a;border-color:#f3e0b5;background:#fdf8ec;">Partial data</span>`}
    </div>

    <div class="tabs">
      <span class="tab active">Overview</span>
      <span class="tab">Domain Comparison</span>
      <span class="tab">Growth</span>
      <span class="tab">Country Comparison</span>
    </div>

    <div class="card card-seo">
      <div class="card-head">
        <span class="badge">SEO</span>
      </div>
      <div class="tiles">${renderTiles(tiles)}</div>
    </div>

    <div class="card section">
      <aside class="section-side">
        <div class="side-block">
          <div class="card-head">
            <h3>Distribution by Country</h3>
          </div>
          <table class="data">
            <thead><tr>
              <th>Country</th>
              <th class="num">Share</th>
              <th class="num">Traffic</th>
              <th class="num">Keywords</th>
            </tr></thead>
            <tbody>${countriesRows}</tbody>
          </table>
          <div class="chart-foot">share = country traffic / worldwide traffic</div>
        </div>

        <div class="side-block">
          <div class="card-head">
            <h3>Key Topics</h3>
            <span class="muted">coming soon</span>
          </div>
          <div class="topic-card">
            <div class="topic-help">Explore the key topics for ${escapeHtml(domain)}</div>
            <p class="muted" style="margin-top:12px;font-size:12px;">View topics</p>
          </div>
        </div>
      </aside>

      <div class="section-main">
        <div class="chart-block">
          <div class="card-head">
            <h3>Traffic</h3>
            <span class="muted">1M / 6M / 1Y / 2Y / All time</span>
          </div>
          <div class="chart-body">${traffic.svg}</div>
          <div class="chart-foot">${escapeHtml(traffic.foot)}</div>
        </div>

        <div class="chart-block">
          <div class="card-head">
            <h3>Keywords</h3>
          </div>
          <div class="chart-body">${keywords.svg}</div>
          <div class="chart-foot">${escapeHtml(keywords.foot)}</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <span>Data via DataForSEO</span>
      <span>Generated: ${escapeHtml(generatedDateTime)}</span>
      <span>${escapeHtml(report)} · ${escapeHtml(country.toUpperCase())} · ${escapeHtml(deviceLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}
