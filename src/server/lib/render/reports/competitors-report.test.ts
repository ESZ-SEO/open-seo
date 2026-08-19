import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

vi.mock("@/server/lib/dataforseoBillingClassification", () => ({
  createDataforseoBillingClassifier: () => () => null,
}));

// Hoist the per-call registries so tests can swap behaviour per case.
const intersectorMock = vi.hoisted(() => vi.fn());

// `eslint-disable` here is intentional — vi.importActual cannot use static
// `import type` inside a vi.mock callback; the inferred shape is fine for tests.
/* eslint-disable @typescript-eslint/consistent-type-imports */
vi.mock("@/server/lib/dataforseo/labs", async () => {
  const actual = await vi.importActual("@/server/lib/dataforseo/labs");
  return {
    ...actual,
    fetchDomainRankOverview: vi.fn(async () => ({
      data: [
        {
          se_type: "google",
          location_code: 2724,
          language_code: "es",
          metrics: {
            organic: { etv: 1234, count: 567 },
            paid: { count: 12, estimated_paid_traffic_cost: 8.5 },
          },
          rank: 42,
        },
      ],
      billing: {
        costUsd: 0.02,
        path: ["dataforseo_labs", "domain_rank_overview"],
      },
    })),
    fetchRankedKeywords: vi.fn(async () => ({
      data: {
        items: [
          {
            keyword_data: {
              keyword: "example.com",
              keyword_info: { search_volume: 100 },
            },
          },
          {
            keyword_data: {
              keyword: "fútbol cerca",
              keyword_info: { search_volume: 200 },
            },
          },
        ],
        totalCount: 2,
      },
      billing: { costUsd: 0.02, path: ["dataforseo_labs", "ranked_keywords"] },
    })),
    fetchDomainIntersection: intersectorMock,
  };
});

vi.mock("@/server/lib/dataforseo/backlinks", async () => {
  const actual = await vi.importActual("@/server/lib/dataforseo/backlinks");
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
  buildCompetitorsReportData,
  __test,
} from "@/server/lib/render/reports/competitors-report";

beforeEach(() => {
  // Default happy path: every pairwise call returns one missing-keyword row.
  intersectorMock.mockReset();
  intersectorMock.mockImplementation(async () => ({
    data: [
      {
        keyword_data: {
          keyword: "missing keyword",
          keyword_info: { search_volume: 500 },
        },
      },
    ],
    billing: {
      costUsd: 0.02,
      path: ["dataforseo_labs", "domain_intersection"],
    },
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildCompetitorsReportData — graceful degradation", () => {
  it("with 2 competitors makes 3 pairwise calls per pair (both+symmetric) × 2", async () => {
    await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["a.com", "b.com"],
    });
    // 2 competitors × 3 calls (intersections=true, intersections=false A→B,
    // intersections=false B→A) = 6.
    expect(intersectorMock).toHaveBeenCalledTimes(6);
  });

  it("with 1 competitor makes 3 pairwise calls", async () => {
    await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["a.com"],
    });
    expect(intersectorMock).toHaveBeenCalledTimes(3);
  });

  it("with 0 competitors makes 0 pairwise calls and produces one row", async () => {
    const data = await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: [],
    });
    expect(intersectorMock).toHaveBeenCalledTimes(0);
    expect(data.rows).toHaveLength(1);
    expect(data.competitorCount).toBe(0);
  });

  it("drops a competitor entry equal to the primary domain (case-insensitive)", async () => {
    const data = await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["Example.com", "a.com"],
    });
    // Only the (primary, a.com) pair should fire — the self-reference is
    // dropped before the pairwise fan-out, not just ignored downstream.
    expect(intersectorMock).toHaveBeenCalledTimes(3);
    expect(data.competitorCount).toBe(1);
    expect(data.rows).toHaveLength(2);
  });

  it("the primary row is flagged role=primary; competitors get role=competitor", async () => {
    const data = await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["a.com"],
    });
    expect(data.rows[0]?.role).toBe("primary");
    expect(data.rows[1]?.role).toBe("competitor");
  });

  it("reports vennFromRealCalls=true when at least one pair succeeded", async () => {
    const data = await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["a.com"],
    });
    expect(data.vennFromRealCalls).toBe(true);
  });

  it("returns venn.error sentinel when every pairwise call rejects", async () => {
    intersectorMock.mockRejectedValue(new Error("boom"));
    const data = await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["a.com"],
    });
    expect(data.venn.source).toBe("error");
  });

  it("clamps the keyword-gap output at INTERSECT_LIMIT rows per tab", async () => {
    // Return 100 rows per call so we definitely overshoot.
    const big = Array.from({ length: 100 }, (_, i) => ({
      keyword_data: {
        keyword: `kw-${i}`,
        keyword_info: { search_volume: 100 + i },
      },
    }));
    intersectorMock.mockResolvedValue({
      data: big,
      billing: { costUsd: 0.02, path: ["x"] },
    });
    const data = await buildCompetitorsReportData({
      domain: "example.com",
      country: "ES",
      competitors: ["a.com"],
    });
    // INTERSECT_LIMIT caps each tab at 30.
    const missing =
      data.keywordGap.missing.source === "ok"
        ? data.keywordGap.missing.value
        : [];
    const weak =
      data.keywordGap.weak.source === "ok" ? data.keywordGap.weak.value : [];
    expect(missing.length).toBeLessThanOrEqual(30);
    expect(weak.length).toBeLessThanOrEqual(30);
  });
});

