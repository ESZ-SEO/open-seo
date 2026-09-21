/* eslint-disable max-lines, max-lines-per-function -- Competitors template mirrors the reference's shell + KPI table + 3 cards + opportunities + Venn layout; splitting would fragment the visual section narrative across files. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  CompetitorRow,
  CompetitorsReportData,
  KeywordGapRow,
  VennCounts,
} from "@/server/lib/render/reports/competitors-report";
import { renderVennDiagram } from "@/server/lib/render/charts/charts";

/**
 * Compare Domains template (E2, brought to visual parity 2026-09-21).
 *
 * Self-contained HTML sent to a headless browser for screenshotting. The
 * parity backlog it implements lives in
 * `.dev/designer/semrush-competitors-ui-parity-pack-2026-09-21/`; the design
 * system it adopts is the measured one from `templates/overview.ts`.
 *
 * **The medium is a static PNG.** No JavaScript, no event handlers, no hover,
 * no client state: everything that looks like a control here — the query bar,
 * the market pills, the competitor slots, Compare/Cancel, the Missing|Weak
 * tabs, View details — is markup drawn to look like one. Where the reference
 * has a real toggle, we take a render parameter and draw one state, the same
 * way `searchMode` works in `overview.ts`.
 *
 * Two things the reference does that we deliberately do NOT copy, both for the
 * same reason (never fabricate a number):
 *
 *  - **Trend arrows.** Its ↑/↓ figures are deltas against a history this
 *    pipeline does not have.
 *  - **A competitor-to-competitor intersection count.** The service has no
 *    pairwise call between two competitors, so that Venn lobe renders "≈"
 *    rather than the `0` the bound would print.
 */

const REPORT_TITLES: Record<ReportKind, string> = {
  backlinks: "Backlink Analytics",
  competitors: "Compare Domains",
  overview: "Domain Overview",
  // Present only to satisfy the exhaustive map: this template never renders
  // the keyword report, which has its own (see `templates/keywords.ts`).
  keywords: "Keyword Research",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
};

/** Market pills the header draws, in the reference's own order. */
const MARKET_PILLS = ["US", "UK", "DE"] as const;

/** The reference always shows five competitor slots, filled or not. */
const COMPETITOR_SLOTS = 5;

export type CompetitorsTemplateInput = {
  report: ReportKind;
  domain: string;
  country: string;
  device: string;
  data: CompetitorsReportData;
  /** Flag SVG markup by ISO alpha-2 code, resolved by the caller via
   *  `loadCountryFlags`. Required rather than defaulted, for the same reason
   *  the keyword report requires it: a template that quietly renders no flag
   *  when nobody passes one is how flags go missing. */
  flags: Record<string, string>;
  /** Which opportunities tab is rendered. A render parameter, not state. */
  opportunitiesTab?: "missing" | "weak";
  /** Date shown in the market row. ISO date; defaults to today. */
  reportDate?: string;
};

/**
 * The flag codes this report can draw. Exported so `render-report.ts` loads
 * exactly these and the two cannot drift apart.
 *
 * Note the artwork code for the "UK" label is `GB` — asking for "UK" returns
 * nothing, silently.
 */
export function competitorsFlagCodes(country: string): string[] {
  const codes = new Set<string>(["US", "GB", "DE"]);
  const own = country.trim().toUpperCase();
  if (own.length === 2) codes.add(own === "UK" ? "GB" : own);
  return [...codes];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ----------------------------- formatting ----------------------------- */

const EXACT_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

/**
 * Abbreviated figures, en-US. A nine-digit number at table size is what blows
 * a column's width budget; the exact value rides along in `title`.
 *
 * (That `title` never shows in a PNG — nothing hovers a screenshot. It costs
 * nothing, keeps the markup honest for any future HTML surface, and the
 * abbreviation is what actually matters here.)
 */
function compact(value: number | null): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(value / 1_000)}K`;
  return EXACT_FMT.format(value);
}

function trimZero(value: number): string {
  const s = value.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function exact(value: number | null): string {
  return value == null ? "" : EXACT_FMT.format(value);
}

function money(value: number | null, currency: string): string {
  if (value == null) return "—";
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${compact(value)}`;
}

