/* eslint-disable max-lines -- Covers the whole Overview template contract (header, KPI cards, workspace, bottom grid) against one shared fixture; splitting would duplicate makeFixture per file. */
import { describe, expect, it, vi } from "vitest";
import { ES, US } from "country-flag-icons/string/3x2";
import {
  overviewFlagCodes,
  renderOverviewReport,
  type OverviewTemplateInput,
} from "@/server/lib/render/templates/overview";
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
    aiSearch: {
      value: {
        mentions: null,
        chatGptMentions: null,
        aiOverviewMentions: null,
      },
      source: "empty",
    },
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
      topKeywords: {
        value: [
          {
            keyword: "example keyword",
            intent: "informational",
            position: 3,
            volume: 1300,
            cpc: 0.89,
            traffic: 92.99,
          },
        ],
        source: "ok",
      },
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

/** The call every test makes. Only the parts a test actually varies are
 *  spelled out at the call site. */
/** The AI card's metric cells alone: the source icons are inline SVGs whose
 *  path coordinates are legitimately full of digits, and the note below the
 *  rows carries an em dash of its own. */
function aiMetricCells(html: string): string {
  return html
    .slice(
      html.indexOf('class="card card-kpi card-ai"'),
      html.indexOf('class="ai-note"'),
    )
    .replace(/<svg[\s\S]*?<\/svg>/g, "");
}

function render(overrides: Partial<OverviewTemplateInput> = {}): string {
  return renderOverviewReport({
    report: "overview",
    domain: "example.com",
    country: "ES",
    device: "desktop",
    flags: {},
    data: makeFixture(),
    ...overrides,
  });
}

