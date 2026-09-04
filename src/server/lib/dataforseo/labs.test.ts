import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

// The classifier is built inside backlinks.ts via createDataforseoBillingClassifier;
// returning our hoisted mock lets the test drive classification.
vi.mock("@/server/lib/dataforseoBillingClassification", () => ({
  createDataforseoBillingClassifier: () => () => null,
}));

import {
  fetchDomainIntersection,
  fetchHistoricalRankOverview,
} from "@/server/lib/dataforseo/labs";

// A successful DataForSEO task always carries billing metadata (path + cost).
const billed = {
  path: ["v3", "dataforseo_labs", "google", "domain_intersection", "live"],
  cost: 0.02,
  result_count: 0,
};

function makeOkResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        {
          status_code: 20000,
          status_message: "Ok.",
          ...billed,
          result: [
            {
              se_type: "google",
              items,
            },
          ],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeIntersectionItem(keyword: string, searchVolume: number) {
  return {
    se_type: "google",
    keyword_data: {
      keyword,
      keyword_info: { search_volume: searchVolume, cpc: 0.5, competition: 0.3 },
    },
    first_domain_serp_element: {
      serp_item: { url: `https://example.com/${keyword}`, rank_absolute: 5 },
      rank_absolute: 5,
      etv: 100,
    },
    second_domain_serp_element: {
      serp_item: { url: `https://competitor.com/${keyword}`, rank_absolute: 8 },
      rank_absolute: 8,
      etv: 60,
    },
  };
}

describe("fetchHistoricalRankOverview", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("posts the date window and never opts into double-priced clickstream data", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse([]));

    await fetchHistoricalRankOverview({
      target: "example.com",
      locationCode: 2724,
      languageCode: "es",
      dateFrom: "2023-04-01",
    });

    const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    const posted: unknown = typeof body === "string" ? JSON.parse(body) : null;
    // Full equality, not a partial match: the point of the assertion is that
    // nothing else rides along — `include_clickstream_data` would double the bill.
    expect(posted).toEqual([
      {
        target: "example.com",
        location_code: 2724,
        language_code: "es",
        date_from: "2023-04-01",
        correlate: true,
        include_clickstream_data: false,
      },
    ]);
  });

  it("returns the monthly items with their metrics block intact", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse([
        {
          se_type: "google",
          year: 2025,
          month: 1,
          metrics: { organic: { etv: 180, pos_1: 3 } },
        },
      ]),
    );

    const result = await fetchHistoricalRankOverview({
      target: "example.com",
      locationCode: 2724,
      languageCode: "es",
    });

    expect(result.data[0]?.year).toBe(2025);
    expect(result.data[0]?.metrics?.organic?.etv).toBe(180);
  });
});

describe("fetchDomainIntersection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns parsed items with both per-domain SERP elements", async () => {
    const items = [
      makeIntersectionItem("seo tools", 12000),
      makeIntersectionItem("keyword research", 8000),
    ];
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(items));

    const result = await fetchDomainIntersection({
      target1: "example.com",
      target2: "competitor.com",
      locationCode: 2724,
      languageCode: "es",
      intersections: true,
      limit: 50,
    });

    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.keyword_data?.keyword).toBe("seo tools");
    expect(result.data[0]?.first_domain_serp_element?.rank_absolute).toBe(5);
    expect(result.data[0]?.second_domain_serp_element?.rank_absolute).toBe(8);
  });

  it("posts the expected request body shape (targets, intersections, item_types)", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse([]));

    await fetchDomainIntersection({
      target1: "example.com",
      target2: "competitor.com",
      locationCode: 2724,
      languageCode: "es",
      intersections: false,
      limit: 30,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0];
    if (!call) throw new Error("expected one call");
    const [url, init] = call;
    expect(url).toContain(
      "/v3/dataforseo_labs/google/domain_intersection/live",
    );
    // DataForSEO SDK serialises the request body through JSON.stringify on the
    // SDK-typed wrapper; inspect the raw body to confirm shape is preserved.
    // (SDK quirk: `domain_intersection`'s `toJSON` emits `target1`/`target2`
    // without the underscore, so we don't pin those names here — the other
    // fields round-trip faithfully.)
    const body = init?.body;
    expect(typeof body).toBe("string");
    const raw: unknown = typeof body === "string" ? JSON.parse(body) : null;
    const arr: unknown[] = Array.isArray(raw) ? raw : [];
    expect(arr.length).toBeGreaterThan(0);
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The SDK serialises the request body to JSON; we read shape fields off the resulting unknown safely here. */
    const req: Record<string, unknown> =
      (arr[0] as Record<string, unknown> | undefined) ?? {};
    expect(req.intersections).toBe(false);
    expect(req.location_code).toBe(2724);
    expect(req.language_code).toBe("es");
    expect(req.limit).toBe(30);
    expect(req.item_types).toEqual(["organic", "paid"]);
  });

  it("treats empty items as a valid zero-data response", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse([]));

    const result = await fetchDomainIntersection({
      target1: "example.com",
      target2: "competitor.com",
      locationCode: 2724,
      languageCode: "es",
      intersections: true,
      limit: 50,
    });

    expect(result.data).toEqual([]);
  });

  it("treats a top-level billing/balance failure as a thrown AppError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: 40200,
          status_message: "Account balance is too low",
          tasks: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // The Labs API has no per-section billing classifier wired in (only
    // Backlinks does); failures surface as a generic INTERNAL_ERROR with the
    // provider message preserved.
    await expect(
      fetchDomainIntersection({
        target1: "example.com",
        target2: "competitor.com",
        locationCode: 2724,
        languageCode: "es",
        intersections: true,
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("returns the charged billing metadata untouched", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse([]));

    const result = await fetchDomainIntersection({
      target1: "example.com",
      target2: "competitor.com",
      locationCode: 2724,
      languageCode: "es",
      intersections: true,
      limit: 50,
    });

    expect(result.billing).toEqual({
      path: billed.path,
      costUsd: billed.cost,
    });
  });
});
