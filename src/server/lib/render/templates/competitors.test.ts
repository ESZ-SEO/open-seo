import { describe, expect, it } from "vitest";
import { renderCompetitorsReport } from "@/server/lib/render/templates/competitors";
import type { CompetitorsReportData } from "@/server/lib/render/reports/competitors-report";

function baseRow(role: "primary" | "competitor", domain: string) {
  return {
    domain,
    role,
    authority: { value: 75, source: "ok" as const },
    rank: { value: 42, source: "ok" as const },
    organicTraffic: { value: 1234, source: "ok" as const },
    organicKeywords: { value: 567, source: "ok" as const },
    paidKeywords: { value: 12, source: "ok" as const },
    paidTrafficCost: { value: 8.5, source: "ok" as const },
    backlinks: { value: 500, source: "ok" as const },
    referringDomains: { value: 120, source: "ok" as const },
    brandShare: { value: 0.6, source: "ok" as const },
    nonBrandShare: { value: 0.4, source: "ok" as const },
  };
}

function sampleData(
  overrides: Partial<CompetitorsReportData> = {},
): CompetitorsReportData {
  return {
    input: {
      domain: "example.com",
      country: "ES",
      countryLabel: "ES",
      competitors: ["a.com", "b.com"],
    },
    healthy: true,
    rows: [
      baseRow("primary", "example.com"),
      baseRow("competitor", "a.com"),
      baseRow("competitor", "b.com"),
    ],
    keywordGap: {
      missing: { value: [], source: "empty" },
      weak: { value: [], source: "empty" },
    },
    competitorCount: 2,
    vennFromRealCalls: true,
    venn: {
      source: "ok",
      value: {
        primaryOnly: 100,
        comp1Only: 80,
        comp2Only: 50,
        primaryAndComp1: 30,
        primaryAndComp2: 20,
        comp1AndComp2: 0,
      },
    },
    ...overrides,
  };
}

describe("renderCompetitorsReport", () => {
  it("renders a self-contained branded HTML doc with the 3 KPI rows + chips", () => {
    const html = renderCompetitorsReport({
      report: "competitors",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: sampleData(),
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>");
    expect(html).toContain("open-seo");
    expect(html).toContain("Comparación de dominios");
    expect(html).not.toMatch(/semrush/i);
    expect(html).toContain("example.com");
    expect(html).toContain("a.com");
    expect(html).toContain("b.com");
    expect(html).toContain("competidores");
    expect(html).toContain("Puntuación autoridad");
  });

  it("renders an Faltantes table populated from the keyword-gap contract", () => {
    const html = renderCompetitorsReport({
      report: "competitors",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: sampleData({
        keywordGap: {
          missing: {
            source: "ok",
            value: [
              { keyword: "kw one", volume: 1000, ownedBy: "a.com" },
              { keyword: "kw two", volume: 500, ownedBy: "b.com" },
            ],
          },
          weak: { value: [], source: "empty" },
        },
      }),
    });
    expect(html).toContain("Faltantes");
    expect(html).toContain("kw one");
    expect(html).toContain("kw two");
  });

  it("renders the Venn diagram SVG with three circles", () => {
    const html = renderCompetitorsReport({
      report: "competitors",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: sampleData(),
    });
    expect(html).toContain("Superposición de palabras clave");
    // 3 circles minimum from renderVennDiagram.
    const circles = (html.match(/<circle /g) ?? []).length;
    expect(circles).toBeGreaterThanOrEqual(3);
  });

  it("with 0 competitors degrades to a primary-only report", () => {
    const html = renderCompetitorsReport({
      report: "competitors",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: sampleData({
        input: {
          domain: "example.com",
          country: "ES",
          countryLabel: "ES",
          competitors: [],
        },
        rows: [baseRow("primary", "example.com")],
        competitorCount: 0,
      }),
    });
    expect(html).toContain("example.com");
    expect(html).toContain("Añade al menos un competidor");
  });

  it("shows the 'Datos parciales' chip when healthy=false", () => {
    const html = renderCompetitorsReport({
      report: "competitors",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: sampleData({ healthy: false }),
    });
    expect(html).toContain("Datos parciales");
  });

  it("escapes < and > in domain labels", () => {
    const html = renderCompetitorsReport({
      report: "competitors",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      data: sampleData({
        rows: [
          {
            ...baseRow("primary", "example.com"),
            domain: "<hack>",
          },
        ],
      }),
    });
    expect(html).toContain("&lt;hack&gt;");
    expect(html).not.toContain("<hack>");
  });
});
