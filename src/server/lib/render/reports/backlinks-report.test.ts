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
      expect(typeLabels).toContain("Texto");
      expect(typeLabels).toContain("Imagen");

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
        backlinks: { value: 1234, source: "ok" },
        organicTraffic: { value: 5678, source: "ok" },
        referringDomains: { value: 89, source: "ok" },
        toxicity: { value: 12, source: "ok" },
      },
      charts: {
        authorityRadar: {
          value: { axes: [{ label: "x", value: 1 }] },
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
        types: { value: [] as TypeRow[], source: "empty" },
        attributes: { value: [] as AttributeRow[], source: "empty" },
        topAnchors: { value: [] as AnchorRow[], source: "empty" },
      },
    };
    expect(minimal.tiles.authority.value).toBe(70);
    expect(minimal.charts.authorityRadar.value.axes).toHaveLength(1);
  });
});
