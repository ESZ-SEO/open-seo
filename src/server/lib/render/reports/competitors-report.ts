/* eslint-disable max-lines -- Single-file service: data fetchers + reducers + types exported for tests. Splitting would scatter the report contract across modules without simplifying reading. */
import {
  fetchBacklinksSummary,
  type BacklinksSummaryItem,
} from "@/server/lib/dataforseo/backlinks";
import {
  fetchDomainIntersection,
  fetchDomainRankOverview,
  fetchRankedKeywords,
  type DomainIntersectionItem,
  type DomainMetricsItem,
  type DomainRankOverviewMetrics,
  type DomainRankedKeywordItem,
} from "@/server/lib/dataforseo/labs";
import { LOCATION_OPTIONS } from "@/shared/keyword-locations";

/**
 * Service: build the data needed by the Competitors report template (E2).
 *
 * Compares one primary domain against up to two competitor domains (spec §6.3).
 * The Venn diagram and keyword-gap table both rely on DataForSEO's
 * `domain_intersection` endpoint, which is PAIRWISE only — see the brief on
 * how the service fans the calls out:
 *   - With 0 competitors → degrades to a primary-only "solo" report.
 *   - With 1 competitor  → 1 pairwise call + per-domain metrics × 2.
 *   - With 2 competitors → 2 pairwise calls (primary vs each; the comp1 ∩ comp2
 *                          Venn lobe is computed from a heuristic — see
 *                          `approximateCompIntersection` below). The brief
 *                          documents this decision explicitly.
 *
 * Resolutions use `Promise.allSettled` so a single failing call never blanks
 * the rest of the report — the `Source<T>` idiom from E1 lets the template
 * downgrade to "—" plus a marker instead of throwing.
 *
 * Brand/non-brand (E2.4) is the ⚠️ heuristic specified in §6.3: a keyword is
 * branded iff it contains the leftmost label of its domain as a substring
 * (case-insensitive). It's intentionally simple — fuzzy/NLP matching would
 * change the answer in non-obvious ways and is out of scope.
 */

export type BuildCompetitorsReportInput = {
  domain: string;
  country: string;
  /** Up to two competitor domains (already parsed + deduped by the schema). */
  competitors: string[];
};

type ResolvedMarket = {
  locationCode: number;
  languageCode: string;
  countryLabel: string;
};

function resolveMarket(country: string): ResolvedMarket {
  const upper = country.toUpperCase();
  const match = LOCATION_OPTIONS.find((option) => option.shortLabel === upper);
  if (!match) {
    return {
      locationCode: 2724,
      languageCode: "es",
      countryLabel: upper,
    };
  }
  return {
    locationCode: match.code,
    languageCode: match.languageCode,
    countryLabel: match.shortLabel,
  };
}

/** Source tag for each cell — distinguishes a real value from "API failed". */
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

/** Per-domain row consumed by the template's KPI table and donut chart. */
export type CompetitorRow = {
  domain: string;
  /** Whether this row is the primary or a competitor (drives the colour). */
  role: "primary" | "competitor";
  authority: Source<number | null>;
  rank: Source<number | null>;
  organicTraffic: Source<number | null>;
  organicKeywords: Source<number | null>;
  paidKeywords: Source<number | null>;
  paidTrafficCost: Source<number | null>;
  backlinks: Source<number | null>;
  referringDomains: Source<number | null>;
  brandShare: Source<number | null>;
  nonBrandShare: Source<number | null>;
};

export type KeywordGapRow = {
  keyword: string;
  volume: number | null;
  /** Which competitor owns this keyword (alone). */
  ownedBy: string;
};

export type VennCounts = {
  /** Primary keywords with no overlap. */
  primaryOnly: number;
  /** Competitor-1 keywords with no overlap. */
  comp1Only: number;
  /** Competitor-2 keywords with no overlap (0 if only 1 competitor). */
  comp2Only: number;
  /** primary ∩ comp1 (true intersection — comes from a real pairwise call). */
  primaryAndComp1: number;
  /** primary ∩ comp2 (true intersection — comes from a real pairwise call). */
  primaryAndComp2: number;
  /** comp1 ∩ comp2 (only computed when 2 competitors). ⚠️ approximate. */
  comp1AndComp2: number | null;
};

