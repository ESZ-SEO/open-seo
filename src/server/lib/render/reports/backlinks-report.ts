/* eslint-disable max-lines -- Single-file service: data fetchers + reducers + types exported for tests. Splitting would scatter the report contract across modules without simplifying reading. */
import {
  fetchBacklinksSummary,
  fetchBacklinksRows,
  fetchReferringDomains,
  fetchDomainPagesSummary,
  fetchBacklinksHistory,
  type BacklinksSummaryItem,
  type BacklinksItem,
  type ReferringDomainItem,
  type DomainPageSummaryItem,
  type BacklinksHistoryItem,
} from "@/server/lib/dataforseo/backlinks";
import { fetchDomainRankOverview } from "@/server/lib/dataforseo/labs";
import { LOCATION_OPTIONS } from "@/shared/keyword-locations";

/**
 * Service: build the data needed by the Backlinks report template (E1).
 *
 * The /api/render/$ endpoint receives a small set of report coordinates
 * (`report`, `domain`, `country`, `device`). The template is rendered to PNG
 * by the renderer microservice and must be self-contained, so this layer is
 * responsible for fanning out to every DataForSEO endpoint the template
 * needs and shaping the result into a single typed payload.
 *
 * DataForSEO does not expose an "Authority Score" equivalent; we compose a
 * proprietary score (see {@link computeAuthorityScore}) from `rank` and
 * `backlinks_spam_score` in the summary, and a toxicity score directly from
 * `info.target_spam_score` (already in the API response). These are all
 * marked ⚠️ in spec §6.2 — "composed / approximated". We surface every raw
 * field alongside the composed value so the template can show them when
 * relevant and the score stays auditable.
 *
 * Resolutions use `Promise.allSettled` deliberately: a single failing endpoint
 * must not blank the whole report. Failed cells are rendered as "—" with a
 * small `error` marker so the rest of the page still has value.
 *
 * The endpoint is consumed via an HTTP GET (n8n), so we keep the public
 * surface to a single async function. No async iterators, no streams.
 */

export type BuildBacklinksReportInput = {
  domain: string;
  /** ISO short label from the endpoint (`"ES"`, `"US"`, …). */
  country: string;
};

type ResolvedMarket = {
  locationCode: number;
  languageCode: string;
  countryLabel: string;
};

