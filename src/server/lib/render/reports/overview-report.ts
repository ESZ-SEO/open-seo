/* eslint-disable max-lines -- Single-file service: data fetchers + reducers + types exported for tests. Splitting would scatter the report contract across modules without simplifying reading. */
import {
  fetchLlmAggregatedMetrics,
  fetchLlmCitedPagesCount,
} from "@/server/lib/dataforseo/ai";
import {
  fetchBacklinksSummary,
  type BacklinksSummaryItem,
} from "@/server/lib/dataforseo/backlinks";
import {
  buildLlmTarget,
  CHATGPT_LANGUAGE_CODE,
  CHATGPT_LOCATION_CODE,
  type LlmPlatform,
} from "@/server/lib/dataforseo/shared";
import type { LlmAggregatedTotal } from "@/server/lib/dataforseoLlmSchemas";
import {
  fetchDomainRankOverview,
  fetchDomainRankOverviewByLocation,
  fetchHistoricalRankOverview,
  fetchRankedKeywords,
  fetchSerpCompetitors,
  type DomainMetricsItem,
  type DomainRankOverviewLocaleItem,
  type DomainRankOverviewMetrics,
  type DomainRankedKeywordItem,
  type HistoricalRankOverviewItem,
  type SerpCompetitorItem,
} from "@/server/lib/dataforseo/labs";
import { LOCATION_OPTIONS } from "@/shared/keyword-locations";
import {
  computeAuthorityScore,
  resolveMarket,
  type ResolvedMarket,
} from "@/server/lib/render/reports/shared";

/**
 * Service: build the data needed by the Domain Overview report template (E3).
 *
 * The Overview report is the "1-page summary" of a domain — it composes the
 * tiles that E1/E2 already compute (authority, traffic, backlinks) plus two
 * pieces unique to this view:
 *  1. Country distribution (Labs `domain_rank_overview` per location).
 *  2. Keyword distribution by bucket (Top 3 / 4–10 / 11–20 / 21–50 / 51–100 /
 *     101+) — bucketed by `rank_group` (organic-only), with
 *     `rank_absolute` as the fallback when the API doesn't expose a `rank_group`
 *     (see E3.1 — `rank_group` was added to `rankedSerpItemSchema` for this).
 *
 * The historical series (E3.4) comes from Labs `historical_rank_overview`
 * (see {@link getHistoricalSeries}), which returns one metrics block per
 * month back to 2020-10 — so the report never had to grow its own snapshot
 * table. When that call fails the series degrades to `[]` and the template
 * falls back to its honest "not enough history" placeholder.
 *
 * Like the other reports, this layer uses `Promise.allSettled` and the
 * `Source<T>` cell-level error signal so a single failed endpoint never
 * blanks the whole PNG.
 */

export type BuildOverviewReportInput = {
  domain: string;
  /** ISO short label from the endpoint (`"ES"`, `"US"`, …). */
  country: string;
};

/* ----------------------------- Sources / helpers ----------------------------- */

type Source<T> = { value: T; source: "ok" | "empty" | "error" };

function ok<T>(value: T): Source<T> {
  return { value, source: "ok" };
}
function empty<T>(fallback: T): Source<T> {
  return { value: fallback, source: "empty" };
}
function err<T>(fallback: T): Source<T> {
  return { value: fallback, source: "error" };
}

/* ----------------------------- Types ----------------------------- */

/** Keyword bucket the spec A.1 stacked area chart wants. */
export type KeywordBucket =
  | "top3"
  | "rank4to10"
  | "rank11to20"
  | "rank21to50"
  | "rank51to100"
  | "beyond100";

/** Labels and ordering for the buckets — kept in one place so the
 *  template and the service agree on the legend order. */
export const KEYWORD_BUCKETS: KeywordBucket[] = [
  "top3",
  "rank4to10",
  "rank11to20",
  "rank21to50",
  "rank51to100",
  "beyond100",
];

export const KEYWORD_BUCKET_LABELS: Record<KeywordBucket, string> = {
  top3: "Top 3",
  rank4to10: "4–10",
  rank11to20: "11–20",
  rank21to50: "21–50",
  rank51to100: "51–100",
  beyond100: "Más de 100",
};

/** One row of the "Distribución por países" table. */
export type CountryRow = {
  /** ISO short label ("WW" for world, "ES" for Spain, …). */
  countryCode: string;
  /** Display label (e.g. "Todo el mundo", "España"). */
  countryLabel: string;
  /** Fraction of total organic traffic (0–1). */
  share: number | null;
  /** Estimated monthly organic traffic. */
  traffic: number | null;
  /** Total organic keywords the domain ranks for in this country. */
  keywords: number | null;
};

