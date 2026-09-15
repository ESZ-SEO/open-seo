import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable env stand-in: the cache and renderer modules resolve `env` from
// `cloudflare:workers` at module scope.
const mockEnv: Record<string, unknown> = {};
vi.mock("cloudflare:workers", () => ({
  get env() {
    return mockEnv;
  },
}));

const suggestionsMock = vi.hoisted(() => vi.fn());
const relatedMock = vi.hoisted(() => vi.fn());
const adsIdeasMock = vi.hoisted(() => vi.fn());

/* eslint-disable @typescript-eslint/consistent-type-imports */
vi.mock("@/server/lib/dataforseo/labs", async () => {
  const actual = await vi.importActual("@/server/lib/dataforseo/labs");
  return {
    ...actual,
    fetchKeywordSuggestions: suggestionsMock,
    fetchRelatedKeywords: relatedMock,
  };
});

vi.mock("@/server/lib/dataforseo/google-ads", async () => {
  const actual = await vi.importActual("@/server/lib/dataforseo/google-ads");
  return { ...actual, fetchAdsKeywordIdeas: adsIdeasMock };
});

import {
  buildReportCacheKey,
  RENDER_TTL_SECONDS,
} from "@/server/lib/render/cache";
import {
  renderParamsSchema,
  renderReport,
} from "@/server/lib/render/render-report";
import {
  buildKeywordsReportData,
  TABLE_ROW_LIMIT,
  TOPIC_LIMIT,
  type KeywordRow,
  __test,
} from "@/server/lib/render/reports/keywords-report";
/** A table row with only the fields a given assertion cares about set. */
function keywordRow(overrides: Partial<KeywordRow> = {}): KeywordRow {
  return {
    keyword: "a keyword",
    intent: "unknown",
    relevance: null,
    volume: null,
    difficulty: null,
    cpc: null,
    serpFeatureCount: null,
    results: null,
    updated: null,
    ...overrides,
  };
}

/** One Labs keyword item, with only the fields the mapper reads. */
function labsItem(
  keyword: string,
  overrides: {
    volume?: number | null;
    difficulty?: number | null;
    cpc?: number | null;
    intent?: string | null;
  } = {},
) {
  return {
    keyword,
    keyword_info: {
      search_volume: overrides.volume ?? 100,
      cpc: overrides.cpc ?? 0.5,
    },
    keyword_properties: { keyword_difficulty: overrides.difficulty ?? 30 },
    search_intent_info: { main_intent: overrides.intent ?? "commercial" },
  };
}

function labsResponse(items: unknown[]) {
  return { data: items, billing: { costUsd: 0.01, path: ["keywords"] } };
}

/** The HTML the renderer was asked to screenshot. Narrowed rather than cast:
 *  `JSON.parse` returns `any`, and an `any` walking into an assertion is how a
 *  test quietly stops testing anything. */
function renderedHtml(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("expected the renderer request body to be a JSON string");
  }
  const parsed: unknown = JSON.parse(body);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("html" in parsed) ||
    typeof parsed.html !== "string"
  ) {
    throw new Error("renderer payload carried no html");
  }
  return parsed.html;
}

beforeEach(() => {
  suggestionsMock.mockResolvedValue(labsResponse([]));
  relatedMock.mockResolvedValue(labsResponse([]));
  adsIdeasMock.mockResolvedValue(labsResponse([]));
});

