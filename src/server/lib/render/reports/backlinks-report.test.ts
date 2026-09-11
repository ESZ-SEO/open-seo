import { describe, expect, it } from "vitest";
import {
  __test,
  type BacklinksReportData,
} from "@/server/lib/render/reports/backlinks-report";
import type {
  ReferringDomainItem,
  BacklinksHistoryItem,
  BacklinksItem,
} from "@/server/lib/dataforseo/backlinks";
import type {
  AnchorRow,
  AttributeRow,
  AuthorityBucketRow,
  CategoryRow,
  TypeRow,
} from "@/server/lib/render/reports/backlinks-report";

describe("backlinks-report · helpers", () => {
  describe("resolveMarket", () => {
    it("maps the ES shortLabel to Spain", () => {
      const market = __test.resolveMarket("ES");
      expect(market.locationCode).toBe(2724);
      expect(market.languageCode).toBe("es");
      expect(market.countryLabel).toBe("ES");
    });

    it("falls back to ES for unknown countries (never throws)", () => {
      const market = __test.resolveMarket("ZZ");
      expect(market.locationCode).toBe(2724);
      expect(market.countryLabel).toBe("ZZ");
    });
  });

  describe("computeAuthorityScore", () => {
    it("returns null when rank is missing", () => {
      expect(__test.computeAuthorityScore({})).toBeNull();
    });

    it("returns rank minus spam penalty, clamped to [0,100]", () => {
      expect(
        __test.computeAuthorityScore({
          rank: 80,
          backlinks_spam_score: 0,
        }),
      ).toBe(80);
      expect(
        __test.computeAuthorityScore({
          rank: 80,
          backlinks_spam_score: 30,
        }),
      ).toBe(72); // 80 − round(30 * 0.25) = 80 − 8 = 72
      expect(
        __test.computeAuthorityScore({
          rank: 80,
          backlinks_spam_score: 90,
        }),
      ).toBe(57); // 80 − round(90 * 0.25) = 80 − 23 = 57
      expect(
        __test.computeAuthorityScore({
          rank: 1,
          backlinks_spam_score: 80,
        }),
      ).toBe(0);
    });
  });

  describe("pickOrganicTraffic", () => {
    it("pulls etv from metrics.organic.etv", () => {
      expect(
        __test.pickOrganicTraffic([{ metrics: { organic: { etv: 1234 } } }]),
      ).toBe(1234);
    });
    it("returns null when metrics are absent", () => {
      expect(__test.pickOrganicTraffic([])).toBeNull();
      expect(__test.pickOrganicTraffic([{}])).toBeNull();
    });
  });

  describe("spamSeverity", () => {
    it("buckets correctly", () => {
      expect(__test.spamSeverity(null)).toBe(0);
      expect(__test.spamSeverity(0)).toBe(0);
      expect(__test.spamSeverity(4)).toBe(0);
      expect(__test.spamSeverity(5)).toBe(1);
      expect(__test.spamSeverity(15)).toBe(2);
      expect(__test.spamSeverity(30)).toBe(3);
      expect(__test.spamSeverity(50)).toBe(4);
    });
  });

  describe("classifyAttributes", () => {
    it("uses rel_attributes when present", () => {
      const result = __test.classifyAttributes({
        item_type: "text",
        rel_attributes: ["nofollow", "ugc"],
      });
      expect(result.type).toBe("text");
      expect(result.attributes).toEqual(["nofollow", "ugc"]);
    });
    it("falls back to dofollow boolean", () => {
      const result = __test.classifyAttributes({
        item_type: "image",
        dofollow: false,
      });
      expect(result.attributes).toEqual(["nofollow"]);
    });
    it("defaults to text + dofollow when nothing is provided", () => {
      const result = __test.classifyAttributes({});
      expect(result.type).toBe("text");
      expect(result.attributes).toEqual(["dofollow"]);
    });
  });

  describe("isoDaysAgo", () => {
    it("returns YYYY-MM-DD", () => {
      const now = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));
      expect(__test.isoDaysAgo(0, now)).toBe("2026-07-15");
      expect(__test.isoDaysAgo(30, now)).toBe("2026-06-15");
    });
  });

  describe("Source helpers", () => {
    it("ok/empty/err encode their source field", () => {
      expect(__test.ok(1).source).toBe("ok");
      expect(__test.empty(0).source).toBe("empty");
      expect(__test.err(0).source).toBe("error");
    });
    it("unwrap returns the value", () => {
      expect(__test.unwrap(__test.ok(42))).toBe(42);
    });
  });

  // `sourceFor` is the exact wiring used for the `referringPages` and
  // `brokenBacklinks` tiles (both `summary.referring_pages` /
  // `summary.broken_backlinks`, resolved the same way `backlinks` and
  // `referringDomains` already are): ok when the summary call succeeded and
  // the field is present, empty when it succeeded without the field, error
  // when the call itself failed.
  describe("sourceFor", () => {
    it("resolves ok when the call succeeded and the field is present", () => {
      expect(__test.sourceFor(true, true, 456)).toEqual({
        value: 456,
        source: "ok",
      });
    });
    it("resolves empty when the call succeeded but the field is missing", () => {
      expect(__test.sourceFor(true, false, null)).toEqual({
        value: null,
        source: "empty",
      });
    });
    it("resolves error when the call itself failed", () => {
      expect(__test.sourceFor(false, false, null)).toEqual({
        value: null,
        source: "error",
      });
    });
  });

  describe("buildNetworkGraph", () => {
    it("centres on target and lays satellites around it deterministically", () => {
      const result = __test.buildNetworkGraph("example.com", [
        { domain: "a.com", backlinks: 100, backlinks_spam_score: 1 },
        { domain: "b.com", backlinks: 80, backlinks_spam_score: 60 },
        { domain: "c.com", backlinks: 60, backlinks_spam_score: 20 },
      ] satisfies ReferringDomainItem[]);
      expect(result.nodes[0].id).toBe("example.com");
      expect(result.nodes.length).toBe(4);
      expect(result.links.length).toBe(3);
    });
  });

  describe("buildHistorySeries", () => {
    it("produces 5 series from rows", () => {
      const series = __test.buildHistorySeries([
        {
          date: "2026-01-01",
          rank: 50,
          referring_domains: 10,
          backlinks: 100,
          new_referring_domains: 2,
          lost_referring_domains: 1,
          new_backlinks: 5,
          lost_backlinks: 3,
        },
        {
          date: "2026-01-15",
          rank: 55,
          referring_domains: 12,
          backlinks: 110,
          new_referring_domains: 3,
          lost_referring_domains: 2,
          new_backlinks: 6,
          lost_backlinks: 4,
        },
        {
          date: "2025-12-01",
          rank: 60,
          referring_domains: 8,
          backlinks: 90,
          new_referring_domains: 1,
          lost_referring_domains: 0,
          new_backlinks: 4,
          lost_backlinks: 2,
        },
      ] satisfies BacklinksHistoryItem[]);
      expect(series.trend).not.toBeNull();
      expect(series.trend?.length).toBe(3);
      // Sorted asc, so 2025-12-01 comes first.
      expect(series.trend?.[0].date).toBe("2025-12-01");
      expect(series.referringArea?.length).toBe(3);
      expect(series.backlinksArea?.length).toBe(3);
    });
  });

  describe("buildTables", () => {
    it("groups rows into categories/types/attributes/anchors", () => {
      const rows = [
        {
          domain_from: "blog.example-a.com",
          url_from: "https://blog.example-a.com/post",
          anchor: "click aquí",
          item_type: "text",
          rel_attributes: ["nofollow"],
          domain_to: "example.com",
          page_from_rank: 50,
        },
        {
          domain_from: "shop.example-b.com",
          url_from: "https://shop.example-b.com/item",
          anchor: "click aquí",
          item_type: "image",
          rel_attributes: ["dofollow"],
          domain_to: "example.com",
          page_from_rank: 70,
        },
        {
          domain_from: "news.example-c.com",
          url_from: "https://news.example-c.com/article",
          anchor: "ver más",
          item_type: "text",
          dofollow: true,
          domain_to: "example.com",
          page_from_rank: 30,
        },
      ] satisfies BacklinksItem[];
      const tables = __test.buildTables(rows);
      // Anchor aggregation
      expect(tables.topAnchors[0].anchor).toBe("click aquí");
      expect(tables.topAnchors[0].backlinks).toBe(2);
      expect(tables.topAnchors[0].domains).toBe(2);

      // Attribute buckets
      const labels = tables.attributes.map((a) => a.attribute).sort();
      expect(labels).toContain("Follow");
      expect(labels).toContain("Nofollow");

      // Types
      const typeLabels = tables.types.map((t) => t.type).sort();
      expect(typeLabels).toContain("Text");
      expect(typeLabels).toContain("Image");

      // Categories (TLD of host)
      const categories = tables.categories.map((c) => c.category).sort();
      expect(categories.length).toBeGreaterThan(0);
    });
  });
});

