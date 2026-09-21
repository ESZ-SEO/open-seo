/* eslint-disable max-lines -- Pure-SVG chart helpers: 7 chart types in one module keeps types co-located and allows the template to import everything from one path. */
import type {
  AnchorRow,
  AttributeRow,
  CategoryRow,
  TypeRow,
  BacklinksGraphLink,
  BacklinksGraphNode,
} from "@/server/lib/render/reports/backlinks-report";

/**
 * Pure SVG chart helpers for the render pipeline.
 *
 * The render pipeline produces a single self-contained HTML document that an
 * external headless browser (Puppeteer/Chromium) screenshots into a PNG.
 * The browser screenshot path does NOT execute JavaScript, so any charting
 * strategy that relies on client-side React mounting (including Recharts'
 * `renderToStaticMarkup`, which returns an empty `recharts-wrapper` div —
 * see `.dev/opencode/tmp/test-recharts.mjs` for the empirical evidence) is
 * unsuitable here.
 *
 * We therefore hand-roll every chart as deterministic SVG strings. The
 * helpers are:
 *   - Pure: same inputs → same output, no random, no time, no Date.now().
 *   - Inline: no external CSS, no JS, no assets.
 *   - Brand-aligned: a small palette that mirrors the templated shell.
 *
 * The trade-off is real authoring cost; the win is that the screenshot
 * matches what the template says, every time, and the bundler stays light.
 */

// Brand palette (close to Semrush's blues/oranges; see spec §2).
const PALETTE = {
  brand: "#1f6feb",
  brandDark: "#0b3d91",
  accent: "#14b8a6",
  warn: "#f59e0b",
  warnSoft: "#fb923c",
  danger: "#ef4444",
  neutral: "#94a3b8",
  series1: "#1f6feb",
  series2: "#14b8a6",
  series3: "#f59e0b",
  series4: "#ef4444",
  text: "#1f2933",
  muted: "#6b7785",
  border: "#e4e9f0",
  cardBg: "#ffffff",
  surface: "#f5f7fa",
  spam: ["#22c55e", "#84cc16", "#f59e0b", "#fb923c", "#ef4444"] as const,
} as const;

const ICON_SIZE = 12;
const PIE_PALETTE = [
  PALETTE.series1,
  PALETTE.series2,
  PALETTE.series3,
  PALETTE.series4,
  PALETTE.brandDark,
  PALETTE.accent,
];

/* ----------------------------- primitives ----------------------------- */

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumberCompact(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatShortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Opt-in x-axis date formats for `renderLineChart`/`renderAreaChart`/
 * `renderDivergingBarChart`. `"short"` is `formatShortDate`'s existing
 * "MM-DD" output, byte-for-byte the same as before this type existed — every
 * caller that doesn't pass `dateFormat` (Competitors included) sees no
 * change. The other two are en-US month names, matching the rest of the
 * report's copy, for callers whose reference draws readable month ticks
 * instead of raw digits.
 */
export type ChartDateFormat = "short" | "monthDay" | "monthYear";

/** "2026-03-09" → "Mar 9". Reads the ISO string's own digits rather than
 *  `new Date(iso)`, so a UTC-midnight ISO date never shifts a day under a
 *  non-UTC timezone — these charts have to stay pure and deterministic. */
function formatMonthDay(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const name = SHORT_MONTH_NAMES[month - 1];
  return name === undefined || Number.isNaN(day) ? iso : `${name} ${day}`;
}

/** "2026-03-09" → "Mar 2026". Same digit-slicing reasoning as
 *  `formatMonthDay`; kept as its own small lookup rather than reusing the
 *  time-series section's `formatMonthLabel` (see that section's header
 *  comment on why it's deliberately kept apart from these charts). */
function formatMonthYear(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const name = SHORT_MONTH_NAMES[month - 1];
  return name === undefined || Number.isNaN(year) ? iso : `${name} ${year}`;
}

function formatChartDate(iso: string, format: ChartDateFormat): string {
  if (format === "monthDay") return formatMonthDay(iso);
  if (format === "monthYear") return formatMonthYear(iso);
  return formatShortDate(iso);
}

function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}

/** Wrap an inner SVG fragment in a sized `<svg>` root. */
function svg(
  width: number,
  height: number,
  inner: string,
  viewBox?: string,
): string {
  const vb = viewBox ?? `0 0 ${width} ${height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vb}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">${inner}</svg>`;
}

/** Empty placeholder that keeps the layout stable. */
export function placeholderSvg(
  message: string,
  opts: { width?: number; height?: number } = {},
): string {
  const width = opts.width ?? 320;
  const height = opts.height ?? 200;
  return svg(
    width,
    height,
    `<rect width="${width}" height="${height}" fill="${PALETTE.surface}" /><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="14" fill="${PALETTE.muted}">${escapeXml(message)}</text>`,
  );
}

/** Approximate text width in px for the given font size — used for axis labels. */
function approxTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

const SERIES_PALETTE = [
  PALETTE.series1,
  PALETTE.series2,
  PALETTE.series3,
  PALETTE.series4,
  PALETTE.brandDark,
  PALETTE.accent,
];

function seriesColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length] ?? PALETTE.brand;
}

/** One horizontal row of swatch + label, laid out left to right from the SVG
 *  origin. Shared by every chart that names its series inside the canvas. */
function renderLegendRow(entries: { label: string; color: string }[]): string {
  let x = 0;
  return entries
    .map((entry) => {
      const row = `<rect x="${x.toFixed(1)}" y="4" width="9" height="9" rx="2" fill="${entry.color}"/><text x="${(x + 14).toFixed(1)}" y="13" font-size="11" fill="${PALETTE.muted}">${escapeXml(entry.label)}</text>`;
      x += approxTextWidth(entry.label, 11) + 30;
      return row;
    })
    .join("");
}

/* ------------------------------ PieChart ------------------------------ */

export type PieDatum = { name: string; value: number };

export function renderPieChart(
  data: PieDatum[],
  opts: { width?: number; height?: number } = {},
): string {
  if (data.length === 0) return placeholderSvg("Sin datos");
  const width = opts.width ?? 320;
  const height = opts.height ?? 240;
  const total = data.reduce((acc, d) => acc + Math.max(0, d.value), 0);
  if (total === 0) return placeholderSvg("Sin datos");

  const cx = width / 2 - 40;
  const cy = height / 2 - 10;
  const innerRadius = 50;
  const outerRadius = 90;

  let acc = 0;
  const slices = data.map((d, i) => {
    const start = acc / total;
    acc += Math.max(0, d.value);
    const end = acc / total;
    const angle0 = start * 2 * Math.PI - Math.PI / 2;
    const angle1 = end * 2 * Math.PI - Math.PI / 2;
    const color = PIE_PALETTE[i % PIE_PALETTE.length];
    const largeArc = end - start > 0.5 ? 1 : 0;
    const x0 = cx + Math.cos(angle0) * outerRadius;
    const y0 = cy + Math.sin(angle0) * outerRadius;
    const x1 = cx + Math.cos(angle1) * outerRadius;
    const y1 = cy + Math.sin(angle1) * outerRadius;
    const xi0 = cx + Math.cos(angle1) * innerRadius;
    const yi0 = cy + Math.sin(angle1) * innerRadius;
    const xi1 = cx + Math.cos(angle0) * innerRadius;
    const yi1 = cy + Math.sin(angle0) * innerRadius;
    const path =
      end - start >= 0.999
        ? `<circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="${color}" stroke="${PALETTE.cardBg}" stroke-width="2"/>`
        : `<path d="M ${x0} ${y0} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${xi1} ${yi1} Z" fill="${color}" stroke="${PALETTE.cardBg}" stroke-width="2"/>`;
    const share = (d.value / total) * 100;
    const labelText = `${d.name} ${share.toFixed(0)}%`;
    // Place the legend dot beside the centre column.
    return { d, color, share, labelText, path };
  });

  const legendX = width - 110;
  const legendY = 20;
  const legendHeight = slices.length * 18;
  const legendItems = slices
    .map(
      (s, i) => `
      <circle cx="${legendX}" cy="${legendY + 9 + i * 18}" r="4" fill="${s.color}" />
      <text x="${legendX + 10}" y="${legendY + 13 + i * 18}" font-size="11" fill="${PALETTE.text}">${escapeXml(truncate(s.labelText, 18))}</text>`,
    )
    .join("");

  const sliceMarkup = slices.map((s) => s.path).join("");

  // Hollow centre label.
  const centreLabel = `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="11" fill="${PALETTE.muted}">Total</text>
<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="16" font-weight="700" fill="${PALETTE.text}">${formatNumberCompact(total)}</text>`;

  return svg(
    width,
    height,
    `${sliceMarkup}${centreLabel}<rect x="${legendX - 8}" y="${legendY}" width="100" height="${legendHeight + 12}" fill="${PALETTE.surface}" rx="6" ry="6" />${legendItems}`,
  );
}

