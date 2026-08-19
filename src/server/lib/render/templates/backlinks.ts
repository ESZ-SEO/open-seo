/* eslint-disable max-lines, max-lines-per-function -- Backlinks template mirrors the spec's 5-tile + 7-chart + 4-table layout; splitting would fragment the visual structure across files and lose the local narrative of the section grid. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  AnchorRow,
  AttributeRow,
  BacklinksReportData,
  CategoryRow,
  TypeRow,
} from "@/server/lib/render/reports/backlinks-report";
import {
  placeholderSvg,
  renderAreaChart,
  renderBarPairChart,
  renderLineChart,
  renderNetworkGraph,
  renderPieChart,
  renderRadarChart,
} from "@/server/lib/render/charts/charts";

/**
 * Backlinks report template (E1).
 *
 * Self-contained HTML sent to a headless browser for screenshotting, mirroring
 * the structure of `templates/shell.ts` (inline `<style>`, no external CSS,
 * brand palette, lucide-style inline SVG icons). Follows spec §6.2:
 *
 *   - 5 tiles: Autoridad · Backlinks · Tráfico orgánico · Dominios de
 *     referencia · Toxicidad (the 6th tile from §Anexo A.3, "Visitas
 *     mensuales", is marked ❌ omitted — no DataForSEO equivalent).
 *   - 7 charts: radar autoridad · tendencia autoridad · grafo de red · área
 *     dominios de referencia · área backlinks · barras new/lost dominios ·
 *     barras new/lost backlinks.
 *   - 4 tables: categorías (ref domains) · tipos de backlink · atributos de
 *     enlace · top anchors.
 *
 * Each top-level group has its own card-style container so the page survives
 * at the renderer screenshot width (1280px) without squeezing anything.
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

const PERCENT_FMT = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 1,
});

const NUMBER_FMT = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});

function fmtNumber(value: number | null): string {
  return value == null ? "—" : NUMBER_FMT.format(value);
}

function fmtPercent(value: number): string {
  return PERCENT_FMT.format(value);
}

function truncateDomain(input: string, max = 36): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}

/* ---------- tile renderers ---------- */

type Tile = {
  label: string;
  value: string;
  sub: string;
  icon: string;
  warning?: boolean;
};

const ICONS = {
  authority: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path></svg>`,
  backlinks: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>`,
  traffic: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"></path><path d="M17 7h4v4"></path></svg>`,
  domains: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>`,
  toxicity: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18v.5"></path></svg>`,
};

function renderTiles(
  data: BacklinksReportData["tiles"],
  tiles: Tile[],
): string {
  return tiles
    .map(
      (t) => `
    <div class="tile ${t.warning ? "tile-warn" : ""}">
      <div class="tile-label">${t.icon}${escapeHtml(t.label)}</div>
      <div class="tile-value">${escapeHtml(t.value)}</div>
      <div class="tile-sub">${escapeHtml(t.sub)}</div>
    </div>`,
    )
    .join("");
}

/* ---------- table helpers ---------- */

function tableShell(
  title: string,
  head: string[],
  rowsHtml: string,
  empty: string,
): string {
  return `
    <div class="card">
      <div class="card-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="muted">Informe completo ›</span>
      </div>
      <table class="data">
        <thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${head.length}" class="muted center">${escapeHtml(empty)}</td></tr>`}</tbody>
      </table>
    </div>`;
}

function categoryRows(rows: CategoryRow[]): string {
  return rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.category)}</td>
        <td class="num">${fmtNumber(r.count)}</td>
        <td class="num">${fmtPercent(r.share)}</td>
      </tr>`,
    )
    .join("");
}

function typeRows(rows: TypeRow[]): string {
  return rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.type)}</td>
        <td class="num">${fmtNumber(r.count)}</td>
        <td class="num">${fmtPercent(r.share)}</td>
      </tr>`,
    )
    .join("");
}

function attributeRows(rows: AttributeRow[]): string {
  return rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.attribute)}</td>
        <td class="num">${fmtNumber(r.count)}</td>
        <td class="num">${fmtPercent(r.share)}</td>
      </tr>`,
    )
    .join("");
}

function anchorRows(rows: AnchorRow[]): string {
  return rows
    .map(
      (r) => `<tr>
        <td class="anchor">${escapeHtml(truncateDomain(r.anchor, 60))}</td>
        <td class="num">${fmtNumber(r.backlinks)}</td>
        <td class="num">${fmtNumber(r.domains)}</td>
      </tr>`,
    )
    .join("");
}

/* ---------- chart helpers ---------- */

function chartCard(title: string, sub: string, body: string): string {
  return `
    <div class="card chart">
      <div class="card-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="muted">${escapeHtml(sub)}</span>
      </div>
      <div class="chart-body">${body}</div>
    </div>`;
}

/* ---------- top-level template ---------- */

