import { z } from "zod";
import {
  DataforseoLabsGoogleDomainIntersectionLiveRequestInfo,
  DataforseoLabsGoogleDomainRankOverviewLiveRequestInfo,
  DataforseoLabsGoogleKeywordIdeasLiveRequestInfo,
  DataforseoLabsGoogleKeywordOverviewLiveRequestInfo,
  DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo,
  DataforseoLabsGoogleRankedKeywordsLiveRequestInfo,
  DataforseoLabsGoogleRelatedKeywordsLiveRequestInfo,
  DataforseoLabsGoogleRelevantPagesLiveRequestInfo,
  DataforseoLabsGoogleSerpCompetitorsLiveRequestInfo,
  type DataforseoLabsDomainRankOverviewLiveItem,
  type DataforseoLabsGoogleKeywordOverviewLiveItem,
  type DataforseoLabsRelatedKeywordsLiveItem,
  type DataforseoLabsRelevantPagesLiveItem,
  type DataforseoLabsSerpCompetitorsLiveItem,
  type KeywordDataInfo,
} from "dataforseo-client";
import { labsApi } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";

// SDK item models are 1:1 supersets of what we need, so we expose them directly
// under the names the rest of the app already uses (no hand-written Zod).
export type LabsKeywordDataItem = KeywordDataInfo;
type RelatedKeywordItem = DataforseoLabsRelatedKeywordsLiveItem;
export type DomainMetricsItem = DataforseoLabsDomainRankOverviewLiveItem;
export type DomainRankOverviewMetrics =
  NonNullable<DomainMetricsItem["metrics"]> extends Record<string, infer U>
    ? U
    : never;
export type RelevantPagesItem = DataforseoLabsRelevantPagesLiveItem;
export type KeywordOverviewItem = DataforseoLabsGoogleKeywordOverviewLiveItem;
export type SerpCompetitorItem = DataforseoLabsSerpCompetitorsLiveItem;

// Ranked keywords is the one Labs endpoint the SDK types loosely: its
// `ranked_serp_element.serp_item` is the base element item, so the url / etv /
// rank fields we read are untyped (`any`). Keep a focused schema so the
// domain-keyword mapper stays type-safe.
//
// `rank_group` is the position among organic results only (0 = top organic
// result) — `rank_absolute` is the position in the full SERP including ads /
// featured snippets / etc. The codebase has a convention (see
// `serp.ts:132`, `features/keywords/.../serp.ts:44`) of bucketing keywords
// by `rank_group` (with `rank_absolute` fallback) to avoid ad-derived
// distortion. E3.2 (Domain Overview) reads `rank_group` for the bucket
// stacking chart, so we add it here as a non-breaking passthrough.
const rankedSerpItemSchema = z
  .object({
    url: z.string().nullable().optional(),
    relative_url: z.string().nullable().optional(),
    rank_absolute: z.number().nullable().optional(),
    rank_group: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
  })
  .passthrough();