/** One row of the "Top Organic Keywords" table in the bottom grid. Built from
 *  the same `ranked_keywords` response the bucket chart reads, so the table
 *  costs no extra request. */
export type TopKeywordRow = {
  keyword: string;
  /** DataForSEO's `main_intent`, verbatim; null when it hasn't classified the
   *  keyword. The template abbreviates it to a badge letter. */
  intent: string | null;
  /** Organic position — `rank_group`, with `rank_absolute` as the fallback,
   *  the same precedence {@link bucketForKeyword} uses. */
  position: number | null;
  volume: number | null;
  cpc: number | null;
  /** Estimated traffic value (`etv`) this keyword sends the domain. */
  traffic: number | null;
};

/**
 * The AI Search card's figures.
 *
 * DataForSEO's LLM-mentions database (`/v3/ai_optimization/llm_mentions/*`)
 * indexes exactly two generative surfaces — ChatGPT and Google AI Overview —
 * so those are the only two of the card's four rows that can carry a number.
 * AI Mode and Gemini are not in that database at all (Gemini only appears in
 * `llm_responses`, which answers a prompt live and reports no mention counts).
 *
 * The card's third headline, **AI Visibility, has no source and is closed as
 * such** — re-investigating it costs more than the finding is worth. The whole
 * LLM Mentions surface publishes three metrics per grouping and no more:
 * `mentions`, `ai_search_volume`, and `impressions` (itself deprecated,
 * documented as always `null`). Nothing there expresses a visibility score, a
 * share of voice, a percentage, or an index. The nearest thing the API can
 * support is a share of voice computed against a competitor set via
 * `llm_mentions/cross_aggregated_metrics` — a figure this report would be
 * inventing, since it has no competitor set for the AI surfaces and the
 * denominator would be a choice rather than a measurement. Checked against
 * docs.dataforseo.com on 2026-09-09.
 */
export type AiSearchData = {
  /** Mentions across both indexed surfaces; null when neither answered. */
  mentions: number | null;
  /** ChatGPT mentions. DataForSEO only indexes this surface for US/en, so it
   *  is read at US/en whatever market the report is for — the same rule the
   *  Brand Lookup feature applies. */
  chatGptMentions: number | null;
  /** Google AI Overview mentions, in the report's own market. */
  aiOverviewMentions: number | null;
  /** Distinct pages of the domain that LLM answers cite, across both indexed
   *  surfaces in one request — see {@link fetchLlmCitedPagesCount}. Null when
   *  that request failed or the endpoint reported no count. */
  citedPages: number | null;
};

/**
 * The rail's "Google SERP Positions Distribution" donut — how the domain's
 * Google appearances split between plain organic results, AI Overview
 * citations, and the other SERP features Labs tracks.
 *
 * Each figure is the `total_count` of its own `ranked_keywords` request, so
 * the three are directly comparable. Deriving them from the report's 200-row
 * organic sample instead would restate the request filter as a finding: that
 * call asks for `item_types: ["organic"]`, so the split it can produce is
 * 100 / 0 / 0 whatever the domain actually does.
 */
export type SerpDistribution = {
  organic: number | null;
  aiOverviews: number | null;
  otherFeatures: number | null;
};

/** One point on the "Tráfico orgánico" historical line chart. */
export type TrendPoint = { date: string; value: number | null };

/**
 * Buckets that exist in the monthly history. `historical_rank_overview`
 * reports position ranges only (`pos_1` … `pos_91_100`) and stops there, so
 * `beyond100` stays a present-day-only bucket rather than being back-filled
 * with an invented number.
 */
export type HistoricalKeywordBucket = Exclude<KeywordBucket, "beyond100">;

/** One month of the ranked-keyword bucket history. */
export type BucketTrendPoint = {
  /** `YYYY-MM` — the chart's date formatter passes it through verbatim. */
  date: string;
  counts: Record<HistoricalKeywordBucket, number>;
};

export type HistoricalSeries = {
  organicTraffic: TrendPoint[];
  /** Empty when the domain has no paid presence in any month of the window —
   *  an omitted series is honest, a flat zero line is not. */
  paidTraffic: TrendPoint[];
  keywordBuckets: BucketTrendPoint[];
};

