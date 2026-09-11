/* eslint-disable max-lines, max-lines-per-function -- The Backlinks template is one page narrative: shell, KPI strip, authority row, two history grids, two breakdown grids. Splitting it across files scatters the composition and the height budget that ties the regions together. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  AnchorRow,
  AttributeRow,
  AuthorityBucketRow,
  BacklinksReportData,
  CategoryRow,
  TypeRow,
} from "@/server/lib/render/reports/backlinks-report";
import {
  placeholderSvg,
  renderAreaChart,
  renderAuthorityProfile,
  renderDivergingBarChart,
  renderLineChart,
  renderOrganicNetworkGraph,
  renderWordCloud,
} from "@/server/lib/render/charts/charts";

/**
 * Backlink Analytics report template.
 *
 * Self-contained HTML handed to the Puppeteer renderer, which screenshots it
 * once at a fixed 1280px width. Composition follows the parity pack in
 * `.dev/designer/semrush-backlinks-ui-parity-pack-2026-09-11/` as re-read
 * through `.dev/specs/backlinks-parity-interpretation.md`, and reuses the
 * design system measured for Domain Overview
 * (`.dev/specs/render-reports-design-playbook.md` §1).
 *
 * Page regions, top to bottom:
 *
 *   1. Shell (~190px): query bar, breadcrumb + help links, title + export,
 *      tab strip, competitor comparison row.
 *   2. KPI strip (~80px): ONE white surface, six cells split by vertical
 *      hairlines — not six cards. Referring Domains and Backlinks carry a
 *      delta derived from the history window; Monthly Visits and Outbound
 *      Domains have no source in DataForSEO and render a neutral `n/a`
 *      without giving up their cell.
 *   3. Authority row (~300px): three equal-height cards — Authority Score
 *      (score + badge + 3-axis profile), Authority Score Trend, Network Graph.
 *   4. Two 50/50 history grids: Referring Domains / Backlinks as areas, then
 *      New and Lost for each as diverging bars around zero.
 *   5. Two 50/50 breakdown grids: Categories / Top Anchors, then Referring
 *      Domains by Authority Score / a combined Backlink Types + Link
 *      Attributes card.
 *
 * **Static-render caveat.** The output is a PNG. The query bar, tabs, range
 * pills, legend checkboxes and buttons are markup shaped like controls,
 * rendered in one already-chosen state. There is no script, no hover, no
 * media query and no external resource anywhere in the document; "tooltips"
 * are `title` attributes.
 *
 * **Degraded state is a first-class case.** Every module keeps its geometry
 * when its source fails: charts fall back to a placeholder drawn at the same
 * canvas size, bar-row lists fall back to the same number of skeleton rows,
 * and every card carries a `min-height`. Rendering the whole page with every
 * source in error must not change the page height (`pnpm preview:backlinks
 * --degraded` exists to check exactly that).
 */