/* ----------------------------- RadarChart ----------------------------- */

export type RadarAxis = { label: string; value: number };

export function renderRadarChart(
  data: RadarAxis[],
  opts: { width?: number; height?: number } = {},
): string {
  if (data.length === 0) return placeholderSvg("Sin datos");
  const width = opts.width ?? 320;
  const height = opts.height ?? 280;
  const cx = width / 2;
  const cy = height / 2 + 8;
  const radius = Math.min(width, height) / 2 - 50;
  const levels = 5;
  const angleStep = (2 * Math.PI) / data.length;

  const gridLines: string[] = [];
  const axisLabels: string[] = [];
  for (let i = 1; i <= levels; i++) {
    const r = (radius * i) / levels;
    const points = data
      .map((_, idx) => {
        const angle = idx * angleStep - Math.PI / 2;
        return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
      })
      .join(" ");
    gridLines.push(
      `<polygon points="${points}" fill="none" stroke="${PALETTE.border}" stroke-width="1" />`,
    );
  }

  // Axis spokes + labels.
  data.forEach((axis, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    gridLines.push(
      `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${PALETTE.border}" stroke-width="1" />`,
    );
    const labelX = cx + Math.cos(angle) * (radius + 18);
    const labelY = cy + Math.sin(angle) * (radius + 18);
    const anchor =
      Math.abs(Math.cos(angle)) < 0.3
        ? "middle"
        : Math.cos(angle) > 0
          ? "start"
          : "end";
    axisLabels.push(
      `<text x="${labelX}" y="${labelY + 4}" text-anchor="${anchor}" font-size="11" fill="${PALETTE.text}">${escapeXml(axis.label)}</text>`,
    );
  });

  // Filled polygon from values.
  const polygonPoints = data
    .map((axis, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = (Math.max(0, Math.min(100, axis.value)) / 100) * radius;
      return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
    })
    .join(" ");
  const polygonMarkup = `<polygon points="${polygonPoints}" fill="${PALETTE.series1}" fill-opacity="0.35" stroke="${PALETTE.series1}" stroke-width="2" />`;
  const dots = data
    .map((axis, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = (Math.max(0, Math.min(100, axis.value)) / 100) * radius;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      return `<circle cx="${x}" cy="${y}" r="3" fill="${PALETTE.series1}" stroke="${PALETTE.cardBg}" stroke-width="1.5"/>`;
    })
    .join("");

  return svg(
    width,
    height,
    `${gridLines.join("")}${polygonMarkup}${dots}${axisLabels.join("")}`,
  );
}

/* ----------------------------- LineChart ------------------------------ */

export type AreaPoint = { date: string; value: number | null };
export type BarTuplePoint = { date: string; new: number; lost: number };

type ChartAxes = {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  innerW: number;
  innerH: number;
};

function chartAxes(width: number, height: number): ChartAxes {
  const paddingLeft = 48;
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 28;
  return {
    width,
    height,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingBottom,
    innerW: width - paddingLeft - paddingRight,
    innerH: height - paddingTop - paddingBottom,
  };
}

function rangeFor(values: number[]): [number, number] {
  const max = values.length === 0 ? 1 : Math.max(...values, 1);
  const min = values.length === 0 ? 0 : Math.min(...values, 0);
  // Add 10% padding above and below.
  const span = max - min || 1;
  return [Math.max(0, min - span * 0.1), max + span * 0.1];
}

