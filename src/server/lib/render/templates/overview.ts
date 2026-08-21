/* eslint-disable max-lines, max-lines-per-function -- Domain Overview template mirrors spec A.1 — 5 tiles, sidebar distribution table, two charts (line + stacked bar) and a topic placeholder. Splitting fragments the section narrative across files. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  CountryRow,
  KeywordBucket,
  OverviewReportData,
} from "@/server/lib/render/reports/overview-report";
import {
  KEYWORD_BUCKETS,
  KEYWORD_BUCKET_LABELS,
} from "@/server/lib/render/reports/overview-report";
import {
  placeholderSvg,
  renderLineChart,
  renderStackedBarChart,
} from "@/server/lib/render/charts/charts";

/**
 * Domain Overview report template (E3).
 *
 * Self-contained HTML sent to the renderer microservice for screenshotting.
 * Same brand surface as E1/E2 (inline `<style>`, no external CSS, lucide-style
 * inline SVG icons, palette from `templates/shell.ts`). Mirrors spec A.1:
 *
 *   - Header chips: domain, country, device, "Datos parciales" when degraded.
 *   - Tabs row: Visión general / Comparación de dominios / Crecimiento /
 *     Comparación por países (decorative — only the first is "active", the
 *     others are placeholders for the future, consistent with the spec).
 *   - 5 tiles + 4 sub-stats in the leading row, matching Semrush's Domain
 *     Overview (Puntuación autoridad, Tráfico orgánico, Tráfico de pago,
 *     Backlinks, Cuota de tráfico).
 *   - Sidebar (left): "Distribución por países" table + "Temas clave"
 *     placeholder card (the dedicated topics endpoint is out of scope for E3).
 *   - Main column: "Tráfico orgánico" line chart (E3.4 stub today →
 *     honest placeholder) + "Palabras clave orgánicas" stacked bar chart
 *     (one column with 6 bucket segments).
 *   - Footer.
 */

const REPORT_TITLES: Record<ReportKind, string> = {
  backlinks: "Informe de backlinks",
  competitors: "Comparación de dominios",
  overview: "Visión general del dominio",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Escritorio",
  mobile: "Móvil",
  tablet: "Tablet",
};

export type OverviewTemplateInput = {
  report: ReportKind;
  domain: string;
  country: string;
  device: string;
  data: OverviewReportData;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NUMBER_FMT = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});

const PERCENT_FMT = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 0,
});

function fmtNumber(value: number | null): string {
  return value == null ? "—" : NUMBER_FMT.format(value);
}

function fmtPercent(value: number | null): string {
  return value == null ? "—" : PERCENT_FMT.format(value);
}

/* ----------------------------- Icons ----------------------------- */

const ICONS = {
  authority: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path></svg>`,
  traffic: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"></path><path d="M17 7h4v4"></path></svg>`,
  paid: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M7 10h2M7 14h6"></path></svg>`,
  backlinks: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>`,
  share: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>`,
} as const;

/* ----------------------------- Tiles ----------------------------- */

type Tile = {
  label: string;
  value: string;
  sub: string;
  icon: string;
  warning?: boolean;
  width?: "normal" | "wide";
};

function renderTiles(tiles: Tile[]): string {
  return tiles
    .map(
      (t) => `
    <div class="tile ${t.warning ? "tile-warn" : ""} ${t.width === "wide" ? "tile-wide" : ""}">
      <div class="tile-label">${t.icon}${escapeHtml(t.label)}</div>
      <div class="tile-value">${escapeHtml(t.value)}</div>
      <div class="tile-sub">${escapeHtml(t.sub)}</div>
    </div>`,
    )
    .join("");
}

/* ----------------------------- Distribution table ----------------------------- */