describe("buildKeywordsReportData", () => {
  it("orders the table by volume and caps it at the rendered row count", async () => {
    const items = Array.from({ length: TABLE_ROW_LIMIT + 5 }, (_, i) =>
      labsItem(`seed idea ${i}`, { volume: i * 10 }),
    );
    suggestionsMock.mockResolvedValue(labsResponse(items));

    const data = await buildKeywordsReportData({
      keyword: "seed",
      country: "ES",
    });

    const rows = data.tables.keywords.value;
    expect(rows).toHaveLength(TABLE_ROW_LIMIT);
    expect(rows[0].volume).toBe((TABLE_ROW_LIMIT + 4) * 10);
    // The summary describes the whole retrieved set, not the rendered slice.
    expect(data.sampleSize).toBe(TABLE_ROW_LIMIT + 5);
    expect(data.summary.keywordCount.value).toBe(TABLE_ROW_LIMIT + 5);
  });

  it("falls back to related keywords only when suggestions came back empty", async () => {
    relatedMock.mockResolvedValue(
      labsResponse([{ keyword_data: labsItem("related idea") }]),
    );

    const data = await buildKeywordsReportData({
      keyword: "seed",
      country: "ES",
    });

    expect(relatedMock).toHaveBeenCalledTimes(1);
    expect(data.tables.keywords.value[0].keyword).toBe("related idea");

    // A suggestions response with rows must not buy a second request.
    suggestionsMock.mockResolvedValue(labsResponse([labsItem("seed idea")]));
    relatedMock.mockClear();
    await buildKeywordsReportData({ keyword: "seed", country: "ES" });
    expect(relatedMock).not.toHaveBeenCalled();
  });

  it("routes a Google-Ads-only market to the ads endpoint", async () => {
    adsIdeasMock.mockResolvedValue(
      labsResponse([{ keyword: "ads idea", search_volume: 40, cpc: 1.5 }]),
    );

    // Andorra is flagged googleAdsOnly in the location catalogue.
    const data = await buildKeywordsReportData({
      keyword: "seed",
      country: "AD",
    });

    expect(suggestionsMock).not.toHaveBeenCalled();
    const row = data.tables.keywords.value[0];
    expect(row.keyword).toBe("ads idea");
    // That API reports neither difficulty nor intent — neither may be invented.
    expect(row.difficulty).toBeNull();
    expect(row.intent).toBe("unknown");
    expect(data.summary.averageDifficulty.value).toBeNull();
  });

  it("degrades every cell together when the request fails", async () => {
    suggestionsMock.mockRejectedValue(new Error("upstream down"));

    const data = await buildKeywordsReportData({
      keyword: "seed",
      country: "ES",
    });

    expect(data.healthy).toBe(false);
    expect(data.sampleSize).toBe(0);
    for (const cell of Object.values(data.summary)) {
      expect(cell).toEqual({ value: null, source: "error" });
    }
    expect(data.tables.keywords).toEqual({ value: [], source: "error" });
    expect(data.tables.topics).toEqual({ value: [], source: "error" });
    // The header still names the market it was asked about.
    expect(data.input.countryName).toBe("Spain");
  });
});

describe("summary reducers", () => {
  it("returns null rather than zero when nothing reports a figure", () => {
    const blank = [keywordRow(), keywordRow()];
    expect(__test.totalVolume(blank)).toBeNull();
    expect(__test.averageDifficulty(blank)).toBeNull();
  });

  it("sums and averages only the rows that carry a figure", () => {
    const rows = [
      keywordRow({ volume: 100, difficulty: 10 }),
      keywordRow(),
      keywordRow({ volume: 50, difficulty: 25 }),
    ];
    expect(__test.totalVolume(rows)).toBe(150);
    // 17.5 rounds to 18 — the mean of the two rows that answered, not of three.
    expect(__test.averageDifficulty(rows)).toBe(18);
  });
});

describe("topicRows", () => {
  /** The reducer reads only `keyword`; the rest of the row is filler. */
  function rows(...keywords: string[]): KeywordRow[] {
    return keywords.map((keyword) => keywordRow({ keyword }));
  }

  it("counts the keywords that actually carry each term", () => {
    const topics = __test.topicRows(
      rows(
        "cheesecake delivery near me",
        "vegan cheesecake near me",
        "vegan cheesecake box",
      ),
      "cheesecake",
    );
    const byTopic = new Map(topics.map((t) => [t.topic, t.keywords]));
    expect(byTopic.get("near")).toBe(2);
    expect(byTopic.get("vegan")).toBe(2);
  });

  it("names topics by what distinguishes the rows, never by the seed", () => {
    const topics = __test.topicRows(
      rows("cheesecake delivery fast", "cheesecake delivery cheap"),
      "cheesecake delivery",
    );
    // The seed's words are in every row, so they can't appear in a label at
    // all — not alone, and not riding along inside a phrase.
    for (const { topic } of topics) {
      expect(topic.split(" ")).not.toContain("cheesecake");
      expect(topic.split(" ")).not.toContain("delivery");
    }
    expect(topics.map((t) => t.topic)).toEqual(["cheap", "fast"]);
  });

  it("keeps one row per topic when a phrase contains a term already listed", () => {
    const topics = __test.topicRows(
      rows(
        "seed vegan cheesecake",
        "seed vegan cheesecake",
        "seed vegan brownie",
      ),
      "seed",
    );
    // "vegan" covers all three rows; "vegan cheesecake" covers two of them and
    // is the same topic said twice, so only the wider one is listed.
    const listed = topics.map((t) => t.topic);
    expect(listed).toContain("vegan");
    expect(listed).not.toContain("vegan cheesecake");
  });

  it("prefers the fuller phrase when it describes exactly the same rows", () => {
    const topics = __test.topicRows(
      rows("seed gluten free cake", "seed gluten free tart"),
      "seed",
    );
    // "gluten" and "free" each cover both rows, and so does the pair — the
    // pair is the same group named precisely.
    expect(topics.map((t) => t.topic)).toContain("gluten free");
    expect(topics.map((t) => t.topic)).not.toContain("gluten");
  });

  it("honours the row limit", () => {
    const many = rows(
      ...Array.from({ length: 40 }, (_, i) => `seed topic${i}word`),
    );
    expect(__test.topicRows(many, "seed").length).toBeLessThanOrEqual(
      TOPIC_LIMIT,
    );
  });
});

