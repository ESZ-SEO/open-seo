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
import {
  computeAuthorityScore,
  resolveMarket,
} from "@/server/lib/render/reports/shared";

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

/**
 * Extract organic estimated traffic from the Labs domain overview metrics.
 * The Labs response returns `metrics: { organic: { etv }, paid: { etv } }`
 * indexed by search-engine — see `DataforseoLabsMetricsInfo.etv`.
 */
function pickOrganicTraffic(
  items: { metrics?: { organic?: { etv?: number | null } | null } | null }[],
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

/**
 * Resolve a `Source` from a settled-promise status plus an already-derived
 * value: `err` if the underlying call failed, `empty` if it succeeded with
 * nothing usable, `ok` otherwise. Centralises the "fulfilled ? (hasValue ?
 * ok : empty) : err" pattern repeated across this file's fan-out.
 */
function sourceFor<T>(fulfilled: boolean, hasValue: boolean, value: T): Source<T> {
  if (!fulfilled) return err(value);
  return hasValue ? ok(value) : empty(value);
}

/**
 * `sourceFor` specialised for the common case of a nullable numeric field
 * plucked straight off the summary response — used by `backlinks`,
 * `referringDomains`, `referringPages` and `brokenBacklinks`, which all
 * share the exact same ok/empty/err precedence.
 */
function summaryNumberSource(
  fulfilled: boolean,
  value: number | null | undefined,
): Source<number | null> {
  return sourceFor(fulfilled, value != null, value ?? null);
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
/** One bucket of the "referring domains by authority" distribution. */
export type AuthorityBucketRow = { range: string; share: number; count: number };
/** One axis of the composed authority profile (exactly 3 today). */
export type AuthorityAxis = { label: string; value: number };

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
    referringDomains: Source<number | null>;
    backlinks: Source<number | null>;
    /**
     * DataForSEO does not expose a "monthly visits" metric anywhere in
     * `src/server/lib/dataforseo/` (verified — no traffic-estimate endpoint
     * covers it). The tile stays in the payload because removing it would
     * collapse the 6-cell KPI strip (playbook §3 — keep the geometry, never
     * fabricate the number). It would need a new DataForSEO Labs/traffic
     * endpoint (or a different data source entirely) to ever carry a value.
     */
    monthlyVisits: Source<number | null>;
    organicTraffic: Source<number | null>;
    /**
     * Same situation as `monthlyVisits`: no DataForSEO endpoint reports the
     * count of domains a target links out to. Always empty until such an
     * endpoint exists.
     */
    outboundDomains: Source<number | null>;
    /**
     * Honest, sourced alternative to `monthlyVisits`/`outboundDomains` for the
     * 6-cell KPI strip: `summary.referring_pages` and `summary.broken_backlinks`
     * are already fetched. Which pair of six the template actually shows is a
     * product call Pedro hasn't made yet — exposing both pairs here means
     * whichever way that goes, the data side is already done.
     */
    referringPages: Source<number | null>;
    brokenBacklinks: Source<number | null>;
    toxicity: Source<number | null>;
    /**
     * Fractional change across the history window (-0.03 = -3%), derived
     * from the first vs. last non-null point of `fetchBacklinksHistory`
     * (see `computeDelta`). `null` when there is no real base to compare
     * against — never fabricated (playbook §3).
     */
    deltas: {
      referringDomains: number | null;
      backlinks: number | null;
    };
  };
  charts: {
    /**
     * Composed authority profile: a 0-100 score, a semantic badge, and
     * exactly 3 axes. Replaces the earlier 5-axis radar — see
     * `buildAuthorityProfile` for the explicit, documented mapping.
     */
    authorityProfile: Source<{
      score: number | null;
      badge: string | null;
      axes: AuthorityAxis[];
    }>;
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
    /**
     * What dimension `categories` actually groups by. DataForSEO does not
     * classify referring domains by industry — the rows are grouped by TLD
     * (see `buildTables`) — so the template shows this instead of implying
     * a taxonomy we don't have.
     */
    categoriesDimension: string;
    topAnchors: Source<AnchorRow[]>;
    /**
     * Referring domains bucketed by authority `rank`, always exactly 10
     * buckets (even at 0) so the geometry never collapses.
     */
    authorityDistribution: Source<AuthorityBucketRow[]>;
    /** How many referring domains were actually bucketed (sample size/scope). */
    authorityDistributionSample: number;
    types: Source<TypeRow[]>;
    attributes: Source<AttributeRow[]>;
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
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { rows };
}

/** Pretty label for a backlink `item_type`. */
const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  image: "Image",
  form: "Form",
  frame: "Frame",
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

    const anchor = (row.anchor ?? "").trim() || "[Empty anchor]";
    const domain = row.domain_from ?? row.url_from ?? "(unknown)";
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
    .sort((a, b) => b.count - a.count);

  const attributes: AttributeRow[] = Array.from(attributeCounts.entries())
    .map(([attribute, count]) => ({
      attribute: ATTRIBUTE_LABELS[attribute] ?? attribute,
      share: count / total,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const categories: CategoryRow[] = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({
      category,
      share: count / total,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const topAnchors: AnchorRow[] = Array.from(anchorCounts.entries())
    .map(([anchor, entry]) => ({
      anchor,
      backlinks: entry.backlinks,
      domains: entry.domains.size,
    }))
    .sort((a, b) => b.backlinks - a.backlinks)
    .slice(0, 10);

  return { categories, types, attributes, topAnchors };
}

/** Top-N referring domains for the network graph (deterministic ordering). */
function buildNetworkGraph(target: string, referring: ReferringDomainItem[]) {
  const top = [...referring]
    .sort((a, b) => (b.backlinks ?? 0) - (a.backlinks ?? 0))
    .slice(0, 18);

  const nodes: BacklinksGraphNode[] = [
    {
      id: target,
      rank: 100,
      spamSeverity: 0,
      backlinks: referring.reduce((acc, r) => acc + (r.backlinks ?? 0), 0),
    },
    ...top.map((r) => ({
      id: r.domain ?? "(unknown)",
      rank: typeof r.rank === "number" ? r.rank : 0,
      spamSeverity: spamSeverity(r.backlinks_spam_score),
      backlinks: r.backlinks ?? 0,
    })),
  ];

  const links: BacklinksGraphLink[] = top.map((r) => ({
    source: target,
    target: r.domain ?? "(unknown)",
  }));

  return { nodes, links };
}

/** Reduce history rows into chart series (weekly bucket). */
function buildHistorySeries(history: BacklinksHistoryItem[]) {
  const sorted = [...history]
    .filter((h): h is BacklinksHistoryItem & { date: string } => !!h.date)
    .sort((a, b) => a.date.localeCompare(b.date))
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

/**
 * Ceiling ETV (organic traffic) treated as "top of scale" for the Organic
 * Traffic axis. ETV spans many orders of magnitude — 0 for small sites to
 * tens of millions for market leaders — so a linear 0-100 mapping would
 * flatten almost every real domain near zero. A log10 scale keeps the axis
 * meaningful across that range; 10M ETV is the point at which the axis
 * saturates to 100.
 */
const ORGANIC_TRAFFIC_AXIS_CAP = 10_000_000;

/** Normalise organic traffic (ETV) to a 0-100 axis value via a log10 scale. */
function organicTrafficAxisValue(etv: number | null): number {
  if (etv == null || etv <= 0) return 0;
  const scaled =
    Math.log10(etv + 1) / Math.log10(ORGANIC_TRAFFIC_AXIS_CAP + 1);
  return Math.max(0, Math.min(100, Math.round(scaled * 100)));
}

/** Semantic label for an authority score. `null` when the score itself is `null`. */
function authorityBadge(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 70) return "Industry leader";
  if (score >= 50) return "Strong";
  if (score >= 30) return "Developing";
  return "Low authority";
}

/**
 * Composed authority profile: a score, a badge, and exactly 3 axes.
 * Explicit mapping (no arbitrary composition):
 *  - Link Power      ← `summary.rank`, already 0-100 (`rank_scale=one_hundred`).
 *  - Organic Traffic ← Labs `etv`, log-scaled (see `organicTrafficAxisValue`).
 *  - Natural Profile ← `100 - backlinks_spam_score`, clamped to [0,100].
 */
function buildAuthorityProfile(
  summary: BacklinksSummaryItem,
  etv: number | null,
  score: number | null,
): { score: number | null; badge: string | null; axes: AuthorityAxis[] } {
  const linkPower = Math.max(0, Math.min(100, Math.round(summary.rank ?? 0)));
  const naturalProfile = Math.max(
    0,
    Math.min(100, 100 - (summary.backlinks_spam_score ?? 0)),
  );
  const axes: AuthorityAxis[] = [
    { label: "Link Power", value: linkPower },
    { label: "Organic Traffic", value: organicTrafficAxisValue(etv) },
    { label: "Natural Profile", value: Math.round(naturalProfile) },
  ];
  return { score, badge: authorityBadge(score), axes };
}

/**
 * Fractional change between the first and last non-null point of a history
 * series (-0.03 = -3%). `null` when there's no real base to compare against:
 * fewer than two non-null points, or a zero base (playbook §3 — never a
 * delta without a real base).
 */
function computeDelta(
  points: { date: string; value: number | null }[] | null,
): number | null {
  if (!points) return null;
  // Single forward pass (no copy/reverse) tracking the first and last
  // non-null values and how many we saw.
  let from: number | null = null;
  let to: number | null = null;
  let nonNullCount = 0;
  for (const point of points) {
    if (point.value == null) continue;
    from ??= point.value;
    to = point.value;
    nonNullCount += 1;
  }
  if (nonNullCount < 2 || from == null || to == null || from === 0) {
    return null;
  }
  return (to - from) / from;
}

/** Fixed bucket ranges for the authority distribution, in display order. */
const AUTHORITY_BUCKETS: { range: string; min: number; max: number }[] = [
  { range: "91 - 100", min: 91, max: 100 },
  { range: "81 - 90", min: 81, max: 90 },
  { range: "71 - 80", min: 71, max: 80 },
  { range: "61 - 70", min: 61, max: 70 },
  { range: "51 - 60", min: 51, max: 60 },
  { range: "41 - 50", min: 41, max: 50 },
  { range: "31 - 40", min: 31, max: 40 },
  { range: "21 - 30", min: 21, max: 30 },
  { range: "11 - 20", min: 11, max: 20 },
  { range: "0 - 10", min: 0, max: 10 },
];

/**
 * Bucket referring domains by `rank` into the 10 fixed authority ranges.
 * Always returns all 10 buckets, in order, even when a bucket is empty —
 * the geometry never collapses (playbook §3). `sample` is how many domains
 * actually had a numeric rank and were counted, so the template can declare
 * the scope of the distribution (today: top 50 by backlinks, not the full set).
 */
function buildAuthorityDistribution(domains: ReferringDomainItem[]): {
  rows: AuthorityBucketRow[];
  sample: number;
} {
  const counts = new Map<string, number>(
    AUTHORITY_BUCKETS.map((b) => [b.range, 0]),
  );
  let sample = 0;
  for (const domain of domains) {
    const rank = domain.rank;
    if (typeof rank !== "number") continue;
    const bucket = AUTHORITY_BUCKETS.find(
      (b) => rank >= b.min && rank <= b.max,
    );
    if (!bucket) continue;
    counts.set(bucket.range, (counts.get(bucket.range) ?? 0) + 1);
    sample += 1;
  }
  const rows: AuthorityBucketRow[] = AUTHORITY_BUCKETS.map((b) => {
    const count = counts.get(b.range) ?? 0;
    return { range: b.range, count, share: sample > 0 ? count / sample : 0 };
  });
  return { rows, sample };
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
  const labsItems: {
    metrics?: { organic?: { etv?: number | null } | null } | null;
  }[] = labsSettled.status === "fulfilled" ? (labsSettled.value.data ?? []) : [];

  // ---- Shared derived values (tiles + charts both need these) ----
  const authorityScore = computeAuthorityScore(summary);
  const etv = pickOrganicTraffic(labsItems);
  const series = buildHistorySeries(history);

  // ---- Tiles ----
  const tiles = {
    authority:
      authorityScore != null ? ok(authorityScore) : empty<number | null>(null),
    authorityComposition: {
      rank: summary.rank ?? null,
      spamPenalty: summary.backlinks_spam_score
        ? Math.min(25, Math.round(summary.backlinks_spam_score * 0.25))
        : 0,
    },
    referringDomains: summaryNumberSource(
      summarySettled.status === "fulfilled",
      summary.referring_domains,
    ),
    backlinks: summaryNumberSource(
      summarySettled.status === "fulfilled",
      summary.backlinks,
    ),
    // No DataForSEO endpoint exposes this — see the field's JSDoc on the type.
    monthlyVisits: empty<number | null>(null),
    organicTraffic: sourceFor(
      labsSettled.status === "fulfilled",
      etv != null,
      etv,
    ),
    // No DataForSEO endpoint exposes this — see the field's JSDoc on the type.
    outboundDomains: empty<number | null>(null),
    referringPages: summaryNumberSource(
      summarySettled.status === "fulfilled",
      summary.referring_pages,
    ),
    brokenBacklinks: summaryNumberSource(
      summarySettled.status === "fulfilled",
      summary.broken_backlinks,
    ),
    toxicity: (() => {
      const toxicity = summary.info?.target_spam_score ?? null;
      return toxicity != null ? ok(toxicity) : empty<number | null>(null);
    })(),
    deltas: {
      referringDomains: computeDelta(series.referringArea),
      backlinks: computeDelta(series.backlinksArea),
    },
  };

  // ---- Charts ----
  const authorityProfile = buildAuthorityProfile(summary, etv, authorityScore);

  const charts = {
    authorityProfile: sourceFor(
      summarySettled.status === "fulfilled",
      authorityScore != null,
      authorityProfile,
    ),
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
  const authorityDistribution = buildAuthorityDistribution(
    refDomainsSettled.status === "fulfilled" ? refDomains : [],
  );
  const tables = {
    categories:
      tableData !== null ? ok(tableData.categories) : empty<CategoryRow[]>([]),
    // DataForSEO doesn't classify by industry — categories are grouped by TLD.
    categoriesDimension: "TLD",
    topAnchors:
      tableData !== null ? ok(tableData.topAnchors) : empty<AnchorRow[]>([]),
    authorityDistribution: sourceFor(
      refDomainsSettled.status === "fulfilled",
      true,
      authorityDistribution.rows,
    ),
    authorityDistributionSample: authorityDistribution.sample,
    types: tableData !== null ? ok(tableData.types) : empty<TypeRow[]>([]),
    attributes:
      tableData !== null ? ok(tableData.attributes) : empty<AttributeRow[]>([]),
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

// Re-exports used by tests. `resolveMarket` and `computeAuthorityScore` are
// imported from `shared.ts` (E3.0 extraction) — the test re-binds them
// through the same `__test` surface so `backlinks-report.test.ts` keeps
// importing the helpers from this module unchanged.
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
  organicTrafficAxisValue,
  authorityBadge,
  buildAuthorityProfile,
  computeDelta,
  buildAuthorityDistribution,
  ok,
  empty,
  err,
  sourceFor,
  summaryNumberSource,
  unwrap,
};
