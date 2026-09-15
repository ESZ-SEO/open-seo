/* eslint-disable max-lines, max-lines-per-function -- Keyword research template mirrors the reference composition end to end: header, match-type strip, filter row, topic rail and the nine-column results table. Splitting it fragments one page's narrative across files. */
import {
  TABLE_ROW_LIMIT,
  type KeywordRow,
  type KeywordsReportData,
  type TopicRow,
} from "@/server/lib/render/reports/keywords-report";
import type { KeywordIntent } from "@/types/keywords";

/**
 * Keyword research report template (E5).
 *
 * Self-contained HTML sent to the renderer microservice for screenshotting, on
 * the same brand surface as the other three reports: one inline `<style>`, no
 * external CSS, lucide-style inline SVG icons, country flags as inline SVG.
 * Composition follows the parity backlog in
 * `.dev/designer/keywords-parity-backlog.json`; the design tokens and the
 * formatters are the ones measured for the Domain Overview report and reused
 * verbatim.
 *
 * All rendered copy is in English and every figure is formatted `en-US`.
 *
 * Page regions, top to bottom:
 *
 *   1. Header — seed query bar, breadcrumb, title carrying the seed, and the
 *      database / currency selectors, closed by a hairline rule.
 *   2. Controls — the match-type strip (two segmented groups plus a language
 *      selector), the personalisation input, and the seven filter pills.
 *   3. Workspace, two columns:
 *        - rail: the topic table, an "All" row over the terms the keywords
 *          share most.
 *        - results: the summary bar (counts + actions), the nine-column table,
 *          and the pagination strip.
 *
 * **The template is designed against the reference, not against what any one
 * data source can fill.** All nine columns exist and hold their widths on every
 * render. A row that carries its metrics shows them; a row whose metrics never
 * refreshed collapses SERP Features / Results / Updated into one honest
 * message, exactly as the reference does — see {@link isStale}. That is playbook
 * §3 in one mechanism: honest gap, geometry intact, nothing invented.
 *
 * **Static-render caveat.** The output is a PNG, so nothing here is
 * interactive: the query bar, tabs, filter pills, action buttons and pager are
 * drawn in the state the report was generated for.
 */

const REPORT_TITLE = "Keyword Research";

export type KeywordsTemplateInput = {
  /** The seed the report is about. */
  keyword: string;
  /** ISO alpha-2 of the market the report was run for, for the flag. */
  country: string;
  data: KeywordsReportData;
  /** Flag SVG markup by ISO alpha-2 code, resolved by the caller via
   *  `loadCountryFlags`. Required rather than defaulted: a template that
   *  quietly renders no flag when nobody passes one is how the flags went
   *  missing in the first place. */
  flags: Record<string, string>;
};

/* ----------------------------- Formatters ----------------------------- */

/*
 * Copied from `templates/overview.ts:114-176`, deliberately and verbatim.
 *
 * There is no shared formatting module in this repo: `escapeHtml` lives in all
 * four templates and `fmtCompact` in two, each with its own copy. That is a
 * known papercut with a known extraction point, and extracting it means editing
 * and re-verifying the three shipped reports — a different tanda with its own
 * visual sign-off. Copy and move on.
 *
 * The one thing NOT to do here is reach for the app screen's
 * `formatNumber` / `formatCompactNumber` (`client/features/keywords/utils.ts`):
 * those call `Intl.NumberFormat()` with no locale, so they follow the browser's.
 * In a PNG rendered inside a container that makes the digits depend on where
 * the worker happens to run. Every formatter below pins `en-US`.
 */

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

/**
 * The two gap tokens, and the distinction between them.
 *
 * `n/a` — a source was consulted and came back without the number.
 * `—`   — the cell has a slot but nothing behind it at all.
 *
 * The lowercase `n/a` is deliberate and is NOT a drift from Overview's `N/A`.
 * In this table it is **content replicated from the reference**, which prints
 * it that way in exactly these cells; Overview's uppercase token sits alone in
 * a card. The playbook's convention (`N/A` consulted-but-empty, `—` no source)
 * still governs every gap OUR OWN builder produces. Resist the urge to
 * "unify" the casing — it would make the parity capture stop matching the
 * thing it is compared against (team lead, 2026-09-15).
 */
const EMPTY_VALUE = "n/a";
const NO_SOURCE = "—";