describe("backlinks-report · BacklinksReportData shape", () => {
  it("matches the contract the template expects", () => {
    const minimal: BacklinksReportData = {
      input: { domain: "example.com", country: "ES", countryLabel: "ES" },
      healthy: true,
      tiles: {
        authority: { value: 70, source: "ok" },
        authorityComposition: { rank: 70, spamPenalty: 5 },
        referringDomains: { value: 89, source: "ok" },
        backlinks: { value: 1234, source: "ok" },
        monthlyVisits: { value: null, source: "empty" },
        organicTraffic: { value: 5678, source: "ok" },
        outboundDomains: { value: null, source: "empty" },
        referringPages: { value: 456, source: "ok" },
        brokenBacklinks: { value: 3, source: "ok" },
        toxicity: { value: 12, source: "ok" },
        deltas: { referringDomains: 0.05, backlinks: null },
      },
      charts: {
        authorityProfile: {
          value: { score: 70, badge: "Strong", axes: [{ label: "x", value: 1 }] },
          source: "ok",
        },
        authorityTrend: { value: { points: [] }, source: "empty" },
        networkGraph: { value: { nodes: [], links: [] }, source: "empty" },
        referringDomainsArea: { value: { points: [] }, source: "empty" },
        backlinksArea: { value: { points: [] }, source: "empty" },
        referringDomainsBars: { value: { points: [] }, source: "empty" },
        backlinksBars: { value: { points: [] }, source: "empty" },
      },
      tables: {
        categories: { value: [] as CategoryRow[], source: "empty" },
        categoriesDimension: "TLD",
        topAnchors: { value: [] as AnchorRow[], source: "empty" },
        authorityDistribution: {
          value: [] as AuthorityBucketRow[],
          source: "empty",
        },
        authorityDistributionSample: 0,
        types: { value: [] as TypeRow[], source: "empty" },
        attributes: { value: [] as AttributeRow[], source: "empty" },
      },
    };
    expect(minimal.tiles.authority.value).toBe(70);
    expect(minimal.charts.authorityProfile.value.axes).toHaveLength(1);
  });
});

