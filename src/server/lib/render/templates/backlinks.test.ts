import { describe, expect, it } from "vitest";
import {
  renderBacklinksReport,
  type KpiKey,
} from "@/server/lib/render/templates/backlinks";
import type { BacklinksReportData } from "@/server/lib/render/reports/backlinks-report";

/**
 * A payload with every source `ok`. Only the fields the assertions below
 * depend on carry realistic shapes; everything else is the smallest value its
 * type allows.
 */
function makeFixture(): BacklinksReportData {
  return {
    input: { domain: "example.com", country: "ES", countryLabel: "ES" },
    healthy: true,
    tiles: {
      authority: { value: 72, source: "ok" },
      authorityComposition: { rank: 80, spamPenalty: 8 },
      referringDomains: { value: 6_240, source: "ok" },
      backlinks: { value: 428_500, source: "ok" },
      // No DataForSEO endpoint reports either of these — the two cells the
      // KPI strip has to keep without a number.
      monthlyVisits: { value: null, source: "empty" },
      organicTraffic: { value: 184_200, source: "ok" },
      outboundDomains: { value: null, source: "empty" },
      // The sourced pair that could replace the two above.
      referringPages: { value: 18_400, source: "ok" },
      brokenBacklinks: { value: 3_120, source: "ok" },
      toxicity: { value: 14, source: "ok" },
      deltas: { referringDomains: -0.03, backlinks: 0.08 },
    },
    charts: {
      authorityProfile: {
        source: "ok",
        value: {
          score: 72,
          badge: "Industry leader",
          axes: [
            { label: "Link Power", value: 80 },
            { label: "Organic Traffic", value: 65 },
            { label: "Natural Profile", value: 88 },
          ],
        },
      },
      authorityTrend: { source: "ok", value: { points: series() } },
      networkGraph: {
        source: "ok",
        value: {
          nodes: [
            { id: "example.com", rank: 80, spamSeverity: 0, backlinks: 1_000 },
            { id: "a.test", rank: 60, spamSeverity: 1, backlinks: 100 },
            { id: "b.test", rank: 82, spamSeverity: 0, backlinks: 80 },
          ],
          links: [
            { source: "example.com", target: "a.test" },
            { source: "example.com", target: "b.test" },
          ],
        },
      },
      referringDomainsArea: { source: "ok", value: { points: series() } },
      backlinksArea: { source: "ok", value: { points: series() } },
      referringDomainsBars: { source: "ok", value: { points: bars() } },
      backlinksBars: { source: "ok", value: { points: bars() } },
    },
    tables: {
      categories: {
        source: "ok",
        value: [
          { category: "com", share: 0.45, count: 2_558 },
          { category: "es", share: 0.25, count: 1_373 },
        ],
      },
      categoriesDimension: "TLD",
      topAnchors: {
        source: "ok",
        value: [{ anchor: "example preview", backlinks: 30, domains: 20 }],
      },
      authorityDistribution: { source: "ok", value: authorityBuckets() },
      authorityDistributionSample: 6_240,
      types: {
        source: "ok",
        value: [{ type: "Text", share: 0.76, count: 291_380 }],
      },
      attributes: {
        source: "ok",
        value: [{ attribute: "Follow", share: 0.84, count: 269_955 }],
      },
    },
  };
}

/** The same payload with every source failed — the state the page has to
 *  survive without losing a module or changing shape. */
function makeFailedFixture(): BacklinksReportData {
  const base = makeFixture();
  const noSeries = { source: "error" as const, value: { points: [] } };
  return {
    ...base,
    healthy: false,
    tiles: {
      ...base.tiles,
      authority: { value: null, source: "error" },
      referringDomains: { value: null, source: "error" },
      backlinks: { value: null, source: "error" },
      organicTraffic: { value: null, source: "error" },
      toxicity: { value: null, source: "error" },
      deltas: { referringDomains: null, backlinks: null },
    },
    charts: {
      authorityProfile: {
        source: "error",
        value: { score: null, badge: null, axes: [] },
      },
      authorityTrend: noSeries,
      networkGraph: { source: "error", value: { nodes: [], links: [] } },
      referringDomainsArea: noSeries,
      backlinksArea: noSeries,
      referringDomainsBars: { source: "error", value: { points: [] } },
      backlinksBars: { source: "error", value: { points: [] } },
    },
    tables: {
      ...base.tables,
      categories: { source: "error", value: [] },
      topAnchors: { source: "error", value: [] },
      authorityDistribution: { source: "error", value: [] },
      authorityDistributionSample: 0,
      types: { source: "error", value: [] },
      attributes: { source: "error", value: [] },
    },
  };
}

function series(): { date: string; value: number | null }[] {
  return [
    { date: "2026-06-15", value: 60 },
    { date: "2026-06-22", value: 65 },
    { date: "2026-06-29", value: 70 },
  ];
}

function bars(): { date: string; new: number; lost: number }[] {
  return [
    { date: "2026-06-15", new: 10, lost: 4 },
    { date: "2026-06-22", new: 12, lost: 5 },
  ];
}