const COMPACT_UNITS = [
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/**
 * `46,774` → `46.8K`. The reference abbreviates in the rail, where the column
 * is ~50px wide; the exact figure survives on the cell's `title`.
 */
function fmtCompact(value: number | null): string {
  if (value == null) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const unit = COMPACT_UNITS.find((u) => abs >= u.at);
  if (unit === undefined) return NUMBER_FMT.format(value);
  const rendered = (value / unit.at).toFixed(1).replace(/\.0$/, "");
  return `${rendered}${unit.suffix}`;
}

/* ----------------------------- Palette ----------------------------- */

/**
 * The report's colour tokens.
 *
 * Identical to the Domain Overview set, deliberately: those values were
 * measured against the real HTML of the reference product rather than read off
 * a screenshot, and this report has no HTML dump of its own to measure. A token
 * re-derived from these pixels would be a guess replacing a measurement
 * (playbook §7).
 *
 * They live in TypeScript rather than only in the `:root` block for the same
 * reason they do there — anything drawn outside CSS needs the literal.
 */
const COLORS = {
  /** Near-black body ink. Text is not blue. */
  ink: "#202020",
  muted: "#6b7280",
  /** Periwinkle. Links, active states, badges — never body copy. */
  accent: "#6868d8",
  /** The market / currency selector values read blue rather than periwinkle in
   *  the reference; this is the same pure blue the other reports use for the
   *  device and date filters. */
  filterBlue: "#0051ff",
  /** Cool lavender: selected controls (tabs, segments). */
  lavender: "#e6e9fc",
  /** Warm lavender: tags and badges sitting on a white card. */
  lavenderWarm: "#eae5fe",
} as const;

/**
 * Keyword-difficulty bands, easiest first.
 *
 * The thresholds are the app's own — `scoreTierClass` in
 * `client/features/keywords/utils.ts` cuts at 20/35/50/65/80 — so the PNG and
 * the screen band a keyword the same way. Only the *decision* is reused: the
 * screen's tiers are daisyUI class names, which do not exist inside this
 * self-contained HTML, so the colours are spelled out here.
 *
 * They agree with the reference's own dots, which is the check that mattered:
 * 13, 15 and 17 green, 39 amber.
 */
const DIFFICULTY_BANDS = [
  { max: 20, color: "#0ea47a" },
  { max: 35, color: "#22c55e" },
  { max: 50, color: "#eab308" },
  { max: 65, color: "#f97316" },
  { max: 80, color: "#ef4444" },
  { max: 100, color: "#b91c1c" },
] as const;

/** Grey, for a row whose difficulty nothing reported — a coloured dot beside a
 *  missing number would read as a judgement nothing made. */
const DIFFICULTY_UNKNOWN_COLOR = "#d6d8dc";

function difficultyColor(value: number | null): string {
  if (value == null) return DIFFICULTY_UNKNOWN_COLOR;
  return (
    DIFFICULTY_BANDS.find((band) => value <= band.max)?.color ??
    DIFFICULTY_BANDS[DIFFICULTY_BANDS.length - 1].color
  );
}

/**
 * Intent badge text, from the app screen's `SHORT_LABELS`
 * (`client/features/keywords/components/IntentBadge.tsx`), so a keyword reads
 * the same in the PNG as on the screen. `unknown` is absent on purpose: the
 * screen renders it as `?`, but a table cell has room to say `n/a`, and a
 * badge for "we don't know" is a badge that looks like a classification.
 */
const INTENT_LABELS: Record<Exclude<KeywordIntent, "unknown">, string> = {
  informational: "Info",
  commercial: "Comm",
  transactional: "Trans",
  navigational: "Nav",
};

/* ----------------------------- Icons ----------------------------- */

const ICONS = {
  chevron: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><path d="M12 2.5 13.8 8 19.5 9.8 13.8 11.6 12 17.1 10.2 11.6 4.5 9.8 10.2 8z"></path><path d="M18.5 15.2 19.4 18l2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9z"></path></svg>`,
  send: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V7a1 1 0 0 1 1-1h11"></path><path d="m13 3 4 3-4 3"></path><path d="M20 15v2a1 1 0 0 1-1 1H8"></path><path d="m11 21-4-3 4-3"></path></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path><path d="M3 21v-5h5"></path></svg>`,
  columns: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16M15 4v16"></path></svg>`,
  upload: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"></path></svg>`,
  sort: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h10M4 17h6"></path></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path></svg>`,
  first: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"></path></svg>`,
} as const;

/**
 * The SERP-feature glyphs.
 *
 * The reference draws 4-6 small marks per row; at its resolution the individual
 * feature types could not be read off with any confidence, so what the fixture
 * records is the COUNT per row — which is what fixes the cell's width — and the
 * artwork is ours. These are generic result-shape marks (video, snippet, image,
 * local, review, sitelinks), not a claim about which feature a row carries: the
 * row's count is the claim, the glyphs draw it.
 */
const SERP_FEATURE_GLYPHS = [
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"></circle><path d="m10 8 6 4-6 4z" fill="currentColor" stroke="none"></path></svg>`,
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 5h16v10H9l-4 4z"></path></svg>`,
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m6 16 4-4 3 3 2-2 3 3"></path></svg>`,
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"></path><circle cx="12" cy="10" r="2.4"></circle></svg>`,
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 4 2.3 4.9 5.2.7-3.8 3.7 1 5.3-4.7-2.6-4.7 2.6 1-5.3L4.5 9.6l5.2-.7z"></path></svg>`,
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6h5M4 12h5M4 18h5M13 6h7M13 12h7M13 18h7"></path></svg>`,
] as const;

function serpFeatureMarks(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => SERP_FEATURE_GLYPHS[i % SERP_FEATURE_GLYPHS.length],
  ).join("");
}