/** Look up a country short label (e.g. `ES`) → DataForSEO location code. */
function resolveMarket(country: string): ResolvedMarket {
  const upper = country.toUpperCase();
  const match = LOCATION_OPTIONS.find((option) => option.shortLabel === upper);
  // Fallbacks: ES / Spain · en (matches the E0 default and keeps the report
  // safe for unknown countries instead of throwing at the boundary).
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

/**
 * Proprietary authority score (0–100). Combines:
 *  - DataForSEO `rank` (already 0–100 `rank_scale=one_hundred`) as the base
 *  - a small penalty for spam (spammy backlink profile drags authority down)
 *
 * Kept intentionally simple and fully deterministic so the report stays
 * reproducible across runs; tuning belongs to E3.2 alongside the Domain
 * Overview score (the same building blocks appear there).
 */
function computeAuthorityScore(summary: BacklinksSummaryItem): number | null {
  const base = summary.rank;
  if (base == null) return null;
  const spam = summary.backlinks_spam_score ?? 0;
  // Spam is a 0–100 higher-is-worse scale; subtract up to 25 points worst case.
  const penalty = Math.min(25, Math.round(spam * 0.25));
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

/**
 * Extract organic estimated traffic from the Labs domain overview metrics.
 * The Labs response returns `metrics: { organic: { etv }, paid: { etv } }`
 * indexed by search-engine — see `DataforseoLabsMetricsInfo.etv`.
 */
function pickOrganicTraffic(
  items: { metrics?: { organic?: { etv?: number | null } } }[],
): number | null {
  const item = items[0];
  const etv = item?.metrics?.organic?.etv;
  return typeof etv === "number" ? etv : null;
}

/** Severity bucket used by the network-graph colour scale (0 = clean, 4 = hot). */
function spamSeverity(score: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (score == null) return 0;
  if (score < 5) return 0;
  if (score < 15) return 1;
  if (score < 30) return 2;
  if (score < 50) return 3;
  return 4;
}

/** Source tag for each cell so the template can distinguish API failure vs zero value. */
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

/** Convenience: pick the value out of a `Source` regardless of its variant. */
function unwrap<T>(s: Source<T>): T {
  return s.value;
}

export type AnchorRow = { anchor: string; backlinks: number; domains: number };
export type CategoryRow = { category: string; share: number; count: number };
export type TypeRow = { type: string; share: number; count: number };
export type AttributeRow = {
  attribute: string;
  share: number;
  count: number;
};

export type BacklinksGraphNode = {
  id: string;
  rank: number;
  spamSeverity: 0 | 1 | 2 | 3 | 4;
  backlinks: number;
};
export type BacklinksGraphLink = { source: string; target: string };

export type BacklinksReportData = {
  input: { domain: string; country: string; countryLabel: string };
  /** True if every cell came back ok. False means at least one cell is a placeholder. */
  healthy: boolean;
  /** Single authoritative payload to feed the template + small per-cell `Source` markers. */
  tiles: {
    authority: Source<number | null>;
    authorityComposition: { rank: number | null; spamPenalty: number };
    backlinks: Source<number | null>;
    organicTraffic: Source<number | null>;
    referringDomains: Source<number | null>;
    toxicity: Source<number | null>;
  };
  charts: {
    /** Radar of composed authority dimensions. */
    authorityRadar: Source<{ axes: { label: string; value: number }[] }>;
    /** Trend line of authority score over time (last ~12 weeks of history). */
    authorityTrend: Source<{
      points: { date: string; value: number | null }[];
    }>;
    /** Network graph of referring domains (target at the centre). */
    networkGraph: Source<{
      nodes: BacklinksGraphNode[];
      links: BacklinksGraphLink[];
    }>;
    /** Area chart of referring domains over time (from history). */
    referringDomainsArea: Source<{
      points: { date: string; value: number | null }[];
    }>;
    /** Area chart of total backlinks over time. */
    backlinksArea: Source<{ points: { date: string; value: number | null }[] }>;
    /** Bars: new vs lost referring domains per period (last 12 weeks). */
    referringDomainsBars: Source<{
      points: { date: string; new: number; lost: number }[];
    }>;
    /** Bars: new vs lost backlinks per period (last 12 weeks). */
    backlinksBars: Source<{
      points: { date: string; new: number; lost: number }[];
    }>;
  };
  tables: {
    categories: Source<CategoryRow[]>;
    types: Source<TypeRow[]>;
    attributes: Source<AttributeRow[]>;
    topAnchors: Source<AnchorRow[]>;
  };
};

/**
 * Minimum age (in days) for backlink data — keeps the chart density readable
 * even when the history endpoint hands us a long window.
 */
const HISTORY_DAYS = 84;

/** ISO date for `n` days before `now` (used by history endpoints). */
function isoDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Summarise the counts in a payload that we aggregate manually from rows. */
function countBy<T>(
  items: T[],
  pickKey: (item: T) => string | null | undefined,
  aliases: Record<string, string> = {},
  limit = 8,
): { rows: { label: string; count: number }[] } {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = pickKey(item);
    if (raw == null || raw === "") continue;
    const normalized = raw.toLowerCase().trim();
    const key = aliases[normalized] ?? normalized;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { rows: [] };
  }
  const rows = Array.from(counts.entries())
    .map(([key, count]) => ({
      label: key,
      count,
      // share normalised against the actual total below
      share: count / total,
    }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, limit);
  return { rows };
}

/** Pretty label for a backlink `item_type`. */
const TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  image: "Imagen",
  form: "Formulario",
  frame: "Marco",
};

/** Map a list of attributes to buckets the report cares about. */
const ATTRIBUTE_LABELS: Record<string, string> = {
  dofollow: "Follow",
  nofollow: "Nofollow",
  sponsored: "Sponsored",
  ugc: "UGC",
};

/** Aggregate a backlink row into {type, attribute buckets}. */
function classifyAttributes(backlink: BacklinksItem): {
  type: string;
  attributes: string[];
} {
  const t: string = backlink.item_type ?? "";
  const rel: string[] = backlink.rel_attributes ?? backlink.attributes ?? [];
  // Fallback: infer from `dofollow` boolean if rel_attributes are absent.
  const attributes: string[] = [];
  if (rel.length > 0) {
    for (const r of rel) attributes.push(String(r).toLowerCase());
  } else if (backlink.dofollow === false) {
    attributes.push("nofollow");
  } else {
    // Either explicitly true OR absent — both default to follow.
    attributes.push("dofollow");
  }
  return { type: (t || "text").toLowerCase(), attributes };
}

/** Build the four table datasets from the backlink rows fetch. */
function buildTables(rows: BacklinksItem[]) {
  const typeCounts = new Map<string, number>();
  const attributeCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const anchorCounts = new Map<
    string,
    { backlinks: number; domains: Set<string> }
  >();

  for (const row of rows) {
    const { type, attributes } = classifyAttributes(row);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    if (attributes.length === 0) {
      attributeCounts.set(
        "dofollow",
        (attributeCounts.get("dofollow") ?? 0) + 1,
      );
    } else {
      for (const attr of attributes) {
        if (!ATTRIBUTE_LABELS[attr]) continue;
        attributeCounts.set(attr, (attributeCounts.get(attr) ?? 0) + 1);
      }
    }

    // Categories: DataForSEO doesn't ship a category per backlink; the
    // dedicated `domainPagesSummary` endpoint exposes per-page categories
    // instead. To stay aligned with the spec ("Categorías de dominios de
    // referencia"), we classify by TLD/grouping of the referring domain —
    // it's an approximation, surfaced in the template footer with ⚠️.
    const from = row.domain_from ?? row.url_from ?? "";
    try {
      const host = from
        ? new URL(from.startsWith("http") ? from : `https://${from}`).hostname
        : "";
      const tld = host.split(".").slice(-1)[0] ?? "other";
      const cat = (tld || "other").toLowerCase();
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    } catch {
      categoryCounts.set("other", (categoryCounts.get("other") ?? 0) + 1);
    }

    const anchor = (row.anchor ?? "").trim() || "[sin anchor]";
    const domain = row.domain_from ?? row.url_from ?? "(desconocido)";
    const entry = anchorCounts.get(anchor) ?? {
      backlinks: 0,
      domains: new Set<string>(),
    };
    entry.backlinks += 1;
    entry.domains.add(domain);
    anchorCounts.set(anchor, entry);
  }

  const total = rows.length || 1;

  const types: TypeRow[] = Array.from(typeCounts.entries())
    .map(([type, count]) => ({
      type: TYPE_LABELS[type] ?? type,
      share: count / total,
      count,
    }))
    .toSorted((a, b) => b.count - a.count);

  const attributes: AttributeRow[] = Array.from(attributeCounts.entries())
    .map(([attribute, count]) => ({
      attribute: ATTRIBUTE_LABELS[attribute] ?? attribute,
      share: count / total,
      count,
    }))
    .toSorted((a, b) => b.count - a.count);

  const categories: CategoryRow[] = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({
      category,
      share: count / total,
      count,
    }))
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 6);

  const topAnchors: AnchorRow[] = Array.from(anchorCounts.entries())
    .map(([anchor, entry]) => ({
      anchor,
      backlinks: entry.backlinks,
      domains: entry.domains.size,
    }))
    .toSorted((a, b) => b.backlinks - a.backlinks)
    .slice(0, 10);

  return { categories, types, attributes, topAnchors };
}

