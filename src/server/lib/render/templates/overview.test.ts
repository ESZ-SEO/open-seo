import { describe, expect, it, vi } from "vitest";
import { ES, US } from "country-flag-icons/string/3x2";
import { renderOverviewReport } from "@/server/lib/render/templates/overview";
import type {
  BucketTrendPoint,
  CountryRow,
  OverviewReportData,
} from "@/server/lib/render/reports/overview-report";

/** `count` months of bucket history, oldest first. Values only have to be
 *  non-zero and distinguishable — the assertions are about which chart the
 *  template picked, not about the shape it drew. */
function bucketMonths(count: number): BucketTrendPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-0${i + 1}`,
    counts: {
      top3: 5 + i,
      rank4to10: 10 + i,
      rank11to20: 20 + i,
      rank21to50: 40 + i,
      rank51to100: 80 + i,
    },
  }));
}

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
      paidKeywords: { value: 5, source: "ok" },
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
          paidPoints: [],
        },
        source: "ok",
      },
      keywordBucketTrend: { value: { points: [] }, source: "ok" },
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
      flags: {},
      data: makeFixture(),
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
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
      flags: {},
      data: makeFixture(),
    });
    expect(html).not.toMatch(/semrush/i);
    expect(html).toContain("Authority Score");
  });

  it("renders the tile labels from spec A.1", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    expect(html).toContain("Authority Score");
    expect(html).toContain("Organic Traffic");
    expect(html).toContain("Paid Traffic");
    expect(html).toContain("Backlinks");
    expect(html).toContain("Traffic Share");
  });

  it("renders the tab strip with Overview as the active tab", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    expect(html).toContain('class="tab active"');
    expect(html).toContain(">Overview<");
    expect(html).toContain("Domain Comparison");
    expect(html).toContain("Growth");
    expect(html).toContain("Country Comparison");
  });

  it("renders exactly two card surfaces — SEO and the unified section", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    // The reference page has 3 cards (AI Search, SEO, #widgetDistribution);
    // AI Search is out of scope, so the country table, topics placeholder and
    // both charts must live inside the single lower section — not in cards of
    // their own (design review H1).
    expect(html.match(/class="card /g)).toHaveLength(2);
    expect(html).toContain('class="card section"');
    expect(html).not.toContain('class="layout"');
  });

  it("renders the Distribution by Country table with WW + country rows", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    expect(html).toContain("Distribution by Country");
    // The service labels the WW row in Spanish; the template translates it.
    expect(html).toContain("Worldwide");
    expect(html).not.toContain("Todo el mundo");
    expect(html).toContain("10,000");
  });

  it("renders the Key Topics placeholder block", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    expect(html).toContain("Key Topics");
    expect(html).toContain("Explore the key topics for example.com");
  });

  it("renders the keyword bucket chart (stacked bar) + legend", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    expect(html).toContain("<h3>Keywords</h3>");
    // The legend includes every bucket label.
    expect(html).toContain("Top 3");
    expect(html).toContain("4–10");
    expect(html).toContain("11–20");
    expect(html).toContain("21–50");
    expect(html).toContain("51–100");
    expect(html).toContain("SERP features");
  });

  it("renders the historical traffic chart when the series has enough months", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data: makeFixture(),
    });
    expect(html).toContain("<h3>Traffic</h3>");
    // Real data points → line chart SVG, not the placeholder.
    expect(html).toMatch(/<path[^>]+stroke="#1f6feb"/);
    expect(html).not.toContain("Not enough history yet");
  });

  it("renders the honest placeholder when the traffic series is too short", () => {
    // Two real months is below the threshold: a segment between two dots is
    // not a trend, so the block must keep its "not enough history" copy.
    const data = makeFixture();
    data.charts.trafficTrend.value = {
      points: [
        { date: "2026-05", value: 60 },
        { date: "2026-06", value: 65 },
      ],
      paidPoints: [],
    };
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    expect(html).toContain("Not enough history yet");
  });

  it("adds the paid traffic series only when it has its own history", () => {
    const data = makeFixture();
    const withoutPaid = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    // "Paid Traffic" also names a KPI tile, so the discriminator is the count:
    // one occurrence is the tile alone, two means the chart legend as well.
    expect(withoutPaid.match(/Paid Traffic/g)).toHaveLength(1);
    expect(withoutPaid).toContain("no paid presence in this window");

    data.charts.trafficTrend.value.paidPoints =
      data.charts.trafficTrend.value.points.map((p) => ({
        date: p.date,
        value: 12,
      }));
    const withPaid = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    expect(withPaid.match(/Paid Traffic/g)).toHaveLength(2);
  });

  it("swaps the keyword bar for the stacked area once history exists", () => {
    const data = makeFixture();
    data.charts.keywordBucketTrend.value.points = bucketMonths(6);
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    expect(html).toContain(
      "Organic keywords by position over the last 6 months",
    );
    // The area plots absolute per-position counts; the bar's 200-keyword
    // sample footnote must not survive alongside it.
    expect(html).not.toContain("keywords sampled");
    // SERP features have no monthly history, so the legend loses them and the
    // footnote says why rather than dropping the count silently.
    expect(html).not.toMatch(/<text[^>]*>SERP features/);
    expect(html).toContain("8 SERP features today, excluded");
  });

  it("keeps today's keyword bar when the history is too short", () => {
    const data = makeFixture();
    data.charts.keywordBucketTrend.value.points = bucketMonths(2);
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    expect(html).toContain("Current distribution — 82 keywords sampled");
    expect(html).toMatch(/<text[^>]*>SERP features/);
  });

  it("renders at least 2 SVGs (chart + stacked bar)", () => {
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
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
      flags: {},
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
      flags: {},
      data: makeFixture(),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a 'Partial data' chip when the report is not fully healthy", () => {
    const data = makeFixture();
    data.healthy = false;
    data.tiles.backlinks = { value: null, source: "error" };
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    expect(html).toContain("Partial data");
  });

  it("shows a neutral 'N/A' tile instead of a red warning when a metric is missing", () => {
    const data = makeFixture();
    data.tiles.backlinks = { value: null, source: "error" };
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: {},
      data,
    });
    expect(html).toContain('class="tile-value tile-value--empty">N/A<');
    expect(html).not.toContain("tile-warn");
  });

  it("draws the country's own flag as inline SVG, never an emoji", () => {
    const data = makeFixture();
    // Replace the fixture's ES row with a US row — a legitimate Spain row
    // would also show the Spanish flag, so a flag pinned to one country only
    // shows up when the row is genuinely not Spain.
    data.tables.countries.value = [
      data.tables.countries.value[0],
      {
        countryCode: "US",
        countryLabel: "US",
        share: 0.2,
        traffic: 4000,
        keywords: 30,
      },
    ];
    const html = renderOverviewReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
      flags: { US, ES },
      data,
    });
    expect(html).toContain(`<span class="flag">${US}</span> US`);
    // ES artwork is available and still must not appear: the row is a US row.
    expect(html).not.toContain(ES);
    // The renderer's Chromium ships no colour emoji font, so a flag emoji
    // degrades to bare letterforms — it must never reach the markup.
    expect(html).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it("surfaces the report generation date in the header chips and the footer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 14, 10, 30));
    try {
      const html = renderOverviewReport({
        report: "overview",
        domain: "example.com",
        country: "ES",
        device: "desktop",
        flags: {},
        data: makeFixture(),
      });
      const expectedDate = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(2026, 2, 14, 10, 30));
      expect(html).toContain(expectedDate);
      expect(html).toContain("Generated:");
    } finally {
      vi.useRealTimers();
    }
  });
});