function percent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}

/** A numeric cell: abbreviated text, exact value in `title`, or an em dash. */
function numCell(value: number | null, text?: string): string {
  if (value == null) return `<td class="num">—</td>`;
  return `<td class="num" title="${exact(value)}">${text ?? compact(value)}</td>`;
}

/* ------------------------------- colours ------------------------------ */

/** Series colours, one per compared domain. Periwinkle for the primary and
 *  mint for the first competitor mirror the measured system; the third is the
 *  amber this report already used for a second competitor. */
const SERIES_COLORS = ["#6868d8", "#14b8a6", "#f59e0b"] as const;

function seriesColor(index: number): string {
  return SERIES_COLORS[Math.min(index, SERIES_COLORS.length - 1)] as string;
}

/* -------------------------------- icons ------------------------------- */

const ICON_GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20a15.3 15.3 0 0 1 0-20"/></svg>`;
const ICON_MONITOR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_EXTERNAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;
const ICON_CLEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

/* ------------------------------- header ------------------------------- */

function flagMarkup(flags: Record<string, string>, code: string): string {
  const svg = flags[code === "UK" ? "GB" : code];
  return svg ? `<span class="flag">${svg}</span>` : "";
}

type HeaderBandInput = {
  title: string;
  domain: string;
  country: string;
  deviceLabel: string;
  flags: Record<string, string>;
  dateLabel: string;
};

function headerBand({
  title,
  domain,
  country,
  deviceLabel,
  flags,
  dateLabel,
}: HeaderBandInput): string {
  const own = country.trim().toUpperCase();
  const pills = MARKET_PILLS.map(
    (code) =>
      `<span class="pill${code === own ? " pill--on" : ""}">${flagMarkup(flags, code)}${code}</span>`,
  ).join("");
  // The report's own market, when it is not already one of the three shown.
  const ownPill =
    own.length === 2 && !(MARKET_PILLS as readonly string[]).includes(own)
      ? `<span class="pill pill--on">${flagMarkup(flags, own)}${escapeHtml(own)}</span>`
      : "";

  return `
  <div class="query-bar">
    <span class="query-input">${escapeHtml(domain)}<span class="query-clear">${ICON_CLEAR}</span></span>
    <span class="query-scope">Root Domain ${ICON_CHEVRON}</span>
    <span class="query-go">Analyze</span>
  </div>
  <nav class="crumbs">Home <span>›</span> SEO <span>›</span> Domain Overview <span>›</span> <b>${escapeHtml(title)}</b></nav>
  <h1>${escapeHtml(title)}: <span class="h1-domain">${escapeHtml(domain)}</span> <span class="h1-ext">${ICON_EXTERNAL}</span></h1>
  <div class="market-row">
    <span class="pill pill--globe">${ICON_GLOBE}Worldwide</span>
    ${ownPill}${pills}
    <span class="pill pill--more">•••</span>
    <span class="filter">${ICON_MONITOR}${escapeHtml(deviceLabel)} ${ICON_CHEVRON}</span>
    <span class="filter">${ICON_CALENDAR}${escapeHtml(dateLabel)} ${ICON_CHEVRON}</span>
    <span class="filter filter--plain">USD</span>
  </div>`;
}