export type BacklinksTemplateInput = {
  report: ReportKind;
  domain: string;
  country: string;
  device: string;
  data: BacklinksReportData;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ----------------------------- Palette ----------------------------- */

/**
 * Colour tokens, in TypeScript rather than only in the `:root` block.
 *
 * Half of them are consumed outside CSS — every chart in this report is an
 * SVG string built by `charts.tsx` from literal colours passed in from here.
 * A token that only exists in the stylesheet silently leaves the charts on
 * the old palette, which is how the original blue survived the first repaint
 * of Domain Overview (playbook §1).
 *
 * `charts.tsx` keeps its own default `PALETTE`; it is shared with the
 * Competitors report, which this work does not restyle. Nothing below is
 * pushed into it — every colour travels as an explicit argument.
 */
const COLORS = {
  /** Near-black body ink. Measured, not inferred: text is not navy. */
  ink: "#202020",
  muted: "#6b7280",
  /** Periwinkle. KPI values, active states, primary series, counts. */
  accent: "#6868d8",
  /** Cool lavender: the fill of a selected control. */
  lavender: "#e6e9fc",
  /** Warm lavender: tags and badges sitting on a white card. */
  lavenderWarm: "#eae5fe",
  /** Teal, deliberately not green — green stays reserved for a semantic
   *  positive. Carries the authority profile and the Follow attribute. */
  mint: "#14b8a6",
  /** Pale mint for the semantic badge pill. */
  mintSoft: "#d7f6ee",
  /** Loss. The one token the parity audit contributed that the playbook had
   *  no equivalent for: the Lost series below the zero baseline. */
  coral: "#ff6b70",
  /** A semantic positive delta, and only that. */
  positive: "#16a34a",
  /** Unfilled bar track. */
  track: "#eeeff0",
  border: "#eeeff0",
  /** Darker than the divider: the edge of something shaped like a control. */
  controlBorder: "#d6d8dc",
} as const;

/**
 * The periwinkle ramp for "Referring Domains by Authority Score": most
 * saturated where the domains actually pile up, pale lavender down the tail.
 * The buckets are a *distribution*, so the colour has to encode concentration
 * — ten unrelated hues would read as ten categories.
 */
const AUTHORITY_RAMP = [
  "#eceefb",
  "#c9cef5",
  "#a2a8ec",
  "#8085e2",
  "#5a5ad3",
] as const;

/** Square-rooted so the long tail still separates: a linear ramp against a
 *  bucket holding half the domains flattens the other nine to the palest
 *  step. */
function authorityRampColor(share: number, maxShare: number): string {
  if (maxShare <= 0) return AUTHORITY_RAMP[0];
  const step = Math.min(
    AUTHORITY_RAMP.length - 1,
    Math.round(Math.sqrt(Math.max(0, share) / maxShare) * 4),
  );
  return AUTHORITY_RAMP[step] ?? AUTHORITY_RAMP[0];
}

/* ----------------------------- Icons ----------------------------- */

const ICONS = {
  info: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4M12 8h.01"></path></svg>`,
  external: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"></path></svg>`,
  book: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"></path><path d="M9 3v18"></path></svg>`,
  flag: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h9l-1 3h7v9h-8l-1-3H5"></path></svg>`,
  check: `<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 5 5 9-11"></path></svg>`,
  dots: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="19" cy="12" r="1.7"></circle></svg>`,
} as const;

/* ----------------------------- Formatting ----------------------------- */

const NUMBER_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

/** The cell exists but no source behind it reports the number. Neutral grey,
 *  never an alarm colour: six red tiles say "this is broken", not "nobody
 *  publishes this figure" (playbook §3). */
const EMPTY_VALUE = "n/a";

const COMPACT_UNITS = [
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/** `1,800,000` to `1.8M`. Every figure on this page is abbreviated the way
 *  the reference reads it; the exact number survives on the `title`. */
function fmtCompact(value: number | null): string {
  if (value == null) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const unit = COMPACT_UNITS.find((u) => abs >= u.at);
  if (unit === undefined) return NUMBER_FMT.format(value);
  return `${(value / unit.at).toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
}

function fmtNumber(value: number | null): string {
  return value == null ? EMPTY_VALUE : NUMBER_FMT.format(value);
}

/**
 * A share as a whole percent, with a `<1%` floor.
 *
 * Rounding a real 0.04% down to a flat `0%` is the one rounding that changes
 * the claim: it says the bucket is empty when it isn't.
 */
function fmtShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const pct = share * 100;
  if (pct < 1) return "&lt;1%";
  return `${Math.round(pct)}%`;
}

/** Signed, with a true minus sign, and coloured only as a secondary cue —
 *  the sign carries the meaning on its own. */
function fmtDelta(value: number | null): string {
  if (value == null) return "";
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) return "";
  const sign = value > 0 ? "+" : "−";
  const tone = value > 0 ? "kpi-delta--up" : "kpi-delta--down";
  return `<span class="kpi-delta ${tone}">${sign}${pct}%</span>`;
}

const MS_PER_DAY = 86_400_000;

/**
 * "Last 12 weeks" — from the data, never from the reference.
 *
 * The cadence is inferred from the gap between the first two samples rather
 * than assumed, because this template cannot know what window the service
 * asked DataForSEO for, and the one thing it must not do is inherit the
 * reference's "Last 12 months" caption over a quarter of weekly samples.
 *
 * `mode` distinguishes a *series*, where n samples span n−1 intervals, from
 * *bars*, where each sample is one completed period.
 */
function historyWindowLabel(dates: string[], mode: "bars" | "series"): string {
  if (dates.length < 2) return "";
  const first = Date.parse(dates[0] ?? "");
  const second = Date.parse(dates[1] ?? "");
  if (Number.isNaN(first) || Number.isNaN(second)) return "";
  const stepDays = Math.abs(second - first) / MS_PER_DAY;
  const count = mode === "bars" ? dates.length : dates.length - 1;
  if (count <= 0) return "";
  if (stepDays >= 28) return `Last ${Math.round(count)} months`;
  if (stepDays >= 6) return `Last ${Math.round(count)} weeks`;
  return `Last ${Math.round(count)} days`;
}

/**
 * The same window as a range pill: `12W`, `18M`, `30D`.
 *
 * The reference labels this pill `1Y`. Ours says what the series behind it
 * actually covers, because the pill sits directly above the chart and a
 * reader takes it as the chart's x-range — printing `1Y` over a quarter of
 * weekly samples is the same fabrication as printing an invented number,
 * just in the axis instead of the cell.
 */
function shortWindowLabel(dates: string[]): string {
  const full = historyWindowLabel(dates, "series");
  const match = /^Last (\d+) (days|weeks|months)$/.exec(full);
  if (match === null) return "—";
  const unit = { days: "D", weeks: "W", months: "M" }[match[2] ?? "days"];
  return `${match[1]}${unit}`;
}

/* ----------------------------- KPI strip ----------------------------- */

type Kpi = {
  label: string;
  value: string;
  /** Exact figure or the reason there isn't one, on the cell's `title`. */
  hint: string;
  delta?: number | null;
};

/**
 * Six cells on one surface, divided by hairlines.
 *
 * A cell whose source reports nothing keeps its slot and shows `n/a` in the
 * muted ink. Dropping it would collapse the strip to five, which is the
 * composition this report is moving away from.
 */
function renderKpiStrip(kpis: Kpi[]): string {
  const cells = kpis
    .map(
      (k) => `
      <div class="kpi" title="${escapeHtml(k.hint)}">
        <div class="kpi-label">${escapeHtml(k.label)}<span class="kpi-info">${ICONS.info}</span></div>
        <div class="kpi-value${k.value === EMPTY_VALUE ? " kpi-value--empty" : ""}">${escapeHtml(k.value)}${fmtDelta(k.delta ?? null)}</div>
      </div>`,
    )
    .join("");
  return `<div class="card kpis">${cells}</div>`;
}