function formatYValue(value: number, range: [number, number]): string {
  const span = range[1] - range[0];
  if (span >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (span >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toString();
}

function renderYAxisTicks(
  axes: ChartAxes,
  range: [number, number],
  count: number,
): string {
  const ticks: string[] = [];
  for (let i = 0; i <= count; i++) {
    const v = range[0] + ((range[1] - range[0]) * i) / count;
    const y = axes.paddingTop + axes.innerH - (axes.innerH * i) / count;
    ticks.push(
      `<line x1="${axes.paddingLeft}" y1="${y.toFixed(1)}" x2="${axes.width - axes.paddingRight}" y2="${y.toFixed(1)}" stroke="${PALETTE.border}" stroke-dasharray="2 3" stroke-width="1"/>`,
    );
    ticks.push(
      `<text x="${axes.paddingLeft - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${PALETTE.muted}">${formatYValue(v, range)}</text>`,
    );
  }
  return ticks.join("");
}

function pickXTicks(
  values: AreaPoint[] | BarTuplePoint[],
  step: number,
): number[] {
  if (values.length <= 5) return values.map((_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += step) out.push(i);
  if (out[out.length - 1] !== values.length - 1) out.push(values.length - 1);
  return out;
}

type XTickCandidate = { x: number; label: string };

/**
 * Shared x-axis tick renderer for the `chartAxes`-family time charts
 * (`renderLineChart` / `renderAreaChart` / `renderDivergingBarChart` — the
 * `timeAxes`-family charts have their own `renderTimeXTicks` and are
 * deliberately kept apart, see that section's header comment). A naive
 * "one `<text>` per candidate index, all anchored middle" loop develops
 * three real defects once a series has enough points that ticks get dense
 * (a capture with 13 weekly samples under `monthYear`, or ~26 biweekly bars,
 * both caught this in review):
 *
 *  - A coarse `dateFormat` collapses several neighbouring samples onto the
 *    same label ("Jun 2026 Jun 2026 Jul 2026 …"), which reads as a rendering
 *    bug rather than a granularity choice. Consecutive duplicates are
 *    dropped by comparing each tick to the one right before it — but the
 *    first and last tick are always force-kept regardless, which can leave
 *    the force-kept last tick sitting right next to an earlier tick the pass
 *    already judged "genuinely different from its own predecessor" and thus
 *    kept. That specific boundary case is caught by the same neighbour-drop
 *    described two bullets down.
 *  - `text-anchor="middle"` on the last tick draws half its glyphs past the
 *    right edge of the viewBox (a chart ending "Sep 2026" renders as "Sep
 *    202", clipped). The first and last ticks anchor `start`/`end`
 *    respectively — each is the one glyph run that can safely grow inward —
 *    clamped to the plot's own edges; every tick in between stays `middle`.
 *  - An evenly-spaced stride plus a forced-last-index tick can still land two
 *    labels closer together than either one is wide, so they overlap into
 *    each other ("Aug 3Sep 7") — or, per the first bullet, land the same
 *    label right next to itself. Either way, when the (now anchor-aware)
 *    last tick and its neighbour physically overlap *or* repeat the same
 *    text, the neighbour — not the last tick — is dropped: the last tick is
 *    "now" and is the one callers actually need.
 */
function renderChartXTicks(
  candidates: XTickCandidate[],
  y: number,
  bounds: { left: number; right: number },
  muted: string,
): string {
  if (candidates.length === 0) return "";

  const deduped = candidates.filter((c, i) => {
    if (i === 0 || i === candidates.length - 1) return true;
    return c.label !== candidates[i - 1]?.label;
  });

  // The last tick is always force-kept (above) even when its label matches
  // the tick right before it — the dedup pass only ever compares a tick to
  // its immediate original neighbour, so a forced-kept last tick can still
  // sit right next to an earlier tick the pass already decided was
  // genuinely different from *its* predecessor. Drop that neighbour too,
  // for the same reason a physically-overlapping one gets dropped below.
  let ticks = deduped;
  const last = deduped[deduped.length - 1];
  const prev = deduped[deduped.length - 2];
  if (deduped.length >= 2 && last && prev) {
    const labelWidth = Math.max(
      approxTextWidth(prev.label, 10),
      approxTextWidth(last.label, 10),
    );
    const overlapsPhysically = last.x - prev.x < labelWidth;
    const repeatsLabel = prev.label === last.label;
    if (overlapsPhysically || repeatsLabel) {
      ticks = [...deduped.slice(0, -2), last];
    }
  }

  return ticks
    .map((tick, i) => {
      const isFirst = i === 0;
      const isLast = i === ticks.length - 1;
      const anchor =
        ticks.length === 1
          ? "middle"
          : isFirst
            ? "start"
            : isLast
              ? "end"
              : "middle";
      const x =
        ticks.length === 1
          ? tick.x
          : isFirst
            ? Math.max(tick.x, bounds.left)
            : isLast
              ? Math.min(tick.x, bounds.right)
              : tick.x;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${muted}">${escapeXml(tick.label)}</text>`;
    })
    .join("");
}

export function renderLineChart(
  points: AreaPoint[],
  opts: {
    width?: number;
    height?: number;
    color?: string;
    /**
     * Fixed axis bounds, for metrics with a known natural range (e.g. a 0–100
     * score). Without it, a near-flat series over-zooms into its own noise:
     * `rangeFor`'s 10%-padded auto domain on a 73–75 series is [72.8, 75.2],
     * which rounds five gridline labels down to "73, 73, 74, 75, 75" and
     * draws a flat line as if it filled the whole plot.
     */
    domain?: [number, number];
    /** @see {@link ChartDateFormat} — defaults to "short" (unchanged output). */
    dateFormat?: ChartDateFormat;
  } = {},
): string {
  if (points.length === 0) return placeholderSvg("Sin histórico");
  const width = opts.width ?? 480;
  const height = opts.height ?? 200;
  const color = opts.color ?? PALETTE.series1;
  const dateFormat = opts.dateFormat ?? "short";
  const axes = chartAxes(width, height);
  const values = points.map((p) => (p.value == null ? 0 : p.value));
  const domain = opts.domain ?? rangeFor(values);
  const dx = axes.innerW / Math.max(1, points.length - 1);

  const grid = renderYAxisTicks(axes, domain, 4);
  const strokePath = points
    .map((p, i) => {
      const v = p.value == null ? 0 : p.value;
      const x = axes.paddingLeft + i * dx;
      const t = (v - domain[0]) / (domain[1] - domain[0] || 1);
      const y = axes.paddingTop + axes.innerH - axes.innerH * t;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  // Mark null data with a transparent gap (draw an isolated marker).
  const nullMarkers = points
    .filter((p) => p.value == null)
    .map((p) => {
      const idx = points.indexOf(p);
      const x = axes.paddingLeft + idx * dx;
      const y = axes.paddingTop + axes.innerH;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${PALETTE.muted}" opacity="0.5"/>`;
    })
    .join("");

  // X axis ticks — sparse.
  const step = Math.max(1, Math.floor(points.length / 6));
  const tickIndices = pickXTicks(points, step);
  const xTicks = renderChartXTicks(
    tickIndices.map((idx) => ({
      x: axes.paddingLeft + idx * dx,
      label: formatChartDate(points[idx].date, dateFormat),
    })),
    axes.paddingTop + axes.innerH + 16,
    { left: axes.paddingLeft, right: width - axes.paddingRight },
    PALETTE.muted,
  );

  const line = `<path d="${strokePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dots = points
    .map((p, i) => {
      if (p.value == null) return "";
      const v = p.value;
      const x = axes.paddingLeft + i * dx;
      const t = (v - domain[0]) / (domain[1] - domain[0] || 1);
      const y = axes.paddingTop + axes.innerH - axes.innerH * t;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}" stroke="${PALETTE.cardBg}" stroke-width="1"/>`;
    })
    .join("");

  return svg(width, height, `${grid}${line}${dots}${nullMarkers}${xTicks}`);
}

/* ----------------------------- AreaChart ------------------------------ */

export function renderAreaChart(
  points: AreaPoint[],
  opts: {
    width?: number;
    height?: number;
    stroke?: string;
    fill?: string;
    /** @see {@link ChartDateFormat} — defaults to "short" (unchanged output). */
    dateFormat?: ChartDateFormat;
  } = {},
): string {
  if (points.length === 0) return placeholderSvg("Sin histórico");
  const width = opts.width ?? 480;
  const height = opts.height ?? 200;
  const stroke = opts.stroke ?? PALETTE.series1;
  const fill = opts.fill ?? `${PALETTE.series1}33`;
  const dateFormat = opts.dateFormat ?? "short";
  const axes = chartAxes(width, height);
  const values = points.map((p) => (p.value == null ? 0 : p.value));
  const domain = rangeFor(values);
  const dx = axes.innerW / Math.max(1, points.length - 1);

  const grid = renderYAxisTicks(axes, domain, 4);
  const topPath = points
    .map((p, i) => {
      const v = p.value == null ? 0 : p.value;
      const x = axes.paddingLeft + i * dx;
      const t = (v - domain[0]) / (domain[1] - domain[0] || 1);
      const y = axes.paddingTop + axes.innerH - axes.innerH * t;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const baseY = axes.paddingTop + axes.innerH;
  const lastX = axes.paddingLeft + (points.length - 1) * dx;
  const areaPath = `${topPath} L ${lastX.toFixed(1)} ${baseY} L ${axes.paddingLeft} ${baseY} Z`;

  const step = Math.max(1, Math.floor(points.length / 6));
  const tickIndices = pickXTicks(points, step);
  const xTicks = renderChartXTicks(
    tickIndices.map((idx) => ({
      x: axes.paddingLeft + idx * dx,
      label: formatChartDate(points[idx].date, dateFormat),
    })),
    axes.paddingTop + axes.innerH + 16,
    { left: axes.paddingLeft, right: width - axes.paddingRight },
    PALETTE.muted,
  );

  const line = `<path d="${topPath}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const area = `<path d="${areaPath}" fill="${fill}" stroke="none"/>`;

  return svg(width, height, `${grid}${area}${line}${xTicks}`);
}

/* ----------------------------- BarChart ------------------------------- */

export function renderBarPairChart(
  points: BarTuplePoint[],
  opts: { width?: number; height?: number; label?: string } = {},
): string {
  if (points.length === 0) return placeholderSvg("Sin histórico");
  const width = opts.width ?? 480;
  const height = opts.height ?? 200;
  const axes = chartAxes(width, height);
  const maxValue = Math.max(...points.map((p) => Math.max(p.new, p.lost)), 1);
  const domain: [number, number] = [0, maxValue * 1.1];
  const groupWidth = axes.innerW / points.length;
  const barWidth = Math.max(2, (groupWidth - 4) / 2);
  const dx = axes.innerW / Math.max(1, points.length - 1);

  const grid = renderYAxisTicks(axes, domain, 4);
  const bars: string[] = [];
  points.forEach((p, i) => {
    const groupX = axes.paddingLeft + i * groupWidth;
    const tNew = p.new / (domain[1] - domain[0] || 1);
    const tLost = p.lost / (domain[1] - domain[0] || 1);
    const newY = axes.paddingTop + axes.innerH - axes.innerH * tNew;
    const lostY = axes.paddingTop + axes.innerH - axes.innerH * tLost;
    bars.push(
      `<rect x="${(groupX + 1).toFixed(1)}" y="${newY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(axes.innerH * tNew).toFixed(1)}" rx="2" ry="2" fill="${PALETTE.series2}"/>`,
    );
    bars.push(
      `<rect x="${(groupX + 1 + barWidth + 1).toFixed(1)}" y="${lostY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(axes.innerH * tLost).toFixed(1)}" rx="2" ry="2" fill="${PALETTE.danger}"/>`,
    );
  });

  // Legend.
  const legendY = 6;
  const legendMarkup = `
    <rect x="${axes.paddingLeft}" y="${legendY}" width="9" height="9" rx="2" fill="${PALETTE.series2}" />
    <text x="${axes.paddingLeft + 14}" y="${legendY + 8}" font-size="10" fill="${PALETTE.muted}">Nuevos</text>
    <rect x="${axes.paddingLeft + 60}" y="${legendY}" width="9" height="9" rx="2" fill="${PALETTE.danger}" />
    <text x="${axes.paddingLeft + 74}" y="${legendY + 8}" font-size="10" fill="${PALETTE.muted}">Perdidos</text>`;

  const step = Math.max(1, Math.floor(points.length / 6));
  const tickIndices = pickXTicks(points, step);
  const xTicks = tickIndices
    .map((idx) => {
      const x = axes.paddingLeft + idx * dx;
      const formatted = formatShortDate(points[idx].date);
      return `<text x="${x.toFixed(1)}" y="${(axes.paddingTop + axes.innerH + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${PALETTE.muted}">${escapeXml(formatted)}</text>`;
    })
    .join("");

  return svg(width, height, `${grid}${bars.join("")}${legendMarkup}${xTicks}`);
}

/* ------------------------------ StackedBar ------------------------------ */

/**
 * A single full-width horizontal stacked bar with the legend above it. Used
 * by the Domain Overview (E3) report for the ranked-keyword bucket
 * distribution (`KEYWORD_BUCKETS` in `overview-report.ts`: Top 3 / 4–10 /
 * 11–20 / 21–50 / 51–100 / 101+).
 *
 * The data is a proportion at one moment in time, not a series, so the bar
 * carries no axes and no grid: a lone vertical column with a y-axis inside a
 * wide card reads as a broken time series (design review finding F), whereas
 * a full-width bar reads as what it is — a share of the sampled keywords.
 *
 * Visual contract:
 *  - Bar spans the full `width` at `STACKED_BAR_HEIGHT`; the SVG's own height
 *    is derived, so the caller only picks the width.
 *  - Falls back to `placeholderSvg("Sin datos")` when every segment is zero.
 *  - Optional per-segment colour override; otherwise a small brand palette
 *    keyed by series index.
 *  - Legend above the bar, one entry per segment: `label` + value.
 */
export type StackedBarSegment = {
  label: string;
  value: number;
  color?: string;
};

const STACKED_BAR_HEIGHT = 24;
const STACKED_BAR_TOP = 30;
const STACKED_BAR_CLIP_ID = "stacked-bar-clip";

export function renderStackedBar(
  segments: StackedBarSegment[],
  opts: { width?: number } = {},
): string {
  const width = opts.width ?? 480;
  const total = segments.reduce((acc, seg) => acc + Math.max(0, seg.value), 0);
  if (total === 0) {
    return placeholderSvg("Sin datos", {
      width,
      height: STACKED_BAR_TOP + STACKED_BAR_HEIGHT,
    });
  }

  const colorAt = (seg: StackedBarSegment, i: number) =>
    seg.color ?? seriesColor(i);

  const legend = renderLegendRow(
    segments.map((seg, i) => ({
      label: `${seg.label} ${Math.round(seg.value)}`,
      color: colorAt(seg, i),
    })),
  );

  // A 1px white sliver between segments keeps adjacent colours readable; the
  // clip path rounds only the two outer ends, so the bar reads as one bar.
  let x = 0;
  const bars = segments
    .map((seg, i) => {
      const segWidth = (Math.max(0, seg.value) / total) * width;
      const rect = `<rect x="${x.toFixed(1)}" y="${STACKED_BAR_TOP}" width="${Math.max(0, segWidth - 1).toFixed(1)}" height="${STACKED_BAR_HEIGHT}" fill="${colorAt(seg, i)}"/>`;
      x += segWidth;
      return rect;
    })
    .join("");

  return svg(
    width,
    STACKED_BAR_TOP + STACKED_BAR_HEIGHT,
    `<defs><clipPath id="${STACKED_BAR_CLIP_ID}"><rect x="0" y="${STACKED_BAR_TOP}" width="${width}" height="${STACKED_BAR_HEIGHT}" rx="4"/></clipPath></defs>` +
      `${legend}<g clip-path="url(#${STACKED_BAR_CLIP_ID})">${bars}</g>`,
  );
}

/* --------------------------- Time series charts --------------------------- */

/**
 * `renderStackedAreaChart` and `renderMultiLineChart` are the two charts the
 * Semrush 2026 Domain Overview draws over a date range (reference capture:
 * `.dev/designer/Captura de pantalla 2026-09-04 082346.png`) — "Keywords" as
 * stacked bands per rank bucket, "Traffic" as one thin line per traffic type.
 * They share a frame that differs from `chartAxes`' on three counts, all
 * measured off that capture: the value axis sits on the **right** of the plot
 * area, the grid is a hairline rather than a dashed rule, and the curves are
 * smoothed instead of a polyline.
 *
 * They are deliberately kept apart from `renderLineChart`/`renderAreaChart`,
 * which the backlinks report uses with a left-hand axis and point markers:
 * restyling those in place would silently redraw a report this work has no
 * reference for.
 *
 * Both are wired into `templates/overview.ts`, fed by the monthly series
 * `getHistoricalSeries` reads from Labs `historical_rank_overview`. Neither
 * renders unless that series has real samples: the template gates them and
 * falls back to its own copy, so a short history degrades honestly instead of
 * drawing a line through nothing.
 */
export type TimeSeries = {
  label: string;
  points: AreaPoint[];
  color?: string;
};

const TIME_AXIS_PADDING = {
  left: 4,
  right: 52,
  /** Room for the legend row above the plot. */
  top: 30,
  bottom: 26,
} as const;

function timeAxes(width: number, height: number): ChartAxes {
  return {
    width,
    height,
    paddingLeft: TIME_AXIS_PADDING.left,
    paddingRight: TIME_AXIS_PADDING.right,
    paddingTop: TIME_AXIS_PADDING.top,
    paddingBottom: TIME_AXIS_PADDING.bottom,
    innerW: width - TIME_AXIS_PADDING.left - TIME_AXIS_PADDING.right,
    innerH: height - TIME_AXIS_PADDING.top - TIME_AXIS_PADDING.bottom,
  };
}

const Y_TICK_COUNT = 4;

/**
 * Tick steps a reader can add up in their head, ordered so the first one that
 * clears the data is the one used.
 *
 * The gaps matter as much as the values: the axis top is `step × ticks`, so a
 * series peaking just above a rung is drawn against the *next* rung, and the
 * ratio between neighbours is the worst-case share of the plot the data can
 * end up occupying. The old ladder jumped 2.5 → 5, which let a chart use half
 * its own height (a 4.6M peak drew against a 6M axis, sitting in the bottom
 * three quarters of the plot). No gap here is wider than 4:3, and every rung
 * still divides into labels of one decimal place at most.
 */
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10] as const;

/** Axis top rounded up so the labels land on round numbers — the reference's
 *  axis reads 0 / 500K / 1M / 1.5M / 2M, not 0 / 431.2K / 862.4K. Picks a nice
 *  step first and multiplies back up, because a nice *maximum* alone still
 *  divides into ugly intermediate ticks. */
function niceAxisTop(max: number): number {
  if (max <= 0) return 1;
  const rawStep = max / Y_TICK_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (NICE_STEPS.find((s) => normalized <= s) ?? 10) * magnitude;
  return step * Y_TICK_COUNT;
}

/** Grid + value labels down the right edge, the way the reference draws them. */
function renderRightYAxis(axes: ChartAxes, range: [number, number]): string {
  const rows: string[] = [];
  for (let i = 0; i <= Y_TICK_COUNT; i++) {
    const v = range[0] + ((range[1] - range[0]) * i) / Y_TICK_COUNT;
    const y = axes.paddingTop + axes.innerH - (axes.innerH * i) / Y_TICK_COUNT;
    // `formatYValue` keeps one decimal always — "0.0K" for the baseline and
    // "2.0M" where the reference reads "2M". Round ticks earned their round
    // labels.
    const label = v === 0 ? "0" : formatYValue(v, range).replace(".0", "");
    rows.push(
      `<line x1="${axes.paddingLeft}" y1="${y.toFixed(1)}" x2="${axes.width - axes.paddingRight}" y2="${y.toFixed(1)}" stroke="${PALETTE.border}" stroke-width="1"/>`,
      `<text x="${axes.width - axes.paddingRight + 8}" y="${(y + 3).toFixed(1)}" font-size="10" fill="${PALETTE.muted}">${label}</text>`,
    );
  }
  return rows.join("");
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2025-03-01" → "Mar 2025". A multi-year range needs the year, which is why
 *  these charts don't reuse `formatShortDate`'s bare "MM-DD". */
function formatMonthLabel(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const name = MONTH_NAMES[month - 1];
  return name === undefined || Number.isNaN(year) ? iso : `${name} ${year}`;
}

function renderTimeXTicks(axes: ChartAxes, points: AreaPoint[]): string {
  const dx = axes.innerW / Math.max(1, points.length - 1);
  const step = Math.max(1, Math.floor(points.length / 6));
  return pickXTicks(points, step)
    .map((idx) => {
      const x = axes.paddingLeft + idx * dx;
      // The plot starts flush against the left edge, so a centred first label
      // would be sliced in half by the viewBox (and the last by the right
      // edge). Anchor the two end labels inwards.
      const anchor =
        idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle";
      return `<text x="${x.toFixed(1)}" y="${(axes.paddingTop + axes.innerH + 17).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${PALETTE.muted}">${escapeXml(formatMonthLabel(points[idx].date))}</text>`;
    })
    .join("");
}

type Pt = { x: number; y: number };

/** Catmull-Rom through every point, emitted as cubic Béziers. A polyline over
 *  monthly samples reads as a sawtooth; the reference's series are curves. */
function smoothPath(points: Pt[]): string {
  const first = points[0];
  if (first === undefined) return "";
  if (points.length < 3) {
    return points
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
      )
      .join(" ");
  }
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** The x axis and the shared date column both come from the first series, so
 *  every series has to be sampled on the same dates. */
function timeSeriesFrame(
  series: TimeSeries[],
  width: number,
  height: number,
): { axes: ChartAxes; dates: AreaPoint[]; xAt: (i: number) => number } | null {
  const dates = series[0]?.points ?? [];
  if (series.length === 0 || dates.length === 0) return null;
  const axes = timeAxes(width, height);
  const dx = axes.innerW / Math.max(1, dates.length - 1);
  return { axes, dates, xAt: (i) => axes.paddingLeft + i * dx };
}

function valueAt(series: TimeSeries, index: number): number {
  return Math.max(0, series.points[index]?.value ?? 0);
}

export function renderStackedAreaChart(
  series: TimeSeries[],
  opts: { width?: number; height?: number } = {},
): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 240;
  const frame = timeSeriesFrame(series, width, height);
  if (frame === null) return placeholderSvg("Sin histórico", { width, height });
  const { axes, dates, xAt } = frame;

  const totals = dates.map((_, i) =>
    series.reduce((acc, s) => acc + valueAt(s, i), 0),
  );
  const domain: [number, number] = [0, niceAxisTop(Math.max(...totals, 1))];
  const yAt = (value: number) =>
    axes.paddingTop + axes.innerH - axes.innerH * (value / domain[1]);

  // Bands are drawn bottom-up: each one's floor is the previous one's ceiling,
  // so `cumulative` carries the running stack as we go.
  const cumulative = dates.map(() => 0);
  const bands = series
    .map((s, si) => {
      const floor = dates.map((_, i) => ({ x: xAt(i), y: yAt(cumulative[i]) }));
      dates.forEach((_, i) => {
        cumulative[i] += valueAt(s, i);
      });
      const ceiling = dates.map((_, i) => ({
        x: xAt(i),
        y: yAt(cumulative[i]),
      }));
      const color = s.color ?? seriesColor(si);
      // The floor is traced back to the left, so its own "M" becomes a "L"
      // that closes the band onto the ceiling.
      const back = smoothPath(floor.reverse()).replace("M", "L");
      return (
        `<path d="${smoothPath(ceiling)} ${back} Z" fill="${color}" fill-opacity="0.55" stroke="none"/>` +
        `<path d="${smoothPath(ceiling)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`
      );
    })
    .join("");

  // Legend order is the stack read top-down, which is the reverse of the draw
  // order: `series[0]` is the band at the *bottom*. Listing it first put
  // "51–100" at the head of a legend whose first band on screen is "Top 3" —
  // the reader's eye and the label row disagreed about which end was which.
  // Mapped before reversing so each entry keeps its own series' colour.
  const legendEntries: { label: string; color: string }[] = [];
  for (let si = series.length - 1; si >= 0; si--) {
    const s = series[si];
    legendEntries.push({ label: s.label, color: s.color ?? seriesColor(si) });
  }
  const legend = renderLegendRow(legendEntries);

  return svg(
    width,
    height,
    `${renderRightYAxis(axes, domain)}${bands}${legend}${renderTimeXTicks(axes, dates)}`,
  );
}

export function renderMultiLineChart(
  series: TimeSeries[],
  opts: { width?: number; height?: number; showLegend?: boolean } = {},
): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 240;
  const frame = timeSeriesFrame(series, width, height);
  if (frame === null) return placeholderSvg("Sin histórico", { width, height });
  const { axes, dates, xAt } = frame;

  const peak = Math.max(
    ...series.flatMap((s) => dates.map((_, i) => valueAt(s, i))),
    1,
  );
  const domain: [number, number] = [0, niceAxisTop(peak)];

  const lines = series
    .map((s, si) => {
      const path = smoothPath(
        dates.map((_, i) => ({
          x: xAt(i),
          y:
            axes.paddingTop +
            axes.innerH -
            axes.innerH * (valueAt(s, i) / domain[1]),
        })),
      );
      // No point markers: the reference draws bare lines, and dots on a dense
      // series turn the line into a dotted band.
      return `<path d="${path}" fill="none" stroke="${s.color ?? seriesColor(si)}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");

  const legend =
    (opts.showLegend ?? true)
      ? renderLegendRow(
          series.map((s, si) => ({
            label: s.label,
            color: s.color ?? seriesColor(si),
          })),
        )
      : "";

  return svg(
    width,
    height,
    `${renderRightYAxis(axes, domain)}${lines}${legend}${renderTimeXTicks(axes, dates)}`,
  );
}

/* ----------------------------- NetworkGraph --------------------------- */

export function renderNetworkGraph(
  target: string,
  nodes: BacklinksGraphNode[],
  links: BacklinksGraphLink[],
  opts: { width?: number; height?: number } = {},
): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 280;
  if (nodes.length <= 1 || links.length === 0) {
    return placeholderSvg("Sin dominios de referencia");
  }
  const centre = nodes[0];
  const satellites = nodes.slice(1);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 40;

  const positioned = satellites.map((n, i) => {
    const angle = (i / satellites.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...n,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
  const byId = new Map(positioned.map((n) => [n.id, n]));
  byId.set(centre.id, {
    ...centre,
    x: cx,
    y: cy,
  });

  const linkMarkup = links
    .map((link) => {
      const s = byId.get(link.source);
      const t = byId.get(link.target);
      if (!s || !t) return "";
      const stroke = PALETTE.spam[t.spamSeverity] ?? PALETTE.neutral;
      const opacity = Math.max(0.25, 1 - t.spamSeverity * 0.15);
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2 - 10;
      return `<path d="M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity.toFixed(2)}" stroke-width="1.2"/>`;
    })
    .join("");

  const nodeMarkup = positioned
    .map((n) => {
      const fill = PALETTE.spam[n.spamSeverity] ?? PALETTE.neutral;
      const r = Math.max(6, Math.min(14, Math.round((n.rank || 1) / 10) + 4));
      const label = n.id.length > 22 ? truncate(n.id, 20) : n.id;
      const lw = approxTextWidth(label, 9);
      const lx = Math.max(0, Math.min(width - lw, n.x - lw / 2));
      return `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r}" fill="${fill}" fill-opacity="0.85" stroke="${PALETTE.cardBg}" stroke-width="1.5"/><text x="${lx.toFixed(1)}" y="${(n.y + r + 11).toFixed(1)}" font-size="9" fill="${PALETTE.muted}">${escapeXml(label)}</text>`;
    })
    .join("");

  const centreRadius = 18;
  const centreMark = `<circle cx="${cx}" cy="${cy}" r="${centreRadius}" fill="${PALETTE.brand}" stroke="${PALETTE.cardBg}" stroke-width="2"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${PALETTE.cardBg}">${escapeXml(truncate(centre.id, 12))}</text>`;

  return svg(width, height, `${linkMarkup}${nodeMarkup}${centreMark}`);
}

