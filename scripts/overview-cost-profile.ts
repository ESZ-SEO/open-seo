import process from "node:process";
import {
  fetchLlmAggregatedMetrics,
  fetchLlmCitedPagesCount,
} from "@/server/lib/dataforseo/ai";
import { fetchBacklinksSummary } from "@/server/lib/dataforseo/backlinks";
import {
  fetchDomainRankOverview,
  fetchHistoricalRankOverview,
  fetchRankedKeywords,
  fetchSerpCompetitors,
} from "@/server/lib/dataforseo/labs";
import {
  buildLlmTarget,
  CHATGPT_LANGUAGE_CODE,
  CHATGPT_LOCATION_CODE,
} from "@/server/lib/dataforseo/shared";
import { resolveMarket } from "@/server/lib/render/reports/shared";
import { applyBillingMarkupUsd } from "@/shared/billing";
import { loadLocalEnv, parseArgs } from "./cli-utils";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));

await main();

/**
 * What one Domain Overview render actually costs at DataForSEO, per endpoint.
 *
 * Mirrors `brand-lookup-cost-profile.ts`, but for the report pipeline in
 * `render/reports/overview-report.ts`: it fires the same calls with the same
 * parameters and prints each one's billed USD from the response envelope.
 *
 * It also isolates `marginalCountryUsd` — the price of one extra
 * `domain_rank_overview`, which is exactly what a fourth row in the rail's
 * country table costs. That number is the open decision on the report: the
 * reference shows four countries, the report shows two, and each extra one
 * is a recurring per-render charge.
 *
 * The report caches renders for 7 days (`RENDER_TTL_SECONDS.overview`), so
 * divide the total by the number of renders a domain gets in a week to reach
 * the real recurring cost.
 *
 * Usage: pnpm billing:overview --domain=example.com --confirmLive=true
 */
async function main() {
  if (process.env.CI === "true" && args.allowCi !== "true") {
    printUsageAndExit(
      "Refusing to run live billing checks in CI without --allowCi=true.",
    );
  }
  if (args.confirmLive !== "true") {
    printUsageAndExit(
      "This command makes live, billable DataForSEO requests. Re-run with --confirmLive=true.",
    );
  }
  if (!process.env.DATAFORSEO_API_KEY) {
    printUsageAndExit("Missing DATAFORSEO_API_KEY.");
  }

  const domain = args.domain;
  if (!domain) printUsageAndExit("Missing --domain.");

  const market = resolveMarket(args.country ?? "ES");
  const llmTarget = buildLlmTarget({ type: "domain", value: domain });
  const calls: CallRecord[] = [];

  /** Run one call, record what DataForSEO charged, and keep going if it
   *  fails — a missing AI Optimization subscription must not hide the price
   *  of the eight endpoints that did answer. */
  async function record(
    label: string,
    run: () => Promise<{ billing: { costUsd: number; path: string[] } }>,
  ) {
    try {
      const { billing } = await run();
      calls.push({
        label,
        path: billing.path.join("/"),
        rawUsd: round(billing.costUsd),
        billedUsd: applyBillingMarkupUsd(billing.costUsd),
      });
    } catch (error) {
      calls.push({
        label,
        path: null,
        rawUsd: null,
        billedUsd: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await record("domain_rank_overview (worldwide)", () =>
    fetchDomainRankOverview({
      target: domain,
      locationCode: 2840,
      languageCode: "en",
    }),
  );
  await record("domain_rank_overview (report market)", () =>
    fetchDomainRankOverview({
      target: domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
  );
  await record("backlinks_summary", () =>
    fetchBacklinksSummary({ target: domain }),
  );
  await record("ranked_keywords (organic sample)", () =>
    fetchRankedKeywords({
      target: domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      limit: 200,
      itemTypes: ["organic"],
    }),
  );
  await record("serp_competitors", () =>
    fetchSerpCompetitors({
      keywords: [domain],
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      itemTypes: ["organic"],
      limit: 10,
    }),
  );
  await record("historical_rank_overview", () =>
    fetchHistoricalRankOverview({
      target: domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
  );
  await record("llm_mentions/aggregated_metrics (chat_gpt)", () =>
    fetchLlmAggregatedMetrics({
      target: llmTarget,
      platform: "chat_gpt",
      locationCode: CHATGPT_LOCATION_CODE,
      languageCode: CHATGPT_LANGUAGE_CODE,
    }),
  );
  await record("llm_mentions/aggregated_metrics (google)", () =>
    fetchLlmAggregatedMetrics({
      target: llmTarget,
      platform: "google",
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
  );
  await record("llm_mentions/top_mentioned_pages (cited pages count)", () =>
    fetchLlmCitedPagesCount({
      target: llmTarget,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
  );
  await record("ranked_keywords (ai_overview_reference count)", () =>
    fetchRankedKeywords({
      target: domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      limit: 1,
      itemTypes: ["ai_overview_reference"],
    }),
  );
  await record("ranked_keywords (other SERP features count)", () =>
    fetchRankedKeywords({
      target: domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      limit: 1,
      itemTypes: ["featured_snippet", "local_pack"],
    }),
  );

  const totalRawUsd = round(
    calls.reduce((sum, call) => sum + (call.rawUsd ?? 0), 0),
  );
  const countryCall = calls.find((call) =>
    call.label.startsWith("domain_rank_overview (report market)"),
  );

  console.log(
    JSON.stringify(
      {
        input: { domain, country: args.country ?? "ES", market },
        calls,
        totals: {
          totalRawUsd,
          totalBilledUsd: applyBillingMarkupUsd(totalRawUsd),
          /** One more `domain_rank_overview` = one more row in the rail's
           *  country table. Null when that call failed. */
          marginalCountryUsd: countryCall?.rawUsd ?? null,
          failedCalls: calls.filter((call) => call.error != null).length,
        },
      },
      null,
      2,
    ),
  );
}

type CallRecord = {
  label: string;
  path: string | null;
  rawUsd: number | null;
  billedUsd: number | null;
  error?: string;
};

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function printUsageAndExit(message: string): never {
  console.error(message);
  console.error(
    "Usage: pnpm billing:overview --domain=example.com --confirmLive=true [--country=ES] [--allowCi=true]",
  );
  process.exit(1);
}