/* ----------------------------- Bar rows ----------------------------- */

/**
 * Categories, the authority distribution, backlink types and link attributes
 * are one row primitive rendered four times, not four tables.
 *
 * Two layouts, because the reference uses two and they are the same row:
 *   - `inline`: label, track, %, count on one line — the dense lists.
 *   - `stacked`: label and figures on one line with a full-width track
 *     beneath — the Categories block, whose labels are long enough that an
 *     inline track would be squeezed to nothing.
 *
 * HTML and CSS rather than SVG: the text renders with real font hinting and
 * the columns align with the rest of the card for free.
 *
 * The fill is the share itself, not the share normalised against the largest
 * row. A normalised bar makes the biggest row full-width whatever it holds,
 * so a 6% leader would look like the whole market.
 */
type BarRowInput = {
  label: string;
  share: number;
  count: number;
  color: string;
  hint: string;
};

/** Sub-1% rows still get a visible sliver: a row drawn at zero width reads as
 *  a row with no data rather than a row with very little. */
const MIN_FILL_PERCENT = 0.5;

function renderBarRows(
  rows: BarRowInput[],
  layout: "inline" | "stacked",
): string {
  return rows
    .map((r) => {
      const width = Math.max(
        MIN_FILL_PERCENT,
        Math.min(100, r.share * 100),
      ).toFixed(1);
      const track = `<span class="brow-track"><span class="brow-fill" style="width:${width}%;background:${r.color}"></span></span>`;
      if (layout === "stacked") {
        return `
        <div class="brow brow--stacked" title="${escapeHtml(r.hint)}">
          <div class="brow-head">
            <span class="brow-label">${escapeHtml(r.label)}</span>
            <span class="brow-nums"><span class="brow-share">${fmtShare(r.share)}</span><span class="brow-count">${fmtCompact(r.count)}</span></span>
          </div>
          ${track}
        </div>`;
      }
      return `
        <div class="brow brow--inline" title="${escapeHtml(r.hint)}">
          <span class="brow-label">${escapeHtml(r.label)}</span>
          ${track}
          <span class="brow-share">${fmtShare(r.share)}</span>
          <span class="brow-count">${fmtCompact(r.count)}</span>
        </div>`;
    })
    .join("");
}

/**
 * The same rows with nothing in them.
 *
 * `count` is the number of rows the populated module budgets, so a failed
 * source costs the page exactly zero pixels of height.
 */
function placeholderBarRows(
  count: number,
  layout: "inline" | "stacked",
): string {
  const dash = "—";
  return Array.from({ length: count }, () => {
    const track = `<span class="brow-track"></span>`;
    if (layout === "stacked") {
      return `
        <div class="brow brow--stacked">
          <div class="brow-head">
            <span class="brow-label muted">${dash}</span>
            <span class="brow-nums"><span class="brow-share muted">${dash}</span><span class="brow-count muted">${dash}</span></span>
          </div>
          ${track}
        </div>`;
    }
    return `
        <div class="brow brow--inline">
          <span class="brow-label muted">${dash}</span>
          ${track}
          <span class="brow-share muted">${dash}</span>
          <span class="brow-count muted">${dash}</span>
        </div>`;
  }).join("");
}

/* ----------------------------- Card chrome ----------------------------- */

function cardHead(title: string, aside = ""): string {
  return `
      <div class="card-head">
        <h3>${escapeHtml(title)}<span class="card-info">${ICONS.info}</span></h3>
        ${aside}
      </div>`;
}

const CTA = `<span class="btn-dark">View full report</span>`;

/* ----------------------------- Chart canvases ----------------------------- */

/**
 * Authoring sizes for the SVG canvases, derived from the real column widths
 * at the 1280px render: 1280 shell − 36 body padding = 1244; a half column is
 * (1244 − 12) / 2 = 616 outer, 584 inner; a third is (1244 − 24) / 3 = 406
 * outer, 374 inner. The SVGs are then scaled with `width:100%; height:auto`,
 * which keeps their text at the size it was authored at instead of stretching
 * a smaller canvas.
 *
 * Every degraded fallback is drawn at the *same* size, so a failed source
 * cannot move anything below it.
 */
const THIRD_W = 374;
const HALF_W = 584;
const PROFILE_H = 200;
const TREND_H = 200;
const GRAPH_H = 172;
const AREA_H = 190;
const BARS_H = 172;
const CLOUD_H = 262;

/** Row counts each module budgets, and the number of skeleton rows its
 *  degraded state draws. */
const CATEGORY_ROWS = 5;
const AUTHORITY_BUCKET_ROWS = 10;
const BREAKDOWN_ROWS = 4;
const ANCHOR_WORDS = 12;

function noData(width: number, height: number): string {
  return placeholderSvg("No data", { width, height });
}

/* ----------------------------- Modules ----------------------------- */