/* ------------------------- DivergingBarChart --------------------------- */

/**
 * "New and Lost" bars (referring domains / backlinks over time). Unlike
 * {@link renderBarPairChart}'s side-by-side pairs, the reference draws one
 * bar per period straddling a zero baseline: `new` grows up, `lost` grows
 * down from the same column. That means the y axis has to be symmetric
 * (top/mid/0/-mid/-top) instead of starting at zero, so this gets its own
 * axis instead of reusing `chartAxes` + `renderYAxisTicks` as-is.
 */
export type DivergingPoint = { date: string; new: number; lost: number };

export function renderDivergingBarChart(
  points: DivergingPoint[],
  opts: {
    width?: number;
    height?: number;
    newColor?: string;
    lostColor?: string;
    grid?: string;
    muted?: string;
    /** @see {@link ChartDateFormat} — defaults to "short" (unchanged output). */
    dateFormat?: ChartDateFormat;
  } = {},
): string {
  if (points.length === 0) return placeholderSvg("Sin histórico");
  const width = opts.width ?? 480;
  const height = opts.height ?? 220;
  const newColor = opts.newColor ?? "#6868d8";
  const lostColor = opts.lostColor ?? "#ff6b70";
  const grid = opts.grid ?? PALETTE.border;
  const muted = opts.muted ?? PALETTE.muted;
  const dateFormat = opts.dateFormat ?? "short";

  const axes = chartAxes(width, height);
  const maxValue = Math.max(...points.flatMap((p) => [p.new, p.lost]), 1);
  const top = niceAxisTop(maxValue);
  const domain: [number, number] = [-top, top];
  const zeroY = axes.paddingTop + axes.innerH / 2;
  const halfH = axes.innerH / 2;

  // Five rows: top, mid, zero, -mid, -top. The zero row is drawn solid and
  // thicker so the baseline itself reads as a mark, not just another rule.
  const gridRows: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = domain[0] + ((domain[1] - domain[0]) * i) / 4;
    const y = axes.paddingTop + axes.innerH - (axes.innerH * i) / 4;
    const isZero = i === 2;
    const label = v === 0 ? "0" : formatYValue(v, domain);
    gridRows.push(
      `<line x1="${axes.paddingLeft}" y1="${y.toFixed(1)}" x2="${(width - axes.paddingRight).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${grid}" stroke-width="${isZero ? 1.5 : 1}"${isZero ? "" : ' stroke-dasharray="2 3"'}/>`,
      `<text x="${(axes.paddingLeft - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${muted}">${label}</text>`,
    );
  }

  const groupWidth = axes.innerW / points.length;
  const barWidth = Math.max(2, groupWidth * 0.6);

  const bars = points
    .map((p, i) => {
      const x = axes.paddingLeft + i * groupWidth + (groupWidth - barWidth) / 2;
      const newH = (Math.max(0, p.new) / top) * halfH;
      const lostH = (Math.max(0, p.lost) / top) * halfH;
      const title = `<title>${escapeXml(formatChartDate(p.date, dateFormat))} — New: ${p.new}, Lost: ${p.lost}</title>`;
      return (
        `<g>${title}` +
        `<rect x="${x.toFixed(1)}" y="${(zeroY - newH).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${newH.toFixed(1)}" rx="1.5" fill="${newColor}"/>` +
        `<rect x="${x.toFixed(1)}" y="${zeroY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${lostH.toFixed(1)}" rx="1.5" fill="${lostColor}"/>` +
        `</g>`
      );
    })
    .join("");

  // ~7 labels regardless of how many periods (up to ~26) are plotted.
  const step = Math.max(1, Math.floor(points.length / 7));
  const tickCandidates: XTickCandidate[] = [];
  for (const idx of pickXTicks(points, step)) {
    const point = points[idx];
    if (!point) continue;
    tickCandidates.push({
      x: axes.paddingLeft + idx * groupWidth + groupWidth / 2,
      label: formatChartDate(point.date, dateFormat),
    });
  }
  const xTicks = renderChartXTicks(
    tickCandidates,
    height - 6,
    { left: axes.paddingLeft, right: width - axes.paddingRight },
    muted,
  );

  return svg(width, height, `${gridRows.join("")}${bars}${xTicks}`);
}