/* ----------------------------- Header ----------------------------- */

/** The market flag, drawn rather than typed: the renderer's Chromium ships no
 *  colour emoji font, so a flag emoji degrades to bare letterforms. A code with
 *  no artwork gets nothing — the label beside it already names the country. */
function flagMarkup(code: string, flags: Record<string, string>): string {
  const flag = flags[code.toUpperCase()];
  return flag === undefined ? "" : `<span class="flag">${flag}</span>`;
}

/**
 * Every ISO code this template can draw a flag for.
 *
 * The caller resolves the artwork and hands it in, so caller and template have
 * to agree on the list; deriving it here is what stops a new flag slot from
 * silently rendering blank.
 */
export function keywordsFlagCodes(country: string): string[] {
  return [country.toUpperCase()];
}

/** The match-type strip: two segmented groups, each with its own selection,
 *  then the language selector. Decorative like every control on a screenshot —
 *  the active tabs describe the request this report actually made. */
const MATCH_TABS = [
  ["All", "Questions"],
  ["All Keywords", "Broad Match", "Phrase Match", "Exact Match", "Related"],
] as const;

function matchTabs(): string {
  return MATCH_TABS.map(
    (group) =>
      `<span class="seg">${group
        .map(
          (label, index) =>
            `<span class="seg-item${index === 0 ? " active" : ""}">${label}</span>`,
        )
        .join("")}</span>`,
  ).join("");
}

/** The filter row. None is marked active: this render applied no filter, and a
 *  highlighted pill would describe a query that never ran. */
function filterPills(currency: string): string {
  const labels = [
    "Volume",
    "KD %",
    "Intent",
    `CPC (${currency})`,
    "Include keywords",
    "Exclude keywords",
    "Advanced filters",
  ];
  return labels
    .map(
      (label) =>
        `<span class="pill">${escapeHtml(label)}${ICONS.chevron}</span>`,
    )
    .join("");
}

/* ----------------------------- Topic rail ----------------------------- */

/** Rows the rail is sized for: the "All" row plus the topic slots. The empty
 *  state is pinned to this height so the card never changes size depending on
 *  whether the request answered. */
const RAIL_ROWS = 20;

function topicTableRows(topics: TopicRow[], total: number | null): string {
  const all = `<tr class="topic-all">
          <td>All</td>
          <td class="num"${total == null ? "" : ` title="${NUMBER_FMT.format(total)}"`}>${fmtCompact(total)}</td>
        </tr>`;
  const rows = topics
    .map(
      (topic) => `<tr>
          <td>${escapeHtml(topic.topic)}</td>
          <td class="num">${fmtCompact(topic.keywords)}</td>
        </tr>`,
    )
    .join("");
  return all + rows;
}

function renderRail(data: KeywordsReportData): string {
  const topics = data.tables.topics.value;
  const body =
    topics.length === 0
      ? `<tr class="is-empty"><td colspan="2" class="muted center">No topics for this seed</td></tr>`
      : topicTableRows(topics, data.summary.keywordCount.value);

  return `
      <aside class="card rail">
        <div class="rail-head">
          <span class="seg">
            <span class="seg-item active">Topics<span class="tag-new">new</span></span>
            <span class="seg-item">Groups</span>
          </span>
        </div>
        <table class="topics">
          <thead><tr><th>Topic</th><th class="num">Keywords</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </aside>`;
}

/* ----------------------------- Results table ----------------------------- */

function intentBadge(intent: KeywordIntent): string {
  if (intent === "unknown") {
    return `<span class="muted">${EMPTY_VALUE}</span>`;
  }
  return `<span class="intent intent--${intent}" title="${intent}">${INTENT_LABELS[intent]}</span>`;
}

