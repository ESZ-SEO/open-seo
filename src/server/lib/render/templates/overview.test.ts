import { describe, expect, it } from "vitest";
import { renderOverviewReport } from "@/server/lib/render/templates/overview";
import type {
  CountryRow,
  OverviewReportData,
} from "@/server/lib/render/reports/overview-report";

/**
 * Build a fully-populated OverviewReportData fixture. The template renders
 * the same HTML for this fixture regardless of Date or randomness for the
 * everything-except-`generatedAt` cells.
 */
function makeFixture(): OverviewReportData {
  const countries: CountryRow[] = [
    {
      countryCode: "WW",
      countryLabel: "Todo el mundo",
      share: 1,
      traffic: 10000,
      keywords: 500,
    },
    {
      countryCode: "ES",
      countryLabel: "ES",
      share: 0.1,
      traffic: 10000,
      keywords: 50,
    },
  ];

  return {
    input: { domain: "example.com", country: "ES", countryLabel: "ES" },
    healthy: true,
    tiles: {
      authority: { value: 79, source: "ok" },
      authorityComposition: { rank: 80, spamPenalty: 1 },
      organicTraffic: { value: 100, source: "ok" },
      paidTraffic: { value: 0, source: "empty" },
      backlinks: { value: 500, source: "ok" },
      referringDomains: { value: 120, source: "ok" },
      trafficShare: { value: 0.1, source: "ok" },
      organicKeywords: { value: 50, source: "ok" },
      competitorsCount: { value: 3, source: "ok" },
    },
    tables: {
      countries: { value: countries, source: "ok" },
    },
    charts: {
      trafficTrend: {
        value: {
          points: [
            { date: "2026-04-15", value: 60 },
            { date: "2026-05-15", value: 65 },
            { date: "2026-06-15", value: 80 },
          ],
        },
        source: "ok",
      },
      keywordBuckets: {
        value: {
          counts: {
            top3: 5,
            rank4to10: 7,
            rank11to20: 12,
            rank21to50: 20,
            rank51to100: 30,
            serpFeatures: 8,
          },
        },
        source: "ok",
      },
    },
  };
}

describe("renderOverviewReport · template", () => {
  it("produces a self-contained unbranded HTML document", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<style>");
    expect(html).toContain("example.com");
    expect(html).not.toContain("open-seo");
  });

  it("honours spec §2 — no Semrush brand and renamed metric", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).not.toMatch(/semrush/i);
    expect(html).toContain("Puntuación de autoridad");
  });

  it("renders all 5 tile labels from spec A.1", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Puntuación de autoridad");
    expect(html).toContain("Tráfico orgánico");
    expect(html).toContain("Tráfico de pago");
    expect(html).toContain("Backlinks");
    expect(html).toContain("Cuota de tráfico");
  });

  it("renders the tab strip with Visión general as the active tab", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain('class="tab active"');
    expect(html).toContain(">Visión general<");
    expect(html).toContain("Comparación de dominios");
    expect(html).toContain("Crecimiento");
    expect(html).toContain("Comparación por países");
  });

  it("renders the Distribución por países table with WW + country rows", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Distribución por países");
    expect(html).toContain("Todo el mundo");
    // es-ES uses '.' as the thousands separator; with the fixture traffic
    // of 10000 the format string is "10.000" (we don't pin which row uses
    // it — both rows in the fixture do, so the substring shows up).
    expect(html).toContain("10.000");
  });

  it("renders the Temas clave placeholder card", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Temas clave");
    expect(html).toContain("Consulta los temas clave de example.com");
  });

  it("renders the keyword bucket chart (stacked bar) + legend", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Distribución por bucket");
    // The legend includes every bucket label.
    expect(html).toContain("Top 3");
    expect(html).toContain("4–10");
    expect(html).toContain("11–20");
    expect(html).toContain("21–50");
    expect(html).toContain("51–100");
    expect(html).toContain("Funcionalidades SERP");
  });

  it("renders the historical traffic line chart when E3.4 has data", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Tráfico orgánico (histórico)");
    // Real data points → line chart SVG, not the placeholder.
    expect(html).toMatch(/<path[^>]+stroke="#1f6feb"/);
  });

  it("renders the honest placeholder when E3.4 has no data", () => {
    const data = makeFixture();
    data.charts.trafficTrend.value = { points: [] };
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data,
    });
    expect(html).toContain("Aún no hay histórico suficiente");
  });

  it("renders at least 2 SVGs (chart + stacked bar)", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    const svgCount = (html.match(/<svg /g) ?? []).length;
    expect(svgCount).toBeGreaterThanOrEqual(2);
  });

  it("inlines styles and does NOT load external CSS", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/tailwind|daisyui/);
  });

  it("escapes user-controlled domain to avoid HTML injection", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "<script>alert(1)</script>.evil.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a 'Datos parciales' chip when the report is not fully healthy", () => {
    const data = makeFixture();
    data.healthy = false;
    data.tiles.backlinks = { value: null, source: "error" };
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data,
    });
    expect(html).toContain("Datos parciales");
  });
});