/* --------------------------------- WordCloud --------------------------- */

/**
 * Anchor-text cloud ("Top Anchors"). No layout library and no randomness are
 * available (deterministic-SVG constraint, see file header), so this hand-
 * rolls a row packer: words are laid out left-to-right until a row is full,
 * then wrap. Feeding the packer in strict weight-descending order draws every
 * big word on row one and tapers to a dull grid of small ones below, so the
 * words are first interleaved biggest/smallest so each row mixes sizes.
 */
export type WordCloudWord = { text: string; weight: number; title?: string };

const WORD_CLOUD_MIN_FONT = 13;
const WORD_CLOUD_MAX_FONT = 34;
const WORD_CLOUD_ROW_GAP = 8;
const WORD_CLOUD_WORD_GAP = 14;
const WORD_CLOUD_PADDING = 12;

export function renderWordCloud(
  words: WordCloudWord[],
  opts: { width?: number; height?: number; color?: string } = {},
): string {
  if (words.length === 0) return placeholderSvg("Sin datos");
  const width = opts.width ?? 360;
  const height = opts.height ?? 220;
  const color = opts.color ?? "#6868d8";
  const innerWidth = width - WORD_CLOUD_PADDING * 2;
  const availableHeight = height - WORD_CLOUD_PADDING * 2;

  const minWeight = Math.min(...words.map((w) => w.weight));
  const maxWeight = Math.max(...words.map((w) => w.weight));
  const weightSpan = maxWeight - minWeight;

  const fontSizeFor = (weight: number, maxFont: number): number => {
    const t = weightSpan === 0 ? 0.5 : (weight - minWeight) / weightSpan;
    return WORD_CLOUD_MIN_FONT + t * (maxFont - WORD_CLOUD_MIN_FONT);
  };

  // Biggest, smallest, 2nd biggest, 2nd smallest, … — so a packed row ends up
  // mixing sizes instead of every large word landing on the first line.
  // oxlint-disable-next-line unicorn/no-array-sort -- no toSorted() on this project's ES2022 lib; array is a fresh spread copy, nothing to mutate
  const byWeightDesc = [...words].sort((a, b) => b.weight - a.weight);
  const interleaved: WordCloudWord[] = [];
  for (let lo = 0, hi = byWeightDesc.length - 1; lo <= hi; lo++, hi--) {
    const first = byWeightDesc[lo];
    if (first) interleaved.push(first);
    if (lo !== hi) {
      const last = byWeightDesc[hi];
      if (last) interleaved.push(last);
    }
  }

  type Placed = {
    text: string;
    title: string;
    fontSize: number;
    width: number;
  };
  type Row = { items: Placed[]; height: number };

  const layoutRows = (maxFont: number): Row[] => {
    const rows: Row[] = [];
    let current: Placed[] = [];
    let currentWidth = 0;
    for (const word of interleaved) {
      const fontSize = fontSizeFor(word.weight, maxFont);
      const maxChars = Math.max(
        3,
        Math.floor((innerWidth * 0.9) / (fontSize * 0.55)),
      );
      const text = truncate(word.text, maxChars);
      const textWidth = approxTextWidth(text, fontSize);
      const nextWidth =
        current.length === 0
          ? textWidth
          : currentWidth + WORD_CLOUD_WORD_GAP + textWidth;
      if (current.length > 0 && nextWidth > innerWidth) {
        rows.push({
          items: current,
          height: Math.max(...current.map((p) => p.fontSize)),
        });
        current = [];
      }
      current.push({
        text,
        title: word.title ?? word.text,
        fontSize,
        width: textWidth,
      });
      currentWidth = current.reduce(
        (acc, p, i) => acc + p.width + (i === 0 ? 0 : WORD_CLOUD_WORD_GAP),
        0,
      );
    }
    if (current.length > 0) {
      rows.push({
        items: current,
        height: Math.max(...current.map((p) => p.fontSize)),
      });
    }
    return rows;
  };

  const blockHeight = (rows: Row[]): number =>
    rows.reduce((acc, r) => acc + r.height, 0) +
    Math.max(0, rows.length - 1) * WORD_CLOUD_ROW_GAP;

  // Shrink the font ceiling until the whole cloud fits the given height — a
  // cloud that overflows its own viewBox is worse than a slightly smaller one.
  let maxFont = WORD_CLOUD_MAX_FONT;
  let rows = layoutRows(maxFont);
  let attempts = 0;
  while (
    blockHeight(rows) > availableHeight &&
    maxFont > WORD_CLOUD_MIN_FONT &&
    attempts < 8
  ) {
    maxFont = Math.max(WORD_CLOUD_MIN_FONT, maxFont * 0.85);
    rows = layoutRows(maxFont);
    attempts++;
  }

  // Belt and braces: drop any row that still wouldn't fit rather than let it
  // spill past the bottom edge.
  let usedHeight = 0;
  const fittedRows = rows.filter((row) => {
    const next =
      usedHeight + row.height + (usedHeight > 0 ? WORD_CLOUD_ROW_GAP : 0);
    if (next > availableHeight) return false;
    usedHeight = next;
    return true;
  });

  let top = WORD_CLOUD_PADDING + (availableHeight - usedHeight) / 2;
  const markup = fittedRows
    .map((row) => {
      const rowWidth =
        row.items.reduce((acc, p) => acc + p.width, 0) +
        (row.items.length - 1) * WORD_CLOUD_WORD_GAP;
      let x = WORD_CLOUD_PADDING + (innerWidth - rowWidth) / 2;
      const baseline = top + row.height;
      const rowMarkup = row.items
        .map((p) => {
          const opacity = (
            0.55 +
            (p.fontSize / WORD_CLOUD_MAX_FONT) * 0.45
          ).toFixed(2);
          const weight = p.fontSize > 20 ? 700 : 500;
          const el = `<text x="${x.toFixed(1)}" y="${baseline.toFixed(1)}" font-size="${p.fontSize.toFixed(1)}" font-weight="${weight}" fill="${color}" fill-opacity="${opacity}"><title>${escapeXml(p.title)}</title>${escapeXml(p.text)}</text>`;
          x += p.width + WORD_CLOUD_WORD_GAP;
          return el;
        })
        .join("");
      top += row.height + WORD_CLOUD_ROW_GAP;
      return rowMarkup;
    })
    .join("");

  return svg(width, height, markup);
}