describe("renderOverviewReport · template", () => {
  it("produces a self-contained unbranded HTML document", () => {
    const html = render();

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<style>");
    expect(html).toContain("example.com");
    expect(html).not.toContain("open-seo");
  });

  it("honours spec §2 — no Semrush brand and renamed metric", () => {
    const html = render();
    expect(html).not.toMatch(/semrush/i);
    expect(html).toContain("Authority Score");
  });

  it("renders the tile labels from spec A.1", () => {
    const html = render();
    expect(html).toContain("Authority Score");
    expect(html).toContain("Organic Traffic");
    expect(html).toContain("Paid Traffic");
    expect(html).toContain("Backlinks");
    expect(html).toContain("Traffic Share");
  });

  it("renders the three reference tabs with Overview active", () => {
    const html = render();
    expect(html).toContain('class="tab active"');
    expect(html).toContain(">Overview<");
    expect(html).toContain("Growth report");
    expect(html).toContain("Compare by countries");
    // The reference bar has no "Domain Comparison" — it belongs to another
    // view (NAV-01).
    expect(html).not.toContain("Domain Comparison");
  });

  it("highlights the report's own market among the quick-market pills", () => {
    const html = render({ country: "ES" });
    expect(html).toContain("Worldwide");
    expect(html).toContain(">UK<");
    expect(html).toContain('class="pill pill--active">');
    // Exactly one pill may be active — two would claim the report covers two
    // markets at once.
    expect(html.match(/class="pill pill--active"/g)).toHaveLength(1);
  });

  it("appends the report's market when it is not one of the defaults", () => {
    // A pill row that highlights nothing is a pill row that lies about scope.
    const html = render({ country: "MX" });
    expect(html).toContain('class="pill pill--active">');
    expect(html.match(/class="pill pill--active"/g)).toHaveLength(1);
    expect(html).toContain(">MX<");
  });

  it("asks the caller for every flag it can draw", () => {
    // The template can't load artwork itself, so a slot the caller never
    // resolves renders blank — this list is the contract between the two.
    const codes = overviewFlagCodes("MX", [
      {
        countryCode: "WW",
        countryLabel: "x",
        share: 1,
        traffic: 1,
        keywords: 1,
      },
      {
        countryCode: "MX",
        countryLabel: "MX",
        share: 1,
        traffic: 1,
        keywords: 1,
      },
    ]);
    expect(codes).toEqual(
      expect.arrayContaining(["WW", "US", "GB", "ES", "MX"]),
    );
  });

  it("renders the domain query bar with the analysed domain", () => {
    const html = render();
    expect(html).toContain('class="query-input"');
    expect(html).toContain("Root Domain");
    expect(html).toContain(">Analyze<");
  });

  it("fills only the AI Search cells the mentions database can back", () => {
    const filled = aiMetricCells(
      render({
        data: {
          ...makeFixture(),
          aiSearch: {
            source: "ok",
            value: {
              mentions: 1400,
              chatGptMentions: 900,
              aiOverviewMentions: 500,
            },
          },
        },
      }),
    );
    expect(filled).toContain("1.4K");
    expect(filled).toContain("900");
    expect(filled).toContain("500");
    // AI Visibility and Cited Pages have no source at all, and AI Mode and
    // Gemini are absent from the mentions database — 8 cells that stay `—`.
    expect(filled.match(/—/g)).toHaveLength(8);

    // With no source the card keeps its geometry and claims nothing.
    const bare = render();
    expect(bare).toContain("No AI Search data source connected");
    expect(aiMetricCells(bare)).not.toMatch(/\d/);
  });

  it("abbreviates KPI values and keeps the exact figure on the tile", () => {
    const data = makeFixture();
    data.tiles.backlinks = { value: 384_600_000, source: "ok" };
    const html = render({ data });
    expect(html).toContain(">384.6M<");
    expect(html).toContain("384,600,000 backlinks");
  });

  it("renders the Distribution by Country table with WW + country rows", () => {
    const html = render();
    expect(html).toContain("Distribution by Country");
    // The service labels the WW row in Spanish; the template translates it.
    expect(html).toContain("Worldwide");
    expect(html).not.toContain("Todo el mundo");
    expect(html).toContain(">10K<");
  });

  it("swaps the rail's columns in AI mode without losing the rows", () => {
    const html = render({ searchMode: "ai" });
    expect(html).toContain("<th>Countries</th>");
    expect(html).toContain(">Visibility<");
    expect(html).toContain(">Mentions<");
    // Same rows, no invented numbers behind the new columns.
    expect(html).toContain("Worldwide");
    expect(html).not.toContain(">Share<");
  });

  it("renders Top Organic Keywords with an intent badge and a details CTA", () => {
    const html = render();
    expect(html).toContain("Top Organic Keywords");
    expect(html).toContain("example keyword");
    expect(html).toContain('class="intent" title="informational">I<');
    expect(html).toContain("0.89");
    expect(html).toContain(">View details<");
  });

  it("renders Key Topics as the bottom-right card, not a rail block", () => {
    const html = render();
    expect(html).toContain("Key Topics");
    expect(html).toContain("key topics");
    expect(html).toContain(">Get topics<");
    // "coming soon" promised a date nobody owns (audit §Q).
    expect(html).not.toContain("coming soon");
    expect(html.indexOf("Key Topics")).toBeGreaterThan(
      html.indexOf('class="bottom-grid"'),
    );
  });

  it("renders the keyword bucket chart (stacked bar) + legend", () => {
    const html = render();
    expect(html).toContain("<h3>Keywords</h3>");
    // The legend includes every bucket label.
    expect(html).toContain("Top 3");
    expect(html).toContain("4–10");
    expect(html).toContain("11–20");
    expect(html).toContain("21–50");
    expect(html).toContain("51–100");
    expect(html).toContain("SERP features");
  });

  it("adds Top Cited Sources in AI mode only, with no invented domains", () => {
    // Asserted on the markup, not the phrase: the phrase also names a rule in
    // the inline <style>, which ships in the same string.
    expect(render()).not.toContain('<div class="cited">');
    const ai = render({ searchMode: "ai" });
    expect(ai).toContain('<div class="cited">');
    expect(ai).toContain('<h3 class="rail-title">Top Cited Sources');
    expect(ai).toContain('class="cited-empty muted"');
  });

  it("draws the SERP distribution ring empty rather than restating our filter", () => {
    // The ranked_keywords call asks for organic items only, so a computed
    // split would read 100% Organic no matter the domain. The legend keeps its
    // three rows; not one of them may carry a percentage.
    const html = render();
    expect(html).toContain("Google SERP Positions Distribution");
    expect(html).toContain(">Organic<");
    expect(html).toContain(">AI Overviews<");
    expect(html).toContain(">Other SERP Features<");
    const legend = html.slice(
      html.indexOf('class="serp-legend"'),
      html.indexOf("</aside>"),
    );
    expect(legend).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("renders the historical traffic chart when the series has enough months", () => {
    const html = render();
    expect(html).toContain("<h3>Traffic</h3>");
    // Real data points → line chart SVG, not the placeholder. The stroke is
    // the report's periwinkle accent (VIS-01), passed in by the template.
    expect(html).toMatch(/<path[^>]+stroke="#6868d8"/);
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
    const html = render({ data });
    expect(html).toContain("Not enough history yet");
  });

  it("adds the paid traffic series only when it has its own history", () => {
    const data = makeFixture();
    const withoutPaid = render({ data });
    // "Paid Traffic" also names a KPI tile, so the discriminator is the count:
    // one occurrence is the tile alone, two means the chart legend as well.
    expect(withoutPaid.match(/Paid Traffic/g)).toHaveLength(1);
    expect(withoutPaid).toContain("no paid presence in this window");

    data.charts.trafficTrend.value.paidPoints =
      data.charts.trafficTrend.value.points.map((p) => ({
        date: p.date,
        value: 12,
      }));
    const withPaid = render({ data });
    expect(withPaid.match(/Paid Traffic/g)).toHaveLength(2);
  });

  it("swaps the keyword bar for the stacked area once history exists", () => {
    const data = makeFixture();
    data.charts.keywordBucketTrend.value.points = bucketMonths(6);
    const html = render({ data });
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
    const html = render({ data });
    expect(html).toContain("Current distribution — 82 keywords sampled");
    expect(html).toMatch(/<text[^>]*>SERP features/);
  });

  it("renders at least 2 SVGs (chart + stacked bar)", () => {
    const html = render();
    const svgCount = (html.match(/<svg /g) ?? []).length;
    expect(svgCount).toBeGreaterThanOrEqual(2);
  });

  it("inlines styles and does NOT load external CSS", () => {
    const html = render();
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/tailwind|daisyui/);
  });

  it("escapes user-controlled domain to avoid HTML injection", () => {
    const html = render({ domain: "<script>alert(1)</script>.evil.com" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a 'Partial data' chip when the report is not fully healthy", () => {
    const data = makeFixture();
    data.healthy = false;
    data.tiles.backlinks = { value: null, source: "error" };
    const html = render({ data });
    expect(html).toContain("Partial data");
  });

  it("shows a neutral 'N/A' tile instead of a red warning when a metric is missing", () => {
    const data = makeFixture();
    data.tiles.backlinks = { value: null, source: "error" };
    const html = render({ data });
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
    const html = render({ flags: { US, ES }, data });
    // Scoped to the rail: the header's country chip legitimately draws ES.
    const rail = html.slice(
      html.indexOf('<aside class="rail">'),
      html.indexOf("</aside>"),
    );
    expect(rail).toContain(`<span class="flag">${US}</span> US`);
    // ES artwork is available and still must not appear: the row is a US row.
    expect(rail).not.toContain(ES);
    // The renderer's Chromium ships no colour emoji font, so a flag emoji
    // degrades to bare letterforms — it must never reach the markup.
    expect(html).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it("surfaces the report generation date in the header chips", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 14, 10, 30));
    try {
      const html = render();
      const expectedDate = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(2026, 2, 14, 10, 30));
      expect(html).toContain(expectedDate);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no footer — the reference capture doesn't show one", () => {
    const html = render();
    expect(html).not.toContain("Data via DataForSEO");
    expect(html).not.toContain("Generated:");
  });
});