/** Output shape consumed by the Overview template. */
export type OverviewReportData = {
  input: { domain: string; country: string; countryLabel: string };
  /** True iff every cell came back ok. False means at least one is a placeholder. */
  healthy: boolean;
  /** The AI Search card. `empty` when the account has the AI Optimization
   *  subscription but the domain isn't mentioned; `error` when both surface
   *  calls failed. */
  aiSearch: Source<AiSearchData>;
  /** The rail's SERP donut. `ok` only when all three totals arrived — a ring
   *  drawn from two of the three overstates both of them. */
  serpDistribution: Source<SerpDistribution>;
  /** 8 tiles, 2 rows × 4 columns — see `.dev/specs/semrush-2026-exact-clone-spec.md` §6. */
  tiles: {
    authority: Source<number | null>;
    authorityComposition: { rank: number | null; spamPenalty: number };
    organicTraffic: Source<number | null>;
    paidTraffic: Source<number | null>;
    backlinks: Source<number | null>;
    referringDomains: Source<number | null>;
    trafficShare: Source<number | null>;
    organicKeywords: Source<number | null>;
    paidKeywords: Source<number | null>;
    competitorsCount: Source<number | null>;
  };
  /** Distribución por países (sidebar). World + the requested country. */
  tables: {
    countries: Source<CountryRow[]>;
    /** The domain's highest-traffic ranking keywords, most valuable first. */
    topKeywords: Source<TopKeywordRow[]>;
  };
  charts: {
    /** Histórico de tráfico. `points` es la serie orgánica; `paidPoints` está
     *  vacío si el dominio no tuvo presencia de pago en la ventana. */
    trafficTrend: Source<{ points: TrendPoint[]; paidPoints: TrendPoint[] }>;
    /** Barra apilada "Palabras clave orgánicas" por bucket — snapshot de hoy. */
    keywordBuckets: Source<{ counts: Record<KeywordBucket, number> }>;
    /** Los mismos buckets mes a mes (sin `beyond100`, que no existe en el histórico). */
    keywordBucketTrend: Source<{ points: BucketTrendPoint[] }>;
  };
};

/* ----------------------------- Defaults ----------------------------- */

/** Limits used across the per-domain fetches. Tuned to match E1/E2's footprint. */
const RANKED_KEYWORDS_LIMIT = 200;
const SERP_COMPETITORS_LIMIT = 10;

/**
 * How many rows the rail's country table carries.
 *
 * At `2` — the shipped value — the table is "Todo el mundo" + the report's own
 * market, the two rows the report has always drawn, and the extra request
 * below is never made. Raise it and the remaining rows are the domain's
 * biggest other markets, read from ONE `domain_rank_overview` call with no
 * location: the price of showing every market is one request, not one request
 * per market (see {@link fetchDomainRankOverviewByLocation}).
 *
 * The reference capture shows four. Whether to buy that row is a cost
 * decision, and this constant is the whole of it — `pnpm billing:overview`
 * prints the number it should be made with.
 */
const COUNTRY_ROW_LIMIT = 2;
/** The two SERP-feature requests exist for their `total_count` alone — their
 *  rows are never read, so they ask for the smallest page Labs will serve. */
const FEATURE_COUNT_LIMIT = 1;

/* ----------------------------- Charts ----------------------------- */

/** How far back the Traffic / Keywords charts go — matches the "2Y" range
 *  the template offers. The endpoint bills a flat rate per request, so a
 *  wider window costs the same; 24 months is a readability choice. */
const HISTORY_MONTHS = 24;

/** `date_from` for a `HISTORY_MONTHS`-long window ending this month. */
function historyWindowStart(now: Date): string {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (HISTORY_MONTHS - 1), 1),
  );
  return start.toISOString().slice(0, 10);
}

function monthKey(item: HistoricalRankOverviewItem): string | null {
  if (typeof item.year !== "number" || typeof item.month !== "number")
    return null;
  return `${item.year}-${String(item.month).padStart(2, "0")}`;
}

/** A missing position counter means "no keywords there", not "unknown". */
function atPos(value: number | null | undefined): number {
  return value ?? 0;
}

/** The slice of a metrics block that {@link bucketCountsFromMetrics} reads. */
type PositionCounters = Pick<
  DomainRankOverviewMetrics,
  | "pos_1"
  | "pos_2_3"
  | "pos_4_10"
  | "pos_11_20"
  | "pos_21_30"
  | "pos_31_40"
  | "pos_41_50"
  | "pos_51_60"
  | "pos_61_70"
  | "pos_71_80"
  | "pos_81_90"
  | "pos_91_100"
>;

/** Fold the endpoint's 12 position counters into the report's 5 historical
 *  buckets (see {@link HistoricalKeywordBucket}). */
function bucketCountsFromMetrics(
  metrics: PositionCounters | undefined,
): Record<HistoricalKeywordBucket, number> {
  return {
    top3: atPos(metrics?.pos_1) + atPos(metrics?.pos_2_3),
    rank4to10: atPos(metrics?.pos_4_10),
    rank11to20: atPos(metrics?.pos_11_20),
    rank21to50:
      atPos(metrics?.pos_21_30) +
      atPos(metrics?.pos_31_40) +
      atPos(metrics?.pos_41_50),
    rank51to100:
      atPos(metrics?.pos_51_60) +
      atPos(metrics?.pos_61_70) +
      atPos(metrics?.pos_71_80) +
      atPos(metrics?.pos_81_90) +
      atPos(metrics?.pos_91_100),
  };
}

