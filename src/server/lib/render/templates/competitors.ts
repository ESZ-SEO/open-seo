/* eslint-disable max-lines, max-lines-per-function -- Competitors template mirrors the spec's KPI-table + 3-charts + keyword-gap + Venn layout; splitting would fragment the visual section narrative across files. */
import type { ReportKind } from "@/server/lib/render/cache";
import type {
  CompetitorRow,
  CompetitorsReportData,
  KeywordGapRow,
  VennCounts,
} from "@/server/lib/render/reports/competitors-report";
import {
  renderDonutChart,
  renderVennDiagram,
} from "@/server/lib/render/charts/charts";

/**
 * Competitors report template (E2).
 *
 * Self-contained HTML sent to a headless browser for screenshotting, mirroring
 * the structure of `templates/backlinks.ts` (inline `<style>`, no external
 * CSS, brand palette, lucide-style inline SVG icons). Follows spec §6.3 +
 * Anexo A.2:
 *
 *   - Header chips: primary + up to 2 competitor domains.
 *   - KPI table — one row per domain, columns:
 *       Authority · Ranking · Tráfico orgánico · Palabras clave org. ·
 *       Backlinks · Dominios ref. · Palabras clave de pago · Coste tráfico
 *       de pago.
 *   - 3 charts in a row: Donut "Cuota de tráfico" · "Sin marca / De marca"
 *     bars · "De pago / Orgánico" bars.
 *   - Keyword gap: tabs-equivalent "Faltantes" + "Débiles" rendered as two
 *     stacked tables (the renderer is JS-free, so we render both; visual
 *     separation carries the meaning, see spec A.2).
 *   - Venn diagram — 3 circles with pairwise ∩ markers + per-domain count.
 *   - Footer.
 *
 * Layout follows the 1280px screenshot width (matches the renderer viewport).
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

export type CompetitorsTemplateInput = {
  report: ReportKind;
  domain: string;
  country: string;
  device: string;
  data: CompetitorsReportData;
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

function truncateDomain(input: string, max = 32): string {
  return input.length <= max ? input : `${input.slice(0, max - 1)}…`;
}

// Brand colours for the 3 domains (primary + up to 2 competitors).
const ROLE_COLORS = {
  primary: "#1f6feb",
  comp1: "#14b8a6",
  comp2: "#f59e0b",
} as const;

function roleColor(role: "primary" | "competitor", index: number): string {
  if (role === "primary") return ROLE_COLORS.primary;
  return index === 1 ? ROLE_COLORS.comp1 : ROLE_COLORS.comp2;
}

/* ---------- KPI table ---------- */

function kpiRowCells(row: CompetitorRow, idx: number): string {
  const tone = roleColor(row.role, idx);
  return `
    <tr style="--row-color:${tone};">
      <td>
        <div class="domain-cell">
          <span class="domain-dot" style="background:${tone}"></span>
          <span>${escapeHtml(row.domain)}</span>
          ${row.role === "primary" ? '<span class="badge">Principal</span>' : ""}
        </div>
      </td>
      <td class="num">${row.authority.source === "ok" ? String(row.authority.value) : "—"}</td>
      <td class="num">${fmtNumber(row.rank.value)}</td>
      <td class="num">${fmtNumber(row.organicTraffic.value)}</td>
      <td class="num">${fmtNumber(row.organicKeywords.value)}</td>
      <td class="num">${fmtNumber(row.backlinks.value)}</td>
      <td class="num">${fmtNumber(row.referringDomains.value)}</td>
      <td class="num">${fmtNumber(row.paidKeywords.value)}</td>
      <td class="num">${row.paidTrafficCost.value != null ? `$${fmtNumber(row.paidTrafficCost.value)}` : "—"}</td>
    </tr>`;
}