function renderAuthorityCard(
  profile: BacklinksReportData["charts"]["authorityProfile"],
): string {
  const { score, badge, axes } = profile.value;
  const drawable = profile.source === "ok" && axes.length > 0;
  const chart = drawable
    ? renderAuthorityProfile(axes, {
        width: THIRD_W,
        height: PROFILE_H,
        stroke: COLORS.mint,
        fill: "rgba(20,184,166,0.16)",
        muted: COLORS.muted,
      })
    : noData(THIRD_W, PROFILE_H);

  return `
    <div class="card card-auth">
      ${cardHead("Authority Score")}
      <div class="auth-score">
        <span class="auth-value${score == null ? " auth-value--empty" : ""}">${score == null ? EMPTY_VALUE : String(score)}</span>
        ${badge == null ? "" : `<span class="badge-mint">${escapeHtml(badge)}</span>`}
      </div>
      <div class="chart">${chart}</div>
    </div>`;
}

function renderTrendCard(
  trend: BacklinksReportData["charts"]["authorityTrend"],
): string {
  const points = trend.value.points;
  const drawable =
    trend.source === "ok" && points.filter((p) => p.value != null).length >= 2;
  const chart = drawable
    ? renderLineChart(points, {
        width: THIRD_W,
        height: TREND_H,
        color: COLORS.accent,
        // The metric is bounded 0-100, so the axis is too. Left to scale
        // itself, a flat 73-75 series zooms into its own noise and reads as
        // if it swung across the whole plot.
        domain: [0, 100],
        dateFormat: "monthYear",
      })
    : noData(THIRD_W, TREND_H);
  const window = drawable
    ? historyWindowLabel(
        points.map((p) => p.date),
        "series",
      )
    : "";

  return `
    <div class="card card-auth">
      ${cardHead("Authority Score Trend")}
      <div class="caption-right">${escapeHtml(window)}</div>
      <div class="chart">${chart}</div>
    </div>`;
}

function renderGraphCard(
  domain: string,
  graph: BacklinksReportData["charts"]["networkGraph"],
): string {
  const { nodes, links } = graph.value;
  const drawable = graph.source === "ok" && nodes.length > 1;
  const chart = drawable
    ? renderOrganicNetworkGraph(domain, nodes, links, {
        width: THIRD_W,
        height: GRAPH_H,
        nodeColor: "#c6cbd3",
        highlightColor: COLORS.mint,
        linkColor: "#dcdfe5",
        labelColor: COLORS.accent,
      })
    : noData(THIRD_W, GRAPH_H);

  return `
    <div class="card card-auth">
      ${cardHead("Network Graph")}
      <div class="auth-score">
        ${drawable ? `<span class="badge-mint">Reputable</span>` : ""}
      </div>
      <div class="chart">${chart}</div>
      ${CTA}
    </div>`;
}

/** Both history areas draw in the same translucent periwinkle. They measure
 *  two different things about the same link graph; giving each its own hue
 *  invited a comparison between the two panels that neither supports. */
function renderAreaCard(
  title: string,
  series: BacklinksReportData["charts"]["referringDomainsArea"],
): string {
  const points = series.value.points;
  const drawable =
    series.source === "ok" && points.filter((p) => p.value != null).length >= 2;
  const chart = drawable
    ? renderAreaChart(points, {
        width: HALF_W,
        height: AREA_H,
        stroke: COLORS.accent,
        fill: "rgba(104,104,216,0.18)",
        dateFormat: "monthYear",
      })
    : noData(HALF_W, AREA_H);

  const range = drawable ? shortWindowLabel(points.map((p) => p.date)) : "—";

  return `
    <div class="card card-history">
      ${cardHead(title)}
      <div class="range"><span class="active">${escapeHtml(range)}</span><span>All Time</span></div>
      <div class="chart">${chart}</div>
    </div>`;
}

/** The legend is drawn, always ticked, and pinned to a fixed height: it is a
 *  key, not a control, and nothing about it may move the module. */
const NEW_LOST_LEGEND = `
      <div class="legend">
        <span class="legend-item"><span class="cbox" style="background:${COLORS.accent}">${ICONS.check}</span>New</span>
        <span class="legend-item"><span class="cbox" style="background:${COLORS.coral}">${ICONS.check}</span>Lost</span>
      </div>`;

function renderNewLostCard(
  title: string,
  series: BacklinksReportData["charts"]["referringDomainsBars"],
): string {
  const points = series.value.points;
  const drawable = series.source === "ok" && points.length > 0;
  const chart = drawable
    ? renderDivergingBarChart(points, {
        width: HALF_W,
        height: BARS_H,
        newColor: COLORS.accent,
        lostColor: COLORS.coral,
        grid: COLORS.border,
        muted: COLORS.muted,
        dateFormat: "monthDay",
      })
    : noData(HALF_W, BARS_H);
  const window = drawable
    ? historyWindowLabel(
        points.map((p) => p.date),
        "bars",
      )
    : "";

  return `
    <div class="card card-flow">
      ${cardHead(title)}
      <div class="flow-head">
        ${NEW_LOST_LEGEND}
        <span class="caption">${escapeHtml(window)}</span>
      </div>
      <div class="chart">${chart}</div>
      ${CTA}
    </div>`;
}

/**
 * Categories of Referring Domains.
 *
 * The reference groups these by industry. DataForSEO publishes no industry
 * classification for a referring domain, so the service groups by whatever
 * dimension it actually has (TLD today) and reports which one in
 * `categoriesDimension`. The subtitle names it rather than letting the card
 * title imply a taxonomy we do not have — the visualisation is the part of
 * the reference worth copying, the row labels are its data.
 */
