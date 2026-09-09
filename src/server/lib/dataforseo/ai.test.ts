import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

// The classifier is built inside ai.ts via createDataforseoBillingClassifier;
// returning our hoisted mock keeps the test off the billing-classification path.
vi.mock("@/server/lib/dataforseoBillingClassification", () => ({
  createDataforseoBillingClassifier: () => () => null,
}));

import { fetchLlmCitedPagesCount } from "@/server/lib/dataforseo/ai";
import { buildLlmTarget } from "@/server/lib/dataforseo/shared";

// A successful DataForSEO task always carries billing metadata (path + cost).
const billed = {
  path: [
    "v3",
    "ai_optimization",
    "llm_mentions",
    "top_mentioned_pages",
    "live",
  ],
  cost: 0.1,
  result_count: 1,
};

function makeCountResponse(result: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        {
          status_code: 20000,
          status_message: "Ok.",
          ...billed,
          result: [result],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const target = buildLlmTarget({ type: "domain", value: "example.com" });

describe("fetchLlmCitedPagesCount", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("asks for the smallest page and never pins a platform, so the count covers both surfaces", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeCountResponse({
        total_count: 42,
        items_count: 1,
        items: [{ page: "https://example.com/guide" }],
      }),
    );

    await fetchLlmCitedPagesCount({
      target,
      locationCode: 2724,
      languageCode: "es",
    });

    const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    const posted: unknown = typeof body === "string" ? JSON.parse(body) : null;
    // Full equality, not a partial match: with `platform` present the count
    // would silently narrow to one surface, and the card would understate.
    expect(posted).toEqual([
      {
        target: [
          {
            domain: "example.com",
            include_subdomains: true,
            search_filter: "include",
            search_scope: ["any"],
          },
        ],
        location_code: 2724,
        language_code: "es",
        limit: 1,
      },
    ]);
  });

  it("returns the endpoint's total_count — the whole answer, not the sampled rows", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeCountResponse({
        total_count: 42,
        items_count: 1,
        items: [{ page: "https://example.com/guide" }],
      }),
    );

    const result = await fetchLlmCitedPagesCount({
      target,
      locationCode: 2724,
      languageCode: "es",
    });

    expect(result.data).toBe(42);
  });

  it("a response without a total_count degrades to null, not an error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeCountResponse({ total_count: null, items_count: 0, items: [] }),
    );

    const result = await fetchLlmCitedPagesCount({
      target,
      locationCode: 2724,
      languageCode: "es",
    });

    expect(result.data).toBeNull();
  });
});