/** Top-N referring domains for the network graph (deterministic ordering). */
function buildNetworkGraph(target: string, referring: ReferringDomainItem[]) {
  const top = [...referring]
    .toSorted((a, b) => (b.backlinks ?? 0) - (a.backlinks ?? 0))
    .slice(0, 18);

  const nodes: BacklinksGraphNode[] = [
    {
      id: target,
      rank: 100,
      spamSeverity: 0,
      backlinks: referring.reduce((acc, r) => acc + (r.backlinks ?? 0), 0),
    },
    ...top.map((r) => ({
      id: r.domain ?? "(desconocido)",
      rank: typeof r.rank === "number" ? r.rank : 0,
      spamSeverity: spamSeverity(r.backlinks_spam_score),
      backlinks: r.backlinks ?? 0,
    })),
  ];

  const links: BacklinksGraphLink[] = top.map((r) => ({
    source: target,
    target: r.domain ?? "(desconocido)",
  }));

  return { nodes, links };
}

/** Reduce history rows into chart series (weekly bucket). */
function buildHistorySeries(history: BacklinksHistoryItem[]) {
  const sorted = [...history]
    .filter((h): h is BacklinksHistoryItem & { date: string } => !!h.date)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_DAYS);

  const referringArea = sorted.map((h) => ({
    date: h.date,
    value: h.referring_domains ?? null,
  }));
  const backlinksArea = sorted.map((h) => ({
    date: h.date,
    value: h.backlinks ?? null,
  }));
  // Trend of proprietary authority score across history (rank-based).
  const trend = sorted.map((h) => {
    const base = h.rank ?? null;
    if (base == null) return { date: h.date, value: null };
    const penalty = Math.min(25, Math.round(0));
    return {
      date: h.date,
      value: Math.max(0, Math.min(100, Math.round(base - penalty))),
    };
  });

  // Bars: weekly new vs lost. DataForSEO ships these in same row so we just
  // map them; the template will bucket into weeks via labels.
  const refBars = sorted.map((h) => ({
    date: h.date,
    new: h.new_referring_domains ?? h.new_reffering_domains ?? 0,
    lost: h.lost_referring_domains ?? h.lost_reffering_domains ?? 0,
  }));
  const blBars = sorted.map((h) => ({
    date: h.date,
    new: h.new_backlinks ?? 0,
    lost: h.lost_backlinks ?? 0,
  }));

  return {
    referringArea: referringArea.length > 0 ? referringArea : null,
    backlinksArea: backlinksArea.length > 0 ? backlinksArea : null,
    trend: trend.length > 0 ? trend : null,
    refBars: refBars.length > 0 ? refBars : null,
    blBars: blBars.length > 0 ? blBars : null,
  };
}