describe("__test helpers", () => {
  // Synthetic fixtures — the test casts raw literals into the helpers' shape
  // intentionally and we want the cast to stay local to each case.
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  it("computeAuthorityScore null- and rank-missing inputs return null", () => {
    expect(__test.computeAuthorityScore(null)).toBeNull();
    expect(__test.computeAuthorityScore(undefined)).toBeNull();
    expect(
      __test.computeAuthorityScore({
        rank: null,
        backlinks_spam_score: 10,
        target: "x",
      } as unknown as Parameters<typeof __test.computeAuthorityScore>[0]),
    ).toBeNull();
  });

  it("computeAuthorityScore clamps to 0–100 and applies a spam penalty", () => {
    expect(
      __test.computeAuthorityScore({
        rank: 50,
        backlinks_spam_score: 100,
        target: "x",
      } as unknown as Parameters<typeof __test.computeAuthorityScore>[0]),
    ).toBe(25); // 50 - min(25, 100*0.25) = 25
    expect(
      __test.computeAuthorityScore({
        rank: 0,
        backlinks_spam_score: 0,
        target: "x",
      } as unknown as Parameters<typeof __test.computeAuthorityScore>[0]),
    ).toBe(0);
  });

  it("brandShareForDomain counts only keywords containing the leftmost label", () => {
    const ranked = [
      { keyword_data: { keyword: "clubes baratos" } },
      { keyword_data: { keyword: "Clubes Madrid" } },
      { keyword_data: { keyword: "oferta hoteles" } },
      { keyword_data: { keyword: "" } },
    ] as unknown as Parameters<typeof __test.brandShareForDomain>[1];
    const result = __test.brandShareForDomain("clubes.com", ranked);
    expect(result).toEqual({ brand: 2, total: 4 });
  });

  it("brandShareForDomain returns null when there are no keywords", () => {
    expect(__test.brandShareForDomain("a.com", [])).toBeNull();
  });

  it("intersectionToGapRows pulls keyword + volume from intersection items", () => {
    const rows = __test.intersectionToGapRows(
      [
        {
          keyword_data: {
            keyword: "kw",
            keyword_info: { search_volume: 1000 },
          },
        },
        { keyword_data: { keyword: null } },
      ] as unknown as Parameters<typeof __test.intersectionToGapRows>[0],
      "a.com",
    );
    expect(rows).toEqual([{ keyword: "kw", volume: 1000, ownedBy: "a.com" }]);
  });

  it("dedupeByKeyword keeps insertion order and dedupes case-insensitively", () => {
    expect(
      __test.dedupeByKeyword([
        { keyword: "Foo", volume: 1, ownedBy: "a" },
        { keyword: "bar", volume: 2, ownedBy: "b" },
        { keyword: "FOO", volume: 3, ownedBy: "c" },
      ]),
    ).toEqual([
      { keyword: "Foo", volume: 1, ownedBy: "a" },
      { keyword: "bar", volume: 2, ownedBy: "b" },
    ]);
  });

  it("approximateCompIntersection returns the documented 0 bound", () => {
    expect(__test.approximateCompIntersection()).toBe(0);
  });

  it("computeVennCounts returns comp1AndComp2 only when hasComp2=true", () => {
    expect(
      __test.computeVennCounts({
        primaryOnly: 0,
        comp1Only: 0,
        comp2Only: 0,
        primaryAndComp1: 1,
        primaryAndComp2: 2,
        hasComp2: false,
      }).comp1AndComp2,
    ).toBeNull();
    expect(
      __test.computeVennCounts({
        primaryOnly: 0,
        comp1Only: 0,
        comp2Only: 0,
        primaryAndComp1: 1,
        primaryAndComp2: 2,
        hasComp2: true,
      }).comp1AndComp2,
    ).toBe(0);
  });
});
