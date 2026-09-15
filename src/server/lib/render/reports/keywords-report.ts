/*
 * METERING: these are the RAW fetchers, not the metered client. Deliberate.
 *
 * `createDataforseoClient(customer)` wraps every fetcher in `meter(...)`, which
 * charges the organisation's credit balance. These imports bypass it, so
 * **rendering a report consumes no credits from anybody's account** — the cost
 * lands on the DataForSEO bill without being attributed to a customer.
 *
 * Why: the three shipped reports (`backlinks-report.ts`,
 * `competitors-report.ts`, `overview-report.ts`) already call the raw layer, so
 * wiring a fourth this way changes nothing about how the product bills — it
 * extends the standing pattern. Moving the render path onto the metered client
 * would be a billing decision, and that one is Pedro's; keeping the status quo
 * is not. Decided 2026-09-15.
 *
 * The three existing reports do this with no comment anywhere, which makes a
 * billing decision indistinguishable from an oversight. Hence this block.
 *
 * TO REVERSE IT, the change is not local to these imports:
 *   1. `buildKeywordsReportData` has to take a `BillingCustomerContext`
 *      (`organizationId` / `userId` / `userEmail`, plus an optional
 *      `projectId`) — today its input is `{ keyword, country }`.
 *   2. That context has to come from somewhere. `renderReport` does not have
 *      one and neither does the route: `/api/render/$` authenticates with the
 *      shared `RENDER_API_TOKEN` secret and carries no session, so the caller
 *      would have to start sending an organisation and the route would have to
 *      verify it is entitled to spend that organisation's credits.
 *   3. Then swap these imports for `createDataforseoClient(customer).keywords`
 *      (`.suggestions`, `.related`, `.adsIdeas`) — the smallest step of the
 *      three, and the only one that looks like the whole job from here.
 *
 * Step 2 is the real work and the reason this is a product decision rather
 * than a refactor.
 */
import {
  fetchKeywordSuggestions,
  fetchRelatedKeywords,
  type LabsKeywordDataItem,
} from "@/server/lib/dataforseo/labs";
import {
  fetchAdsKeywordIdeas,
  type AdsKeywordIdeaItem,
} from "@/server/lib/dataforseo/google-ads";
import {
  getKeywordDataProvider,
  LOCATION_OPTIONS,
} from "@/shared/keyword-locations";
// Crossing from `lib/render` into `features/keywords`: PURE FUNCTIONS ONLY.
// These two carry no service, repository, billing context or database handle —
// they are `trim().toLowerCase()` and a substring match over an enum, already
// tested by their own feature. That is the whole of the licence: importing
// `KeywordResearchService` or anything under `services/research/` that builds a
// metered client from here is NOT covered by this precedent and would drag an
// organisation identity the render endpoint does not have (see below).
import {
  normalizeIntent,
  normalizeKeyword,
} from "@/server/features/keywords/services/research/helpers";
import type { KeywordIntent } from "@/types/keywords";
import { resolveMarket } from "@/server/lib/render/reports/shared";

/**
 * Service: build the data the keyword research report template needs (E5).
 *
 * Wired into `render-report.ts` as `report=keywords` (2026-09-15, once the
 * capture was approved). Credits: this calls the RAW DataForSEO fetchers and
 * bills nobody — the decision, and what reversing it would actually cost, are
 * in the METERING block above the imports.
 *
 * The report answers one question — "what else do people search around this
 * seed, and what is each of those worth?" — so its whole payload comes from a
 * single keyword-ideas request plus two reductions over the rows it returns
 * (the summary bar and the topic rail).
 *
 * **Why this calls the DataForSEO fetchers rather than
 * `KeywordResearchService.research`.** That service is bound to a project and
 * a billing customer: it meters DataForSEO credits per organisation and
 * persists every row through `KeywordResearchRepository`. The render endpoint
 * authenticates with a shared secret and carries no session, organisation or
 * project, so calling it would mean inventing an organisation identity —
 * billing someone else's credits and writing rows to a project that doesn't
 * exist. This module therefore calls the same Labs fetchers that service calls
 * underneath, exactly as `overview-report.ts` calls `fetchDomainRankOverview`
 * directly, and reuses the feature's own `normalizeKeyword` / `normalizeIntent`
 * so the two agree on how a row is shaped.
 *
 * **What the endpoints cannot answer.** `keyword_suggestions` and
 * `related_keywords` are requested with `include_serp_info: false` (that flag
 * is what the app's research path pays for, and flipping it would change the
 * cost of every existing caller), so nothing here reports a keyword's SERP
 * features, its result count or when its SERP was last crawled. Neither
 * endpoint publishes a relevance score either. Those four columns therefore
 * carry no value at all rather than a plausible-looking one — see
 * {@link KeywordRow}.
 *
 * Like the other reports this layer uses `Source<T>` cells so a failed request
 * degrades one module instead of blanking the PNG.
 */

