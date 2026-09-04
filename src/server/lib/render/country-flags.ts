/**
 * Inline country flag artwork for report templates.
 *
 * `country-flag-icons/string/3x2` is ~174 kB of SVG string constants covering
 * 265 territories, and it can only be indexed by ISO code at runtime — so a
 * static import pulls in all of it, to draw the one flag a report actually
 * shows. Imported straight from `templates/overview.ts` it landed inside the
 * router chunk, which every route in the app shares; behind this seam it gets a
 * chunk of its own that is only fetched when an overview report is rendered
 * (router chunk: 1806 kB → 1627 kB).
 *
 * Note this is *not* the worker's eager startup closure — the router itself is
 * dynamically imported, so no render template is evaluated at isolate startup,
 * and the `EAGER_DENYLIST` in `vite-plugin-lean-worker-bundle.ts` neither
 * guards nor could guard this boundary (verified: a static flag import in the
 * template does not trip it). The win here is per-request weight, not startup
 * heap.
 *
 * The caller resolves the handful of flags it needs and hands them to a
 * template that stays synchronous and pure.
 */
export async function loadCountryFlags(
  codes: string[],
): Promise<Record<string, string>> {
  const wanted = codes
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  if (wanted.length === 0) return {};

  const flags: Record<string, string | undefined> =
    await import("country-flag-icons/string/3x2");
  const resolved: Record<string, string> = {};
  for (const code of wanted) {
    const svg = flags[code];
    // An unknown code resolves to nothing on purpose: the row's label already
    // names the country, and a wrong flag is worse than no flag.
    if (svg !== undefined) resolved[code] = svg;
  }
  return resolved;
}
