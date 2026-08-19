import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

vi.mock("@/server/lib/dataforseoBillingClassification", () => ({
  createDataforseoBillingClassifier: () => () => null,
}));

// Hoist per-call registries so tests can swap behaviour per case.
const overviewMock = vi.hoisted(() => vi.fn());
const rankedMock = vi.hoisted(() => vi.fn());
const serpCompetitorsMock = vi.hoisted(() => vi.fn());

/* eslint-disable @typescript-eslint/consistent-type-imports */
vi.mock("@/server/lib/dataforseo/labs", async () => {
  const actual = await vi.importActual("@/server/lib/dataforseo/labs");
  return {
    ...actual,
    fetchDomainRankOverview: overviewMock,
    fetchRankedKeywords: rankedMock,
    fetchSerpCompetitors: serpCompetitorsMock,
  };
});

vi.mock("@/server/lib/dataforseo/backlinks", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/lib/dataforseo/backlinks")
  >("@/server/lib/dataforseo/backlinks");
  return {
    ...actual,
    fetchBacklinksSummary: vi.fn(async () => ({
      data: {
        target: "example.com",
        rank: 80,
        backlinks: 500,
        referring_domains: 120,
        backlinks_spam_score: 5,
        info: { target_spam_score: 7 },
      },
      billing: { costUsd: 0.02, path: ["backlinks", "summary"] },
    })),
  };
});

import {
  buildOverviewReportData,
  getHistoricalTrafficSeries,
  __test,
  KEYWORD_BUCKETS,
  KEYWORD_BUCKET_LABELS,
} from "@/server/lib/render/reports/overview-report";

function labsItemWithOrganic(
  organic: { etv: number; count: number },
  rank = 50,
) {
  return {
    se_type: "google",
    location_code: 2724,
    language_code: "es",
    metrics: { organic },
    rank,
  };
}

function rankedKeywordItem(rankGroup: number | null) {
  return {
    keyword_data: {
      keyword: "kw",
      keyword_info: { search_volume: 100 },
    },
    ranked_serp_element: {
      rank_absolute: rankGroup ?? 999,
      serp_item: rankGroup != null ? { rank_group: rankGroup } : {},
    },
  };
}

beforeEach(() => {
  overviewMock.mockReset();
  // Default healthy: world + country both return sensible numbers.
  overviewMock.mockImplementation(async (input: { locationCode: number }) => ({
    data: [
      // The "worldwide" sentinel (2840) returns world traffic; others
      // return 1/10 of the world so the share stays 10%.
      labsItemWithOrganic(
        input.locationCode === 2840
          ? { etv: 1000, count: 500 }
          : { etv: 100, count: 50 },
      ),
    ],
    billing: {
      costUsd: 0.02,
      path: ["dataforseo_labs", "domain_rank_overview"],
    },
  }));

  rankedMock.mockReset();
  rankedMock.mockResolvedValue({
    data: {
      items: [
        rankedKeywordItem(1),
        rankedKeywordItem(2),
        rankedKeywordItem(3),
        rankedKeywordItem(7),
        rankedKeywordItem(15),
        rankedKeywordItem(40),
        rankedKeywordItem(80),
        rankedKeywordItem(null),
        rankedKeywordItem(150),
      ],
      totalCount: 9,
    },
    billing: { costUsd: 0.02, path: ["dataforseo_labs", "ranked_keywords"] },
  });

  serpCompetitorsMock.mockReset();
  serpCompetitorsMock.mockResolvedValue({
    data: [
      { domain: "a.com", serp_item: { rank_absolute: 1 } },
      { domain: "b.com", serp_item: { rank_absolute: 2 } },
      { domain: "c.com", serp_item: { rank_absolute: 3 } },
    ],
    billing: { costUsd: 0.02, path: ["dataforseo_labs", "serp_competitors"] },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildOverviewReportData — graceful degradation", () => {
  it("returns a healthy payload when every fetch resolves", async () => {
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    expect(data.healthy).toBe(true);
  });

  it("fans out to fetchDomainRankOverview (world + country), backlinks, ranked keywords, serp competitors, and historical", async () => {
    await buildOverviewReportData({ domain: "example.com", country: "ES" });
    expect(overviewMock).toHaveBeenCalledTimes(2);
    expect(rankedMock).toHaveBeenCalledTimes(1);
    expect(serpCompetitorsMock).toHaveBeenCalledTimes(1);
  });

  it("maps the country short label to a DataForSEO location code via resolveMarket", async () => {
    await buildOverviewReportData({ domain: "example.com", country: "ES" });
    expect(overviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ locationCode: 2724, languageCode: "es" }),
    );
  });

  it("outputs countryLabel=ES in the input block", async () => {
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    expect(data.input.countryLabel).toBe("ES");
    expect(data.input.country).toBe("ES");
  });
});

describe("buildOverviewReportData — honest degradation", () => {
  it("marks healthy=false when a fetch rejects", async () => {
    rankedMock.mockRejectedValue(new Error("boom"));
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    expect(data.healthy).toBe(false);
  });

  it("downgrades affected Source cells to 'error' when the underlying fetch rejects", async () => {
    rankedMock.mockRejectedValue(new Error("boom"));
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    expect(data.tiles.organicTraffic.source).toBe("error");
    expect(data.tiles.paidTraffic.source).toBe("error");
    expect(data.tiles.organicKeywords.source).toBe("error");
  });

  it("keeps tiles that did not depend on the rejected fetch as 'ok'", async () => {
    rankedMock.mockRejectedValue(new Error("boom"));
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    // Backlinks comes from the backlinks fetcher, not the ranked one.
    expect(data.tiles.backlinks.source).toBe("ok");
    expect(data.tiles.authority.source).toBe("ok");
  });
});