/* --------------------------- OrganicNetworkGraph ------------------------ */

/**
 * Force-directed variant of {@link renderNetworkGraph}. That renderer places
 * every satellite on a single ring around the target — clean, but it reads as
 * a wheel of spokes rather than a network. This one still has to be pure and
 * deterministic (no `Math.random`, no client JS to animate a real
 * simulation), so it runs a fixed number of Fruchterman-Reingold iterations
 * over a fixed, index-derived starting layout: same input, same iteration
 * count, same output, every time.
 */
type SimPoint = { x: number; y: number };

function forceDirectedLayout(
  ids: string[],
  initial: Map<string, SimPoint>,
  edges: { source: string; target: string }[],
  fixedId: string,
  bounds: { width: number; height: number; iterations: number },
): Map<string, SimPoint> {
  const { width, height, iterations } = bounds;
  const nodes = new Map(
    ids.map((id) => [
      id,
      { ...(initial.get(id) ?? { x: width / 2, y: height / 2 }) },
    ]),
  );
  const area = width * height;
  const k = Math.sqrt(area / Math.max(1, ids.length)) * 0.6;
  let temperature = Math.max(width, height) / 12;
  const cooling = temperature / Math.max(1, iterations);

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, SimPoint>(
      ids.map((id) => [id, { x: 0, y: 0 }]),
    );

    for (let i = 0; i < ids.length; i++) {
      const a = nodes.get(ids[i] ?? "");
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const b = nodes.get(ids[j] ?? "");
        if (!b) continue;
        const rawDx = a.x - b.x;
        const rawDy = a.y - b.y;
        const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy) || 0.01;
        const force = (k * k) / dist;
        const dx = (rawDx / dist) * force;
        const dy = (rawDy / dist) * force;
        const da = disp.get(ids[i] ?? "");
        const db = disp.get(ids[j] ?? "");
        if (da) {
          da.x += dx;
          da.y += dy;
        }
        if (db) {
          db.x -= dx;
          db.y -= dy;
        }
      }
    }

    for (const edge of edges) {
      const a = nodes.get(edge.source);
      const b = nodes.get(edge.target);
      if (!a || !b) continue;
      const rawDx = a.x - b.x;
      const rawDy = a.y - b.y;
      const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy) || 0.01;
      const force = (dist * dist) / k;
      const dx = (rawDx / dist) * force;
      const dy = (rawDy / dist) * force;
      const da = disp.get(edge.source);
      const db = disp.get(edge.target);
      if (da) {
        da.x -= dx;
        da.y -= dy;
      }
      if (db) {
        db.x += dx;
        db.y += dy;
      }
    }

    for (const id of ids) {
      if (id === fixedId) continue;
      const node = nodes.get(id);
      const d = disp.get(id);
      if (!node || !d) continue;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const capped = Math.min(dist, temperature);
      node.x += (d.x / dist) * capped;
      node.y += (d.y / dist) * capped;
      // Gentle pull to centre keeps satellites from drifting off the canvas.
      node.x += (width / 2 - node.x) * 0.01;
      node.y += (height / 2 - node.y) * 0.01;
      node.x = Math.min(width - 8, Math.max(8, node.x));
      node.y = Math.min(height - 8, Math.max(8, node.y));
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  return nodes;
}