/** The row that names the screen: filled slots, empty slots, Compare/Cancel. */
function competitorRow(domain: string, competitors: string[]): string {
  const filled = [domain, ...competitors].map(
    (d, i) =>
      `<span class="slot slot--on">
         <span class="dot" style="background:${seriesColor(i)}"></span>
         <span class="slot-text">${escapeHtml(truncate(d, 26))}</span>
         <span class="slot-clear">${ICON_CLEAR}</span>
       </span>`,
  );
  const empty = Array.from(
    { length: Math.max(0, COMPETITOR_SLOTS - filled.length) },
    () =>
      `<span class="slot"><span class="dot dot--off"></span><span class="slot-text muted">Add competitor</span></span>`,
  );
  return `
  <div class="compare-labels"><span>Root Domain ${ICON_CHEVRON}</span><span>Root Domain ${ICON_CHEVRON}</span></div>
  <div class="compare-row">
    ${[...filled, ...empty].join("")}
    <span class="btn btn--primary">Compare</span>
    <span class="btn">Cancel</span>
  </div>`;
}

/* ------------------------------ KPI table ----------------------------- */

const KPI_HEADERS = [
  "Authority score",
  "Rank",
  "Org. Traffic",
  "Org. Keywords",
  "Backlinks",
  "Ref. Domains",
  "Paid Keywords",
  "Paid Traffic Cost",
] as const;

function kpiTable(rows: CompetitorRow[], currency: string): string {
  if (rows.length === 0) {
    return `<p class="empty">No data.</p>`;
  }
  const head = `<thead><tr>
      <th>Domain <span class="th-info">${ICON_INFO}</span></th>
      ${KPI_HEADERS.map((h) => `<th class="num">${h}</th>`).join("")}
    </tr></thead>`;
  const body = rows
    .map((row, i) => {
      const tone = seriesColor(i);
      // The tinted row replaces the old PRINCIPAL badge: it says the same
      // thing without spending width in the Domain column.
      const cls = row.role === "primary" ? ' class="row--primary"' : "";
      return `<tr${cls}>
        <td>
          <span class="dot" style="background:${tone}"></span>
          <a class="domain-link">${escapeHtml(row.domain)}</a>
        </td>
        ${numCell(row.authority.value, row.authority.value == null ? undefined : String(row.authority.value))}
        ${numCell(row.rank.value)}
        ${numCell(row.organicTraffic.value)}
        ${numCell(row.organicKeywords.value)}
        ${numCell(row.backlinks.value)}
        ${numCell(row.referringDomains.value)}
        ${numCell(row.paidKeywords.value)}
        ${row.paidTrafficCost.value == null ? `<td class="num">—</td>` : `<td class="num" title="${exact(row.paidTrafficCost.value)}">${money(row.paidTrafficCost.value, currency)}</td>`}
      </tr>`;
    })
    .join("");
  return `<table class="kpi">${head}<tbody>${body}</tbody></table>`;
}

/* -------------------------------- cards ------------------------------- */

/** Small donut, drawn here rather than through `renderDonutChart` because the
 *  reference's is ~70px with its legend outside, and that chart owns its own
 *  legend and centre label. */