describe("row mapping", () => {
  it("leaves the four unsourced cells unset on both providers", () => {
    const fromLabs = __test.rowFromLabsItem(labsItem("a keyword"));
    const fromAds = __test.rowFromAdsItem({ keyword: "a keyword" });
    for (const row of [fromLabs, fromAds]) {
      expect(row?.relevance).toBeNull();
      expect(row?.results).toBeNull();
      expect(row?.updated).toBeNull();
      expect(row?.serpFeatureCount).toBeNull();
    }
  });

  it("drops a nameless row rather than rendering an unusable one", () => {
    expect(__test.rowFromLabsItem({ keyword: "" })).toBeNull();
    expect(__test.rowFromAdsItem({ keyword: null })).toBeNull();
  });
});

describe("parked builder — the report contract it will fill", () => {
  it("reports no action badge and a page count it can justify", async () => {
    suggestionsMock.mockResolvedValue(
      labsResponse(
        Array.from({ length: TABLE_ROW_LIMIT + 1 }, (_, i) =>
          labsItem(`seed idea ${i}`),
        ),
      ),
    );

    const data = await buildKeywordsReportData({
      keyword: "seed",
      country: "ES",
    });

    // Nothing here measures a request quota or a column count.
    expect(data.actionBadges).toEqual({
      updateMetrics: null,
      manageColumns: null,
    });
    // 31 ideas at 30 rendered rows is 2 pages — arithmetic, not a guess.
    expect(data.pagination).toEqual({ currentPage: 1, totalPages: 2 });
  });
});

describe("keywords report wiring", () => {
  it("accepts the report kind, its optional seed, and has a TTL", () => {
    const parsed = renderParamsSchema.parse({
      report: "keywords",
      domain: "tartas de queso Zaragoza",
      keyword: "tartas de queso Zaragoza",
    });
    expect(parsed.report).toBe("keywords");
    expect(parsed.keyword).toBe("tartas de queso Zaragoza");
    // Shortest of the four: keyword volumes turn over monthly.
    expect(RENDER_TTL_SECONDS.keywords).toBe(7 * 86_400);
  });

  it("keys the cache on the seed, so two searches never collide", async () => {
    const a = await buildReportCacheKey(
      "keywords",
      "cheesecake",
      "ES",
      "desktop",
    );
    const b = await buildReportCacheKey(
      "keywords",
      "brownies",
      "ES",
      "desktop",
    );
    expect(a).not.toBe(b);

    // The same string as a domain report is a different report, so the two
    // kinds can share a subject without sharing a cached PNG.
    const asOverview = await buildReportCacheKey(
      "overview",
      "cheesecake",
      "ES",
      "desktop",
    );
    expect(asOverview).not.toBe(a);

    // And the three domain reports hash exactly as they did before the seed
    // existed — no cached PNG moves because this report shipped.
    const beforeAndAfter = await buildReportCacheKey(
      "overview",
      "x.com",
      "ES",
      "desktop",
    );
    expect(beforeAndAfter).toBe(
      await buildReportCacheKey("overview", "x.com", "ES", "desktop", []),
    );
  });

  it("renders the keyword template end to end, seeded from `keyword`", async () => {
    mockEnv.R2 = {
      async get() {
        return null;
      },
      async put() {},
    };
    mockEnv.RENDERER_URL = "http://renderer.test";
    suggestionsMock.mockResolvedValue(
      labsResponse([labsItem("tartas de queso zaragoza centro")]),
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderReport({
        report: "keywords",
        domain: "unused-for-this-report.com",
        keyword: "tartas de queso Zaragoza",
        country: "ES",
        device: "desktop",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const html = renderedHtml(fetchMock.mock.calls[0]?.[1]);
    // The keyword template, not the E0 shell, fed by `keyword` rather than the
    // domain beside it.
    expect(html).toContain("Keyword Research: ");
    expect(html).toContain("tartas de queso Zaragoza");
    expect(html).toContain("tartas de queso zaragoza centro");
    expect(html).not.toContain("unused-for-this-report.com");
    expect(html).not.toContain("Investigación de keywords");
  });
});