function difficultyCell(value: number | null): string {
  const figure =
    value == null
      ? `<span class="muted">${EMPTY_VALUE}</span>`
      : NUMBER_FMT.format(value);
  return `<span class="kd">${figure}<span class="kd-dot" style="background:${difficultyColor(value)}"></span></span>`;
}

/**
 * Whether a row's SERP-side metrics never refreshed.
 *
 * The three columns fed by a SERP crawl — features, result count, crawl age —
 * arrive together or not at all, so one predicate governs all three. When they
 * are missing the reference collapses them into a single message instead of
 * printing three separate blanks, which is both more honest (one gap, one
 * cause) and what keeps the row from reading as three independent failures.
 */
function isStale(row: KeywordRow): boolean {
  return (
    row.serpFeatureCount == null && row.results == null && row.updated == null
  );
}

function keywordRow(row: KeywordRow, staleLabel: string): string {
  // The three SERP-fed cells, or one message spanning them. The wording comes
  // from the caller because it is a claim about WHY they are empty, and only
  // the data layer knows: the reference's rows are awaiting a crawl, ours are
  // out of scope. See `KeywordsReportData.staleLabel`.
  const serpCells = isStale(row)
    ? `<td class="num stale" colspan="3">${escapeHtml(staleLabel)}${ICONS.refresh}</td>`
    : `<td class="num serp">${row.serpFeatureCount == null ? NO_SOURCE : serpFeatureMarks(row.serpFeatureCount)}</td>
          <td class="num">${row.results == null ? NO_SOURCE : NUMBER_FMT.format(row.results)}</td>
          <td class="num updated">${row.updated == null ? NO_SOURCE : `${escapeHtml(row.updated)}${ICONS.refresh}`}</td>`;

  return `<tr>
          <td class="pick"><span class="checkbox"></span></td>
          <td class="kw" title="${escapeHtml(row.keyword)}"><span class="kw-cell"><span class="kw-add">${ICONS.plus}</span><span class="kw-text">${escapeHtml(row.keyword)}</span></span></td>
          <td class="center">${intentBadge(row.intent)}</td>
          <td class="num sorted">${row.relevance == null ? NO_SOURCE : NUMBER_FMT.format(row.relevance)}</td>
          <td class="num">${row.volume == null ? `<span class="muted">${EMPTY_VALUE}</span>` : NUMBER_FMT.format(row.volume)}</td>
          <td class="num">${difficultyCell(row.difficulty)}</td>
          <td class="num">${row.cpc == null ? `<span class="muted">${EMPTY_VALUE}</span>` : MONEY_FMT.format(row.cpc)}</td>
          ${serpCells}
        </tr>`;
}

/** The table's column count — the nine reference columns plus the selection
 *  column that precedes them. */
const TABLE_COLUMNS = 10;

/**
 * The empty body.
 *
 * A one-line "no data" row would collapse the table to ~37px and pull
 * everything under it up the page, which is the one failure the degraded render
 * exists to catch. The height comes from CSS keyed to a FULL table, so an empty
 * report occupies what a full one would.
 */
function emptyTableBody(): string {
  return `<tr class="is-empty"><td colspan="${TABLE_COLUMNS}" class="muted center">No keyword data for this seed</td></tr>`;
}

/* ----------------------------- Summary bar ----------------------------- */

type SummaryMetric = { label: string; value: string };

function summaryMetrics(data: KeywordsReportData): SummaryMetric[] {
  const { keywordCount, totalVolume, averageDifficulty } = data.summary;
  return [
    {
      label: "All keywords",
      value:
        keywordCount.value == null
          ? NO_SOURCE
          : NUMBER_FMT.format(keywordCount.value),
    },
    {
      label: "Total Volume",
      value:
        totalVolume.value == null
          ? NO_SOURCE
          : NUMBER_FMT.format(totalVolume.value),
    },
    {
      label: "Average KD",
      value:
        averageDifficulty.value == null
          ? NO_SOURCE
          : PERCENT_FMT.format(averageDifficulty.value / 100),
    },
  ];
}

/** The actions at the right of the summary bar. A badge is rendered only when
 *  the caller has a figure behind it — a quota counter nothing measured is a
 *  fabricated number wearing a small font. */
const SUMMARY_ACTIONS = [
  { label: "Send keywords", icon: ICONS.send, primary: true },
  { label: "Update metrics", icon: ICONS.refresh, badgeOf: "updateMetrics" },
  { label: "Manage columns", icon: ICONS.columns, badgeOf: "manageColumns" },
  { label: "Export", icon: ICONS.upload },
] as const;