function donutSvg(
  slices: Array<{ value: number; color: string }>,
  size = 72,
): string {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = size / 2;
  const stroke = size * 0.26;
  const ring = r - stroke / 2;
  if (total <= 0) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${ring}" fill="none" stroke="#eeeff0" stroke-width="${stroke}"/></svg>`;
  }
  const circumference = 2 * Math.PI * ring;
  let offset = 0;
  const arcs = slices
    .map((s) => {
      const share = Math.max(0, s.value) / total;
      const len = share * circumference;
      const dash = `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`;
      const arc = `<circle cx="${r}" cy="${r}" r="${ring}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${r} ${r})"/>`;
      offset += len;
      return arc;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>`;
}

function trafficShareCard(rows: CompetitorRow[]): string {
  const slices = rows.map((r, i) => ({
    domain: r.domain,
    value: r.organicTraffic.value ?? 0,
    color: seriesColor(i),
  }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return card(
      "Traffic share",
      `<div class="donut-wrap"><div class="empty">No traffic data</div></div>`,
    );
  }
  const legend = slices
    .map(
      (s) =>
        `<li><span class="dot" style="background:${s.color}"></span>
           <span class="legend-name">${escapeHtml(truncate(s.domain, 24))}</span>
           <span class="legend-value">${((s.value / total) * 100).toFixed(1)}%</span>
         </li>`,
    )
    .join("");
  return card(
    "Traffic share",
    `<div class="donut-wrap">
       ${donutSvg(slices)}
       <ul class="legend">${legend}</ul>
     </div>`,
  );
}

/**
 * A percentage bar row: figure, track, figure — both values OUTSIDE the bar.
 * Printing them inside is what made a 4% value illegible on its own fill.
 */
function barRow(
  label: string,
  leftValue: number | null,
  color: string,
): string {
  const left = leftValue ?? null;
  const width = left == null ? 0 : Math.round(left * 100);
  const right = left == null ? null : 1 - left;
  return `<div class="bar-row">
      <span class="bar-label">${escapeHtml(truncate(label, 24))}</span>
      <span class="bar-value">${percent(left)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${width}%;background:${color}"></span></span>
      <span class="bar-value bar-value--right">${percent(right)}</span>
    </div>`;
}

function brandCard(rows: CompetitorRow[]): string {
  // One colour for the whole card, like the reference: the rows are already
  // labelled, and three different fills here would compete with the donut's
  // per-domain colour coding.
  const bars = rows
    .map((r) => barRow(r.domain, r.nonBrandShare.value, "#6868d8"))
    .join("");
  return card(
    "Non-branded / Branded",
    `<div class="bars">${bars || '<div class="empty">No data</div>'}</div>`,
    // Kept deliberately: it is honesty about an approximate figure.
    "Heuristic: a keyword counts as branded when it contains the domain's leftmost label",
  );
}

function paidOrganicCard(rows: CompetitorRow[]): string {
  const bars = rows
    .map((r) => {
      // Both sources gone means we do not know the split — an em dash, not a
      // 0% / 100% that looks like a measured "all organic".
      const known =
        r.paidTrafficCost.value != null || r.organicTraffic.value != null;
      const paid = r.paidTrafficCost.value ?? 0;
      const organic = r.organicTraffic.value ?? 0;
      const total = paid + organic;
      const share = !known ? null : total > 0 ? paid / total : 0;
      return barRow(r.domain, share, "#14b8a6");
    })
    .join("");
  return card(
    "Paid / Organic",
    `<div class="bars">${bars || '<div class="empty">No data</div>'}</div>`,
  );
}

function card(title: string, body: string, foot?: string): string {
  return `<section class="card">
      <h3>${escapeHtml(title)}</h3>
      ${body}
      ${foot ? `<p class="card-foot">${escapeHtml(foot)}</p>` : ""}
    </section>`;
}

/* ---------------------------- opportunities --------------------------- */

function opportunitiesCard(
  missing: KeywordGapRow[],
  weak: KeywordGapRow[],
  tab: "missing" | "weak",
  flags: Record<string, string>,
  country: string,
): string {
  const rows = tab === "missing" ? missing : weak;
  // The tab is already filtered by competitor, so the owning domain rides on a
  // chip above the table instead of costing a column on every row.
  const owner = rows[0]?.ownedBy ?? "";
  const body =
    rows.length === 0
      ? `<tr><td colspan="2" class="empty">No data</td></tr>`
      : rows
          .slice(0, 10)
          .map(
            (r) => `<tr>
              <td><a class="kw-link">${escapeHtml(truncate(r.keyword, 38))}</a></td>
              ${numCell(r.volume, r.volume == null ? undefined : EXACT_FMT.format(r.volume))}
            </tr>`,
          )
          .join("");
  return `<section class="card card--tight">
      <h3>Top Opportunities ${flagMarkup(flags, country.toUpperCase())}<span class="h3-note">${escapeHtml(country.toUpperCase())}</span></h3>
      <div class="segmented">
        <span class="seg${tab === "missing" ? " seg--on" : ""}">Missing</span>
        <span class="seg${tab === "weak" ? " seg--on" : ""}">Weak</span>
      </div>
      <div class="clear"></div>
      ${owner ? `<div class="owner-chip"><span class="dot" style="background:${seriesColor(1)}"></span>${escapeHtml(truncate(owner, 28))}</div>` : ""}
      <table class="gap">
        <thead><tr><th>Keyword</th><th class="num">Volume</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <span class="btn btn--primary btn--block">View details</span>
    </section>`;
}

/* --------------------------------- Venn -------------------------------- */

type OverlapCardInput = {
  rows: CompetitorRow[];
  venn: VennCounts;
  vennFromRealCalls: boolean;
  competitors: string[];
  flags: Record<string, string>;
  country: string;
};

function overlapCard({
  rows,
  venn,
  vennFromRealCalls,
  competitors,
  flags,
  country,
}: OverlapCardInput): string {
  const primary = rows[0]?.domain ?? "";
  const comp1 = competitors[0] ?? "";
  const comp2 = competitors[1] ?? "";

  const sets = [
    {
      label: primary,
      value: venn.primaryOnly + venn.primaryAndComp1 + venn.primaryAndComp2,
      color: seriesColor(0),
    },
    comp1
      ? {
          label: comp1,
          value: venn.comp1Only + venn.primaryAndComp1,
          color: seriesColor(1),
        }
      : null,
    comp2
      ? {
          label: comp2,
          value: venn.comp2Only + venn.primaryAndComp2,
          color: seriesColor(2),
        }
      : null,
  ].filter(
    (s): s is { label: string; value: number; color: string } => s != null,
  );

  const pairs = [
    comp1 ? { left: primary, right: comp1, value: venn.primaryAndComp1 } : null,
    comp2 ? { left: primary, right: comp2, value: venn.primaryAndComp2 } : null,
    // The service has no competitor-to-competitor call, so this lobe is a
    // bound. It renders "≈": a printed 0 would read as measured.
    comp1 && comp2
      ? { left: comp1, right: comp2, value: 0, approximate: true }
      : null,
  ].filter((p): p is NonNullable<typeof p> => p != null);

  const legend = sets
    .map(
      (s, i) =>
        `<li><span class="check" style="background:${seriesColor(i)}"></span>
           <span class="legend-name">${escapeHtml(truncate(s.label, 28))}</span>
           <span class="legend-value">${compact(s.value)}</span></li>`,
    )
    .join("");

  const body =
    competitors.length === 0
      ? `<div class="empty">Add a competitor to compare keyword sets</div>`
      : `<ul class="legend legend--top">${legend}</ul>
         <div class="venn">${renderVennDiagram({
           sets,
           pairs,
           total: vennFromRealCalls
             ? venn.primaryAndComp1 + venn.primaryAndComp2 + venn.comp1Only
             : undefined,
           opts: { width: 780, height: 300 },
         })}</div>`;

  return `<section class="card card--tight">
      <h3>Keyword Overlap ${flagMarkup(flags, country.toUpperCase())}<span class="h3-note">${escapeHtml(country.toUpperCase())}</span></h3>
      ${body}
    </section>`;
}

/* ------------------------------ top-level ------------------------------ */

/** UTC on purpose: `new Date("2026-09-21")` is UTC midnight, and formatting
 *  that in a negative-offset zone prints the 20th. A report date that drifts by
 *  a day depending on where the renderer runs is not a date. */
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function renderCompetitorsReport({
  report,
  domain,
  country,
  device,
  data,
  flags,
  opportunitiesTab = "missing",
  reportDate,
}: CompetitorsTemplateInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;
  const rows = data.rows;
  const competitors = data.input.competitors;
  const currency = "USD";
  const dateLabel = DATE_FMT.format(
    reportDate ? new Date(reportDate) : new Date(),
  );

  const missingRows =
    data.keywordGap.missing.source === "ok"
      ? data.keywordGap.missing.value
      : [];
  const weakRows =
    data.keywordGap.weak.source === "ok" ? data.keywordGap.weak.value : [];
  const venn: VennCounts =
    data.venn.source === "ok"
      ? data.venn.value
      : ({
          primaryOnly: 0,
          comp1Only: 0,
          comp2Only: 0,
          primaryAndComp1: 0,
          primaryAndComp2: 0,
          comp1AndComp2: null,
        } satisfies VennCounts);

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
    --text: #202020;
    --muted: #6b7280;
    --border: #eeeff0;
    /* Darker than --border: the hairline around an interactive control has to
       read as an edge, not as a divider. */
    --control-border: #d6d8dc;
    --brand: #6868d8;
    --filter-blue: #0051ff;
    --accent: #14b8a6;
    /* Sampled from the reference's own primary row and link text. */
    --row-tint: #e1fffa;
    --link: #2397ed;
    /* Cards carry this shadow instead of a border: a 1px border hardens them. */
    --card-shadow: rgba(0, 21, 16, 0.07) 0 0 1px 0, rgba(0, 21, 16, 0.07) 0 1px 3px 0;
    --radius: 10px;
    --gap: 12px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text);
    padding: 16px 18px 20px;
    font-size: 13px;
  }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); font-size: 12px; text-align: center; padding: 18px 0; }

  /* --- query bar --- */
  .query-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .query-input {
    display: inline-flex; align-items: center; justify-content: space-between; gap: 10px;
    min-width: 330px; height: 32px; padding: 0 10px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
  }
  .query-clear { color: var(--muted); display: inline-flex; }
  .query-clear svg { width: 13px; height: 13px; }
  .query-scope {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
  }
  .query-scope svg { width: 12px; height: 12px; color: var(--muted); }
  .query-go {
    display: inline-flex; align-items: center; height: 32px; padding: 0 14px;
    background: #1a1a1a; color: #fff; border-radius: 4px; font-weight: 600; font-size: 12.5px;
  }

  /* --- context --- */
  .crumbs { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .crumbs span { margin: 0 6px; color: #b6bcc2; }
  .crumbs b { color: var(--text); font-weight: 500; }
  h1 { font-size: 21px; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; }
  .h1-domain { color: var(--brand); }
  .h1-ext { display: inline-flex; color: var(--muted); }
  .h1-ext svg { width: 13px; height: 13px; }

  /* --- market row --- */
  .market-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
  .pill {
    display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
    font-size: 12px; color: var(--text);
  }
  .pill--on { background: #e6e9fc; border-color: #c9cef5; }
  .pill--globe svg { width: 13px; height: 13px; color: var(--muted); }
  .pill--more { color: var(--muted); letter-spacing: 1px; padding: 0 7px; }
  .flag { display: inline-flex; width: 15px; height: 11px; overflow: hidden; border-radius: 1px; }
  .flag svg { width: 15px; height: 11px; }
  .filter {
    display: inline-flex; align-items: center; gap: 5px;
    margin-left: 8px; font-size: 12.5px; color: var(--filter-blue);
  }
  .filter svg { width: 13px; height: 13px; }
  .filter--plain { color: var(--text); }

  /* --- competitor row --- */
  .compare-labels { display: flex; gap: 150px; font-size: 12px; color: var(--muted); margin-bottom: 5px; }
  .compare-labels svg { width: 11px; height: 11px; vertical-align: -1px; }
  .compare-row { display: flex; align-items: center; gap: 7px; margin-bottom: 16px; }
  .slot {
    display: inline-flex; align-items: center; gap: 7px; justify-content: space-between;
    height: 32px; padding: 0 9px; flex: 1 1 0; min-width: 0;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
    font-size: 12.5px;
  }
  .slot-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot-clear { color: var(--muted); display: inline-flex; }
  .slot-clear svg { width: 12px; height: 12px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }
  .dot--off { background: #c8ccd0; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
    font-size: 12.5px; font-weight: 500; flex: 0 0 auto;
  }
  .btn--primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-weight: 600; }
  .btn--block { display: flex; margin-top: 10px; align-self: flex-start; }

  /* --- KPI table: on the page, not in a card --- */
  table.kpi { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 16px; background: transparent; }
  table.kpi th {
    text-align: left; font-weight: 400; font-size: 12px; color: var(--muted);
    padding: 8px 10px; border-bottom: 1px solid var(--control-border);
  }
  table.kpi th.num, table.kpi td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.kpi td { padding: 10px; border-bottom: 1px solid var(--border); }
  table.kpi tbody tr { background: var(--card); }
  table.kpi tbody tr.row--primary { background: var(--row-tint); }
  .th-info { display: inline-flex; color: #b6bcc2; vertical-align: -2px; }
  .th-info svg { width: 12px; height: 12px; }
  .domain-link { color: var(--link); margin-left: 7px; }

  /* --- cards --- */
  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); margin-bottom: var(--gap); }
  .card {
    background: var(--card); border-radius: var(--radius); box-shadow: var(--card-shadow);
    padding: 14px 16px;
  }
  .card--tight { padding: 12px 14px; }
  .card h3 {
    margin: 0 0 12px; font-size: 14px; font-weight: 700; color: var(--text);
    display: flex; align-items: center; gap: 6px;
  }
  .h3-note { font-size: 11px; color: var(--muted); font-weight: 500; }
  .card-foot { margin: 10px 0 0; font-size: 11px; color: var(--muted); }

  .donut-wrap { display: flex; align-items: center; gap: 16px; min-height: 86px; }
  .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; flex: 1 1 auto; min-width: 0; }
  .legend li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .legend-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-value { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
  .legend--top { flex-direction: column; margin-bottom: 6px; max-width: 320px; }
  .check { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; }

  .bars { display: flex; flex-direction: column; gap: 10px; min-height: 86px; justify-content: center; }
  .bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .bar-label { width: 116px; flex: 0 0 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-value { width: 34px; flex: 0 0 auto; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .bar-value--right { text-align: left; }
  .bar-track { flex: 1 1 auto; height: 9px; border-radius: 999px; background: #eeeff0; overflow: hidden; }
  .bar-fill { display: block; height: 100%; border-radius: 999px; }

  /* --- bottom row --- */
  .row-bottom { display: grid; grid-template-columns: 28% minmax(0, 1fr); gap: var(--gap); align-items: stretch; }
  .clear { height: 0; }
  .segmented { display: flex; width: max-content; border: 1px solid var(--control-border); border-radius: 4px; overflow: hidden; margin-bottom: 10px; }
  .seg { padding: 4px 12px; font-size: 12px; color: var(--muted); background: var(--card); }
  .seg--on { background: #f1f3fd; color: var(--text); font-weight: 600; box-shadow: inset 0 0 0 1px #c9cef5; }
  .owner-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; margin-bottom: 8px; }
  table.gap { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.gap th { text-align: left; font-weight: 400; font-size: 12px; color: var(--muted); padding: 7px 0; border-bottom: 1px solid var(--border); }
  table.gap th.num, table.gap td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.gap td { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .kw-link { color: var(--link); }
  .venn { display: flex; justify-content: center; align-items: center; }
</style>
</head>
<body>
  ${headerBand({ title, domain, country, deviceLabel, flags, dateLabel })}
  ${competitorRow(domain, competitors)}
  ${data.healthy ? "" : `<p class="muted" style="font-size:12px;margin:0 0 8px;">Partial data — some sources did not answer</p>`}
  ${kpiTable(rows, currency)}
  <div class="row-3">
    ${trafficShareCard(rows)}
    ${brandCard(rows)}
    ${paidOrganicCard(rows)}
  </div>
  <div class="row-bottom">
    ${opportunitiesCard(missingRows, weakRows, opportunitiesTab, flags, country)}
    ${overlapCard({
      rows,
      venn,
      vennFromRealCalls: data.vennFromRealCalls,
      competitors,
      flags,
      country,
    })}
  </div>
</body>
</html>`;
}