export type BuildKeywordsReportInput = {
  /** The seed the report is about. */
  keyword: string;
  /** ISO short label from the endpoint (`"ES"`, `"US"`, …). */
  country: string;
};

/* ----------------------------- Sources ----------------------------- */

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

/**
 * One row of the results table — the full column set the reference shows.
 *
 * The shape is the REFERENCE's, not this builder's. Four of the nine fields
 * (`relevance`, `serpFeatureCount`, `results`, `updated`) are `null` on every
 * row this builder produces, because the requests behind it cannot answer them
 * (see the module docblock). They are typed nullable rather than omitted so the
 * template keeps one contract: a column exists, and a row either fills it or
 * does not. Amputating the type to what this builder can reach would amputate
 * the table with it.
 */
export type KeywordRow = {
  keyword: string;
  /** DataForSEO's `main_intent`, normalised; `"unknown"` when unclassified. */
  intent: KeywordIntent;
  /** How closely the idea tracks the seed. No source in this builder. */
  relevance: number | null;
  volume: number | null;
  /** Keyword difficulty, 0–100. Google-Ads-served countries report none. */
  difficulty: number | null;
  cpc: number | null;
  /** How many SERP features the keyword's result page carries. No source in
   *  this builder: the requests ask for `include_serp_info: false`. */
  serpFeatureCount: number | null;
  /** Indexed results for the keyword. No source, same reason. */
  results: number | null;
  /** Age of the metrics, already phrased for display ("1 month"). No source,
   *  same reason. */
  updated: string | null;
};

/** One row of the topic rail: a term the retrieved keywords share, and how
 *  many of them carry it. */
export type TopicRow = { topic: string; keywords: number };

export type KeywordsReportData = {
  input: {
    keyword: string;
    /** ISO short label (`"ES"`). */
    country: string;
    /** Full country name for the database selector (`"Spain"`). */
    countryName: string;
    /** The currency the CPC column is denominated in. */
    currency: string;
  };
  /** True iff the keyword request came back. */
  healthy: boolean;
  /**
   * How many keywords the summary figures describe.
   *
   * Not the size of the market: the endpoints report a page of ideas and no
   * grand total, so the template prints this alongside the figures rather than
   * letting them read as a total nothing measured.
   */
  sampleSize: number;
  summary: {
    keywordCount: Source<number | null>;
    totalVolume: Source<number | null>;
    /** Mean keyword difficulty across the rows that report one, 0–100. */
    averageDifficulty: Source<number | null>;
  };
  tables: {
    /** Highest-volume first — the order the table renders in. */
    keywords: Source<KeywordRow[]>;
    topics: Source<TopicRow[]>;
  };
  /**
   * Counters on the summary bar's outline actions.
   *
   * The reference shows a request quota and a visible-column count. Neither is
   * a figure this pipeline measures, so both are null and the template draws
   * the buttons without badges — a quota counter nothing measured is a
   * fabricated number wearing a small font.
   */
  actionBadges: {
    updateMetrics: string | null;
    manageColumns: string | null;
  };
  /** The pager at the foot of the results card. */
  pagination: { currentPage: number; totalPages: number };
  /**
   * What to say in place of the three SERP-fed columns when a row has none of
   * them.
   *
   * It lives in the data, not the template, because the text is a claim about
   * WHY the cells are empty and only the data layer knows. The reference's own
   * "For metrics, try to refresh" is true of the reference: those rows are
   * pending a crawl that product will eventually run. It would be a lie coming
   * from this builder — see {@link SERP_NOT_FETCHED}.
   *
   * Required rather than defaulted: a default would quietly hand one mode's
   * sentence to the other, which is the exact failure the field exists to
   * prevent.
   */
  staleLabel: string;
};

/* ----------------------------- Defaults ----------------------------- */

/**
 * How many ideas to ask for.
 *
 * Both endpoints are flat-priced per request, so the limit is a reduction-cost
 * choice rather than a billing one: the table shows 30 rows and the rail 15
 * topics, and 150 rows is a wide enough sample for the topic frequencies to
 * mean something without making the response unwieldy. It matches the app's
 * own default `resultLimit`.
 */