function renderCategoriesCard(
  categories: BacklinksReportData["tables"]["categories"],
  dimension: string,
): string {
  const all = categories.source === "ok" ? categories.value : [];
  const shown = all.slice(0, CATEGORY_ROWS);
  const rows =
    shown.length > 0
      ? renderBarRows(
          shown.map((c: CategoryRow) => ({
            label: c.category,
            share: c.share,
            count: c.count,
            color: COLORS.accent,
            hint: `${c.category} · ${NUMBER_FMT.format(c.count)} referring domains`,
          })),
          "stacked",
        )
      : placeholderBarRows(CATEGORY_ROWS, "stacked");

  const truncated =
    all.length > shown.length ? ` · top ${shown.length} of ${all.length}` : "";

  return `
    <div class="card card-breakdown">
      ${cardHead("Categories of Referring Domains")}
      <div class="card-sub">Grouped by ${escapeHtml(dimension)}${escapeHtml(truncated)}</div>
      <div class="brows">${rows}</div>
      ${CTA}
    </div>`;
}

function renderAnchorsCard(
  anchors: BacklinksReportData["tables"]["topAnchors"],
): string {
  const rows = anchors.source === "ok" ? anchors.value : [];
  const drawable = rows.length > 0;
  const cloud = drawable
    ? renderWordCloud(
        rows.slice(0, ANCHOR_WORDS).map((a: AnchorRow) => ({
          text: a.anchor,
          weight: a.backlinks,
          title: `${a.anchor} — ${NUMBER_FMT.format(a.backlinks)} backlinks from ${NUMBER_FMT.format(a.domains)} domains`,
        })),
        { width: HALF_W, height: CLOUD_H, color: COLORS.accent },
      )
    : noData(HALF_W, CLOUD_H);

  return `
    <div class="card card-breakdown">
      ${cardHead("Top Anchors")}
      <div class="chart chart--cloud">${cloud}</div>
      ${CTA}
    </div>`;
}

/**
 * Referring Domains by Authority Score.
 *
 * The buckets come from the `rank` of the referring domains the service
 * actually pulled, which is a sample and not the whole link graph. The
 * subtitle says so: a distribution built from the highest-ranked slice skews
 * upward, and a reader who can't see the sample size has no way to know.
 */
function renderAuthorityDistributionCard(
  distribution: BacklinksReportData["tables"]["authorityDistribution"],
  sample: number,
): string {
  const buckets = distribution.source === "ok" ? distribution.value : [];
  const maxShare = buckets.reduce(
    (acc: number, b: AuthorityBucketRow) => Math.max(acc, b.share),
    0,
  );
  const rows =
    buckets.length > 0
      ? renderBarRows(
          buckets.map((b: AuthorityBucketRow) => ({
            label: b.range,
            share: b.share,
            count: b.count,
            color: authorityRampColor(b.share, maxShare),
            hint: `Authority ${b.range} · ${NUMBER_FMT.format(b.count)} referring domains`,
          })),
          "inline",
        )
      : placeholderBarRows(AUTHORITY_BUCKET_ROWS, "inline");

  const scope =
    sample > 0
      ? `Based on the top ${NUMBER_FMT.format(sample)} referring domains`
      : "No referring domains sampled";

  return `
    <div class="card card-breakdown">
      ${cardHead("Referring Domains by Authority Score")}
      <div class="card-sub">${escapeHtml(scope)}</div>
      <div class="brows brows--buckets">${rows}</div>
      ${CTA}
    </div>`;
}

/**
 * Backlink Types and Link Attributes, one card with an internal divider.
 *
 * Both lists render the rows DataForSEO returned and nothing else. The
 * reference happens to show Form and Frame for its own domain; adding
 * zero rows to match it would be inventing four measurements.
 */
function renderBreakdownCard(
  types: BacklinksReportData["tables"]["types"],
  attributes: BacklinksReportData["tables"]["attributes"],
): string {
  const typeRows = types.source === "ok" ? types.value : [];
  const attrRows = attributes.source === "ok" ? attributes.value : [];

  const typesHtml =
    typeRows.length > 0
      ? renderBarRows(
          typeRows.map((t: TypeRow) => ({
            label: t.type,
            share: t.share,
            count: t.count,
            color: COLORS.accent,
            hint: `${t.type} · ${NUMBER_FMT.format(t.count)} backlinks`,
          })),
          "inline",
        )
      : placeholderBarRows(BREAKDOWN_ROWS, "inline");

  // Follow is the one row with a semantic reading — a followed link is the
  // one that passes authority — so it takes the mint the rest of the report
  // reserves for a positive.
  const attrsHtml =
    attrRows.length > 0
      ? renderBarRows(
          attrRows.map((a: AttributeRow) => ({
            label: a.attribute,
            share: a.share,
            count: a.count,
            color:
              a.attribute.toLowerCase() === "follow"
                ? COLORS.mint
                : COLORS.accent,
            hint: `${a.attribute} · ${NUMBER_FMT.format(a.count)} backlinks`,
          })),
          "inline",
        )
      : placeholderBarRows(BREAKDOWN_ROWS, "inline");

  return `
    <div class="card card-breakdown">
      ${cardHead("Backlink Types")}
      <div class="brows brows--breakdown">${typesHtml}</div>
      <div class="split"></div>
      ${cardHead("Link Attributes")}
      <div class="brows brows--breakdown">${attrsHtml}</div>
    </div>`;
}