describe("bucketing", () => {
  it("puts rank 1..3 into top3, 4..10 into rank4to10, …, 51..100 into rank51to100, beyond 100 into serpFeatures", async () => {
    rankedMock.mockResolvedValue({
      data: {
        items: [
          rankedKeywordItem(1),
          rankedKeywordItem(3),
          rankedKeywordItem(4),
          rankedKeywordItem(10),
          rankedKeywordItem(11),
          rankedKeywordItem(20),
          rankedKeywordItem(21),
          rankedKeywordItem(50),
          rankedKeywordItem(51),
          rankedKeywordItem(100),
          rankedKeywordItem(101),
        ],
        totalCount: 11,
      },
      billing: { costUsd: 0.02, path: ["x"] },
    });

    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    const counts = data.charts.keywordBuckets.value.counts;
    expect(counts.top3).toBe(2);
    expect(counts.rank4to10).toBe(2);
    expect(counts.rank11to20).toBe(2);
    expect(counts.rank21to50).toBe(2);
    expect(counts.rank51to100).toBe(2);
    expect(counts.serpFeatures).toBe(1);
  });

  it("falls back to rank_absolute when rank_group is missing", async () => {
    rankedMock.mockResolvedValue({
      data: {
        items: [
          {
            keyword_data: { keyword: "kw", keyword_info: { search_volume: 1 } },
            ranked_serp_element: {
              rank_absolute: 5,
              serp_item: { rank_absolute: 5 },
            },
          },
        ],
        totalCount: 1,
      },
      billing: { costUsd: 0.02, path: ["x"] },
    });

    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    expect(data.charts.keywordBuckets.value.counts.rank4to10).toBe(1);
  });

  it("returns zeros for every bucket when there are no keywords", async () => {
    rankedMock.mockResolvedValue({
      data: { items: [], totalCount: 0 },
      billing: { costUsd: 0.02, path: ["x"] },
    });
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    const counts = data.charts.keywordBuckets.value.counts;
    for (const b of KEYWORD_BUCKETS) {
      expect(counts[b]).toBe(0);
    }
  });
});

describe("country distribution table", () => {
  it("emits two rows: WW + the requested country", async () => {
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    const rows = data.tables.countries.value;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.countryCode)).toEqual(["WW", "ES"]);
  });

  it("computes the country share as countryTraffic / worldTraffic", async () => {
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    const country = data.tables.countries.value[1];
    expect(country.share).toBeCloseTo(0.1, 5); // 100 / 1000
  });

  it("passes traffic through to the country row", async () => {
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    const country = data.tables.countries.value[1];
    expect(country.traffic).toBe(100);
    expect(country.keywords).toBe(50);
  });
});

describe("tiles", () => {
  it("produces the 5 spec tiles + 4 sub-stats", async () => {
    const data = await buildOverviewReportData({
      domain: "example.com",
      country: "ES",
    });
    expect(data.tiles.authority.value).toBe(79); // 80 - round(5*0.25)=79
    expect(data.tiles.organicTraffic.value).toBe(100);
    expect(data.tiles.paidTraffic.value).toBe(null); // paid.etv not set
    expect(data.tiles.backlinks.value).toBe(500);
    expect(data.tiles.referringDomains.value).toBe(120);
    expect(data.tiles.trafficShare.value).toBeCloseTo(0.1, 5);
    expect(data.tiles.organicKeywords.value).toBe(50);
    expect(data.tiles.competitorsCount.value).toBe(3);
  });
});

describe("getHistoricalTrafficSeries (E3.4 stub)", () => {
  it("returns an empty array — the E3.4 implementation will populate it", async () => {
    const series = await getHistoricalTrafficSeries("example.com");
    expect(series).toEqual([]);
  });
});

describe("__test helpers", () => {
  it("bucketForKeyword falls back to serpFeatures when no rank is available", () => {
    const item = {
      keyword_data: { keyword: "kw" },
      ranked_serp_element: { serp_item: {} },
    };
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- synthetic fixture for the helper */
    expect(
      __test.bucketForKeyword(
        item as unknown as Parameters<typeof __test.bucketForKeyword>[0],
      ),
    ).toBe("serpFeatures");
  });

  it("countryLabelFor maps 'WW' to 'Todo el mundo'", () => {
    expect(__test.countryLabelFor("WW")).toBe("Todo el mundo");
    expect(__test.countryLabelFor("ES")).toBe("ES");
  });

  it("emptyBucketCounts returns 0 for every key", () => {
    const counts = __test.emptyBucketCounts();
    for (const b of KEYWORD_BUCKETS) {
      expect(counts[b]).toBe(0);
    }
    expect(counts).toHaveProperty("top3");
    expect(counts).toHaveProperty("rank4to10");
    expect(counts).toHaveProperty("rank11to20");
    expect(counts).toHaveProperty("rank21to50");
    expect(counts).toHaveProperty("rank51to100");
    expect(counts).toHaveProperty("serpFeatures");
  });

  it("totalBuckets sums across the buckets", () => {
    expect(
      __test.totalBuckets({ ...__test.emptyBucketCounts(), top3: 5 }),
    ).toBe(5);
  });

  it("KEYWORD_BUCKET_LABELS has a label for every bucket", () => {
    for (const b of KEYWORD_BUCKETS) {
      expect(KEYWORD_BUCKET_LABELS[b]).toBeTruthy();
    }
  });
});