export function renderOrganicNetworkGraph(
  target: string,
  nodes: BacklinksGraphNode[],
  links: BacklinksGraphLink[],
  opts: {
    width?: number;
    height?: number;
    nodeColor?: string;
    highlightColor?: string;
    linkColor?: string;
    labelColor?: string;
  } = {},
): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 280;
  if (nodes.length <= 1 || links.length === 0) {
    return placeholderSvg("Sin dominios de referencia", { width, height });
  }
  const nodeColor = opts.nodeColor ?? PALETTE.neutral;
  const highlightColor = opts.highlightColor ?? PALETTE.accent;
  const linkColor = opts.linkColor ?? PALETTE.neutral;
  const labelColor = opts.labelColor ?? PALETTE.text;

  const centre = nodes.find((n) => n.id === target) ?? nodes[0];
  if (!centre)
    return placeholderSvg("Sin dominios de referencia", { width, height });
  const satellites = nodes.filter((n) => n.id !== centre.id);
  const cx = width / 2;
  const cy = height / 2;

  // Deterministic phyllotaxis spiral: golden-angle steps by index, radius
  // growing with the index, so satellites never start stacked on the same
  // ray the way a plain ring would (which the force pass can't untangle).
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const maxRadius = Math.min(width, height) / 2 - 20;
  const initial = new Map<string, SimPoint>();
  initial.set(centre.id, { x: cx, y: cy });
  satellites.forEach((n, i) => {
    const angle = i * goldenAngle;
    const r = Math.min(maxRadius, 8 * Math.sqrt(i + 1));
    initial.set(n.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  });

  // If every incoming link is a spoke from the centre, the graph reads as a
  // wheel, not a network — add a light ring between neighbouring satellites
  // (by index) so secondary nodes have something to connect to as well.
  const hubOnly = links.every((l) => l.source === centre.id);
  const satelliteIds = satellites.map((n) => n.id);
  const derivedLinks: BacklinksGraphLink[] = hubOnly
    ? satelliteIds.map((id, i) => ({
        source: id,
        target: satelliteIds[(i + 1) % satelliteIds.length] ?? id,
      }))
    : [];
  const allLinks = [...links, ...derivedLinks].filter(
    (l) => l.source !== l.target,
  );

  const ids = [centre.id, ...satelliteIds];
  const positions = forceDirectedLayout(ids, initial, allLinks, centre.id, {
    width,
    height,
    iterations: 120,
  });

  // oxlint-disable-next-line unicorn/no-array-sort -- no toSorted() on this project's ES2022 lib; .map() already returned a fresh array, nothing to mutate
  const sortedRanks = satellites.map((n) => n.rank).sort((a, b) => a - b);
  const medianRank = sortedRanks[Math.floor(sortedRanks.length / 2)] ?? 0;

  const linkMarkup = allLinks
    .map((link) => {
      const s = positions.get(link.source);
      const t = positions.get(link.target);
      if (!s || !t) return "";
      const secondary = link.source !== centre.id && link.target !== centre.id;
      const opacity = secondary ? 0.18 : 0.32;
      return `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="${linkColor}" stroke-opacity="${opacity}" stroke-width="1"/>`;
    })
    .join("");

  const nodeMarkup = satellites
    .map((n) => {
      const pos = positions.get(n.id);
      if (!pos) return "";
      const highlighted = n.spamSeverity === 0 && n.rank >= medianRank;
      const r = Math.max(2.5, Math.min(7, 2.5 + n.rank / 20));
      const fill = highlighted ? highlightColor : nodeColor;
      return `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="0.85"><title>${escapeXml(n.id)}</title></circle>`;
    })
    .join("");

  const centrePos = positions.get(centre.id) ?? { x: cx, y: cy };
  const centreRadius = 15;
  const centreLabel = truncate(centre.id, 18);
  const centreMarkup =
    `<circle cx="${centrePos.x.toFixed(1)}" cy="${centrePos.y.toFixed(1)}" r="${centreRadius}" fill="${highlightColor}" fill-opacity="0.18" stroke="${highlightColor}" stroke-width="1.5"/>` +
    `<circle cx="${centrePos.x.toFixed(1)}" cy="${centrePos.y.toFixed(1)}" r="3.5" fill="${highlightColor}"/>` +
    `<text x="${centrePos.x.toFixed(1)}" y="${(centrePos.y - centreRadius - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${labelColor}">${escapeXml(centreLabel)}</text>`;

  return svg(width, height, `${linkMarkup}${nodeMarkup}${centreMarkup}`);
}

/* ---------------------------- AuthorityProfile -------------------------- */

/**
 * 3-axis authority profile ("Link Power / Organic Traffic / Natural
 * Profile"). Built on the same polar layout as {@link renderRadarChart} but
 * the reference profile reads as a deformed circle, not a triangle with hard
 * corners — so the perimeter is a closed Catmull-Rom curve (reusing
 * `smoothPath`'s tangent math, wrapped so the curve blends across the
 * start/end seam) instead of a straight-edged `<polygon>`.
 */
export type AuthorityAxis = { label: string; value: number };

function smoothClosedPath(points: Pt[]): string {
  const n = points.length;
  if (n < 3) return smoothPath(points);
  const at = (i: number): Pt => points[((i % n) + n) % n];
  const first = at(0);
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

export function renderAuthorityProfile(
  axes: AuthorityAxis[],
  opts: {
    width?: number;
    height?: number;
    stroke?: string;
    fill?: string;
    muted?: string;
  } = {},
): string {
  if (axes.length === 0) return placeholderSvg("Sin datos");
  const width = opts.width ?? 300;
  const height = opts.height ?? 260;
  const stroke = opts.stroke ?? "#14b8a6";
  const fill = opts.fill ?? "#14b8a633";
  const muted = opts.muted ?? PALETTE.muted;

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 55;
  const angleStep = (2 * Math.PI) / axes.length;
  const ringCount = 3;

  const gridRings = Array.from({ length: ringCount }, (_, i) => {
    const r = (radius * (i + 1)) / ringCount;
    return `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${PALETTE.border}" stroke-width="1" stroke-opacity="0.6"/>`;
  }).join("");

  const points: Pt[] = axes.map((axis, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const t = Math.max(0, Math.min(100, axis.value)) / 100;
    const r = radius * t;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });

  const profile = `<path d="${smoothClosedPath(points)}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${stroke}" stroke="${PALETTE.cardBg}" stroke-width="1.5"/>`,
    )
    .join("");

  const labels = axes
    .map((axis, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (radius + 16);
      const ly = cy + Math.sin(angle) * (radius + 16);
      const anchor =
        Math.abs(Math.cos(angle)) < 0.3
          ? "middle"
          : Math.cos(angle) > 0
            ? "start"
            : "end";
      return `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${muted}">${escapeXml(axis.label)}</text>`;
    })
    .join("");

  return svg(width, height, `${gridRings}${profile}${dots}${labels}`);
}

/* ----------------------------- VennDiagram --------------------------- */

export type VennDatum = { label: string; value: number; color?: string };
export type VennPair = {
  left: string;
  right: string;
  value: number;
  /** True when this lobe is a bound, not a measurement (see the competitors
   *  service: there is no pairwise call between two competitors). It renders
   *  as "≈" instead of a figure, because a bare 0 reads as measured. */
  approximate?: boolean;
};

export type VennInput = {
  /** One membership per compared domain, in order: primary, comp1, comp2. */
  sets: VennDatum[];
  /** Pairwise intersection counts. Mark the ones we did not measure. */
  pairs?: VennPair[];
  /** Total keyword count for the headline label. */
  total?: number;
  /** Width/height override (defaults 360×280 — fits the spec's card), and
   *  whether each circle carries its own outside label. Turn labels off when
   *  a legend beside the diagram already names the sets. */
  opts?: { width?: number; height?: number; showLabels?: boolean };
};