const KEYWORD_LIMIT = 150;

/** Rows the template's table renders — the rest of the sample feeds the
 *  summary bar and the topic rail. */
export const TABLE_ROW_LIMIT = 30;

/** Rows the topic rail renders, matching the reference's own rail. (The brief
 *  said 15; the reference shows 18 and the reference wins — team lead,
 *  2026-09-15.) */
export const TOPIC_LIMIT = 18;

/**
 * DataForSEO quotes CPC in US dollars whatever the market, so the column and
 * the currency selector both name USD. The reference's own selector shows the
 * market's local currency; printing EUR over dollar figures would be a wrong
 * label on a right number.
 */
const CURRENCY = "USD";

/** Nothing in this pipeline measures a request quota or a column count, so the
 *  summary bar's counters stay empty rather than carrying an invented figure. */
const NO_ACTION_BADGES = {
  updateMetrics: null,
  manageColumns: null,
} as const;

/**
 * What this report says where its SERP-fed columns would go.
 *
 * NOT the reference's "For metrics, try to refresh". That sentence promises a
 * refresh, and for the reference it is true — those rows are waiting on a crawl
 * it will run. Here there is no crawl to wait for: the requests behind this
 * report send `include_serp_info: false` and always will, so the columns are
 * not stale, they are out of scope. Telling a reader to retry something that
 * can never succeed sends them to wait for a result that is not coming.
 */
const SERP_NOT_FETCHED = "Not fetched for this report";

/* ----------------------------- Mapping ----------------------------- */

/** Extract a numeric metric with a safe fallback. */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** The four columns no request behind this report can fill. Spelled once so a
 *  reader of either mapper sees the same list — and so the day one of them
 *  gains a source, the compiler points at every place that has to change. */
const UNSOURCED_CELLS = {
  relevance: null,
  serpFeatureCount: null,
  results: null,
  updated: null,
} as const;

/** Labs item → table row. Mirrors the research service's own mapper; the
 *  clickstream-refined block is never present here because this report never
 *  asks for it (it doubles the request cost). */
function rowFromLabsItem(item: LabsKeywordDataItem): KeywordRow | null {
  const keyword = item.keyword;
  if (keyword == null || keyword === "") return null;
  return {
    keyword: normalizeKeyword(keyword),
    intent: normalizeIntent(item.search_intent_info?.main_intent),
    volume: numberOrNull(item.keyword_info?.search_volume),
    difficulty: numberOrNull(item.keyword_properties?.keyword_difficulty),
    cpc: numberOrNull(item.keyword_info?.cpc),
    ...UNSOURCED_CELLS,
  };
}

/** Google Ads item → table row. That API carries volume and CPC but neither
 *  difficulty nor intent, so those two stay unset rather than defaulting to a
 *  number the response never gave. */
function rowFromAdsItem(item: AdsKeywordIdeaItem): KeywordRow | null {
  const keyword = item.keyword;
  if (keyword == null || keyword === "") return null;
  return {
    keyword: normalizeKeyword(keyword),
    intent: "unknown",
    volume: numberOrNull(item.search_volume),
    difficulty: null,
    cpc: numberOrNull(item.cpc),
    ...UNSOURCED_CELLS,
  };
}

/** Drop duplicate keywords, keeping the first (highest-ranked) occurrence. */
function dedupe(rows: KeywordRow[]): KeywordRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.keyword)) return false;
    seen.add(row.keyword);
    return true;
  });
}

/* ----------------------------- Fetching ----------------------------- */

/**
 * The keyword sample.
 *
 * `keyword_suggestions` is the primary source because this report is a
 * phrase-match table: it returns keywords that *contain* the seed, which is
 * what the composition shows and what the topic rail reduces. `related_keywords`
 * is the fallback — it answers a different question (semantically adjacent
 * terms) but answers it for seeds the suggestions index is thin on, and the
 * app's own research path falls back the same way. Countries DataForSEO Labs
 * does not serve go to the Google Ads endpoint instead, exactly as the research
 * path routes them.
 *
 * The fallback is a second request, so it only fires when the first produced
 * nothing at all.
 */
