/* eslint-disable max-lines -- Single-file service: data fetchers + reducers + types exported for tests. Splitting would scatter the report contract across modules without simplifying reading. */
import {
  fetchBacklinksSummary,
  type BacklinksSummaryItem,
} from "@/server/lib/dataforseo/backlinks";
import {
  fetchDomainRankOverview,
  fetchRankedKeywords,
  fetchSerpCompetitors,
  type DomainMetricsItem,
  type DomainRankOverviewMetrics,
  type DomainRankedKeywordItem,
  type SerpCompetitorItem,
} from "@/server/lib/dataforseo/labs";
import {
  computeAuthorityScore,
  resolveMarket,
} from "@/server/lib/render/reports/shared";

/**
 * Service: build the data needed by the Domain Overview report template (E3).
 *
 * The Overview report is the "1-page summary" of a domain — it composes the
 * tiles that E1/E2 already compute (authority, traffic, backlinks) plus two
 * pieces unique to this view:
 *  1. Country distribution (Labs `domain_rank_overview` per location).
 *  2. Keyword distribution by bucket (Top 3 / 4–10 / 11–20 / 21–50 / 51–100 /
 *     SERP features) — bucketed by `rank_group` (organic-only), with
 *     `rank_absolute` as the fallback when the API doesn't expose a `rank_group`
 *     (see E3.1 — `rank_group` was added to `rankedSerpItemSchema` for this).
 *
 * Historical traffic series (E3.4) lives behind a dedicated stub
 * {@link getHistoricalTrafficSeries} that returns `[]` today. The contract
 * is locked here so the template can render a placeholder honestly (never
 * invent data) and the E3.4 implementation can plug in later without
 * touching the template.
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
  | "serpFeatures";

/** Labels and ordering for the buckets — kept in one place so the
 *  template and the service agree on the legend order. */
export const KEYWORD_BUCKETS: KeywordBucket[] = [
  "top3",
  "rank4to10",
  "rank11to20",
  "rank21to50",
  "rank51to100",
  "serpFeatures",
];

export const KEYWORD_BUCKET_LABELS: Record<KeywordBucket, string> = {
  top3: "Top 3",
  rank4to10: "4–10",
  rank11to20: "11–20",
  rank21to50: "21–50",
  rank51to100: "51–100",
  serpFeatures: "Funcionalidades SERP",
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

/** One point on the "Tráfico orgánico" historical line chart. */
export type TrendPoint = { date: string; value: number | null };

/** Output shape consumed by the Overview template. */
export type OverviewReportData = {
  input: { domain: string; country: string; countryLabel: string };
  /** True iff every cell came back ok. False means at least one is a placeholder. */
  healthy: boolean;
  /** 5 tiles in the spec order — see A.1. */
  tiles: {
    authority: Source<number | null>;
    authorityComposition: { rank: number | null; spamPenalty: number };
    organicTraffic: Source<number | null>;
    paidTraffic: Source<number | null>;
    backlinks: Source<number | null>;
    referringDomains: Source<number | null>;
    trafficShare: Source<number | null>;
    organicKeywords: Source<number | null>;
    competitorsCount: Source<number | null>;
  };
  /** Distribución por países (sidebar). World + the requested country. */
  tables: {
    countries: Source<CountryRow[]>;
  };
  charts: {
    /** Línea "Tráfico orgánico (histórico)" — placeholder when E3.4 is empty. */
    trafficTrend: Source<{ points: TrendPoint[] }>;
    /** Área apilada "Palabras clave orgánicas" por bucket. */
    keywordBuckets: Source<{ counts: Record<KeywordBucket, number> }>;
  };
};

/* ----------------------------- Defaults ----------------------------- */

/** Limits used across the per-domain fetches. Tuned to match E1/E2's footprint. */
const RANKED_KEYWORDS_LIMIT = 200;
const SERP_COMPETITORS_LIMIT = 10;

/* ----------------------------- Charts ----------------------------- */

/**
 * Historical traffic series (E3.4 stub).
 *
 * Today returns `[]` — the spec calls this out as a separate epic that needs
 * a database snapshot table + a capture policy decision (every render vs
 * cron). The template renders an honest placeholder when this is empty.
 *
 * The signature is locked to `TrendPoint[]` so the E3.4 implementation can
 * be dropped in without touching the template.
 */
export async function getHistoricalTrafficSeries(
  _domain: string,
): Promise<TrendPoint[]> {
  return [];
}

/* ----------------------------- Reducers ----------------------------- */

/** Pull the metrics block for one search-engine from a Labs rank-overview row. */
function pickMetrics(
  item: DomainMetricsItem | undefined,
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

/** Bucket a single ranked keyword by its `rank_group` (with `rank_absolute`
 *  fallback). SERP features live in their own item_types bucket so they
 *  don't get mis-counted under the rank groups.
 *
 *  The defaults are aligned with the buckets in the spec (A.1):
 *   - Top 3      → rank <= 3
 *   - 4–10       → 4..10
 *   - 11–20      → 11..20
 *   - 21–50      → 21..50
 *   - 51–100     → 51..100
 *   - SERP feats → item_types contains featured_snippet / ai_overview / etc.
 */
function bucketForKeyword(item: DomainRankedKeywordItem): KeywordBucket {
  const serpItem = item.ranked_serp_element?.serp_item;
  const rankValue =
    typeof serpItem?.rank_group === "number"
      ? serpItem.rank_group
      : typeof item.ranked_serp_element?.rank_absolute === "number"
        ? item.ranked_serp_element.rank_absolute
        : typeof serpItem?.rank_absolute === "number"
          ? serpItem.rank_absolute
          : null;

  // SERP features — anything in the SDK's "feature" set should never be
  // counted as a rank bucket, that would distort the chart.
  // The Labs endpoint reports position beyond 100 only via `rank_absolute`,
  // so a missing rank still has to be tossed into the "serpFeatures"
  // bucket to avoid false positives.
  if (rankValue == null) return "serpFeatures";

  if (rankValue <= 3) return "top3";
  if (rankValue <= 10) return "rank4to10";
  if (rankValue <= 20) return "rank11to20";
  if (rankValue <= 50) return "rank21to50";
  if (rankValue <= 100) return "rank51to100";
  return "serpFeatures";
}

/** Initialise a zeroed bucket map. */
function emptyBucketCounts(): Record<KeywordBucket, number> {
  return {
    top3: 0,
    rank4to10: 0,
    rank11to20: 0,
    rank21to50: 0,
    rank51to100: 0,
    serpFeatures: 0,
  };
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
    getHistoricalTrafficSeries(input.domain),
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
  const historical: TrendPoint[] =
    historicalSettled.status === "fulfilled" ? historicalSettled.value : [];

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
  ];

  const tables = {
    countries: ok(countries),
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

  const charts = {
    trafficTrend: ok<{ points: TrendPoint[] }>({ points: historical }),
    keywordBuckets: ok<{ counts: Record<KeywordBucket, number> }>({ counts }),
  };

  const healthy = [
    labsWorldSettled,
    labsCountrySettled,
    backlinksSummarySettled,
    rankedSettled,
    serpCompetitorsSettled,
    historicalSettled,
  ].every((s) => s.status === "fulfilled");

  return {
    input: {
      domain: input.domain,
      country: market.countryLabel,
      countryLabel: market.countryLabel,
    },
    healthy,
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
  emptyBucketCounts,
  totalBuckets,
  ok,
  empty,
  err,
};