function countryRows(rows: CountryRow[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="4" class="muted center">Sin datos</td></tr>`;
  }
  return rows
    .map((r) => {
      const flag = r.countryCode === "WW" ? "🌐" : "🇪🇸";
      return `<tr>
        <td>${flag} ${escapeHtml(r.countryLabel)}</td>
        <td class="num">${fmtPercent(r.share)}</td>
        <td class="num">${fmtNumber(r.traffic)}</td>
        <td class="num">${fmtNumber(r.keywords)}</td>
      </tr>`;
    })
    .join("");
}

/* ----------------------------- Trend ----------------------------- */

function hasTrendData(points: { value: number | null }[]): boolean {
  return points.some((p) => p.value != null);
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

function stackedBarFromBuckets(counts: Record<KeywordBucket, number>): string {
  const segments = KEYWORD_BUCKETS.map((b) => ({
    label: KEYWORD_BUCKET_LABELS[b],
    value: counts[b] ?? 0,
    color: BUCKET_COLORS[b],
  }));
  return renderStackedBarChart([{ label: "Hoy", segments }]);
}

/* ----------------------------- Top-level ----------------------------- */

export function renderOverviewReport({
  report,
  domain,
  country,
  device,
  data,
}: OverviewTemplateInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;
  const tiles: Tile[] = [
    {
      label: "Puntuación de autoridad",
      value:
        data.tiles.authority.source === "ok"
          ? String(data.tiles.authority.value)
          : "—",
      sub: `composición: rank ${data.tiles.authorityComposition.rank ?? "—"}${
        data.tiles.authorityComposition.spamPenalty > 0
          ? ` · −${data.tiles.authorityComposition.spamPenalty} spam`
          : ""
      }`,
      icon: ICONS.authority,
    },
    {
      label: "Tráfico orgánico",
      value: fmtNumber(data.tiles.organicTraffic.value),
      sub:
        data.tiles.organicTraffic.source === "error"
          ? "datos no disponibles"
          : data.tiles.organicKeywords.value != null
            ? `Palabras ${NUMBER_FMT.format(data.tiles.organicKeywords.value)}`
            : "estimación mensual (Labs)",
      icon: ICONS.traffic,
      warning: data.tiles.organicTraffic.source === "error",
    },
    {
      label: "Tráfico de pago",
      value: fmtNumber(data.tiles.paidTraffic.value),
      sub:
        data.tiles.paidTraffic.source === "error"
          ? "datos no disponibles"
          : "Si está en 0 → no hay campaña activa",
      icon: ICONS.paid,
      warning: data.tiles.paidTraffic.source === "error",
    },
    {
      label: "Backlinks",
      value: fmtNumber(data.tiles.backlinks.value),
      sub:
        data.tiles.referringDomains.value != null
          ? `Dominios de ref. ${NUMBER_FMT.format(data.tiles.referringDomains.value)}`
          : "totales registrados por DataForSEO",
      icon: ICONS.backlinks,
      warning: data.tiles.backlinks.source === "error",
    },
    {
      label: "Cuota de tráfico",
      value:
        data.tiles.trafficShare.value != null
          ? PERCENT_FMT.format(data.tiles.trafficShare.value)
          : "n/d",
      sub:
        data.tiles.competitorsCount.value != null
          ? `Competidores ${NUMBER_FMT.format(data.tiles.competitorsCount.value)}`
          : "tráfico del país vs el mundo",
      icon: ICONS.share,
    },
  ];

  const trendSvg =
    data.charts.trafficTrend.value.points.length > 0 &&
    hasTrendData(data.charts.trafficTrend.value.points)
      ? renderLineChart(data.charts.trafficTrend.value.points, {
          width: 480,
          height: 200,
          color: "#1f6feb",
        })
      : placeholderSvg(
          "Aún no hay histórico suficiente — se acumula desde el primer render",
        );

  const bucketsSvg = stackedBarFromBuckets(
    data.charts.keywordBuckets.value.counts,
  );

  const countriesRows = countryRows(
    data.tables.countries.source === "ok" ? data.tables.countries.value : [],
  );

  const keywordTotal = Object.values(
    data.charts.keywordBuckets.value.counts,
  ).reduce((acc, n) => acc + n, 0);

  return `<!DOCTYPE html>
<html lang="es">
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
    --brand: #1f6feb;
    --accent: #14b8a6;
    --warn: #ef4444;
    --warn-bg: #fff1f2;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); padding: 32px;
  }
  .shell { max-width: 1216px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 24px 0 12px; color: var(--text); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 500;
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

  .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 24px; }
  .tile {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 16px 14px;
  }
  .tile-wide { grid-column: span 2; }
  .tile-label {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 10px;
  }
  .tile-label svg { color: var(--brand); }
  .tile-value { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .tile-sub { font-size: 11px; color: var(--muted); margin-top: 6px; }
  .tile-warn { background: var(--warn-bg); border-color: #fecaca; }
  .tile-warn .tile-label { color: var(--warn); }

  .layout {
    display: grid; grid-template-columns: 320px 1fr; gap: 16px;
    margin-bottom: 24px;
  }
  .layout-column { display: flex; flex-direction: column; gap: 16px; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px;
  }
  .card-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 12px;
  }
  .card-head h3 { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
  .card-head .muted { font-size: 12px; color: var(--muted); }
  .muted { color: var(--muted); }
  .center { text-align: center; }
  .chart-body { display: flex; justify-content: center; align-items: center; min-height: 200px; }
  .chart-body svg { width: 100%; height: auto; max-height: 320px; }
  .chart-foot { font-size: 11px; color: var(--muted); margin-top: 8px; padding: 0 4px; }

  table.data { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.data th, table.data td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  table.data th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data tr:last-child td { border-bottom: 0; }

  .topic-card {
    text-align: center;
    padding: 28px 18px;
    background: linear-gradient(180deg, #f0f6ff 0%, #fafbff 100%);
    border: 1px solid var(--border);
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
    <h1>${escapeHtml(title)}: <span style="font-weight:500;color:var(--muted)">${escapeHtml(domain)}</span></h1>
    <div class="chips">
      <span class="chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>
        ${escapeHtml(domain)}
      </span>
      <span class="chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        País: ${escapeHtml(country.toUpperCase())}
      </span>
      <span class="chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>
        ${escapeHtml(deviceLabel)}
      </span>
      ${data.healthy ? "" : `<span class="chip" style="color:var(--warn);border-color:#fecaca;">Datos parciales</span>`}
    </div>

    <div class="tabs">
      <span class="tab active">Visión general</span>
      <span class="tab">Comparación de dominios</span>
      <span class="tab">Crecimiento</span>
      <span class="tab">Comparación por países</span>
    </div>

    <div class="tiles">${renderTiles(tiles)}</div>

    <div class="layout">
      <div class="layout-column">
        <div class="card">
        <div class="card-head">
          <h3>Distribución por países</h3>
          <span class="muted">tráfico y kws</span>
        </div>
        <table class="data">
          <thead><tr>
            <th>País</th>
            <th class="num">Cuota</th>
            <th class="num">Tráfico</th>
            <th class="num">Palabras</th>
          </tr></thead>
          <tbody>${countriesRows}</tbody>
        </table>
        <div class="chart-foot">⚠️ cuota = tráfico del país / tráfico mundial</div>
        </div>

        <div class="card">
        <div class="card-head">
          <h3>Temas clave</h3>
          <span class="muted">pendiente E3.3</span>
        </div>
        <div class="topic-card">
          <div class="topic-help">Consulta los temas clave de ${escapeHtml(domain)}</div>
          <p class="muted" style="margin-top:12px;font-size:12px;">Ver temas</p>
        </div>
        </div>
      </div>

      <div class="layout-column">
        <div class="card chart">
          <div class="card-head">
            <h3>Tráfico orgánico (histórico)</h3>
            <span class="muted">2 años · 1M / 6M / 1A / 2A / Todo</span>
          </div>
          <div class="chart-body">${trendSvg}</div>
          <div class="chart-foot">⚠️ histórico se acumula desde el primer render (E3.4)</div>
        </div>

        <div class="card chart">
          <div class="card-head">
            <h3>Palabras clave orgánicas · Distribución por bucket</h3>
            <span class="muted">Top 3 · 4–10 · 11–20 · 21–50 · 51–100 · SERP</span>
          </div>
          <div class="chart-body">${bucketsSvg}</div>
          <div class="chart-foot">Total ${NUMBER_FMT.format(keywordTotal)} kws muestreadas (${NUMBER_FMT.format(200)} máx.)</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <span>Datos propios (DataForSEO)</span>
      <span>${escapeHtml(report)} · ${escapeHtml(country.toUpperCase())} · ${escapeHtml(deviceLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}