/** Ten buckets, the shape the service guarantees. */
function authorityBuckets() {
  const ranges = [
    "91 - 100",
    "81 - 90",
    "71 - 80",
    "61 - 70",
    "51 - 60",
    "41 - 50",
    "31 - 40",
    "21 - 30",
    "11 - 20",
    "0 - 10",
  ];
  return ranges.map((range, i) => ({
    range,
    share: 0.1,
    count: 100 * (i + 1),
  }));
}

function render(
  data: BacklinksReportData,
  opts: { domain?: string; kpiCells?: readonly KpiKey[] } = {},
): string {
  return renderBacklinksReport({
    report: "backlinks",
    domain: opts.domain ?? "example.com",
    country: "ES",
    device: "desktop",
    data,
    ...(opts.kpiCells === undefined ? {} : { kpiCells: opts.kpiCells }),
  });
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/** Just the KPI strip. Several of its labels also appear as tab labels in the
 *  shell above it, so a page-wide assertion would match the wrong element. */
function kpiStrip(html: string): string {
  return html.slice(
    html.indexOf('class="card kpis"'),
    html.indexOf('class="grid-3"'),
  );
}

describe("renderBacklinksReport · template", () => {
  it("is a self-contained document with no external resources or script", () => {
    const html = render(makeFixture());

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/<script/);
  });

  it("carries no reference-product branding", () => {
    // Guards the comments too — the word has slipped in through a code
    // comment before.
    expect(render(makeFixture())).not.toMatch(/semrush/i);
  });

  it("escapes the user-controlled domain", () => {
    const html = render(makeFixture(), {
      domain: "<script>alert(1)</script>.evil.com",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps all six KPI cells, showing n/a for the two with no source", () => {
    const html = render(makeFixture());

    for (const label of [
      "Referring Domains",
      "Backlinks",
      "Monthly Visits",
      "Organic Traffic",
      "Outbound Domains",
      "Overall Toxicity Score",
    ]) {
      expect(html).toContain(label);
    }
    const strip = kpiStrip(html);
    expect(countMatches(strip, /class="kpi"/g)).toBe(6);
    expect(countMatches(strip, /kpi-value kpi-value--empty/g)).toBe(2);
  });

  it("renders an alternative KPI set, in order, with every cell sourced", () => {
    // The swap the product call would make: the two cells DataForSEO has no
    // endpoint for, replaced by the two it does. Proving it here is the
    // point of the refactor — otherwise nobody knows the alternative works
    // until the day they need it.
    const cells: readonly KpiKey[] = [
      "referringDomains",
      "backlinks",
      "referringPages",
      "organicTraffic",
      "brokenBacklinks",
      "toxicity",
    ];
    // Scoped to the strip: "Outbound Domains" is also a tab label up in the
    // shell, so asserting its absence page-wide would test the wrong thing.
    const strip = kpiStrip(render(makeFixture(), { kpiCells: cells }));

    expect(countMatches(strip, /class="kpi"/g)).toBe(6);
    // Not one n/a left: every cell in this set has a real source.
    expect(countMatches(strip, /kpi-value kpi-value--empty/g)).toBe(0);
    expect(strip).toContain("Referring Pages");
    expect(strip).toContain("Broken Backlinks");
    expect(strip).not.toContain("Monthly Visits");
    expect(strip).not.toContain("Outbound Domains");
    // Order follows the list, not the payload.
    expect(strip.indexOf("Referring Pages")).toBeLessThan(
      strip.indexOf("Broken Backlinks"),
    );
  });

  it("draws the ten authority buckets and declares the sample they came from", () => {
    const html = render(makeFixture());

    expect(html).toContain("Referring Domains by Authority Score");
    expect(html).toContain("Based on the top 6,240 referring domains");
    // 10 buckets + one type row + one attribute row.
    expect(countMatches(html, /class="brow brow--inline"/g)).toBe(12);
    expect(html).toContain("91 - 100");
    expect(html).toContain("0 - 10");
  });

  it("combines Backlink Types and Link Attributes into one card", () => {
    const html = render(makeFixture());
    const card = html.slice(html.indexOf("Backlink Types"));

    expect(card).toContain("Link Attributes");
    // The divider between the two halves is what makes it one card rather
    // than two stacked ones.
    expect(card).toContain('class="split"');
  });

  it("names the dimension the categories are actually grouped by", () => {
    expect(render(makeFixture())).toContain("Grouped by TLD");
  });

  it("keeps every module and its row count when every source fails", () => {
    const populated = render(makeFixture());
    const failed = render(makeFailedFixture());

    for (const title of [
      "Authority Score",
      "Authority Score Trend",
      "Network Graph",
      "Referring Domains",
      "New and Lost Backlinks",
      "Categories of Referring Domains",
      "Top Anchors",
      "Referring Domains by Authority Score",
      "Backlink Types",
      "Link Attributes",
    ]) {
      expect(failed).toContain(title);
    }
    // Same number of bar rows as the populated page budgets: 5 categories,
    // 10 buckets and 4 + 4 breakdown rows, so nothing below them moves.
    expect(countMatches(failed, /class="brow brow--stacked"/g)).toBe(5);
    expect(countMatches(failed, /class="brow brow--inline"/g)).toBe(18);
    // The populated fixture's own cards keep their min-height class either
    // way, which is what holds the page when a chart degrades.
    expect(countMatches(failed, /class="card card-breakdown"/g)).toBe(
      countMatches(populated, /class="card card-breakdown"/g),
    );
  });
});