function summaryActions(badges: KeywordsReportData["actionBadges"]): string {
  return SUMMARY_ACTIONS.map((action) => {
    if ("primary" in action) {
      return `<span class="btn-dark">${action.icon}${action.label}</span>`;
    }
    const badge = "badgeOf" in action ? badges[action.badgeOf] : null;
    return `<span class="btn-outline">${action.icon}${action.label}${
      badge == null ? "" : `<span class="btn-badge">${escapeHtml(badge)}</span>`
    }</span>`;
  }).join("");
}

/* ----------------------------- Top-level ----------------------------- */

export function renderKeywordsReport({
  keyword,
  country,
  data,
  flags,
}: KeywordsTemplateInput): string {
  const countryCode = country.toUpperCase();
  const rows = data.tables.keywords.value.slice(0, TABLE_ROW_LIMIT);
  const currency = data.input.currency;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${REPORT_TITLE} · ${escapeHtml(keyword)}</title>
<style>
  :root {
    --bg: #f4f5f5;
    --card: #ffffff;
    --text: ${COLORS.ink};
    --muted: ${COLORS.muted};
    --border: #eeeff0;
    --line: #e8e9ea;
    /* Darker than --border: the hairline around an interactive control, which
       has to read as an edge rather than as a divider. */
    --control-border: #d6d8dc;
    --brand: ${COLORS.accent};
    --filter-blue: ${COLORS.filterBlue};
    --brand-soft: ${COLORS.lavenderWarm};
    --brand-surface: ${COLORS.lavender};
    --card-shadow: rgba(0, 21, 16, 0.07) 0 0 1px 0, rgba(0, 21, 16, 0.07) 0 1px 3px 0;
    --gap: 10px;
/* Row pitch, measured off the reference and normalised to this canvas.

       The reference runs BOTH its results table and its topic rail at a 44px
       pitch on a 1582px canvas; 44 x (1316/1582) = 36.6. One token for both,
       because one measurement covers both. The fraction is deliberate: rounding
       to 36 costs 0.6px a row, which is invisible on one row and 18px of drift
       down a 30-row table.

       The row rules are collapsed, so the rule does NOT add to the pitch:
       measured on a render, cell height and row pitch are the same number.
       (Subtracting the border first is the obvious-looking mistake and lands
       1px short per row.) */
    --row-height: 36.6px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  /* The identity band is full-bleed white in the reference and the workspace
     below it sits on the grey page. Two bands rather than one flat background:
     without the white, the title, market row and tab strip float on grey and
     the page loses the horizon the hairline is drawn against. */
  .topbar { background: var(--card); padding: 18px 18px 0; }
  .page { padding: 12px 18px 18px; }
  .shell { max-width: 1280px; margin: 0 auto; }

  /* ---------- header ---------- */
  .query { display: inline-flex; align-items: stretch; gap: 6px; margin-bottom: 10px; }
  .query-input {
    display: inline-flex; align-items: center; justify-content: space-between;
    gap: 24px; min-width: 340px; height: 30px; padding: 0 10px;
    background: var(--card); border: 1px solid var(--control-border); border-radius: 4px;
    font-size: 13px; color: var(--text);
  }
  .query-clear { color: var(--muted); font-size: 14px; line-height: 1; }
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

  h1 { font-size: 21px; margin: 0 0 6px; letter-spacing: -0.02em; font-weight: 700; line-height: 1.2; }
  /* The seed is the subject, not the heading: the reference renders it in the
     muted ink so the eye lands on what the page is before what it is about. */
  h1 .seed { color: var(--muted); font-weight: 500; }

  .market-row { display: flex; align-items: center; gap: 22px; font-size: 12.5px; }
  .market-label { color: var(--text); margin-right: 5px; }
  .market-value {
    display: inline-flex; align-items: center; gap: 5px;
    color: var(--filter-blue); font-weight: 500;
  }
  .market-value svg { width: 12px; height: 12px; }
  /* Bled past the shell so the rule reaches both page edges, as it does in the
     reference — it separates two bands of the page, not two paragraphs. */
  .rule { height: 1px; background: var(--border); margin: 12px -18px; }

  /* ---------- controls ---------- */
  /* Both tab groups are the same control the other reports use for a segmented
     toggle: one bordered container, hairline dividers between the items, and
     the selected item filled with the cool lavender. */
  .tabs { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; }
  .seg {
    display: inline-flex; align-items: center;
    background: var(--card); border: 1px solid var(--control-border);
    border-radius: 4px; overflow: hidden;
  }
  .seg-item {
    display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 11px;
    font-size: 12.5px; font-weight: 500; color: var(--text); white-space: nowrap;
  }
  .seg-item + .seg-item { border-left: 1px solid var(--control-border); }
  .seg-item.active { background: var(--brand-surface); color: var(--brand); font-weight: 600; }
  .tag-new {
    display: inline-flex; align-items: center; height: 14px; padding: 0 5px;
    border-radius: 7px; background: #16a34a; color: #fff;
    font-size: 9px; font-weight: 700; letter-spacing: 0.02em;
  }
  .select {
    display: inline-flex; align-items: center; gap: 6px; height: 28px;
    padding: 0 10px; border-radius: 4px; font-size: 12.5px; color: var(--muted);
    background: var(--card); border: 1px solid var(--control-border);
  }

  .personalize {
    display: inline-flex; align-items: center; gap: 7px; height: 28px;
    padding: 0 10px; margin-bottom: 10px; border-radius: 4px;
    background: var(--card); border: 1px solid var(--control-border);
    font-size: 12.5px; color: var(--muted); min-width: 280px;
  }
  .personalize svg { color: var(--brand); }

  .filters { display: flex; align-items: center; gap: 8px; margin-bottom: var(--gap); }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; height: 28px;
    padding: 0 10px; border-radius: 4px; font-size: 12.5px; font-weight: 500;
    background: var(--card); border: 1px solid var(--control-border);
    color: var(--text); white-space: nowrap;
  }
  .pill svg { color: var(--muted); }

  /* ---------- cards + workspace ---------- */
  .card {
    background: var(--card); border: 0; border-radius: 10px;
    box-shadow: var(--card-shadow);
  }
  /* Stretch, not start: the reference runs the rail's surface the full height
     of the results beside it. A rail that stops where its rows do leaves a
     column of page background under it and reads as a floating box. */
  .workspace {
    display: grid; grid-template-columns: minmax(216px, 17.5%) minmax(0, 1fr);
    gap: var(--gap); align-items: stretch;
  }

  /* ---------- topic rail ---------- */
  .rail { padding: 12px; }
  .rail-head { margin-bottom: 10px; }
  table.topics { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: fixed; }
  table.topics th {
    text-align: left; font-size: 11px; color: var(--muted); font-weight: 500;
    padding: 0 6px 6px; border-bottom: 1px solid var(--line);
  }
  table.topics th:first-child, table.topics td:first-child { padding-left: 0; }
  table.topics th:last-child, table.topics td:last-child { padding-right: 0; }
  table.topics th:last-child { width: 62px; }
  /* Same 36.6px pitch as the results table, built from padding rather than a
     height because a topic may wrap: 17px line + 1px rule + 2 x 9.3 padding.
     Unlike the results table, which is sized by an explicit height, this one is
     sized by its box, so here the collapsed rule DOES count toward the pitch —
     measured on a render, not assumed. A wrapped two-line topic then measures
     53.6, against the reference own two-line row at 64 x 0.83186 = 53.2. */
  table.topics td {
    padding: 9.3px 6px; border-bottom: 1px solid var(--border);
    line-height: 17px; word-break: break-word;
  }
  table.topics td.num { text-align: right; color: var(--muted); }
  /* The aggregate row reads as the table's own total, not as its first entry. */
  .topic-all td { background: #f7f8f8; font-weight: 600; }
  .topic-all td.num { color: var(--text); }
  table.topics tr.is-empty td { height: calc(${RAIL_ROWS} * var(--row-height)); }

  /* ---------- results card ---------- */
  .results { padding: 12px 14px 14px; min-width: 0; }
  .summary { display: flex; align-items: center; gap: 22px; margin-bottom: 10px; }
  .metric { font-size: 12.5px; color: var(--muted); white-space: nowrap; }
  .metric strong { color: var(--text); font-weight: 700; margin-left: 4px; font-size: 13px; }
  .actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
  .btn-dark {
    display: inline-flex; align-items: center; gap: 6px; height: 28px;
    padding: 0 12px; background: #16181c; color: #fff; border-radius: 4px;
    font-size: 12.5px; font-weight: 600; white-space: nowrap;
  }
  .btn-outline {
    display: inline-flex; align-items: center; gap: 6px; height: 28px;
    padding: 0 12px; border-radius: 4px; font-size: 12.5px; font-weight: 500;
    background: var(--card); border: 1px solid var(--control-border);
    color: var(--text); white-space: nowrap;
  }
  .btn-outline svg { color: var(--muted); }
  .btn-badge {
    display: inline-flex; align-items: center; height: 17px; padding: 0 6px;
    border-radius: 9px; background: #f0f1f2; color: var(--muted);
    font-size: 10.5px; font-weight: 500;
  }

  /* ---------- results table ---------- */
  /* Fixed layout so the keyword column keeps its share of the card instead of
     collapsing to fit nine numeric ones. */
  table.kw { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: fixed; }
  table.kw th {
    text-align: left; font-size: 11.5px; color: var(--muted); font-weight: 500;
    padding: 0 8px 7px; border-bottom: 1px solid var(--line); white-space: nowrap;
  }
  table.kw td {
    height: var(--row-height); padding: 0 8px;
    border-bottom: 1px solid var(--border); color: var(--text);
  }
  table.kw th.num, table.kw td.num { text-align: right; }
  table.kw th.center, table.kw td.center { text-align: center; }
  table.kw th:first-child, table.kw td:first-child { padding-left: 0; }
  table.kw th:last-child, table.kw td:last-child { padding-right: 0; }
  /* Measured off the reference, normalised to our narrower canvas: its column
     edges as a fraction of its own results card (2.2 / 26.4 / 4.8 / 7.2 / 9.7 /
     6.8 / 8.9 / 14.6 / 8.7 / 10.0). Only Intent is widened past what was
     measured — the reference badges an intent with one letter and we spell it
     (Info / Comm / Trans / Nav, the app screen's own abbreviations), so the
     extra is taken from Keyword. That keeps the boundary that actually shows:
     where the numeric block starts. */
  table.kw col.c-pick { width: 2.5%; }
  table.kw col.c-kw { width: 25.5%; }
  table.kw col.c-intent { width: 6%; }
  table.kw col.c-rel { width: 7.2%; }
  table.kw col.c-vol { width: 9.7%; }
  table.kw col.c-kd { width: 6.8%; }
  table.kw col.c-cpc { width: 8.9%; }
  table.kw col.c-serp { width: 14.6%; }
  table.kw col.c-res { width: 8.8%; }
  table.kw col.c-upd { width: 10%; }
  /* The sorted column carries the reference's faint band so the sort marker in
     the header has something to belong to. */
  table.kw th.sorted, table.kw td.sorted { background: #fafafa; }
  table.kw th.sorted { color: var(--text); }
  .sort-mark { display: inline-flex; vertical-align: -2px; margin-left: 4px; color: var(--muted); }
  /* An empty table keeps the height of a full one: without this the page
     shortens by ${TABLE_ROW_LIMIT} rows the moment an endpoint fails. The row
     rules are collapsed, so a full body measures exactly one row height per
     row and the empty one is that product — no per-row border to add back. */
  table.kw tr.is-empty td { height: calc(${TABLE_ROW_LIMIT} * var(--row-height)); }

  .checkbox {
    display: inline-block; width: 13px; height: 13px; vertical-align: -2px;
    border: 1px solid var(--control-border); border-radius: 3px; background: var(--card);
  }
  td.kw { overflow: hidden; }
  /* The cell stays a table-cell so the fixed column widths keep applying; the
     icon and the text are laid out by an inner flex box. A td switched to
     display:flex leaves the table box model and takes its column width with
     it. */
  .kw-cell { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .kw-add { display: inline-flex; flex-shrink: 0; color: var(--muted); }
  .kw-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--brand);
  }
  .intent {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 38px; height: 18px; padding: 0 5px; border-radius: 4px;
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.01em;
  }
  /* Hues follow the app screen's own intent semantics (IntentBadge's COLORS:
     info / warning / success / primary), spelled out because daisyUI classes
     do not exist inside this self-contained HTML. */
  .intent--informational { background: #e3ecfd; color: #1d4ed8; }
  .intent--commercial { background: #fdf1d6; color: #92660a; }
  .intent--transactional { background: #d6f5f0; color: #0f766e; }
  .intent--navigational { background: var(--brand-soft); color: var(--brand); }
  .kd { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .kd-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  /* The SERP marks hang together as one group at the left of their cell, the
     way a list of features reads — not spread against the numeric edge. */
  td.serp { text-align: left; color: var(--muted); }
  td.serp svg { vertical-align: -2px; margin-right: 3px; }
  td.updated { color: var(--text); white-space: nowrap; }
  td.updated svg { color: var(--muted); vertical-align: -2px; margin-left: 5px; }
  /* One message across the three SERP-fed columns: one gap with one cause,
     rather than three blanks that read as three separate failures. */
  td.stale { color: var(--muted); white-space: nowrap; }
  td.stale svg { color: var(--muted); vertical-align: -2px; margin-left: 6px; }

  /* ---------- pagination ---------- */
  .pager {
    display: flex; align-items: center; gap: 8px;
    margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
    font-size: 12.5px;
  }
  .pager-btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 26px; min-width: 32px; padding: 0 10px; border-radius: 4px;
    border: 1px solid var(--control-border); background: var(--card);
    color: var(--muted); font-weight: 500;
  }
  .pager-btn.is-disabled { color: #b7bcc4; }
  .pager-btn.is-primary { background: #16181c; border-color: #16181c; color: #fff; font-weight: 600; }
  .pager-label { margin-left: 6px; color: var(--text); }
  .pager-input {
    display: inline-flex; align-items: center; height: 26px; min-width: 56px;
    padding: 0 8px; border-radius: 4px; background: var(--card);
    border: 1px solid var(--control-border); color: var(--text);
  }
  .pager-total { color: var(--filter-blue); font-weight: 500; }

  /* 3:2 is the aspect the flag SVGs are authored at; the hairline ring keeps
     the white-heavy flags from dissolving into the row. */
  .flag {
    display: inline-block; width: 17px; height: 11px; vertical-align: -1px;
    border-radius: 2px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 12, 8, 0.12);
  }
  .flag svg { display: block; width: 100%; height: 100%; }
  .muted { color: var(--muted); }
  .center { text-align: center; }
</style>
</head>
<body>
  <header class="topbar">
    <div class="shell">
      <div class="query">
        <span class="query-input">${escapeHtml(keyword)}<span class="query-clear">×</span></span>
        <span class="query-go">Analyze</span>
      </div>

      <nav class="breadcrumb">
        <span>Home</span>
        <span>›</span>
        <span>SEO</span>
        <span>›</span>
        <span class="current">${REPORT_TITLE}</span>
      </nav>

      <h1>${REPORT_TITLE}: <span class="seed">${escapeHtml(keyword)}</span></h1>

      <div class="market-row">
        <span><span class="market-label">Database:</span><span class="market-value">${flagMarkup(countryCode, flags)}${escapeHtml(data.input.countryName)} ${ICONS.chevron}</span></span>
        <span><span class="market-label">Currency:</span><span class="market-value">${escapeHtml(currency)} ${ICONS.chevron}</span></span>
      </div>

      <div class="rule"></div>

      <div class="tabs">
        ${matchTabs()}
        <span class="select">Languages ${ICONS.chevron}</span>
      </div>
    </div>
  </header>

  <main class="page">
    <div class="shell">
      <div class="personalize">${ICONS.sparkle}Enter domain for personalized data</div>

      <div class="filters">${filterPills(currency)}</div>

      <div class="workspace">
        ${renderRail(data)}
        <section class="card results">
          <div class="summary">
            ${summaryMetrics(data)
              .map(
                (metric) =>
                  `<span class="metric">${escapeHtml(metric.label)}:<strong>${escapeHtml(metric.value)}</strong></span>`,
              )
              .join("")}
            <span class="actions">${summaryActions(data.actionBadges)}</span>
          </div>

          <table class="kw">
            <colgroup>
              <col class="c-pick"><col class="c-kw"><col class="c-intent"><col class="c-rel"><col class="c-vol">
              <col class="c-kd"><col class="c-cpc"><col class="c-serp"><col class="c-res"><col class="c-upd">
            </colgroup>
            <thead><tr>
              <th><span class="checkbox"></span></th>
              <th>Keyword</th>
              <th class="center">Intent</th>
              <th class="num sorted">Relevance<span class="sort-mark">${ICONS.sort}</span></th>
              <th class="num">Volume</th>
              <th class="num">KD %</th>
              <th class="num">CPC (${escapeHtml(currency)})</th>
              <th class="num">SERP Features</th>
              <th class="num">Results</th>
              <th class="num">Updated</th>
            </tr></thead>
            <tbody>${rows.length === 0 ? emptyTableBody() : rows.map((row) => keywordRow(row, data.staleLabel)).join("")}</tbody>
          </table>

          <div class="pager">
            <span class="pager-btn is-disabled">${ICONS.first}</span>
            <span class="pager-btn is-disabled">Prev</span>
            <span class="pager-btn is-primary">Next</span>
            <span class="pager-label">Page:</span>
            <span class="pager-input">${NUMBER_FMT.format(data.pagination.currentPage)}</span>
            <span class="muted">of</span>
            <span class="pager-total">${NUMBER_FMT.format(data.pagination.totalPages)}</span>
          </div>
        </section>
      </div>
    </div>
  </main>
</body>
</html>`;
}
