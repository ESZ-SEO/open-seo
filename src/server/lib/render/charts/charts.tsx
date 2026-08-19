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
export function placeholderSvg(message: string): string {
  return svg(
    320,
    200,
    `<rect width="320" height="200" fill="${PALETTE.surface}" /><text x="160" y="100" text-anchor="middle" font-size="14" fill="${PALETTE.muted}">${escapeXml(message)}</text>`,
  );
}

/** Approximate text width in px for the given font size — used for axis labels. */
function approxTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
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

export function renderLineChart(
  points: AreaPoint[],
  opts: { width?: number; height?: number; color?: string } = {},
): string {
  if (points.length === 0) return placeholderSvg("Sin histórico");
  const width = opts.width ?? 480;
  const height = opts.height ?? 200;
  const color = opts.color ?? PALETTE.series1;
  const axes = chartAxes(width, height);
  const values = points.map((p) => (p.value == null ? 0 : p.value));
  const domain = rangeFor(values);
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
  const xTicks = tickIndices
    .map((idx) => {
      const x = axes.paddingLeft + idx * dx;
      const formatted = formatShortDate(points[idx].date);
      return `<text x="${x.toFixed(1)}" y="${(axes.paddingTop + axes.innerH + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${PALETTE.muted}">${escapeXml(formatted)}</text>`;
    })
    .join("");

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
  } = {},
): string {
  if (points.length === 0) return placeholderSvg("Sin histórico");
  const width = opts.width ?? 480;
  const height = opts.height ?? 200;
  const stroke = opts.stroke ?? PALETTE.series1;
  const fill = opts.fill ?? `${PALETTE.series1}33`;
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
  const xTicks = tickIndices
    .map((idx) => {
      const x = axes.paddingLeft + idx * dx;
      const formatted = formatShortDate(points[idx].date);
      return `<text x="${x.toFixed(1)}" y="${(axes.paddingTop + axes.innerH + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${PALETTE.muted}">${escapeXml(formatted)}</text>`;
    })
    .join("");

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

/** Re-export type so templates/tests don't double-import from the report. */
export type {
  AnchorRow,
  AttributeRow,
  CategoryRow,
  TypeRow,
} from "@/server/lib/render/reports/backlinks-report";

// Used to silence the unused IconSize constant — reserved for future legend icons.
void ICON_SIZE;