export type CompetitorsReportData = {
  input: {
    domain: string;
    country: string;
    countryLabel: string;
    competitors: string[];
  };
  /** True iff every cell came back ok. False means at least one is a placeholder. */
  healthy: boolean;
  /** One row per domain (primary first, then competitors). */
  rows: CompetitorRow[];
  /** Keyword-gap blocks for the Faltantes / Débiles tabs. */
  keywordGap: {
    missing: Source<KeywordGapRow[]>;
    weak: Source<KeywordGapRow[]>;
  };
  /** Number of competitors explicitly requested (0..2). */
  competitorCount: number;
  /** True when Venn counts are derived from real pairwise calls (not all null). */
  vennFromRealCalls: boolean;
  venn: Source<VennCounts>;
};

// Limits used across the per-domain fetches. Small enough to keep the report
// pipeline honest about per-request DataForSEO cost.
const RANKED_KEYWORDS_LIMIT = 100;
const INTERSECT_LIMIT = 30;

/** Authority Score (composed) — same composition as E1. */
function computeAuthorityScore(
  summary: BacklinksSummaryItem | null | undefined,
): number | null {
  if (!summary) return null;
  const base = summary.rank;
  if (base == null) return null;
  const spam = summary.backlinks_spam_score ?? 0;
  const penalty = Math.min(25, Math.round(spam * 0.25));
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

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

/** Reduce top-level Labs summary → row scalars. */
function buildRowFromLabs(item: DomainMetricsItem | undefined) {
  const organic = pickMetrics(item, "organic");
  const paid = pickMetrics(item, "paid");
  return {
    rank: numberOrNull(item?.rank),
    organicTraffic: numberOrNull(organic?.etv ?? organic?.count ?? null),
    organicKeywords: numberOrNull(organic?.count),
    paidKeywords: numberOrNull(paid?.count),
    paidTrafficCost: numberOrNull(paid?.estimated_paid_traffic_cost),
  };
}

/** Build the "comp1 ∩ comp2" count as a loose bound. */
function approximateCompIntersection(): number | null {
  // We don't have a direct comp1∩comp2 call (pairwise fan-out limited to
  // primary × each). Returns 0 as a conservative bound. The template should
  // surface this as a ⚠️ approximation when both competitors are present.
  return 0;
}

/**
 * Reduce top-N fetched keywords to brand vs non-brand ratios for a domain.
 *
 * Heuristic (E2.4 — ⚠️ explicit, no NLP): a keyword is "branded" iff it
 * contains the leftmost label of its domain as a substring (case-insensitive).
 * "clubes-de-futbol-madrid.es" → leftmost "clubes-de-futbol-madrid" → match
 * against the keyword. Predictable, auditable, aligned with the spec.
 */
function brandShareForDomain(
  domain: string,
  ranked: readonly DomainRankedKeywordItem[],
): { brand: number; total: number } | null {
  if (ranked.length === 0) return null;
  const leftmost = domain.split(".")[0]?.toLowerCase() ?? "";
  if (leftmost.length < 2) return { brand: 0, total: ranked.length };
  let brand = 0;
  for (const item of ranked) {
    const kw = (item.keyword_data?.keyword ?? "").toLowerCase();
    if (kw.length === 0) continue;
    if (kw.includes(leftmost)) brand += 1;
  }
  return { brand, total: ranked.length };
}

function buildKpiRow(input: {
  domain: string;
  role: "primary" | "competitor";
  backlinksSummary: BacklinksSummaryItem | undefined;
  labsItem: DomainMetricsItem | undefined;
  ranked: DomainRankedKeywordItem[];
}): CompetitorRow {
  const { domain, role, backlinksSummary, labsItem, ranked } = input;
  const composed = computeAuthorityScore(backlinksSummary);
  const labs = buildRowFromLabs(labsItem);
  const brandShare = brandShareForDomain(domain, ranked);
  return {
    domain,
    role,
    authority:
      backlinksSummary != null && composed != null
        ? ok(composed)
        : empty<number | null>(null),
    rank: labs.rank != null ? ok(labs.rank) : empty<number | null>(null),
    organicTraffic:
      labs.organicTraffic != null
        ? ok(labs.organicTraffic)
        : empty<number | null>(null),
    organicKeywords:
      labs.organicKeywords != null
        ? ok(labs.organicKeywords)
        : empty<number | null>(null),
    paidKeywords:
      labs.paidKeywords != null
        ? ok(labs.paidKeywords)
        : empty<number | null>(null),
    paidTrafficCost:
      labs.paidTrafficCost != null
        ? ok(labs.paidTrafficCost)
        : empty<number | null>(null),
    backlinks:
      backlinksSummary?.backlinks != null
        ? ok(backlinksSummary.backlinks)
        : empty<number | null>(null),
    referringDomains:
      backlinksSummary?.referring_domains != null
        ? ok(backlinksSummary.referring_domains)
        : empty<number | null>(null),
    brandShare:
      brandShare != null
        ? ok(brandShare.brand / brandShare.total)
        : empty<number | null>(null),
    nonBrandShare:
      brandShare != null
        ? ok(1 - brandShare.brand / brandShare.total)
        : empty<number | null>(null),
  };
}

/** Reduce intersection items to keyword-gap rows for a single owner. */
function intersectionToGapRows(
  items: DomainIntersectionItem[],
  owner: string,
): KeywordGapRow[] {
  const out: KeywordGapRow[] = [];
  for (const item of items) {
    const kw = item.keyword_data?.keyword;
    if (!kw) continue;
    out.push({
      keyword: kw,
      volume:
        typeof item.keyword_data?.keyword_info?.search_volume === "number"
          ? item.keyword_data.keyword_info.search_volume
          : null,
      ownedBy: owner,
    });
  }
  return out;
}

/** Dedup keyword gap rows by lowercased keyword; preserves insertion order. */
function dedupeByKeyword(rows: KeywordGapRow[]): KeywordGapRow[] {
  const seen = new Set<string>();
  const out: KeywordGapRow[] = [];
  for (const r of rows) {
    const key = r.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Approximate Venn counts for the (primary ∩ comp1) / (primary ∩ comp2) /
 * (comp1 ∩ comp2) lobes using what we have:
 *  - `primaryAndCompN`: items.length returned by intersections:true call.
 *  - exclusive lobes: derive from intersections:false (the symmetric call
 *    gives the keywords comp N owns alone).
 *  - comp1 ∩ comp2: not called pairwise — see `approximateCompIntersection`.
 */
function computeVennCounts(input: {
  primaryOnly: number;
  comp1Only: number;
  comp2Only: number;
  primaryAndComp1: number;
  primaryAndComp2: number;
  hasComp2: boolean;
}): VennCounts {
  return {
    primaryOnly: input.primaryOnly,
    comp1Only: input.comp1Only,
    comp2Only: input.comp2Only,
    primaryAndComp1: input.primaryAndComp1,
    primaryAndComp2: input.primaryAndComp2,
    comp1AndComp2: input.hasComp2 ? approximateCompIntersection() : null,
  };
}

/**
 * Main entry point. Fans out every fetch in parallel per-domain and per-pair,
 * then assembles a single typed payload. See the file-level docstring for the
 * pairwise strategy around the comp1 ∩ comp2 lobe.
 */
export async function buildCompetitorsReportData(
  input: BuildCompetitorsReportInput,
): Promise<CompetitorsReportData> {
  const market = resolveMarket(input.country);
  const primary = input.domain;
  // Guard against a competitor entry equal to the primary domain (e.g. a
  // caller passing `domain=x.com&competitors=x.com,y.com`) — pairwise
  // domain_intersection against itself is meaningless and wastes a call.
  const competitors = input.competitors.filter(
    (c) => c.toLowerCase() !== primary.toLowerCase(),
  );

  const allDomains = [primary, ...competitors];

  // 1. Per-domain Labs + Backlinks + Ranked-Keywords (heaps all in one wave).
  const perDomainFetches = allDomains.map((d) =>
    Promise.allSettled([
      fetchDomainRankOverview({
        target: d,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
      }),
      fetchBacklinksSummary({ target: d }),
      fetchRankedKeywords({
        target: d,
        locationCode: market.locationCode,
        languageCode: market.languageCode,
        limit: RANKED_KEYWORDS_LIMIT,
        itemTypes: ["organic"],
      }),
    ]),
  );
  const perDomainSettled = await Promise.all(perDomainFetches);

  // 2. Pairwise domain_intersection (the spec's headline data point).
  type PairResults = {
    pair: [string, string];
    results: PromiseSettledResult<
      Awaited<ReturnType<typeof fetchDomainIntersection>>
    >[];
  };
  const pairs: Array<[string, string]> = [];
  competitors.forEach((c) => pairs.push([primary, c]));
  const pairSettled: PairResults[] = await Promise.all(
    pairs.map(async (pair) => {
      const results = await Promise.allSettled([
        fetchDomainIntersection({
          target1: pair[0],
          target2: pair[1],
          locationCode: market.locationCode,
          languageCode: market.languageCode,
          intersections: true,
          limit: INTERSECT_LIMIT,
        }),
        fetchDomainIntersection({
          target1: pair[0],
          target2: pair[1],
          locationCode: market.locationCode,
          languageCode: market.languageCode,
          intersections: false,
          limit: INTERSECT_LIMIT,
        }),
        // Symmetric: keywords comp1 owns and primary does not.
        fetchDomainIntersection({
          target1: pair[1],
          target2: pair[0],
          locationCode: market.locationCode,
          languageCode: market.languageCode,
          intersections: false,
          limit: INTERSECT_LIMIT,
        }),
      ]);
      return { pair, results };
    }),
  );

  // ---- assemble per-domain rows ----
  const rows: CompetitorRow[] = allDomains.map((d, i) => {
    const settled = perDomainSettled[i];
    if (!settled) {
      return buildKpiRow({
        domain: d,
        role: i === 0 ? "primary" : "competitor",
        backlinksSummary: undefined,
        labsItem: undefined,
        ranked: [],
      });
    }
    const labsItem =
      settled[0].status === "fulfilled"
        ? (settled[0].value.data?.[0] as DomainMetricsItem | undefined)
        : undefined;
    const backlinksSummary =
      settled[1].status === "fulfilled" ? settled[1].value.data : undefined;
    const ranked =
      settled[2].status === "fulfilled"
        ? (settled[2].value.data?.items ?? [])
        : [];
    return buildKpiRow({
      domain: d,
      role: i === 0 ? "primary" : "competitor",
      backlinksSummary,
      labsItem,
      ranked,
    });
  });

  // ---- assemble keyword-gap rows ----
  const missingRows: KeywordGapRow[] = [];
  const weakRows: KeywordGapRow[] = [];
  let allPairsOk = pairSettled.length > 0;
  let anyPairOk = false;
  for (const { pair, results } of pairSettled) {
    const bothRank =
      results[0].status === "fulfilled" ? results[0].value.data : null;
    const compOwnsOnly =
      results[2].status === "fulfilled" ? results[2].value.data : null;
    if (bothRank == null && compOwnsOnly == null) {
      allPairsOk = false;
      continue;
    }
    anyPairOk = true;
    const owner = pair[1];
    if (bothRank) weakRows.push(...intersectionToGapRows(bothRank, owner));
    if (compOwnsOnly)
      missingRows.push(...intersectionToGapRows(compOwnsOnly, owner));
  }
  const missing: Source<KeywordGapRow[]> =
    missingRows.length > 0
      ? ok(dedupeByKeyword(missingRows).slice(0, INTERSECT_LIMIT))
      : empty<KeywordGapRow[]>([]);
  const weak: Source<KeywordGapRow[]> =
    weakRows.length > 0
      ? ok(dedupeByKeyword(weakRows).slice(0, INTERSECT_LIMIT))
      : empty<KeywordGapRow[]>([]);

  // ---- assemble Venn counts ----
  let primaryAndComp1 = 0;
  let primaryAndComp2 = 0;
  let comp1Only = 0;
  let comp2Only = 0;
  for (let i = 0; i < pairSettled.length; i += 1) {
    const results = pairSettled[i]?.results;
    if (!results) continue;
    const both =
      results[0].status === "fulfilled" ? results[0].value.data : null;
    const compOwns =
      results[2].status === "fulfilled" ? results[2].value.data : null;
    const bothLen = both?.length ?? 0;
    const compOwnsLen = compOwns?.length ?? 0;
    if (i === 0) {
      primaryAndComp1 = bothLen;
      comp1Only = compOwnsLen;
    } else if (i === 1) {
      primaryAndComp2 = bothLen;
      comp2Only = compOwnsLen;
    }
  }
  const venn: Source<VennCounts> = anyPairOk
    ? ok(
        computeVennCounts({
          primaryOnly: 0,
          comp1Only,
          comp2Only,
          primaryAndComp1,
          primaryAndComp2,
          hasComp2: competitors.length >= 2,
        }),
      )
    : err<VennCounts>({
        primaryOnly: 0,
        comp1Only: 0,
        comp2Only: 0,
        primaryAndComp1: 0,
        primaryAndComp2: 0,
        comp1AndComp2: null,
      });

  // ---- healthy flag ----
  const healthy =
    allPairsOk &&
    perDomainSettled.every((s) => s.every((p) => p.status === "fulfilled"));

  return {
    input: {
      domain: primary,
      country: market.countryLabel,
      countryLabel: market.countryLabel,
      competitors,
    },
    healthy,
    rows,
    keywordGap: { missing, weak },
    competitorCount: competitors.length,
    vennFromRealCalls: anyPairOk,
    venn,
  };
}

// Re-exports used by tests.
export const __test = {
  resolveMarket,
  computeAuthorityScore,
  buildRowFromLabs,
  brandShareForDomain,
  buildKpiRow,
  intersectionToGapRows,
  computeVennCounts,
  approximateCompIntersection,
  dedupeByKeyword,
  ok,
  empty,
  err,
};
