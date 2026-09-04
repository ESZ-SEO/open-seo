/* eslint-disable max-lines -- Single-file service: data fetchers + reducers + types exported for tests. Splitting would scatter the report contract across modules without simplifying reading. */
import {
  fetchBacklinksSummary,
  type BacklinksSummaryItem,
} from "@/server/lib/dataforseo/backlinks";
import {
  fetchDomainRankOverview,
  fetchHistoricalRankOverview,
  fetchRankedKeywords,
  fetchSerpCompetitors,
  type DomainMetricsItem,
  type DomainRankOverviewMetrics,
  type DomainRankedKeywordItem,
  type HistoricalRankOverviewItem,
  type SerpCompetitorItem,
} from "@/server/lib/dataforseo/labs";
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
 *     SERP features) — bucketed by `rank_group` (organic-only), with
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

/**
 * Buckets that exist in the monthly history. `historical_rank_overview`
 * reports position ranges only (`pos_1` … `pos_91_100`) with no SERP-feature
 * counter, so `serpFeatures` stays a present-day-only bucket rather than
 * being back-filled with an invented number.
 */
export type HistoricalKeywordBucket = Exclude<KeywordBucket, "serpFeatures">;

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
  };
  charts: {
    /** Histórico de tráfico. `points` es la serie orgánica; `paidPoints` está
     *  vacío si el dominio no tuvo presencia de pago en la ventana. */
    trafficTrend: Source<{ points: TrendPoint[]; paidPoints: TrendPoint[] }>;
    /** Barra apilada "Palabras clave orgánicas" por bucket — snapshot de hoy. */
    keywordBuckets: Source<{ counts: Record<KeywordBucket, number> }>;
    /** Los mismos buckets mes a mes (sin `serpFeatures`, que no existe en el histórico). */
    keywordBucketTrend: Source<{ points: BucketTrendPoint[] }>;
  };
};

/* ----------------------------- Defaults ----------------------------- */

/** Limits used across the per-domain fetches. Tuned to match E1/E2's footprint. */
const RANKED_KEYWORDS_LIMIT = 200;
const SERP_COMPETITORS_LIMIT = 10;

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
    getHistoricalSeries({ domain: input.domain, market }),
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
  bucketCountsFromMetrics,
  toHistoricalSeries,
  historyWindowStart,
  emptyBucketCounts,
  totalBuckets,
  ok,
  empty,
  err,
};
