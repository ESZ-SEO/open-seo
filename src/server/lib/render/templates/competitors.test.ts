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
    trafficTrend: { value: [], source: "empty" as const },
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

const BASE = {
  report: "competitors" as const,
  domain: "example.com",
  country: "ES",
  device: "desktop",
  // No flag artwork in unit tests: the template must render without it, and
  // loading the real SVG set here would test `country-flags`, not this.
  flags: {},
};

describe("renderCompetitorsReport", () => {
  it("renders a self-contained unbranded HTML doc with the 3 KPI rows", () => {
    const html = renderCompetitorsReport({ ...BASE, data: sampleData() });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("open-seo");
    expect(html).not.toMatch(/semrush/i);
    expect(html).toContain("Compare Domains");
    expect(html).toContain("example.com");
    expect(html).toContain("a.com");
    expect(html).toContain("b.com");
    expect(html).toContain("Authority score");
  });

  it("abbreviates figures instead of printing them raw", () => {
    const html = renderCompetitorsReport({
      ...BASE,
      data: sampleData({
        rows: [
          {
            ...baseRow("primary", "example.com"),
            organicTraffic: { value: 1840, source: "ok" },
          },
        ],
      }),
    });
    expect(html).toContain("1.8K");
    expect(html).not.toContain(">1840<");
  });

  it("renders the Missing table populated from the keyword-gap contract", () => {
    const html = renderCompetitorsReport({
      ...BASE,
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
    expect(html).toContain("Missing");
    expect(html).toContain("kw one");
    expect(html).toContain("kw two");
  });

  it("renders the Venn diagram SVG with one circle per compared domain", () => {
    const html = renderCompetitorsReport({ ...BASE, data: sampleData() });
    expect(html).toContain("Keyword Overlap");
    const circles = (html.match(/<circle /g) ?? []).length;
    expect(circles).toBeGreaterThanOrEqual(3);
  });

  it("marks the competitor-to-competitor lobe as approximate, never as 0", () => {
    // The service has no pairwise call between two competitors, so printing
    // its bound as a figure would claim a measurement we never made.
    const html = renderCompetitorsReport({ ...BASE, data: sampleData() });
    expect(html).toContain("≈");
    expect(html).not.toContain("∩ 0");
  });

  it("keeps the trend block at full height when there is no history", () => {
    // Dropping the module when the data is missing collapses the page and
    // hides the gap; the empty state is the point.
    const html = renderCompetitorsReport({ ...BASE, data: sampleData() });
    expect(html).toContain("Organic Traffic");
    expect(html).toContain("No traffic history available");
    // The range control cannot name a window we never plotted.
    expect(html).toContain("—");
  });

  it("plots one line per domain when history is present", () => {
    const html = renderCompetitorsReport({
      ...BASE,
      data: sampleData({
        trafficTrend: {
          source: "ok",
          value: [
            {
              domain: "example.com",
              points: [
                { date: "2026-08-01", value: 100 },
                { date: "2026-09-01", value: 140 },
              ],
            },
          ],
        },
      }),
    });
    expect(html).toContain("Aug 2026 – Sep 2026");
    expect(html).not.toContain("No traffic history available");
  });

  it("with 0 competitors degrades to a primary-only report", () => {
    const html = renderCompetitorsReport({
      ...BASE,
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
    expect(html).toContain("Add a competitor");
  });

  it("flags partial data when healthy=false", () => {
    const html = renderCompetitorsReport({
      ...BASE,
      data: sampleData({ healthy: false }),
    });
    expect(html).toContain("Partial data");
  });

  it("escapes < and > in domain labels", () => {
    const html = renderCompetitorsReport({
      ...BASE,
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