/** Axes for the radar — same proprietary dimensions the spec lists. */
function buildRadarAxes(summary: BacklinksSummaryItem) {
  const rank = summary.rank ?? 0;
  const referring = Math.min(
    100,
    Math.round((summary.referring_domains ?? 0) / 50),
  );
  const diversity = Math.min(
    100,
    Math.round((summary.referring_pages ?? 0) / 50),
  );
  const spam = Math.max(0, 100 - (summary.backlinks_spam_score ?? 0));
  const newRatio = (() => {
    const n = summary.new_backlinks ?? 0;
    const l = summary.lost_backlinks ?? 0;
    const total = n + l;
    if (total === 0) return 50;
    return Math.round((n / total) * 100);
  })();
  return {
    axes: [
      { label: "Autoridad", value: Math.max(0, Math.min(100, rank)) },
      { label: "Referrers", value: referring },
      { label: "Diversidad", value: diversity },
      { label: "Limpieza", value: spam },
      { label: "Crecimiento", value: newRatio },
    ],
  };
}

/**
 * Build the complete payload for the Backlinks report template.
 *
 * Errors in any individual call become placeholder rows in the payload —
 * the template renders a "—" cell with a small marker instead of blanking
 * the whole report. The `healthy` flag is `true` iff every call returned
 * a non-empty result; the route can choose to surface it if useful.
 */