describe("backlinks-report · authority profile & distribution", () => {
  describe("buildAuthorityProfile", () => {
    it("emits exactly 3 axes, clamped to [0,100]", () => {
      const profile = __test.buildAuthorityProfile(
        { rank: 150, backlinks_spam_score: 200 },
        50_000_000, // above the log-scale cap
        70,
      );
      expect(profile.axes).toHaveLength(3);
      for (const axis of profile.axes) {
        expect(axis.value).toBeGreaterThanOrEqual(0);
        expect(axis.value).toBeLessThanOrEqual(100);
      }
      expect(profile.score).toBe(70);
      expect(profile.badge).toBe("Industry leader");
    });
  });

  describe("computeDelta", () => {
    it("computes the fractional change from first to last non-null point", () => {
      const delta = __test.computeDelta([
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-08", value: null },
        { date: "2026-01-15", value: 120 },
      ]);
      expect(delta).toBeCloseTo(0.2);
    });

    it("returns null without a real base (no points, one point, or zero base)", () => {
      expect(__test.computeDelta(null)).toBeNull();
      expect(__test.computeDelta([{ date: "2026-01-01", value: 10 }])).toBeNull();
      expect(
        __test.computeDelta([
          { date: "2026-01-01", value: 0 },
          { date: "2026-01-08", value: 10 },
        ]),
      ).toBeNull();
    });
  });

  describe("buildAuthorityDistribution", () => {
    it("always emits all 10 buckets in order, even with an empty list", () => {
      const { rows, sample } = __test.buildAuthorityDistribution([]);
      expect(rows.map((r) => r.range)).toEqual([
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
      ]);
      expect(rows.every((r) => r.count === 0 && r.share === 0)).toBe(true);
      expect(sample).toBe(0);
    });

    it("buckets domains by rank and computes shares over the sampled total", () => {
      const { rows, sample } = __test.buildAuthorityDistribution([
        { domain: "a.com", rank: 95 },
        { domain: "b.com", rank: 95 },
        { domain: "c.com", rank: 5 },
        { domain: "d.com", rank: null },
      ] satisfies ReferringDomainItem[]);
      expect(sample).toBe(3);
      const top = rows.find((r) => r.range === "91 - 100");
      const bottom = rows.find((r) => r.range === "0 - 10");
      expect(top?.count).toBe(2);
      expect(top?.share).toBeCloseTo(2 / 3);
      expect(bottom?.count).toBe(1);
    });
  });
});
