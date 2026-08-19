import { LOCATION_OPTIONS } from "@/shared/keyword-locations";
import type { BacklinksSummaryItem } from "@/server/lib/dataforseo/backlinks";

/**
 * Shared helpers for the SEM-clone render services (E1/E2/E3).
 *
 * Two pieces of helper code were duplicated across E1 (`backlinks-report.ts`)
 * and E2 (`competitors-report.ts`) with the same body — this file collects the
 * consolidated versions. E3 (Domain Overview) is the third consumer, so the
 * extraction lands here BEFORE it forks a third copy.
 *
 * Specifically:
 *  - `resolveMarket`: ISO short label → DataForSEO location code + language.
 *  - `computeAuthorityScore`: proprietary 0–100 score derived from rank
 *    minus a spam penalty (semrush's "Authority Score" has no equivalent on
 *    DataForSEO Labs, so the spec §6.2 / §6.3 Both flag this as ⚠️ composed).
 *
 * Both functions are pure and exported through `__test` so the existing
 * `backlinks-report.test.ts` and `competitors-report.test.ts` can re-export
 * them from here without changing test expectations or behaviour.
 */

export type ResolvedMarket = {
  locationCode: number;
  languageCode: string;
  countryLabel: string;
};

/** Look up a country short label (e.g. `ES`) → DataForSEO location code. */
export function resolveMarket(country: string): ResolvedMarket {
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
 * Authority score (0–100). Combines:
 *  - DataForSEO `rank` (already 0–100 `rank_scale=one_hundred`) as the base
 *  - a small penalty for spam (spammy backlink profile drags authority down)
 *
 * Why the `null`-tolerant signature: the E2 variant had to guard against a
 * `summary` that is `null` or `undefined` (the pairwise fan-out sometimes
 * returns no BacklinksSummary for a competitor); the E1 variant assumed a
 * fully-populated object. The E2 form is the more complete of the two —
 * keep it as the shared one so we don't regress E1's call sites.
 *
 * Kept intentionally simple and fully deterministic so the report stays
 * reproducible across runs; tuning belongs to E3.2 alongside the Domain
 * Overview score (the same building blocks appear there).
 */
export function computeAuthorityScore(
  summary: BacklinksSummaryItem | null | undefined,
): number | null {
  if (!summary) return null;
  const base = summary.rank;
  if (base == null) return null;
  const spam = summary.backlinks_spam_score ?? 0;
  // Spam is a 0–100 higher-is-worse scale; subtract up to 25 points worst case.
  const penalty = Math.min(25, Math.round(spam * 0.25));
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}