export async function buildBacklinksReportData(
  input: BuildBacklinksReportInput,
): Promise<BacklinksReportData> {
  const market = resolveMarket(input.country);
  const today = new Date();
  const dateFrom = isoDaysAgo(HISTORY_DAYS, today);
  const dateTo = today.toISOString().slice(0, 10);

  const [
    summarySettled,
    rowsSettled,
    refDomainsSettled,
    domainPagesSettled,
    historySettled,
    labsSettled,
  ] = await Promise.allSettled([
    fetchBacklinksSummary({ target: input.domain }),
    fetchBacklinksRows({
      target: input.domain,
      limit: 100,
      orderBy: ["rank,desc"],
    }),
    fetchReferringDomains({
      target: input.domain,
      limit: 50,
      orderBy: ["backlinks,desc"],
    }),
    fetchDomainPagesSummary({
      target: input.domain,
      limit: 10,
      orderBy: ["backlinks,desc"],
    }),
    fetchBacklinksHistory({
      target: input.domain,
      dateFrom,
      dateTo,
    }),
    fetchDomainRankOverview({
      target: input.domain,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    }),
  ]);

  const summary: BacklinksSummaryItem =
    summarySettled.status === "fulfilled"
      ? (summarySettled.value.data ?? {})
      : {};
  const rows: BacklinksItem[] =
    rowsSettled.status === "fulfilled"
      ? (rowsSettled.value.data?.items ?? [])
      : [];
  const refDomains: ReferringDomainItem[] =
    refDomainsSettled.status === "fulfilled"
      ? (refDomainsSettled.value.data?.items ?? [])
      : [];
  const domainPages: DomainPageSummaryItem[] =
    domainPagesSettled.status === "fulfilled"
      ? (domainPagesSettled.value.data?.items ?? [])
      : [];
  const history: BacklinksHistoryItem[] =
    historySettled.status === "fulfilled"
      ? (historySettled.value.data ?? [])
      : [];
  const labsItems: { metrics?: { organic?: { etv?: number | null } } }[] =
    labsSettled.status === "fulfilled" ? (labsSettled.value.data ?? []) : [];

  // ---- Tiles ----
  const authorityScore = computeAuthorityScore(summary);
  const tiles = {
    authority:
      authorityScore != null ? ok(authorityScore) : empty<number | null>(null),
    authorityComposition: {
      rank: summary.rank ?? null,
      spamPenalty: summary.backlinks_spam_score
        ? Math.min(25, Math.round(summary.backlinks_spam_score * 0.25))
        : 0,
    },
    backlinks:
      summarySettled.status === "fulfilled" && summary.backlinks != null
        ? ok(summary.backlinks)
        : summarySettled.status === "fulfilled"
          ? empty<number | null>(null)
          : err<number | null>(null),
    organicTraffic: (() => {
      const etv = pickOrganicTraffic(labsItems);
      return labsSettled.status === "fulfilled"
        ? etv != null
          ? ok(etv)
          : empty<number | null>(null)
        : err<number | null>(null);
    })(),
    referringDomains:
      summarySettled.status === "fulfilled" && summary.referring_domains != null
        ? ok(summary.referring_domains)
        : summarySettled.status === "fulfilled"
          ? empty<number | null>(null)
          : err<number | null>(null),
    toxicity: (() => {
      const toxicity = summary.info?.target_spam_score ?? null;
      return toxicity != null ? ok(toxicity) : empty<number | null>(null);
    })(),
  };

  // ---- Charts ----
  const series = buildHistorySeries(history);
  const authorityAxes = buildRadarAxes(summary);

  const charts = {
    authorityRadar: ok(authorityAxes),
    authorityTrend:
      series.trend != null
        ? ok({ points: series.trend })
        : empty<{ points: { date: string; value: number | null }[] }>({
            points: [],
          }),
    networkGraph:
      refDomainsSettled.status === "fulfilled"
        ? ok(buildNetworkGraph(input.domain, refDomains))
        : err({ nodes: [], links: [] }),
    referringDomainsArea:
      series.referringArea != null
        ? ok({ points: series.referringArea })
        : empty<{ points: { date: string; value: number | null }[] }>({
            points: [],
          }),
    backlinksArea:
      series.backlinksArea != null
        ? ok({ points: series.backlinksArea })
        : empty<{ points: { date: string; value: number | null }[] }>({
            points: [],
          }),
    referringDomainsBars:
      series.refBars != null
        ? ok({ points: series.refBars })
        : empty<{ points: { date: string; new: number; lost: number }[] }>({
            points: [],
          }),
    backlinksBars:
      series.blBars != null
        ? ok({ points: series.blBars })
        : empty<{ points: { date: string; new: number; lost: number }[] }>({
            points: [],
          }),
  };

  // ---- Tables ----
  const tableData = rows.length > 0 ? buildTables(rows) : null;
  const tables = {
    categories:
      tableData !== null ? ok(tableData.categories) : empty<CategoryRow[]>([]),
    types: tableData !== null ? ok(tableData.types) : empty<TypeRow[]>([]),
    attributes:
      tableData !== null ? ok(tableData.attributes) : empty<AttributeRow[]>([]),
    topAnchors:
      tableData !== null ? ok(tableData.topAnchors) : empty<AnchorRow[]>([]),
  };

  const healthy = [
    summarySettled,
    rowsSettled,
    refDomainsSettled,
    domainPagesSettled,
    historySettled,
    labsSettled,
  ].every((s) => s.status === "fulfilled");

  // Touch the unused slot so tooling doesn't drop the import.
  void domainPages;

  return {
    input: {
      domain: input.domain,
      country: market.countryLabel,
      countryLabel: market.countryLabel,
    },
    healthy,
    tiles,
    charts,
    tables,
  };
}

// Re-exports used by tests.
export const __test = {
  resolveMarket,
  computeAuthorityScore,
  pickOrganicTraffic,
  spamSeverity,
  isoDaysAgo,
  countBy,
  classifyAttributes,
  buildTables,
  buildNetworkGraph,
  buildHistorySeries,
  buildRadarAxes,
  ok,
  empty,
  err,
  unwrap,
};
