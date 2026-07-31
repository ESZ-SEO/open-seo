import { withPage } from "./browser.js";

const NAV_TIMEOUT_MS = Number(process.env.PUPPETEER_NAV_TIMEOUT_MS ?? 30_000);

export interface ScreenshotOptions {
  html: string;
  width?: number;
  height?: number;
  waitForSelector?: string;
}

/**
 * Renders `html` in a headless Chromium page and returns a PNG clipped to
 * width x height. Defaults: 1280 x 800 (per the E0.1 contract).
 */
export async function renderHtmlToPng(
  opts: ScreenshotOptions,
): Promise<Uint8Array> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;

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

    const png = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height },
    });
    return png;
  });
}