async function fetchKeywordRows(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
}): Promise<KeywordRow[]> {
  if (getKeywordDataProvider(input.locationCode) === "google_ads") {
    const ads = await fetchAdsKeywordIdeas({
      keyword: input.keyword,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      limit: KEYWORD_LIMIT,
    });
    return dedupe(ads.data.flatMap((item) => rowFromAdsItem(item) ?? []));
  }

  const suggestions = await fetchKeywordSuggestions({
    keyword: input.keyword,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: KEYWORD_LIMIT,
  });
  const rows = dedupe(
    suggestions.data.flatMap((item) => rowFromLabsItem(item) ?? []),
  );
  if (rows.length > 0) return rows;

  const related = await fetchRelatedKeywords({
    keyword: input.keyword,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: KEYWORD_LIMIT,
  });
  return dedupe(
    related.data.flatMap((item) =>
      item.keyword_data ? (rowFromLabsItem(item.keyword_data) ?? []) : [],
    ),
  );
}

/* ----------------------------- Topics ----------------------------- */

/**
 * Shortest token worth treating as a topic word.
 *
 * Three characters drops the connectives every language builds phrases out of
 * ("de", "en", "y", "of", "to") without needing a stopword list per language —
 * and this report runs in 94 markets, so a per-language list is a list that
 * would be wrong in most of them.
 */
const MIN_TOPIC_TOKEN_LENGTH = 3;

/** A keyword's words in the order it says them: lowercase, punctuation-free,
 *  and nothing dropped — the positions are what tell a real adjacent phrase
 *  from two words that merely survived the same filter. */
function tokenize(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Whether a word can carry a topic on its own.
 *
 * Long enough to mean something, not a bare number (a year or a price is not a
 * topic), and not one of the seed's own words — those are in nearly every row,
 * so a label built from them names the group by what it already shares. With
 * the seed "cheesecake delivery", "cheesecake delivery fast" has exactly one
 * thing to say about itself, and it is "fast".
 */
function isTopicWord(token: string, seedTokens: Set<string>): boolean {
  return (
    token.length >= MIN_TOPIC_TOKEN_LENGTH &&
    !/^\p{N}+$/u.test(token) &&
    !seedTokens.has(token)
  );
}

/**
 * The topic candidates one keyword contributes: each of its topic words, plus
 * each pair of them that is genuinely adjacent in the keyword.
 *
 * Pairs are what make the rail readable — "gluten free" says more than
 * "gluten" and "free" on two lines. Adjacency is checked against the original
 * word order rather than against the filtered list, so "how to make cheesecake"
 * cannot offer "how make": a label has to be a phrase somebody actually typed.
 */
function topicCandidates(tokens: string[], seedTokens: Set<string>): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isTopicWord(tokens[i], seedTokens)) continue;
    candidates.push(tokens[i]);
    if (i + 1 < tokens.length && isTopicWord(tokens[i + 1], seedTokens)) {
      candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  return Array.from(new Set(candidates));
}

/** True when one topic's words contain the other's — "cheesecake" and
 *  "cheesecake shop" are one topic listed twice, and the rail has 15 slots. */
function overlaps(a: string, b: string): boolean {
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const [small, large] =
    aTokens.size <= bTokens.size ? [aTokens, bTokens] : [bTokens, aTokens];
  return Array.from(small).every((token) => large.has(token));
}

/**
 * The topic rail: the terms the retrieved keywords share, with how many of
 * them carry each one.
 *
 * Every count is a count of real rows — this groups the response, it does not
 * score it. The reference's own topic clusters come from a proprietary model
 * we have no equivalent of, so the rail groups by shared wording instead and
 * says so by using the wording itself as the label.
 *
 * Ties break alphabetically so two renders of the same response agree.
 */
export function topicRows(
  rows: KeywordRow[],
  seed: string,
  limit: number = TOPIC_LIMIT,
): TopicRow[] {
  const seedTokens = new Set(tokenize(seed));
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const candidate of topicCandidates(
      tokenize(row.keyword),
      seedTokens,
    )) {
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }

  // Count first; then, among terms describing the same number of rows, the
  // longer phrase — a pair can never cover more rows than either of its words,
  // so on a tie it is the same group said more precisely. Alphabetical last so
  // two renders of one response agree.
  const ranked = Array.from(counts.entries()).sort(
    ([aTopic, aCount], [bTopic, bCount]) =>
      bCount - aCount ||
      bTopic.split(" ").length - aTopic.split(" ").length ||
      aTopic.localeCompare(bTopic),
  );

  const picked: TopicRow[] = [];
  for (const [topic, keywords] of ranked) {
    if (picked.length >= limit) break;
    if (picked.some((row) => overlaps(row.topic, topic))) continue;
    picked.push({ topic, keywords });
  }
  return picked;
}