/* ----------------------------- Top level ----------------------------- */

export function renderBacklinksReport({
  domain,
  data,
}: BacklinksTemplateInput): string {
  const t = data.tiles;

  const kpis: Kpi[] = [
    {
      label: "Referring Domains",
      value: fmtCompact(t.referringDomains.value),
      hint:
        t.referringDomains.value == null
          ? "No data for this period"
          : `${fmtNumber(t.referringDomains.value)} referring domains`,
      delta: t.deltas.referringDomains,
    },
    {
      label: "Backlinks",
      value: fmtCompact(t.backlinks.value),
      hint:
        t.backlinks.value == null
          ? "No data for this period"
          : `${fmtNumber(t.backlinks.value)} backlinks`,
      delta: t.deltas.backlinks,
    },
    {
      label: "Monthly Visits",
      value: fmtCompact(t.monthlyVisits.value),
      hint:
        t.monthlyVisits.value == null
          ? "No source reports monthly visits for this domain"
          : `${fmtNumber(t.monthlyVisits.value)} monthly visits`,
    },
    {
      label: "Organic Traffic",
      value: fmtCompact(t.organicTraffic.value),
      hint:
        t.organicTraffic.value == null
          ? "No data for this period"
          : `${fmtNumber(t.organicTraffic.value)} estimated monthly visits`,
    },
    {
      label: "Outbound Domains",
      value: fmtCompact(t.outboundDomains.value),
      hint:
        t.outboundDomains.value == null
          ? "No source reports outbound domains for this domain"
          : `${fmtNumber(t.outboundDomains.value)} outbound domains`,
    },
    {
      label: "Overall Toxicity Score",
      value:
        t.toxicity.value == null
          ? EMPTY_VALUE
          : String(Math.round(t.toxicity.value)),
      hint:
        t.toxicity.value == null
          ? "No data for this period"
          : `Spam score of the target domain, 0-100`,
    },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backlinks · ${escapeHtml(domain)}</title>
<style>
  :root {
    --bg: #f4f5f5;
    --card: #ffffff;
    --text: ${COLORS.ink};
    --muted: ${COLORS.muted};
    --border: ${COLORS.border};
    --control-border: ${COLORS.controlBorder};
    --track: ${COLORS.track};
    --brand: ${COLORS.accent};
    --brand-surface: ${COLORS.lavender};
    --brand-soft: ${COLORS.lavenderWarm};
    --mint: ${COLORS.mint};
    --mint-soft: ${COLORS.mintSoft};
    --coral: ${COLORS.coral};
    --positive: ${COLORS.positive};
    /* Cards carry this double hairline and no border: a 1px outline hardens
       them and turns a soft surface into a boxed table. */
    --card-shadow: rgba(0, 21, 16, 0.07) 0 0 1px 0, rgba(0, 21, 16, 0.07) 0 1px 3px 0;
    --gap: 12px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); padding: 18px;
    font-variant-numeric: tabular-nums;
  }
  .shell { max-width: 1280px; margin: 0 auto; }
  .muted { color: var(--muted); }

  /* ---------- query bar ---------- */
  /* Only as wide as it needs to be; the rest of the row stays empty. */
  .query { display: inline-flex; align-items: stretch; gap: 6px; margin-bottom: 10px; }
  .query-input {
    display: inline-flex; align-items: center; justify-content: space-between;
    gap: 24px; min-width: 320px; height: 32px; padding: 0 10px;
    background: var(--card); border: 1px solid var(--control-border);
    border-radius: 4px; font-size: 13px; color: var(--text);
  }
  .query-clear { color: var(--muted); font-size: 14px; line-height: 1; }
  .query-scope {
    display: inline-flex; align-items: center; gap: 8px; height: 32px;
    padding: 0 10px; background: var(--card); border: 1px solid var(--control-border);
    border-radius: 4px; font-size: 13px; color: var(--text);
  }
  .query-go {
    display: inline-flex; align-items: center; height: 32px; padding: 0 16px;
    background: #16181c; color: #fff; border-radius: 4px;
    font-size: 13px; font-weight: 600;
  }

  /* ---------- page context ---------- */
  .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
  .breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .breadcrumb .current { color: var(--text); }
  .helplinks { display: inline-flex; align-items: center; gap: 16px; }
  .helplink {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12px; color: var(--brand);
  }

  .title-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
  h1 { font-size: 21px; margin: 0; letter-spacing: -0.02em; font-weight: 700; line-height: 1.2; }
  h1 .domain { color: var(--text); }
  h1 .domain svg { vertical-align: -1px; margin-left: 4px; color: var(--brand); }
  .btn-outline {
    display: inline-flex; align-items: center; gap: 6px; height: 30px;
    padding: 0 12px; border-radius: 4px; font-size: 12.5px; font-weight: 500;
    background: var(--card); border: 1px solid var(--control-border);
    color: var(--text); white-space: nowrap;
  }
  .chip-warn {
    display: inline-flex; align-items: center; height: 26px; padding: 0 9px;
    border-radius: 4px; font-size: 12.5px; font-weight: 500;
    background: #fdf8ec; border: 1px solid #f3e0b5; color: #92660a;
  }
  .title-tools { display: inline-flex; align-items: center; gap: 8px; }

  /* ---------- tabs ---------- */
  /* The underline is the width of the active label, not the width of a cell:
     a full-cell rule reads as a segmented control. */
  .tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
  .tab {
    padding: 6px 0 9px; font-size: 13px; font-weight: 500;
    color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tab.active { color: var(--text); font-weight: 600; border-bottom-color: var(--brand); }
  .tab--more { color: var(--muted); display: inline-flex; align-items: center; }

  /* ---------- competitor comparison ---------- */
  /* The two scope labels sit over the two inputs, so both rows share one
     column definition instead of being lined up by eye. */
  .cmp { margin-bottom: var(--gap); }
  .cmp-scopes { display: grid; grid-template-columns: 232px 232px; gap: 10px; margin-bottom: 6px; }
  .cmp-scope { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 500; }
  .cmp-row { display: flex; align-items: center; gap: 10px; }
  .cmp-input {
    display: inline-flex; align-items: center; gap: 8px;
    width: 232px; height: 32px; padding: 0 8px;
    background: var(--card); border: 1px solid var(--control-border);
    border-radius: 4px; font-size: 13px; color: var(--text);
    overflow: hidden; white-space: nowrap;
  }
  .you {
    display: inline-flex; align-items: center; height: 20px; padding: 0 7px;
    border-radius: 3px; background: var(--brand-surface); color: var(--brand);
    font-size: 11.5px; font-weight: 600; flex-shrink: 0;
  }
  .cmp-dot { width: 9px; height: 9px; border-radius: 50%; background: #c9ccd2; flex-shrink: 0; }
  .cmp-go {
    display: inline-flex; align-items: center; height: 32px; padding: 0 16px;
    background: #16181c; color: #fff; border-radius: 4px;
    font-size: 13px; font-weight: 600;
  }
  .cmp-add { font-size: 12.5px; color: var(--brand); font-weight: 500; }

  /* ---------- cards ---------- */
  .card {
    background: var(--card); border: 0; border-radius: 9px; padding: 16px;
    box-shadow: var(--card-shadow);
  }
  .card-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid var(--border);
  }
  .card-head h3 {
    margin: 0; font-size: 14.5px; font-weight: 700;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .card-info { display: inline-flex; color: #b7bcc4; }
  .card-sub { font-size: 11px; color: var(--muted); margin: -6px 0 10px; }
  .caption { font-size: 11.5px; color: var(--muted); }
  .caption-right { font-size: 11.5px; color: var(--muted); text-align: right; height: 16px; }
  .split { height: 1px; background: var(--border); margin: 14px 0; }

  /* ---------- KPI strip ---------- */
  /* One surface, six cells, hairline dividers. Six separate cards is the
     composition this replaces. */
  .kpis {
    display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));
    min-height: 80px; align-items: center; padding: 14px 0; margin-bottom: var(--gap);
  }
  .kpi { padding: 0 16px; min-width: 0; }
  .kpi + .kpi { border-left: 1px solid var(--border); }
  .kpi-label {
    display: flex; align-items: center; gap: 5px;
    font-size: 12.5px; font-weight: 500; color: var(--text);
    margin-bottom: 6px; white-space: nowrap;
  }
  .kpi-info { display: inline-flex; color: #b7bcc4; }
  /* Periwinkle, measured against the reference's own markup — the KPI value
     is the accent colour, not body ink. */
  .kpi-value {
    font-size: 24px; font-weight: 700; letter-spacing: -0.02em;
    line-height: 1.1; color: var(--brand); white-space: nowrap;
  }
  .kpi-value--empty { color: var(--muted); font-weight: 600; }
  .kpi-delta { font-size: 12px; font-weight: 600; margin-left: 5px; letter-spacing: 0; }
  .kpi-delta--up { color: var(--positive); }
  .kpi-delta--down { color: var(--coral); }

  /* ---------- grids ---------- */
  .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gap); margin-bottom: var(--gap); }
  .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap); margin-bottom: var(--gap); }
  .grid-2:last-child, .grid-3:last-child { margin-bottom: 0; }

  /* Min-heights are what hold the page together when a source fails: the
     module keeps its box whether or not anything arrived to fill it. */
  .card-auth { min-height: 300px; display: flex; flex-direction: column; }
  .card-history { min-height: 262px; display: flex; flex-direction: column; }
  .card-flow { min-height: 278px; display: flex; flex-direction: column; }
  .card-breakdown { min-height: 352px; display: flex; flex-direction: column; }

  .chart { display: block; }
  .chart svg { width: 100%; height: auto; display: block; }
  .chart--cloud { flex: 1; }

  /* ---------- authority ---------- */
  .auth-score { display: flex; align-items: center; gap: 10px; min-height: 28px; margin-bottom: 4px; }
  .auth-value { font-size: 25px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .auth-value--empty { color: var(--muted); font-size: 20px; }
  .badge-mint {
    display: inline-flex; align-items: center; height: 21px; padding: 0 9px;
    border-radius: 4px; background: var(--mint-soft); color: #0c6f61;
    font-size: 11.5px; font-weight: 600;
  }

  /* ---------- history controls ---------- */
  .range { display: flex; justify-content: flex-end; gap: 14px; font-size: 12px; color: var(--muted); margin-bottom: 4px; height: 20px; }
  .range .active { color: var(--brand); font-weight: 600; border-bottom: 2px solid var(--brand); padding-bottom: 2px; }

  /* A fixed-height row: the legend is a key drawn in one state, and it is not
     allowed to change the height of the module it labels. */
  .flow-head { display: flex; align-items: center; justify-content: space-between; height: 20px; margin-bottom: 6px; }
  .legend { display: inline-flex; align-items: center; gap: 16px; }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); }
  .cbox {
    display: inline-flex; align-items: center; justify-content: center;
    width: 13px; height: 13px; border-radius: 3px;
  }

  /* ---------- bar rows ---------- */
  .brows { display: flex; flex-direction: column; }
  .brow-track {
    display: block; position: relative; height: 8px; border-radius: 2px;
    background: var(--track); overflow: hidden;
  }
  .brow-fill { display: block; height: 100%; border-radius: 2px; }
  .brow-label { font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .brow-share { font-size: 12.5px; color: var(--muted); text-align: right; }
  .brow-count { font-size: 12.5px; color: var(--brand); font-weight: 500; text-align: right; }

  .brow--stacked { margin-bottom: 18px; }
  .brow--stacked:last-child { margin-bottom: 0; }
  .brow--stacked .brow-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 7px; }
  .brow--stacked .brow-nums { display: inline-flex; align-items: baseline; gap: 10px; }

  /* One grid for every inline list; the label column is the only thing that
     changes between them, so it travels as a custom property. */
  .brow--inline {
    display: grid; grid-template-columns: var(--label-w, 72px) minmax(0, 1fr) 42px 56px;
    align-items: center; column-gap: 10px; height: 26px;
  }
  .brows--buckets { --label-w: 62px; }
  .brows--breakdown { --label-w: 72px; }
  .brows--breakdown .brow--inline { height: 32px; }

  /* ---------- CTA ---------- */
  .btn-dark {
    display: inline-flex; align-items: center; align-self: flex-start;
    height: 28px; padding: 0 12px; margin-top: auto;
    background: #16181c; color: #fff; border-radius: 4px;
    font-size: 12.5px; font-weight: 600;
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

    <div class="topbar">
      <nav class="breadcrumb">
        <span>Home</span><span>›</span><span>SEO</span><span>›</span>
        <span class="current">Backlink Analytics</span>
      </nav>
      <span class="helplinks">
        <span class="helplink">${ICONS.book}User manual</span>
        <span class="helplink">${ICONS.flag}Send feedback</span>
      </span>
    </div>

    <div class="title-row">
      <h1>Backlinks: <span class="domain">${escapeHtml(domain)}${ICONS.external}</span></h1>
      <span class="title-tools">
        ${data.healthy ? "" : `<span class="chip-warn">Partial data</span>`}
        <span class="btn-outline">${ICONS.upload}Export to PDF</span>
      </span>
    </div>

    <!-- The reference carries a context line here (live backlinks found today,
         and the domain's own category). Neither has a source in this report:
         no endpoint reports a same-day backlink count, and no endpoint
         classifies the target domain. The line is omitted rather than filled
         with a number nobody measured. -->

    <div class="tabs">
      <span class="tab active">Overview</span>
      <span class="tab">Backlinks</span>
      <span class="tab">Network Graph</span>
      <span class="tab">Anchors</span>
      <span class="tab">Indexed Pages</span>
      <span class="tab">Outbound Domains</span>
      <span class="tab">Bulk Analysis</span>
      <span class="tab tab--more">${ICONS.dots}</span>
    </div>

    <div class="cmp">
      <div class="cmp-scopes">
        <span class="cmp-scope">Root Domain ${ICONS.chevron}</span>
        <span class="cmp-scope">Root Domain ${ICONS.chevron}</span>
      </div>
      <div class="cmp-row">
        <span class="cmp-input"><span class="you">You</span>${escapeHtml(domain)}</span>
        <span class="cmp-input"><span class="cmp-dot"></span><span class="muted">Add competitor</span></span>
        <span class="cmp-go">Compare</span>
        <span class="cmp-add">+ Add up to 3 competitors</span>
      </div>
    </div>

    ${renderKpiStrip(kpis)}

    <div class="grid-3">
      ${renderAuthorityCard(data.charts.authorityProfile)}
      ${renderTrendCard(data.charts.authorityTrend)}
      ${renderGraphCard(domain, data.charts.networkGraph)}
    </div>

    <div class="grid-2">
      ${renderAreaCard("Referring Domains", data.charts.referringDomainsArea)}
      ${renderAreaCard("Backlinks", data.charts.backlinksArea)}
    </div>

    <div class="grid-2">
      ${renderNewLostCard("New and Lost Referring Domains", data.charts.referringDomainsBars)}
      ${renderNewLostCard("New and Lost Backlinks", data.charts.backlinksBars)}
    </div>

    <div class="grid-2">
      ${renderCategoriesCard(data.tables.categories, data.tables.categoriesDimension)}
      ${renderAnchorsCard(data.tables.topAnchors)}
    </div>

    <div class="grid-2">
      ${renderAuthorityDistributionCard(data.tables.authorityDistribution, data.tables.authorityDistributionSample)}
      ${renderBreakdownCard(data.tables.types, data.tables.attributes)}
    </div>
  </div>
</body>
</html>`;
}