/** Map the raw monthly items to the two series the charts consume, oldest
 *  first. Months without a `year`/`month` can't be placed on an axis, so
 *  they're dropped rather than guessed at. */
function toHistoricalSeries(
  items: HistoricalRankOverviewItem[],
): HistoricalSeries {
  const months = items
    .flatMap((item) => {
      const date = monthKey(item);
      return date ? [{ date, item }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const paidTraffic = months.map(({ date, item }) => ({
    date,
    value: numberOrNull(pickMetrics(item, "paid")?.etv),
  }));

  return {
    organicTraffic: months.map(({ date, item }) => ({
      date,
      value: numberOrNull(pickMetrics(item, "organic")?.etv),
    })),
    paidTraffic: paidTraffic.some((point) => point.value != null)
      ? paidTraffic
      : [],
    keywordBuckets: months.map(({ date, item }) => ({
      date,
      counts: bucketCountsFromMetrics(pickMetrics(item, "organic")),
    })),
  };
}

/**
 * Monthly history for the Traffic and Keywords charts, straight from Labs
 * `historical_rank_overview` (one item per month, no local snapshot table).
 *
 * Both the organic and the paid traffic series come from the same response,
 * so the paid line costs nothing extra.
 */
export async function getHistoricalSeries(input: {
  domain: string;
  market: ResolvedMarket;
  now?: Date;
}): Promise<HistoricalSeries> {
  const { data } = await fetchHistoricalRankOverview({
    target: input.domain,
    locationCode: input.market.locationCode,
    languageCode: input.market.languageCode,
    dateFrom: historyWindowStart(input.now ?? new Date()),
  });
  return toHistoricalSeries(data);
}

/* ----------------------------- Reducers ----------------------------- */

/** Pull the metrics block for one search-engine from a Labs rank-overview row.
 *  Structurally typed because the present-day and historical endpoints carry
 *  the same `metrics` shape on differently-named items. */
function pickMetrics(
  item: DomainMetricsItem | null | undefined,
  se: "organic" | "paid",
): DomainRankOverviewMetrics | undefined {
  if (!item?.metrics) return undefined;
  const m = item.metrics as Record<
    string,
    DomainRankOverviewMetrics | undefined
  >;
  return m[se];
}

/** Extract a numeric metric with a safe fallback. */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Reduce a Labs item to the scalars we surface in the tiles. */
function buildTilesFromLabs(item: DomainMetricsItem | undefined) {
  const organic = pickMetrics(item, "organic");
  const paid = pickMetrics(item, "paid");
  return {
    rank: numberOrNull(item?.rank),
    organicTraffic: numberOrNull(organic?.etv ?? organic?.count ?? null),
    paidTraffic: numberOrNull(paid?.etv ?? paid?.count ?? null),
    organicKeywords: numberOrNull(organic?.count),
    paidKeywords: numberOrNull(paid?.count),
    paidTrafficCost: numberOrNull(paid?.estimated_paid_traffic_cost),
  };
}

/** Mentions for one surface out of a `llm_mentions/aggregated_metrics` total.
 *  The endpoint returns one group element per platform; a missing element is
 *  "not reported", not zero. */
function platformMentions(
  total: LlmAggregatedTotal | undefined,
  platform: LlmPlatform,
): number | null {
  const group = total?.platform?.find((entry) => entry.key === platform);
  return typeof group?.mentions === "number"
    ? Math.round(group.mentions)
    : null;
}

/** Total across the surfaces that answered. Two nulls stay null ("no data");
 *  one null and one number is that number, not a total short by an unknown. */
function sumMentions(a: number | null, b: number | null): number | null {
  return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
}

/** `error` only when every AI Optimization call was rejected; `empty` when they
 *  answered but the domain has no figure on any of them. */
function aiSearchSource(
  value: AiSearchData,
  everyCallFailed: boolean,
): Source<AiSearchData> {
  if (everyCallFailed) return err(value);
  return value.mentions == null && value.citedPages == null
    ? empty(value)
    : ok(value);
}

/** `ok` only when all three totals arrived: a ring missing one segment draws
 *  the other two larger than they are, and says nothing about the gap. */
function serpDistributionSource(
  value: SerpDistribution,
  aFeatureCountFailed: boolean,
): Source<SerpDistribution> {
  if (aFeatureCountFailed) return err(value);
  return Object.values(value).every((count) => count != null)
    ? ok(value)
    : empty(value);
}

/** Country label for an ISO short label; falls back to the uppercased code. */
function countryLabelFor(code: string): string {
  const upper = code.toUpperCase();
  if (upper === "WW") return "Todo el mundo";
  // We don't ship a full i18n catalogue here; the upper-cased short label
  // is faithful to the source (e.g. "ES" → "ES") and the renderer is the
  // place where a richer translation map would live if we ever need it.
  return upper;
}

/** Build a Countries row from a Labs `domain_rank_overview` item. */
function rowFromLabs(
  code: string,
  item: DomainMetricsItem | undefined,
  share: number | null,
): CountryRow {
  const organic = pickMetrics(item, "organic");
  return {
    countryCode: code.toUpperCase(),
    countryLabel: countryLabelFor(code),
    share,
    traffic: numberOrNull(organic?.etv ?? organic?.count ?? null),
    keywords: numberOrNull(organic?.count),
  };
}

/** Country-level DataForSEO location codes, by code. Locations outside this
 *  catalogue (regions, cities) can't be labelled as a country, so the country
 *  table drops them rather than printing a bare location number. */
const COUNTRY_BY_LOCATION_CODE = new Map(
  LOCATION_OPTIONS.map((option) => [option.code, option.shortLabel]),
);

/**
 * The domain's biggest markets after the ones the table already names, from a
 * single all-locations `domain_rank_overview` response.
 *
 * The response carries one row per country-language pair, and DataForSEO's
 * help center is explicit about the reduction: "Do not report a country
 * twice. Sum the etv and count values across all rows sharing the same
 * location_code." So a country that ranks in three languages is one row here,
 * not three. ("How to Get Website Traffic by Country with Domain Rank
 * Overview", dataforseo.com help center, read 2026-09-09.)
 *
 * `share` is scaled against the same worldwide traffic figure the existing
 * rows use, so every row in the table is a fraction of the same denominator.
 */
function topCountryRows(
  items: DomainRankOverviewLocaleItem[],
  options: {
    excludeCodes: ReadonlySet<number>;
    worldTraffic: number | null;
    limit: number;
  },
): CountryRow[] {
  const totals = new Map<number, { traffic: number; keywords: number }>();
  for (const item of items) {
    const code = item.location_code;
    if (typeof code !== "number") continue;
    if (options.excludeCodes.has(code)) continue;
    if (!COUNTRY_BY_LOCATION_CODE.has(code)) continue;

    const organic = pickMetrics(item, "organic");
    const running = totals.get(code) ?? { traffic: 0, keywords: 0 };
    running.traffic += numberOrNull(organic?.etv) ?? 0;
    running.keywords += numberOrNull(organic?.count) ?? 0;
    totals.set(code, running);
  }

  return Array.from(totals.entries())
    .sort(([, a], [, b]) => b.traffic - a.traffic)
    .slice(0, Math.max(0, options.limit))
    .map(([code, sums]) => ({
      countryCode: COUNTRY_BY_LOCATION_CODE.get(code) ?? String(code),
      countryLabel: COUNTRY_BY_LOCATION_CODE.get(code) ?? String(code),
      share:
        options.worldTraffic != null && options.worldTraffic > 0
          ? sums.traffic / options.worldTraffic
          : null,
      traffic: sums.traffic,
      keywords: sums.keywords,
    }));
}

/** Bucket a single ranked keyword by its `rank_group` (with `rank_absolute`
 *  fallback):
 *   - Top 3   → rank <= 3
 *   - 4–10    → 4..10
 *   - 11–20   → 11..20
 *   - 21–50   → 21..50
 *   - 51–100  → 51..100
 *   - 101+    → beyond 100, or no rank at all
 *
 *  There is no SERP-feature bucket here, and there cannot be one: the report
 *  asks `ranked_keywords` for `item_types: ["organic"]`, so a feature can
 *  never appear in this sample. The last bucket used to be labelled "SERP
 *  features" and counted rank > 100 and rank-less rows — a name the request
 *  filter made impossible to earn. The real feature split is a separate
 *  question that needs its own request.
 */
function rankValueOf(item: DomainRankedKeywordItem): number | null {
  const serpItem = item.ranked_serp_element?.serp_item;
  return typeof serpItem?.rank_group === "number"
    ? serpItem.rank_group
    : typeof item.ranked_serp_element?.rank_absolute === "number"
      ? item.ranked_serp_element.rank_absolute
      : typeof serpItem?.rank_absolute === "number"
        ? serpItem.rank_absolute
        : null;
}

function bucketForKeyword(item: DomainRankedKeywordItem): KeywordBucket {
  const rankValue = rankValueOf(item);

  // The Labs endpoint reports position beyond 100 only via `rank_absolute`,
  // so a rank-less row is one that placed past 100 rather than one whose
  // position is a mystery — it belongs in the same bucket.
  if (rankValue == null) return "beyond100";

  if (rankValue <= 3) return "top3";
  if (rankValue <= 10) return "rank4to10";
  if (rankValue <= 20) return "rank11to20";
  if (rankValue <= 50) return "rank21to50";
  if (rankValue <= 100) return "rank51to100";
  return "beyond100";
}

/** Initialise a zeroed bucket map. */
function emptyBucketCounts(): Record<KeywordBucket, number> {
  return {
    top3: 0,
    rank4to10: 0,
    rank11to20: 0,
    rank21to50: 0,
    rank51to100: 0,
    beyond100: 0,
  };
}

/** How many rows the "Top Organic Keywords" card shows. The template renders
 *  five; a couple of spares cost nothing and keep the table full if one of the
 *  leaders turns out to be unnamed. */
const TOP_KEYWORDS_LIMIT = 8;

/** Reduce one ranked-keyword item to a table row. Returns null for an item
 *  with no keyword text — a nameless row is a row a reader can't act on. */
function toTopKeywordRow(item: DomainRankedKeywordItem): TopKeywordRow | null {
  const keyword = item.keyword_data?.keyword ?? item.keyword ?? null;
  if (keyword == null || keyword === "") return null;
  const info = item.keyword_data?.keyword_info;
  const intent = item.keyword_data?.search_intent_info?.main_intent;
  return {
    keyword,
    intent: typeof intent === "string" && intent !== "" ? intent : null,
    position: rankValueOf(item),
    volume: numberOrNull(info?.search_volume),
    cpc: numberOrNull(info?.cpc),
    traffic: numberOrNull(
      item.ranked_serp_element?.etv ?? item.ranked_serp_element?.serp_item?.etv,
    ),
  };
}

/** The sampled keywords that send the domain the most traffic, most valuable
 *  first — the ordering the reference table is sorted by. Keywords with no
 *  `etv` sort last rather than being dropped: the row is still true. */
function topKeywordRows(items: DomainRankedKeywordItem[]): TopKeywordRow[] {
  const rows = items.flatMap((item) => {
    const row = toTopKeywordRow(item);
    return row === null ? [] : [row];
  });
  rows.sort((a, b) => (b.traffic ?? -1) - (a.traffic ?? -1));
  return rows.slice(0, TOP_KEYWORDS_LIMIT);
}

/** Total counted across all buckets (sum of values). */
function totalBuckets(counts: Record<KeywordBucket, number>): number {
  return Object.values(counts).reduce((acc, n) => acc + n, 0);
}

/**
 * Main entry point. Fans out every fetch in parallel and assembles a single
 * typed payload for the template. Mirrors E1/E2's pattern: `Promise.allSettled`
 * + `Source<T>` cells so a single failure downgrades to a placeholder row.
 */
export async function buildOverviewReportData(
  input: BuildOverviewReportInput,
): Promise<OverviewReportData> {
  const market = resolveMarket(input.country);

  const [
    labsWorldSettled,
    labsCountrySettled,
    backlinksSummarySettled,
    rankedSettled,
    serpCompetitorsSettled,
    historicalSettled,
    aiChatGptSettled,
    aiOverviewSettled,
    aiCitedPagesSettled,
    aiOverviewRefsSettled,
    otherFeaturesSettled,
    extraCountriesSettled,
  ] = await Promise.allSettled([
    fetchDomainRankOverview({
      target: input.domain,
      locationCode: 2840, // "United States" — DataForSEO's "worldwide" sentinel
      languageCode: "en",
    }),
    fetchDomainRankOverview({
      target: input.domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
    fetchBacklinksSummary({ target: input.domain }),
    fetchRankedKeywords({
      target: input.domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      limit: RANKED_KEYWORDS_LIMIT,
      itemTypes: ["organic"],
    }),
    fetchSerpCompetitors({
      keywords: [input.domain],
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      itemTypes: ["organic"],
      limit: SERP_COMPETITORS_LIMIT,
    }),
    getHistoricalSeries({ domain: input.domain, market }),
    fetchLlmAggregatedMetrics({
      target: buildLlmTarget({ type: "domain", value: input.domain }),
      platform: "chat_gpt",
      locationCode: CHATGPT_LOCATION_CODE,
      languageCode: CHATGPT_LANGUAGE_CODE,
    }),
    fetchLlmAggregatedMetrics({
      target: buildLlmTarget({ type: "domain", value: input.domain }),
      platform: "google",
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
    fetchLlmCitedPagesCount({
      target: buildLlmTarget({ type: "domain", value: input.domain }),
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
    fetchRankedKeywords({
      target: input.domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      limit: FEATURE_COUNT_LIMIT,
      itemTypes: ["ai_overview_reference"],
    }),
    fetchRankedKeywords({
      target: input.domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      limit: FEATURE_COUNT_LIMIT,
      itemTypes: ["featured_snippet", "local_pack"],
    }),
    // Only paid for when the table has room for a market beyond the two rows
    // the report already draws — at `COUNTRY_ROW_LIMIT` 2 this costs nothing.
    COUNTRY_ROW_LIMIT > 2
      ? fetchDomainRankOverviewByLocation({ target: input.domain })
      : Promise.resolve(null),
  ]);

  const labsWorld: DomainMetricsItem | undefined =
    labsWorldSettled.status === "fulfilled"
      ? labsWorldSettled.value.data?.[0]
      : undefined;
  const labsCountry: DomainMetricsItem | undefined =
    labsCountrySettled.status === "fulfilled"
      ? labsCountrySettled.value.data?.[0]
      : undefined;
  const backlinksSummary: BacklinksSummaryItem | undefined =
    backlinksSummarySettled.status === "fulfilled"
      ? backlinksSummarySettled.value.data
      : undefined;
  const rankedKeywords: DomainRankedKeywordItem[] =
    rankedSettled.status === "fulfilled"
      ? (rankedSettled.value.data?.items ?? [])
      : [];
  const serpCompetitors: SerpCompetitorItem[] =
    serpCompetitorsSettled.status === "fulfilled"
      ? (serpCompetitorsSettled.value.data ?? [])
      : [];
  const historical: HistoricalSeries =
    historicalSettled.status === "fulfilled"
      ? historicalSettled.value
      : { organicTraffic: [], paidTraffic: [], keywordBuckets: [] };

  // ---- AI Search ----
  const chatGptMentions =
    aiChatGptSettled.status === "fulfilled"
      ? platformMentions(aiChatGptSettled.value.data, "chat_gpt")
      : null;
  const aiOverviewMentions =
    aiOverviewSettled.status === "fulfilled"
      ? platformMentions(aiOverviewSettled.value.data, "google")
      : null;
  const citedPages =
    aiCitedPagesSettled.status === "fulfilled"
      ? aiCitedPagesSettled.value.data
      : null;
  const aiSearchValue: AiSearchData = {
    mentions: sumMentions(chatGptMentions, aiOverviewMentions),
    chatGptMentions,
    aiOverviewMentions,
    citedPages,
  };
  const aiSearch = aiSearchSource(
    aiSearchValue,
    [aiChatGptSettled, aiOverviewSettled, aiCitedPagesSettled].every(
      (settled) => settled.status === "rejected",
    ),
  );

  // ---- SERP distribution ----
  // The organic total rides along on the sample request the bucket chart
  // already pays for; only the two feature counts cost anything extra.
  const serpDistributionValue: SerpDistribution = {
    organic:
      rankedSettled.status === "fulfilled"
        ? rankedSettled.value.data.totalCount
        : null,
    aiOverviews:
      aiOverviewRefsSettled.status === "fulfilled"
        ? aiOverviewRefsSettled.value.data.totalCount
        : null,
    otherFeatures:
      otherFeaturesSettled.status === "fulfilled"
        ? otherFeaturesSettled.value.data.totalCount
        : null,
  };
  const serpDistribution = serpDistributionSource(
    serpDistributionValue,
    aiOverviewRefsSettled.status === "rejected" ||
      otherFeaturesSettled.status === "rejected",
  );

  // ---- Tiles ----
  const authorityScore = computeAuthorityScore(backlinksSummary);
  const worldTiles = buildTilesFromLabs(labsWorld);
  const countryTiles = buildTilesFromLabs(labsCountry);

  // "Cuota de tráfico" — heuristic: world's organic traffic vs the country's,
  // expressed as a fraction. When the country number is missing we fall back
  // to 100% (the country view IS the world view).
  const share =
    worldTiles.organicTraffic != null &&
    worldTiles.organicTraffic > 0 &&
    countryTiles.organicTraffic != null
      ? countryTiles.organicTraffic / worldTiles.organicTraffic
      : null;

  const tiles = {
    authority:
      authorityScore != null ? ok(authorityScore) : empty<number | null>(null),
    authorityComposition: {
      rank: backlinksSummary?.rank ?? null,
      spamPenalty: backlinksSummary?.backlinks_spam_score
        ? Math.min(25, Math.round(backlinksSummary.backlinks_spam_score * 0.25))
        : 0,
    },
    organicTraffic: (() => {
      const v = countryTiles.organicTraffic;
      return rankedSettled.status === "fulfilled"
        ? v != null
          ? ok(v)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    paidTraffic: (() => {
      const v = countryTiles.paidTraffic;
      return rankedSettled.status === "fulfilled"
        ? v != null
          ? ok(v)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    backlinks: (() => {
      const v = backlinksSummary?.backlinks ?? null;
      return backlinksSummarySettled.status === "fulfilled"
        ? v != null
          ? ok(v)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    referringDomains: (() => {
      const v = backlinksSummary?.referring_domains ?? null;
      return backlinksSummarySettled.status === "fulfilled"
        ? v != null
          ? ok(v)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    trafficShare: share != null ? ok(share) : empty<number | null>(null),
    organicKeywords: (() => {
      const v = countryTiles.organicKeywords;
      return rankedSettled.status === "fulfilled"
        ? v != null
          ? ok(v)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    paidKeywords: (() => {
      const v = countryTiles.paidKeywords;
      return rankedSettled.status === "fulfilled"
        ? v != null
          ? ok(v)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    competitorsCount: (() => {
      const v = serpCompetitors.length;
      return serpCompetitorsSettled.status === "fulfilled"
        ? ok(v)
        : err<number | null>(null);
    })(),
  };

  // ---- Tables ----
  // The distribution table is laid out as "Todo el mundo" + the requested
  // country, with each row's share scaled against the world's total.
  const worldTraffic = worldTiles.organicTraffic;
  const countries: CountryRow[] = [
    rowFromLabs(
      "WW",
      labsWorld,
      worldTraffic != null && worldTraffic > 0 ? 1 : null,
    ),
    rowFromLabs(
      market.countryLabel,
      labsCountry,
      worldTraffic != null &&
        worldTraffic > 0 &&
        countryTiles.organicTraffic != null
        ? countryTiles.organicTraffic / worldTraffic
        : null,
    ),
    // The market the report is for is already above; asking for it again would
    // print it twice with two different reductions behind it.
    ...(extraCountriesSettled.status === "fulfilled" &&
    extraCountriesSettled.value != null
      ? topCountryRows(extraCountriesSettled.value.data, {
          excludeCodes: new Set([market.locationCode]),
          worldTraffic,
          limit: COUNTRY_ROW_LIMIT - 2,
        })
      : []),
  ];

  const tables = {
    countries: ok(countries),
    topKeywords:
      rankedSettled.status === "fulfilled"
        ? ok(topKeywordRows(rankedKeywords))
        : err<TopKeywordRow[]>([]),
  };

  // ---- Charts ----
  // Bucket histogram — one column per bucket, summed across the ranked KW set.
  const counts = emptyBucketCounts();
  for (const kw of rankedKeywords) {
    counts[bucketForKeyword(kw)] += 1;
  }
  // Suppress an unused-variable warning when the total is zero (we still
  // surface the bucket structure so the chart label "—" renders cleanly).
  void totalBuckets(counts);

  const historyOk = historicalSettled.status === "fulfilled";
  const charts = {
    trafficTrend: historyOk
      ? ok({
          points: historical.organicTraffic,
          paidPoints: historical.paidTraffic,
        })
      : err<{ points: TrendPoint[]; paidPoints: TrendPoint[] }>({
          points: [],
          paidPoints: [],
        }),
    keywordBuckets: ok<{ counts: Record<KeywordBucket, number> }>({ counts }),
    keywordBucketTrend: historyOk
      ? ok({ points: historical.keywordBuckets })
      : err<{ points: BucketTrendPoint[] }>({ points: [] }),
  };

  // The AI Optimization endpoints are deliberately absent here. They sit behind
  // a separate DataForSEO subscription, so an account without it would fail
  // them on every render and stamp "Partial data" on a report whose Google
  // data is entirely intact. The card carries its own `—` instead.
  const healthy = [
    labsWorldSettled,
    labsCountrySettled,
    backlinksSummarySettled,
    rankedSettled,
    serpCompetitorsSettled,
    historicalSettled,
    aiOverviewRefsSettled,
    otherFeaturesSettled,
  ].every((s) => s.status === "fulfilled");

  return {
    input: {
      domain: input.domain,
      country: market.countryLabel,
      countryLabel: market.countryLabel,
    },
    healthy,
    aiSearch,
    serpDistribution,
    tiles,
    tables,
    charts,
  };
}

/* ----------------------------- Test helpers ----------------------------- */

// Re-exports used by tests. `resolveMarket` / `computeAuthorityScore` flow
// through the shared module (E3.0 extraction); the helper reducers here are
// local so they live under `__test`.
export const __test = {
  resolveMarket,
  computeAuthorityScore,
  pickMetrics,
  numberOrNull,
  buildTilesFromLabs,
  rowFromLabs,
  countryLabelFor,
  bucketForKeyword,
  topCountryRows,
  platformMentions,
  sumMentions,
  topKeywordRows,
  bucketCountsFromMetrics,
  toHistoricalSeries,
  historyWindowStart,
  emptyBucketCounts,
  totalBuckets,
  ok,
  empty,
  err,
};