const domainRankedKeywordItemSchema = z
  .object({
    keyword_data: z
      .object({
        keyword: z.string().nullable().optional(),
        keyword_info: z
          .object({
            search_volume: z.number().nullable().optional(),
            cpc: z.number().nullable().optional(),
            keyword_difficulty: z.number().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        keyword_properties: z
          .object({
            keyword_difficulty: z.number().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    ranked_serp_element: z
      .object({
        serp_item: rankedSerpItemSchema.nullable().optional(),
        url: z.string().nullable().optional(),
        relative_url: z.string().nullable().optional(),
        rank_absolute: z.number().nullable().optional(),
        etv: z.number().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    keyword: z.string().nullable().optional(),
  })
  .passthrough();

export type DomainRankedKeywordItem = z.infer<
  typeof domainRankedKeywordItemSchema
>;

type DataforseoLabsItemType =
  | "organic"
  | "paid"
  | "featured_snippet"
  | "local_pack"
  | "ai_overview_reference";

export async function fetchRelatedKeywords(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  depth?: number;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<RelatedKeywordItem[]>> {
  const response = await labsApi().googleRelatedKeywordsLive([
    new DataforseoLabsGoogleRelatedKeywordsLiveRequestInfo({
      keyword: input.keyword,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      depth: input.depth ?? 3,
      // Clickstream-refined volumes DOUBLE the request cost, so they are
      // opt-in — see specs/0004-keyword-data-source-routing.md.
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordSuggestions(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<LabsKeywordDataItem[]>> {
  const response = await labsApi().googleKeywordSuggestionsLive([
    new DataforseoLabsGoogleKeywordSuggestionsLiveRequestInfo({
      keyword: input.keyword,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
      include_seed_keyword: true,
      ignore_synonyms: false,
      exact_match: false,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordIdeas(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<LabsKeywordDataItem[]>> {
  const response = await labsApi().googleKeywordIdeasLive([
    new DataforseoLabsGoogleKeywordIdeasLiveRequestInfo({
      keywords: [input.keyword],
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      include_clickstream_data: input.includeClickstreamData ?? false,
      include_serp_info: false,
      ignore_synonyms: false,
      closely_variants: false,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchDomainRankOverview(input: {
  target: string;
  locationCode: number;
  languageCode: string;
}): Promise<DataforseoApiResponse<DomainMetricsItem[]>> {
  const response = await labsApi().googleDomainRankOverviewLive([
    new DataforseoLabsGoogleDomainRankOverviewLiveRequestInfo({
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: 1,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

type RankedKeywordsPage = {
  items: DomainRankedKeywordItem[];
  totalCount: number | null;
};

export async function fetchRankedKeywords(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  orderBy?: string[];
  filters?: unknown[];
  itemTypes?: DataforseoLabsItemType[];
}): Promise<DataforseoApiResponse<RankedKeywordsPage>> {
  // Note: ranked_keywords has no include_subdomains parameter — a domain
  // target always covers the hostname plus its subdomains. Narrower scopes
  // are expressed through `filters` (see researchScopeFilters.ts).
  const response = await labsApi().googleRankedKeywordsLive([
    new DataforseoLabsGoogleRankedKeywordsLiveRequestInfo({
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      offset: input.offset,
      order_by: input.orderBy,
      filters: input.filters,
      item_types: input.itemTypes,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: {
      items: parseTaskItems(
        "google-ranked-keywords-live",
        task,
        domainRankedKeywordItemSchema,
      ),
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

type RelevantPagesPage = {
  items: RelevantPagesItem[];
  totalCount: number | null;
};

export async function fetchRelevantPages(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  orderBy?: string[];
  filters?: unknown[];
}): Promise<DataforseoApiResponse<RelevantPagesPage>> {
  const response = await labsApi().googleRelevantPagesLive([
    new DataforseoLabsGoogleRelevantPagesLiveRequestInfo({
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      offset: input.offset,
      order_by: input.orderBy,
      filters: input.filters,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: {
      items: task.result?.[0]?.items ?? [],
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchKeywordOverview(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  includeClickstreamData?: boolean;
}): Promise<DataforseoApiResponse<KeywordOverviewItem[]>> {
  const response = await labsApi().googleKeywordOverviewLive([
    new DataforseoLabsGoogleKeywordOverviewLiveRequestInfo({
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      include_clickstream_data: input.includeClickstreamData ?? false,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchSerpCompetitors(input: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  itemTypes?: DataforseoLabsItemType[];
  includeSubdomains?: boolean;
  limit: number;
  offset?: number;
}): Promise<DataforseoApiResponse<SerpCompetitorItem[]>> {
  const response = await labsApi().googleSerpCompetitorsLive([
    new DataforseoLabsGoogleSerpCompetitorsLiveRequestInfo({
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      item_types: input.itemTypes,
      include_subdomains: input.includeSubdomains,
      limit: input.limit,
      offset: input.offset,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

// Same loosely-typed fields pattern the SDK uses for ranked_keywords; the
// item body has a big passthrough surface so we narrow just what the report
// reads (keyword + per-domain rank). `intersect_position` is added in some
// response variants; allow it where present.
const domainIntersectionSerpElementSchema = z
  .object({
    serp_item: z
      .object({
        url: z.string().nullable().optional(),
        relative_url: z.string().nullable().optional(),
        rank_absolute: z.number().nullable().optional(),
        rank_group: z.number().nullable().optional(),
        etv: z.number().nullable().optional(),
        type: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    intersect_position: z.number().nullable().optional(),
    rank_absolute: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
  })
  .passthrough();

const domainIntersectionItemSchema = z
  .object({
    se_type: z.string().nullable().optional(),
    keyword_data: z
      .object({
        keyword: z.string().nullable().optional(),
        keyword_info: z
          .object({
            search_volume: z.number().nullable().optional(),
            cpc: z.number().nullable().optional(),
            competition: z.number().nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    first_domain_serp_element: domainIntersectionSerpElementSchema
      .nullable()
      .optional(),
    second_domain_serp_element: domainIntersectionSerpElementSchema
      .nullable()
      .optional(),
  })
  .passthrough();

export type DomainIntersectionItem = z.infer<
  typeof domainIntersectionItemSchema
>;

/**
 * Labs `domain_intersection` — pairwise comparison (target_1 vs target_2).
 *
 * Note: the underlying API is PAIRWISE only (two domains per call). For the
 * 3-circle Venn in the Competitors report, the service layer fans this out
 * into multiple calls — see `buildCompetitorsReportData` (E2.3).
 *
 * `intersections`:
 *  - `true`  → keywords for which BOTH target_1 and target_2 rank in SERP
 *              (used for the "Débiles" / shared-keyword Venn lobe).
 *  - `false` → keywords for which target_1 ranks and target_2 does NOT
 *              (used for "Faltantes" — i.e. keywords the competitor owns
 *              alone). To get the symmetric set, the caller makes a second
 *              call swapping target_1/target_2.
 */
export async function fetchDomainIntersection(input: {
  target1: string;
  target2: string;
  locationCode: number;
  languageCode: string;
  intersections: boolean;
  limit: number;
}): Promise<DataforseoApiResponse<DomainIntersectionItem[]>> {
  // The SDK serialises domain_intersection's `target_1` / `target_2` via
  // `toJSON`, which references the un-underscored `target1` / `target2`
  // instance fields. The constructor assigns any field by key, but `toJSON`
  // only emits the SDK-named fields, so we have to set them post-construction
  // (the field is declared `target_1?` on the interface, but `toJSON` maps
  // `this.target1 → data.target1`, hence the discrepancy).
  const req = new DataforseoLabsGoogleDomainIntersectionLiveRequestInfo();
  req.target_1 = input.target1;
  req.target_2 = input.target2;
  req.location_code = input.locationCode;
  req.language_code = input.languageCode;
  req.intersections = input.intersections;
  req.item_types = ["organic", "paid"];
  req.include_serp_info = false;
  req.limit = input.limit;
  // Sorting by search_volume desc keeps the keyword-gap table focused on
  // commercially meaningful terms (the rendered report caps the table at
  // ~20 rows anyway).
  req.order_by = ["keyword_data.keyword_info.search_volume,desc"];
  const response = await labsApi().googleDomainIntersectionLive([req]);
  const task = assertOk(response);
  return {
    data: parseTaskItems(
      "google-domain-intersection-live",
      task,
      domainIntersectionItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}
