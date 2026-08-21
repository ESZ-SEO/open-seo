import type { ReportKind } from "@/server/lib/render/cache";

/**
 * MINIMAL E0 report shell.
 *
 * Self-contained HTML sent to an external headless browser. It must NOT depend
 * on the app's Tailwind/daisyUI bundle (the renderer has no access to it), so
 * all styling is an inline `<style>` block with hand-written utilities.
 *
 * Brand rules honoured here (§2 of the backlog):
 * - No Semrush assets/logos/typography.
 * - Proprietary metric names renamed to neutral Spanish/own-brand
 *   ("Authority Score" → "Puntuación de autoridad").
 * - Icons are inline SVG (lucide-style strokes), not the lucide-react lib.
 *
 * This is a skeleton: the rich 7-chart layouts (backlinks/competitors/overview)
 * arrive in E1/E2/E3. E0 ships one branded placeholder tile to prove the
 * render pipeline end-to-end.
 */

const REPORT_TITLES: Record<ReportKind, string> = {
  backlinks: "Backlinks",
  competitors: "Comparación de dominios",
  overview: "Visión general del dominio",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Escritorio",
  mobile: "Móvil",
  tablet: "Tablet",
};

export type ReportShellInput = {
  report: ReportKind;
  domain: string;
  country: string;
  device: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderReportShell({
  report,
  domain,
  country,
  device,
}: ReportShellInput): string {
  const title = REPORT_TITLES[report];
  const deviceLabel = DEVICE_LABELS[device] ?? device;

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
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 32px;
  }
  .shell { max-width: 1216px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 500;
    background: var(--card); border: 1px solid var(--border); color: var(--muted);
  }
  .chip svg { width: 14px; height: 14px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .tile {
    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 20px;
  }
  .tile-label {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 12px;
  }
  .tile-label svg { width: 15px; height: 15px; color: var(--brand); }
  .tile-value { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
  .tile-sub { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .placeholder {
    margin-top: 24px; padding: 28px; text-align: center;
    background: var(--card); border: 1px dashed var(--border); border-radius: 14px;
    color: var(--muted); font-size: 14px;
  }
  .footer {
    margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
    font-size: 11px; color: var(--muted); display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="shell">
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
    </div>

    <div class="grid">
      <div class="tile">
        <div class="tile-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"></path></svg>
          Puntuación de autoridad
        </div>
        <div class="tile-value">—</div>
        <div class="tile-sub">Métrica propia compuesta (E3.2)</div>
      </div>
      <div class="tile">
        <div class="tile-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"></path><path d="M17 7h4v4"></path></svg>
          Tráfico orgánico
        </div>
        <div class="tile-value">—</div>
        <div class="tile-sub">Datos en E1/E3</div>
      </div>
      <div class="tile">
        <div class="tile-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>
          Backlinks
        </div>
        <div class="tile-value">—</div>
        <div class="tile-sub">Datos en E1</div>
      </div>
      <div class="tile">
        <div class="tile-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
          Cuota de tráfico
        </div>
        <div class="tile-value">—</div>
        <div class="tile-sub">Datos en E2/E3</div>
      </div>
    </div>

    <div class="placeholder">
      Contenido del informe (gráficos y tablas) — se completa en E1/E2/E3.
    </div>

    <div class="footer">
      <span>Datos propios (DataForSEO)</span>
      <span>${escapeHtml(report)} · ${escapeHtml(country.toUpperCase())} · ${escapeHtml(deviceLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}