export function renderBacklinksReport({
  report,
  domain,
  country,
  device,
  data,
}: BacklinksTemplateInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;
  const generatedAt = new Date().toISOString();

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
      label: "Backlinks",
      value: fmtNumber(data.tiles.backlinks.value),
      sub:
        data.tiles.backlinks.source === "error"
          ? "datos no disponibles"
          : "totales registrados por DataForSEO",
      icon: ICONS.backlinks,
      warning: data.tiles.backlinks.source === "error",
    },
    {
      label: "Tráfico orgánico",
      value: fmtNumber(data.tiles.organicTraffic.value),
      sub:
        data.tiles.organicTraffic.source === "error"
          ? "datos no disponibles"
          : "estimación mensual (Labs)",
      icon: ICONS.traffic,
      warning: data.tiles.organicTraffic.source === "error",
    },
    {
      label: "Dominios de referencia",
      value: fmtNumber(data.tiles.referringDomains.value),
      sub:
        data.tiles.referringDomains.source === "error"
          ? "datos no disponibles"
          : "medidos en el último barrido",
      icon: ICONS.domains,
      warning: data.tiles.referringDomains.source === "error",
    },
    {
      label: "Toxicidad",
      value:
        data.tiles.toxicity.value != null
          ? `${Math.round(data.tiles.toxicity.value)}%`
          : "—",
      sub:
        data.tiles.toxicity.source === "empty"
          ? "no se ha podido medir"
          : "spam score del dominio objetivo",
      icon: ICONS.toxicity,
      warning: data.tiles.toxicity.source === "error",
    },
  ];

  const radarSvg =
    data.charts.authorityRadar.source === "ok"
      ? renderRadarChart(data.charts.authorityRadar.value.axes, {
          width: 320,
          height: 280,
        })
      : placeholderSvg("Sin datos");

  const trendSvg =
    data.charts.authorityTrend.source === "ok"
      ? renderLineChart(data.charts.authorityTrend.value.points, {
          width: 480,
          height: 200,
          color: "#1f6feb",
        })
      : placeholderSvg("Sin histórico");

  const networkSvg =
    data.charts.networkGraph.source === "ok"
      ? renderNetworkGraph(
          data.input.domain,
          data.charts.networkGraph.value.nodes,
          data.charts.networkGraph.value.links,
          { width: 480, height: 280 },
        )
      : placeholderSvg("Sin dominios de referencia");

  const refAreaSvg =
    data.charts.referringDomainsArea.source === "ok"
      ? renderAreaChart(data.charts.referringDomainsArea.value.points, {
          width: 480,
          height: 200,
          stroke: "#14b8a6",
          fill: "#14b8a633",
        })
      : placeholderSvg("Sin histórico");

  const blAreaSvg =
    data.charts.backlinksArea.source === "ok"
      ? renderAreaChart(data.charts.backlinksArea.value.points, {
          width: 480,
          height: 200,
          stroke: "#1f6feb",
          fill: "#1f6feb33",
        })
      : placeholderSvg("Sin histórico");

  const refBarsSvg =
    data.charts.referringDomainsBars.source === "ok"
      ? renderBarPairChart(data.charts.referringDomainsBars.value.points, {
          width: 480,
          height: 200,
        })
      : placeholderSvg("Sin histórico");

  const blBarsSvg =
    data.charts.backlinksBars.source === "ok"
      ? renderBarPairChart(data.charts.backlinksBars.value.points, {
          width: 480,
          height: 200,
        })
      : placeholderSvg("Sin histórico");

  // Two simple pies for the types and attributes tables (we already have raw
  // counts in the table; pie+table side-by-side gives the spec's donut look).
  const typesPie =
    data.tables.types.source === "ok" && data.tables.types.value.length > 0
      ? renderPieChart(
          data.tables.types.value.map((t) => ({
            name: t.type,
            value: t.count,
          })),
          { width: 280, height: 220 },
        )
      : placeholderSvg("Sin tipos");
  const attributesPie =
    data.tables.attributes.source === "ok" &&
    data.tables.attributes.value.length > 0
      ? renderPieChart(
          data.tables.attributes.value.map((a) => ({
            name: a.attribute,
            value: a.count,
          })),
          { width: 280, height: 220 },
        )
      : placeholderSvg("Sin atributos");

  const categoriesTable = tableShell(
    "Categorías de dominios de referencia",
    ["Categoría", "Cantidad", "%"],
    categoryRows(
      data.tables.categories.source === "ok"
        ? data.tables.categories.value
        : [],
    ),
    "Sin categorías",
  );
  const typesTable = tableShell(
    "Tipos de backlinks",
    ["Tipo", "Cantidad", "%"],
    typeRows(data.tables.types.source === "ok" ? data.tables.types.value : []),
    "Sin tipos",
  );
  const attributesTable = tableShell(
    "Atributos del enlace",
    ["Atributo", "Cantidad", "%"],
    attributeRows(
      data.tables.attributes.source === "ok"
        ? data.tables.attributes.value
        : [],
    ),
    "Sin atributos",
  );
  const anchorsTable = tableShell(
    "Mejores anchors",
    ["Anchor", "Backlinks", "Dominios"],
    anchorRows(
      data.tables.topAnchors.source === "ok"
        ? data.tables.topAnchors.value
        : [],
    ),
    "Sin anchors",
  );

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
    --brand-dark: #0b3d91;
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
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 20px; border-bottom: 1px solid var(--border);
    margin-bottom: 24px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark {
    width: 36px; height: 36px; border-radius: 9px;
    background: linear-gradient(135deg, var(--brand), var(--brand-dark));
    display: flex; align-items: center; justify-content: center;
    color: #fff;
  }
  .brand-mark svg { width: 20px; height: 20px; }
  .brand-name { font-weight: 700; font-size: 18px; letter-spacing: -0.01em; }
  .header-meta { font-size: 12px; color: var(--muted); text-align: right; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 24px 0 12px; color: var(--text); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 500;
    background: var(--card); border: 1px solid var(--border); color: var(--muted);
  }
  .chip svg { width: 14px; height: 14px; }

  .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 24px; }
  .tile {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 16px 14px;
  }
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

  .charts-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
  .charts-grid--third { grid-template-columns: 1fr 1fr; }
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

  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }

  table.data { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.data th, table.data td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  table.data th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data td.anchor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  table.data tr:last-child td { border-bottom: 0; }

  .footer {
    margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--border);
    font-size: 11px; color: var(--muted); display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <div>
          <div class="brand-name">open-seo</div>
          <div style="font-size:11px;color:var(--muted)">Informe SEO</div>
        </div>
      </div>
      <div class="header-meta">Generado ${escapeHtml(generatedAt)}</div>
    </div>

    <h1>${escapeHtml(title)}</h1>
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

    <div class="tiles">${renderTiles(data.tiles, tiles)}</div>

    <h2>Visión general de autoridad</h2>
    <div class="row-2">
      ${chartCard("Radar de autoridad", "5 dimensiones", radarSvg)}
      ${chartCard("Tendencia de autoridad", "histórico 12 sem.", trendSvg)}
    </div>

    <h2>Red de dominios de referencia</h2>
    <div class="charts-grid">
      ${chartCard("Grafo de red", "Top dominios y spam score", networkSvg)}
      ${chartCard("Dominios en el tiempo", "área acumulada", refAreaSvg)}
      ${chartCard("Backlinks en el tiempo", "área acumulada", blAreaSvg)}
      ${chartCard(
        "Nuevos vs perdidos (dominios)",
        "barras por período",
        refBarsSvg,
      )}
      ${chartCard(
        "Nuevos vs perdidos (backlinks)",
        "barras por período",
        blBarsSvg,
      )}
      <div class="card chart">
        <div class="card-head">
          <h3>Leyenda grafo de red</h3>
          <span class="muted">color = spam score</span>
        </div>
        <div class="chart-body" style="flex-direction:column;align-items:flex-start;padding:0 18px;">
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;margin:4px 0;"><span style="width:14px;height:14px;border-radius:50%;background:#22c55e;display:inline-block;"></span> Limpio (&lt; 5%)</div>
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;margin:4px 0;"><span style="width:14px;height:14px;border-radius:50%;background:#84cc16;display:inline-block;"></span> Bajo (5–15%)</div>
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;margin:4px 0;"><span style="width:14px;height:14px;border-radius:50%;background:#f59e0b;display:inline-block;"></span> Medio (15–30%)</div>
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;margin:4px 0;"><span style="width:14px;height:14px;border-radius:50%;background:#fb923c;display:inline-block;"></span> Alto (30–50%)</div>
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;margin:4px 0;"><span style="width:14px;height:14px;border-radius:50%;background:#ef4444;display:inline-block;"></span> Crítico (≥ 50%)</div>
        </div>
      </div>
    </div>

    <h2>Distribución y composición del perfil de backlinks</h2>
    <div class="row-2">
      <div class="card chart">
        <div class="card-head">
          <h3>Tipos de backlinks</h3>
          <span class="muted">donut</span>
        </div>
        <div class="chart-body">${typesPie}</div>
      </div>
      <div class="card chart">
        <div class="card-head">
          <h3>Atributos del enlace</h3>
          <span class="muted">donut</span>
        </div>
        <div class="chart-body">${attributesPie}</div>
      </div>
    </div>

    <h2>Tablas</h2>
    <div class="row-2">
      ${categoriesTable}
      ${typesTable}
    </div>
    <div class="row-2">
      ${attributesTable}
      ${anchorsTable}
    </div>

    <div class="footer">
      <span>open-seo · Datos propios (DataForSEO)</span>
      <span>${escapeHtml(report)} · ${escapeHtml(country.toUpperCase())} · ${escapeHtml(deviceLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}