function kpiTable(rows: CompetitorRow[]): string {
  if (rows.length === 0) {
    return `<div class="card"><p class="muted">Sin datos.</p></div>`;
  }
  const head = `
    <thead>
      <tr>
        <th>Dominio</th>
        <th class="num">Puntuación autoridad</th>
        <th class="num">Ranking</th>
        <th class="num">Tráfico orgánico</th>
        <th class="num">Palabras clave org.</th>
        <th class="num">Backlinks</th>
        <th class="num">Dominios ref.</th>
        <th class="num">Palabras clave de pago</th>
        <th class="num">Coste tráfico de pago</th>
      </tr>
    </thead>`;
  const body = `<tbody>${rows.map((r, i) => kpiRowCells(r, i)).join("")}</tbody>`;
  return `
    <div class="card">
      <div class="card-head">
        <h3>Tabla comparativa de KPI</h3>
        <span class="muted">Puntuación autoridad (composición) · resto (Labs/Backlinks)</span>
      </div>
      <table class="data kpi">
        ${head}
        ${body}
      </table>
    </div>`;
}

/* ---------- 3-up charts ---------- */

function donutForRows(rows: CompetitorRow[]): string {
  // Cuota de tráfico = organicTraffic per domain. Rows that failed api →
  // value null and we still emit a 0 slice so the chart isn't blank.
  const data = rows.map((r, i) => ({
    name: truncateDomain(r.domain, 18),
    value: r.organicTraffic.value ?? 0,
    color: roleColor(r.role, i),
  }));
  // Filter zero-value entries so the donut doesn't show a grey slice.
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) {
    return `<div class="card chart">
      <div class="card-head"><h3>Cuota de tráfico</h3><span class="muted">donut</span></div>
      <div class="chart-body muted">Sin datos de tráfico</div>
    </div>`;
  }
  const total = filtered.reduce((acc, d) => acc + d.value, 0);
  return `<div class="card chart">
    <div class="card-head"><h3>Cuota de tráfico</h3><span class="muted">donut · tráfico mensual</span></div>
    <div class="chart-body">${renderDonutChart(
      filtered.map((d) => ({ name: d.name, value: d.value })),
      { width: 320, height: 240, centerLabel: "Tráfico total" },
    )}</div>
    <div class="chart-foot muted">Estimación mensual (Labs) · total ${fmtNumber(total)}</div>
  </div>`;
}

function brandBarsForRows(rows: CompetitorRow[]): string {
  // brandShare is 0..1; empty/null → grey bar.
  const bars = rows
    .map((r, i) => {
      const total = r.brandShare.value ?? 0;
      const nonBrand = r.nonBrandShare.value ?? 0;
      const tone = roleColor(r.role, i);
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(truncateDomain(r.domain, 24))}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.round(total * 100)}%;background:${tone};"></div>
            <div class="bar-text">${fmtPercent(total)} / ${fmtPercent(nonBrand)}</div>
          </div>
        </div>`;
    })
    .join("");
  return `<div class="card chart">
    <div class="card-head"><h3>Sin marca / De marca</h3><span class="muted">aprox. heurística token de marca</span></div>
    <div class="chart-body" style="flex-direction:column;align-items:stretch;gap:8px;padding:8px 12px;">
      ${bars || '<div class="muted">Sin datos</div>'}
    </div>
    <div class="chart-foot muted">⚠️ heurística: keyword contiene la etiqueta principal del dominio</div>
  </div>`;
}

function paidOrganicBarsForRows(rows: CompetitorRow[]): string {
  const bars = rows
    .map((r, i) => {
      const paid = r.paidTrafficCost.value ?? 0;
      const organic = r.organicTraffic.value ?? 0;
      const tone = roleColor(r.role, i);
      const total = paid + organic;
      const paidShare = total > 0 ? paid / total : 0;
      const organicShare = total > 0 ? organic / total : 0;
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(truncateDomain(r.domain, 24))}</div>
          <div class="bar-track">
            <div class="bar-fill bar-fill--warn" style="width:${Math.round(paidShare * 100)}%;background:${tone};"></div>
            <div class="bar-text">${fmtPercent(paidShare)} de pago · ${fmtPercent(organicShare)} orgánico</div>
          </div>
        </div>`;
    })
    .join("");
  return `<div class="card chart">
    <div class="card-head"><h3>De pago / Orgánico</h3><span class="muted">cost vs etv (Labs)</span></div>
    <div class="chart-body" style="flex-direction:column;align-items:stretch;gap:8px;padding:8px 12px;">
      ${bars || '<div class="muted">Sin datos</div>'}
    </div>
    <div class="chart-foot muted">Cost = paid.estimated_paid_traffic_cost · Orgánico = etv orgánico</div>
  </div>`;
}

