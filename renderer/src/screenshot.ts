import { withPage } from "./browser.js";

const NAV_TIMEOUT_MS = Number(process.env.PUPPETEER_NAV_TIMEOUT_MS ?? 30_000);

export interface ScreenshotOptions {
  html: string;
  width?: number;
  height?: number;
  waitForSelector?: string;
  /**
   * When true, capture the entire scrollable document instead of clipping
   * to `width`×`height`. Puppeteer forbids passing both `clip` and
   * `fullPage: true`, so this is a branch — when true, `height` is ignored
   * for the capture (the viewport height still affects initial layout, but
   * fullPage expands to the real document height).
   */
  fullPage?: boolean;
}

/**
 * Renders `html` in a headless Chromium page and returns a PNG.
 *
 * By default, the capture is clipped to `width` × `height` (defaults:
 * 1280 × 800 — the E0.1 contract). When `fullPage: true`, the capture
 * spans the entire scrollable document at `width` (the viewport height
 * still controls the initial layout but is ignored at capture time).
 */
export async function renderHtmlToPng(
  opts: ScreenshotOptions,
): Promise<Uint8Array> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;
  const fullPage = opts.fullPage ?? false;

  return withPage(async (page) => {
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // setContent does not support networkidle0/2 (those lifecycle events are
    // not reliably fired when injecting HTML via CDP), so we wait for `load` —
    // enough for inline styles/images. Callers needing to wait for a specific
    // element (e.g. a lazy-rendered chart) pass `waitForSelector`.
    await page.setContent(opts.html, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, {
        timeout: NAV_TIMEOUT_MS,
        visible: true,
      });
    }

    // Puppeteer disallows combining `clip` and `fullPage: true` — pick one.
    const png = fullPage
      ? await page.screenshot({ type: "png", fullPage: true })
      : await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width, height },
        });
    return png;
  });
}