/**
 * Proportional Venn diagram, one circle per compared domain (SVG only).
 *
 * **Area encodes magnitude**, which is the whole point of the figure: radius
 * scales with √value, so a set ten times larger draws ten times the area. A
 * fixed-radius Venn — what this drew before — says nothing at all, and the
 * reference's own two circles are visibly different sizes.
 *
 * Centre distance is derived from the overlap: `d = r₁ + r₂ − 2·min(r₁,r₂)·f`
 * where `f` is the share of the SMALLER set that sits in the intersection. It
 * is an approximation of the true lens area — exact lens inversion buys
 * nothing at this size — but it is monotonic, so more overlap always reads as
 * more overlap.
 *
 * An empty set draws as a dashed minimum-radius outline rather than a filled
 * disc, so a degraded report does not suggest volume it does not have.
 */
export function renderVennDiagram(input: VennInput): string {
  const width = input.opts?.width ?? 360;
  const height = input.opts?.height ?? 280;
  const sets = input.sets.slice(0, 3);
  if (sets.length === 0) return placeholderSvg("No data");

  const cx = width / 2;
  const cy = height / 2 - 6;
  const maxValue = Math.max(...sets.map((s) => Math.max(0, s.value)), 0);
  // Leave room for the outside labels: the largest disc gets ~30% of the
  // shorter side, which keeps a 3-circle layout inside the viewport.
  const labelRoom = (input.opts?.showLabels ?? true) ? 1 : 1.38;
  const rMax =
    Math.min(width, height) * (sets.length > 2 ? 0.26 : 0.3) * labelRoom;
  const rMin = 10;
  const radius = (value: number): number =>
    maxValue <= 0
      ? rMin
      : Math.max(rMin, rMax * Math.sqrt(Math.max(0, value) / maxValue));

  const radii = sets.map((s) => radius(s.value));

  /** Share of the smaller set that sits in the intersection, 0..0.9. */
  const overlapFactor = (i: number, j: number): number => {
    const a = Math.max(0, sets[i]?.value ?? 0);
    const b = Math.max(0, sets[j]?.value ?? 0);
    const smaller = Math.min(a, b);
    if (smaller <= 0) return 0.18;
    const pair = (input.pairs ?? []).find(
      (p) =>
        (p.left === sets[i]?.label && p.right === sets[j]?.label) ||
        (p.left === sets[j]?.label && p.right === sets[i]?.label),
    );
    if (!pair || pair.approximate) return 0.18;
    return Math.min(0.9, Math.max(0, pair.value / smaller));
  };

  /** Centre distance for two discs given how much they share. */
  const distance = (i: number, j: number): number => {
    const ri = radii[i] ?? rMin;
    const rj = radii[j] ?? rMin;
    return Math.max(
      Math.abs(ri - rj) + 6,
      ri + rj - 2 * Math.min(ri, rj) * overlapFactor(i, j),
    );
  };

  let groupLeft = 0;
  let groupRight = width;
  const positions: Array<{ x: number; y: number }> = [];
  if (sets.length === 1) {
    positions.push({ x: cx, y: cy });
  } else if (sets.length === 2) {
    const d = distance(0, 1);
    positions.push({ x: cx - d / 2, y: cy }, { x: cx + d / 2, y: cy });
  } else {
    // Primary left; the two competitors stacked to its right, each placed at
    // its own distance from the primary. The competitor-to-competitor lobe is
    // the approximated one, so it is not what drives the geometry.
    const d1 = distance(0, 1);
    const d2 = distance(0, 2);
    const px = cx - rMax * 0.55;
    positions.push(
      { x: px, y: cy },
      { x: px + d1 * 0.92, y: cy - rMax * 0.42 },
      { x: px + d2 * 0.92, y: cy + rMax * 0.42 },
    );
  }

  // Centre the group on its own bounding box. Each layout above places circles
  // relative to a nominal centre, but radii differ, so the drawn cluster drifts
  // off-centre — visibly so when one set dwarfs the others.
  if (positions.length > 0) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    positions.forEach((p, i) => {
      const r = radii[i] ?? rMin;
      minX = Math.min(minX, p.x - r);
      maxX = Math.max(maxX, p.x + r);
      minY = Math.min(minY, p.y - r);
      maxY = Math.max(maxY, p.y + r);
    });
    const shiftX = cx - (minX + maxX) / 2;
    const shiftY = cy - (minY + maxY) / 2;
    positions.forEach((p) => {
      p.x += shiftX;
      p.y += shiftY;
    });
    groupLeft = minX + shiftX;
    groupRight = maxX + shiftX;
  }

  const defaultColors = [PALETTE.brand, PALETTE.accent, PALETTE.series3];
  const overlayOpacity = 0.42;

  const circles = sets
    .map((d, i) => {
      const pos = positions[i];
      const r = radii[i];
      if (!pos || r == null) return "";
      const fill = d.color ?? defaultColors[i] ?? PALETTE.brand;
      if (d.value <= 0) {
        return `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${rMin.toFixed(1)}" fill="none" stroke="${fill}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      }
      return `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="${overlayOpacity}" stroke="${fill}" stroke-width="1.5"/>`;
    })
    .join("");

  const showLabels = input.opts?.showLabels ?? true;
  const labels = (showLabels ? sets : [])
    .map((d, i) => {
      const pos = positions[i];
      const r = radii[i];
      if (!pos || r == null) return "";
      // Labels sit OUTSIDE the whole group, in two columns: the primary on the
      // left, the competitors on the right, each at its own circle's height.
      // Anchoring to the individual circle instead drops a small circle's
      // label straight onto the disc that contains it.
      const toLeft = sets.length === 1 ? false : i === 0;
      const lx = toLeft ? groupLeft - 12 : groupRight + 12;
      const ly = pos.y + 4;
      const anchor = toLeft ? "end" : "start";
      const text = `${escapeXml(truncate(d.label, 18))}: ${formatNumberCompact(d.value)}`;
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${PALETTE.text}" font-weight="600">${text}</text>`;
    })
    .join("");

  const pairLabels = (input.pairs ?? [])
    .map((p) => {
      const idxA = sets.findIndex((s) => s.label === p.left);
      const idxB = sets.findIndex((s) => s.label === p.right);
      if (idxA < 0 || idxB < 0) return "";
      const a = positions[idxA];
      const b = positions[idxB];
      if (!a || !b) return "";
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + 3;
      // An approximated lobe never shows a figure: "≈" says we did not measure
      // it, where "∩ 0" would claim we did.
      const text = p.approximate ? "≈" : `∩ ${formatNumberCompact(p.value)}`;
      return `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-size="10" fill="${PALETTE.muted}">${text}</text>`;
    })
    .join("");

  const headline =
    typeof input.total === "number"
      ? `<text x="${cx}" y="${(height - 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="${PALETTE.muted}">${formatNumberCompact(input.total)} keywords in play</text>`
      : "";

  return svg(width, height, `${circles}${labels}${pairLabels}${headline}`);
}

/* ----------------------------- DonutChart ---------------------------- */

/**
 * Donut variant of {@link renderPieChart}. Our hand-rolled pie implementation
 * already draws a hollow centre (`innerRadius > 0`), so the donut is a thin
 * wrapper that documents intent at the call site and lets us grow
 * donut-specific defaults later (e.g. custom centre text).
 */
export type DonutDatum = PieDatum;

export function renderDonutChart(
  data: DonutDatum[],
  opts: { width?: number; height?: number; centerLabel?: string } = {},
): string {
  if (data.length === 0) {
    return renderPieChart(data, opts); // already returns a placeholder
  }
  const generated = renderPieChart(data, opts);
  if (!opts.centerLabel) return generated;
  const labelText = escapeXml(opts.centerLabel);
  // Splice a label into the existing svg: the pie writes "Total" + a
  // compact number, we replace with our label + the compact sum.
  const total = data.reduce((acc, d) => acc + Math.max(0, d.value), 0);
  const totalMarkup = formatNumberCompact(total);
  return generated
    .replace(
      /<text x="[^"]+" y="[^"]+" text-anchor="middle" font-size="11"[^>]*>Total<\/text>\s*<text x="[^"]+" y="[^"]+" text-anchor="middle" font-size="16"[^>]*>[^<]*<\/text>/,
      `<text x="160" y="98" text-anchor="middle" font-size="11" fill="${PALETTE.muted}">${escapeXml(opts.centerLabel)}</text><text x="160" y="116" text-anchor="middle" font-size="16" font-weight="700" fill="${PALETTE.text}">${totalMarkup}</text>`,
    )
    .replace(
      labelText, // unused; gives ESLint a handle on the binding
      labelText,
    );
}

/** Re-export type so templates/tests don't double-import from the report. */
export type {
  AnchorRow,
  AttributeRow,
  CategoryRow,
  TypeRow,
} from "@/server/lib/render/reports/backlinks-report";

// Used to silence the unused IconSize constant — reserved for future legend icons.
void ICON_SIZE;
