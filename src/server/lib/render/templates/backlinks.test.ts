import { describe, expect, it } from "vitest";
import { renderBacklinksReport } from "@/server/lib/render/templates/backlinks";
import type {
  BacklinksReportData,
  CategoryRow,
  TypeRow,
  AnchorRow,
  AttributeRow,
  BacklinksGraphNode,
  BacklinksGraphLink,
} from "@/server/lib/render/reports/backlinks-report";

/**
 * Build a fully-populated BacklinksReportData fixture. The template renders
 * the same HTML for this fixture regardless of Date or randomness.
 */
function makeFixture(): BacklinksReportData {
  const categories: CategoryRow[] = [
    { category: "com", share: 0.45, count: 45 },
    { category: "es", share: 0.25, count: 25 },
    { category: "org", share: 0.15, count: 15 },
  ];
  const types: TypeRow[] = [
    { type: "Texto", share: 0.7, count: 70 },
    { type: "Imagen", share: 0.3, count: 30 },
  ];
  const attributes: AttributeRow[] = [
    { attribute: "Follow", share: 0.6, count: 60 },
    { attribute: "Nofollow", share: 0.3, count: 30 },
    { attribute: "Sponsored", share: 0.1, count: 10 },
  ];
  const topAnchors: AnchorRow[] = [
    { anchor: "click aquí", backlinks: 30, domains: 20 },
    { anchor: "ver más", backlinks: 20, domains: 18 },
  ];

  const nodes: BacklinksGraphNode[] = [
    { id: "example.com", rank: 100, spamSeverity: 0, backlinks: 1000 },
    { id: "a.com", rank: 60, spamSeverity: 1, backlinks: 100 },
    { id: "b.com", rank: 80, spamSeverity: 3, backlinks: 80 },
    { id: "c.com", rank: 50, spamSeverity: 2, backlinks: 60 },
  ];
  const links: BacklinksGraphLink[] = [
    { source: "example.com", target: "a.com" },
    { source: "example.com", target: "b.com" },
    { source: "example.com", target: "c.com" },
  ];

  return {
    input: { domain: "example.com", country: "ES", countryLabel: "ES" },
    healthy: true,
    tiles: {
      authority: { value: 72, source: "ok" },
      authorityComposition: { rank: 80, spamPenalty: 8 },
      backlinks: { value: 1234, source: "ok" },
      organicTraffic: { value: 5678, source: "ok" },
      referringDomains: { value: 89, source: "ok" },
      toxicity: { value: 12, source: "ok" },
    },
    charts: {
      authorityRadar: {
        value: {
          axes: [
            { label: "Autoridad", value: 80 },
            { label: "Referrers", value: 65 },
            { label: "Diversidad", value: 50 },
            { label: "Limpieza", value: 70 },
            { label: "Crecimiento", value: 45 },
          ],
        },
        source: "ok",
      },
      authorityTrend: {
        value: {
          points: [
            { date: "2026-04-15", value: 60 },
            { date: "2026-05-15", value: 65 },
            { date: "2026-06-15", value: 70 },
          ],
        },
        source: "ok",
      },
      networkGraph: { value: { nodes, links }, source: "ok" },
      referringDomainsArea: {
        value: {
          points: [
            { date: "2026-04-15", value: 70 },
            { date: "2026-05-15", value: 80 },
            { date: "2026-06-15", value: 89 },
          ],
        },
        source: "ok",
      },
      backlinksArea: {
        value: {
          points: [
            { date: "2026-04-15", value: 1000 },
            { date: "2026-05-15", value: 1100 },
            { date: "2026-06-15", value: 1234 },
          ],
        },
        source: "ok",
      },
      referringDomainsBars: {
        value: {
          points: [
            { date: "2026-04-15", new: 10, lost: 4 },
            { date: "2026-05-15", new: 12, lost: 5 },
            { date: "2026-06-15", new: 8, lost: 3 },
          ],
        },
        source: "ok",
      },
      backlinksBars: {
        value: {
          points: [
            { date: "2026-04-15", new: 50, lost: 20 },
            { date: "2026-05-15", new: 60, lost: 25 },
            { date: "2026-06-15", new: 40, lost: 18 },
          ],
        },
        source: "ok",
      },
    },
    tables: {
      categories: { value: categories, source: "ok" },
      types: { value: types, source: "ok" },
      attributes: { value: attributes, source: "ok" },
      topAnchors: { value: topAnchors, source: "ok" },
    },
  };
}

describe("renderBacklinksReport · template", () => {
  it("produces a self-contained branded HTML document", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<style>");
    expect(html).toContain("open-seo");
  });

  it("honours spec §2 — does not include Semrush brand or proprietary metric names", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).not.toMatch(/semrush/i);
    expect(html).toContain("Puntuación de autoridad"); // renamed metric
  });

  it("renders all 5 tile labels with the correct data", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Puntuación de autoridad");
    expect(html).toContain("Backlinks");
    expect(html).toContain("Tráfico orgánico");
    expect(html).toContain("Dominios de referencia");
    expect(html).toContain("Toxicidad");
    expect(html).toContain("72"); // authority score
    expect(html).toContain("1234"); // backlinks total
    expect(html).toContain("5678"); // organic traffic
    expect(html).toContain("89"); // referring domains
  });

  it("renders all 7 chart container titles from spec §6.2", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Radar de autoridad");
    expect(html).toContain("Tendencia de autoridad");
    expect(html).toContain("Grafo de red");
    expect(html).toContain("Dominios en el tiempo");
    expect(html).toContain("Backlinks en el tiempo");
    expect(html).toContain("Nuevos vs perdidos (dominios)");
    expect(html).toContain("Nuevos vs perdidos (backlinks)");
  });

  it("renders all 4 table titles from spec §6.2", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).toContain("Categorías de dominios de referencia");
    expect(html).toContain("Tipos de backlinks");
    expect(html).toContain("Atributos del enlace");
    expect(html).toContain("Mejores anchors");
  });

  it("renders 7 SVG fragments (one per chart) plus 2 donut SVGs", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    // 7 chart cards + 2 donut = 9 SVGs at minimum.
    const svgCount = (html.match(/<svg /g) ?? []).length;
    expect(svgCount).toBeGreaterThanOrEqual(9);
  });

  it("inlines styles and does NOT load external CSS", () => {
    const html = renderBacklinksReport({
      report: "backlinks",
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
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "<script>alert(1)</script>.evil.com",
      country: "ES",
      device: "desktop",
      data: makeFixture(),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a 'Datos parciales' chip when the report is not fully healthy", () => {
    const partial = makeFixture();
    partial.healthy = false;
    partial.tiles.backlinks = { value: null, source: "error" };
    const html = renderBacklinksReport({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: partial,
    });
    expect(html).toContain("Datos parciales");
  });
});