/* ----------------------------- Reducers ----------------------------- */

/** Summed search volume across the rows that report one. Null when none do:
 *  a zero total would claim the sample has no traffic behind it. */
function totalVolume(rows: KeywordRow[]): number | null {
  const volumes = rows.flatMap((row) =>
    row.volume == null ? [] : [row.volume],
  );
  return volumes.length === 0
    ? null
    : volumes.reduce((sum, volume) => sum + volume, 0);
}

/** Mean difficulty across the rows that report one, rounded the way the
 *  reference prints it. Null when the market is one the difficulty index
 *  doesn't cover. */
function averageDifficulty(rows: KeywordRow[]): number | null {
  const scores = rows.flatMap((row) =>
    row.difficulty == null ? [] : [row.difficulty],
  );
  return scores.length === 0
    ? null
    : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

/** Full country name for the database selector. Falls back to the short label
 *  so an unknown market names itself rather than going blank. */
function countryNameFor(shortLabel: string): string {
  const upper = shortLabel.toUpperCase();
  return (
    LOCATION_OPTIONS.find((option) => option.shortLabel === upper)?.label ??
    upper
  );
}

/* ----------------------------- Entry point ----------------------------- */

/**
 * Main entry point. One request, then two reductions over its rows.
 *
 * There is no `Promise.allSettled` fan-out here because there is nothing to
 * fan out to: every module on the page is a view of the same keyword sample,
 * so the failure modes are "we have the sample" and "we don't". When we don't,
 * all three `Source` cells report `error` together and the template draws its
 * empty states at the heights the populated ones would have occupied.
 */
export async function buildKeywordsReportData(
  input: BuildKeywordsReportInput,
): Promise<KeywordsReportData> {
  const market = resolveMarket(input.country);
  const seed = normalizeKeyword(input.keyword);

  const reportInput = {
    keyword: input.keyword,
    country: market.countryLabel,
    countryName: countryNameFor(market.countryLabel),
    currency: CURRENCY,
  };

  let rows: KeywordRow[];
  try {
    rows = await fetchKeywordRows({
      keyword: seed,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    });
  } catch {
    return {
      input: reportInput,
      healthy: false,
      sampleSize: 0,
      actionBadges: NO_ACTION_BADGES,
      staleLabel: SERP_NOT_FETCHED,
      pagination: { currentPage: 1, totalPages: 1 },
      summary: {
        keywordCount: err<number | null>(null),
        totalVolume: err<number | null>(null),
        averageDifficulty: err<number | null>(null),
      },
      tables: {
        keywords: err<KeywordRow[]>([]),
        topics: err<TopicRow[]>([]),
      },
    };
  }

  // Highest volume first: with no relevance score to sort on (see the module
  // docblock), volume is the ordering the table can actually justify. Rows
  // with no volume sort last rather than being dropped — the row is still true.
  const sorted = [...rows].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  const topics = topicRows(sorted, seed);

  return {
    actionBadges: NO_ACTION_BADGES,
    staleLabel: SERP_NOT_FETCHED,
    pagination: {
      currentPage: 1,
      // Arithmetic over the rows in hand, never a page count nothing produced.
      totalPages: Math.max(1, Math.ceil(sorted.length / TABLE_ROW_LIMIT)),
    },
    input: reportInput,
    healthy: true,
    sampleSize: sorted.length,
    summary: {
      keywordCount:
        sorted.length > 0 ? ok(sorted.length) : empty<number | null>(null),
      totalVolume: (() => {
        const value = totalVolume(sorted);
        return value == null ? empty<number | null>(null) : ok(value);
      })(),
      averageDifficulty: (() => {
        const value = averageDifficulty(sorted);
        return value == null ? empty<number | null>(null) : ok(value);
      })(),
    },
    tables: {
      keywords:
        sorted.length > 0
          ? ok(sorted.slice(0, TABLE_ROW_LIMIT))
          : empty<KeywordRow[]>([]),
      topics: topics.length > 0 ? ok(topics) : empty<TopicRow[]>([]),
    },
  };
}

/* ----------------------------- Test helpers ----------------------------- */

export const __test = {
  tokenize,
  isTopicWord,
  topicCandidates,
  overlaps,
  topicRows,
  totalVolume,
  averageDifficulty,
  countryNameFor,
  rowFromLabsItem,
  rowFromAdsItem,
  dedupe,
};