/* ---------- keyword gap tables ---------- */

function gapTableHead(): string {
  return `<thead><tr>
    <th>Dominio</th>
    <th>Palabra clave</th>
    <th class="num">Volumen</th>
  </tr></thead>`;
}

function gapRows(rows: KeywordGapRow[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="3" class="muted center">Sin datos</td></tr>`;
  }
  return rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.ownedBy)}</td>
        <td class="anchor">${escapeHtml(truncateDomain(r.keyword, 48))}</td>
        <td class="num">${fmtNumber(r.volume)}</td>
      </tr>`,
    )
    .join("");
}

function gapCard(title: string, sub: string, rows: KeywordGapRow[]): string {
  return `
    <div class="card">
      <div class="card-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="muted">${escapeHtml(sub)}</span>
      </div>
      <table class="data gap">
        ${gapTableHead()}
        <tbody>${gapRows(rows)}</tbody>
      </table>
    </div>`;
}

/* ---------- Venn ---------- */

function vennCard(
  rows: CompetitorRow[],
  venn: VennCounts,
  vennFromRealCalls: boolean,
  competitors: CompetitorsReportData["input"]["competitors"],
): string {
  if (competitors.length === 0) {
    return `<div class="card chart">
      <div class="card-head"><h3>Superposición de palabras clave</h3><span class="muted">venn</span></div>
      <div class="chart-body muted">Añade al menos un competidor para habilitar el Venn.</div>
    </div>`;
  }
  const primary = rows[0]?.domain ?? "";
  const comp1 = competitors[0] ?? "";
  const comp2 = competitors[1] ?? "";
  // Total keywords = owned-by-primary union with each competitor's own
  // exclusive + pairwise intersections. We use only real counts so the
  // template doesn't visually mislead on the comp1∩comp2 lobe when it's
  // approximated.
  const realTotal =
    venn.primaryAndComp1 + venn.primaryAndComp2 + venn.comp1Only;
  const total = realTotal > 0 ? realTotal : undefined;
  const sets = [
    {
      label: primary,
      value: venn.primaryOnly + venn.primaryAndComp1 + venn.primaryAndComp2,
      color: ROLE_COLORS.primary,
    },
    {
      label: comp1,
      value: venn.comp1Only + venn.primaryAndComp1 + (venn.comp1AndComp2 ?? 0),
      color: ROLE_COLORS.comp1,
    },
    {
      label: comp2,
      value: venn.comp2Only + venn.primaryAndComp2 + (venn.comp1AndComp2 ?? 0),
      color: ROLE_COLORS.comp2,
    },
  ].filter((s) => s.label.length > 0);
  const pairs = [
    { left: primary, right: comp1, value: venn.primaryAndComp1 },
    { left: primary, right: comp2, value: venn.primaryAndComp2 },
  ];
  if (comp2.length > 0 && venn.comp1AndComp2 != null) {
    pairs.push({
      left: comp1,
      right: comp2,
      value: venn.comp1AndComp2,
    });
  }
  const warning =
    comp2.length > 0 && venn.comp1AndComp2 === 0 && !vennFromRealCalls
      ? `<div class="chart-foot muted">⚠️ intersección comp1 ∩ comp2 aproximada (no se llamó pairwise)</div>`
      : "";
  return `<div class="card chart">
    <div class="card-head">
      <h3>Superposición de palabras clave</h3>
      <span class="muted">venn · 3 círculos</span>
    </div>
    <div class="chart-body" style="min-height:240px;">${renderVennDiagram({
      sets,
      pairs,
      total,
    })}</div>
    ${warning}
    <ul class="venn-legend">
      ${rows
        .slice(0, 3)
        .map(
          (r, i) =>
            `<li><span class="dot" style="background:${roleColor(r.role, i)}"></span>${escapeHtml(r.domain)}<span class="muted">${fmtNumber(r.organicKeywords.value)} kws</span></li>`,
        )
        .join("")}
    </ul>
  </div>`;
}

