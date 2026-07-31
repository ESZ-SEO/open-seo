import puppeteer, { type Browser, type Page } from "puppeteer";

// Browser launch + navigation wait timeout (ms). This is the single timeout
// knob for the only slow operation (setContent + screenshot), so it acts as the
// effective per-request cap (~30s per the E0.1 contract).
const NAV_TIMEOUT_MS = Number(process.env.PUPPETEER_NAV_TIMEOUT_MS ?? 30_000);

let browserPromise: Promise<Browser> | null = null;

/**
 * Returns the shared Chromium instance, launching it lazily once and reusing it
 * across requests. Concurrent callers await the same launch promise. If the
 * launch fails the promise is cleared so the next call retries from scratch.
 */
export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      timeout: NAV_TIMEOUT_MS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    // Clear on failure so a transient launch error doesn't poison every
    // subsequent request.
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

/**
 * Opens a fresh page on the shared browser, runs `fn`, and always closes the
 * page. The browser itself stays alive for the next request.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Closes the shared browser. Used on graceful shutdown. */
export async function closeBrowser(): Promise<void> {
  const promise = browserPromise;
  browserPromise = null;
  if (!promise) return;
  const browser = await promise.catch(() => null);
  if (browser) await browser.close().catch(() => {});
}
