import { env } from "cloudflare:workers";
import { buildCacheKey } from "@/server/lib/r2-cache";

/**
 * Per-report cache for rendered PNGs.
 *
 * DECISION (D-E0-D refinement): we do NOT route binary PNG bytes through
 * `r2-cache.ts` — that helper JSON-stringifies on write and JSON.parses on
 * read, which corrupts binary image data (a Uint8Array round-trips as a plain
 * object with numeric keys, not a typed array). Instead we store the raw PNG
 * bytes directly in R2 via `env.R2.put/get`, reusing the same lazy-TTL idiom
 * (`customMetadata.expiresAt`, expired-on-read) so the behaviour stays
 * consistent with the rest of the repo. Physical cleanup is deferred to E5.2.
 *
 * `buildCacheKey` (SHA-256 over sorted params) is reused from `r2-cache.ts` so
 * keys stay deterministic and stable across runtimes.
 */

/** Soft TTL per report type (seconds). Refine with real volume in E5.2. */
export const RENDER_TTL_SECONDS = {
  backlinks: 30 * 86_400,
  competitors: 15 * 86_400,
  overview: 7 * 86_400,
} as const;

export type ReportKind = keyof typeof RENDER_TTL_SECONDS;

const CACHE_PREFIX = "render-cache/";

/** Deterministic cache key from the report coordinates. */
export async function buildReportCacheKey(
  report: ReportKind,
  domain: string,
  country: string,
  device: string,
): Promise<string> {
  return buildCacheKey("render:report", { report, domain, country, device });
}

/**
 * Read a cached PNG. Returns null on miss or soft-expiry. Bytes are returned
 * as a `Uint8Array` so they can be written straight back to R2 or served.
 */
export async function getCachedReport(
  key: string,
): Promise<Uint8Array | null> {
  const object = await env.R2.get(`${CACHE_PREFIX}${key}`);
  if (!object) return null;

  const expiresAt = object.customMetadata?.expiresAt;
  if (expiresAt && Date.parse(expiresAt) < Date.now()) return null;

  const buffer = await object.arrayBuffer();
  return new Uint8Array(buffer);
}

/** Store a rendered PNG with a soft TTL via custom metadata. */
export async function setCachedReport(
  key: string,
  png: Uint8Array,
  ttlSeconds: number,
): Promise<void> {
  await env.R2.put(`${CACHE_PREFIX}${key}`, png, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: {
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    },
  });
}