/* ---------- top-level ---------- */

export function renderCompetitorsReport({
  report,
  domain,
  country,
  device,
  data,
}: CompetitorsTemplateInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;
  const generatedAt = new Date().toISOString();

  const rows = data.rows;
  const competitors = data.input.competitors;

  // Keyword gap — both tabs rendered as separate cards (renderer JS-free).
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
  .chip .dot {
    width: 10px; height: 10px; border-radius: 50%;
  }

  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px;
    margin-bottom: 16px;
  }
  .card.chart { padding-bottom: 12px; }
  .card-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 12px; gap: 8px;
  }
  .card-head h3 { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: var(--muted); }
  .card-head .muted { font-size: 12px; color: var(--muted); }
  .muted { color: var(--muted); }
  .center { text-align: center; }
  .chart-body { display: flex; justify-content: center; align-items: center; min-height: 200px; padding: 4px; }
  .chart-body svg { max-height: 320px; }
  .chart-foot { font-size: 11px; color: var(--muted); margin-top: 8px; padding: 0 4px; }

  .row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }

  table.data { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.data th, table.data td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  table.data th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.data td.anchor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  table.data tr:last-child td { border-bottom: 0; }

  table.kpi td.num { font-size: 13.5px; }
  .domain-cell { display: flex; align-items: center; gap: 8px; }
  .domain-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    background: #e0ecff;
    color: var(--brand);
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-left: 4px;
  }

  .bar-row { display: flex; align-items: center; gap: 10px; }
  .bar-label { width: 130px; flex: 0 0 auto; font-size: 12px; color: var(--text); }
  .bar-track {
    flex: 1 1 auto; background: var(--bg);
    border-radius: 6px; height: 18px; position: relative;
    border: 1px solid var(--border); overflow: hidden;
  }
  .bar-fill { height: 100%; }
  .bar-fill--warn { background: var(--warn) !important; }
  .bar-text {
    position: absolute; top: 1px; left: 8px;
    font-size: 11px; color: var(--text);
    text-shadow: 0 0 4px rgba(255, 255, 255, 0.7);
  }

  .venn-legend {
    list-style: none; padding: 0; margin: 12px 0 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .venn-legend li {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px;
  }
  .venn-legend .dot {
    width: 12px; height: 12px; border-radius: 50%;
  }

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
        <span class="dot" style="background:${ROLE_COLORS.primary}"></span>
        ${escapeHtml(domain)}
      </span>
      ${competitors
        .map(
          (c, i) =>
            `<span class="chip"><span class="dot" style="background:${roleColor("competitor", i + 1)}"></span>${escapeHtml(c)}</span>`,
        )
        .join("")}
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

    ${kpiTable(rows)}

    <h2>Visión comparada</h2>
    <div class="row-3">
      ${donutForRows(rows)}
      ${brandBarsForRows(rows)}
      ${paidOrganicBarsForRows(rows)}
    </div>

    <h2>Superposición de palabras clave</h2>
    <div class="row-3" style="grid-template-columns: 1fr 1fr;">
      ${vennCard(rows, venn, data.vennFromRealCalls, competitors)}
      <div></div>
    </div>

    <h2>Principales oportunidades de palabras clave</h2>
    ${gapCard(
      "Faltantes",
      "palabras clave que solo rankea el competidor",
      missingRows,
    )}

    ${gapCard("Débiles", "palabras clave que ambos rankean", weakRows)}

    <div class="footer">
      <span>open-seo · Datos propios (DataForSEO)</span>
      <span>${escapeHtml(report)} · ${escapeHtml(country.toUpperCase())} · ${escapeHtml(deviceLabel)} · ${competitors.length} competidor${competitors.length === 1 ? "" : "es"}</span>
    </div>
  </div>
</body>
</html>`;
}
